import { computeBalances } from "./balances";
import { minorToInput } from "./money";
import { simplifyDebts } from "./simplify";
import type { CurrencyCode, Expense, Member, Settlement } from "./types";

interface ExportInput {
  groupName: string;
  baseCurrency: CurrencyCode;
  members: Member[];
  expenses: Expense[];
  settlements: Settlement[];
}

/**
 * CSV export: one row per expense with a column per member showing their
 * net effect (paid − owed) in the expense currency, followed by a balance
 * summary and the suggested settle-up plan. Opens cleanly in Excel/Sheets.
 */
export function exportGroupCSV({ groupName, baseCurrency, members, expenses, settlements }: ExportInput): string {
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? "Unknown";
  const rows: (string | number)[][] = [];

  rows.push([`Group: ${groupName}`], []);
  rows.push(["Date", "Description", "Category", "Currency", "Amount", "Paid by", "Split", ...members.map((m) => m.name)]);

  for (const e of [...expenses].sort((a, b) => a.date.localeCompare(b.date))) {
    const paidBy = e.payers.map((p) => `${name(p.memberId)} ${minorToInput(p.amount, e.currency)}`).join("; ");
    const perMember = members.map((m) => {
      const paid = e.payers.filter((p) => p.memberId === m.id).reduce((a, p) => a + p.amount, 0);
      const net = paid - (e.owed[m.id] ?? 0);
      return net === 0 ? "" : minorToInput(net, e.currency);
    });
    rows.push([e.date, e.description, e.category, e.currency, minorToInput(e.amount, e.currency), paidBy, e.split.type, ...perMember]);
  }

  for (const s of settlements) {
    rows.push([s.date, `Settlement: ${name(s.fromId)} → ${name(s.toId)}`, "settlement", s.currency, minorToInput(s.amount, s.currency), name(s.fromId), "", ...members.map(() => "")]);
  }

  const balances = computeBalances(members.map((m) => m.id), expenses, settlements, baseCurrency);
  rows.push([], [`Balances (${baseCurrency})`]);
  for (const m of members) rows.push([m.name, minorToInput(balances[m.id] ?? 0, baseCurrency)]);

  rows.push([], ["Suggested settle-up"]);
  for (const t of simplifyDebts(balances)) {
    rows.push([`${name(t.from)} pays ${name(t.to)}`, minorToInput(t.amount, baseCurrency)]);
  }

  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

function csvCell(value: string | number): string {
  let s = String(value);
  // Neutralise spreadsheet formula injection from user-entered text.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
