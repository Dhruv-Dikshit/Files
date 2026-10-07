# Evenly: Architecture and Product Design

A modern group expense splitter: groups, flexible splits with per-expense include/exclude, multi-currency, receipt OCR, recurring costs, an audit trail, and minimal settle-up transfers.

---

## 1. Product analysis

How the main products compare, and what Evenly takes from each:

| Capability | Splitwise | Splid | Tricount | Settle Up | **Evenly** |
|---|---|---|---|---|---|
| Equal / exact / % / shares | ✅ | ✅ | ✅ | ✅ | ✅ |
| Itemized (receipt line items) | Pro only | ❌ | ❌ | ❌ | ✅ free, tax/tip shared proportionally |
| Multiple payers per expense | ✅ | ✅ | ✅ | ✅ | ✅ |
| Debt simplification | ✅ (heuristic) | ✅ | ✅ | ✅ | ✅ **provably minimal** for ≤15 people, greedy above |
| Multi-currency | Pro (conversion) | ✅ | ✅ | ✅ | ✅ rate frozen per expense, editable |
| Receipt scanning | Pro | ❌ | ❌ | ❌ | ✅ via a pluggable OCR boundary |
| Recurring expenses | ✅ | ❌ | ❌ | ✅ | ✅ idempotent posting, month-end safe |
| No account needed | ❌ | ✅ (no accounts) | ✅ (link) | partial | ✅ guest link + upgrade later |
| Audit / activity log | basic | ❌ | basic | ✅ | ✅ before→after diffs, restorable |
| Export | CSV (Pro) | PDF/Excel | Excel | ✅ | ✅ CSV + print-to-PDF |
| Offline-first | ❌ | ✅ | ✅ | ✅ | planned (PWA + sync queue) |

**What people complain about elsewhere, and how Evenly handles it**
1. *Paywalled basics* (daily expense limits, itemizing, scanning). Everything core is free here.
2. *"Why do I owe Bob when I never paid him?"* Simplification moves debts between people. The settle screen says so and shows the number of payments saved ("4 payments instead of 10").
3. *Penny drift*. Every amount is an integer in minor units, and splits use largest-remainder allocation, so the shares always add up exactly to the total.
4. *Disputes over edits*. Every change is written to an append-only activity log with before/after snapshots.
5. *Onboarding friction*. Splid and Tricount win here because one person can create a group and share a link. Evenly copies that with guest mode.

---

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Web app | **Next.js 16 (App Router) + React 19 + TypeScript** | Server Components for fast first paint, Server Actions for mutations, one codebase for UI and API |
| Styling | **Tailwind CSS v4** | Fast to build a consistent, responsive mobile-first UI; dark mode built in |
| Database | **PostgreSQL (Supabase)** | Relational integrity for money (FKs, transactions, CHECK constraints), easy SQL reporting |
| ORM | **Prisma 7** | Typed queries and migrations (`prisma/schema.prisma`) |
| Realtime | **Supabase Realtime** (Postgres changes / broadcast per group) | Live updates when a groupmate adds an expense, with no extra infrastructure |
| Auth | **Supabase Auth** with **anonymous sign-ins** | Guest mode: an anonymous user can later link email/OAuth and keep the same `user_id` |
| Files | **Supabase Storage** | Receipt images, signed URLs |
| OCR | `ReceiptScanner` interface → Google Document AI Expense / AWS Textract AnalyzeExpense / vision LLM | Swappable. The demo ships a mock |
| FX rates | Frankfurter (ECB) → cached in `exchange_rates` | Free and keyless. Swap for Open Exchange Rates if you need intraday rates |
| Jobs | **Vercel Cron** or **Supabase pg_cron** → `/api/cron/recurring`, `/api/cron/rates` | Recurring expenses and daily rate refresh |
| Client data | TanStack Query + Realtime invalidation | Optimistic updates, cache, retry |
| Mobile | PWA first; **Expo (React Native)** later, reusing `src/lib/domain` unchanged | The domain layer has no framework imports |
| Tests | Vitest (domain), Playwright (E2E) | |

**Why not Firebase?** Balances are relational aggregates over expenses, splits and settlements. Postgres can enforce "splits sum to the amount" inside a transaction, and Supabase still provides realtime and auth. Firestore would push those invariants into client code.

### High-level architecture

