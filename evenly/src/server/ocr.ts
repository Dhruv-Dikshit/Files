import "server-only";
import { createRequire } from "node:module";
import { createWorker, type Worker } from "tesseract.js";
import { parseReceiptText, type ReceiptScanner } from "@/lib/domain/receipts";

const require = createRequire(import.meta.url);

let workerPromise: Promise<Worker> | null = null;

/**
 * One long-lived Tesseract worker per server process. English language
 * data ships inside node_modules (@tesseract.js-data/eng), so OCR works
 * fully offline.
 */
function getWorker() {
  if (!workerPromise) {
    const { langPath } = require("@tesseract.js-data/eng") as { langPath: string };
    workerPromise = createWorker("eng", 1, { langPath, gzip: true, cacheMethod: "none" }).catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

export const tesseractScanner: ReceiptScanner = {
  async scan(image, hints) {
    const worker = await getWorker();
    const { data } = await worker.recognize(image);
    return parseReceiptText(data.text, hints?.currency ?? "INR", (data.confidence ?? 0) / 100);
  },
};
