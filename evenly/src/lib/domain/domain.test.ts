import { describe, expect, it } from "vitest";
import {
  allocate,
  computeBalances,
  computeSplit,
  convertMinor,
  dueOccurrences,
  exportGroupCSV,
  parseMoney,
  simplifyDebts,
  validatePayers,
  type Balances,
  type Expense,
  type Transfer,
} from "./index";

const sumValues = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

function applyTransfers(balances: Balances, transfers: Transfer[]): Balances {
  const out = { ...balances };
  for (const t of transfers) {
    out[t.from] += t.amount;
    out[t.to] -= t.amount;
  }
  return out;
}

describe("money", () => {
  it("parses user input into minor units without float drift", () => {
    expect(parseMoney("19.99", "USD")).toBe(1999);
    expect(parseMoney("1,234.5", "INR")).toBe(123450);
    expect(parseMoney("0.1", "USD")).toBe(10);
    expect(parseMoney("1.005", "USD")).toBe(101); // half-up
    expect(parseMoney("1500", "JPY")).toBe(1500);
    expect(parseMoney("abc", "USD")).toBeNull();
    expect(parseMoney("", "USD")).toBeNull();
  });

  it("allocates exactly, distributing leftover cents deterministically", () => {
    expect(allocate(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(allocate(100, [2, 1])).toEqual([67, 33]);
    expect(allocate(-1000, [1, 1, 1])).toEqual([-334, -333, -333]);
    const parts = allocate(99_999, [3, 7, 11, 13]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(99_999);
  });
});

describe("computeSplit", () => {
  const people = ["a", "b", "c"];

  it("equal split only charges included members", () => {
    const r = computeSplit(1000, { type: "equal", included: ["a", "c"] });
    expect(r.errors).toEqual([]);
    expect(r.owed).toEqual({ a: 500, c: 500 });
  });

  it("equal split sums to the total with uneven cents", () => {
    const r = computeSplit(1000, { type: "equal", included: people });
    expect(sumValues(r.owed)).toBe(1000);
  });

  it("exact split reports what's left to assign", () => {
    const r = computeSplit(1000, { type: "exact", included: people, exact: { a: 500, b: 300 } });
    expect(r.remaining).toBe(200);
    expect(r.errors.length).toBe(1);
    const ok = computeSplit(1000, { type: "exact", included: people, exact: { a: 500, b: 300, c: 200 } });
    expect(ok.errors).toEqual([]);
  });

  it("percent split must total 100%", () => {
    const bad = computeSplit(1000, { type: "percent", included: people, percent: { a: 50, b: 30 } });
    expect(bad.remaining).toBe(20);
    expect(bad.errors[0]).toMatch(/20% left/);
    const ok = computeSplit(1000, { type: "percent", included: people, percent: { a: 50, b: 25, c: 25 } });
    expect(ok.owed).toEqual({ a: 500, b: 250, c: 250 });
  });

  it("shares split by ratio", () => {
    const r = computeSplit(900, { type: "shares", included: ["a", "b"], shares: { a: 2, b: 1 } });
    expect(r.owed).toEqual({ a: 600, b: 300 });
  });

  it("itemized split spreads tax/tip proportionally and ignores excluded assignees", () => {
    const r = computeSplit(1100, {
      type: "itemized",
      included: ["a", "b"],
      items: [
        { id: "1", label: "Pizza", amount: 600, assignees: ["a", "b"] },
        { id: "2", label: "Wine", amount: 400, assignees: ["a", "c"] }, // c excluded
      ],
    });
    expect(r.errors).toEqual([]);
    // a: 300 + 400 = 700, b: 300 → extra 100 split 70/30
    expect(r.owed).toEqual({ a: 770, b: 330 });
  });

  it("itemized split flags unassigned items and over-total items", () => {
    const unassigned = computeSplit(1000, {
      type: "itemized",
      included: ["a"],
      items: [{ id: "1", label: "Fries", amount: 300, assignees: [] }],
    });
    expect(unassigned.errors[0]).toMatch(/Assign "Fries"/);
    const over = computeSplit(100, {
      type: "itemized",
      included: ["a"],
      items: [{ id: "1", label: "Fries", amount: 300, assignees: ["a"] }],
    });
    expect(over.errors.length).toBeGreaterThan(0);
  });

  it("requires at least one included member", () => {
    expect(computeSplit(1000, { type: "equal", included: [] }).errors).toHaveLength(1);
  });

  it("validates multiple payers against the total", () => {
    expect(validatePayers(1000, [{ memberId: "a", amount: 600 }, { memberId: "b", amount: 400 }])).toEqual([]);
    expect(validatePayers(1000, [{ memberId: "a", amount: 600 }])).toHaveLength(1);
  });
});

describe("simplifyDebts", () => {
  it("settles a simple chain with one transfer", () => {
    // a paid for b, b paid same for c → a is owed by c directly
    const t = simplifyDebts({ a: 1000, b: 0, c: -1000 });
    expect(t).toEqual([{ from: "c", to: "a", amount: 1000 }]);
  });

  it("finds zero-sum subgroups that greedy matching misses", () => {
    // Greedy largest-first pairs 6↔-5 first and needs 4 transfers; optimal
    // partitions {6,-4,-2} and {5,-5} for 3 transfers.
    const balances = { a: 6, b: 5, c: -5, d: -4, e: -2 };
    const t = simplifyDebts(balances);
    expect(t).toHaveLength(3);
    expect(Object.values(applyTransfers(balances, t)).every((v) => v === 0)).toBe(true);
  });

  it("always settles everyone and never exceeds n−1 transfers (randomized)", () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let trial = 0; trial < 200; trial++) {
      const n = 2 + Math.floor(rand() * 14);
      const balances: Balances = {};
      let total = 0;
      for (let i = 0; i < n - 1; i++) {
        const v = Math.floor(rand() * 20_000) - 10_000;
        balances[`m${i}`] = v;
        total += v;
      }
      balances[`m${n - 1}`] = -total;
      const transfers = simplifyDebts(balances);
      const nonZero = Object.values(balances).filter((v) => v !== 0).length;
      expect(transfers.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));
      expect(transfers.every((t) => t.amount > 0)).toBe(true);
      expect(Object.values(applyTransfers(balances, transfers)).every((v) => v === 0)).toBe(true);
    }
  });

  it("uses greedy fallback for large groups and still settles", () => {
    const balances: Balances = {};
    for (let i = 0; i < 40; i++) balances[`p${i}`] = i % 2 === 0 ? 100 * (i + 1) : -100 * i;
    const total = sumValues(balances);
    balances.p0 -= total;
    const t = simplifyDebts(balances);
    expect(Object.values(applyTransfers(balances, t)).every((v) => v === 0)).toBe(true);
  });

  it("rejects balances that don't sum to zero", () => {
    expect(() => simplifyDebts({ a: 10, b: -5 })).toThrow(/sum to zero/);
  });
});

