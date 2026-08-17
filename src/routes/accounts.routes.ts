import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import crypto from "node:crypto";
import { postAccountEntries } from "../lib/accounting";
import { createPartyCoa } from "../lib/party-coa";

export const accountsRouter = Router();
const id = z.coerce.number().int().positive();
const childInput = z.object({
  parentId: id,
  headName: z.string().trim().min(2).max(100),
  isActive: z.preprocess(value => value === "true" ? true : value === "false" ? false : value, z.boolean()).optional(),
});

const select = `SELECT id, HeadCode AS headCode, HeadName AS name, PHeadName AS parentHeadName, parent_id AS parentId, HeadLevel AS level,
  HeadType AS headType, node_type AS nodeType, allows_manual_children AS allowsManualChildren, IsTransaction AS isTransaction,
  IsGL AS isGl, IsJournal AS isJournal, IsBudget AS isBudget, IsDepreciation AS isDepreciation, customer_id AS customerId,
  aggre_id AS aggreId, supplier_id AS supplierId, employee_id AS employeeId, payment_method_id AS paymentMethodId,
  bank_id AS bankId, is_system AS isSystem, IsActive AS isActive, created_at AS createdAt, updated_at AS updatedAt FROM account_coa`;

function asTree(rows: any[]) {
  const byId = new Map<number, any>();
  const roots: any[] = [];
  for (const row of rows) byId.set(row.id, { ...row, children: [] });
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId).children.push(node);
    else roots.push(node);
  }
  return roots;
}

accountsRouter.get("/coa", asyncHandler(async (_req, res) => {
  const [rows] = await db.query<any[]>(`${select} ORDER BY HeadCode`);
  res.json({ success: true, data: asTree(rows) });
}));

accountsRouter.get("/coa/:id", asyncHandler(async (req, res) => {
  const [rows] = await db.execute<any[]>(`${select} WHERE id = ?`, [id.parse(req.params.id)]);
  if (!rows[0]) throw new HttpError(404, "Account head not found");
  res.json({ success: true, data: rows[0] });
}));

