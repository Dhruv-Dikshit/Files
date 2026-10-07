"use client";

import { formatMoney } from "@/lib/domain/money";
import { Avatar, Counter, RadioMark, cx } from "@/components/ui/primitives";
import type { ExpenseForm } from "./useExpenseForm";

/**
 * The heart of the Add Expense form: one row per member (the kit's "List"
 * row) that is BOTH the include/exclude toggle — the purple check radio —
 * and the per-person input for the active split type. Tapping a row
 * excludes someone (row greys out, share → 0) and the remaining shares
 * recalculate instantly.
 */
export function MemberSplitList({ form }: { form: ExpenseForm }) {
  const { state, dispatch, members, split, total } = form;
  const order = members.map((m) => m.id);
  const allIncluded = state.included.length === members.length;
  const showInputs = state.splitType !== "equal" && state.splitType !== "itemized";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] leading-5 text-muted">
          {state.included.length} of {members.length} included · tap a person to exclude
        </p>
        <button
          type="button"
          className="text-[11px] font-medium leading-5 text-accent hover:underline"
          onClick={() => dispatch({ type: "setAllIncluded", included: allIncluded ? [] : order })}
        >
          {allIncluded ? "Clear all" : "Select all"}
        </button>
      </div>

      <ul className="space-y-2">
        {members.map((m) => {
          const included = state.included.includes(m.id);
          const owed = split.owed[m.id];
          return (
            <li key={m.id} className={cx("flex items-center gap-3 rounded-[20px] bg-surface px-3 py-2.5 transition", !included && "opacity-60")}>
              <button
                type="button"
                role="switch"
                aria-checked={included}
                aria-label={`${included ? "Exclude" : "Include"} ${m.name}`}
                onClick={() => dispatch({ type: "toggleMember", memberId: m.id, order })}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <RadioMark checked={included} />
                <Avatar member={m} size={36} dimmed={!included} />
                <span className="min-w-0">
                  <span className={cx("block truncate text-[14px] font-medium leading-6", !included && "text-muted line-through")}>{m.name}</span>
                  <span className="block text-[11px] leading-4 text-muted">{included ? "Included" : "Not part of this expense"}</span>
                </span>
              </button>

              {included && showInputs && <PerMemberInput form={form} memberId={m.id} />}

              <span className="w-[84px] shrink-0 text-right text-[14px] leading-6 tabular-nums">
                {included && owed !== undefined ? (
                  <span className="font-bold">{formatMoney(owed, state.currency)}</span>
                ) : (
                  <span className="text-muted">{included && total > 0 ? "—" : formatMoney(0, state.currency)}</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PerMemberInput({ form, memberId }: { form: ExpenseForm; memberId: string }) {
  const { state, dispatch, total } = form;
  const type = state.splitType as "exact" | "percent" | "shares";
  const value = state[type][memberId] ?? "";

  if (type === "shares") {
    const shares = value === "" ? 1 : Math.max(0, Math.round(Number(value) || 0));
    return (
      <Counter label="shares" value={shares} onChange={(v) => dispatch({ type: "setPerMember", field: "shares", memberId, value: String(v) })} />
    );
  }

  const suffix = type === "percent" ? "%" : state.currency;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        title="Give the remaining amount to this person"
        onClick={() => dispatch({ type: "fillRemaining", field: type, memberId, total })}
        className="rounded-[8px] px-1.5 py-0.5 text-[11px] leading-5 text-accent hover:bg-cloudy"
      >
        rest
      </button>
      <label className="relative">
        <span className="sr-only">{type} for member</span>
        <input
          inputMode="decimal"
          value={value}
          placeholder="0"
          onChange={(e) => dispatch({ type: "setPerMember", field: type, memberId, value: e.target.value })}
          className={cx(
            "rounded-[10px] bg-hazy py-1 pl-2 text-right text-[14px] leading-6 tabular-nums text-ink outline-none focus:ring-2 focus:ring-accent",
            type === "exact" ? "w-24 pr-11" : "w-16 pr-6",
          )}
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted">{suffix}</span>
      </label>
    </div>
  );
}
