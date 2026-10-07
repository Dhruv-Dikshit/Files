"use client";

import { useRef, useState } from "react";
import { formatMoney } from "@/lib/domain/money";
import type { ScannedReceipt } from "@/lib/domain/receipts";
import { Avatar, Button, Icon, cx } from "@/components/ui/primitives";
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
        <p className="rounded-[20px] border border-dashed border-muted/50 p-4 text-center text-[12px] leading-5 text-muted">
          Scan a receipt or add items manually, then tap people to assign each item.
        </p>
      )}

      <ul className="space-y-2">
        {state.items.map((item) => (
          <li key={item.id} className="rounded-[20px] bg-surface p-3">
            <div className="flex gap-2">
              <input
                aria-label="Item name"
                placeholder="Item name"
                value={item.label}
                onChange={(e) => dispatch({ type: "updateItem", id: item.id, patch: { label: e.target.value } })}
                className="min-w-0 flex-1 bg-transparent text-[14px] font-medium leading-6 outline-none placeholder:text-muted"
              />
              <input
                aria-label="Item amount"
                inputMode="decimal"
                placeholder="0.00"
                value={item.amount}
                onChange={(e) => dispatch({ type: "updateItem", id: item.id, patch: { amount: e.target.value } })}
                className="w-24 rounded-[10px] bg-hazy px-2 py-1 text-right text-[14px] leading-6 tabular-nums outline-none focus:ring-2 focus:ring-accent"
              />
              <button type="button" aria-label="Remove item" onClick={() => dispatch({ type: "removeItem", id: item.id })} className="px-1 text-muted hover:text-danger">
                <Icon name="delete" size={16} />
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
                      "flex items-center gap-1.5 rounded-[30px] py-0.5 pl-0.5 pr-2.5 text-[11px] leading-5 transition",
                      on ? "bg-accent text-white" : "bg-hazy text-muted",
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
        <dl className="space-y-1 rounded-[20px] bg-surface p-4 text-[12px] leading-6">
          <Row label="Items" value={formatMoney(itemsTotal, state.currency)} />
          <Row
            label={itemsExtra >= 0 ? "Tax / tip / service (shared proportionally)" : "Items exceed the total"}
            value={formatMoney(itemsExtra, state.currency)}
            warn={itemsExtra < 0}
          />
          <Row label="Bill total" value={formatMoney(total, state.currency)} strong />
          {Object.keys(split.owed).length > 0 && (
            <div className="mt-2 border-t border-line pt-2">
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
    <div className={cx("flex justify-between gap-4", strong && "text-[14px] font-bold", warn && "text-danger")}>
      <dt className={strong ? "" : "text-muted"}>{label}</dt>
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
    // Kit "List" row ("Open camera") + Button M ("Open camera or upload bill")
    <div className="space-y-3 rounded-[20px] bg-surface p-3">
      <div className="flex items-center gap-4">
        {preview ? (
          <img src={preview} alt="Receipt preview" className="h-[52px] w-[52px] rounded-[16px] object-cover" />
        ) : (
          <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[16px] bg-cloudy text-accent">
            <Icon name="camera" size={16} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-6">Scan receipt</p>
          <p className="text-[11px] leading-4 text-muted">
            {status === "scanning" && "Reading line items… (first scan takes a few seconds)"}
            {status === "done" &&
              found &&
              `Found ${found.items} items${found.totalFound ? " and the total" : ""} — check them against the bill, then assign.`}
            {status === "empty" && "No line items recognised. Try a sharper, well-lit photo, or add items manually."}
            {status === "error" && "Couldn't read that receipt. Try again or add items manually."}
            {status === "idle" && "Fill in items automatically from a photo."}
          </p>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
      <Button className="w-full" disabled={status === "scanning"} onClick={() => inputRef.current?.click()}>
        {status === "scanning" ? "Scanning…" : "Open camera or upload bill"}
      </Button>
    </div>
  );
}
