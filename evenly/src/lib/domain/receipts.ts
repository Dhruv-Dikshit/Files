import type { Minor } from "./types";

export interface ScannedReceipt {
  merchant?: string;
  date?: string;
  currency?: string;
  items: { label: string; amount: Minor }[];
  /** Tax / service / tip lines the scanner could separate out. */
  extras: { label: string; amount: Minor }[];
  total: Minor;
  confidence: number; // 0..1
}

/**
 * Receipt OCR boundary. The UI only depends on this interface, so the mock
 * can be swapped for a real provider without touching components:
 *   - Google Document AI "Expense Parser" / AWS Textract AnalyzeExpense
 *   - Azure AI Document Intelligence prebuilt-receipt
 *   - A vision LLM with a JSON schema for line items
 */
export interface ReceiptScanner {
  scan(image: Blob, hints?: { currency?: string }): Promise<ScannedReceipt>;
}

/** Deterministic mock used by the demo `/api/receipts/scan` route. */
export class MockReceiptScanner implements ReceiptScanner {
  async scan(): Promise<ScannedReceipt> {
    await new Promise((r) => setTimeout(r, 900)); // simulate OCR latency
    const items = [
      { label: "Butter Chicken", amount: 42000 },
      { label: "Paneer Tikka", amount: 32000 },
      { label: "Garlic Naan ×4", amount: 24000 },
      { label: "Mango Lassi ×2", amount: 18000 },
      { label: "Kingfisher ×3", amount: 54000 },
    ];
    const extras = [{ label: "GST 5%", amount: 8500 }, { label: "Service 10%", amount: 17000 }];
    const total = [...items, ...extras].reduce((a, i) => a + i.amount, 0);
    return { merchant: "Spice Route, Panjim", currency: "INR", items, extras, total, confidence: 0.92 };
  }
}