describe("balances & currency", () => {
  const baseExpense = {
    groupId: "g",
    description: "x",
    category: "food" as const,
    date: "2026-01-01",
    createdBy: "a",
    createdAt: "",
    updatedAt: "",
  };

  it("converts across decimal places", () => {
    expect(convertMinor(1000, "JPY", "USD", 0.0067)).toBe(670); // ¥1000 → $6.70
    expect(convertMinor(100, "USD", "INR", 83.25)).toBe(8325);
  });

  it("keeps the group zero-sum with foreign currency and settlements", () => {
    const expenses: Expense[] = [
      {
        ...baseExpense,
        id: "e1",
        amount: 1000,
        currency: "USD",
        fxRate: 83.333,
        payers: [{ memberId: "a", amount: 1000 }],
        split: { type: "equal", included: ["a", "b", "c"] },
        owed: computeSplit(1000, { type: "equal", included: ["a", "b", "c"] }).owed,
      },
    ];
    const settlements = [
      { id: "s1", groupId: "g", fromId: "b", toId: "a", amount: 10000, currency: "INR", fxRate: 1, date: "", createdBy: "b" },
    ];
    const b = computeBalances(["a", "b", "c"], expenses, settlements, "INR");
    expect(sumValues(b)).toBe(0);
    expect(b.b).toBe(-27750 + 10000); // $3.33 share of $10 at 83.333, minus ₹100 settled
  });

  it("exports CSV with escaped cells", () => {
    const csv = exportGroupCSV({
      groupName: "Trip",
      baseCurrency: "USD",
      members: [{ id: "a", name: "Al, \"Jr\"", status: "active" }, { id: "b", name: "=cmd()", status: "active" }],
      expenses: [],
      settlements: [],
    });
    expect(csv).toContain('"Al, ""Jr"""');
    expect(csv).toContain("'=cmd()");
  });
});

describe("recurring", () => {
  it("clamps month-end without drifting", () => {
    const rule = { frequency: "monthly" as const, interval: 1, startDate: "2026-01-31" };
    expect(dueOccurrences(rule, "2026-04-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("only returns occurrences after the last posted date", () => {
    const rule = { frequency: "weekly" as const, interval: 2, startDate: "2026-01-01" };
    expect(dueOccurrences(rule, "2026-02-15", "2026-01-15")).toEqual(["2026-01-29", "2026-02-12"]);
  });
});
