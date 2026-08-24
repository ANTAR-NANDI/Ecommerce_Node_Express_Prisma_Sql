import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { postAccountEntries } from "../lib/accounting";
import { createPartyCoa } from "../lib/party-coa";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const posSalesRouter = Router();

const id = z.coerce.number().int().positive();
const money = z.coerce.number().min(0);
const nullableText = z.preprocess(value => value === "" ? null : value, z.string().trim().max(1000).nullable().optional());
const posCustomerInput = z.object({
  name: z.string().trim().min(2).max(150),
  phone: z.string().trim().min(6).max(30),
  email: z.preprocess(value => value === "" ? null : value, z.string().email().nullable().optional()),
  address: z.preprocess(value => value === "" ? null : value, z.string().trim().max(2000).nullable().optional()),
});
const saleInput = z.object({
  warehouseId: id,
  customerId: z.preprocess(value => value === "" ? null : value, id.nullable().optional()),
  customer: posCustomerInput.optional(),
  saleDate: z.string().trim().min(10).max(40).optional(),
  paymentMethod: z.enum(["cash", "card", "mobile_banking", "bank_transfer", "transfer", "cheque"]),
  note: nullableText,
  discount: money.optional().default(0),
  totalAmount: money.optional(),
  grandTotal: money.optional(),
  paidAmount: money.optional().default(0),
  dueAmount: money.optional(),
  items: z.array(z.object({ productId: id, sizeId: id.nullable().optional(), colorId: id.nullable().optional(), quantity: z.coerce.number().int().positive(), price: money, discount: money.optional().default(0) })).min(1).max(100),
}).superRefine((input, ctx) => {
  if (input.customerId && input.customer) ctx.addIssue({ code: "custom", path: ["customer"], message: "Send either customerId or customer details, not both" });
});

const headerSelect = `SELECT ps.id, ps.sale_number AS saleNumber, ps.warehouse_id AS warehouseId,
  w.name AS warehouseName, ps.customer_id AS customerId, c.name AS customerName,
  ps.sale_date AS saleDate, ps.payment_method AS paymentMethod, ps.note,
  ps.subtotal, ps.discount, ps.total_amount AS totalAmount, ps.grand_total AS grandTotal, ps.paid_amount AS paidAmount, ps.due_amount AS dueAmount,
  ps.change_amount AS changeAmount, ps.status, ps.created_at AS createdAt, ps.updated_at AS updatedAt
  FROM pos_sales ps
  JOIN warehouses w ON w.id = ps.warehouse_id
  LEFT JOIN customers c ON c.id = ps.customer_id`;

