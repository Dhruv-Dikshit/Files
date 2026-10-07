"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { COMMON_CURRENCIES } from "@/lib/domain/currency";
import { formatMoney } from "@/lib/domain/money";
import type { Group } from "@/lib/types";
import { createGroup } from "@/server/actions";
import { Amount, Avatar, Button, Card, Input, Label, Modal } from "@/components/ui/primitives";

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
      {rows.length > 0 && (
        <section className="grid grid-cols-2 gap-3">
          {[...totals.entries()].map(([cur, t]) => (
            <div key={cur} className="contents">
              <Card>
                <p className="text-xs uppercase tracking-wide text-zinc-500">You are owed</p>
                <p className="text-2xl font-semibold tabular-nums text-emerald-600">{formatMoney(t.owed, cur)}</p>
              </Card>
              <Card>
                <p className="text-xs uppercase tracking-wide text-zinc-500">You owe</p>
                <p className="text-2xl font-semibold tabular-nums text-orange-600">{formatMoney(t.owe, cur)}</p>
              </Card>
            </div>
          ))}
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Your groups</h1>
          <Button onClick={() => setCreating(true)}>+ New group</Button>
        </div>

        {rows.length === 0 ? (
          <Card className="py-12 text-center">
            <p className="text-4xl">👋</p>
            <p className="mt-2 font-medium">Welcome, {userName}!</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-500">
              Create a group for a trip, your flat or a dinner — or join one with an invite code from a friend.
            </p>
            <Button className="mt-4" onClick={() => setCreating(true)}>
              Create your first group
            </Button>
          </Card>
        ) : (
          <ul className="space-y-2">
            {rows.map(({ group, balance, expenseCount }) => (
              <li key={group.id}>
                <Link
                  href={`/groups/${group.id}`}
                  className="flex items-center gap-4 rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70 transition hover:ring-emerald-400 dark:bg-zinc-900 dark:ring-zinc-800"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-2xl dark:bg-zinc-800">{group.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{group.name}</span>
                    <span className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                      <span className="flex -space-x-1.5">
                        {group.members.slice(0, 5).map((m) => (
                          <span key={m.id} className="rounded-full ring-2 ring-white dark:ring-zinc-900">
                            <Avatar member={m} size={18} />
                          </span>
                        ))}
                      </span>
                      {group.members.length} {group.members.length === 1 ? "person" : "people"} · {expenseCount} {expenseCount === 1 ? "expense" : "expenses"}
                    </span>
                  </span>
                  <span className="text-right text-xs">
                    <span className="block text-zinc-500">{balance === 0 ? "all settled" : balance > 0 ? "you get back" : "you owe"}</span>
                    {balance !== 0 && <Amount value={balance}>{formatMoney(Math.abs(balance), group.baseCurrency)}</Amount>}
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
          <Button type="submit" variant="secondary" disabled={!code.trim()}>
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
            const result = await createGroup({ name, emoji, baseCurrency: currency, memberNames: members.split(",") });
            if (!result.ok) return setError(result.error);
            onClose();
            onCreated(result.data);
          });
        }}
      >
        <div className="flex gap-2">
          <div className="w-20">
            <Label htmlFor="emoji">Icon</Label>
            <Input id="emoji" value={emoji} maxLength={4} onChange={(e) => setEmoji(e.target.value)} className="text-center text-xl" />
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
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {COMMON_CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-500">Balances are shown in this currency. Individual expenses can use any currency.</p>
        </div>
        <div>
          <Label htmlFor="gmembers">Add people (comma separated)</Label>
          <Input id="gmembers" placeholder="Alice, Bob, Chen" value={members} onChange={(e) => setMembers(e.target.value)} />
          <p className="mt-1 text-xs text-zinc-500">They don&apos;t need to sign up — you can track their share right away and send them the invite link later.</p>
        </div>
        {error && <p className="text-sm text-orange-600">{error}</p>}
        <Button type="submit" className="w-full" disabled={!name.trim() || pending}>
          {pending ? "Creating…" : "Create group"}
        </Button>
      </form>
    </Modal>
  );
}
