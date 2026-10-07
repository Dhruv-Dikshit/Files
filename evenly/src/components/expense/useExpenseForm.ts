"use client";

import { useMemo, useReducer } from "react";
import { staticRate } from "@/lib/domain/currency";
import { currencyDecimals, minorToInput, parseMoney, sum } from "@/lib/domain/money";
import type { Frequency } from "@/lib/domain/recurring";
import type { ScannedReceipt } from "@/lib/domain/receipts";
import { computeSplit, validatePayers } from "@/lib/domain/splits";
import type { Expense, ExpenseCategory, LineItem, Member, MemberId, Minor, Payer, SplitConfig, SplitType } from "@/lib/domain/types";
import { today, uid } from "@/lib/store/ids";
import type { ExpenseDraft, Group } from "@/lib/store/types";

/**
 * All form inputs are kept as *strings* (exactly what the user typed) and
 * converted to integer minor units in one derived step. That keeps inputs
 * editable ("12." mid-typing) while every calculation stays exact.
 */
export interface ItemDraft {
  id: string;
  label: string;
  amount: string;
  assignees: MemberId[];
}

export interface ExpenseFormState {
  description: string;
  category: ExpenseCategory;
  amount: string;
  currency: string;
  fxRate: string;
  date: string;
  payerMode: "single" | "multiple";
  payerId: MemberId;
  payerAmounts: Record<MemberId, string>;
  splitType: SplitType;
  /** The include/exclude toggles. Ordered like the group's member list. */
  included: MemberId[];
  exact: Record<MemberId, string>;
  percent: Record<MemberId, string>;
  shares: Record<MemberId, string>;
  items: ItemDraft[];
  repeat: { enabled: boolean; frequency: Frequency; interval: number };
}

type PerMemberField = "exact" | "percent" | "shares" | "payerAmounts";

export type ExpenseFormAction =
  | { type: "set"; patch: Partial<ExpenseFormState> }
  | { type: "setCurrency"; currency: string; baseCurrency: string }
  | { type: "toggleMember"; memberId: MemberId; order: MemberId[] }
  | { type: "setAllIncluded"; included: MemberId[] }
  | { type: "setPerMember"; field: PerMemberField; memberId: MemberId; value: string }
  | { type: "fillRemaining"; field: "exact" | "percent"; memberId: MemberId; total: Minor }
  | { type: "addItem" }
  | { type: "updateItem"; id: string; patch: Partial<Omit<ItemDraft, "id">> }
  | { type: "removeItem"; id: string }
  | { type: "toggleItemAssignee"; id: string; memberId: MemberId }
  | { type: "loadReceipt"; receipt: ScannedReceipt; included: MemberId[] };

function reducer(state: ExpenseFormState, action: ExpenseFormAction): ExpenseFormState {
  switch (action.type) {
    case "set":
      return { ...state, ...action.patch };

    case "setCurrency":
      return {
        ...state,
        currency: action.currency,
        // Pre-fill a suggested rate; the user can override it (custom rate).
        fxRate: String(staticRate(action.currency, action.baseCurrency)),
      };

    case "toggleMember": {
      const isIncluded = state.included.includes(action.memberId);
      const next = isIncluded
        ? state.included.filter((id) => id !== action.memberId)
        : action.order.filter((id) => id === action.memberId || state.included.includes(id));
      return { ...state, included: next };
    }

    case "setAllIncluded":
      return { ...state, included: action.included };

    case "setPerMember":
      return { ...state, [action.field]: { ...state[action.field], [action.memberId]: action.value } };

    case "fillRemaining": {
      // "Give the rest to this person" — the fastest way to finish an exact/percent split.
      const others = state.included.filter((id) => id !== action.memberId);
      if (action.field === "exact") {
        const assigned = sum(others.map((id) => parseMoney(state.exact[id] ?? "", state.currency) ?? 0));
        const rest = Math.max(0, action.total - assigned);
        return { ...state, exact: { ...state.exact, [action.memberId]: minorToInput(rest, state.currency) } };
      }
      const assigned = sum(others.map((id) => Number(state.percent[id]) || 0));
      const rest = Math.max(0, Math.round((100 - assigned) * 100) / 100);
      return { ...state, percent: { ...state.percent, [action.memberId]: String(rest) } };
    }

    case "addItem":
      return { ...state, items: [...state.items, { id: uid("i"), label: "", amount: "", assignees: [...state.included] }] };

    case "updateItem":
      return { ...state, items: state.items.map((i) => (i.id === action.id ? { ...i, ...action.patch } : i)) };

    case "removeItem":
      return { ...state, items: state.items.filter((i) => i.id !== action.id) };

    case "toggleItemAssignee":
      return {
        ...state,
        items: state.items.map((i) =>
          i.id !== action.id
            ? i
            : {
                ...i,
                assignees: i.assignees.includes(action.memberId)
                  ? i.assignees.filter((m) => m !== action.memberId)
                  : [...i.assignees, action.memberId],
              },
        ),
      };

    case "loadReceipt": {
      const { receipt } = action;
      const currency = receipt.currency ?? state.currency;
      return {
        ...state,
        description: state.description || receipt.merchant || "Receipt",
        currency,
        amount: minorToInput(receipt.total, currency),
        splitType: "itemized",
        // Line items start unassigned-to-nobody: everyone included shares each
        // item until the user taps names off. Extras (tax/tip) are not items —
        // they're the leftover distributed proportionally.
        items: receipt.items.map((it) => ({
          id: uid("i"),
          label: it.label,
          amount: minorToInput(it.amount, currency),
          assignees: [...action.included],
        })),
      };
    }
  }
}

