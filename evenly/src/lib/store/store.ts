"use client";

import { useSyncExternalStore } from "react";
import { computeBalances } from "@/lib/domain/balances";
import { dueOccurrences } from "@/lib/domain/recurring";
import { formatMoney } from "@/lib/domain/money";
import type { Expense, Member, MemberId } from "@/lib/domain/types";
import { avatarColor, inviteCode, now, today, uid } from "./ids";
import { seedState } from "./seed";
import type { ActivityAction, AppState, ExpenseDraft, Group, NewSettlement, RecurringTemplate } from "./types";

/**
 * Demo store: a tiny external store persisted to localStorage.
 *
 * In production each action below maps 1:1 to a server action / API route
 * that writes the row *and* its ActivityLog entry in one DB transaction,
 * then broadcasts on the group's realtime channel (see docs/ARCHITECTURE.md).
 * Components only use the hooks + actions exported here, so swapping the
 * implementation doesn't touch the UI.
 */

const STORAGE_KEY = "evenly:v1";
let state: AppState = seedState;
const listeners = new Set<() => void>();

function setState(updater: (s: AppState) => AppState) {
  state = updater(state);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable (private mode) — keep in-memory state.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let hydrated = false;
/** Load persisted state once on the client, then post due recurring expenses. */
export function hydrateStore() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed.version === 1) state = parsed;
    }
  } catch {
    // Corrupt storage: fall back to seed data.
  }
  postDueRecurring();
  listeners.forEach((l) => l());
}

export function useAppState<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(seedState),
  );
}

export function resetDemo() {
  setState(() => seedState);
  postDueRecurring();
}

// ── selectors ────────────────────────────────────────────────────────────

export function useGroup(groupId: string) {
  const group = useAppState((s) => s.groups.find((g) => g.id === groupId));
  const expenses = useAppState((s) => s.expenses);
  const settlements = useAppState((s) => s.settlements);
  const activity = useAppState((s) => s.activity);
  const meId = useAppState((s) => s.me[groupId]);
  return {
    group,
    meId,
    expenses: expenses.filter((e) => e.groupId === groupId),
    settlements: settlements.filter((x) => x.groupId === groupId),
    activity: activity.filter((a) => a.groupId === groupId),
  };
}

export function groupBalances(s: AppState, groupId: string) {
  const group = s.groups.find((g) => g.id === groupId);
  if (!group) return {};
  return computeBalances(
    group.members.map((m) => m.id),
    s.expenses.filter((e) => e.groupId === groupId),
    s.settlements.filter((x) => x.groupId === groupId),
    group.baseCurrency,
  );
}

// ── actions ──────────────────────────────────────────────────────────────

function log(
  s: AppState,
  groupId: string,
  actorId: MemberId | null,
  action: ActivityAction,
  summary: string,
  diff?: { before?: unknown; after?: unknown },
): AppState {
  return {
    ...s,
    activity: [{ id: uid("a"), groupId, actorId, action, summary, diff, at: now() }, ...s.activity],
  };
}

const memberName = (g: Group | undefined, id: MemberId | null) =>
  g?.members.find((m) => m.id === id)?.name ?? "Someone";

export function createGroup(input: { name: string; emoji: string; baseCurrency: string; yourName: string; memberNames: string[] }): string {
  const id = uid("g");
  const members: Member[] = [input.yourName || "You", ...input.memberNames]
    .map((n) => n.trim())
    .filter(Boolean)
    .map((name, i) => ({ id: uid("m"), name, status: "active", avatarColor: avatarColor(i) }));
  const group: Group = {
    id,
    name: input.name.trim(),
    emoji: input.emoji || "👥",
    baseCurrency: input.baseCurrency,
    inviteCode: inviteCode(input.name),
    members,
    createdAt: now(),
  };
  setState((s) =>
    log({ ...s, groups: [group, ...s.groups], me: { ...s.me, [id]: members[0].id } }, id, members[0].id, "group_created", `${members[0].name} created the group`),
  );
  return id;
}

