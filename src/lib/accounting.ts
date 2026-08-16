import crypto from "node:crypto";
import { HttpError } from "./http-error";

export async function postAccountEntries(connection: any, input: { referenceType: string; referenceId: number; date?: string | undefined; description: string; customerId?: number | null; supplierId?: number | null; employeeId?: number | null; lines: Array<{ headCode: number; debit?: number; credit?: number }> }) {
  const debit = input.lines.reduce((sum, line) => sum + Number(line.debit ?? 0), 0);
  const credit = input.lines.reduce((sum, line) => sum + Number(line.credit ?? 0), 0);
  if (debit <= 0 || Math.abs(debit - credit) > 0.001) throw new HttpError(500, "Accounting entry is not balanced");
  const transactionNo = `ACC-${input.referenceType.toUpperCase()}-${input.referenceId}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  for (const line of input.lines) await connection.execute("INSERT INTO account_transactions (transaction_no, transaction_date, head_code, debit, credit, reference_type, reference_id, customer_id, supplier_id, employee_id, description) VALUES (?, COALESCE(?, NOW()), ?, ?, ?, ?, ?, ?, ?, ?, ?)", [transactionNo, input.date ?? null, line.headCode, line.debit ?? 0, line.credit ?? 0, input.referenceType, input.referenceId, input.customerId ?? null, input.supplierId ?? null, input.employeeId ?? null, input.description]);
}
