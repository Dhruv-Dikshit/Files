/**
 * Core domain types. All money is stored as integer *minor units*
 * (cents, paise, yen) to avoid floating-point drift. A `Minor` is always an
 * integer; conversion to/from display strings lives in `money.ts`.
 */

export type Minor = number;
export type MemberId = string;
export type CurrencyCode = string; // ISO 4217, e.g. "INR", "USD", "JPY"

export type SplitType = "equal" | "exact" | "percent" | "shares" | "itemized";

export type MemberStatus = "active" | "inactive";

export interface Member {
  id: MemberId;
  name: string;
  status: MemberStatus;
  /** True once a real person (browser profile) has joined as this member. */
  claimed?: boolean;
  avatarColor?: string;
}

export interface Payer {
  memberId: MemberId;
  amount: Minor;
}

export interface LineItem {
  id: string;
  label: string;
  amount: Minor;
  /** Members who consumed this item; the item is split equally among them. */
  assignees: MemberId[];
}

export type ExpenseCategory =
  | "food"
  | "groceries"
  | "transport"
  | "lodging"
  | "entertainment"
  | "utilities"
  | "rent"
  | "shopping"
  | "other";

/** What the user configured — enough to re-open the form and edit. */
export interface SplitConfig {
  type: SplitType;
  /** Members participating in this expense (the include/exclude toggles). */
  included: MemberId[];
  exact?: Record<MemberId, Minor>;
  percent?: Record<MemberId, number>;
  shares?: Record<MemberId, number>;
  items?: LineItem[];
}

export interface Expense {
  id: string;
  groupId: string;
  description: string;
  category: ExpenseCategory;
  /** Amount in the expense's own currency (minor units of `currency`). */
  amount: Minor;
  currency: CurrencyCode;
  /**
   * Multiplier converting 1 major unit of `currency` to the group's base
   * currency, frozen at entry time so balances never shift retroactively.
   */
  fxRate: number;
  payers: Payer[];
  split: SplitConfig;
  /** Resolved owed amount per member, in `currency` minor units. */
  owed: Record<MemberId, Minor>;
  date: string; // ISO date
  createdBy: MemberId;
  createdAt: string;
  updatedAt: string;
  recurringId?: string;
  receiptUrl?: string;
  /** Optimistic-concurrency token; edits must send the version they started from. */
  version?: number;
}

export interface Settlement {
  id: string;
  groupId: string;
  fromId: MemberId; // payer of the settlement (debtor)
  toId: MemberId; // receiver (creditor)
  amount: Minor;
  currency: CurrencyCode;
  fxRate: number;
  date: string;
  createdBy: MemberId;
  note?: string;
}

/** Positive = the member is owed money; negative = the member owes. */
export type Balances = Record<MemberId, Minor>;

export interface Transfer {
  from: MemberId;
  to: MemberId;
  amount: Minor;
}
