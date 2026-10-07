import { convertMinor, convertParts } from "./currency";
import type { Balances, CurrencyCode, Expense, MemberId, Minor, Settlement } from "./types";

/**
 * Net balance per member in the group's base currency.
 * Positive = owed money by the group; negative = owes the group.
 *
 * Each expense is converted with its frozen `fxRate`, and payer/owed parts
 * are converted together so every expense contributes exactly zero to the
 * group total — the invariant `simplifyDebts` relies on.
 */
export function computeBalances(
  memberIds: MemberId[],
  expenses: Expense[],
  settlements: Settlement[],
  baseCurrency: CurrencyCode,
): Balances {
  const balances: Balances = Object.fromEntries(memberIds.map((id) => [id, 0]));
  const add = (id: MemberId, amount: Minor) => (balances[id] = (balances[id] ?? 0) + amount);

  for (const e of expenses) {
    const paid = convertParts(e.payers.map((p) => p.amount), e.currency, baseCurrency, e.fxRate);
    e.payers.forEach((p, i) => add(p.memberId, paid[i]));

    const owedIds = Object.keys(e.owed);
    const owed = convertParts(owedIds.map((id) => e.owed[id]), e.currency, baseCurrency, e.fxRate);
    owedIds.forEach((id, i) => add(id, -owed[i]));
  }

  for (const s of settlements) {
    const amount = convertMinor(s.amount, s.currency, baseCurrency, s.fxRate);
    add(s.fromId, amount); // debtor paid → their debt shrinks
    add(s.toId, -amount); // creditor received → what they're owed shrinks
  }
  return balances;
}

export interface MemberSummary {
  memberId: MemberId;
  /** Total share of expenses this member consumed (base currency). */
  spent: Minor;
  /** Total this member paid out for expenses (base currency). */
  paid: Minor;
  balance: Minor;
}

export function summarizeMembers(
  memberIds: MemberId[],
  expenses: Expense[],
  settlements: Settlement[],
  baseCurrency: CurrencyCode,
): MemberSummary[] {
  const balances = computeBalances(memberIds, expenses, settlements, baseCurrency);
  const spent: Record<MemberId, Minor> = {};
  const paid: Record<MemberId, Minor> = {};
  for (const e of expenses) {
    const ids = Object.keys(e.owed);
    convertParts(ids.map((id) => e.owed[id]), e.currency, baseCurrency, e.fxRate).forEach(
      (v, i) => (spent[ids[i]] = (spent[ids[i]] ?? 0) + v),
    );
    convertParts(e.payers.map((p) => p.amount), e.currency, baseCurrency, e.fxRate).forEach(
      (v, i) => (paid[e.payers[i].memberId] = (paid[e.payers[i].memberId] ?? 0) + v),
    );
  }
  return memberIds.map((id) => ({
    memberId: id,
    spent: spent[id] ?? 0,
    paid: paid[id] ?? 0,
    balance: balances[id] ?? 0,
  }));
}
