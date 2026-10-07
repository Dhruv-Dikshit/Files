"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { COMMON_CURRENCIES } from "@/lib/domain/currency";
import { formatMoney } from "@/lib/domain/money";
import type { Group } from "@/lib/types";
import { createGroup } from "@/server/actions";
import { Amount, AvatarStack, Button, Card, Icon, IconTile, Input, Label, Modal, selectClass } from "@/components/ui/primitives";
import { callAction } from "@/lib/call-action";

export interface DashboardRow {
  group: Group;
  meId: string;
  balance: number;
  expenseCount: number;
}

/** Dashboard: your position across all groups + entry points to create/join. */
export function DashboardClient({ rows, userName }: { rows: DashboardRow[]; userName: string }) {
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState("");
  const router = useRouter();

  // Totals are per base currency — never add different currencies together.
  const totals = new Map<string, { owed: number; owe: number }>();
  for (const r of rows) {
    const t = totals.get(r.group.baseCurrency) ?? { owed: 0, owe: 0 };
    if (r.balance > 0) t.owed += r.balance;
    else t.owe -= r.balance;
    totals.set(r.group.baseCurrency, t);
  }

  return (
    <div className="space-y-6">
      {rows.length > 0 &&
        [...totals.entries()].map(([cur, t]) => (
          <section key={cur} className="rounded-[28px] bg-hero p-5 text-white">
            <p className="text-[12px] leading-5 text-muted">Your balance · {cur}</p>
            <p className="mt-1 text-[28px] font-medium leading-10 tabular-nums">{formatMoney(t.owed - t.owe, cur)}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-[16px] bg-white/[0.07] px-4 py-3">
                <p className="text-[11px] leading-4 text-muted">You are owed</p>
                <p className="text-[17px] font-bold leading-6 tabular-nums text-action">{formatMoney(t.owed, cur)}</p>
              </div>
              <div className="rounded-[16px] bg-white/[0.07] px-4 py-3">
                <p className="text-[11px] leading-4 text-muted">You owe</p>
                <p className="text-[17px] font-bold leading-6 tabular-nums">{formatMoney(t.owe, cur)}</p>
              </div>
            </div>
          </section>
        ))}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-[20px] font-bold leading-8">Your groups</h1>
          <Button className="px-4 py-2" onClick={() => setCreating(true)}>
            + New group
          </Button>
        </div>

        {rows.length === 0 ? (
          <Card className="px-6 py-10 text-center">
            <IconTile size={60} tone={0} className="mx-auto">
              <Icon name="add-friend" />
            </IconTile>
            <p className="mt-4 text-[17px] font-bold leading-6">Welcome, {userName}!</p>
            <p className="mx-auto mt-1 max-w-sm text-[12px] leading-5 text-muted">
              Create a group for a trip, your flat or a dinner — or join one with an invite code from a friend.
            </p>
            <Button className="mt-5 w-full max-w-[250px]" onClick={() => setCreating(true)}>
              Create your first group
            </Button>
          </Card>
        ) : (
          <ul className="space-y-2">
            {rows.map(({ group, balance, expenseCount }, i) => (
              <li key={group.id}>
                {/* Kit "Order card" */}
                <Link href={`/groups/${group.id}`} className="flex items-center gap-[19px] rounded-[20px] bg-surface px-3 py-2.5 transition hover:ring-2 hover:ring-cloudy">
                  <IconTile size={60} tone={i} className="text-[26px]">
                    {group.emoji}
                  </IconTile>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold leading-6">{group.name}</span>
                    <span className="flex items-center gap-2 text-[11px] leading-6 text-muted">
                      <AvatarStack members={group.members} />
                      {group.members.length} {group.members.length === 1 ? "person" : "persons"} · {expenseCount} {expenseCount === 1 ? "expense" : "expenses"}
                    </span>
                  </span>
                  <span className="text-right">
                    {balance === 0 ? (
                      <span className="block text-[14px] leading-6 text-muted">settled</span>
                    ) : (
                      <Amount value={balance}>{formatMoney(Math.abs(balance), group.baseCurrency)}</Amount>
                    )}
                    <span className="block text-[11px] leading-6 text-muted">{balance === 0 ? "all square" : balance > 0 ? "you get back" : "you owe"}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/join/${encodeURIComponent(code.trim().toUpperCase())}`);
          }}
        >
          <div className="flex-1">
            <Label htmlFor="code">Have an invite code?</Label>
            <Input id="code" placeholder="ABC-12345" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <Button type="submit" variant="action" disabled={!code.trim()}>
            Join
          </Button>
        </form>
      </Card>

      <CreateGroupModal open={creating} onClose={() => setCreating(false)} onCreated={(id) => router.push(`/groups/${id}`)} />
    </div>
  );
}

function CreateGroupModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("✈️");
  const [currency, setCurrency] = useState("INR");
  const [members, setMembers] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Modal open={open} onClose={onClose} title="New group">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await callAction(() => createGroup({ name, emoji, baseCurrency: currency, memberNames: members.split(",") }));
            if (!result.ok) return setError(result.error);
            onClose();
            onCreated(result.data);
          });
        }}
      >
        <div className="flex gap-2">
          <div className="w-20">
            <Label htmlFor="emoji">Icon</Label>
            <Input id="emoji" value={emoji} maxLength={4} onChange={(e) => setEmoji(e.target.value)} className="text-center text-[20px]" />
          </div>
          <div className="flex-1">
            <Label htmlFor="gname">Group name</Label>
            <Input id="gname" autoFocus required maxLength={80} placeholder="Weekend Dinner" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="gcur">Group currency</Label>
          <select
            id="gcur"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className={selectClass}
          >
            {COMMON_CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] leading-4 text-muted">Balances are shown in this currency. Individual expenses can use any currency.</p>
        </div>
        <div>
          <Label htmlFor="gmembers">Add people (comma separated)</Label>
          <Input id="gmembers" placeholder="Alice, Bob, Chen" value={members} onChange={(e) => setMembers(e.target.value)} />
          <p className="mt-1 text-[11px] leading-4 text-muted">They don&apos;t need to sign up — you can track their share right away and send them the invite link later.</p>
        </div>
        {error && <p className="text-[12px] leading-5 text-danger">{error}</p>}
        <Button type="submit" className="w-full" disabled={!name.trim() || pending}>
          {pending ? "Creating…" : "Create group"}
        </Button>
      </form>
    </Modal>
  );
}
