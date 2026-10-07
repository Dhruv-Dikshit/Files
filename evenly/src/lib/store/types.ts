import type { RecurrenceRule } from "@/lib/domain/recurring";
import type { CurrencyCode, Expense, Member, MemberId, Settlement } from "@/lib/domain/types";

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
  | "member_joined"
  | "member_deactivated"
  | "member_reactivated"
  | "member_removed"
  | "expense_created"
  | "expense_updated"
  | "expense_deleted"
  | "settlement_created"
  | "settlement_deleted"
  | "recurring_posted";

export interface ActivityEvent {
  id: string;
  groupId: string;
  actorId: MemberId | null;
  action: ActivityAction;
  summary: string;
  /** Snapshot of the entity before/after the change, for the audit trail. */
  diff?: { before?: unknown; after?: unknown };
  at: string;
}

/** An expense without server-assigned fields — what the Add Expense form produces. */
export type ExpenseDraft = Omit<Expense, "id" | "groupId" | "createdAt" | "updatedAt" | "createdBy">;

export interface RecurringTemplate {
  id: string;
  groupId: string;
  rule: RecurrenceRule;
  draft: ExpenseDraft;
  lastPosted?: string;
  active: boolean;
}

export interface AppState {
  version: 1;
  groups: Group[];
  expenses: Expense[];
  settlements: Settlement[];
  activity: ActivityEvent[];
  recurring: RecurringTemplate[];
  /** Which member "you" are in each group (auth stand-in for the demo). */
  me: Record<string, MemberId>;
}

export type NewSettlement = Omit<Settlement, "id" | "groupId" | "createdBy">;
