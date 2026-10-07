"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { formatMoney } from "@/lib/domain/money";
import { nextOccurrence } from "@/lib/domain/recurring";
import type { ActionResult, ExpenseDraft, RepeatInput } from "@/lib/types";
import { prisma } from "./db";
import { toDbDate } from "./mappers";
import { lookupRate } from "./rates";
import { getCurrentUser, signIn } from "./session";
import { UserError, expenseRowData, snapshot, validateDraft } from "./write";

/**
 * Every mutation: authenticate → authorise (active group member) → validate
 * → write row(s) + activity log in ONE transaction → revalidate the page.
 * Errors meant for the user come back as { ok: false, error }.
 */

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof UserError) return { ok: false, error: err.message };
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: "That already exists." };
    }
    console.error(err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

const cleanName = (name: unknown, max = 60) => {
  const n = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (!n) throw new UserError("Enter a name.");
  if (n.length > max) throw new UserError(`Keep it under ${max} characters.`);
  return n;
};

async function requireMember(groupId: string) {
  const user = await getCurrentUser();
  if (!user) throw new UserError("Your session expired. Reload the page.");
  const member = await prisma.groupMember.findFirst({
    where: { groupId, userId: user.id, status: "ACTIVE" },
    include: { group: { include: { members: true } } },
  });
  if (!member) throw new UserError("You're not a member of this group.");
  return member;
}

const nameIn = (members: { id: string; displayName: string }[], id: string) =>
  members.find((m) => m.id === id)?.displayName ?? "Someone";

function revalidateGroup(groupId: string) {
  revalidatePath(`/groups/${groupId}`, "layout");
  revalidatePath("/");
}

// ── profile ───────────────────────────────────────────────────────────────

export async function createProfile(_: unknown, form: FormData): Promise<ActionResult | never> {
  const next = String(form.get("next") ?? "/");
  const result = await run(async () => {
    const user = await prisma.user.create({ data: { displayName: cleanName(form.get("name")) } });
    await signIn(user.id);
  });
  if (!result.ok) return result;
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function updateProfileName(name: string) {
  return run(async () => {
    const user = await getCurrentUser();
    if (!user) throw new UserError("Your session expired. Reload the page.");
    const displayName = cleanName(name);
    await prisma.user.update({ where: { id: user.id }, data: { displayName } });
    revalidatePath("/", "layout");
  });
}

// ── groups & members ──────────────────────────────────────────────────────

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makeInviteCode(name: string) {
  const prefix = name.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase().padEnd(3, "X");
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return `${prefix}-${[...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("")}`;
}

export async function createGroup(input: { name: string; emoji: string; baseCurrency: string; memberNames: string[] }) {
  return run(async () => {
    const user = await getCurrentUser();
    if (!user) throw new UserError("Your session expired. Reload the page.");
    const name = cleanName(input.name, 80);
    if (!/^[A-Z]{3}$/.test(input.baseCurrency)) throw new UserError("Pick a currency.");
    const others = [...new Set((input.memberNames ?? []).map((n) => n.trim()).filter(Boolean))].map((n) => cleanName(n));

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const group = await prisma.$transaction(async (tx) => {
          const g = await tx.group.create({
            data: {
              name,
              emoji: (input.emoji || "👥").slice(0, 8),
              baseCurrency: input.baseCurrency,
              inviteCode: makeInviteCode(name),
              createdById: user.id,
            },
          });
          const owner = await tx.groupMember.create({
            data: { groupId: g.id, userId: user.id, displayName: user.displayName, role: "OWNER" },
          });
          // Stagger joinedAt so member order matches the order typed.
          for (const [i, displayName] of others.entries()) {
            await tx.groupMember.create({ data: { groupId: g.id, displayName, joinedAt: new Date(Date.now() + i + 1) } });
          }
          await tx.activityLog.create({
            data: { groupId: g.id, actorId: owner.id, action: "GROUP_CREATED", entityType: "group", entityId: g.id, summary: `${user.displayName} created the group` },
          });
          return g;
        });
        revalidatePath("/");
        return group.id;
      } catch (err) {
        // Invite-code collision: retry with a new code.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && attempt < 4) continue;
        throw err;
      }
    }
    throw new UserError("Couldn't create the group. Try again.");
  });
}

