"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { computeBalances } from "@/lib/domain/balances";
import { formatMoney } from "@/lib/domain/money";
import type { Expense } from "@/lib/domain/types";
import { switchIdentity, useGroup } from "@/lib/store/store";
import { AddExpenseModal } from "@/components/expense/AddExpenseModal";
import { ActivityFeed, BalancesPanel, ExpenseList, MembersPanel } from "@/components/group/GroupPanels";
import { Avatar, Button, Segmented } from "@/components/ui/primitives";

type Tab = "expenses" | "balances" | "activity" | "members";

/** Group view: header with your position, tabs, and the floating Add Expense button. */
export default function GroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { group, meId, expenses, settlements, activity } = useGroup(groupId);
  const [tab, setTab] = useState<Tab>("expenses");
  const [editor, setEditor] = useState<{ open: boolean; expense?: Expense }>({ open: false });

  const balances = useMemo(
    () => (group ? computeBalances(group.members.map((m) => m.id), expenses, settlements, group.baseCurrency) : {}),
    [group, expenses, settlements],
  );

  if (!group) {
    return (
      <div className="py-20 text-center">
        <p className="font-medium">Group not found</p>
        <Link href="/" className="text-sm text-emerald-600 underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const mine = balances[meId] ?? 0;

  return (
    <div className="space-y-5">
      <section className="rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-700 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-3xl">{group.emoji}</p>
            <h1 className="mt-1 text-2xl font-semibold">{group.name}</h1>
            <p className="text-sm text-emerald-100">
              {group.members.filter((m) => m.status === "active").length} people · base {group.baseCurrency} · code {group.inviteCode}
            </p>
          </div>
          {/* Demo stand-in for auth: view the group as any member. */}
          <label className="no-print text-right text-xs text-emerald-100">
            Viewing as
            <select
              value={meId}
              onChange={(e) => switchIdentity(group.id, e.target.value)}
              className="mt-1 block rounded-lg bg-white/15 px-2 py-1 text-sm text-white outline-none"
            >
              {group.members.map((m) => (
                <option key={m.id} value={m.id} className="text-zinc-900">
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-5 flex items-end justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-emerald-100">{mine === 0 ? "You're all settled" : mine > 0 ? "You get back" : "You owe"}</p>
            <p className="text-3xl font-bold tabular-nums">{formatMoney(Math.abs(mine), group.baseCurrency)}</p>
          </div>
          <Link href={`/groups/${group.id}/settle`} className="no-print rounded-xl bg-white px-4 py-2 text-sm font-semibold text-emerald-700 shadow hover:bg-emerald-50">
            Settle up →
          </Link>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {group.members
            .filter((m) => (balances[m.id] ?? 0) !== 0 && m.id !== meId)
            .map((m) => (
              <span key={m.id} className="flex items-center gap-1.5 rounded-full bg-white/15 py-0.5 pl-0.5 pr-2 text-xs">
                <Avatar member={m} size={18} />
                {m.name} {(balances[m.id] ?? 0) > 0 ? "gets" : "owes"} {formatMoney(Math.abs(balances[m.id]), group.baseCurrency)}
              </span>
            ))}
        </div>
      </section>

      <div className="no-print">
        <Segmented
          ariaLabel="Group sections"
          value={tab}
          onChange={setTab}
          options={[
            { value: "expenses", label: "Expenses" },
            { value: "balances", label: "Balances" },
            { value: "activity", label: "Activity" },
            { value: "members", label: "Members" },
          ]}
        />
      </div>

      {tab === "expenses" && (
        <ExpenseList group={group} meId={meId} expenses={expenses} settlements={settlements} onEdit={(expense) => setEditor({ open: true, expense })} />
      )}
      {tab === "balances" && <BalancesPanel group={group} expenses={expenses} settlements={settlements} />}
      {tab === "activity" && <ActivityFeed activity={activity} />}
      {tab === "members" && <MembersPanel group={group} meId={meId} />}

      <div className="no-print fixed inset-x-0 bottom-0 bg-gradient-to-t from-zinc-50 via-zinc-50/90 to-transparent pb-6 pt-10 dark:from-zinc-950 dark:via-zinc-950/90">
        <div className="mx-auto flex max-w-2xl justify-center px-4">
          <Button className="w-full max-w-sm py-3.5 text-base shadow-lg shadow-emerald-600/30" onClick={() => setEditor({ open: true })}>
            + Add expense
          </Button>
        </div>
      </div>

      <AddExpenseModal
        key={editor.expense?.id ?? "new"}
        group={group}
        meId={meId}
        open={editor.open}
        expense={editor.expense}
        onClose={() => setEditor({ open: false })}
      />
    </div>
  );
}
