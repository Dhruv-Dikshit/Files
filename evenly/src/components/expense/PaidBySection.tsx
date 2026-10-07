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
                "flex items-center gap-2 rounded-[30px] py-1 pl-1 pr-3 text-[12px] leading-5 transition",
                state.payerId === m.id ? "bg-accent font-medium text-white" : "bg-surface text-ink hover:bg-cloudy",
              )}
            >
              <Avatar member={m} size={28} />
              {m.name}
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {members.map((m) => (
            <label key={m.id} className="flex items-center gap-3 rounded-[20px] bg-surface px-3 py-2">
              <Avatar member={m} size={32} />
              <span className="flex-1 text-[14px] font-medium leading-6">{m.name}</span>
              <span className="relative">
                <input
                  inputMode="decimal"
                  placeholder="0"
                  value={state.payerAmounts[m.id] ?? ""}
                  onChange={(e) => dispatch({ type: "setPerMember", field: "payerAmounts", memberId: m.id, value: e.target.value })}
                  className="w-32 rounded-[10px] bg-hazy py-1 pl-2 pr-11 text-right text-[14px] leading-6 tabular-nums outline-none focus:ring-2 focus:ring-accent"
                />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted">{state.currency}</span>
              </span>
            </label>
          ))}
          {total > 0 && (
            <p className={cx("text-right text-[11px] font-medium leading-5", payersRemaining === 0 ? "text-accent" : "text-danger")}>
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