export async function addMember(groupId: string, name: string) {
  return run(async () => {
    const actor = await requireMember(groupId);
    const displayName = cleanName(name);
    const m = await prisma.groupMember.create({ data: { groupId, displayName } });
    await prisma.activityLog.create({
      data: { groupId, actorId: actor.id, action: "MEMBER_JOINED", entityType: "member", entityId: m.id, summary: `${actor.displayName} added ${displayName}` },
    });
    revalidateGroup(groupId);
  });
}

export async function setMemberStatus(groupId: string, memberId: string, status: "active" | "inactive") {
  return run(async () => {
    const actor = await requireMember(groupId);
    if (memberId === actor.id) throw new UserError("You can't deactivate yourself.");
    const target = actor.group.members.find((m) => m.id === memberId);
    if (!target) throw new UserError("Member not found.");
    await prisma.$transaction([
      prisma.groupMember.update({ where: { id: memberId }, data: { status: status === "active" ? "ACTIVE" : "INACTIVE" } }),
      prisma.activityLog.create({
        data: {
          groupId,
          actorId: actor.id,
          action: status === "inactive" ? "MEMBER_DEACTIVATED" : "MEMBER_JOINED",
          entityType: "member",
          entityId: memberId,
          summary: `${actor.displayName} ${status === "inactive" ? "deactivated" : "reactivated"} ${target.displayName}`,
        },
      }),
    ]);
    revalidateGroup(groupId);
  });
}

export async function removeMember(groupId: string, memberId: string) {
  return run(async () => {
    const actor = await requireMember(groupId);
    const target = await prisma.groupMember.findFirst({
      where: { id: memberId, groupId },
      include: { _count: { select: { payments: true, splits: true, itemAssignments: true, settlementsIn: true, settlementsOut: true } } },
    });
    if (!target) throw new UserError("Member not found.");
    if (target.userId) throw new UserError("People who joined can only be deactivated.");
    if (Object.values(target._count).some((c) => c > 0)) throw new UserError("This person has expense history — deactivate them instead.");
    await prisma.$transaction([
      prisma.groupMember.delete({ where: { id: memberId } }),
      prisma.activityLog.create({
        data: { groupId, actorId: actor.id, action: "MEMBER_REMOVED", entityType: "member", entityId: memberId, summary: `${actor.displayName} removed ${target.displayName}` },
      }),
    ]);
    revalidateGroup(groupId);
  });
}

/**
 * Join via invite link. Either claim an existing placeholder member
 * ("I'm Aisha" — inherits her history) or join as a new member.
 * Creates a profile first if this browser doesn't have one yet.
 */
export async function joinGroup(input: { code: string; claimMemberId?: string; name?: string }) {
  return run(async () => {
    const group = await prisma.group.findUnique({ where: { inviteCode: input.code.trim().toUpperCase() } });
    if (!group) throw new UserError("Invite code not found.");

    let user = await getCurrentUser();
    if (!user) {
      user = await prisma.user.create({ data: { displayName: cleanName(input.name) } });
      await signIn(user.id);
    }
    const existing = await prisma.groupMember.findFirst({ where: { groupId: group.id, userId: user.id } });
    if (existing) return group.id;

    if (input.claimMemberId) {
      const claimed = await prisma.groupMember.updateMany({
        where: { id: input.claimMemberId, groupId: group.id, userId: null },
        data: { userId: user.id, status: "ACTIVE" },
      });
      if (claimed.count === 0) throw new UserError("Someone already joined as that person.");
      const m = await prisma.groupMember.findUniqueOrThrow({ where: { id: input.claimMemberId } });
      await prisma.activityLog.create({
        data: { groupId: group.id, actorId: m.id, action: "MEMBER_JOINED", entityType: "member", entityId: m.id, summary: `${m.displayName} joined via invite link` },
      });
    } else {
      const displayName = input.name ? cleanName(input.name) : user.displayName;
      const m = await prisma.groupMember.create({ data: { groupId: group.id, userId: user.id, displayName } });
      await prisma.activityLog.create({
        data: { groupId: group.id, actorId: m.id, action: "MEMBER_JOINED", entityType: "member", entityId: m.id, summary: `${displayName} joined via invite link` },
      });
    }
    revalidateGroup(group.id);
    return group.id;
  });
}

