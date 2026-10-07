import type { Metadata } from "next";
import { SettleClient } from "@/components/pages/SettleClient";
import { loadGroupPage } from "@/server/load-group";

export const metadata: Metadata = { title: "Settle up · Evenly" };

export default async function SettlePage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const view = await loadGroupPage(groupId, `/groups/${groupId}/settle`);
  return <SettleClient view={view} />;
}