```
┌──────────────── Client (Next.js, PWA) ─────────────────┐
│  UI components ──► useExpenseForm / hooks              │
│        │                 │                             │
│        │      src/lib/domain (pure TS: splits,         │
│        │      simplify, balances, currency, recurring) │
│        ▼                                               │
│  TanStack Query cache ◄── Supabase Realtime channel ───┼──┐
└────────┬───────────────────────────────────────────────┘  │
         │ Server Actions / Route Handlers                  │
┌────────▼─────────── Next.js server ──────────────────┐    │
│  validate (zod) → recompute split with the SAME      │    │
│  domain code → Prisma $transaction:                  │    │
│     expense + payers + splits + items + activity_log │    │
└────────┬─────────────────────────────────────────────┘    │
         ▼                                                  │
┌──────────── Supabase ────────────────────────────────┐    │
│ Postgres (RLS by group membership) ── changes ───────┼────┘
│ Auth (anonymous + email/OAuth) · Storage (receipts)  │
│ pg_cron → recurring + FX refresh                     │
└──────────────────────────────────────────────────────┘
          ▲ OCR provider (Document AI / Textract)
```

**Rule:** the server never trusts client-computed amounts. It receives the *split config* (type, included members, inputs), re-runs `computeSplit` from `src/lib/domain`, and persists the result. Client and server share the same function, so the preview always matches what gets saved.

### Realtime sync
- Each open group subscribes to `group:{id}`. After a mutation commits, the server broadcasts `{type: "expense.created", id, version}`, and clients invalidate or patch their cache.
- Edits use **optimistic concurrency**: `expenses.version` is sent with the edit and the update runs `WHERE version = $v`. On a conflict the client re-fetches and shows "Aisha just edited this expense".
- Balances are **derived, not stored**. They are recomputed from expenses and settlements (cheap: a trip has hundreds of rows, not millions). For very large groups, add a materialized `member_balances` view refreshed by trigger.

---

## 3. Data model

Full schema: [`prisma/schema.prisma`](../prisma/schema.prisma). Generated SQL: [`prisma/migrations/0001_init/migration.sql`](../prisma/migrations/0001_init/migration.sql).

```
users 1───* group_members *───1 groups
                │                 │
                │                 ├──* expenses ──* expense_payers   (who paid, multi-payer)
                │                 │        ├──────* expense_splits   (who owes, included members only)
                │                 │        └──────* expense_items ──* expense_item_assignees
                │                 ├──* settlements (from_member → to_member)
                │                 ├──* recurring_expenses ──* expenses (generated)
                │                 └──* activity_log
                └── (nullable user_id → guests & placeholder people)
exchange_rates (base, quote, date) cache
```

| Table | Key columns | Notes |
|---|---|---|
| `users` | id, email?, display_name, default_currency, is_anonymous | `is_anonymous` = guest session |
| `groups` | name, emoji, base_currency, invite_code (unique), guest_access, simplify_debts | `invite_code` powers links and codes |
| `group_members` | group_id, user_id?, display_name, role, status (ACTIVE/INACTIVE), is_guest, claim_token | **The unit of debt.** Nullable `user_id` means you can add "Grandma" without an account; `claim_token` lets a real account claim the member later |
| `expenses` | amount BIGINT, currency, fx_rate, split_type, date, receipt_url, recurring_id, version, deleted_at | Soft delete for the audit trail; `@@unique(recurring_id, date)` makes recurring posting idempotent |
| `expense_payers` | (expense_id, member_id), amount | Σ amount = expense.amount |
| `expense_splits` | (expense_id, member_id), owed_amount, input_value | **Exclusion = no row.** `input_value` stores the typed %/shares/exact so the edit form re-hydrates |
| `expense_items` / `expense_item_assignees` | label, amount, from_ocr | Itemized splits |
| `settlements` | from_member_id, to_member_id, amount, currency, fx_rate, method | Recording a payment moves both balances toward zero |
| `recurring_expenses` | payload JSON, frequency, interval, start/end, last_posted_on, next_run_on | Index `(active, next_run_on)` for the cron scan |
| `activity_log` | actor_member_id, action, entity_type/id, summary, diff JSON | Append-only, written in the same transaction as the change |

**Money invariants** (enforced in the domain layer, and recommended as a deferred constraint trigger in SQL):
- `SUM(expense_payers.amount) = expenses.amount`
- `SUM(expense_splits.owed_amount) = expenses.amount`
- For each group: `Σ balances = 0`

