import { DashboardClient } from "@/components/pages/DashboardClient";
import { listGroupsForUser } from "@/server/queries";
import { requireUser } from "@/server/session";

export default async function DashboardPage() {
  const user = await requireUser("/");
  const rows = await listGroupsForUser(user.id);
  return <DashboardClient rows={rows} userName={user.displayName} />;
}
