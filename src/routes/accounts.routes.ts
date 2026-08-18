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
const customerPaymentInput = z.object({
  customer_id: id,
  order_id: id,
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
const debitVoucherInput = z.object({
  date: z.string().date(),
  account_id: id,
  reverse_account_id: id,
  amount: z.coerce.number().positive(),
  ledger_comment: z.string().trim().min(1).max(1000),
  sub_type: z.preprocess(value => value === "" ? null : value, z.string().trim().max(100).nullable().optional()),
}).superRefine((input, ctx) => {
  if (input.account_id === input.reverse_account_id) ctx.addIssue({ code: "custom", path: ["reverse_account_id"], message: "Reverse account must be different from the debit account" });
});
const journalVoucherInput = z.object({
  date: z.string().date(),
  ledger_comment: z.string().trim().min(1).max(1000),
  sub_type: z.preprocess(value => value === "" ? null : value, z.string().trim().max(100).nullable().optional()),
  entries: z.array(z.object({ account_id: id, debit: z.coerce.number().nonnegative().optional(), credit: z.coerce.number().nonnegative().optional() }).superRefine((entry, ctx) => {
    const debit = Number(entry.debit ?? 0); const credit = Number(entry.credit ?? 0); if ((debit <= 0 && credit <= 0) || (debit > 0 && credit > 0)) ctx.addIssue({ code: "custom", message: "Each entry must contain either a debit or a credit amount" });
  })).min(2).max(100),
}).superRefine((input, ctx) => {
  const debit = input.entries.reduce((sum, entry) => sum + Number(entry.debit ?? 0), 0); const credit = input.entries.reduce((sum, entry) => sum + Number(entry.credit ?? 0), 0); if (Math.abs(debit - credit) > 0.001) ctx.addIssue({ code: "custom", path: ["entries"], message: "Journal voucher debit and credit totals must match" });
});
const cashAdjustmentInput = z.object({
  date: z.string().date(),
  adjustment_type: z.enum(["debit", "credit"]),
  remarks: z.string().trim().min(1).max(1000),
  amount: z.coerce.number().positive(),
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

accountsRouter.post("/customer-payments", asyncHandler(async (req, res) => {
  const input = customerPaymentInput.parse(req.body); const method = paymentMethodName[input.payment_method_id]!; const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [orders] = await connection.execute<any[]>("SELECT o.grand_total AS totalAmount, c.name AS customerName FROM ecommerce_orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ? AND o.customer_id = ? AND o.status <> 'cancelled'", [input.order_id, input.customer_id]);
    const order = orders[0]; if (!order) throw new HttpError(400, "Order not found for this customer");
    const [received] = await connection.execute<any[]>("SELECT COALESCE(SUM(cp.amount), 0) AS total FROM customer_payments cp LEFT JOIN cheques c ON c.id = cp.cheque_id LEFT JOIN cheque_statuses cs ON cs.id = (SELECT id FROM cheque_statuses WHERE cheque_id = c.id ORDER BY id DESC LIMIT 1) WHERE cp.order_id = ? AND (cp.cheque_id IS NULL OR cs.status = 'passed')", [input.order_id]);
    const effectiveAmount = method === "cheque" ? 0 : input.amount; if (Number(received[0].total) + effectiveAmount > Number(order.totalAmount)) throw new HttpError(400, "Payment amount exceeds the remaining order balance");
    const [accounts] = await connection.execute<any[]>("SELECT id, HeadCode, bank_id AS bankId FROM account_coa WHERE id = ? AND IsActive = TRUE", [input.account_id]); const account = accounts[0]; if (!account) throw new HttpError(404, "Active account not found");
    if (method === "cash" && Number(account.HeadCode) !== 1000101) throw new HttpError(400, "Cash payment requires the Cash in Hand account");
    if (method !== "cash" && !account.bankId) throw new HttpError(400, "Bank transfer and cheque payments require a bank account");
    let chequeId: number | null = null;
    if (method === "cheque") { const [cheque] = await connection.query<any>("INSERT INTO cheques (cheque_number, cheque_type, amount, account_id, issued_date) VALUES (?, 'received', ?, ?, ?)", [input.cheque_number, input.amount, input.account_id, input.date]); chequeId = cheque.insertId; await connection.execute("INSERT INTO cheque_statuses (cheque_id, status, status_date, remarks) VALUES (?, 'pending', ?, ?)", [chequeId, input.date, input.remarks]); }
    const number = paymentNo("CUSTREC"); const [payment] = await connection.execute<any>("INSERT INTO customer_payments (payment_number, customer_id, order_id, payment_date, amount, payment_method, payment_method_id, account_id, cheque_id, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [number, input.customer_id, input.order_id, input.date, input.amount, method, input.payment_method_id, input.account_id, chequeId, input.remarks]);
    const customerCoa = await createPartyCoa("customer", input.customer_id, order.customerName, connection); const debitHead = method === "cheque" ? 1000105 : Number(account.HeadCode);
    await postAccountEntries(connection, { referenceType: "customer_payment", referenceId: payment.insertId, date: input.date, customerId: input.customer_id, description: `Customer receipt ${number}`, lines: [{ headCode: debitHead, debit: input.amount }, { headCode: Number(customerCoa.HeadCode), credit: input.amount }] });
    if (Number(received[0].total) + effectiveAmount === Number(order.totalAmount)) await connection.execute("UPDATE ecommerce_orders SET payment_status = 'paid' WHERE id = ?", [input.order_id]);
    await connection.commit(); res.status(201).json({ success: true, data: { id: payment.insertId, payment_number: number, cheque_id: chequeId } });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

accountsRouter.post("/customer-payments/cheques/:chequeId/pass", asyncHandler(async (req, res) => {
  const chequeId = id.parse(req.params.chequeId); const connection = await db.getConnection();
  try { await connection.beginTransaction(); const [rows] = await connection.execute<any[]>("SELECT cp.id AS paymentId, cp.customer_id AS customerId, cp.order_id AS orderId, cp.amount, c.account_id AS accountId, c.cheque_number AS chequeNumber FROM customer_payments cp JOIN cheques c ON c.id = cp.cheque_id WHERE c.id = ? FOR UPDATE", [chequeId]); const cheque = rows[0]; if (!cheque) throw new HttpError(404, "Customer cheque not found"); const [statuses] = await connection.execute<any[]>("SELECT status FROM cheque_statuses WHERE cheque_id = ? ORDER BY id DESC LIMIT 1", [chequeId]); if (statuses[0]?.status !== "pending") throw new HttpError(400, "Only pending cheques can be passed"); const [accounts] = await connection.execute<any[]>("SELECT HeadCode FROM account_coa WHERE id = ? AND IsActive = TRUE", [cheque.accountId]); if (!accounts[0]) throw new HttpError(400, "Cheque bank account is not active"); await connection.execute("INSERT INTO cheque_statuses (cheque_id, status, status_date) VALUES (?, 'passed', CURDATE())", [chequeId]); await postAccountEntries(connection, { referenceType: "customer_cheque_pass", referenceId: cheque.paymentId, customerId: cheque.customerId, description: `Customer cheque passed ${cheque.chequeNumber}`, lines: [{ headCode: Number(accounts[0].HeadCode), debit: Number(cheque.amount) }, { headCode: 1000105, credit: Number(cheque.amount) }] }); const [totals] = await connection.execute<any[]>("SELECT COALESCE(SUM(cp.amount), 0) AS total FROM customer_payments cp LEFT JOIN cheques c ON c.id = cp.cheque_id LEFT JOIN cheque_statuses cs ON cs.id = (SELECT id FROM cheque_statuses WHERE cheque_id = c.id ORDER BY id DESC LIMIT 1) WHERE cp.order_id = ? AND (cp.cheque_id IS NULL OR cs.status = 'passed')", [cheque.orderId]); const [orders] = await connection.execute<any[]>("SELECT grand_total AS totalAmount FROM ecommerce_orders WHERE id = ?", [cheque.orderId]); if (Number(totals[0].total) >= Number(orders[0].totalAmount)) await connection.execute("UPDATE ecommerce_orders SET payment_status = 'paid', paid_amount = grand_total, due_amount = 0 WHERE id = ?", [cheque.orderId]); await connection.commit(); res.json({ success: true, data: { cheque_id: chequeId, status: "passed" } }); } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

accountsRouter.post("/customer-payments/cheques/:chequeId/withdraw", asyncHandler(async (req, res) => {
  const chequeId = id.parse(req.params.chequeId); const remarks = z.object({ remarks: z.string().trim().max(1000).optional() }).parse(req.body).remarks; const connection = await db.getConnection();
  try { await connection.beginTransaction(); const [payments] = await connection.execute<any[]>("SELECT cheque_id AS chequeId FROM customer_payments WHERE cheque_id = ? FOR UPDATE", [chequeId]); if (!payments[0]) throw new HttpError(404, "Customer cheque not found"); const [statuses] = await connection.execute<any[]>("SELECT status FROM cheque_statuses WHERE cheque_id = ? ORDER BY id DESC LIMIT 1", [chequeId]); if (statuses[0]?.status !== "pending") throw new HttpError(400, "Only pending cheques can be withdrawn"); await connection.execute("INSERT INTO cheque_statuses (cheque_id, status, status_date, remarks) VALUES (?, 'withdrawn', CURDATE(), ?)", [chequeId, remarks ?? null]); await connection.commit(); res.json({ success: true, data: { cheque_id: chequeId, status: "withdrawn" } }); } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

const debitVoucherSelect = `SELECT dv.id, dv.voucher_number AS voucher_number, dv.voucher_date AS date,
  dv.account_id, debit.HeadCode AS account_head_code, debit.HeadName AS account_name,
  dv.reverse_account_id, reverseAccount.HeadCode AS reverse_account_head_code, reverseAccount.HeadName AS reverse_account_name,
  dv.ledger_comment, dv.sub_type, dv.amount, dv.created_at
  FROM debit_vouchers dv
  JOIN account_coa debit ON debit.id = dv.account_id
  JOIN account_coa reverseAccount ON reverseAccount.id = dv.reverse_account_id`;

accountsRouter.post("/debit-vouchers", asyncHandler(async (req, res) => {
  const input = debitVoucherInput.parse(req.body); const connection = await db.getConnection();
  try {
    await connection.beginTransaction(); const [accounts] = await connection.execute<any[]>("SELECT id, HeadCode FROM account_coa WHERE id IN (?, ?) AND IsActive = TRUE", [input.account_id, input.reverse_account_id]); if (accounts.length !== 2) throw new HttpError(400, "Both voucher accounts must be active");
    const debitAccount = accounts.find(account => Number(account.id) === input.account_id)!; const reverseAccount = accounts.find(account => Number(account.id) === input.reverse_account_id)!; const voucherNumber = `DV-${input.date.replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const [voucher] = await connection.execute<any>("INSERT INTO debit_vouchers (voucher_number, voucher_date, account_id, reverse_account_id, ledger_comment, sub_type, amount) VALUES (?, ?, ?, ?, ?, ?, ?)", [voucherNumber, input.date, input.account_id, input.reverse_account_id, input.ledger_comment, input.sub_type ?? null, input.amount]);
    await postAccountEntries(connection, { referenceType: "debit_voucher", referenceId: voucher.insertId, date: input.date, description: `Debit voucher ${voucherNumber}: ${input.ledger_comment}`, lines: [{ headCode: Number(debitAccount.HeadCode), debit: input.amount }, { headCode: Number(reverseAccount.HeadCode), credit: input.amount }] });
    const [rows] = await connection.execute<any[]>(`${debitVoucherSelect} WHERE dv.id = ?`, [voucher.insertId]); await connection.commit(); res.status(201).json({ success: true, data: rows[0] });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

accountsRouter.get("/debit-vouchers", asyncHandler(async (req, res) => {
  const query = z.object({ search: z.string().trim().max(100).optional(), date_from: z.string().date().optional(), date_to: z.string().date().optional() }).parse(req.query); const filters: string[] = []; const values: string[] = [];
  if (query.search) { filters.push("(dv.voucher_number LIKE ? OR debit.HeadName LIKE ? OR reverseAccount.HeadName LIKE ? OR dv.ledger_comment LIKE ?)"); values.push(...Array(4).fill(`%${query.search}%`)); }
  if (query.date_from) { filters.push("dv.voucher_date >= ?"); values.push(query.date_from); } if (query.date_to) { filters.push("dv.voucher_date <= ?"); values.push(query.date_to); }
  const [rows] = await db.execute<any[]>(`${debitVoucherSelect}${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""} ORDER BY dv.voucher_date DESC, dv.id DESC`, values); res.json({ success: true, data: rows });
}));

accountsRouter.get("/debit-vouchers/:id", asyncHandler(async (req, res) => {
  const voucherId = id.parse(req.params.id); const [rows] = await db.execute<any[]>(`${debitVoucherSelect} WHERE dv.id = ?`, [voucherId]); if (!rows[0]) throw new HttpError(404, "Debit voucher not found"); const [transactions] = await db.execute<any[]>("SELECT id, transaction_no AS transaction_number, transaction_date AS date, head_code, debit, credit, description FROM account_transactions WHERE reference_type = 'debit_voucher' AND reference_id = ? ORDER BY id", [voucherId]); res.json({ success: true, data: { ...rows[0], transactions } });
}));

const creditVoucherSelect = `SELECT cv.id, cv.voucher_number AS voucher_number, cv.voucher_date AS date,
  cv.account_id, credit.HeadCode AS account_head_code, credit.HeadName AS account_name,
  cv.reverse_account_id, reverseAccount.HeadCode AS reverse_account_head_code, reverseAccount.HeadName AS reverse_account_name,
  cv.ledger_comment, cv.sub_type, cv.amount, cv.created_at
  FROM credit_vouchers cv
  JOIN account_coa credit ON credit.id = cv.account_id
  JOIN account_coa reverseAccount ON reverseAccount.id = cv.reverse_account_id`;

accountsRouter.post("/credit-vouchers", asyncHandler(async (req, res) => {
  const input = debitVoucherInput.parse(req.body); const connection = await db.getConnection();
  try {
    await connection.beginTransaction(); const [accounts] = await connection.execute<any[]>("SELECT id, HeadCode FROM account_coa WHERE id IN (?, ?) AND IsActive = TRUE", [input.account_id, input.reverse_account_id]); if (accounts.length !== 2) throw new HttpError(400, "Both voucher accounts must be active");
    const creditAccount = accounts.find(account => Number(account.id) === input.account_id)!; const reverseAccount = accounts.find(account => Number(account.id) === input.reverse_account_id)!; const voucherNumber = `CV-${input.date.replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const [voucher] = await connection.execute<any>("INSERT INTO credit_vouchers (voucher_number, voucher_date, account_id, reverse_account_id, ledger_comment, sub_type, amount) VALUES (?, ?, ?, ?, ?, ?, ?)", [voucherNumber, input.date, input.account_id, input.reverse_account_id, input.ledger_comment, input.sub_type ?? null, input.amount]);
    await postAccountEntries(connection, { referenceType: "credit_voucher", referenceId: voucher.insertId, date: input.date, description: `Credit voucher ${voucherNumber}: ${input.ledger_comment}`, lines: [{ headCode: Number(reverseAccount.HeadCode), debit: input.amount }, { headCode: Number(creditAccount.HeadCode), credit: input.amount }] });
    const [rows] = await connection.execute<any[]>(`${creditVoucherSelect} WHERE cv.id = ?`, [voucher.insertId]); await connection.commit(); res.status(201).json({ success: true, data: rows[0] });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

accountsRouter.get("/credit-vouchers", asyncHandler(async (req, res) => {
  const query = z.object({ search: z.string().trim().max(100).optional(), date_from: z.string().date().optional(), date_to: z.string().date().optional() }).parse(req.query); const filters: string[] = []; const values: string[] = [];
  if (query.search) { filters.push("(cv.voucher_number LIKE ? OR credit.HeadName LIKE ? OR reverseAccount.HeadName LIKE ? OR cv.ledger_comment LIKE ?)"); values.push(...Array(4).fill(`%${query.search}%`)); }
  if (query.date_from) { filters.push("cv.voucher_date >= ?"); values.push(query.date_from); } if (query.date_to) { filters.push("cv.voucher_date <= ?"); values.push(query.date_to); }
  const [rows] = await db.execute<any[]>(`${creditVoucherSelect}${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""} ORDER BY cv.voucher_date DESC, cv.id DESC`, values); res.json({ success: true, data: rows });
}));

accountsRouter.get("/credit-vouchers/:id", asyncHandler(async (req, res) => {
  const voucherId = id.parse(req.params.id); const [rows] = await db.execute<any[]>(`${creditVoucherSelect} WHERE cv.id = ?`, [voucherId]); if (!rows[0]) throw new HttpError(404, "Credit voucher not found"); const [transactions] = await db.execute<any[]>("SELECT id, transaction_no AS transaction_number, transaction_date AS date, head_code, debit, credit, description FROM account_transactions WHERE reference_type = 'credit_voucher' AND reference_id = ? ORDER BY id", [voucherId]); res.json({ success: true, data: { ...rows[0], transactions } });
}));

const contraVoucherSelect = `SELECT cv.id, cv.voucher_number AS voucher_number, cv.voucher_date AS date,
  cv.account_id, debit.HeadCode AS account_head_code, debit.HeadName AS account_name,
  cv.reverse_account_id, reverseAccount.HeadCode AS reverse_account_head_code, reverseAccount.HeadName AS reverse_account_name,
  cv.ledger_comment, cv.sub_type, cv.amount, cv.created_at
  FROM contra_vouchers cv
  JOIN account_coa debit ON debit.id = cv.account_id
  JOIN account_coa reverseAccount ON reverseAccount.id = cv.reverse_account_id`;

accountsRouter.post("/contra-vouchers", asyncHandler(async (req, res) => {
  const input = debitVoucherInput.parse(req.body); const connection = await db.getConnection();
  try {
    await connection.beginTransaction(); const [accounts] = await connection.execute<any[]>("SELECT id, HeadCode, bank_id AS bankId FROM account_coa WHERE id IN (?, ?) AND IsActive = TRUE", [input.account_id, input.reverse_account_id]); if (accounts.length !== 2) throw new HttpError(400, "Both voucher accounts must be active");
    const debitAccount = accounts.find(account => Number(account.id) === input.account_id)!; const reverseAccount = accounts.find(account => Number(account.id) === input.reverse_account_id)!; const isCashOrBank = (account: any) => [1000101, 1000103, 1000104].includes(Number(account.HeadCode)) || Boolean(account.bankId); if (!isCashOrBank(debitAccount) || !isCashOrBank(reverseAccount)) throw new HttpError(400, "Contra vouchers can only transfer between cash, mobile-wallet, or bank accounts");
    const voucherNumber = `CT-${input.date.replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`; const [voucher] = await connection.execute<any>("INSERT INTO contra_vouchers (voucher_number, voucher_date, account_id, reverse_account_id, ledger_comment, sub_type, amount) VALUES (?, ?, ?, ?, ?, ?, ?)", [voucherNumber, input.date, input.account_id, input.reverse_account_id, input.ledger_comment, input.sub_type ?? null, input.amount]);
    await postAccountEntries(connection, { referenceType: "contra_voucher", referenceId: voucher.insertId, date: input.date, description: `Contra voucher ${voucherNumber}: ${input.ledger_comment}`, lines: [{ headCode: Number(debitAccount.HeadCode), debit: input.amount }, { headCode: Number(reverseAccount.HeadCode), credit: input.amount }] });
    const [rows] = await connection.execute<any[]>(`${contraVoucherSelect} WHERE cv.id = ?`, [voucher.insertId]); await connection.commit(); res.status(201).json({ success: true, data: rows[0] });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

accountsRouter.get("/contra-vouchers", asyncHandler(async (req, res) => {
  const query = z.object({ search: z.string().trim().max(100).optional(), date_from: z.string().date().optional(), date_to: z.string().date().optional() }).parse(req.query); const filters: string[] = []; const values: string[] = [];
  if (query.search) { filters.push("(cv.voucher_number LIKE ? OR debit.HeadName LIKE ? OR reverseAccount.HeadName LIKE ? OR cv.ledger_comment LIKE ?)"); values.push(...Array(4).fill(`%${query.search}%`)); }
  if (query.date_from) { filters.push("cv.voucher_date >= ?"); values.push(query.date_from); } if (query.date_to) { filters.push("cv.voucher_date <= ?"); values.push(query.date_to); }
  const [rows] = await db.execute<any[]>(`${contraVoucherSelect}${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""} ORDER BY cv.voucher_date DESC, cv.id DESC`, values); res.json({ success: true, data: rows });
}));

accountsRouter.get("/contra-vouchers/:id", asyncHandler(async (req, res) => {
  const voucherId = id.parse(req.params.id); const [rows] = await db.execute<any[]>(`${contraVoucherSelect} WHERE cv.id = ?`, [voucherId]); if (!rows[0]) throw new HttpError(404, "Contra voucher not found"); const [transactions] = await db.execute<any[]>("SELECT id, transaction_no AS transaction_number, transaction_date AS date, head_code, debit, credit, description FROM account_transactions WHERE reference_type = 'contra_voucher' AND reference_id = ? ORDER BY id", [voucherId]); res.json({ success: true, data: { ...rows[0], transactions } });
}));

const journalVoucherSelect = `SELECT jv.id, jv.voucher_number AS voucher_number, jv.voucher_date AS date, jv.ledger_comment, jv.sub_type, jv.total_amount, jv.created_at,
  debit.HeadName AS account_name, credit.HeadName AS reverse_account_name
  FROM journal_vouchers jv
  LEFT JOIN journal_voucher_entries firstDebit ON firstDebit.id = (SELECT id FROM journal_voucher_entries WHERE journal_voucher_id = jv.id AND debit > 0 ORDER BY id LIMIT 1)
  LEFT JOIN account_coa debit ON debit.id = firstDebit.account_id
  LEFT JOIN journal_voucher_entries firstCredit ON firstCredit.id = (SELECT id FROM journal_voucher_entries WHERE journal_voucher_id = jv.id AND credit > 0 ORDER BY id LIMIT 1)
  LEFT JOIN account_coa credit ON credit.id = firstCredit.account_id`;

accountsRouter.post("/journal-vouchers", asyncHandler(async (req, res) => {
  const input = journalVoucherInput.parse(req.body); const connection = await db.getConnection();
  try {
    await connection.beginTransaction(); const accountIds = [...new Set(input.entries.map(entry => entry.account_id))]; const placeholders = accountIds.map(() => "?").join(", "); const [accounts] = await connection.execute<any[]>(`SELECT id, HeadCode FROM account_coa WHERE id IN (${placeholders}) AND IsActive = TRUE`, accountIds); if (accounts.length !== accountIds.length) throw new HttpError(400, "Every journal account must be active");
    const byId = new Map(accounts.map(account => [Number(account.id), Number(account.HeadCode)])); const total = input.entries.reduce((sum, entry) => sum + Number(entry.debit ?? 0), 0); const voucherNumber = `JV-${input.date.replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const [voucher] = await connection.execute<any>("INSERT INTO journal_vouchers (voucher_number, voucher_date, ledger_comment, sub_type, total_amount) VALUES (?, ?, ?, ?, ?)", [voucherNumber, input.date, input.ledger_comment, input.sub_type ?? null, total]);
    for (const entry of input.entries) await connection.execute("INSERT INTO journal_voucher_entries (journal_voucher_id, account_id, debit, credit) VALUES (?, ?, ?, ?)", [voucher.insertId, entry.account_id, entry.debit ?? 0, entry.credit ?? 0]);
    await postAccountEntries(connection, { referenceType: "journal_voucher", referenceId: voucher.insertId, date: input.date, description: `Journal voucher ${voucherNumber}: ${input.ledger_comment}`, lines: input.entries.map(entry => ({ headCode: byId.get(entry.account_id)!, debit: entry.debit ?? 0, credit: entry.credit ?? 0 })) });
    const [rows] = await connection.execute<any[]>(`${journalVoucherSelect} WHERE jv.id = ?`, [voucher.insertId]); await connection.commit(); res.status(201).json({ success: true, data: rows[0] });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

accountsRouter.get("/journal-vouchers", asyncHandler(async (req, res) => {
  const query = z.object({ search: z.string().trim().max(100).optional(), date_from: z.string().date().optional(), date_to: z.string().date().optional() }).parse(req.query); const filters: string[] = []; const values: string[] = [];
  if (query.search) { filters.push("(jv.voucher_number LIKE ? OR jv.ledger_comment LIKE ? OR debit.HeadName LIKE ? OR credit.HeadName LIKE ?)"); values.push(...Array(4).fill(`%${query.search}%`)); }
  if (query.date_from) { filters.push("jv.voucher_date >= ?"); values.push(query.date_from); } if (query.date_to) { filters.push("jv.voucher_date <= ?"); values.push(query.date_to); }
  const [rows] = await db.execute<any[]>(`${journalVoucherSelect}${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""} ORDER BY jv.voucher_date DESC, jv.id DESC`, values); res.json({ success: true, data: rows });
}));

accountsRouter.get("/journal-vouchers/:id", asyncHandler(async (req, res) => {
  const voucherId = id.parse(req.params.id); const [rows] = await db.execute<any[]>(`${journalVoucherSelect} WHERE jv.id = ?`, [voucherId]); if (!rows[0]) throw new HttpError(404, "Journal voucher not found"); const [entries] = await db.execute<any[]>("SELECT jve.id, jve.account_id, coa.HeadCode AS account_head_code, coa.HeadName AS account_name, jve.debit, jve.credit FROM journal_voucher_entries jve JOIN account_coa coa ON coa.id = jve.account_id WHERE jve.journal_voucher_id = ? ORDER BY jve.id", [voucherId]); const [transactions] = await db.execute<any[]>("SELECT id, transaction_no AS transaction_number, transaction_date AS date, head_code, debit, credit, description FROM account_transactions WHERE reference_type = 'journal_voucher' AND reference_id = ? ORDER BY id", [voucherId]); res.json({ success: true, data: { ...rows[0], entries, transactions } });
}));

const cashAdjustmentSelect = `SELECT ca.id, ca.voucher_number AS voucher_number, ca.adjustment_date AS date, ca.adjustment_type, ca.remarks, ca.amount, ca.created_at,
  cash.HeadCode AS cash_head_code, cash.HeadName AS cash_account_name,
  offsetAccount.HeadCode AS offset_head_code, offsetAccount.HeadName AS offset_account_name
  FROM cash_adjustments ca
  JOIN account_coa cash ON cash.id = ca.cash_account_id
  JOIN account_coa offsetAccount ON offsetAccount.id = ca.offset_account_id`;

accountsRouter.post("/cash-adjustments", asyncHandler(async (req, res) => {
  const input = cashAdjustmentInput.parse(req.body); const connection = await db.getConnection();
  try {
    await connection.beginTransaction(); const [cashRows] = await connection.execute<any[]>("SELECT id, HeadCode FROM account_coa WHERE HeadCode = 1000101 AND IsActive = TRUE", []); const cash = cashRows[0]; if (!cash) throw new HttpError(400, "Cash in Hand account is missing or inactive"); const offsetCode = input.adjustment_type === "debit" ? 40002 : 5000205; const [offsetRows] = await connection.execute<any[]>("SELECT id, HeadCode FROM account_coa WHERE HeadCode = ? AND IsActive = TRUE", [offsetCode]); const offset = offsetRows[0]; if (!offset) throw new HttpError(400, "Cash adjustment offset account is missing or inactive");
    const voucherNumber = `CHV-${input.date.replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`; const [adjustment] = await connection.execute<any>("INSERT INTO cash_adjustments (voucher_number, adjustment_date, adjustment_type, cash_account_id, offset_account_id, remarks, amount) VALUES (?, ?, ?, ?, ?, ?, ?)", [voucherNumber, input.date, input.adjustment_type, cash.id, offset.id, input.remarks, input.amount]);
    const lines = input.adjustment_type === "debit" ? [{ headCode: Number(cash.HeadCode), debit: input.amount }, { headCode: Number(offset.HeadCode), credit: input.amount }] : [{ headCode: Number(offset.HeadCode), debit: input.amount }, { headCode: Number(cash.HeadCode), credit: input.amount }]; await postAccountEntries(connection, { referenceType: "cash_adjustment", referenceId: adjustment.insertId, date: input.date, description: `Cash adjustment ${voucherNumber}: ${input.remarks}`, lines });
    const [rows] = await connection.execute<any[]>(`${cashAdjustmentSelect} WHERE ca.id = ?`, [adjustment.insertId]); await connection.commit(); res.status(201).json({ success: true, data: rows[0] });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

accountsRouter.get("/cash-adjustments", asyncHandler(async (req, res) => {
  const query = z.object({ search: z.string().trim().max(100).optional(), adjustment_type: z.enum(["debit", "credit"]).optional(), date_from: z.string().date().optional(), date_to: z.string().date().optional() }).parse(req.query); const filters: string[] = []; const values: string[] = [];
  if (query.search) { filters.push("(ca.voucher_number LIKE ? OR ca.remarks LIKE ?)"); values.push(...Array(2).fill(`%${query.search}%`)); } if (query.adjustment_type) { filters.push("ca.adjustment_type = ?"); values.push(query.adjustment_type); } if (query.date_from) { filters.push("ca.adjustment_date >= ?"); values.push(query.date_from); } if (query.date_to) { filters.push("ca.adjustment_date <= ?"); values.push(query.date_to); }
  const [rows] = await db.execute<any[]>(`${cashAdjustmentSelect}${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""} ORDER BY ca.adjustment_date DESC, ca.id DESC`, values); res.json({ success: true, data: rows });
}));

accountsRouter.get("/cash-adjustments/:id", asyncHandler(async (req, res) => {
  const adjustmentId = id.parse(req.params.id); const [rows] = await db.execute<any[]>(`${cashAdjustmentSelect} WHERE ca.id = ?`, [adjustmentId]); if (!rows[0]) throw new HttpError(404, "Cash adjustment not found"); const [transactions] = await db.execute<any[]>("SELECT id, transaction_no AS transaction_number, transaction_date AS date, head_code, debit, credit, description FROM account_transactions WHERE reference_type = 'cash_adjustment' AND reference_id = ? ORDER BY id", [adjustmentId]); res.json({ success: true, data: { ...rows[0], transactions } });
}));

accountsRouter.post("/salary-payments", asyncHandler(async (req, res) => {
  const { employeeId, ...input } = paymentInput.extend({ employeeId: id }).parse(req.body); const connection = await db.getConnection();
  try { await connection.beginTransaction(); const [employees] = await connection.execute<any[]>("SELECT first_name AS firstName, last_name AS lastName FROM employees WHERE id = ?", [employeeId]); if (!employees[0]) throw new HttpError(404, "Employee not found"); const fullName = [employees[0].firstName, employees[0].lastName].filter(Boolean).join(" "); const [payment] = await connection.execute<any>("INSERT INTO employee_salary_payments (payment_number, employee_id, payment_date, amount, payment_method, note) VALUES (?, ?, COALESCE(?, NOW()), ?, ?, ?)", [paymentNo("SALPAY"), employeeId, input.paymentDate ?? null, input.amount, input.paymentMethod, input.note ?? null]); const coa = await createPartyCoa("employee", employeeId, fullName, connection); await postAccountEntries(connection, { referenceType: "salary_payment", referenceId: payment.insertId, date: input.paymentDate, employeeId, description: `Salary payment ${payment.insertId}`, lines: [{ headCode: 5000203, debit: input.amount }, { headCode: Number(coa.HeadCode), credit: input.amount }, { headCode: Number(coa.HeadCode), debit: input.amount }, { headCode: 1000101, credit: input.amount }] }); await connection.commit(); res.status(201).json({ success: true, data: { id: payment.insertId } }); } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));
