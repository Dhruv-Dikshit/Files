import { allocate, currencyDecimals } from "./money";
import type { CurrencyCode, Minor } from "./types";

export const COMMON_CURRENCIES: CurrencyCode[] = [
  "INR", "USD", "EUR", "GBP", "JPY", "AED", "SGD", "THB", "AUD", "CAD",
];

/**
 * Convert minor units of `from` into minor units of `to`, where `rate` is
 * "1 major unit of `from` = rate major units of `to`". Handles currencies
 * with different decimal places (e.g. JPY → USD).
 */
export function convertMinor(amount: Minor, from: CurrencyCode, to: CurrencyCode, rate: number): Minor {
  if (from === to) return amount;
  const scale = 10 ** (currencyDecimals(to) - currencyDecimals(from));
  return Math.round(amount * rate * scale);
}

/**
 * Convert several parts of the same total so that the converted parts still
 * sum to the converted total. Converting each part independently can drift
 * by a minor unit, which would break the zero-sum invariant of balances.
 */
export function convertParts(
  parts: Minor[],
  from: CurrencyCode,
  to: CurrencyCode,
  rate: number,
): Minor[] {
  if (from === to) return parts;
  if (parts.some((p) => p < 0)) throw new Error("convertParts: parts must be non-negative");
  const total = parts.reduce((a, b) => a + b, 0);
  if (total === 0) return parts.map(() => 0);
  const convertedTotal = convertMinor(total, from, to, rate);
  return allocate(convertedTotal, parts);
}

export interface ExchangeRateProvider {
  /** Rate such that 1 `from` = rate `to`. */
  getRate(from: CurrencyCode, to: CurrencyCode, date?: string): Promise<number>;
}

/**
 * Production provider backed by the free, keyless Frankfurter API (ECB
 * reference rates). Swap for Open Exchange Rates / Wise in production if you
 * need intraday or exotic currencies. Results are cached per day.
 */
export class FrankfurterRateProvider implements ExchangeRateProvider {
  private cache = new Map<string, number>();

  async getRate(from: CurrencyCode, to: CurrencyCode, date = "latest"): Promise<number> {
    if (from === to) return 1;
    const key = `${date}:${from}:${to}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const res = await fetch(`https://api.frankfurter.app/${date}?from=${from}&to=${to}`);
    if (!res.ok) throw new Error(`Rate lookup failed (${res.status})`);
    const data = (await res.json()) as { rates: Record<string, number> };
    const rate = data.rates[to];
    if (!rate) throw new Error(`No rate for ${from}→${to}`);
    this.cache.set(key, rate);
    return rate;
  }
}

/** Offline fallback used by the demo app and tests (approximate, USD-based). */
const USD_PER_UNIT: Record<CurrencyCode, number> = {
  USD: 1, INR: 0.012, EUR: 1.08, GBP: 1.27, JPY: 0.0067, AED: 0.272,
  SGD: 0.74, THB: 0.028, AUD: 0.66, CAD: 0.73,
};

export class StaticRateProvider implements ExchangeRateProvider {
  async getRate(from: CurrencyCode, to: CurrencyCode): Promise<number> {
    return staticRate(from, to);
  }
}

export function staticRate(from: CurrencyCode, to: CurrencyCode): number {
  if (from === to) return 1;
  const a = USD_PER_UNIT[from];
  const b = USD_PER_UNIT[to];
  if (!a || !b) return 1;
  return Math.round((a / b) * 1e6) / 1e6;
}
