"use client";

import { formatMoney } from "@/lib/domain/money";
import { Avatar, Segmented, cx } from "@/components/ui/primitives";
import type { ExpenseForm } from "./useExpenseForm";

/** Single payer (one tap) or multiple payers with amounts that must sum to the total. */
export function PaidBySection({ form }: { form: ExpenseForm }) {
  const { state, dispatch, members, payersRemaining, total } = form;

  return (
    <div className="space-y-3">
      <Segmented
        ariaLabel="Payer mode"
        value={state.payerMode}
        onChange={(payerMode) => dispatch({ type: "set", patch: { payerMode } })}
        options={[
          { value: "single", label: "One person" },
          { value: "multiple", label: "Multiple people" },
        ]}
      />

      {state.payerMode === "single" ? (
        <div className="flex flex-wrap gap-2">
          {members.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={state.payerId === m.id}
              onClick={() => dispatch({ type: "set", patch: { payerId: m.id } })}
              className={cx(
                "flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm ring-1 transition",
                state.payerId === m.id
                  ? "bg-emerald-50 font-semibold text-emerald-800 ring-emerald-500 dark:bg-emerald-950 dark:text-emerald-200"
                  : "ring-zinc-200 hover:bg-zinc-50 dark:ring-zinc-700 dark:hover:bg-zinc-800",
              )}
            >
              <Avatar member={m} size={24} />
              {m.name}
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {members.map((m) => (
            <label key={m.id} className="flex items-center gap-3">
              <Avatar member={m} size={28} />
              <span className="flex-1 text-sm">{m.name}</span>
              <span className="relative">
                <input
                  inputMode="decimal"
                  placeholder="0"
                  value={state.payerAmounts[m.id] ?? ""}
                  onChange={(e) => dispatch({ type: "setPerMember", field: "payerAmounts", memberId: m.id, value: e.target.value })}
                  className="w-32 rounded-lg border border-zinc-200 bg-white py-1.5 pl-2 pr-11 text-right text-sm tabular-nums outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-900"
                />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-400">{state.currency}</span>
              </span>
            </label>
          ))}
          {total > 0 && (
            <p className={cx("text-right text-xs", payersRemaining === 0 ? "text-emerald-600" : "text-orange-600")}>
              {payersRemaining === 0
                ? "✓ Payments match the total"
                : payersRemaining > 0
                  ? `${formatMoney(payersRemaining, state.currency)} left to cover`
                  : `${formatMoney(-payersRemaining, state.currency)} over the total`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
