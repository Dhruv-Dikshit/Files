"use client";

import { useMemo, useState } from "react";
import { computeBalances } from "@/lib/domain/balances";
import { formatMoney } from "@/lib/domain/money";
import type { Expense } from "@/lib/domain/types";
import type { GroupView } from "@/lib/types";
import { AddExpenseModal } from "@/components/expense/AddExpenseModal";
import { ActivityFeed, BalancesPanel, ExpenseList, MembersPanel } from "@/components/group/GroupPanels";
import { Avatar, Button, ButtonLink, Icon, IconTile, NavBar, TabBar, cx } from "@/components/ui/primitives";

type Tab = "expenses" | "balances" | "activity" | "members";

/** Group view: header with your position, tabs, and the floating Add Expense button. */
export function GroupClient({ view }: { view: GroupView }) {
  const { group, meId, expenses, settlements, activity, recurring, removableIds } = view;
  const [tab, setTab] = useState<Tab>("expenses");
  const [editor, setEditor] = useState<{ open: boolean; expense?: Expense }>({ open: false });

  const balances = useMemo(
    () => computeBalances(group.members.map((m) => m.id), expenses, settlements, group.baseCurrency),
    [group, expenses, settlements],
  );
  const liveExpenseIds = useMemo(() => new Set(expenses.map((e) => e.id)), [expenses]);

  const mine = balances[meId] ?? 0;

  return (
    <div className="space-y-5">
      <div className="no-print">
        <NavBar
          title={group.name}
          backHref="/"
          action={
            <button type="button" aria-label="Invite people" onClick={() => setTab("members")} className="p-1 text-muted hover:text-ink">
              <Icon name="add-friend" />
            </button>
          }
        />
      </div>

      <section className="rounded-[28px] bg-hero p-5 text-white">
        <div className="flex items-center gap-4">
          <IconTile size={52} tone={2} className="text-[24px]">
            {group.emoji}
          </IconTile>
          <div className="min-w-0">
            <p className="truncate text-[17px] font-bold leading-6">{group.name}</p>
            <p className="text-[11px] leading-5 text-muted">
              {group.members.filter((m) => m.status === "active").length} persons · {group.baseCurrency} · code {group.inviteCode}
            </p>
          </div>
        </div>
        <div className="mt-5 flex items-end justify-between gap-3">
          <div>
            <p className="text-[12px] leading-5 text-muted">{mine === 0 ? "You're all settled" : mine > 0 ? "You get back" : "You owe"}</p>
            <p className={cx("text-[28px] font-medium leading-10 tabular-nums", mine > 0 && "text-action")}>{formatMoney(Math.abs(mine), group.baseCurrency)}</p>
          </div>
          <ButtonLink href={`/groups/${group.id}/settle`} variant="action" className="no-print px-5">
            Settle up
          </ButtonLink>
        </div>
        {group.members.some((m) => (balances[m.id] ?? 0) !== 0 && m.id !== meId) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {group.members
              .filter((m) => (balances[m.id] ?? 0) !== 0 && m.id !== meId)
              .map((m) => (
                <span key={m.id} className="flex items-center gap-1.5 rounded-[30px] bg-white/[0.08] py-1 pl-1 pr-3 text-[11px] leading-4">
                  <Avatar member={m} size={20} />
                  {m.name} {(balances[m.id] ?? 0) > 0 ? "gets" : "owes"} {formatMoney(Math.abs(balances[m.id]), group.baseCurrency)}
                </span>
              ))}
          </div>
        )}
      </section>

      <div className="no-print sticky top-[60px] z-[5]">
        <TabBar
          ariaLabel="Group sections"
          value={tab}
          onChange={setTab}
          items={[
            { value: "expenses", label: "Expenses", icon: "bill" },
            { value: "balances", label: "Balances", icon: "home" },
            { value: "activity", label: "Activity", icon: "notification" },
            { value: "members", label: "Members", icon: "account" },
          ]}
        />
      </div>

      {tab === "expenses" && (
        <ExpenseList group={group} meId={meId} expenses={expenses} settlements={settlements} onEdit={(expense) => setEditor({ open: true, expense })} />
      )}
      {tab === "balances" && <BalancesPanel group={group} meId={meId} expenses={expenses} settlements={settlements} />}
      {tab === "activity" && <ActivityFeed activity={activity} groupId={group.id} liveExpenseIds={liveExpenseIds} />}
      {tab === "members" && <MembersPanel group={group} meId={meId} removableIds={removableIds} recurring={recurring} />}

      <div className="no-print pointer-events-none fixed inset-x-0 bottom-0 bg-gradient-to-t from-bg via-bg/90 to-transparent pb-6 pt-10">
        <div className="pointer-events-auto mx-auto flex max-w-2xl justify-center px-4">
          <Button className="w-full max-w-[350px]" onClick={() => setEditor({ open: true })}>
            + Add expense
          </Button>
        </div>
      </div>

      <AddExpenseModal
        key={editor.expense ? `${editor.expense.id}:${editor.expense.version}` : "new"}
        group={group}
        meId={meId}
        open={editor.open}
        expense={editor.expense}
        onClose={() => setEditor({ open: false })}
      />
    </div>
  );
}
