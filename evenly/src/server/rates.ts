import "server-only";
import { prisma } from "./db";
import { toDbDate } from "./mappers";
import { localToday } from "./recurring";

export interface RateResult {
  rate: number;
  /** Date the rate was published (ECB publishes on working days). */
  date: string;
  source: "ecb";
}

/**
 * Live reference rate via Frankfurter (European Central Bank data, free, no
 * API key), cached in `exchange_rates` for the day so repeated lookups are
 * instant and work offline once fetched. Returns null when the currency
 * isn't covered or the network is down — the form then asks for a manual
 * rate, which is always allowed.
 */
export async function lookupRate(from: string, to: string): Promise<RateResult | null> {
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return null;
  if (from === to) return { rate: 1, date: localToday(), source: "ecb" };

  const today = toDbDate(localToday());
  const cached = await prisma.exchangeRate.findUnique({ where: { base_quote_date: { base: from, quote: to, date: today } } });
  if (cached) return { rate: Number(cached.rate), date: localToday(), source: "ecb" };

  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { date: string; rates: Record<string, number> };
    const rate = data.rates?.[to];
    if (!(rate > 0)) return null;
    await prisma.exchangeRate.upsert({
      where: { base_quote_date: { base: from, quote: to, date: today } },
      create: { base: from, quote: to, date: today, rate },
      update: { rate },
    });
    return { rate, date: data.date, source: "ecb" };
  } catch {
    return null;
  }
}
