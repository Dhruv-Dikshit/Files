"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Group } from "@/lib/types";
import { joinGroup } from "@/server/actions";
import { Avatar, Button, Card, Icon, IconTile, Input, Label, RadioMark, cx } from "@/components/ui/primitives";

/**
 * Join via invite link: pick the placeholder someone already added for you
 * ("I'm Aisha" — you inherit her expenses) or join as a new member.
 * Visitors without a profile just type their name here.
 */
export function JoinClient({ group, userName }: { group: Group; userName: string | null }) {
  const router = useRouter();
  const unclaimed = group.members.filter((m) => !m.claimed && m.status === "active");
  const [choice, setChoice] = useState<string>(unclaimed.length ? "" : "new");
  const [name, setName] = useState(userName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const needsName = choice === "new" || !userName;
  const canSubmit = choice !== "" && (!needsName || name.trim().length > 0);

  return (
    <Card className="mx-auto mt-6 max-w-md space-y-5 p-6">
      <div className="text-center">
        <IconTile size={60} tone={0} className="mx-auto text-[28px]">
          {group.emoji}
        </IconTile>
        <h1 className="mt-3 text-[20px] font-bold leading-8">Join “{group.name}”</h1>
        <div className="mt-3 flex justify-center -space-x-1">
          {group.members.map((m) => (
            <span key={m.id} className="rounded-full ring-2 ring-surface">
              <Avatar member={m} size={28} />
            </span>
          ))}
        </div>
      </div>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await joinGroup({ code: group.inviteCode, claimMemberId: choice === "new" ? undefined : choice, name: needsName ? name : undefined });
            if (result.ok) router.push(`/groups/${result.data}`);
            else setError(result.error);
          });
        }}
      >
        {unclaimed.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="mb-2 text-[14px] font-medium leading-6">Which one are you?</legend>
            {[...unclaimed.map((m) => ({ id: m.id, label: m.name, member: m })), { id: "new", label: "I'm not on this list", member: null }].map((o) => (
              <label
                key={o.id}
                className={cx(
                  "flex cursor-pointer items-center gap-3 rounded-[16px] px-3 py-2 ring-1 transition",
                  choice === o.id ? "bg-cloudy ring-accent" : "bg-hazy ring-transparent",
                )}
              >
                <input type="radio" name="who" value={o.id} checked={choice === o.id} onChange={() => setChoice(o.id)} className="sr-only" />
                <RadioMark checked={choice === o.id} />
                {o.member ? <Avatar member={o.member} size={32} /> : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-muted"><Icon name="add-friend" size={16} /></span>}
                <span className="text-[14px] font-medium leading-6">{o.label}</span>
              </label>
            ))}
          </fieldset>
        )}

        {needsName && (
          <div>
            <Label htmlFor="join-name">{choice === "new" ? "Your name in this group" : "Your name"}</Label>
            <Input id="join-name" required maxLength={60} placeholder="e.g. Priya" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        )}

        {error && <p className="text-[12px] leading-5 text-danger">{error}</p>}
        <Button type="submit" className="w-full" disabled={!canSubmit || pending}>
          {pending ? "Joining…" : "Join group"}
        </Button>
        <p className="text-center text-[11px] leading-5 text-muted">No password needed — this browser remembers you.</p>
      </form>
    </Card>
  );
}
