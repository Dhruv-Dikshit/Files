"use client";

import { useRef, useState } from "react";
import { formatMoney } from "@/lib/domain/money";
import type { ScannedReceipt } from "@/lib/domain/receipts";
import { Avatar, Button, cx } from "@/components/ui/primitives";
import type { ExpenseForm } from "./useExpenseForm";

/**
 * Itemized split: line items, each assigned to one or more people (split
 * equally among them). Anything between the items' sum and the bill total
 * (tax, tip, service charge) is shared in proportion to what people ordered.
 */
export function ItemizedEditor({ form }: { form: ExpenseForm }) {
  const { state, dispatch, members, itemsTotal, itemsExtra, total, split } = form;
  const includedMembers = members.filter((m) => state.included.includes(m.id));

  return (
    <div className="space-y-3">
      <ReceiptScanButton form={form} />

      {state.items.length === 0 && (
        <p className="rounded-2xl border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Scan a receipt or add items manually, then tap people to assign each item.
        </p>
      )}

      <ul className="space-y-2">
        {state.items.map((item) => (
          <li key={item.id} className="rounded-2xl p-3 ring-1 ring-zinc-200 dark:ring-zinc-800">
            <div className="flex gap-2">
              <input
                aria-label="Item name"
                placeholder="Item name"
                value={item.label}
                onChange={(e) => dispatch({ type: "updateItem", id: item.id, patch: { label: e.target.value } })}
                className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
              />
              <input
                aria-label="Item amount"
                inputMode="decimal"
                placeholder="0.00"
                value={item.amount}
                onChange={(e) => dispatch({ type: "updateItem", id: item.id, patch: { amount: e.target.value } })}
                className="w-24 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-900"
              />
              <button type="button" aria-label="Remove item" onClick={() => dispatch({ type: "removeItem", id: item.id })} className="px-1 text-zinc-400 hover:text-red-500">
                ✕
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {includedMembers.map((m) => {
                const on = item.assignees.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => dispatch({ type: "toggleItemAssignee", id: item.id, memberId: m.id })}
                    className={cx(
                      "flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 text-xs ring-1 transition",
                      on ? "bg-emerald-50 text-emerald-800 ring-emerald-400 dark:bg-emerald-950 dark:text-emerald-200" : "text-zinc-400 ring-zinc-200 dark:ring-zinc-700",
                    )}
                  >
                    <Avatar member={m} size={18} dimmed={!on} />
                    {m.name}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>

      <Button variant="secondary" className="w-full" onClick={() => dispatch({ type: "addItem" })}>
        + Add item
      </Button>

      {state.items.length > 0 && (
        <dl className="space-y-1 rounded-2xl bg-zinc-50 p-3 text-sm dark:bg-zinc-950">
          <Row label="Items" value={formatMoney(itemsTotal, state.currency)} />
          <Row
            label={itemsExtra >= 0 ? "Tax / tip / service (shared proportionally)" : "Items exceed the total"}
            value={formatMoney(itemsExtra, state.currency)}
            warn={itemsExtra < 0}
          />
          <Row label="Bill total" value={formatMoney(total, state.currency)} strong />
          {Object.keys(split.owed).length > 0 && (
            <div className="mt-2 border-t border-zinc-200 pt-2 dark:border-zinc-800">
              {members
                .filter((m) => split.owed[m.id] !== undefined)
                .map((m) => (
                  <Row key={m.id} label={m.name} value={formatMoney(split.owed[m.id], state.currency)} />
                ))}
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

function Row({ label, value, strong, warn }: { label: string; value: string; strong?: boolean; warn?: boolean }) {
  return (
    <div className={cx("flex justify-between gap-4", strong && "font-semibold", warn && "text-orange-600")}>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * Upload a bill photo → POST /api/receipts/scan (Tesseract OCR on the
 * server) → line items the user reviews and assigns.
 */
function ReceiptScanButton({ form }: { form: ExpenseForm }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "scanning" | "done" | "empty" | "error">("idle");
  const [found, setFound] = useState<{ items: number; totalFound: boolean } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function onFile(file: File) {
    setPreview(URL.createObjectURL(file));
    setStatus("scanning");
    try {
      const body = new FormData();
      body.append("receipt", file);
      body.append("currency", form.state.currency);
      const res = await fetch("/api/receipts/scan", { method: "POST", body });
      if (!res.ok) throw new Error(await res.text());
      const receipt = (await res.json()) as ScannedReceipt;
      if (receipt.items.length === 0) {
        setStatus("empty");
        return;
      }
      form.dispatch({ type: "loadReceipt", receipt, included: form.state.included });
      setFound({ items: receipt.items.length, totalFound: receipt.totalFound });
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-emerald-50 to-teal-50 p-3 dark:from-emerald-950 dark:to-teal-950">
      {preview ? (
        <img src={preview} alt="Receipt preview" className="h-12 w-12 rounded-lg object-cover" />
      ) : (
        <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-white text-2xl dark:bg-zinc-900">🧾</span>
      )}
      <div className="flex-1 text-sm">
        <p className="font-medium">Scan receipt</p>
        <p className="text-xs text-zinc-500">
          {status === "scanning" && "Reading line items… (first scan takes a few seconds)"}
          {status === "done" &&
            found &&
            `Found ${found.items} items${found.totalFound ? " and the total" : ""} — check them against the bill, then assign.`}
          {status === "empty" && "No line items recognised. Try a sharper, well-lit photo, or add items manually."}
          {status === "error" && "Couldn't read that receipt. Try again or add items manually."}
          {status === "idle" && "Upload a photo to auto-fill items (OCR)."}
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
      <Button variant="secondary" disabled={status === "scanning"} onClick={() => inputRef.current?.click()}>
        {status === "scanning" ? "Scanning…" : "Upload"}
      </Button>
    </div>
  );
}