export function addMember(groupId: string, name: string, opts: { isGuest?: boolean; actorId?: MemberId | null } = {}): MemberId {
  const id = uid("m");
  setState((s) => {
    const group = s.groups.find((g) => g.id === groupId);
    if (!group) return s;
    const member: Member = { id, name: name.trim(), status: "active", isGuest: opts.isGuest, avatarColor: avatarColor(group.members.length) };
    const groups = s.groups.map((g) => (g.id === groupId ? { ...g, members: [...g.members, member] } : g));
    const verb = opts.isGuest ? "joined as a guest via invite link" : "was added to the group";
    return log({ ...s, groups }, groupId, opts.actorId ?? id, "member_joined", `${member.name} ${verb}`);
  });
  return id;
}

/** Deactivate keeps history and balances but hides the member from new expenses. */
export function setMemberStatus(groupId: string, memberId: MemberId, status: Member["status"]) {
  setState((s) => {
    const group = s.groups.find((g) => g.id === groupId);
    const groups = s.groups.map((g) =>
      g.id === groupId ? { ...g, members: g.members.map((m) => (m.id === memberId ? { ...m, status } : m)) } : g,
    );
    const action = status === "inactive" ? "member_deactivated" : "member_reactivated";
    const summary = `${memberName(group, s.me[groupId])} ${status === "inactive" ? "deactivated" : "reactivated"} ${memberName(group, memberId)}`;
    return log({ ...s, groups }, groupId, s.me[groupId], action, summary);
  });
}

/** Hard removal is only allowed when the member has no history in the group. */
export function canRemoveMember(s: AppState, groupId: string, memberId: MemberId): boolean {
  const touches = (e: Expense) => e.payers.some((p) => p.memberId === memberId) || memberId in e.owed;
  return (
    !s.expenses.some((e) => e.groupId === groupId && touches(e)) &&
    !s.settlements.some((x) => x.groupId === groupId && (x.fromId === memberId || x.toId === memberId))
  );
}

export function removeMember(groupId: string, memberId: MemberId) {
  setState((s) => {
    if (!canRemoveMember(s, groupId, memberId)) return s;
    const group = s.groups.find((g) => g.id === groupId);
    const groups = s.groups.map((g) => (g.id === groupId ? { ...g, members: g.members.filter((m) => m.id !== memberId) } : g));
    return log({ ...s, groups }, groupId, s.me[groupId], "member_removed", `${memberName(group, s.me[groupId])} removed ${memberName(group, memberId)}`);
  });
}

export function addExpense(groupId: string, draft: ExpenseDraft, recurring?: Omit<RecurringTemplate, "id" | "groupId" | "draft" | "active">) {
  setState((s) => {
    const group = s.groups.find((g) => g.id === groupId);
    const actor = s.me[groupId];
    const template: RecurringTemplate | undefined = recurring
      ? { ...recurring, id: uid("r"), groupId, draft, active: true, lastPosted: draft.date }
      : undefined;
    const expense: Expense = {
      ...draft,
      id: uid("e"),
      groupId,
      createdBy: actor,
      createdAt: now(),
      updatedAt: now(),
      recurringId: template?.id,
    };
    const next: AppState = {
      ...s,
      expenses: [expense, ...s.expenses],
      recurring: template ? [...s.recurring, template] : s.recurring,
    };
    const label = `${memberName(group, actor)} added “${draft.description}” (${formatMoney(draft.amount, draft.currency)})${recurring ? ` · repeats ${recurring.rule.frequency}` : ""}`;
    return log(next, groupId, actor, "expense_created", label, { after: expense });
  });
}

