import type { Frequency, RecurrenceRule } from "@/lib/domain/recurring";
import type { CurrencyCode, Expense, ExpenseCategory, Member, MemberId, Payer, Settlement, SplitConfig } from "@/lib/domain/types";

/** UI-facing shapes passed from server components to client components. */

export interface Group {
  id: string;
  name: string;
  emoji: string;
  baseCurrency: CurrencyCode;
  inviteCode: string;
  members: Member[];
  createdAt: string;
}

export type ActivityAction =
  | "group_created"
  | "group_updated"
  | "member_joined"
  | "member_removed"
  | "member_deactivated"
  | "expense_created"
  | "expense_updated"
  | "expense_deleted"
  | "expense_restored"
  | "settlement_created"
  | "settlement_deleted"
  | "recurring_posted";

export interface ActivityEvent {
  id: string;
  groupId: string;
  actorId: MemberId | null;
  action: ActivityAction;
  entityId: string;
  summary: string;
  diff?: { before?: unknown; after?: unknown };
  at: string;
}

/** What the Add Expense form sends to the server. `owed` is recomputed server-side. */
export interface ExpenseDraft {
  description: string;
  category: ExpenseCategory;
  amount: number;
  currency: CurrencyCode;
  fxRate: number;
  payers: Payer[];
  split: SplitConfig;
  date: string;
}

export interface RecurringTemplate {
  id: string;
  description: string;
  amount: number;
  currency: CurrencyCode;
  rule: RecurrenceRule;
  lastPosted?: string;
  nextRun: string;
}

export interface GroupView {
  group: Group;
  meId: MemberId;
  expenses: Expense[];
  settlements: Settlement[];
  activity: ActivityEvent[];
  recurring: RecurringTemplate[];
  /** Members with no history, which may be hard-deleted. */
  removableIds: MemberId[];
}

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export type RepeatInput = { frequency: Frequency; interval: number };
