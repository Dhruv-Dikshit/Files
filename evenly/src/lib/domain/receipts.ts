import { parseMoney } from "./money";
import type { Minor } from "./types";

export interface ScannedReceipt {
  merchant?: string;
  currency?: string;
  items: { label: string; amount: Minor }[];
  /** Tax / service / tip lines, shared proportionally in itemized splits. */
  extras: { label: string; amount: Minor }[];
  total: Minor;
  /** True if a "Total" line was found; otherwise total = items + extras. */
  totalFound: boolean;
  confidence: number; // 0..1, from the OCR engine
  rawText: string;
}

/**
 * Receipt OCR boundary. The server uses Tesseract (runs locally, no API key).
 * Swap for Google Document AI / AWS Textract / a vision LLM for better
 * accuracy on crumpled or handwritten bills — the UI doesn't change.
 */
export interface ReceiptScanner {
  scan(image: Buffer, hints?: { currency?: string }): Promise<ScannedReceipt>;
}

const AMOUNT_AT_END = /^(.*?)[\s.:]*(?:[₹$€£¥]|rs\.?|inr|usd|eur)?\s*(-?\d{1,3}(?:[,.]\d{3})+(?:[.,]\d{1,2})?|-?\d+(?:[.,]\d{1,2})?)\s*[a-z]{0,2}$/i;
const TOTAL = /\b(grand\s*total|total\s*(amount|due|payable)?|amount\s*(due|payable)|net\s*payable|balance\s*due)\b/i;
const EXTRA = /\b(tax|gst|cgst|sgst|igst|vat|mwst|tva|iva|service|svc|tip|gratuity|cess|surcharge)\b/i;
const IGNORE = /\b(sub\s*-?\s*total|subtotal|cash|change|card|visa|mastercard|upi|paid|tender|round(ing)?\s*off|discount\s*total|qty|quantity|invoice|bill\s*no|table|gstin|phone|tel|date|time)\b/i;

/**
 * Turn raw OCR text into line items. Heuristic: a line ending in a price is
 * an item unless it looks like a total, a tax/service line, or payment info.
 * Users review and edit everything before saving.
 */
export function parseReceiptText(text: string, currency: string, confidence = 0): ScannedReceipt {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const items: ScannedReceipt["items"] = [];
  const extras: ScannedReceipt["extras"] = [];
  const totals: Minor[] = [];
  let merchant: string | undefined;

  for (const line of lines) {
    const match = AMOUNT_AT_END.exec(line);
    const label = match?.[1]?.replace(/[\s.:\-–—x×*@]+$/i, "").trim() ?? "";
    // A bare number or a label without letters isn't a line item.
    if (!match || !/[a-z]{2,}/i.test(label)) {
      if (!merchant && /[a-z]{3,}/i.test(line) && !IGNORE.test(line)) merchant = titleCase(line);
      continue;
    }
    const amount = parseMoney(normalizeNumber(match[2]), currency);
    if (amount === null || amount <= 0) continue;

    if (TOTAL.test(label) && !/sub/i.test(label)) totals.push(amount);
    else if (EXTRA.test(label)) extras.push({ label: titleCase(label), amount });
    else if (!IGNORE.test(label)) items.push({ label: titleCase(label), amount });
  }

  const sumItems = items.reduce((a, i) => a + i.amount, 0) + extras.reduce((a, i) => a + i.amount, 0);
  // Receipts often repeat the total (before/after rounding); the largest is the one paid.
  const total = totals.length ? Math.max(...totals) : sumItems;
  return { merchant, currency, items, extras, total, totalFound: totals.length > 0, confidence, rawText: text };
}

/** "1,234.50" / "1.234,50" / "3,50" → "1234.50" / "1234.50" / "3.50". */
function normalizeNumber(raw: string): string {
  let s = raw.replace(/\s/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot && s.length - lastComma <= 3) {
    s = s.replace(/\./g, "").replace(",", "."); // European decimal comma
  } else {
    s = s.replace(/,/g, "");
  }
  return s;
}

function titleCase(s: string) {
  return s.length > 2 && s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s;
}