export function updateExpense(expenseId: string, draft: ExpenseDraft) {
  setState((s) => {
    const before = s.expenses.find((e) => e.id === expenseId);
    if (!before) return s;
    const group = s.groups.find((g) => g.id === before.groupId);
    const after: Expense = { ...before, ...draft, updatedAt: now() };
    const actor = s.me[before.groupId];
    const expenses = s.expenses.map((e) => (e.id === expenseId ? after : e));
    return log({ ...s, expenses }, before.groupId, actor, "expense_updated", `${memberName(group, actor)} edited “${after.description}”`, { before, after });
  });
}

export function deleteExpense(expenseId: string) {
  setState((s) => {
    const before = s.expenses.find((e) => e.id === expenseId);
    if (!before) return s;
    const group = s.groups.find((g) => g.id === before.groupId);
    const actor = s.me[before.groupId];
    return log(
      { ...s, expenses: s.expenses.filter((e) => e.id !== expenseId) },
      before.groupId,
      actor,
      "expense_deleted",
      `${memberName(group, actor)} deleted “${before.description}” (${formatMoney(before.amount, before.currency)})`,
      { before },
    );
  });
}

export function recordSettlement(groupId: string, input: NewSettlement) {
  setState((s) => {
    const group = s.groups.find((g) => g.id === groupId);
    const settlement = { ...input, id: uid("s"), groupId, createdBy: s.me[groupId] };
    return log(
      { ...s, settlements: [settlement, ...s.settlements] },
      groupId,
      s.me[groupId],
      "settlement_created",
      `${memberName(group, input.fromId)} paid ${memberName(group, input.toId)} ${formatMoney(input.amount, input.currency)}`,
      { after: settlement },
    );
  });
}

export function deleteSettlement(settlementId: string) {
  setState((s) => {
    const before = s.settlements.find((x) => x.id === settlementId);
    if (!before) return s;
    const group = s.groups.find((g) => g.id === before.groupId);
    return log(
      { ...s, settlements: s.settlements.filter((x) => x.id !== settlementId) },
      before.groupId,
      s.me[before.groupId],
      "settlement_deleted",
      `${memberName(group, s.me[before.groupId])} undid a payment from ${memberName(group, before.fromId)} to ${memberName(group, before.toId)}`,
      { before },
    );
  });
}

/** Guest mode: join a group by invite code with just a display name. */
export function joinWithCode(code: string, name: string): string | null {
  const group = state.groups.find((g) => g.inviteCode.toUpperCase() === code.trim().toUpperCase());
  if (!group) return null;
  const memberId = addMember(group.id, name, { isGuest: true });
  setState((s) => ({ ...s, me: { ...s.me, [group.id]: memberId } }));
  return group.id;
}

export function switchIdentity(groupId: string, memberId: MemberId) {
  setState((s) => ({ ...s, me: { ...s.me, [groupId]: memberId } }));
}

/**
 * Post any recurring occurrences that are due. Production runs the same
 * logic in a daily cron with a unique (recurring_id, date) constraint.
 */
export function postDueRecurring() {
  setState((s) => {
    let next = s;
    for (const template of s.recurring) {
      if (!template.active) continue;
      const dates = dueOccurrences(template.rule, today(), template.lastPosted);
      if (dates.length === 0) continue;
      const posted: Expense[] = dates.map((date) => ({
        ...template.draft,
        id: uid("e"),
        groupId: template.groupId,
        date,
        recurringId: template.id,
        createdBy: template.draft.payers[0]?.memberId ?? "",
        createdAt: now(),
        updatedAt: now(),
      }));
      next = {
        ...next,
        expenses: [...posted, ...next.expenses],
        recurring: next.recurring.map((r) => (r.id === template.id ? { ...r, lastPosted: dates[dates.length - 1] } : r)),
      };
      for (const e of posted) {
        next = log(next, template.groupId, null, "recurring_posted", `Recurring “${e.description}” posted for ${e.date} (${formatMoney(e.amount, e.currency)})`);
      }
    }
    return next;
  });
}

export function stopRecurring(templateId: string) {
  setState((s) => ({ ...s, recurring: s.recurring.map((r) => (r.id === templateId ? { ...r, active: false } : r)) }));
}