function saleNumber() {
  return `POS-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

async function saleDetails(saleId: number, connection: any = db) {
  const [headers] = await connection.execute(`${headerSelect} WHERE ps.id = ?`, [saleId]);
  const sale = (headers as any[])[0];
  if (!sale) return null;
  const [items] = await connection.execute(
    `SELECT psi.id, psi.product_id AS productId, p.name AS productName, p.sku,
      psi.size_id AS sizeId, s.name AS sizeName, psi.color_id AS colorId, clr.name AS colorName,
      psi.quantity, psi.unit_price AS price, psi.discount, psi.line_total AS lineTotal
     FROM pos_sale_items psi JOIN products p ON p.id = psi.product_id
     LEFT JOIN sizes s ON s.id = psi.size_id LEFT JOIN colors clr ON clr.id = psi.color_id
     WHERE psi.pos_sale_id = ? ORDER BY psi.id`,
    [saleId],
  );
  return { ...sale, items };
}

posSalesRouter.use(requireAuth, requireAdmin);

// POS sales history. Add filters as needed, for example: ?warehouseId=1&dateFrom=2026-08-01&dateTo=2026-08-31
posSalesRouter.get("/", asyncHandler(async (req, res) => {
  const query = z.object({
    warehouseId: id.optional(), customerId: id.optional(), status: z.enum(["completed", "cancelled"]).optional(),
    dateFrom: z.string().date().optional(), dateTo: z.string().date().optional(),
  }).parse(req.query);
  const filters: string[] = [];
  const values: Array<string | number> = [];
  if (query.warehouseId) { filters.push("ps.warehouse_id = ?"); values.push(query.warehouseId); }
  if (query.customerId) { filters.push("ps.customer_id = ?"); values.push(query.customerId); }
  if (query.status) { filters.push("ps.status = ?"); values.push(query.status); }
  if (query.dateFrom) { filters.push("ps.sale_date >= ?"); values.push(`${query.dateFrom} 00:00:00`); }
  if (query.dateTo) { filters.push("ps.sale_date <= ?"); values.push(`${query.dateTo} 23:59:59`); }
  const [rows] = await db.execute<any[]>(`${headerSelect}${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""} ORDER BY ps.sale_date DESC, ps.id DESC`, values);
  res.json({ success: true, data: rows });
}));

posSalesRouter.get("/:id", asyncHandler(async (req, res) => {
  const sale = await saleDetails(id.parse(req.params.id));
  if (!sale) throw new HttpError(404, "POS sale not found");
  res.json({ success: true, data: sale });
}));

posSalesRouter.post("/", asyncHandler(async (req, res) => {
  const input = saleInput.parse(req.body);
  const saleDate = input.saleDate ?? new Date().toISOString().slice(0, 19).replace("T", " ");
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [warehouse] = await connection.execute<any[]>("SELECT id FROM warehouses WHERE id = ? AND is_active = 1", [input.warehouseId]);
    if (!warehouse.length) throw new HttpError(400, "Active warehouse not found");
    let customerId = input.customerId ?? null;
    let customerName: string | null = null;
    if (customerId) {
      const [customers] = await connection.execute<any[]>("SELECT id, name FROM customers WHERE id = ? AND is_active = TRUE", [customerId]);
      if (!customers[0]) throw new HttpError(400, "Active customer not found");
      customerName = customers[0].name;
      await createPartyCoa("customer", Number(customerId), customerName!, connection);
    } else if (input.customer) {
      const [customers] = await connection.execute<any[]>("SELECT id, name FROM customers WHERE phone = ? LIMIT 1", [input.customer.phone]);
      if (customers[0]) {
        customerId = Number(customers[0].id); customerName = customers[0].name;
      } else {
        const [customer] = await connection.execute<any>("INSERT INTO customers (name, phone, email, address, is_active) VALUES (?, ?, ?, ?, TRUE)", [input.customer.name, input.customer.phone, input.customer.email ?? null, input.customer.address ?? null]);
        customerId = customer.insertId; customerName = input.customer.name;
      }
      await createPartyCoa("customer", Number(customerId), customerName!, connection);
    }
    const calculatedItems: Array<{ productId: number; sizeId: number | null; colorId: number | null; quantity: number; price: number; discount: number; lineTotal: number }> = [];
    for (const item of input.items) {
      if (item.sizeId) {
        const [sizes] = await connection.execute<any[]>("SELECT 1 FROM product_sizes WHERE product_id = ? AND size_id = ?", [item.productId, item.sizeId]);
        if (!sizes[0]) throw new HttpError(400, `Size ID ${item.sizeId} is not available for product ID ${item.productId}`);
      }
      if (item.colorId) {
        const [colors] = await connection.execute<any[]>("SELECT 1 FROM product_colors WHERE product_id = ? AND color_id = ?", [item.productId, item.colorId]);
        if (!colors[0]) throw new HttpError(400, `Color ID ${item.colorId} is not available for product ID ${item.productId}`);
      }
      const lineTotal = Number((item.quantity * item.price - item.discount).toFixed(2));
      if (lineTotal < 0) throw new HttpError(400, `Item discount cannot exceed the price of product ID ${item.productId}`);
      calculatedItems.push({ productId: item.productId, sizeId: item.sizeId ?? null, colorId: item.colorId ?? null, quantity: item.quantity, price: item.price, discount: item.discount, lineTotal });
    }
    const totalAmount = Number(calculatedItems.reduce((total, item) => total + item.lineTotal, 0).toFixed(2));
    if (input.discount > totalAmount) throw new HttpError(400, "Sale discount cannot exceed total amount");
    const grandTotal = Number((totalAmount - input.discount).toFixed(2));
    if (input.paidAmount > grandTotal) throw new HttpError(400, "Paid amount cannot exceed grand total");
    const dueAmount = Number((grandTotal - input.paidAmount).toFixed(2));
    if (dueAmount > 0 && !customerId) throw new HttpError(400, "customerId or customer details are required when a POS sale has due amount");
    const verifyAmount = (provided: number | undefined, calculated: number, name: string) => { if (provided !== undefined && Math.abs(provided - calculated) > 0.009) throw new HttpError(400, `${name} must match the calculated amount (${calculated})`); };
    verifyAmount(input.totalAmount, totalAmount, "totalAmount"); verifyAmount(input.grandTotal, grandTotal, "grandTotal"); verifyAmount(input.dueAmount, dueAmount, "dueAmount");
    const [result] = await connection.execute<any>(
      `INSERT INTO pos_sales (sale_number, warehouse_id, customer_id, sale_date, payment_method, note, subtotal, discount, total_amount, grand_total, paid_amount, due_amount, change_amount, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'completed')`,
      [saleNumber(), input.warehouseId, customerId, saleDate, input.paymentMethod, input.note ?? null, totalAmount, input.discount, totalAmount, grandTotal, input.paidAmount, dueAmount],
    );
    for (const item of calculatedItems) {
      const [stock] = await connection.execute<any>(
        "UPDATE warehouse_stocks SET quantity = quantity - ? WHERE warehouse_id = ? AND product_id = ? AND quantity >= ?",
        [item.quantity, input.warehouseId, item.productId, item.quantity],
      );
      if (!stock.affectedRows) throw new HttpError(400, `Insufficient stock in this warehouse for product ID ${item.productId}`);
      const [product] = await connection.execute<any>("UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND stock_quantity >= ?", [item.quantity, item.productId, item.quantity]);
      if (!product.affectedRows) throw new HttpError(400, `Product ID ${item.productId} was not found or does not have enough stock`);
      await connection.execute("INSERT INTO pos_sale_items (pos_sale_id, product_id, size_id, color_id, quantity, unit_price, discount, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [result.insertId, item.productId, item.sizeId, item.colorId, item.quantity, item.price, item.discount, item.lineTotal]);
      await connection.execute("INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity_change, reference_type, reference_id, note) VALUES (?, ?, 'pos_sale', ?, 'pos_sale', ?, ?)", [input.warehouseId, item.productId, -item.quantity, result.insertId, input.note ?? "POS sale"]);
    }
    const [costRows] = await connection.execute<any[]>("SELECT COALESCE(SUM(psi.quantity * p.buying_price), 0) AS cost FROM pos_sale_items psi JOIN products p ON p.id = psi.product_id WHERE psi.pos_sale_id = ?", [result.insertId]);
    const cost = Number(costRows[0].cost);
    const saleLines: Array<{ headCode: number; debit?: number; credit?: number }> = [{ headCode: 1000101, debit: input.paidAmount }];
    if (dueAmount > 0 && customerId) { const customerCoa = await createPartyCoa("customer", customerId, customerName!, connection); saleLines.push({ headCode: Number(customerCoa.HeadCode), debit: dueAmount }); }
    saleLines.push({ headCode: 4000101, credit: grandTotal }, { headCode: 5000107, debit: cost }, { headCode: 1000108, credit: cost });
    await postAccountEntries(connection, { referenceType: "pos_sale", referenceId: result.insertId, date: saleDate, customerId, description: `POS sale ${result.insertId}`, lines: saleLines });
    await connection.commit();
    res.status(201).json({ success: true, data: await saleDetails(result.insertId, connection) });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

// Cancellation voids the full sale and restores every sold item to its warehouse stock.
posSalesRouter.patch("/:id/cancel", asyncHandler(async (req, res) => {
  const saleId = id.parse(req.params.id);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const sale = await saleDetails(saleId, connection);
    if (!sale) throw new HttpError(404, "POS sale not found");
    if (sale.status === "cancelled") throw new HttpError(400, "POS sale is already cancelled");
    for (const item of sale.items as any[]) {
      await connection.execute("INSERT INTO warehouse_stocks (warehouse_id, product_id, quantity) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)", [sale.warehouseId, item.productId, item.quantity]);
      await connection.execute("UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?", [item.quantity, item.productId]);
      await connection.execute("INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity_change, reference_type, reference_id, note) VALUES (?, ?, 'pos_sale_cancel', ?, 'pos_sale', ?, 'POS sale cancelled')", [sale.warehouseId, item.productId, item.quantity, saleId]);
    }
    await connection.execute("UPDATE pos_sales SET status = 'cancelled' WHERE id = ?", [saleId]);
    await connection.commit();
    res.json({ success: true, data: await saleDetails(saleId, connection) });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));
