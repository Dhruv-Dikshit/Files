import { allocate, currencyDecimals } from "./money";
import type { CurrencyCode, Minor } from "./types";

/** Currencies offered in pickers. Live rates (ECB) cover all except AED; that one takes a manual rate. */
export const COMMON_CURRENCIES: CurrencyCode[] = [
  "INR", "USD", "EUR", "GBP", "JPY", "AED", "SGD", "THB", "AUD", "CAD", "CHF", "CNY", "HKD", "NZD",
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
