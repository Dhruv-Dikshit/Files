import "server-only";
import { notFound, redirect } from "next/navigation";
import { prisma } from "./db";
import { getGroupView } from "./queries";
import { requireUser } from "./session";

/** Shared loader for group pages: sign-in → membership → data. */
export async function loadGroupPage(groupId: string, path: string) {
  const user = await requireUser(path);
  const view = await getGroupView(groupId, user.id);
  if (view === "not-found") notFound();
  if (view === "not-member") {
    const g = await prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { inviteCode: true } });
    redirect(`/join/${g.inviteCode}`);
  }
  return view;
}
