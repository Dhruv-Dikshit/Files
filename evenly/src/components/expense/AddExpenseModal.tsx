"use client";

import { useEffect, useState, useTransition } from "react";
import { convertMinor, COMMON_CURRENCIES } from "@/lib/domain/currency";
import { formatMoney } from "@/lib/domain/money";
import type { Expense, ExpenseCategory, SplitType } from "@/lib/domain/types";
import type { Frequency } from "@/lib/domain/recurring";
import type { Group } from "@/lib/types";
import { deleteExpense, getExchangeRate, saveExpense } from "@/server/actions";
import { Button, Input, Label, Modal, SectionLabel, Segmented, Tag, cx } from "@/components/ui/primitives";
import { ItemizedEditor } from "./ItemizedEditor";
import { MemberSplitList } from "./MemberSplitList";
import { PaidBySection } from "./PaidBySection";
import { useExpenseForm, type ExpenseForm } from "./useExpenseForm";
import { callAction } from "@/lib/call-action";

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

  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  // Validation messages appear as you type once an amount is entered, and
  // always after you press Add — the button never just sits there greyed out.
  const [attempted, setAttempted] = useState(false);

  function save() {
    setServerError(null);
    startTransition(async () => {
      const result = await callAction(() =>
        saveExpense({
          groupId: group.id,
          draft: form.toDraft(),
          expenseId: expense?.id,
          version: expense?.version,
          repeat: !expense && state.repeat.enabled ? { frequency: state.repeat.frequency, interval: state.repeat.interval } : undefined,
        }),
      );
      if (result.ok) onClose();
      else setServerError(result.error);
    });
  }

  function remove() {
    if (!expense || !confirm(`Delete “${expense.description}”? You can restore it from the activity feed.`)) return;
    startTransition(async () => {
      const result = await callAction(() => deleteExpense(group.id, expense.id));
      if (result.ok) onClose();
      else setServerError(result.error);
    });
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        setAttempted(true);
        if (form.isValid) save();
      }}
    >
      {/* ── 1. What & how much ─────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <Label htmlFor="desc">Description</Label>
          <Input id="desc" autoFocus placeholder="e.g. Dinner at Thalassa" value={state.description} onChange={(e) => dispatch({ type: "set", patch: { description: e.target.value } })} />
        </div>
        {/* Amount hero: large 28pt figure on a white card, like the kit's totals */}
        <div className="flex items-center gap-2 rounded-[20px] bg-surface px-4 py-3">
          <div className="min-w-0 flex-1">
            <label htmlFor="amount" className="block text-[11px] leading-4 text-muted">
              Amount
            </label>
            <input
              id="amount"
              inputMode="decimal"
              placeholder="0.00"
              className="w-full bg-transparent text-[28px] font-medium leading-10 tabular-nums text-ink outline-none placeholder:text-muted/60"
              value={state.amount}
              onChange={(e) => dispatch({ type: "set", patch: { amount: e.target.value } })}
            />
          </div>
          <div className="w-24 shrink-0">
            <label htmlFor="currency" className="sr-only">
              Currency
            </label>
            <select
              id="currency"
              value={state.currency}
              onChange={(e) => dispatch({ type: "setCurrency", currency: e.target.value, baseCurrency: group.baseCurrency })}
              className="w-full rounded-[12px] bg-hazy px-3 py-2 text-[14px] font-medium leading-6 text-ink outline-none focus:ring-2 focus:ring-accent"
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
            <Tag key={c.value} active={state.category === c.value} onClick={() => dispatch({ type: "set", patch: { category: c.value } })} className="py-1.5 text-[12px]">
              {c.icon} {c.label}
            </Tag>
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
        <SectionLabel>Paid by</SectionLabel>
        <PaidBySection form={form} />
      </section>

      {/* ── 3. Split between (include / exclude + split type) ─ */}
      <section className="space-y-3">
        <SectionLabel>Split between</SectionLabel>
        <Segmented ariaLabel="Split type" value={state.splitType} onChange={(splitType) => dispatch({ type: "set", patch: { splitType } })} options={SPLIT_TYPES} />
        <MemberSplitList form={form} />
        {state.splitType === "itemized" && <ItemizedEditor form={form} />}
        <SplitStatus form={form} />
      </section>

      {/* ── Footer ─────────────────────────────────────────── */}
      <div className="sticky bottom-0 -mx-5 -mb-4 space-y-2 bg-bg/95 px-5 py-3 backdrop-blur">
        {(serverError || ((attempted || form.total > 0) && form.errors.length > 0)) && (
          <div role="alert" className="rounded-[14px] bg-danger/10 px-3 py-2 text-[12px] leading-5 text-danger">
            {serverError ?? (
              <>
                {form.errors[0]}
                {form.errors.length > 1 && <span className="text-danger/70"> (+{form.errors.length - 1} more)</span>}
              </>
            )}
          </div>
        )}
        <div className="flex items-center gap-2">
          {expense && (
            <Button variant="danger" disabled={pending} onClick={remove}>
              Delete
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : expense ? "Save changes" : "Add expense"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function FxRow({ form, baseCurrency }: { form: ExpenseForm; baseCurrency: string }) {
  const { state, dispatch, total, fxRate } = form;
  const [status, setStatus] = useState<"loading" | "live" | "manual">("manual");
  const [rateDate, setRateDate] = useState<string | null>(null);
  const converted = fxRate > 0 ? convertMinor(total, state.currency, baseCurrency, fxRate) : 0;

  // Fetch the live ECB rate whenever the currency changes and no rate is set yet.
  const currency = state.currency;
  const needsRate = state.fxRate === "";
  useEffect(() => {
    if (!needsRate) return;
    let cancelled = false;
    setStatus("loading");
    getExchangeRate(currency, baseCurrency).then((result) => {
      if (cancelled) return;
      if (result.ok && result.data) {
        dispatch({ type: "setRate", currency, rate: String(result.data.rate) });
        setRateDate(result.data.date);
        setStatus("live");
      } else {
        setStatus("manual");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currency, baseCurrency, needsRate, dispatch]);

  return (
    <div className="rounded-[20px] bg-cloudy px-4 py-3 text-[12px] leading-5">
      <div className="flex items-center gap-2">
        <span className="text-muted">1 {state.currency} =</span>
        <input
          aria-label="Exchange rate"
          inputMode="decimal"
          placeholder={status === "loading" ? "…" : "rate"}
          value={state.fxRate}
          onChange={(e) => {
            setStatus("manual");
            dispatch({ type: "set", patch: { fxRate: e.target.value } });
          }}
          className="w-28 rounded-[10px] bg-surface px-2 py-1 text-right text-[14px] leading-6 tabular-nums outline-none focus:ring-2 focus:ring-accent"
        />
        <span className="text-muted">{baseCurrency}</span>
        <span className="ml-auto text-[14px] font-bold tabular-nums text-accent">≈ {formatMoney(converted, baseCurrency)}</span>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-muted">
        {status === "loading" && "Fetching today's rate…"}
        {status === "live" && `ECB reference rate${rateDate ? ` (${rateDate})` : ""} · edit to use your own`}
        {status === "manual" && (state.fxRate ? "Custom rate" : "No live rate available — enter the rate you paid")}
      </p>
    </div>
  );
}

function RepeatControl({ form }: { form: ExpenseForm }) {
  const { state, dispatch } = form;
  const set = (patch: Partial<typeof state.repeat>) => dispatch({ type: "set", patch: { repeat: { ...state.repeat, ...patch } } });
  return (
    <div className="flex items-center gap-2 pb-2">
      <label className="flex items-center gap-2 text-[12px] leading-5">
        <input type="checkbox" checked={state.repeat.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="h-4 w-4 accent-[#996bff]" />
        Repeat
      </label>
      {state.repeat.enabled && (
        <select
          aria-label="Repeat frequency"
          value={state.repeat.frequency}
          onChange={(e) => set({ frequency: e.target.value as Frequency })}
          className="rounded-[10px] bg-surface px-2 py-1 text-[12px] leading-5 outline-none ring-1 ring-line"
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
  return <p className={cx("text-right text-[11px] font-medium leading-5", ok ? "text-accent" : "text-danger")}>{message}</p>;
}
