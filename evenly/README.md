# Evenly: group expense splitting

A modern take on Splitwise/Splid. Create groups, add expenses with flexible splits, include or exclude people per expense, and settle up in the fewest payments.

**→ Full design doc: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** (product analysis, stack, schema, algorithm, UI plan)

## Quick start

```bash
cd evenly
npm install        # .npmrc sets legacy-peer-deps (works around an npm peer-dep resolver bug)
npm run dev        # http://localhost:3000, seeded with a "Trip to Goa" demo group
npm test           # domain unit tests (splits, simplification, currency, recurring, export)
npm run typecheck
```

The demo runs entirely in the browser (state is saved to localStorage), so no database is needed to try it. To use Postgres, set `DATABASE_URL` and run `npm run db:migrate`.

## Features

| | |
|---|---|
| Groups | Create, invite by link or code (`/join/GOA-7K3P`), add, deactivate or remove members |
| Expenses | Single or multiple payers, categories, dates, edit/delete with an audit trail |
| Include/exclude | Tap any member in the split list to leave them out of that expense |
| Split types | Equally · Exact amounts · Percentages · Shares · Itemized (tax/tip shared proportionally) |
| Debt simplification | Provably minimal number of transfers for ≤15 people, greedy fallback above |
| Settlements | Mark paid (full or partial, with method), undo |
| Multi-currency | Per-expense currency with an editable rate frozen at entry; balances in the group's base currency |
| Receipt OCR | Upload a photo and line items are extracted (mock provider behind a `ReceiptScanner` interface) |
| Recurring | Weekly/monthly/yearly; month-end safe; idempotent posting |
| Activity feed | Every create/edit/delete/payment with before→after details |
| Export | CSV (per-member columns, balances, settle plan) and print-to-PDF |
| Guest mode | Join with just a name via an invite link |

## Project layout

```
prisma/schema.prisma            Postgres data model (Users, Groups, GroupMembers, Expenses,
                                ExpensePayers, ExpenseSplits, ExpenseItems, Settlements,
                                RecurringExpenses, ActivityLog, ExchangeRates)
prisma/migrations/0001_init/    Generated SQL
src/lib/domain/                 Pure TypeScript, framework-free, shared by client and server
  money.ts                      minor-unit parsing/formatting, largest-remainder allocate()
  splits.ts                     computeSplit() for all five split types, validatePayers()
  simplify.ts                   simplifyDebts(): minimum transfers
  balances.ts                   computeBalances() with multi-currency, summarizeMembers()
  currency.ts                   convertMinor/convertParts, rate providers
  recurring.ts                  dueOccurrences(), nextOccurrence()
  export.ts                     exportGroupCSV()
  receipts.ts                   ReceiptScanner interface + mock
  domain.test.ts                tests
src/components/expense/         Add Expense form
  useExpenseForm.ts             reducer + derived split preview + validation + toDraft()
  AddExpenseModal.tsx           the sheet: basics, FX, paid-by, split type, status, footer
  MemberSplitList.tsx           include/exclude toggles + per-member inputs + live shares
  PaidBySection.tsx             single / multiple payers
  ItemizedEditor.tsx            line items, assignees, receipt scan
src/components/group/           Expense list, balances, activity feed, members panel
src/app/                        Dashboard, group view, settle-up, guest join, OCR API route
src/lib/store/                  Demo client store (swap for server actions + realtime)
```

## Using the core functions

```ts
import { computeSplit, simplifyDebts, parseMoney } from "@/lib/domain";

const total = parseMoney("3000", "INR")!;           // 300000 paise
computeSplit(total, {
  type: "shares",
  included: ["you", "aisha", "rohan", "meera"],     // Kabir excluded
  shares: { you: 2 },                                // others default to 1
}).owed;
// → { you: 120000, aisha: 60000, rohan: 60000, meera: 60000 }

simplifyDebts({ a: 6, b: 5, c: -5, d: -4, e: -2 }); // 3 transfers (greedy would need 4)
```
