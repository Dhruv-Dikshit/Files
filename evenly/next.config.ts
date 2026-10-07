import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * Tesseract runs OCR in a worker thread that loads its own files and
 * dependencies at runtime, which Next's file tracer can't see. Collect the
 * package and everything it depends on so the standalone (Docker) build
 * ships them.
 */
function packageTree(root: string): string[] {
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    const manifest = path.join(process.cwd(), "node_modules", name, "package.json");
    if (!fs.existsSync(manifest)) return;
    seen.add(name);
    const { dependencies = {} } = JSON.parse(fs.readFileSync(manifest, "utf8")) as { dependencies?: Record<string, string> };
    Object.keys(dependencies).forEach(visit);
  };
  visit(root);
  return [...seen].map((name) => `./node_modules/${name}/**/*`);
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle, used by the Docker image (STANDALONE=1).
  output: process.env.STANDALONE ? "standalone" : undefined,
  serverExternalPackages: ["tesseract.js", "tesseract.js-core", "@tesseract.js-data/eng"],
  outputFileTracingIncludes: {
    "/api/receipts/scan": [
      ...packageTree("tesseract.js"),
      "./node_modules/@tesseract.js-data/eng/index.js",
      "./node_modules/@tesseract.js-data/eng/package.json",
      "./node_modules/@tesseract.js-data/eng/4.0.0/**/*",
    ],
  },
};

export default nextConfig;