accountsRouter.post("/coa", asyncHandler(async (req, res) => {
  const input = childInput.parse(req.body);
  const parentId = input.parentId;
  const [parents] = await db.execute<any[]>(`${select} WHERE id = ?`, [parentId]);
  const parent = parents[0];
  if (!parent) throw new HttpError(404, "Parent account head not found");
  if (!parent.allowsManualChildren || parent.level >= 4 || parent.nodeType === "ledger" || parent.nodeType === "control") {
    throw new HttpError(400, "A child account cannot be created below this fixed account level");
  }
  const level = Number(parent.level) + 1;
  const nodeType = level >= 3 ? "ledger" : "group";
  const allowsManualChildren = level < 3;
  const [lastChildren] = await db.execute<any[]>("SELECT HeadCode FROM account_coa WHERE parent_id = ? ORDER BY HeadCode DESC LIMIT 1", [parentId]);
  // A sibling always receives the next sequential head code. If this is the first child,
  // reserve two digits below the parent's code (for example 111 -> 11101).
  const nextHeadCode = lastChildren[0] ? Number(lastChildren[0].HeadCode) + 1 : Number(parent.headCode) * 100 + 1;
  const [result] = await db.execute<any>("INSERT INTO account_coa (HeadCode, HeadName, PHeadName, parent_id, HeadLevel, HeadType, node_type, allows_manual_children, IsTransaction, IsGL, IsActive) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [nextHeadCode, input.headName, parent.name, parentId, level, parent.headType, nodeType, allowsManualChildren, nodeType === "ledger", nodeType === "ledger", input.isActive ?? true]);
  const [rows] = await db.execute<any[]>(`${select} WHERE id = ?`, [result.insertId]);
  res.status(201).json({ success: true, data: rows[0] });
}));

const paymentInput = z.object({ amount: z.coerce.number().positive(), paymentMethod: z.enum(["cash", "card", "mobile_banking", "bank_transfer"]), paymentDate: z.string().datetime().optional(), note: z.string().trim().max(1000).nullable().optional() });
const supplierPaymentInput = z.object({
  supplier_id: id,
  purchase_id: id,
  date: z.string().date(),
  remarks: z.string().trim().min(1).max(1000),
  amount: z.coerce.number().positive(),
  payment_method_id: z.coerce.number().int().min(1).max(3),
  account_id: id,
  cheque_number: z.preprocess(value => value === "" ? null : value, z.string().trim().max(100).nullable().optional()),
}).superRefine((input, ctx) => {
  if (input.payment_method_id === 3 && !input.cheque_number) ctx.addIssue({ code: "custom", path: ["cheque_number"], message: "cheque_number is required for cheque payments" });
  if (input.payment_method_id !== 3 && input.cheque_number) ctx.addIssue({ code: "custom", path: ["cheque_number"], message: "cheque_number is only allowed for cheque payments" });
});
const paymentMethodName: Record<number, "cash" | "bank_transfer" | "cheque"> = { 1: "cash", 2: "bank_transfer", 3: "cheque" };
const paymentNo = (prefix: string) => `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
const bankInput = z.object({ name: z.string().trim().min(2).max(150), accountName: z.string().trim().min(2).max(150), accountNumber: z.string().trim().min(2).max(100), branch: z.string().trim().max(150).nullable().optional(), routingNumber: z.string().trim().max(100).nullable().optional(), isActive: z.boolean().optional() });
const bankSelect = "SELECT id, name, account_name AS accountName, account_number AS accountNumber, branch, routing_number AS routingNumber, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt FROM banks";

accountsRouter.get("/banks", asyncHandler(async (_req, res) => { const [rows] = await db.query<any[]>(`${bankSelect} ORDER BY name`); res.json({ success: true, data: rows }); }));
accountsRouter.post("/banks", asyncHandler(async (req, res) => { const input = bankInput.parse(req.body); const connection = await db.getConnection(); try { await connection.beginTransaction(); const [parents] = await connection.execute<any[]>("SELECT id FROM account_coa WHERE HeadCode = 1000102", []); if (!parents[0]) throw new HttpError(400, "Cash at Bank COA head (1000102) is missing"); const [result] = await connection.execute<any>("INSERT INTO banks (name, account_name, account_number, branch, routing_number, is_active) VALUES (?, ?, ?, ?, ?, ?)", [input.name, input.accountName, input.accountNumber, input.branch ?? null, input.routingNumber ?? null, input.isActive ?? true]); const [last] = await connection.execute<any[]>("SELECT HeadCode FROM account_coa WHERE parent_id = ? ORDER BY HeadCode DESC LIMIT 1", [parents[0].id]); const headCode = last[0] ? Number(last[0].HeadCode) + 1 : 100010201; await connection.execute("INSERT INTO account_coa (HeadCode, HeadName, PHeadName, parent_id, HeadLevel, IsActive, IsTransaction, IsGL, IsJournal, HeadType, node_type, allows_manual_children, bank_id, CreateBy, CreateDate) VALUES (?, ?, 'Cash at Bank', ?, 4, ?, TRUE, FALSE, TRUE, 'A', 'ledger', FALSE, ?, 'System', CURDATE())", [headCode, `${result.insertId}-${input.name}`, parents[0].id, input.isActive ?? true, String(result.insertId)]); const [rows] = await connection.execute<any[]>(`${bankSelect} WHERE id = ?`, [result.insertId]); await connection.commit(); res.status(201).json({ success: true, data: rows[0] }); } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); } }));
accountsRouter.patch("/banks/:id", asyncHandler(async (req, res) => { const bankId = id.parse(req.params.id); const input = bankInput.partial().parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, "Provide at least one field to update"); const map: Record<string, string> = { name: "name", accountName: "account_name", accountNumber: "account_number", branch: "branch", routingNumber: "routing_number", isActive: "is_active" }; const fields = Object.entries(input).map(([key, value]) => ({ column: map[key]!, value })); const [result] = await db.query<any>(`UPDATE banks SET ${fields.map(field => `${field.column} = ?`).join(", ")} WHERE id = ?`, [...fields.map(field => field.value), bankId]); if (!result.affectedRows) throw new HttpError(404, "Bank not found"); res.json({ success: true, message: "Bank updated" }); }));
accountsRouter.delete("/banks/:id", asyncHandler(async (req, res) => { const bankId = id.parse(req.params.id); const connection = await db.getConnection(); try { await connection.beginTransaction(); const [result] = await connection.execute<any>("DELETE FROM banks WHERE id = ?", [bankId]); if (!result.affectedRows) throw new HttpError(404, "Bank not found"); await connection.execute("DELETE FROM account_coa WHERE bank_id = ?", [String(bankId)]); await connection.commit(); res.status(204).send(); } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); } }));

// Supplier payments use fixed method IDs: 1 = cash, 2 = bank transfer, 3 = cheque.
accountsRouter.post("/supplier-payments", asyncHandler(async (req, res) => {
  const input = supplierPaymentInput.parse(req.body); const method = paymentMethodName[input.payment_method_id]!; const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [purchases] = await connection.execute<any[]>("SELECT p.total_amount AS totalAmount, p.paid_amount AS paidAmount, s.name AS supplierName FROM purchases p JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ? AND p.supplier_id = ? AND p.status = 'received'", [input.purchase_id, input.supplier_id]);
    const purchase = purchases[0]; if (!purchase) throw new HttpError(400, "Purchase not found for this supplier"); if (Number(purchase.paidAmount) + input.amount > Number(purchase.totalAmount)) throw new HttpError(400, "Payment amount exceeds the remaining purchase balance");
    const [accounts] = await connection.execute<any[]>("SELECT id, HeadCode, bank_id AS bankId FROM account_coa WHERE id = ? AND IsActive = TRUE", [input.account_id]); const account = accounts[0]; if (!account) throw new HttpError(404, "Active account not found");
    if (method === "cash" && Number(account.HeadCode) !== 1000101) throw new HttpError(400, "Cash payment requires the Cash in Hand account");
    if (method !== "cash" && !account.bankId) throw new HttpError(400, "Bank transfer and cheque payments require a bank account");
    let chequeId: number | null = null;
    if (method === "cheque") { const [cheque] = await connection.query<any>("INSERT INTO cheques (cheque_number, cheque_type, amount, account_id, issued_date) VALUES (?, 'issued', ?, ?, ?)", [input.cheque_number, input.amount, input.account_id, input.date]); chequeId = cheque.insertId; await connection.execute("INSERT INTO cheque_statuses (cheque_id, status, status_date, remarks) VALUES (?, 'pending', ?, ?)", [chequeId, input.date, input.remarks]); }
    const number = paymentNo("SUPPAY"); const [payment] = await connection.execute<any>("INSERT INTO supplier_payments (payment_number, supplier_id, purchase_id, payment_date, amount, payment_method, payment_method_id, account_id, cheque_id, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [number, input.supplier_id, input.purchase_id, input.date, input.amount, method, input.payment_method_id, input.account_id, chequeId, input.remarks]);
    const supplierCoa = await createPartyCoa("supplier", input.supplier_id, purchase.supplierName, connection); const creditHead = method === "cheque" ? 2000105 : Number(account.HeadCode);
    await postAccountEntries(connection, { referenceType: "supplier_payment", referenceId: payment.insertId, date: input.date, supplierId: input.supplier_id, description: `Supplier payment ${number}`, lines: [{ headCode: Number(supplierCoa.HeadCode), debit: input.amount }, { headCode: creditHead, credit: input.amount }] });
    await connection.execute("UPDATE purchases SET paid_amount = paid_amount + ? WHERE id = ?", [input.amount, input.purchase_id]);
    await connection.commit(); res.status(201).json({ success: true, data: { id: payment.insertId, payment_number: number, cheque_id: chequeId } });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

accountsRouter.post("/supplier-payments/cheques/:chequeId/pass", asyncHandler(async (req, res) => {
  const chequeId = id.parse(req.params.chequeId); const connection = await db.getConnection();
  try {
    await connection.beginTransaction(); const [rows] = await connection.execute<any[]>("SELECT sp.id AS paymentId, sp.supplier_id AS supplierId, sp.amount, c.account_id AS accountId, c.cheque_number AS chequeNumber FROM supplier_payments sp JOIN cheques c ON c.id = sp.cheque_id WHERE c.id = ? FOR UPDATE", [chequeId]); const cheque = rows[0]; if (!cheque) throw new HttpError(404, "Supplier cheque not found"); const [statuses] = await connection.execute<any[]>("SELECT status FROM cheque_statuses WHERE cheque_id = ? ORDER BY id DESC LIMIT 1", [chequeId]); if (statuses[0]?.status !== "pending") throw new HttpError(400, "Only pending cheques can be passed"); const [accounts] = await connection.execute<any[]>("SELECT HeadCode FROM account_coa WHERE id = ? AND IsActive = TRUE", [cheque.accountId]); if (!accounts[0]) throw new HttpError(400, "Cheque bank account is not active"); await connection.execute("INSERT INTO cheque_statuses (cheque_id, status, status_date) VALUES (?, 'passed', CURDATE())", [chequeId]); await postAccountEntries(connection, { referenceType: "supplier_cheque_pass", referenceId: cheque.paymentId, supplierId: cheque.supplierId, description: `Supplier cheque passed ${cheque.chequeNumber}`, lines: [{ headCode: 2000105, debit: Number(cheque.amount) }, { headCode: Number(accounts[0].HeadCode), credit: Number(cheque.amount) }] }); await connection.commit(); res.json({ success: true, data: { cheque_id: chequeId, status: "passed" } });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

accountsRouter.post("/supplier-payments/cheques/:chequeId/withdraw", asyncHandler(async (req, res) => {
  const chequeId = id.parse(req.params.chequeId); const remarks = z.object({ remarks: z.string().trim().max(1000).optional() }).parse(req.body).remarks; const connection = await db.getConnection();
  try { await connection.beginTransaction(); const [payments] = await connection.execute<any[]>("SELECT cheque_id AS chequeId FROM supplier_payments WHERE cheque_id = ? FOR UPDATE", [chequeId]); if (!payments[0]) throw new HttpError(404, "Supplier cheque not found"); const [statuses] = await connection.execute<any[]>("SELECT status FROM cheque_statuses WHERE cheque_id = ? ORDER BY id DESC LIMIT 1", [chequeId]); if (statuses[0]?.status !== "pending") throw new HttpError(400, "Only pending cheques can be withdrawn"); await connection.execute("INSERT INTO cheque_statuses (cheque_id, status, status_date, remarks) VALUES (?, 'withdrawn', CURDATE(), ?)", [chequeId, remarks ?? null]); await connection.commit(); res.json({ success: true, data: { cheque_id: chequeId, status: "withdrawn" } }); } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

accountsRouter.post("/salary-payments", asyncHandler(async (req, res) => {
  const { employeeId, ...input } = paymentInput.extend({ employeeId: id }).parse(req.body); const connection = await db.getConnection();
  try { await connection.beginTransaction(); const [employees] = await connection.execute<any[]>("SELECT first_name AS firstName, last_name AS lastName FROM employees WHERE id = ?", [employeeId]); if (!employees[0]) throw new HttpError(404, "Employee not found"); const fullName = [employees[0].firstName, employees[0].lastName].filter(Boolean).join(" "); const [payment] = await connection.execute<any>("INSERT INTO employee_salary_payments (payment_number, employee_id, payment_date, amount, payment_method, note) VALUES (?, ?, COALESCE(?, NOW()), ?, ?, ?)", [paymentNo("SALPAY"), employeeId, input.paymentDate ?? null, input.amount, input.paymentMethod, input.note ?? null]); const coa = await createPartyCoa("employee", employeeId, fullName, connection); await postAccountEntries(connection, { referenceType: "salary_payment", referenceId: payment.insertId, date: input.paymentDate, employeeId, description: `Salary payment ${payment.insertId}`, lines: [{ headCode: 5000203, debit: input.amount }, { headCode: Number(coa.HeadCode), credit: input.amount }, { headCode: Number(coa.HeadCode), debit: input.amount }, { headCode: 1000101, credit: input.amount }] }); await connection.commit(); res.status(201).json({ success: true, data: { id: payment.insertId } }); } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));