**Balance of member m** (in the group's base currency):
```
Σ paid(m)·fx − Σ owed(m)·fx + Σ settlements_out(m)·fx − Σ settlements_in(m)·fx
```
Payer and owed parts of one expense are converted *together* (`convertParts`), so rounding can never break the zero-sum invariant.

**Security (Supabase RLS):** every table with `group_id` gets a policy like
`using (exists (select 1 from group_members gm where gm.group_id = <table>.group_id and gm.user_id = auth.uid() and gm.status = 'ACTIVE'))`.
Anonymous (guest) users pass the same policy once they've joined. Inviting is done by a server action that checks `invite_code` and `guest_access`.

---

## 4. Debt simplification

Code: [`src/lib/domain/simplify.ts`](../src/lib/domain/simplify.ts)

1. Compute each member's net balance (positive = owed, negative = owes). The balances sum to 0.
2. **Key fact:** if the members can be split into *k* disjoint groups whose balances each sum to zero, everyone can settle in exactly **n − k** transfers (a zero-sum group of size *s* needs *s − 1* transfers). So minimizing the number of transfers is the same as **maximizing the number of zero-sum subsets**.
3. For ≤ 15 non-zero members, a bitmask DP finds the optimal partition in O(2ⁿ·n), which takes a few ms.
4. Within each subset, a greedy pass pays the largest debtor to the largest creditor. Each step zeroes at least one person, so it uses ≤ *s − 1* transfers, which meets the bound.
5. Above 15 members (the general problem is NP-hard), it falls back to: peel off exact debtor/creditor matches first, then greedy. In practice this is near-optimal.

Example where plain greedy is sub-optimal: balances `{A:+6, B:+5, C:−5, D:−4, E:−2}`. Greedy pays 6↔5 first and needs **4** transfers. Evenly finds `{B,C}` and `{A,D,E}` and needs **3**. This case is covered in `domain.test.ts`, along with 200 randomized cases checking that every plan settles everyone in ≤ n−1 transfers.

```ts
simplifyDebts({ a: 6, b: 5, c: -5, d: -4, e: -2 });
// → [{from:"d",to:"a",amount:4}, {from:"e",to:"a",amount:2}, {from:"c",to:"b",amount:5}]
```

---

## 5. UI/UX plan

### Screen flow
```
Dashboard ──tap group──► Group View ──[+ Add expense]──► Add/Edit Expense sheet
    │                       │  tabs: Expenses · Balances · Activity · Members
    │                       ├──[Settle up →]──► Settlement screen ──[Mark paid]──► Record payment sheet
    │                       └──Members tab──► invite link/code, add/deactivate/remove, recurring list
    ├──[+ New group]──► Create group sheet
    └──[Join code] / invite link ──► /join/[code] (guest: name only) ──► Group View
```

### Component hierarchy (as implemented)
```
RootLayout (app/layout.tsx)
└── Providers (store hydration → in prod: QueryClient + Realtime)
    ├── Dashboard (app/page.tsx)
    │   ├── Totals cards (owed / owe, per currency)
    │   ├── Group list rows (emoji, avatars, your balance)
    │   ├── Join-by-code form
    │   └── CreateGroupModal
    ├── GroupPage (app/groups/[groupId]/page.tsx)
    │   ├── Group header (your balance, per-member chips, Settle up, "viewing as")
    │   ├── Segmented tabs
    │   │   ├── ExpenseList (expenses + settlements, "you lent / borrowed", excluded count)
    │   │   ├── BalancesPanel (bars, paid vs share, Export CSV, Save as PDF)
    │   │   ├── ActivityFeed (timeline + before→after DiffView)
    │   │   └── MembersPanel (invite link, add/deactivate/remove, recurring templates)
    │   └── AddExpenseModal ◄── the core form
    │       └── AddExpenseForm (useExpenseForm hook)
    │           ├── Description · Amount · Currency · FxRow (rate, ≈ base amount)
    │           ├── Category chips · Date · RepeatControl
    │           ├── PaidBySection (one person │ multiple people + "left to cover")
    │           ├── Segmented split type (Equally │ Exact │ % │ Shares │ Items)
    │           ├── MemberSplitList  ◄── include/exclude toggle + per-type input + live share
    │           │   └── PerMemberInput (exact/percent with "rest" button, shares −/+)
    │           ├── ItemizedEditor (ReceiptScanButton → /api/receipts/scan, item rows with
    │           │                   assignee chips, items / tax-tip / total summary)
    │           ├── SplitStatus ("₹120 left to assign", "✓ ₹600 each for 5 people")
    │           └── Sticky footer (first validation error, Delete, Cancel, Save)
    ├── SettlePage (app/groups/[groupId]/settle/page.tsx)
    │   ├── Plan summary ("4 payments instead of 10")
    │   ├── Transfer cards (highlighted when they involve you) → RecordPaymentModal (partial payments, method)
    └── JoinPage (app/join/[code]/page.tsx): guest onboarding
```

### Add Expense UX decisions
- **One list does two jobs.** Each member row is both the include/exclude toggle and the input for the current split type. Tapping a name excludes that person (greyed out, struck through, ₹0) and everyone else's share updates immediately. There are no separate "participants" and "amounts" steps.
- **Typed values survive split-type changes.** Inputs are stored per type (`exact`, `percent`, `shares`), so switching Exact → % → Exact doesn't lose what was entered.
- **"rest" button.** Fills the remaining amount or percentage into that person's field, which is the fastest way to finish an exact or % split.
- **Validation always visible.** The remaining amount is shown under the list, and the Save button is disabled until the split is valid. The first error appears in the footer.
- **Payer ≠ participant.** You can pay for something you didn't consume (exclude yourself).
- **Itemized:** a receipt scan fills the items and the bill total. Each item starts shared by everyone included, and you tap people off. Tax, tip and service are the difference between the items and the total, shared in proportion to what each person ordered.
- **Mobile-first:** opens as a bottom sheet on phones and a centered dialog on desktop, uses a native `<dialog>` (focus trap, Esc to close), numeric keyboards via `inputMode="decimal"`, and a sticky action bar.

---

## 6. Server-side mutation (production shape)

```ts
// app/groups/[groupId]/actions.ts
"use server";
export async function createExpense(groupId: string, input: ExpenseInput) {
  const member = await requireMember(groupId);                 // auth + RLS-equivalent check
  const parsed = expenseInputSchema.parse(input);               // zod: amounts are integers, ids belong to group
  const { owed, errors } = computeSplit(parsed.amount, parsed.split); // SAME function as the form
  const payerErrors = validatePayers(parsed.amount, parsed.payers);
  if (errors.length || payerErrors.length) throw new UserError([...errors, ...payerErrors]);

  const expense = await prisma.$transaction(async (tx) => {
    const e = await tx.expense.create({ data: { groupId, ...toRow(parsed), createdById: member.id,
      payers: { create: parsed.payers.map(p => ({ memberId: p.memberId, amount: BigInt(p.amount) })) },
      splits: { create: Object.entries(owed).map(([memberId, amt]) => ({ memberId, owedAmount: BigInt(amt),
                 inputValue: inputFor(parsed.split, memberId) })) },
      items:  { create: itemsFor(parsed.split) } } });
    await tx.activityLog.create({ data: { groupId, actorId: member.id, action: "EXPENSE_CREATED",
      entityType: "expense", entityId: e.id, summary: `${member.displayName} added “${e.description}”`,
      diff: { after: serialize(e) } } });
    return e;
  });
  await broadcast(groupId, { type: "expense.created", id: expense.id });
  revalidatePath(`/groups/${groupId}`);
}
```

Recurring cron (`/api/cron/recurring`, daily): select `recurring_expenses where active and next_run_on <= today`. For each one, `dueOccurrences(rule, today, last_posted_on)` → `createExpense(...)` per date, with `ON CONFLICT (recurring_id, date) DO NOTHING`. Then update `last_posted_on` and `next_run_on`.

---

## 7. Roadmap
- Offline-first PWA: IndexedDB outbox, replayed with idempotency keys
- Payment deep links (UPI `upi://pay`, Venmo, PayPal.me) from the settle screen
- Spending insights by category and person; budget alerts for trips
- Push notifications (web push / Expo) for new expenses and payment reminders
- Native PDF statements (`@react-pdf/renderer`) in addition to print-to-PDF
- Group-level "don't simplify" option (pairwise debts only) for groups that prefer it
