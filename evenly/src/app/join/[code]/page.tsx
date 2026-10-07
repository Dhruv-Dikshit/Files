import { redirect } from "next/navigation";
import { JoinClient } from "@/components/pages/JoinClient";
import { Card } from "@/components/ui/primitives";
import { prisma } from "@/server/db";
import { findGroupByCode } from "@/server/queries";
import { getCurrentUser } from "@/server/session";

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const code = decodeURIComponent((await params).code);
  const [group, user] = await Promise.all([findGroupByCode(code), getCurrentUser()]);

  if (!group) {
    return (
      <Card className="mt-10 py-12 text-center">
        <p className="text-3xl">🔍</p>
        <p className="mt-2 font-medium">Invite code “{code}” not found</p>
        <p className="text-sm text-zinc-500">Check the code with whoever invited you.</p>
      </Card>
    );
  }

  if (user && (await prisma.groupMember.findFirst({ where: { groupId: group.id, userId: user.id }, select: { id: true } }))) {
    redirect(`/groups/${group.id}`);
  }
  return <JoinClient group={group} userName={user?.displayName ?? null} />;
}