// ── expenses ──────────────────────────────────────────────────────────────

export async function saveExpense(input: {
  groupId: string;
  draft: ExpenseDraft;
  expenseId?: string;
  version?: number;
  repeat?: RepeatInput;
}) {
  return run(async () => {
    const actor = await requireMember(input.groupId);
    const group = actor.group;
    const owed = validateDraft(input.draft, new Set(group.members.map((m) => m.id)), group.baseCurrency);
    const draft = input.draft;
    const label = `“${draft.description.trim()}” (${formatMoney(draft.amount, draft.currency)})`;

    if (input.expenseId) {
      await prisma.$transaction(async (tx) => {
        const before = await tx.expense.findFirst({ where: { id: input.expenseId, groupId: input.groupId, deletedAt: null } });
        if (!before) throw new UserError("This expense was deleted.");
        // Optimistic concurrency: refuse to overwrite someone else's newer edit.
        const bumped = await tx.expense.updateMany({
          where: { id: before.id, version: input.version ?? before.version },
          data: { version: { increment: 1 } },
        });
        if (bumped.count === 0) throw new UserError("Someone else edited this expense. Close and reopen it to see their changes.");
        await tx.expensePayer.deleteMany({ where: { expenseId: before.id } });
        await tx.expenseSplit.deleteMany({ where: { expenseId: before.id } });
        await tx.expenseItem.deleteMany({ where: { expenseId: before.id } });
        const { groupId: _g, createdById: _c, ...data } = expenseRowData(input.groupId, draft, owed, before.createdById);
        await tx.expense.update({ where: { id: before.id }, data });
        await tx.activityLog.create({
          data: {
            groupId: input.groupId,
            actorId: actor.id,
            action: "EXPENSE_UPDATED",
            entityType: "expense",
            entityId: before.id,
            summary: `${actor.displayName} edited ${label}`,
            diff: { before: { description: before.description, amount: Number(before.amount), currency: before.currency, category: before.category, date: before.date.toISOString().slice(0, 10) }, after: snapshot(draft, owed) },
          },
        });
      });
    } else {
      await prisma.$transaction(async (tx) => {
        let recurringId: string | undefined;
        if (input.repeat) {
          const interval = Math.trunc(input.repeat.interval);
          if (!["weekly", "monthly", "yearly"].includes(input.repeat.frequency) || interval < 1 || interval > 52) {
            throw new UserError("Invalid repeat schedule.");
          }
          const rule = { frequency: input.repeat.frequency, interval, startDate: draft.date };
          const next = nextOccurrence(rule, draft.date)!;
          const template = await tx.recurringExpense.create({
            data: {
              groupId: input.groupId,
              description: draft.description.trim(),
              payload: { ...draft, owed } as unknown as Prisma.InputJsonValue,
              frequency: rule.frequency.toUpperCase() as "WEEKLY" | "MONTHLY" | "YEARLY",
              interval,
              startDate: toDbDate(draft.date),
              lastPostedOn: toDbDate(draft.date),
              nextRunOn: toDbDate(next),
              createdById: actor.id,
            },
          });
          recurringId = template.id;
        }
        const expense = await tx.expense.create({ data: { ...expenseRowData(input.groupId, draft, owed, actor.id), recurringId } });
        await tx.activityLog.create({
          data: {
            groupId: input.groupId,
            actorId: actor.id,
            action: "EXPENSE_CREATED",
            entityType: "expense",
            entityId: expense.id,
            summary: `${actor.displayName} added ${label}${input.repeat ? ` · repeats ${input.repeat.frequency}` : ""}`,
            diff: { after: snapshot(draft, owed) },
          },
        });
      });
    }
    revalidateGroup(input.groupId);
  });
}

