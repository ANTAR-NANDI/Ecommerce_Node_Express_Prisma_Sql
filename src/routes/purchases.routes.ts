import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { postAccountEntries } from "../lib/accounting";
import { createPartyCoa } from "../lib/party-coa";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const purchasesRouter = Router();
const id = z.coerce.number().int().positive();
const money = z.coerce.number().nonnegative();
const purchaseInput = z.object({
  supplierId: id,
  warehouseId: id,
  purchaseDate: z.string().date().optional(),
  invoiceNumber: z.preprocess(value => value === "" ? null : value, z.string().trim().max(100).nullable().optional()),
  notes: z.preprocess(value => value === "" ? null : value, z.string().trim().max(2000).nullable().optional()),
  discount: money.optional(),
  shippingCost: money.optional(),
  paidAmount: money.optional(),
  paymentMethod: z.enum(["cash", "transfer", "cheque"]).optional(),
  accountId: id.optional(),
  chequeNumber: z.preprocess(value => value === "" ? undefined : value, z.string().trim().max(100).optional()),
  items: z.array(z.object({ productId: id, quantity: z.coerce.number().int().positive(), unitPrice: money, discount: money.optional() })).min(1).max(100),
}).superRefine((input, ctx) => {
  const paidAmount = Number(input.paidAmount ?? 0);
  if (paidAmount > 0 && !input.paymentMethod) ctx.addIssue({ code: "custom", path: ["paymentMethod"], message: "paymentMethod is required when paidAmount is greater than zero" });
  if (paidAmount > 0 && input.paymentMethod === "transfer" && !input.accountId) ctx.addIssue({ code: "custom", path: ["accountId"], message: "accountId is required for bank transfer" });
  if (input.paymentMethod !== "transfer" && input.accountId) ctx.addIssue({ code: "custom", path: ["accountId"], message: "accountId is only allowed for transfer; select the bank when passing a cheque" });
  if (input.paymentMethod === "cheque" && paidAmount > 0 && !input.chequeNumber) ctx.addIssue({ code: "custom", path: ["chequeNumber"], message: "chequeNumber is required for cheque payments" });
  if (input.paymentMethod !== "cheque" && input.chequeNumber) ctx.addIssue({ code: "custom", path: ["chequeNumber"], message: "chequeNumber is only allowed for cheque payments" });
});

const headerSelect = `SELECT p.id, p.purchase_number AS purchaseNumber, p.purchase_date AS purchaseDate,
  p.invoice_number AS invoiceNumber, p.notes, p.subtotal, p.discount, p.shipping_cost AS shippingCost,
  p.total_amount AS totalAmount, p.paid_amount AS paidAmount, p.status, p.supplier_id AS supplierId,
  s.name AS supplierName, p.warehouse_id AS warehouseId, w.name AS warehouseName, p.created_at AS createdAt
  FROM purchases p JOIN suppliers s ON s.id = p.supplier_id JOIN warehouses w ON w.id = p.warehouse_id`;

async function purchaseDetails(purchaseId: number, connection: any = db) {
  const [headers] = await connection.execute(`${headerSelect} WHERE p.id = ?`, [purchaseId]);
  const purchase = (headers as any[])[0]; if (!purchase) return null;
  const [items] = await connection.execute(`SELECT pi.id, pi.product_id AS productId, pr.name AS productName, pr.sku,
    pi.quantity, pi.unit_price AS unitPrice, pi.discount, pi.line_total AS lineTotal
    FROM purchase_items pi JOIN products pr ON pr.id = pi.product_id WHERE pi.purchase_id = ? ORDER BY pi.id`, [purchaseId]);
  return { ...purchase, items };
}