export function selectableMembers(group: Group, expense?: Expense): Member[] {
  // Inactive members are hidden from new expenses but stay visible when
  // editing an expense they were already part of.
  const involved = new Set(expense ? [...Object.keys(expense.owed), ...expense.payers.map((p) => p.memberId)] : []);
  return group.members.filter((m) => m.status === "active" || involved.has(m.id));
}

export function initialFormState(group: Group, meId: MemberId, expense?: Expense): ExpenseFormState {
  const active = selectableMembers(group, expense).map((m) => m.id);
  if (!expense) {
    return {
      description: "",
      category: "food",
      amount: "",
      currency: group.baseCurrency,
      fxRate: "1",
      date: today(),
      payerMode: "single",
      payerId: meId,
      payerAmounts: {},
      splitType: "equal",
      included: active,
      exact: {},
      percent: {},
      shares: {},
      items: [],
      repeat: { enabled: false, frequency: "monthly", interval: 1 },
    };
  }
  const c = expense.currency;
  const mapInputs = (rec: Record<string, number> | undefined, money: boolean) =>
    Object.fromEntries(Object.entries(rec ?? {}).map(([id, v]) => [id, money ? minorToInput(v, c) : String(v)]));
  return {
    description: expense.description,
    category: expense.category,
    amount: minorToInput(expense.amount, c),
    currency: c,
    fxRate: String(expense.fxRate),
    date: expense.date,
    payerMode: expense.payers.length > 1 ? "multiple" : "single",
    payerId: expense.payers[0]?.memberId ?? meId,
    payerAmounts: Object.fromEntries(expense.payers.map((p) => [p.memberId, minorToInput(p.amount, c)])),
    splitType: expense.split.type,
    included: active.filter((id) => expense.split.included.includes(id)),
    exact: mapInputs(expense.split.exact, true),
    percent: mapInputs(expense.split.percent, false),
    shares: mapInputs(expense.split.shares, false),
    items: (expense.split.items ?? []).map((i) => ({ id: i.id, label: i.label, amount: minorToInput(i.amount, c), assignees: i.assignees })),
    repeat: { enabled: false, frequency: "monthly", interval: 1 },
  };
}

/**
 * Add/Edit Expense form logic: state + every derived number the UI shows
 * (per-person share preview, remaining-to-assign, validation), plus a
 * `toDraft()` that produces a ready-to-save expense.
 */
export function useExpenseForm(group: Group, meId: MemberId, expense?: Expense) {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialFormState(group, meId, expense));
  const members = useMemo(() => selectableMembers(group, expense), [group, expense]);

  const derived = useMemo(() => {
    const { currency } = state;
    const total = parseMoney(state.amount, currency) ?? 0;
    const money = (v: string | undefined) => parseMoney(v ?? "", currency) ?? 0;
    const num = (v: string | undefined, fallback: number) => (v === undefined || v.trim() === "" ? fallback : Number(v));

    const items: LineItem[] = state.items.map((i) => ({ id: i.id, label: i.label, amount: money(i.amount), assignees: i.assignees }));
    const config: SplitConfig = {
      type: state.splitType,
      included: state.included,
      ...(state.splitType === "exact" && { exact: Object.fromEntries(state.included.map((id) => [id, money(state.exact[id])])) }),
      ...(state.splitType === "percent" && { percent: Object.fromEntries(state.included.map((id) => [id, num(state.percent[id], 0)])) }),
      ...(state.splitType === "shares" && { shares: Object.fromEntries(state.included.map((id) => [id, num(state.shares[id], 1)])) }),
      ...(state.splitType === "itemized" && { items }),
    };
    const split = computeSplit(total, config);

    const payers: Payer[] =
      state.payerMode === "single"
        ? [{ memberId: state.payerId, amount: total }]
        : members.map((m) => ({ memberId: m.id, amount: money(state.payerAmounts[m.id]) })).filter((p) => p.amount !== 0);
    const payerErrors = total > 0 ? validatePayers(total, payers) : [];
    const payersRemaining = total - sum(payers.map((p) => p.amount));

    const fxRate = Number(state.fxRate);
    const needsFx = currency !== group.baseCurrency;
    const fxError = needsFx && !(fxRate > 0) ? "Enter a valid exchange rate." : null;
    const itemsTotal = sum(items.map((i) => i.amount));

    const errors = [
      !state.description.trim() && "Add a description.",
      ...split.errors,
      ...payerErrors,
      fxError,
    ].filter((e): e is string => Boolean(e));

    return {
      total,
      split,
      payers,
      payerErrors,
      payersRemaining,
      fxRate: needsFx ? fxRate : 1,
      needsFx,
      itemsTotal,
      /** Tax/tip/service that itemized mode distributes proportionally. */
      itemsExtra: total - itemsTotal,
      decimals: currencyDecimals(currency),
      errors,
      isValid: errors.length === 0,
      config,
    };
  }, [state, members, group.baseCurrency]);

  function toDraft(): ExpenseDraft {
    if (!derived.isValid) throw new Error(derived.errors.join(" "));
    return {
      description: state.description.trim(),
      category: state.category,
      amount: derived.total,
      currency: state.currency,
      fxRate: derived.fxRate,
      payers: derived.payers,
      split: derived.config,
      owed: derived.split.owed,
      date: state.date,
    };
  }

  return { state, dispatch, members, ...derived, toDraft };
}

export type ExpenseForm = ReturnType<typeof useExpenseForm>;
