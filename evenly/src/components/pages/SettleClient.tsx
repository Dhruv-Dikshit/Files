"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { computeBalances } from "@/lib/domain/balances";
import { formatMoney, minorToInput, parseMoney } from "@/lib/domain/money";
import { simplifyDebts } from "@/lib/domain/simplify";
import type { Transfer } from "@/lib/domain/types";
import { today } from "@/lib/ids";
import type { GroupView } from "@/lib/types";
import { recordSettlement } from "@/server/actions";
import { Avatar, Button, Card, Input, Label, Modal, cx } from "@/components/ui/primitives";

/**
 * Settlement screen: the optimised transfer plan, how many payments it
 * saves versus paying everyone back individually, and "Mark as paid".
 */
export function SettleClient({ view }: { view: GroupView }) {
  const { group, meId, expenses, settlements } = view;
  const [paying, setPaying] = useState<Transfer | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);

  const { transfers, naiveCount } = useMemo(() => {
    const balances = computeBalances(group.members.map((m) => m.id), expenses, settlements, group.baseCurrency);
    // "Naive" = every pairwise debt implied by individual expenses, for the "saved N payments" stat.
    const pairs = new Set<string>();
    for (const e of expenses) {
      for (const debtor of Object.keys(e.owed)) {
        for (const p of e.payers) if (p.memberId !== debtor && e.owed[debtor] > 0) pairs.add([debtor, p.memberId].sort().join("|"));
      }
    }
    return { transfers: simplifyDebts(balances), naiveCount: pairs.size };
  }, [group, expenses, settlements]);

  const name = (id: string) => group.members.find((m) => m.id === id)!;
  const shown = onlyMine ? transfers.filter((t) => t.from === meId || t.to === meId) : transfers;

  return (
    <div className="space-y-5">
      <Link href={`/groups/${group.id}`} className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        ← {group.name}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">Settle up</h1>
        {transfers.length > 0 ? (
          <p className="text-sm text-zinc-500">
            {transfers.length} {transfers.length === 1 ? "payment" : "payments"} settle everyone
            {naiveCount > transfers.length && <> — instead of {naiveCount} without simplification</>}.
          </p>
        ) : (
          <p className="text-sm text-zinc-500">Nothing to settle.</p>
        )}
      </div>

      {transfers.length === 0 ? (
        <Card className="py-14 text-center">
          <p className="text-4xl">🎉</p>
          <p className="mt-2 font-medium">Everyone is settled up</p>
        </Card>
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
            Only show payments involving me
          </label>
          <ul className="space-y-2">
            {shown.map((t) => {
              const involvesMe = t.from === meId || t.to === meId;
              return (
                <li key={`${t.from}-${t.to}`}>
                  <Card className={cx("flex items-center gap-3", involvesMe && "ring-2 ring-emerald-400")}>
                    <Avatar member={name(t.from)} size={36} />
                    <div className="flex-1 text-sm">
                      <p>
                        <b>{t.from === meId ? "You" : name(t.from).name}</b> pay{t.from === meId ? "" : "s"}{" "}
                        <b>{t.to === meId ? "you" : name(t.to).name}</b>
                      </p>
                      <p className="text-lg font-semibold tabular-nums">{formatMoney(t.amount, group.baseCurrency)}</p>
                    </div>
                    <span className="text-zinc-300">→</span>
                    <Avatar member={name(t.to)} size={36} />
                    <Button variant={involvesMe ? "primary" : "secondary"} onClick={() => setPaying(t)}>
                      Mark paid
                    </Button>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <p className="text-xs text-zinc-500">
        Balances are combined across all expenses and simplified so the group needs the fewest possible payments. Amounts are in {group.baseCurrency}; foreign
        expenses use the rate saved when they were added.
      </p>

      {paying && (
        <RecordPaymentModal
          transfer={paying}
          currency={group.baseCurrency}
          fromName={name(paying.from).name}
          toName={name(paying.to).name}
          onClose={() => setPaying(null)}
          onConfirm={(amount, method) =>
            recordSettlement({ groupId: group.id, fromId: paying.from, toId: paying.to, amount, method, date: today() })
          }
        />
      )}
    </div>
  );
}

/** Allows partial payments: defaults to the full suggested amount. */
function RecordPaymentModal({ transfer, currency, fromName, toName, onClose, onConfirm }: { transfer: Transfer; currency: string; fromName: string; toName: string; onClose: () => void; onConfirm: (amount: number, method: string) => Promise<{ ok: boolean; error?: string }> }) {
  const [amount, setAmount] = useState(minorToInput(transfer.amount, currency));
  const [method, setMethod] = useState("UPI");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const minor = parseMoney(amount, currency) ?? 0;
  return (
    <Modal open onClose={onClose} title="Record a payment">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (minor <= 0) return;
          startTransition(async () => {
            const result = await onConfirm(minor, method);
            if (result.ok) onClose();
            else setError(result.error ?? "Couldn't record the payment.");
          });
        }}
      >
        <p className="text-sm">
          <b>{fromName}</b> paid <b>{toName}</b>
        </p>
        <div>
          <Label htmlFor="pay-amt">Amount ({currency})</Label>
          <Input id="pay-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-lg font-semibold" />
          {minor > 0 && minor < transfer.amount && <p className="mt-1 text-xs text-zinc-500">Partial payment — {formatMoney(transfer.amount - minor, currency)} will remain.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {["UPI", "Cash", "Bank transfer", "Card"].map((m) => (
            <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)} className={cx("rounded-full px-3 py-1 text-xs ring-1", method === m ? "bg-zinc-900 text-white ring-zinc-900 dark:bg-white dark:text-zinc-900" : "ring-zinc-200 dark:ring-zinc-700")}>
              {m}
            </button>
          ))}
        </div>
        {error && <p className="text-sm text-orange-600">{error}</p>}
        <Button type="submit" className="w-full" disabled={minor <= 0 || pending}>
          {pending ? "Saving…" : "Confirm payment"}
        </Button>
      </form>
    </Modal>
  );
}
