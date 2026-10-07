"use client";

import { convertMinor, COMMON_CURRENCIES } from "@/lib/domain/currency";
import { formatMoney } from "@/lib/domain/money";
import type { Expense, ExpenseCategory, SplitType } from "@/lib/domain/types";
import type { Frequency } from "@/lib/domain/recurring";
import { addExpense, deleteExpense, updateExpense } from "@/lib/store/store";
import type { Group } from "@/lib/store/types";
import { Button, Input, Label, Modal, Segmented, cx } from "@/components/ui/primitives";
import { ItemizedEditor } from "./ItemizedEditor";
import { MemberSplitList } from "./MemberSplitList";
import { PaidBySection } from "./PaidBySection";
import { useExpenseForm, type ExpenseForm } from "./useExpenseForm";

export const CATEGORIES: { value: ExpenseCategory; label: string; icon: string }[] = [
  { value: "food", label: "Food", icon: "🍽️" },
  { value: "groceries", label: "Groceries", icon: "🛒" },
  { value: "transport", label: "Transport", icon: "🚕" },
  { value: "lodging", label: "Stay", icon: "🏨" },
  { value: "entertainment", label: "Fun", icon: "🎟️" },
  { value: "utilities", label: "Utilities", icon: "💡" },
  { value: "rent", label: "Rent", icon: "🏠" },
  { value: "shopping", label: "Shopping", icon: "🛍️" },
  { value: "other", label: "Other", icon: "📦" },
];

const SPLIT_TYPES: { value: SplitType; label: string; hint: string }[] = [
  { value: "equal", label: "Equally", hint: "Divide evenly among included people" },
  { value: "exact", label: "Exact", hint: "Enter an exact amount per person" },
  { value: "percent", label: "%", hint: "Split by percentage" },
  { value: "shares", label: "Shares", hint: "Split by ratio, e.g. 2:1" },
  { value: "itemized", label: "Items", hint: "Assign receipt line items" },
];

interface Props {
  group: Group;
  meId: string;
  open: boolean;
  onClose: () => void;
  /** Pass to edit an existing expense. */
  expense?: Expense;
}

/**
 * Mounts the form only while open so every open starts from fresh state
 * (or from the expense being edited).
 */
export function AddExpenseModal(props: Props) {
  return (
    <Modal open={props.open} onClose={props.onClose} title={props.expense ? "Edit expense" : "Add expense"}>
      {props.open && <AddExpenseForm {...props} />}
    </Modal>
  );
}

function AddExpenseForm({ group, meId, onClose, expense }: Props) {
  const form = useExpenseForm(group, meId, expense);
  const { state, dispatch } = form;

  function save() {
    const draft = form.toDraft();
    if (expense) {
      updateExpense(expense.id, draft);
    } else {
      addExpense(
        group.id,
        draft,
        state.repeat.enabled
          ? { rule: { frequency: state.repeat.frequency, interval: state.repeat.interval, startDate: draft.date } }
          : undefined,
      );
    }
    onClose();
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (form.isValid) save();
      }}
    >
      {/* ── 1. What & how much ─────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <Label htmlFor="desc">Description</Label>
          <Input id="desc" autoFocus placeholder="e.g. Dinner at Thalassa" value={state.description} onChange={(e) => dispatch({ type: "set", patch: { description: e.target.value } })} />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <Label htmlFor="amount">Amount</Label>
            <Input
              id="amount"
              inputMode="decimal"
              placeholder="0.00"
              className="text-lg font-semibold tabular-nums"
              value={state.amount}
              onChange={(e) => dispatch({ type: "set", patch: { amount: e.target.value } })}
            />
          </div>
          <div className="w-28">
            <Label htmlFor="currency">Currency</Label>
            <select
              id="currency"
              value={state.currency}
              onChange={(e) => dispatch({ type: "setCurrency", currency: e.target.value, baseCurrency: group.baseCurrency })}
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              {COMMON_CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        {form.needsFx && <FxRow form={form} baseCurrency={group.baseCurrency} />}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              aria-pressed={state.category === c.value}
              onClick={() => dispatch({ type: "set", patch: { category: c.value } })}
              className={cx(
                "shrink-0 rounded-full px-3 py-1.5 text-xs ring-1 transition",
                state.category === c.value ? "bg-zinc-900 text-white ring-zinc-900 dark:bg-white dark:text-zinc-900" : "ring-zinc-200 dark:ring-zinc-700",
              )}
            >
              {c.icon} {c.label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Label htmlFor="date">Date</Label>
            <Input id="date" type="date" value={state.date} onChange={(e) => dispatch({ type: "set", patch: { date: e.target.value } })} />
          </div>
          {!expense && <RepeatControl form={form} />}
        </div>
      </section>

      {/* ── 2. Paid by ─────────────────────────────────────── */}
      <section>
        <Label>Paid by</Label>
        <PaidBySection form={form} />
      </section>

      {/* ── 3. Split between (include / exclude + split type) ─ */}
      <section className="space-y-3">
        <Label>Split</Label>
        <Segmented ariaLabel="Split type" value={state.splitType} onChange={(splitType) => dispatch({ type: "set", patch: { splitType } })} options={SPLIT_TYPES} />
        <MemberSplitList form={form} />
        {state.splitType === "itemized" && <ItemizedEditor form={form} />}
        <SplitStatus form={form} />
      </section>

      {/* ── Footer ─────────────────────────────────────────── */}
      <div className="sticky bottom-0 -mx-5 -mb-4 flex items-center gap-2 border-t border-zinc-100 bg-white/95 px-5 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        {expense && (
          <Button
            variant="danger"
            onClick={() => {
              if (confirm(`Delete “${expense.description}”? This is recorded in the activity feed.`)) {
                deleteExpense(expense.id);
                onClose();
              }
            }}
          >
            Delete
          </Button>
        )}
        <p className="flex-1 truncate text-xs text-orange-600" role="status">
          {form.total > 0 && form.errors[0]}
        </p>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!form.isValid}>
          {expense ? "Save changes" : "Add expense"}
        </Button>
      </div>
    </form>
  );
}

