"use client";

import { formatMoney } from "@/lib/domain/money";
import { Avatar, cx } from "@/components/ui/primitives";
import type { ExpenseForm } from "./useExpenseForm";

/**
 * The heart of the Add Expense form: one row per member that is BOTH the
 * include/exclude toggle and the per-person input for the active split
 * type. Tapping the avatar/name excludes someone (row greys out, share → 0)
 * and the remaining shares recalculate instantly.
 */
export function MemberSplitList({ form }: { form: ExpenseForm }) {
  const { state, dispatch, members, split, total } = form;
  const order = members.map((m) => m.id);
  const allIncluded = state.included.length === members.length;
  const showInputs = state.splitType !== "equal" && state.splitType !== "itemized";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-zinc-500">
          {state.included.length} of {members.length} included · tap a name to exclude
        </p>
        <button
          type="button"
          className="text-xs font-medium text-emerald-600 hover:underline"
          onClick={() => dispatch({ type: "setAllIncluded", included: allIncluded ? [] : order })}
        >
          {allIncluded ? "Clear all" : "Select all"}
        </button>
      </div>

      <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl ring-1 ring-zinc-200 dark:divide-zinc-800 dark:ring-zinc-800">
        {members.map((m) => {
          const included = state.included.includes(m.id);
          const owed = split.owed[m.id];
          return (
            <li key={m.id} className={cx("flex items-center gap-3 px-3 py-2.5 transition", !included && "bg-zinc-50 dark:bg-zinc-950")}>
              <button
                type="button"
                role="switch"
                aria-checked={included}
                aria-label={`${included ? "Exclude" : "Include"} ${m.name}`}
                onClick={() => dispatch({ type: "toggleMember", memberId: m.id, order })}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span className="relative">
                  <Avatar member={m} dimmed={!included} />
                  <span
                    className={cx(
                      "absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[10px] text-white ring-2 ring-white dark:ring-zinc-900",
                      included ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600",
                    )}
                  >
                    {included ? "✓" : ""}
                  </span>
                </span>
                <span className="min-w-0">
                  <span className={cx("block truncate text-sm font-medium", !included && "text-zinc-400 line-through")}>
                    {m.name}
                  </span>
                  <span className="block text-xs text-zinc-500">{included ? "Included" : "Not part of this expense"}</span>
                </span>
              </button>

              {included && showInputs && <PerMemberInput form={form} memberId={m.id} />}

              <span className="w-24 text-right text-sm tabular-nums">
                {included && owed !== undefined ? (
                  <span className="font-semibold">{formatMoney(owed, state.currency)}</span>
                ) : (
                  <span className="text-zinc-400">{included && total > 0 ? "—" : formatMoney(0, state.currency)}</span>
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
  const suffix = type === "percent" ? "%" : type === "shares" ? "×" : state.currency;
  const placeholder = type === "shares" ? "1" : "0";

  return (
    <div className="flex items-center gap-1">
      {type !== "shares" && (
        <button
          type="button"
          title="Give the remaining amount to this person"
          onClick={() => dispatch({ type: "fillRemaining", field: type, memberId, total })}
          className="rounded-md px-1.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950"
        >
          rest
        </button>
      )}
      {type === "shares" && (
        <button
          type="button"
          aria-label="Decrease shares"
          onClick={() => dispatch({ type: "setPerMember", field: "shares", memberId, value: String(Math.max(0, (Number(value || 1) || 0) - 1)) })}
          className="h-7 w-7 rounded-lg bg-zinc-100 text-sm dark:bg-zinc-800"
        >
          −
        </button>
      )}
      <label className="relative">
        <span className="sr-only">{type} for member</span>
        <input
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          onChange={(e) => dispatch({ type: "setPerMember", field: type, memberId, value: e.target.value })}
          className={cx(
            "rounded-lg border border-zinc-200 bg-white py-1.5 pl-2 text-right text-sm tabular-nums outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-900",
            type === "exact" ? "w-24 pr-11" : "w-16 pr-6",
          )}
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-400">{suffix}</span>
      </label>
      {type === "shares" && (
        <button
          type="button"
          aria-label="Increase shares"
          onClick={() => dispatch({ type: "setPerMember", field: "shares", memberId, value: String((Number(value || 1) || 0) + 1) })}
          className="h-7 w-7 rounded-lg bg-zinc-100 text-sm dark:bg-zinc-800"
        >
          +
        </button>
      )}
    </div>
  );
}
