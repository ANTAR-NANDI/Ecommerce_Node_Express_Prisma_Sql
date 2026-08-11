import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const salesReturnsRouter = Router();
const id = z.coerce.number().int().positive();
const sourceType = z.enum(["pos_sale", "ecommerce_order"]);
const returnInput = z.object({
  sourceType,
  sourceId: id,
  returnDate: z.string().date().optional(),
  reason: z.string().trim().min(2).max(1000),
  items: z.array(z.object({ productId: id, quantity: z.coerce.number().int().positive() })).min(1).max(100),
});
const headerSelect = `SELECT sr.id, sr.return_number AS returnNumber, sr.source_type AS sourceType,
  sr.source_id AS sourceId, sr.warehouse_id AS warehouseId, w.name AS warehouseName,
  sr.customer_id AS customerId, c.name AS customerName, sr.return_date AS returnDate,
  sr.reason, sr.status, sr.created_at AS createdAt, sr.updated_at AS updatedAt
  FROM sales_returns sr JOIN warehouses w ON w.id = sr.warehouse_id
  LEFT JOIN customers c ON c.id = sr.customer_id`;

function returnNumber() { return `SRT-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`; }
async function returnDetails(returnId: number, connection: any = db) {
  const [headers] = await connection.execute(`${headerSelect} WHERE sr.id = ?`, [returnId]);
  const salesReturn = (headers as any[])[0]; if (!salesReturn) return null;
  const [items] = await connection.execute(`SELECT sri.id, sri.product_id AS productId, p.name AS productName, p.sku, sri.quantity
    FROM sales_return_items sri JOIN products p ON p.id = sri.product_id
    WHERE sri.sales_return_id = ? ORDER BY sri.id`, [returnId]);
  return { ...salesReturn, items };
}

async function sourceSale(type: "pos_sale" | "ecommerce_order", sourceId: number, connection: any) {
  if (type === "pos_sale") {
    const [headers] = await connection.execute("SELECT id, warehouse_id AS warehouseId, customer_id AS customerId, status FROM pos_sales WHERE id = ?", [sourceId]);
    if (!headers[0]) throw new HttpError(404, "POS sale not found");
    if (headers[0].status !== "completed") throw new HttpError(400, "Only a completed POS sale can be returned");
    const [items] = await connection.execute("SELECT product_id AS productId, quantity FROM pos_sale_items WHERE pos_sale_id = ?", [sourceId]);
    return { ...headers[0], items };
  }
  const [headers] = await connection.execute("SELECT id, warehouse_id AS warehouseId, customer_id AS customerId, status FROM ecommerce_orders WHERE id = ?", [sourceId]);
  if (!headers[0]) throw new HttpError(404, "E-commerce order not found");
  if (headers[0].status !== "delivered") throw new HttpError(400, "Only a delivered e-commerce order can be returned");
  const [items] = await connection.execute("SELECT product_id AS productId, quantity FROM ecommerce_order_items WHERE ecommerce_order_id = ?", [sourceId]);
  return { ...headers[0], items };
}

salesReturnsRouter.use(requireAuth, requireAdmin);

salesReturnsRouter.get("/", asyncHandler(async (req, res) => {
  const query = z.object({ sourceType: sourceType.optional(), sourceId: id.optional(), warehouseId: id.optional(), status: z.enum(["completed", "cancelled"]).optional(), dateFrom: z.string().date().optional(), dateTo: z.string().date().optional() }).parse(req.query);
  const filters: string[] = []; const values: Array<string | number> = [];
  if (query.sourceType) { filters.push("sr.source_type = ?"); values.push(query.sourceType); }
  if (query.sourceId) { filters.push("sr.source_id = ?"); values.push(query.sourceId); }
  if (query.warehouseId) { filters.push("sr.warehouse_id = ?"); values.push(query.warehouseId); }
  if (query.status) { filters.push("sr.status = ?"); values.push(query.status); }
  if (query.dateFrom) { filters.push("sr.return_date >= ?"); values.push(query.dateFrom); }
  if (query.dateTo) { filters.push("sr.return_date <= ?"); values.push(query.dateTo); }
  const [rows] = await db.execute<any[]>(`${headerSelect}${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""} ORDER BY sr.return_date DESC, sr.id DESC`, values);
  res.json({ success: true, data: rows });
}));