function FxRow({ form, baseCurrency }: { form: ExpenseForm; baseCurrency: string }) {
  const { state, dispatch, total, fxRate } = form;
  const converted = fxRate > 0 ? convertMinor(total, state.currency, baseCurrency, fxRate) : 0;
  return (
    <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/50">
      <span className="text-zinc-600 dark:text-zinc-300">1 {state.currency} =</span>
      <input
        aria-label="Exchange rate"
        inputMode="decimal"
        value={state.fxRate}
        onChange={(e) => dispatch({ type: "set", patch: { fxRate: e.target.value } })}
        className="w-24 rounded-lg border border-amber-200 bg-white px-2 py-1 text-right tabular-nums outline-none dark:border-amber-900 dark:bg-zinc-900"
      />
      <span className="text-zinc-600 dark:text-zinc-300">{baseCurrency}</span>
      <span className="ml-auto font-medium tabular-nums">≈ {formatMoney(converted, baseCurrency)}</span>
    </div>
  );
}

function RepeatControl({ form }: { form: ExpenseForm }) {
  const { state, dispatch } = form;
  const set = (patch: Partial<typeof state.repeat>) => dispatch({ type: "set", patch: { repeat: { ...state.repeat, ...patch } } });
  return (
    <div className="flex items-center gap-2 pb-2">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={state.repeat.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="h-4 w-4 accent-emerald-600" />
        Repeat
      </label>
      {state.repeat.enabled && (
        <select
          aria-label="Repeat frequency"
          value={state.repeat.frequency}
          onChange={(e) => set({ frequency: e.target.value as Frequency })}
          className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      )}
    </div>
  );
}

/** Live "₹120 left to assign / 20% left / ✓ adds up" feedback. */
function SplitStatus({ form }: { form: ExpenseForm }) {
  const { state, split, total } = form;
  if (total <= 0 || state.splitType === "itemized") return null;
  const ok = split.errors.length === 0;
  let message = "✓ Split adds up";
  if (!ok) {
    if (state.splitType === "exact" && split.remaining !== 0) {
      message = split.remaining > 0 ? `${formatMoney(split.remaining, state.currency)} left to assign` : `${formatMoney(-split.remaining, state.currency)} over the total`;
    } else {
      message = split.errors[0];
    }
  } else if (state.splitType === "equal" && state.included.length > 0) {
    message = `✓ ${formatMoney(Math.floor(total / state.included.length), state.currency)} each for ${state.included.length} ${state.included.length === 1 ? "person" : "people"}`;
  }
  return <p className={cx("text-right text-xs font-medium", ok ? "text-emerald-600" : "text-orange-600")}>{message}</p>;
}
