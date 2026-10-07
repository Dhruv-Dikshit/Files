import { computeSplit } from "@/lib/domain/splits";
import { staticRate } from "@/lib/domain/currency";
import type { Expense, SplitConfig } from "@/lib/domain/types";
import { avatarColor } from "./ids";
import type { AppState, Group } from "./types";

const goa: Group = {
  id: "g_goa",
  name: "Trip to Goa",
  emoji: "🏖️",
  baseCurrency: "INR",
  inviteCode: "GOA-7K3P",
  createdAt: "2026-09-20T10:00:00.000Z",
  members: ["You", "Aisha", "Rohan", "Meera", "Kabir"].map((name, i) => ({
    id: `m_${name.toLowerCase()}`,
    name,
    status: "active" as const,
    avatarColor: avatarColor(i),
  })),
};

const flat: Group = {
  id: "g_flat",
  name: "Apartment 402",
  emoji: "🏠",
  baseCurrency: "INR",
  inviteCode: "APT-9QWX",
  createdAt: "2026-06-01T10:00:00.000Z",
  members: ["You", "Dev", "Sana"].map((name, i) => ({
    id: `f_${name.toLowerCase()}`,
    name,
    status: "active" as const,
    avatarColor: avatarColor(i + 3),
  })),
};

function expense(
  group: Group,
  id: string,
  description: string,
  category: Expense["category"],
  amount: number,
  payers: Expense["payers"],
  split: SplitConfig,
  date: string,
  currency = "INR",
): Expense {
  const { owed, errors } = computeSplit(amount, split);
  if (errors.length) throw new Error(`Seed expense ${id} invalid: ${errors.join(", ")}`);
  return {
    id,
    groupId: group.id,
    description,
    category,
    amount,
    currency,
    fxRate: staticRate(currency, group.baseCurrency),
    payers,
    split,
    owed,
    date,
    createdBy: payers[0].memberId,
    createdAt: `${date}T12:00:00.000Z`,
    updatedAt: `${date}T12:00:00.000Z`,
  };
}

const g = (n: string) => `m_${n}`;
const all = goa.members.map((m) => m.id);

export const seedState: AppState = {
  version: 1,
  groups: [goa, flat],
  me: { [goa.id]: "m_you", [flat.id]: "f_you" },
  expenses: [
    expense(goa, "e1", "Villa booking (3 nights)", "lodging", 4_500_000, [{ memberId: g("you"), amount: 4_500_000 }], { type: "equal", included: all }, "2026-09-25"),
    expense(goa, "e2", "Scooter rentals", "transport", 600_000, [{ memberId: g("rohan"), amount: 600_000 }], { type: "shares", included: all, shares: { [g("you")]: 1, [g("aisha")]: 1, [g("rohan")]: 2, [g("meera")]: 1, [g("kabir")]: 1 } }, "2026-09-25"),
    expense(goa, "e3", "Dinner at Thalassa", "food", 1_240_000, [{ memberId: g("aisha"), amount: 740_000 }, { memberId: g("meera"), amount: 500_000 }], { type: "equal", included: [g("you"), g("aisha"), g("meera"), g("kabir")] }, "2026-09-26"),
    expense(goa, "e4", "Scuba diving", "entertainment", 18_000, [{ memberId: g("kabir"), amount: 18_000 }], { type: "exact", included: [g("you"), g("kabir"), g("rohan")], exact: { [g("you")]: 6_000, [g("kabir")]: 6_000, [g("rohan")]: 6_000 } }, "2026-09-27", "USD"),
  ],
  settlements: [],
  recurring: [
    {
      id: "r_wifi",
      groupId: flat.id,
      active: true,
      rule: { frequency: "monthly", interval: 1, startDate: "2026-07-05" },
      draft: {
        description: "Wi-Fi (Airtel Fiber)",
        category: "utilities",
        amount: 119_900,
        currency: "INR",
        fxRate: 1,
        payers: [{ memberId: "f_dev", amount: 119_900 }],
        split: { type: "equal", included: flat.members.map((m) => m.id) },
        owed: computeSplit(119_900, { type: "equal", included: flat.members.map((m) => m.id) }).owed,
        date: "2026-07-05",
      },
    },
  ],
  activity: [
    { id: "a1", groupId: goa.id, actorId: g("you"), action: "group_created", summary: "You created the group", at: goa.createdAt },
    { id: "a2", groupId: goa.id, actorId: g("you"), action: "expense_created", summary: "You added “Villa booking (3 nights)”", at: "2026-09-25T12:00:00.000Z" },
    { id: "a3", groupId: goa.id, actorId: g("rohan"), action: "expense_created", summary: "Rohan added “Scooter rentals”", at: "2026-09-25T13:00:00.000Z" },
    { id: "a4", groupId: goa.id, actorId: g("aisha"), action: "expense_created", summary: "Aisha added “Dinner at Thalassa”", at: "2026-09-26T21:00:00.000Z" },
    { id: "a5", groupId: goa.id, actorId: g("kabir"), action: "expense_created", summary: "Kabir added “Scuba diving” ($180.00)", at: "2026-09-27T16:00:00.000Z" },
    { id: "a6", groupId: flat.id, actorId: "f_you", action: "group_created", summary: "You created the group", at: flat.createdAt },
  ],
};
