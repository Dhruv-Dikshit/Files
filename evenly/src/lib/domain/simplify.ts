import type { Balances, MemberId, Minor, Transfer } from "./types";

export interface SimplifyOptions {
  /**
   * Up to this many non-zero balances we compute the provably minimal
   * number of transfers (O(2^n · n)). Above it we fall back to a fast
   * greedy that is near-optimal in practice. 15 keeps worst-case under
   * ~50ms in the browser.
   */
  exactLimit?: number;
}

interface Entry {
  id: MemberId;
  amount: Minor; // + creditor, − debtor
}

/**
 * Turn net balances into the minimum set of transfers that settles everyone.
 *
 * Key insight: if the people can be partitioned into k groups whose
 * balances each sum to zero, the group can settle in exactly n − k
 * transfers (each zero-sum group of size s needs s − 1). So minimising
 * transfers = maximising the number of disjoint zero-sum subsets — a
 * subset-DP for small n. Within each subset a greedy largest-creditor ↔
 * largest-debtor pass achieves the s − 1 bound.
 *
 * Input balances must sum to zero (they always do when derived from
 * expenses via `computeBalances`). Amounts are integers in minor units.
 */
export function simplifyDebts(balances: Balances, options: SimplifyOptions = {}): Transfer[] {
  const exactLimit = options.exactLimit ?? 15;
  const entries: Entry[] = Object.entries(balances)
    .filter(([, amount]) => amount !== 0)
    .map(([id, amount]) => {
      if (!Number.isInteger(amount)) throw new Error(`Balance for ${id} is not an integer`);
      return { id, amount };
    })
    // Stable, deterministic order so the same balances always yield the same plan.
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));

  const total = entries.reduce((acc, e) => acc + e.amount, 0);
  if (total !== 0) throw new Error(`Balances must sum to zero (off by ${total})`);
  if (entries.length === 0) return [];

  const groups = entries.length <= exactLimit ? zeroSumPartition(entries) : greedyPartition(entries);
  return groups.flatMap(settleGroup);
}

/** Exact: maximum number of disjoint zero-sum subsets via bitmask DP. */
function zeroSumPartition(entries: Entry[]): Entry[][] {
  const n = entries.length;
  const full = (1 << n) - 1;
  const sums = new Float64Array(1 << n);
  const dp = new Int8Array(1 << n);
  const via = new Int8Array(1 << n); // which element was removed to reach dp[mask]

  for (let mask = 1; mask <= full; mask++) {
    const low = mask & -mask;
    const bit = 31 - Math.clz32(low);
    sums[mask] = sums[mask ^ low] + entries[bit].amount;

    let best = -1;
    let bestBit = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        const v = dp[mask ^ (1 << i)];
        if (v > best) {
          best = v;
          bestBit = i;
        }
      }
    }
    dp[mask] = best + (sums[mask] === 0 ? 1 : 0);
    via[mask] = bestBit;
  }

  // Walk back the chain of removals; every zero-sum mask along it is a
  // boundary, and the differences between consecutive boundaries are
  // themselves zero-sum groups.
  const groups: Entry[][] = [];
  let current: Entry[] = [];
  for (let mask = full; mask !== 0; ) {
    const bit = via[mask];
    current.push(entries[bit]);
    mask ^= 1 << bit;
    if (sums[mask] === 0) {
      groups.push(current);
      current = [];
    }
  }
  return groups;
}

/**
 * Fast fallback for large groups: peel off exact debtor/creditor matches
 * (each saves a transfer), then treat the rest as one group.
 */
function greedyPartition(entries: Entry[]): Entry[][] {
  const groups: Entry[][] = [];
  const debtorsByAmount = new Map<Minor, Entry[]>();
  for (const e of entries) {
    if (e.amount < 0) {
      const list = debtorsByAmount.get(-e.amount) ?? [];
      list.push(e);
      debtorsByAmount.set(-e.amount, list);
    }
  }
  const used = new Set<Entry>();
  for (const e of entries) {
    if (e.amount <= 0) continue;
    const match = debtorsByAmount.get(e.amount)?.pop();
    if (match) {
      groups.push([e, match]);
      used.add(e).add(match);
    }
  }
  const rest = entries.filter((e) => !used.has(e));
  if (rest.length > 0) groups.push(rest);
  return groups;
}

/** Greedy settle within a zero-sum group: ≤ size − 1 transfers. */
function settleGroup(group: Entry[]): Transfer[] {
  const creditors = group.filter((e) => e.amount > 0).map((e) => ({ ...e }));
  const debtors = group.filter((e) => e.amount < 0).map((e) => ({ id: e.id, amount: -e.amount }));
  const byAmountDesc = (a: Entry, b: Entry) => b.amount - a.amount || a.id.localeCompare(b.id);
  const transfers: Transfer[] = [];

  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort(byAmountDesc);
    debtors.sort(byAmountDesc);
    const c = creditors[0];
    const d = debtors[0];
    const amount = Math.min(c.amount, d.amount);
    transfers.push({ from: d.id, to: c.id, amount });
    c.amount -= amount;
    d.amount -= amount;
    if (c.amount === 0) creditors.shift();
    if (d.amount === 0) debtors.shift();
  }
  return transfers;
}
