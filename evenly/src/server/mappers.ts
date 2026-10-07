import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Expense, ExpenseCategory, LineItem, Member, Settlement, SplitConfig, SplitType } from "@/lib/domain/types";
import type { Frequency } from "@/lib/domain/recurring";
import type { ActivityAction, ActivityEvent, Group, RecurringTemplate } from "@/lib/types";

/** Prisma rows → domain/UI shapes. BigInt/Decimal become plain numbers here. */

export const expenseInclude = {
  payers: true,
  splits: true,
  items: { include: { assignees: true }, orderBy: { position: "asc" } },
} satisfies Prisma.ExpenseInclude;

type ExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof expenseInclude }>;
type MemberRow = Prisma.GroupMemberGetPayload<object>;
type GroupRow = Prisma.GroupGetPayload<{ include: { members: true } }>;

const AVATAR_COLORS = ["#10b981", "#6366f1", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16", "#8b5cf6"];

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const toDbDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const num = (v: { toString(): string } | bigint | null | undefined) => (v === null || v === undefined ? 0 : Number(v.toString()));

export function toMember(m: MemberRow, index: number): Member {
  return {
    id: m.id,
    name: m.displayName,
    status: m.status === "ACTIVE" ? "active" : "inactive",
    claimed: m.userId !== null,
    avatarColor: AVATAR_COLORS[index % AVATAR_COLORS.length],
  };
}

export function toGroup(g: GroupRow): Group {
  const members = [...g.members].sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  return {
    id: g.id,
    name: g.name,
    emoji: g.emoji ?? "👥",
    baseCurrency: g.baseCurrency,
    inviteCode: g.inviteCode,
    members: members.map(toMember),
    createdAt: g.createdAt.toISOString(),
  };
}

export function toExpense(e: ExpenseRow, memberOrder: string[]): Expense {
  const type = e.splitType.toLowerCase() as SplitType;
  const rank = (id: string) => {
    const i = memberOrder.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const splits = [...e.splits].sort((a, b) => rank(a.memberId) - rank(b.memberId));
  const included = splits.map((s) => s.memberId);
  const owed = Object.fromEntries(splits.map((s) => [s.memberId, num(s.owedAmount)]));
  const inputs = Object.fromEntries(splits.map((s) => [s.memberId, num(s.inputValue)]));

  const split: SplitConfig = { type, included };
  if (type === "exact") split.exact = owed;
  if (type === "percent") split.percent = inputs;
  if (type === "shares") split.shares = inputs;
  if (type === "itemized") {
    split.items = e.items.map(
      (i): LineItem => ({ id: i.id, label: i.label, amount: num(i.amount), assignees: i.assignees.map((a) => a.memberId) }),
    );
  }

  return {
    id: e.id,
    groupId: e.groupId,
    description: e.description,
    category: e.category as ExpenseCategory,
    amount: num(e.amount),
    currency: e.currency,
    fxRate: num(e.fxRate),
    payers: [...e.payers].sort((a, b) => rank(a.memberId) - rank(b.memberId)).map((p) => ({ memberId: p.memberId, amount: num(p.amount) })),
    split,
    owed,
    date: isoDate(e.date),
    createdBy: e.createdById,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    recurringId: e.recurringId ?? undefined,
    receiptUrl: e.receiptUrl ?? undefined,
    version: e.version,
  };
}

export function toSettlement(s: Prisma.SettlementGetPayload<object>): Settlement {
  return {
    id: s.id,
    groupId: s.groupId,
    fromId: s.fromId,
    toId: s.toId,
    amount: num(s.amount),
    currency: s.currency,
    fxRate: num(s.fxRate),
    date: isoDate(s.date),
    createdBy: s.createdById,
    note: [s.method, s.note].filter(Boolean).join(" · ") || undefined,
  };
}

export function toActivity(a: Prisma.ActivityLogGetPayload<object>): ActivityEvent {
  return {
    id: a.id,
    groupId: a.groupId,
    actorId: a.actorId,
    action: a.action.toLowerCase() as ActivityAction,
    entityId: a.entityId,
    summary: a.summary,
    diff: (a.diff ?? undefined) as ActivityEvent["diff"],
    at: a.createdAt.toISOString(),
  };
}

export function toRecurring(r: Prisma.RecurringExpenseGetPayload<object>): RecurringTemplate {
  const payload = r.payload as { amount: number; currency: string };
  const rule = {
    frequency: r.frequency.toLowerCase() as Frequency,
    interval: r.interval,
    startDate: isoDate(r.startDate),
    endDate: r.endDate ? isoDate(r.endDate) : undefined,
  };
  return {
    id: r.id,
    description: r.description,
    amount: payload.amount,
    currency: payload.currency,
    rule,
    lastPosted: r.lastPostedOn ? isoDate(r.lastPostedOn) : undefined,
    nextRun: isoDate(r.nextRunOn),
  };
}
