"use client";

import { useMemo, useState, useTransition } from "react";
import { computeBalances } from "@/lib/domain/balances";
import { formatMoney, minorToInput, parseMoney } from "@/lib/domain/money";
import { simplifyDebts } from "@/lib/domain/simplify";
import type { Transfer } from "@/lib/domain/types";
import { today } from "@/lib/ids";
import type { GroupView } from "@/lib/types";
import { recordSettlement } from "@/server/actions";
import { Avatar, Button, Input, Label, Modal, NavBar, Tag, cx } from "@/components/ui/primitives";

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
      <NavBar title="Settle up" backHref={`/groups/${group.id}`} />

      <section className="rounded-[28px] bg-hero p-5 text-white">
        <p className="text-[12px] leading-5 text-muted">{group.name}</p>
        {transfers.length > 0 ? (
          <>
            <p className="text-[28px] font-medium leading-10">
              {transfers.length} {transfers.length === 1 ? "payment" : "payments"}
            </p>
            <p className="text-[12px] leading-5 text-muted">
              settle everyone
              {naiveCount > transfers.length && (
                <>
                  {" "}
                  — instead of <span className="text-action">{naiveCount}</span> without simplification
                </>
              )}
            </p>
          </>
        ) : (
          <p className="text-[28px] font-medium leading-10">All settled 🎉</p>
        )}
      </section>

      {transfers.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-[14px] leading-6 text-muted">Payments</p>
            <Tag active={onlyMine} onClick={() => setOnlyMine(!onlyMine)} className="text-[11px]">
              Only mine
            </Tag>
          </div>
          <ul className="space-y-2">
            {shown.map((t) => {
              const involvesMe = t.from === meId || t.to === meId;
              return (
                <li key={`${t.from}-${t.to}`} className={cx("flex items-center gap-3 rounded-[20px] bg-surface px-3 py-2.5", involvesMe && "ring-2 ring-cloudy")}>
                  <span className="flex items-center">
                    <Avatar member={name(t.from)} size={36} />
                    <span className="-ml-2 rounded-full ring-2 ring-surface">
                      <Avatar member={name(t.to)} size={36} />
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] leading-5">
                      <b className="font-bold">{t.from === meId ? "You" : name(t.from).name}</b>
                      <span className="text-muted"> pay{t.from === meId ? "" : "s"} </span>
                      <b className="font-bold">{t.to === meId ? "you" : name(t.to).name}</b>
                    </p>
                    <p className="text-[17px] font-bold leading-6 tabular-nums">{formatMoney(t.amount, group.baseCurrency)}</p>
                  </div>
                  {/* Kit "Button S": dark check, yellow (Apply) when it's your payment */}
                  <Button variant={involvesMe ? "action" : "primary"} className="rounded-[14px] px-4 py-2 text-[12px]" onClick={() => setPaying(t)}>
                    ✓ Paid
                  </Button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <p className="text-[11px] leading-5 text-muted">
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
        <p className="text-[14px] leading-6">
          <b>{fromName}</b> paid <b>{toName}</b>
        </p>
        <div>
          <Label htmlFor="pay-amt">Amount ({currency})</Label>
          <Input id="pay-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-[20px] font-bold leading-8" />
          {minor > 0 && minor < transfer.amount && <p className="mt-1 text-[11px] leading-4 text-muted">Partial payment — {formatMoney(transfer.amount - minor, currency)} will remain.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {["UPI", "Cash", "Bank transfer", "Card"].map((m) => (
            <Tag key={m} active={method === m} onClick={() => setMethod(m)} className="py-1.5 text-[12px]">
              {m}
            </Tag>
          ))}
        </div>
        {error && <p className="text-[12px] leading-5 text-danger">{error}</p>}
        <Button type="submit" className="w-full" disabled={minor <= 0 || pending}>
          {pending ? "Saving…" : "Confirm payment"}
        </Button>
      </form>
    </Modal>
  );
}
