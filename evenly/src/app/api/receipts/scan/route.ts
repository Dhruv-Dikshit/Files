import { NextResponse } from "next/server";
import { MockReceiptScanner, type ReceiptScanner } from "@/lib/domain/receipts";

// Swap for a real provider (Document AI, Textract, Azure, vision LLM) here.
const scanner: ReceiptScanner = new MockReceiptScanner();

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("receipt");
  if (!(file instanceof Blob)) return new NextResponse("Missing receipt image", { status: 400 });
  if (file.size > MAX_BYTES) return new NextResponse("Image too large (max 10 MB)", { status: 413 });
  if (file.type && !file.type.startsWith("image/")) return new NextResponse("Upload an image", { status: 415 });

  const currency = typeof form.get("currency") === "string" ? (form.get("currency") as string) : undefined;
  const receipt = await scanner.scan(file, { currency });
  return NextResponse.json(receipt);
}
