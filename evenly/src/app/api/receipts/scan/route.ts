import { NextResponse } from "next/server";
import { tesseractScanner } from "@/server/ocr";
import { getCurrentUser } from "@/server/session";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  if (!(await getCurrentUser())) return new NextResponse("Not signed in", { status: 401 });

  const form = await request.formData();
  const file = form.get("receipt");
  if (!(file instanceof Blob)) return new NextResponse("Missing receipt image", { status: 400 });
  if (file.size > MAX_BYTES) return new NextResponse("Image too large (max 10 MB)", { status: 413 });
  if (file.type && !file.type.startsWith("image/")) return new NextResponse("Upload an image", { status: 415 });

  const currencyField = form.get("currency");
  const currency = typeof currencyField === "string" && /^[A-Z]{3}$/.test(currencyField) ? currencyField : undefined;

  try {
    const receipt = await tesseractScanner.scan(Buffer.from(await file.arrayBuffer()), { currency });
    return NextResponse.json(receipt);
  } catch (err) {
    console.error("Receipt OCR failed", err);
    return new NextResponse("Couldn't read that image", { status: 422 });
  }
}
