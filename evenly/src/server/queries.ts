import "server-only";
import { computeBalances } from "@/lib/domain/balances";
import type { GroupView } from "@/lib/types";
import { prisma } from "./db";
import { expenseInclude, toActivity, toExpense, toGroup, toRecurring, toSettlement } from "./mappers";
import { postDueRecurring } from "./recurring";

/** Dashboard rows: every group the user belongs to, with their balance. */
export async function listGroupsForUser(userId: string) {
  const memberships = await prisma.groupMember.findMany({
    where: { userId, group: { archivedAt: null } },
    select: { id: true, groupId: true },
  });
  const groupIds = memberships.map((m) => m.groupId);
  await postDueRecurring(groupIds);

  const groups = await prisma.group.findMany({
    where: { id: { in: groupIds } },
    include: {
      members: true,
      expenses: { where: { deletedAt: null }, include: expenseInclude },
      settlements: { where: { deletedAt: null } },
    },
    orderBy: { createdAt: "desc" },
  });

  return groups.map((g) => {
    const group = toGroup(g);
    const order = group.members.map((m) => m.id);
    const balances = computeBalances(
      order,
      g.expenses.map((e) => toExpense(e, order)),
      g.settlements.map(toSettlement),
      g.baseCurrency,
    );
    const meId = memberships.find((m) => m.groupId === g.id)!.id;
    return { group, meId, balance: balances[meId] ?? 0, expenseCount: g.expenses.length };
  });
}

/** Everything the group screens need, or null if the user isn't a member. */
export async function getGroupView(groupId: string, userId: string): Promise<GroupView | "not-found" | "not-member"> {
  if (!/^[0-9a-f-]{36}$/i.test(groupId)) return "not-found";
  const exists = await prisma.group.findUnique({ where: { id: groupId }, select: { id: true } });
  if (!exists) return "not-found";
  const me = await prisma.groupMember.findFirst({ where: { groupId, userId }, select: { id: true } });
  if (!me) return "not-member";

  await postDueRecurring([groupId]);

  const g = await prisma.group.findUniqueOrThrow({
    where: { id: groupId },
    include: {
      members: {
        include: { _count: { select: { payments: true, splits: true, itemAssignments: true, settlementsIn: true, settlementsOut: true } } },
      },
      expenses: { where: { deletedAt: null }, include: expenseInclude, orderBy: [{ date: "desc" }, { createdAt: "desc" }] },
      settlements: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
      activity: { orderBy: { createdAt: "desc" }, take: 300 },
      recurring: { where: { active: true }, orderBy: { createdAt: "asc" } },
    },
  });

  const group = toGroup(g);
  const order = group.members.map((m) => m.id);
  const removableIds = g.members
    .filter((m) => m.userId === null && Object.values(m._count).every((c) => c === 0))
    .map((m) => m.id);

  return {
    group,
    meId: me.id,
    expenses: g.expenses.map((e) => toExpense(e, order)),
    settlements: g.settlements.map(toSettlement),
    activity: g.activity.map(toActivity),
    recurring: g.recurring.map(toRecurring),
    removableIds,
  };
}

export async function findGroupByCode(code: string) {
  const g = await prisma.group.findUnique({
    where: { inviteCode: code.trim().toUpperCase() },
    include: { members: true },
  });
  return g ? toGroup(g) : null;
}
