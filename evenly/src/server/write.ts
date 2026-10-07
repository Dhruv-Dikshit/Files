import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { computeSplit, validatePayers } from "@/lib/domain/splits";
import type { ExpenseCategory, MemberId, SplitType } from "@/lib/domain/types";
import type { ExpenseDraft } from "@/lib/types";
import { toDbDate } from "./mappers";

const CATEGORIES: ExpenseCategory[] = ["food", "groceries", "transport", "lodging", "entertainment", "utilities", "rent", "shopping", "other"];
const SPLIT_TYPES: SplitType[] = ["equal", "exact", "percent", "shares", "itemized"];
const MAX_AMOUNT = 1e13; // well inside BIGINT and JS safe integers

export class UserError extends Error {}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);

/**
 * Never trust the client's numbers: check the shape, make sure every member
 * belongs to this group, then recompute the split with the same domain
 * function the form used. Returns the authoritative owed map.
 */
export function validateDraft(draft: ExpenseDraft, memberIds: Set<MemberId>, baseCurrency: string): Record<MemberId, number> {
  if (typeof draft?.description !== "string" || !draft.description.trim()) throw new UserError("Add a description.");
  if (draft.description.length > 200) throw new UserError("Description is too long.");
  if (!CATEGORIES.includes(draft.category)) throw new UserError("Unknown category.");
  if (!isInt(draft.amount) || draft.amount <= 0 || draft.amount > MAX_AMOUNT) throw new UserError("Enter a valid amount.");
  if (typeof draft.currency !== "string" || !/^[A-Z]{3}$/.test(draft.currency)) throw new UserError("Unknown currency.");
  if (!(typeof draft.fxRate === "number" && draft.fxRate > 0 && Number.isFinite(draft.fxRate))) throw new UserError("Enter a valid exchange rate.");
  if (draft.currency === baseCurrency && draft.fxRate !== 1) throw new UserError("Exchange rate must be 1 for the group currency.");
  if (typeof draft.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || Number.isNaN(Date.parse(draft.date))) {
    throw new UserError("Enter a valid date.");
  }

  const split = draft.split;
  if (!split || !SPLIT_TYPES.includes(split.type) || !Array.isArray(split.included)) throw new UserError("Invalid split.");
  if (!Array.isArray(draft.payers)) throw new UserError("Choose who paid.");

  const referenced = [
    ...draft.payers.map((p) => p.memberId),
    ...split.included,
    ...(split.items ?? []).flatMap((i) => i.assignees ?? []),
  ];
  if (referenced.some((id) => !memberIds.has(id))) throw new UserError("Someone in this expense isn't in the group.");
  if (draft.payers.some((p) => !isInt(p.amount))) throw new UserError("Paid amounts must be whole minor units.");
  if ((split.items ?? []).some((i) => !isInt(i.amount) || typeof i.label !== "string" || i.label.length > 200)) {
    throw new UserError("Invalid line item.");
  }
  if (new Set(draft.payers.map((p) => p.memberId)).size !== draft.payers.length) throw new UserError("Each payer can only appear once.");

  const { owed, errors } = computeSplit(draft.amount, split);
  const payerErrors = validatePayers(draft.amount, draft.payers);
  if (errors.length || payerErrors.length) throw new UserError([...errors, ...payerErrors].join(" "));

  // Keep a row for every included member (even at 0) so inclusion survives a reload.
  return Object.fromEntries([...new Set(split.included)].map((id) => [id, owed[id] ?? 0]));
}

function inputValueFor(draft: ExpenseDraft, memberId: MemberId, owed: number): number | null {
  switch (draft.split.type) {
    case "exact":
      return owed;
    case "percent":
      return draft.split.percent?.[memberId] ?? 0;
    case "shares":
      return draft.split.shares?.[memberId] ?? 1;
    default:
      return null;
  }
}

/** Nested create payload for an expense with payers, splits and line items. */
export function expenseRowData(
  groupId: string,
  draft: ExpenseDraft,
  owed: Record<MemberId, number>,
  createdById: string,
): Prisma.ExpenseUncheckedCreateInput {
  return {
    groupId,
    description: draft.description.trim(),
    category: draft.category,
    amount: BigInt(draft.amount),
    currency: draft.currency,
    fxRate: draft.fxRate,
    splitType: draft.split.type.toUpperCase() as Prisma.ExpenseUncheckedCreateInput["splitType"],
    date: toDbDate(draft.date),
    createdById,
    payers: { create: draft.payers.filter((p) => p.amount !== 0).map((p) => ({ memberId: p.memberId, amount: BigInt(p.amount) })) },
    splits: {
      create: Object.entries(owed).map(([memberId, amount]) => ({
        memberId,
        owedAmount: BigInt(amount),
        inputValue: inputValueFor(draft, memberId, amount),
      })),
    },
    items:
      draft.split.type === "itemized"
        ? {
            create: (draft.split.items ?? []).map((item, position) => ({
              label: item.label.trim() || "Item",
              amount: BigInt(item.amount),
              position,
              assignees: { create: [...new Set(item.assignees)].filter((id) => id in owed).map((memberId) => ({ memberId })) },
            })),
          }
        : undefined,
  };
}

/** JSON-safe snapshot of an expense for the activity log diff. */
export function snapshot(draft: ExpenseDraft, owed: Record<MemberId, number>): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify({
    description: draft.description,
    amount: draft.amount,
    currency: draft.currency,
    category: draft.category,
    date: draft.date,
    payers: draft.payers,
    split: draft.split.type,
    owed,
  }));
}