function purchaseNumber(date: string) {
  return `PUR-${date.replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

purchasesRouter.get("/", asyncHandler(async (req, res) => {
  const query = z.object({ supplierId: id.optional(), warehouseId: id.optional(), status: z.enum(["received", "cancelled"]).optional() }).parse(req.query);
  const filters: string[] = []; const values: Array<number | string> = [];
  if (query.supplierId) { filters.push("p.supplier_id = ?"); values.push(query.supplierId); }
  if (query.warehouseId) { filters.push("p.warehouse_id = ?"); values.push(query.warehouseId); }
  if (query.status) { filters.push("p.status = ?"); values.push(query.status); }
  const [rows] = await db.execute<any[]>(`${headerSelect}${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""} ORDER BY p.created_at DESC`, values);
  res.json({ success: true, data: rows });
}));

purchasesRouter.get("/:id", asyncHandler(async (req, res) => {
  const purchase = await purchaseDetails(id.parse(req.params.id));
  if (!purchase) throw new HttpError(404, "Purchase not found");
  res.json({ success: true, data: purchase });
}));

purchasesRouter.post("/", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const input = purchaseInput.parse(req.body);
  const purchaseDate = input.purchaseDate ?? new Date().toISOString().slice(0, 10);
  const items = input.items.map(item => {
    const discount = item.discount ?? 0; const lineTotal = item.quantity * item.unitPrice - discount;
    if (lineTotal < 0) throw new HttpError(400, "An item discount cannot exceed its item total");
    return { ...item, discount, lineTotal };
  });
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const discount = input.discount ?? 0; const shippingCost = input.shippingCost ?? 0; const totalAmount = subtotal - discount + shippingCost;
  if (totalAmount < 0) throw new HttpError(400, "Purchase discount cannot exceed the subtotal plus shipping cost");
  if ((input.paidAmount ?? 0) > totalAmount) throw new HttpError(400, "Paid amount cannot exceed total amount");
  const requestedPaidAmount = Number(input.paidAmount ?? 0);
  const postedPaidAmount = input.paymentMethod === "cheque" ? 0 : requestedPaidAmount;
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const number = purchaseNumber(purchaseDate);
    const [result] = await connection.execute<any>(`INSERT INTO purchases (purchase_number, supplier_id, warehouse_id, purchase_date, invoice_number, notes, subtotal, discount, shipping_cost, total_amount, paid_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received')`, [number, input.supplierId, input.warehouseId, purchaseDate, input.invoiceNumber ?? null, input.notes ?? null, subtotal, discount, shippingCost, totalAmount, postedPaidAmount]);
    for (const item of items) {
      await connection.execute("INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_price, discount, line_total) VALUES (?, ?, ?, ?, ?, ?)", [result.insertId, item.productId, item.quantity, item.unitPrice, item.discount, item.lineTotal]);
      await connection.execute("INSERT INTO warehouse_stocks (warehouse_id, product_id, quantity) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)", [input.warehouseId, item.productId, item.quantity]);
      await connection.execute("UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?", [item.quantity, item.productId]);
      await connection.execute("INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity_change, reference_type, reference_id, note) VALUES (?, ?, 'purchase', ?, 'purchase', ?, ?)", [input.warehouseId, item.productId, item.quantity, result.insertId, input.invoiceNumber ?? null]);
    }
    const [supplierRows] = await connection.execute<any[]>("SELECT name FROM suppliers WHERE id = ?", [input.supplierId]);
    if (!supplierRows[0]) throw new HttpError(404, "Supplier not found");
    const supplierCoa = await createPartyCoa("supplier", input.supplierId, supplierRows[0].name, connection);
    await postAccountEntries(connection, { referenceType: "purchase", referenceId: result.insertId, date: purchaseDate, supplierId: input.supplierId, description: `Purchase ${number}`, lines: [{ headCode: 1000108, debit: totalAmount }, { headCode: Number(supplierCoa.HeadCode), credit: totalAmount }] });

    let payment: any = null;
    if (requestedPaidAmount > 0) {
      let account: any = null;
      if (input.paymentMethod === "cash") { const [accountRows] = await connection.execute<any[]>("SELECT id, HeadCode, HeadName AS accountName FROM account_coa WHERE HeadCode = 1000101 AND IsActive = TRUE"); account = accountRows[0]; if (!account) throw new HttpError(400, "Active Cash in Hand COA (1000101) is missing"); }
      if (input.paymentMethod === "transfer") { const [accountRows] = await connection.execute<any[]>("SELECT id, HeadCode, bank_id AS bankId, HeadName AS accountName FROM account_coa WHERE id = ? AND IsActive = TRUE AND bank_id IS NOT NULL", [input.accountId!]); account = accountRows[0]; if (!account) throw new HttpError(400, "Active bank account not found"); }
      const method = input.paymentMethod === "transfer" ? "bank_transfer" : input.paymentMethod!;
      const methodId = input.paymentMethod === "cash" ? 1 : input.paymentMethod === "transfer" ? 2 : 3;
      let chequeId: number | null = null;
      if (input.paymentMethod === "cheque") {
        const [cheque] = await connection.execute<any>("INSERT INTO cheques (cheque_number, cheque_type, amount, account_id, issued_date) VALUES (?, 'issued', ?, NULL, ?)", [input.chequeNumber!, requestedPaidAmount, purchaseDate]);
        chequeId = cheque.insertId;
        await connection.execute("INSERT INTO cheque_statuses (cheque_id, status, status_date, remarks) VALUES (?, 'pending', ?, ?)", [chequeId, purchaseDate, input.notes ?? null]);
      }
      const paymentNumber = `SUPPAY-${purchaseDate.replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const [paymentResult] = await connection.execute<any>("INSERT INTO supplier_payments (payment_number, supplier_id, purchase_id, payment_date, amount, payment_method, payment_method_id, account_id, cheque_id, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [paymentNumber, input.supplierId, result.insertId, purchaseDate, requestedPaidAmount, method, methodId, account?.id ?? null, chequeId, input.notes ?? null]);
      if (input.paymentMethod !== "cheque") await postAccountEntries(connection, { referenceType: "supplier_payment", referenceId: paymentResult.insertId, date: purchaseDate, supplierId: input.supplierId, description: `Initial payment for purchase ${number}`, lines: [{ headCode: Number(supplierCoa.HeadCode), debit: requestedPaidAmount }, { headCode: Number(account.HeadCode), credit: requestedPaidAmount }] });
      payment = { id: paymentResult.insertId, paymentNumber, paymentMethod: input.paymentMethod, accountId: account?.id ?? null, accountName: account?.accountName ?? null, chequeId, chequeNumber: input.chequeNumber ?? null, status: input.paymentMethod === "cheque" ? "pending" : "posted", accountingPosted: input.paymentMethod !== "cheque" };
    }
    await connection.commit(); res.status(201).json({ success: true, data: { ...(await purchaseDetails(result.insertId, connection)), payment } });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

// Cancelling reverses the inventory receipt. Received purchases are not edited or deleted, protecting stock history.
purchasesRouter.patch("/:id/cancel", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const purchaseId = id.parse(req.params.id); const connection = await db.getConnection();
  try {
    await connection.beginTransaction(); const purchase = await purchaseDetails(purchaseId, connection);
    if (!purchase) throw new HttpError(404, "Purchase not found"); if (purchase.status === "cancelled") throw new HttpError(400, "Purchase is already cancelled");
    for (const item of purchase.items as any[]) {
      const [stock] = await connection.execute<any>("UPDATE warehouse_stocks SET quantity = quantity - ? WHERE warehouse_id = ? AND product_id = ? AND quantity >= ?", [item.quantity, purchase.warehouseId, item.productId, item.quantity]);
      if (!stock.affectedRows) throw new HttpError(400, `Cannot cancel: product ${item.productName} has already been used or sold from this warehouse`);
      await connection.execute("UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?", [item.quantity, item.productId]);
      await connection.execute("INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity_change, reference_type, reference_id, note) VALUES (?, ?, 'purchase_cancel', ?, 'purchase', ?, ?)", [purchase.warehouseId, item.productId, -item.quantity, purchaseId, "Purchase cancelled"]);
    }
    await connection.execute("UPDATE purchases SET status = 'cancelled' WHERE id = ?", [purchaseId]); await connection.commit();
    res.json({ success: true, data: await purchaseDetails(purchaseId, connection) });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));
