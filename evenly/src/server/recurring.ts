import "server-only";
import { Prisma, type Frequency as DbFrequency } from "@/generated/prisma/client";
import { formatMoney } from "@/lib/domain/money";
import { dueOccurrences, nextOccurrence, type RecurrenceRule } from "@/lib/domain/recurring";
import type { ExpenseDraft } from "@/lib/types";
import { prisma } from "./db";
import { isoDate, toDbDate } from "./mappers";
import { expenseRowData } from "./write";

/** Today's date in the server's time zone (set TZ in docker-compose). */
export const localToday = () => new Date().toLocaleDateString("en-CA");

export const ruleFromRow = (r: { frequency: DbFrequency; interval: number; startDate: Date; endDate: Date | null }): RecurrenceRule => ({
  frequency: r.frequency.toLowerCase() as RecurrenceRule["frequency"],
  interval: r.interval,
  startDate: isoDate(r.startDate),
  endDate: r.endDate ? isoDate(r.endDate) : undefined,
});

/**
 * Post every due occurrence of active recurring templates. Called when a
 * dashboard or group page loads, so a local install that was off for a
 * week catches up on the next visit. The unique (recurring_id, date)
 * constraint makes this safe to run concurrently.
 */
export async function postDueRecurring(groupIds: string[]) {
  if (groupIds.length === 0) return;
  const today = localToday();
  const templates = await prisma.recurringExpense.findMany({
    where: { groupId: { in: groupIds }, active: true, nextRunOn: { lte: toDbDate(today) } },
  });

  for (const t of templates) {
    const rule = ruleFromRow(t);
    const draft = t.payload as unknown as ExpenseDraft & { owed: Record<string, number> };
    const dates = dueOccurrences(rule, today, t.lastPostedOn ? isoDate(t.lastPostedOn) : undefined);

    for (const date of dates) {
      try {
        await prisma.$transaction(async (tx) => {
          const expense = await tx.expense.create({
            data: { ...expenseRowData(t.groupId, { ...draft, date }, draft.owed, t.createdById), recurringId: t.id },
          });
          await tx.activityLog.create({
            data: {
              groupId: t.groupId,
              actorId: null,
              action: "RECURRING_POSTED",
              entityType: "expense",
              entityId: expense.id,
              summary: `Recurring “${draft.description}” posted for ${date} (${formatMoney(draft.amount, draft.currency)})`,
            },
          });
        });
      } catch (err) {
        // Another request already posted this occurrence.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      }
    }

    const last = dates.at(-1) ?? (t.lastPostedOn ? isoDate(t.lastPostedOn) : undefined);
    const next = nextOccurrence(rule, last ?? today);
    await prisma.recurringExpense.update({
      where: { id: t.id },
      data: {
        lastPostedOn: last ? toDbDate(last) : null,
        ...(next ? { nextRunOn: toDbDate(next) } : { active: false }),
      },
    });
  }
}
