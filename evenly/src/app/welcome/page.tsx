import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/session";
import { WelcomeForm } from "./WelcomeForm";

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next = "/" } = await searchParams;
  if (await getCurrentUser()) redirect(next.startsWith("/") ? next : "/");
  return <WelcomeForm next={next} />;
}