export async function deleteExpense(groupId: string, expenseId: string) {
  return run(async () => {
    const actor = await requireMember(groupId);
    const e = await prisma.expense.findFirst({ where: { id: expenseId, groupId, deletedAt: null } });
    if (!e) throw new UserError("Expense not found.");
    await prisma.$transaction([
      prisma.expense.update({ where: { id: e.id }, data: { deletedAt: new Date() } }),
      prisma.activityLog.create({
        data: {
          groupId,
          actorId: actor.id,
          action: "EXPENSE_DELETED",
          entityType: "expense",
          entityId: e.id,
          summary: `${actor.displayName} deleted “${e.description}” (${formatMoney(Number(e.amount), e.currency)})`,
          diff: { before: { description: e.description, amount: Number(e.amount), currency: e.currency } },
        },
      }),
    ]);
    revalidateGroup(groupId);
  });
}

export async function restoreExpense(groupId: string, expenseId: string) {
  return run(async () => {
    const actor = await requireMember(groupId);
    const e = await prisma.expense.findFirst({ where: { id: expenseId, groupId, deletedAt: { not: null } } });
    if (!e) throw new UserError("Nothing to restore.");
    await prisma.$transaction([
      prisma.expense.update({ where: { id: e.id }, data: { deletedAt: null } }),
      prisma.activityLog.create({
        data: { groupId, actorId: actor.id, action: "EXPENSE_RESTORED", entityType: "expense", entityId: e.id, summary: `${actor.displayName} restored “${e.description}”` },
      }),
    ]);
    revalidateGroup(groupId);
  });
}

export async function stopRecurring(groupId: string, templateId: string) {
  return run(async () => {
    await requireMember(groupId);
    await prisma.recurringExpense.updateMany({ where: { id: templateId, groupId }, data: { active: false } });
    revalidateGroup(groupId);
  });
}

// ── settlements ───────────────────────────────────────────────────────────

export async function recordSettlement(input: { groupId: string; fromId: string; toId: string; amount: number; method?: string; date: string }) {
  return run(async () => {
    const actor = await requireMember(input.groupId);
    const members = actor.group.members;
    if (!members.some((m) => m.id === input.fromId) || !members.some((m) => m.id === input.toId) || input.fromId === input.toId) {
      throw new UserError("Pick two different group members.");
    }
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new UserError("Enter an amount greater than zero.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new UserError("Enter a valid date.");
    const method = input.method?.slice(0, 40);
    const currency = actor.group.baseCurrency;

    await prisma.$transaction(async (tx) => {
      const s = await tx.settlement.create({
        data: { groupId: input.groupId, fromId: input.fromId, toId: input.toId, amount: BigInt(input.amount), currency, fxRate: 1, method, date: toDbDate(input.date), createdById: actor.id },
      });
      await tx.activityLog.create({
        data: {
          groupId: input.groupId,
          actorId: actor.id,
          action: "SETTLEMENT_CREATED",
          entityType: "settlement",
          entityId: s.id,
          summary: `${nameIn(members, input.fromId)} paid ${nameIn(members, input.toId)} ${formatMoney(input.amount, currency)}${method ? ` (${method})` : ""}`,
        },
      });
    });
    revalidateGroup(input.groupId);
  });
}

export async function deleteSettlement(groupId: string, settlementId: string) {
  return run(async () => {
    const actor = await requireMember(groupId);
    const s = await prisma.settlement.findFirst({ where: { id: settlementId, groupId, deletedAt: null } });
    if (!s) throw new UserError("Payment not found.");
    const members = actor.group.members;
    await prisma.$transaction([
      prisma.settlement.update({ where: { id: s.id }, data: { deletedAt: new Date() } }),
      prisma.activityLog.create({
        data: {
          groupId,
          actorId: actor.id,
          action: "SETTLEMENT_DELETED",
          entityType: "settlement",
          entityId: s.id,
          summary: `${actor.displayName} undid ${nameIn(members, s.fromId)}'s payment of ${formatMoney(Number(s.amount), s.currency)} to ${nameIn(members, s.toId)}`,
        },
      }),
    ]);
    revalidateGroup(groupId);
  });
}

// ── exchange rates ────────────────────────────────────────────────────────

export async function getExchangeRate(from: string, to: string) {
  return run(async () => {
    if (!(await getCurrentUser())) throw new UserError("Your session expired. Reload the page.");
    return lookupRate(from, to);
  });
}
