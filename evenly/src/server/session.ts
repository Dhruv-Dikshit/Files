import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./db";

/**
 * Lightweight identity for a self-hosted app: each browser gets a profile
 * (just a display name) stored in a long-lived, httpOnly cookie holding the
 * user's random UUID. No passwords — anyone who can reach your localhost /
 * LAN can create a profile, which is the intended trust model for a
 * personal or household install. Put it behind real auth before exposing
 * it to the internet.
 */
const COOKIE = "evenly_uid";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getCurrentUser() {
  const id = (await cookies()).get(COOKIE)?.value;
  if (!id || !UUID.test(id)) return null;
  return prisma.user.findUnique({ where: { id } });
}

export async function requireUser(next = "/") {
  const user = await getCurrentUser();
  if (!user) redirect(`/welcome?next=${encodeURIComponent(next)}`);
  return user;
}

/** Only callable from Server Actions / Route Handlers (cookie writes). */
export async function signIn(userId: string) {
  (await cookies()).set(COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365 * 5,
  });
}
