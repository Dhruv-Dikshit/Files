import type { Metadata } from "next";
import { GroupClient } from "@/components/pages/GroupClient";
import { loadGroupPage } from "@/server/load-group";

export const metadata: Metadata = { title: "Group · Evenly" };

export default async function GroupPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const view = await loadGroupPage(groupId, `/groups/${groupId}`);
  return <GroupClient view={view} />;
}
