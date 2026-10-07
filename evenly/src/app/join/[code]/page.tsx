"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { joinWithCode, useAppState } from "@/lib/store/store";
import { Avatar, Button, Card, Input, Label } from "@/components/ui/primitives";

/**
 * Frictionless guest onboarding: open an invite link, type a name, you're in.
 * Production: signs in with Supabase anonymous auth, creates a guest
 * GroupMember, and offers "save your account" later (link email / OAuth)
 * which upgrades the same user id — no data migration needed.
 */
export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const group = useAppState((s) => s.groups.find((g) => g.inviteCode.toUpperCase() === decodeURIComponent(code).toUpperCase()));
  const [name, setName] = useState("");

  if (!group) {
    return (
      <Card className="mt-10 py-12 text-center">
        <p className="text-3xl">🔍</p>
        <p className="mt-2 font-medium">Invite code “{decodeURIComponent(code)}” not found</p>
        <p className="text-sm text-zinc-500">Check the code with whoever invited you. (Try GOA-7K3P in the demo.)</p>
      </Card>
    );
  }

  return (
    <Card className="mx-auto mt-10 max-w-md space-y-5 p-6">
      <div className="text-center">
        <p className="text-4xl">{group.emoji}</p>
        <h1 className="mt-2 text-xl font-semibold">Join “{group.name}”</h1>
        <div className="mt-3 flex justify-center -space-x-2">
          {group.members.map((m) => (
            <span key={m.id} className="rounded-full ring-2 ring-white dark:ring-zinc-900">
              <Avatar member={m} size={28} />
            </span>
          ))}
        </div>
        <p className="mt-2 text-sm text-zinc-500">{group.members.map((m) => m.name).join(", ")}</p>
      </div>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const id = joinWithCode(group.inviteCode, name);
          if (id) router.push(`/groups/${id}`);
        }}
      >
        <div>
          <Label htmlFor="guest-name">Your name</Label>
          <Input id="guest-name" autoFocus required placeholder="e.g. Priya" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Button type="submit" className="w-full" disabled={!name.trim()}>
          Join as guest
        </Button>
        <p className="text-center text-xs text-zinc-500">No account needed. You can view balances and add expenses right away.</p>
      </form>
    </Card>
  );
}
