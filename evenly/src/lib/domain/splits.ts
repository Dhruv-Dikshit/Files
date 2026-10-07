import { allocate, sum } from "./money";
import type { MemberId, Minor, Payer, SplitConfig } from "./types";

export interface SplitResult {
  /** Owed amount per included member (minor units). Excluded members are absent. */
  owed: Record<MemberId, Minor>;
  /** Human-readable validation problems. Empty means the split is valid. */
  errors: string[];
  /**
   * For split types where the user types numbers per person (exact,
   * percent, itemized), how much is still unassigned. Positive = left to
   * assign, negative = over-assigned. Units: minor for exact/itemized,
   * percentage points for percent. Drives the "₹120 left" helper in the UI.
   */
  remaining: number;
}

const PERCENT_EPSILON = 1e-6;

/**
 * Resolve a split configuration into exact owed amounts that always sum to
 * `total` when valid. Pure and synchronous so it can power live previews.
 */
export function computeSplit(total: Minor, config: SplitConfig): SplitResult {
  const included = dedupe(config.included);
  const errors: string[] = [];

  if (!Number.isInteger(total) || total <= 0) {
    return { owed: {}, errors: ["Enter an amount greater than zero."], remaining: 0 };
  }
  if (included.length === 0 && config.type !== "itemized") {
    return { owed: {}, errors: ["Include at least one person."], remaining: 0 };
  }

  switch (config.type) {
    case "equal": {
      const parts = allocate(total, included.map(() => 1));
      return { owed: zip(included, parts), errors, remaining: 0 };
    }

    case "exact": {
      const values = included.map((id) => config.exact?.[id] ?? 0);
      if (values.some((v) => !Number.isInteger(v) || v < 0)) {
        errors.push("Amounts can't be negative.");
      }
      const remaining = total - sum(values);
      if (remaining !== 0) errors.push(remainingMessage(remaining, "amount"));
      return { owed: zip(included, values), errors, remaining };
    }

    case "percent": {
      const pcts = included.map((id) => config.percent?.[id] ?? 0);
      if (pcts.some((p) => !(p >= 0))) errors.push("Percentages can't be negative.");
      const remaining = round6(100 - sum(pcts));
      if (Math.abs(remaining) > PERCENT_EPSILON) {
        errors.push(remainingMessage(remaining, "percent"));
        return { owed: {}, errors, remaining };
      }
      return { owed: zip(included, allocate(total, pcts)), errors, remaining: 0 };
    }

    case "shares": {
      const shares = included.map((id) => config.shares?.[id] ?? 1);
      if (shares.some((s) => !(s >= 0) || !Number.isFinite(s))) {
        errors.push("Shares must be zero or more.");
        return { owed: {}, errors, remaining: 0 };
      }
      if (sum(shares) === 0) {
        errors.push("At least one person needs a share.");
        return { owed: {}, errors, remaining: 0 };
      }
      return { owed: zip(included, allocate(total, shares)), errors, remaining: 0 };
    }

    case "itemized":
      return computeItemized(total, included, config);
  }
}

/**
 * Itemized: each line item is split equally among its assignees. Anything
 * not covered by items (tax, tip, service charge) is distributed in
 * proportion to each person's item subtotal — how most people expect a
 * restaurant bill to work.
 */
function computeItemized(total: Minor, included: MemberId[], config: SplitConfig): SplitResult {
  const errors: string[] = [];
  const items = config.items ?? [];
  const includedSet = new Set(included);
  const subtotals = new Map<MemberId, Minor>();

  if (items.length === 0) {
    return { owed: {}, errors: ["Add at least one line item."], remaining: total };
  }

  for (const item of items) {
    if (!Number.isInteger(item.amount) || item.amount < 0) {
      errors.push(`"${item.label || "Item"}" has an invalid amount.`);
      continue;
    }
    // Excluded members can't be charged even if they were tagged on an item.
    const assignees = dedupe(item.assignees).filter((id) => includedSet.has(id));
    if (assignees.length === 0) {
      if (item.amount > 0) errors.push(`Assign "${item.label || "Item"}" to someone.`);
      continue;
    }
    const parts = allocate(item.amount, assignees.map(() => 1));
    assignees.forEach((id, i) => subtotals.set(id, (subtotals.get(id) ?? 0) + parts[i]));
  }

  const itemsTotal = sum(items.map((i) => i.amount));
  const extra = total - itemsTotal;
  if (extra < 0) errors.push(remainingMessage(extra, "amount"));
  if (errors.length > 0) return { owed: {}, errors, remaining: extra };

  const ids = [...subtotals.keys()];
  const base = ids.map((id) => subtotals.get(id)!);
  if (sum(base) === 0) {
    return { owed: {}, errors: ["Line items must add up to more than zero."], remaining: extra };
  }
  const extraParts = extra > 0 ? allocate(extra, base) : base.map(() => 0);
  return {
    owed: zip(ids, base.map((b, i) => b + extraParts[i])),
    errors,
    remaining: 0, // leftover is intentionally treated as tax/tip, not an error
  };
}

export function validatePayers(total: Minor, payers: Payer[]): string[] {
  const errors: string[] = [];
  if (payers.length === 0) errors.push("Choose who paid.");
  if (payers.some((p) => !Number.isInteger(p.amount) || p.amount < 0)) {
    errors.push("Paid amounts can't be negative.");
  }
  const diff = total - sum(payers.map((p) => p.amount));
  if (payers.length > 0 && diff !== 0) {
    errors.push(diff > 0 ? "Paid amounts are less than the total." : "Paid amounts exceed the total.");
  }
  return errors;
}

/** Per-member net effect of one expense: paid − owed (in expense currency). */
export function expenseDeltas(payers: Payer[], owed: Record<MemberId, Minor>): Record<MemberId, Minor> {
  const out: Record<MemberId, Minor> = {};
  for (const p of payers) out[p.memberId] = (out[p.memberId] ?? 0) + p.amount;
  for (const [id, amount] of Object.entries(owed)) out[id] = (out[id] ?? 0) - amount;
  return out;
}

function remainingMessage(remaining: number, kind: "amount" | "percent"): string {
  if (kind === "percent") {
    return remaining > 0
      ? `${trimNumber(remaining)}% left to assign.`
      : `Over by ${trimNumber(-remaining)}%.`;
  }
  return remaining > 0 ? "Amounts don't add up to the total yet." : "Amounts exceed the total.";
}

function zip(ids: MemberId[], values: Minor[]): Record<MemberId, Minor> {
  const out: Record<MemberId, Minor> = {};
  ids.forEach((id, i) => (out[id] = values[i]));
  return out;
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const trimNumber = (n: number) => String(Math.round(n * 100) / 100);
