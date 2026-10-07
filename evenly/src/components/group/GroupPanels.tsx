"use client";

import { useMemo, useState } from "react";
import { summarizeMembers } from "@/lib/domain/balances";
import { exportGroupCSV } from "@/lib/domain/export";
import { formatMoney } from "@/lib/domain/money";
import type { Expense, Settlement } from "@/lib/domain/types";
import { addMember, canRemoveMember, deleteSettlement, removeMember, setMemberStatus, stopRecurring, useAppState } from "@/lib/store/store";
import type { ActivityEvent, Group } from "@/lib/store/types";
import { CATEGORIES } from "@/components/expense/AddExpenseModal";
import { Amount, Avatar, Button, Card, Input, cx } from "@/components/ui/primitives";

const PERIOD = { daily: "day", weekly: "week", monthly: "month", yearly: "year" } as const;
const nameOf = (group: Group, id: string) => group.members.find((m) => m.id === id)?.name ?? "Unknown";

export function ExpenseList({ group, meId, expenses, settlements, onEdit }: { group: Group; meId: string; expenses: Expense[]; settlements: Settlement[]; onEdit: (e: Expense) => void }) {
  type Row = { kind: "expense"; date: string; at: string; e: Expense } | { kind: "settlement"; date: string; at: string; s: Settlement };
  const rows: Row[] = [
    ...expenses.map((e) => ({ kind: "expense" as const, date: e.date, at: e.createdAt, e })),
    ...settlements.map((s) => ({ kind: "settlement" as const, date: s.date, at: s.date, s })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at));

  if (rows.length === 0) {
    return (
      <Card className="py-12 text-center">
        <p className="text-3xl">🧾</p>
        <p className="mt-2 font-medium">No expenses yet</p>
        <p className="text-sm text-zinc-500">Add the first one with the button below.</p>
      </Card>
    );
  }

  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        if (row.kind === "settlement") {
          const s = row.s;
          return (
            <li key={s.id} className="flex items-center gap-3 rounded-2xl bg-emerald-50/60 px-4 py-3 text-sm dark:bg-emerald-950/30">
              <span className="text-xl">💸</span>
              <span className="flex-1">
                <b>{nameOf(group, s.fromId)}</b> paid <b>{nameOf(group, s.toId)}</b>
                <span className="block text-xs text-zinc-500">{s.date} · settlement{s.note ? ` · ${s.note}` : ""}</span>
              </span>
              <span className="font-semibold tabular-nums">{formatMoney(s.amount, s.currency)}</span>
              <button type="button" className="text-xs text-zinc-400 hover:text-red-500" onClick={() => confirm("Undo this payment?") && deleteSettlement(s.id)}>
                undo
              </button>
            </li>
          );
        }
        const e = row.e;
        const paid = e.payers.find((p) => p.memberId === meId)?.amount ?? 0;
        const mine = paid - (e.owed[meId] ?? 0);
        const payerLabel = e.payers.length > 1 ? `${e.payers.length} people` : nameOf(group, e.payers[0]?.memberId);
        const excluded = group.members.filter((m) => !(m.id in e.owed)).length;
        return (
          <li key={e.id}>
            <button type="button" onClick={() => onEdit(e)} className="flex w-full items-center gap-3 rounded-2xl bg-white px-4 py-3 text-left ring-1 ring-zinc-200/70 transition hover:ring-emerald-400 dark:bg-zinc-900 dark:ring-zinc-800">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-lg dark:bg-zinc-800">{CATEGORIES.find((c) => c.value === e.category)?.icon ?? "📦"}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {e.description}
                  {e.recurringId && <span className="ml-1.5 text-xs text-zinc-400" title="Recurring">↻</span>}
                </span>
                <span className="block text-xs text-zinc-500">
                  {e.date} · {payerLabel} paid {formatMoney(e.amount, e.currency)} · {e.split.type}
                  {excluded > 0 && ` · ${excluded} excluded`}
                </span>
              </span>
              <span className="text-right text-xs">
                {mine === 0 ? (
                  <span className="text-zinc-400">not involved</span>
                ) : (
                  <>
                    <span className="block text-zinc-500">{mine > 0 ? "you lent" : "you borrowed"}</span>
                    <Amount value={mine}>{formatMoney(Math.abs(mine), e.currency)}</Amount>
                  </>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function BalancesPanel({ group, expenses, settlements }: { group: Group; expenses: Expense[]; settlements: Settlement[] }) {
  const summary = useMemo(
    () => summarizeMembers(group.members.map((m) => m.id), expenses, settlements, group.baseCurrency),
    [group, expenses, settlements],
  );
  const totalSpent = summary.reduce((a, s) => a + s.spent, 0);
  const max = Math.max(1, ...summary.map((s) => Math.abs(s.balance)));

  function download() {
    const csv = exportGroupCSV({ groupName: group.name, baseCurrency: group.baseCurrency, members: group.members, expenses, settlements });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${group.name.replace(/\W+/g, "-")}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-xs uppercase tracking-wide text-zinc-500">Total group spend</p>
        <p className="text-2xl font-semibold tabular-nums">{formatMoney(totalSpent, group.baseCurrency)}</p>
      </Card>
      <Card className="space-y-3">
        {summary.map((s) => {
          const m = group.members.find((x) => x.id === s.memberId)!;
          return (
            <div key={s.memberId} className="flex items-center gap-3">
              <Avatar member={m} dimmed={m.status === "inactive"} />
              <div className="min-w-0 flex-1">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{m.name}</span>
                  <Amount value={s.balance}>
                    {s.balance === 0 ? "settled" : `${s.balance > 0 ? "gets back" : "owes"} ${formatMoney(Math.abs(s.balance), group.baseCurrency)}`}
                  </Amount>
                </div>
                <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div className="flex w-1/2 justify-end">{s.balance < 0 && <div className="rounded-l-full bg-orange-400" style={{ width: `${(Math.abs(s.balance) / max) * 100}%` }} />}</div>
                  <div className="w-1/2">{s.balance > 0 && <div className="h-full rounded-r-full bg-emerald-500" style={{ width: `${(s.balance / max) * 100}%` }} />}</div>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  paid {formatMoney(s.paid, group.baseCurrency)} · share {formatMoney(s.spent, group.baseCurrency)}
                </p>
              </div>
            </div>
          );
        })}
      </Card>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={download}>
          ⬇ Export CSV
        </Button>
        <Button variant="secondary" className="flex-1" onClick={() => window.print()}>
          🖨 Save as PDF
        </Button>
      </div>
    </div>
  );
}

const ACTIVITY_ICONS: Partial<Record<ActivityEvent["action"], string>> = {
  expense_created: "➕",
  expense_updated: "✏️",
  expense_deleted: "🗑️",
  settlement_created: "💸",
  settlement_deleted: "↩️",
  member_joined: "👋",
  member_deactivated: "⏸️",
  member_reactivated: "▶️",
  member_removed: "🚪",
  recurring_posted: "↻",
  group_created: "✨",
};

export function ActivityFeed({ activity }: { activity: ActivityEvent[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const sorted = useMemo(() => [...activity].sort((a, b) => b.at.localeCompare(a.at)), [activity]);
  return (
    <ol className="relative space-y-1 border-l border-zinc-200 pl-5 dark:border-zinc-800">
      {sorted.map((a) => (
        <li key={a.id} className="relative py-2">
          <span className="absolute -left-[31px] flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700">
            {ACTIVITY_ICONS[a.action] ?? "•"}
          </span>
          <p className="text-sm">{a.summary}</p>
          <p className="text-xs text-zinc-500">
            {new Date(a.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            {a.diff && (
              <button type="button" className="ml-2 text-emerald-600 hover:underline" onClick={() => setOpen(open === a.id ? null : a.id)}>
                {open === a.id ? "hide details" : "details"}
              </button>
            )}
          </p>
          {open === a.id && a.diff && <DiffView diff={a.diff} />}
        </li>
      ))}
    </ol>
  );
}

/** Field-level before → after view for edits; full snapshot for creates/deletes. */
function DiffView({ diff }: { diff: NonNullable<ActivityEvent["diff"]> }) {
  const before = (diff.before ?? {}) as Record<string, unknown>;
  const after = (diff.after ?? {}) as Record<string, unknown>;
  const keys = ["description", "amount", "currency", "category", "date", "payers", "owed"].filter(
    (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
  );
  return (
    <div className="mt-2 overflow-x-auto rounded-xl bg-zinc-50 p-2 font-mono text-[11px] dark:bg-zinc-950">
      {keys.map((k) => (
        <div key={k}>
          <span className="text-zinc-500">{k}: </span>
          {k in before && <span className="text-red-600 line-through">{JSON.stringify(before[k])}</span>}
          {k in before && k in after && " → "}
          {k in after && <span className="text-emerald-700 dark:text-emerald-400">{JSON.stringify(after[k])}</span>}
        </div>
      ))}
    </div>
  );
}

export function MembersPanel({ group, meId }: { group: Group; meId: string }) {
  const [name, setName] = useState("");
  const appState = useAppState((s) => s);
  const recurring = appState.recurring.filter((r) => r.groupId === group.id && r.active);
  const path = `/join/${group.inviteCode}`;

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <p className="text-sm font-medium">Invite people</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-800">{path}</code>
          <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(window.location.origin + path)}>
            Copy link
          </Button>
        </div>
        <p className="text-xs text-zinc-500">
          Or share the code <b className="font-mono">{group.inviteCode}</b>. Guests can join with just a name — no account required.
        </p>
      </Card>

      <Card className="space-y-2">
        <p className="text-sm font-medium">Members</p>
        {group.members.map((m) => (
          <div key={m.id} className="flex items-center gap-3 py-1">
            <Avatar member={m} dimmed={m.status === "inactive"} />
            <span className={cx("flex-1 text-sm", m.status === "inactive" && "text-zinc-400")}>
              {m.name}
              {m.id === meId && <span className="ml-1 text-xs text-zinc-500">(you)</span>}
              {m.isGuest && <span className="ml-1 text-xs text-zinc-500">· guest</span>}
              {m.status === "inactive" && <span className="ml-1 text-xs">· inactive</span>}
            </span>
            {m.id !== meId && (
              <>
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setMemberStatus(group.id, m.id, m.status === "active" ? "inactive" : "active")}>
                  {m.status === "active" ? "Deactivate" : "Reactivate"}
                </Button>
                {canRemoveMember(appState, group.id, m.id) && (
                  <Button variant="danger" className="px-2 py-1 text-xs" onClick={() => removeMember(group.id, m.id)}>
                    Remove
                  </Button>
                )}
              </>
            )}
          </div>
        ))}
        <form
          className="flex gap-2 pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) addMember(group.id, name, { actorId: meId });
            setName("");
          }}
        >
          <Input placeholder="Add someone by name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="secondary">
            Add
          </Button>
        </form>
        <p className="text-xs text-zinc-500">Members with expense history can only be deactivated, so past balances stay correct.</p>
      </Card>

      {recurring.length > 0 && (
        <Card className="space-y-2">
          <p className="text-sm font-medium">Recurring expenses</p>
          {recurring.map((r) => (
            <div key={r.id} className="flex items-center gap-3 text-sm">
              <span className="text-lg">↻</span>
              <span className="flex-1">
                {r.draft.description}
                <span className="block text-xs text-zinc-500">
                  {formatMoney(r.draft.amount, r.draft.currency)} · every {r.rule.interval > 1 ? `${r.rule.interval} ` : ""}
                  {PERIOD[r.rule.frequency]} · last posted {r.lastPosted ?? "never"}
                </span>
              </span>
              <Button variant="ghost" className="text-xs" onClick={() => stopRecurring(r.id)}>
                Stop
              </Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
