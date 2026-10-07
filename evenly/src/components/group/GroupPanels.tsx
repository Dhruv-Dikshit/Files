"use client";

import { useMemo, useState, useTransition } from "react";
import { summarizeMembers } from "@/lib/domain/balances";
import { exportGroupCSV } from "@/lib/domain/export";
import { formatMoney } from "@/lib/domain/money";
import type { Expense, Settlement } from "@/lib/domain/types";
import type { ActionResult, ActivityEvent, Group, RecurringTemplate } from "@/lib/types";
import { addMember, deleteSettlement, removeMember, restoreExpense, setMemberStatus, stopRecurring } from "@/server/actions";
import { CATEGORIES } from "@/components/expense/AddExpenseModal";
import { Amount, Avatar, Button, Card, Icon, IconTile, Input, SectionLabel, Tag, cx, type IconName } from "@/components/ui/primitives";
import { callAction } from "@/lib/call-action";

const PERIOD = { daily: "day", weekly: "week", monthly: "month", yearly: "year" } as const;
/** Run a server action from an event handler and surface its error, if any. */
function useAction() {
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<ActionResult<unknown>>, after?: () => void) =>
    startTransition(async () => {
      const result = await callAction(action);
      if (!result.ok) alert(result.error);
      else after?.();
    });
  return [pending, run] as const;
}

const nameOf = (group: Group, id: string) => group.members.find((m) => m.id === id)?.name ?? "Unknown";
const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function EmptyState({ icon, title, hint }: { icon: IconName; title: string; hint: string }) {
  return (
    <Card className="py-10 text-center">
      <IconTile size={60} tone={0} className="mx-auto">
        <Icon name={icon} />
      </IconTile>
      <p className="mt-4 text-[14px] font-bold leading-6">{title}</p>
      <p className="text-[12px] leading-5 text-muted">{hint}</p>
    </Card>
  );
}

// ── Expenses ──────────────────────────────────────────────────────────────