salesReturnsRouter.get("/:id", asyncHandler(async (req, res) => {
  const salesReturn = await returnDetails(id.parse(req.params.id)); if (!salesReturn) throw new HttpError(404, "Sales return not found"); res.json({ success: true, data: salesReturn });
}));

salesReturnsRouter.post("/", asyncHandler(async (req, res) => {
  const input = returnInput.parse(req.body);
  // Combine repeated product lines so the total return quantity is checked correctly.
  const quantities = new Map<number, number>();
  for (const item of input.items) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const source = await sourceSale(input.sourceType, input.sourceId, connection);
    const soldQuantities = new Map<number, number>((source.items as any[]).map(item => [Number(item.productId), Number(item.quantity)]));
    for (const [productId, quantity] of quantities) {
      const sold = soldQuantities.get(productId) ?? 0;
      if (!sold) throw new HttpError(400, `Product ID ${productId} is not in the original sale`);
      const [previous] = await connection.execute<any[]>(`SELECT COALESCE(SUM(sri.quantity), 0) AS returnedQuantity
        FROM sales_return_items sri JOIN sales_returns sr ON sr.id = sri.sales_return_id
        WHERE sr.source_type = ? AND sr.source_id = ? AND sr.status = 'completed' AND sri.product_id = ?`, [input.sourceType, input.sourceId, productId]);
      if (Number(previous[0].returnedQuantity) + quantity > sold) throw new HttpError(400, `Return quantity exceeds the sold quantity for product ID ${productId}`);
    }
    const returnDate = input.returnDate ?? new Date().toISOString().slice(0, 10);
    const [result] = await connection.execute<any>("INSERT INTO sales_returns (return_number, source_type, source_id, warehouse_id, customer_id, return_date, reason, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')", [returnNumber(), input.sourceType, input.sourceId, source.warehouseId, source.customerId ?? null, returnDate, input.reason]);
    for (const [productId, quantity] of quantities) {
      await connection.execute("INSERT INTO sales_return_items (sales_return_id, product_id, quantity) VALUES (?, ?, ?)", [result.insertId, productId, quantity]);
      await connection.execute("INSERT INTO warehouse_stocks (warehouse_id, product_id, quantity) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)", [source.warehouseId, productId, quantity]);
      await connection.execute("UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?", [quantity, productId]);
      await connection.execute("INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity_change, reference_type, reference_id, note) VALUES (?, ?, 'sales_return', ?, 'sales_return', ?, ?)", [source.warehouseId, productId, quantity, result.insertId, input.reason]);
    }
    await connection.commit(); res.status(201).json({ success: true, data: await returnDetails(result.insertId, connection) });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

salesReturnsRouter.patch("/:id/cancel", asyncHandler(async (req, res) => {
  const returnId = id.parse(req.params.id); const connection = await db.getConnection();
  try {
    await connection.beginTransaction(); const salesReturn = await returnDetails(returnId, connection);
    if (!salesReturn) throw new HttpError(404, "Sales return not found");
    if (salesReturn.status === "cancelled") throw new HttpError(400, "Sales return is already cancelled");
    for (const item of salesReturn.items as any[]) {
      const [stock] = await connection.execute<any>("UPDATE warehouse_stocks SET quantity = quantity - ? WHERE warehouse_id = ? AND product_id = ? AND quantity >= ?", [item.quantity, salesReturn.warehouseId, item.productId, item.quantity]);
      if (!stock.affectedRows) throw new HttpError(400, `Cannot cancel: insufficient stock for ${item.productName}`);
      await connection.execute("UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?", [item.quantity, item.productId]);
      await connection.execute("INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity_change, reference_type, reference_id, note) VALUES (?, ?, 'sales_return_cancel', ?, 'sales_return', ?, 'Sales return cancelled')", [salesReturn.warehouseId, item.productId, -item.quantity, returnId]);
    }
    await connection.execute("UPDATE sales_returns SET status = 'cancelled' WHERE id = ?", [returnId]);
    await connection.commit(); res.json({ success: true, data: await returnDetails(returnId, connection) });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));
