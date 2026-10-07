import type { CurrencyCode, Minor } from "./types";

const decimalsCache = new Map<string, number>();

/** Number of minor-unit digits for a currency (USD → 2, JPY → 0, BHD → 3). */
export function currencyDecimals(currency: CurrencyCode): number {
  const cached = decimalsCache.get(currency);
  if (cached !== undefined) return cached;
  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    // Unknown code: fall back to 2 decimals.
  }
  decimalsCache.set(currency, digits);
  return digits;
}

/**
 * Parse a user-entered amount ("1,234.5", "12") into minor units without
 * going through floating-point multiplication. Returns null when invalid.
 */
export function parseMoney(input: string | number, currency: CurrencyCode): Minor | null {
  const decimals = currencyDecimals(currency);
  // Tolerate what people actually type: "₹1,234.50", "Rs. 500", "500 rs", "$ 12".
  const raw = String(input)
    .trim()
    .replace(/\b[a-z]{1,3}\.?/gi, "") // currency words/abbreviations (Rs., INR, usd)
    .replace(/[^\d.\-]/g, ""); // symbols, spaces and thousands separators
  if (raw === "") return null;
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(raw);
  if (!match || (match[2] === "" && (match[3] ?? "") === "")) return null;
  const [, sign, whole, frac = ""] = match;
  // Round half-up on the first dropped digit.
  const kept = frac.slice(0, decimals).padEnd(decimals, "0");
  const roundUp = (frac.charCodeAt(decimals) || 48) >= 53; // '5'
  let minor = Number(whole || "0") * 10 ** decimals + Number(kept || "0");
  if (roundUp) minor += 1;
  if (!Number.isSafeInteger(minor)) return null;
  return sign ? -minor : minor;
}

/** Minor units → plain decimal string suitable for an <input>, e.g. 1050 → "10.50". */
export function minorToInput(minor: Minor, currency: CurrencyCode): string {
  const decimals = currencyDecimals(currency);
  return (minor / 10 ** decimals).toFixed(decimals);
}

export function formatMoney(minor: Minor, currency: CurrencyCode, locale?: string): string {
  const decimals = currencyDecimals(currency);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
      minor / 10 ** decimals,
    );
  } catch {
    return `${(minor / 10 ** decimals).toFixed(decimals)} ${currency}`;
  }
}

/**
 * Split `total` into integer parts proportional to `weights`, guaranteeing
 * the parts sum exactly to `total` (largest-remainder / Hamilton method).
 * Leftover minor units go to the largest fractional remainders; ties are
 * broken by input order so results are deterministic.
 */
export function allocate(total: Minor, weights: number[]): Minor[] {
  if (!Number.isInteger(total)) throw new Error(`allocate: total must be an integer, got ${total}`);
  if (weights.length === 0) return [];
  if (weights.some((w) => !(w >= 0) || !Number.isFinite(w))) {
    throw new Error("allocate: weights must be finite and non-negative");
  }
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum === 0) throw new Error("allocate: weights sum to zero");

  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const exact = weights.map((w) => (abs * w) / weightSum);
  const parts = exact.map(Math.floor);
  let leftover = abs - parts.reduce((a, b) => a + b, 0);

  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (let k = 0; leftover > 0; k = (k + 1) % order.length) {
    parts[order[k].index] += 1;
    leftover -= 1;
  }
  return parts.map((p) => (p === 0 ? 0 : p * sign));
}

export function sum(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