export function ExpenseList({ group, meId, expenses, settlements, onEdit }: { group: Group; meId: string; expenses: Expense[]; settlements: Settlement[]; onEdit: (e: Expense) => void }) {
  const [pending, run] = useAction();
  type Row = { kind: "expense"; date: string; at: string; e: Expense } | { kind: "settlement"; date: string; at: string; s: Settlement };
  const rows: Row[] = [
    ...expenses.map((e) => ({ kind: "expense" as const, date: e.date, at: e.createdAt, e })),
    ...settlements.map((s) => ({ kind: "settlement" as const, date: s.date, at: s.date, s })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at));

  if (rows.length === 0) return <EmptyState icon="bill" title="No expenses yet" hint="Add the first one with the button below." />;

  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        if (row.kind === "settlement") {
          const s = row.s;
          return (
            <li key={s.id} className="flex items-center gap-[19px] rounded-[20px] bg-surface px-3 py-2.5">
              <IconTile size={60} tone={1}>
                <Icon name="ticket" size={20} />
              </IconTile>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-bold leading-6">
                  {nameOf(group, s.fromId)} → {nameOf(group, s.toId)}
                </span>
                <span className="block truncate text-[11px] leading-6 text-muted">
                  {shortDate(s.date)} · payment{s.note ? ` · ${s.note}` : ""}
                </span>
              </span>
              <span className="text-right">
                <span className="block text-[14px] leading-6 tabular-nums">{formatMoney(s.amount, s.currency)}</span>
                <button
                  type="button"
                  disabled={pending}
                  className="text-[11px] leading-6 text-muted hover:text-danger"
                  onClick={() => confirm("Undo this payment?") && run(() => deleteSettlement(group.id, s.id))}
                >
                  undo
                </button>
              </span>
            </li>
          );
        }
        const e = row.e;
        const paid = e.payers.find((p) => p.memberId === meId)?.amount ?? 0;
        const mine = paid - (e.owed[meId] ?? 0);
        const payerLabel = e.payers.length > 1 ? `${e.payers.length} people` : nameOf(group, e.payers[0]?.memberId);
        const persons = Object.keys(e.owed).length;
        const categoryIndex = Math.max(0, CATEGORIES.findIndex((c) => c.value === e.category));
        return (
          <li key={e.id}>
            {/* Kit "Order card": icon tile · name + date · amount + persons */}
            <button
              type="button"
              onClick={() => onEdit(e)}
              className="flex w-full items-center gap-[19px] rounded-[20px] bg-surface px-3 py-2.5 text-left transition hover:ring-2 hover:ring-cloudy"
            >
              <IconTile size={60} tone={categoryIndex} className="text-[24px]">
                {CATEGORIES[categoryIndex]?.icon ?? "📦"}
              </IconTile>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-bold leading-6">
                  {e.description}
                  {e.recurringId && (
                    <span className="ml-1.5 text-[11px] font-normal text-accent" title="Recurring">
                      ↻
                    </span>
                  )}
                </span>
                <span className="block truncate text-[11px] leading-6 text-muted">
                  {shortDate(e.date)} · {payerLabel} paid
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[14px] leading-6 tabular-nums">{formatMoney(e.amount, e.currency)}</span>
                <span className="block text-[11px] leading-6">
                  {mine === 0 ? (
                    <span className="text-muted">
                      {persons} {persons === 1 ? "person" : "persons"}
                    </span>
                  ) : (
                    <>
                      <span className="text-muted">{mine > 0 ? "lent " : "owe "}</span>
                      <Amount value={mine}>{formatMoney(Math.abs(mine), e.currency)}</Amount>
                    </>
                  )}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ── Balances ──────────────────────────────────────────────────────────────

/** Kit "Chart column": 24×128 rounded track, dark fill, purple for the highlighted column. */
function ChartColumn({ ratio, active }: { ratio: number; active: boolean }) {
  return (
    <div className="relative h-32 w-6 overflow-hidden rounded-[8px] bg-hazy">
      <div
        className={cx("absolute inset-x-0 bottom-0 rounded-[8px]", active ? "bg-gradient-to-t from-[#8c55ff] to-[#b28dff]" : "bg-ink")}
        style={{ height: `${Math.max(ratio > 0 ? 6 : 0, ratio * 100)}%` }}
      />
    </div>
  );
}

export function BalancesPanel({ group, meId, expenses, settlements }: { group: Group; meId: string; expenses: Expense[]; settlements: Settlement[] }) {
  const summary = useMemo(
    () => summarizeMembers(group.members.map((m) => m.id), expenses, settlements, group.baseCurrency),
    [group, expenses, settlements],
  );
  const totalSpent = summary.reduce((a, s) => a + s.spent, 0);
  const maxSpent = Math.max(1, ...summary.map((s) => s.spent));

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
        <p className="text-[12px] leading-5 text-muted">Total group spend</p>
        <p className="text-[28px] font-medium leading-10 tabular-nums">{formatMoney(totalSpent, group.baseCurrency)}</p>
        <div className="mt-4 flex items-end gap-4 overflow-x-auto pb-1">
          {summary.map((s) => {
            const m = group.members.find((x) => x.id === s.memberId)!;
            return (
              <div key={s.memberId} className="flex shrink-0 flex-col items-center gap-2">
                <ChartColumn ratio={s.spent / maxSpent} active={s.memberId === meId} />
                <Tag active={s.memberId === meId} className="max-w-[64px] truncate px-2 text-[9px]">
                  {m.name}
                </Tag>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] leading-4 text-muted">Each person&apos;s share of spending. Yours is purple.</p>
      </Card>

      <div>
        <SectionLabel>Who owes what</SectionLabel>
        <ul className="space-y-2">
          {summary.map((s) => {
            const m = group.members.find((x) => x.id === s.memberId)!;
            return (
              <li key={s.memberId} className="flex items-center gap-4 rounded-[20px] bg-surface px-3 py-2.5">
                <Avatar member={m} dimmed={m.status === "inactive"} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium leading-6">
                    {m.name}
                    {s.memberId === meId && <span className="ml-1 text-[11px] font-normal text-muted">(you)</span>}
                  </span>
                  <span className="block text-[11px] leading-5 text-muted">
                    paid {formatMoney(s.paid, group.baseCurrency)} · share {formatMoney(s.spent, group.baseCurrency)}
                  </span>
                </span>
                <span className="text-right">
                  {s.balance === 0 ? (
                    <span className="text-[14px] leading-6 text-muted">settled</span>
                  ) : (
                    <Amount value={s.balance}>{formatMoney(Math.abs(s.balance), group.baseCurrency)}</Amount>
                  )}
                  <span className="block text-[11px] leading-5 text-muted">{s.balance === 0 ? "" : s.balance > 0 ? "gets back" : "owes"}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={download}>
          Export CSV
        </Button>
        <Button variant="secondary" className="flex-1" onClick={() => window.print()}>
          Save as PDF
        </Button>
      </div>
    </div>
  );
}

// ── Activity ──────────────────────────────────────────────────────────────

const ACTIVITY_ICONS: Partial<Record<ActivityEvent["action"], IconName>> = {
  expense_created: "bill",
  expense_updated: "edit",
  expense_deleted: "delete",
  expense_restored: "bill",
  settlement_created: "ticket",
  settlement_deleted: "ticket",
  member_joined: "add-friend",
  member_deactivated: "account",
  member_removed: "account",
  recurring_posted: "notification",
  group_created: "home",
};

export function ActivityFeed({ activity, groupId, liveExpenseIds }: { activity: ActivityEvent[]; groupId: string; liveExpenseIds: Set<string> }) {
  const [open, setOpen] = useState<string | null>(null);
  const [pending, run] = useAction();
  const sorted = useMemo(() => [...activity].sort((a, b) => b.at.localeCompare(a.at)), [activity]);
  if (activity.length === 0) return <EmptyState icon="notification" title="No activity yet" hint="Every change in this group will show up here." />;
  return (
    <ul className="space-y-2">
      {sorted.map((a) => (
        <li key={a.id} className="rounded-[20px] bg-surface px-3 py-2.5">
          <div className="flex items-start gap-4">
            <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]", a.action === "expense_deleted" ? "bg-danger/10 text-danger" : "bg-cloudy text-accent")}>
              <Icon name={ACTIVITY_ICONS[a.action] ?? "notification"} size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] leading-5">{a.summary}</p>
              <p className="text-[11px] leading-5 text-muted">
                {new Date(a.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                {a.diff && (
                  <button type="button" className="ml-2 text-accent hover:underline" onClick={() => setOpen(open === a.id ? null : a.id)}>
                    {open === a.id ? "hide details" : "details"}
                  </button>
                )}
                {a.action === "expense_deleted" && !liveExpenseIds.has(a.entityId) && (
                  <button type="button" disabled={pending} className="ml-2 text-accent hover:underline" onClick={() => run(() => restoreExpense(groupId, a.entityId))}>
                    restore
                  </button>
                )}
              </p>
            </div>
          </div>
          {open === a.id && a.diff && <DiffView diff={a.diff} />}
        </li>
      ))}
    </ul>
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
    <div className="mt-2 overflow-x-auto rounded-[12px] bg-hazy p-2 font-mono text-[11px] leading-5">
      {keys.map((k) => (
        <div key={k}>
          <span className="text-muted">{k}: </span>
          {k in before && <span className="text-danger line-through">{JSON.stringify(before[k])}</span>}
          {k in before && k in after && " → "}
          {k in after && <span className="text-accent">{JSON.stringify(after[k])}</span>}
        </div>
      ))}
    </div>
  );
}

// ── Members ───────────────────────────────────────────────────────────────

export function MembersPanel({ group, meId, removableIds, recurring }: { group: Group; meId: string; removableIds: string[]; recurring: RecurringTemplate[] }) {
  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, run] = useAction();
  const path = `/join/${group.inviteCode}`;

  return (
    <div className="space-y-5">
      <Card className="space-y-3">
        <div className="flex items-center gap-4">
          <IconTile size={52} tone={0}>
            <Icon name="add-friend" size={20} />
          </IconTile>
          <div>
            <p className="text-[14px] font-medium leading-6">Invite people</p>
            <p className="text-[11px] leading-5 text-muted">
              Code <b className="font-mono text-ink">{group.inviteCode}</b> · no account needed
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-[12px] bg-hazy px-3 py-3 text-[12px] leading-5">{path}</code>
          <Button
            onClick={() => {
              navigator.clipboard?.writeText(window.location.origin + path);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied ✓" : "Copy link"}
          </Button>
        </div>
        <p className="text-[11px] leading-5 text-muted">
          People join with just their name and can claim a spot you added for them. Others on your Wi-Fi can open the link using this computer&apos;s network
          address instead of <span className="font-mono">localhost</span>.
        </p>
      </Card>

      <div>
        <SectionLabel>Members</SectionLabel>
        <ul className="space-y-2">
          {group.members.map((m) => (
            <li key={m.id} className="flex items-center gap-4 rounded-[20px] bg-surface px-3 py-2.5">
              <Avatar member={m} dimmed={m.status === "inactive"} />
              <span className={cx("min-w-0 flex-1", m.status === "inactive" && "text-muted")}>
                <span className="block truncate text-[14px] font-medium leading-6">
                  {m.name}
                  {m.id === meId && <span className="ml-1 text-[11px] font-normal text-muted">(you)</span>}
                </span>
                <span className="block text-[11px] leading-5 text-muted">
                  {m.status === "inactive" ? "Inactive" : m.claimed ? "Joined" : "Hasn't joined yet"}
                </span>
              </span>
              {m.id !== meId && (
                <span className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-[11px]"
                    disabled={pending}
                    onClick={() => run(() => setMemberStatus(group.id, m.id, m.status === "active" ? "inactive" : "active"))}
                  >
                    {m.status === "active" ? "Deactivate" : "Reactivate"}
                  </Button>
                  {removableIds.includes(m.id) && (
                    <button
                      type="button"
                      aria-label={`Remove ${m.name}`}
                      disabled={pending}
                      onClick={() => run(() => removeMember(group.id, m.id))}
                      className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-hazy text-muted hover:text-danger"
                    >
                      <Icon name="delete" size={16} />
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) run(() => addMember(group.id, name), () => setName(""));
          }}
        >
          <Input placeholder="Add someone by name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="action" disabled={pending || !name.trim()}>
            Add
          </Button>
        </form>
        <p className="mt-2 text-[11px] leading-5 text-muted">Members with expense history can only be deactivated, so past balances stay correct.</p>
      </div>

      {recurring.length > 0 && (
        <div>
          <SectionLabel>Recurring expenses</SectionLabel>
          <ul className="space-y-2">
            {recurring.map((r, i) => (
              <li key={r.id} className="flex items-center gap-4 rounded-[20px] bg-surface px-3 py-2.5">
                <IconTile size={52} tone={i + 2}>
                  <Icon name="notification" size={20} />
                </IconTile>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold leading-6">{r.description}</span>
                  <span className="block text-[11px] leading-5 text-muted">
                    {formatMoney(r.amount, r.currency)} · every {r.rule.interval > 1 ? `${r.rule.interval} ` : ""}
                    {PERIOD[r.rule.frequency]} · next {shortDate(r.nextRun)}
                  </span>
                </span>
                <Button variant="ghost" className="px-2 py-1 text-[11px]" disabled={pending} onClick={() => confirm(`Stop repeating “${r.description}”?`) && run(() => stopRecurring(group.id, r.id))}>
                  Stop
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
