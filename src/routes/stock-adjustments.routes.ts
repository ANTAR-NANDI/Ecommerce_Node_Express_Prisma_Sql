import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const stockAdjustmentsRouter = Router();
const id = z.coerce.number().int().positive();
const adjustmentInput = z.object({
  warehouseId: id,
  adjustmentDate: z.string().date().optional(),
  reason: z.string().trim().min(2).max(500),
  items: z.array(z.object({ productId: id, quantityChange: z.coerce.number().int().refine(value => value !== 0, "Quantity change cannot be zero"), note: z.preprocess(value => value === "" ? null : value, z.string().trim().max(500).nullable().optional()) })).min(1).max(100),
});
const headerSelect = `SELECT sa.id, sa.adjustment_number AS adjustmentNumber, sa.warehouse_id AS warehouseId,
  w.name AS warehouseName, sa.adjustment_date AS adjustmentDate, sa.reason, sa.status, sa.created_at AS createdAt
  FROM stock_adjustments sa JOIN warehouses w ON w.id = sa.warehouse_id`;

function adjustmentNumber() { return `ADJ-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`; }
async function adjustmentDetails(adjustmentId: number, connection: any = db) {
  const [headers] = await connection.execute(`${headerSelect} WHERE sa.id = ?`, [adjustmentId]); const adjustment = (headers as any[])[0]; if (!adjustment) return null;
  const [items] = await connection.execute("SELECT sai.id, sai.product_id AS productId, p.name AS productName, p.sku, sai.quantity_change AS quantityChange, sai.note FROM stock_adjustment_items sai JOIN products p ON p.id = sai.product_id WHERE sai.stock_adjustment_id = ? ORDER BY sai.id", [adjustmentId]);
  return { ...adjustment, items };
}

stockAdjustmentsRouter.use(requireAuth, requireAdmin);
stockAdjustmentsRouter.get("/", asyncHandler(async (req, res) => {
  const query = z.object({ warehouseId: id.optional(), status: z.enum(["completed", "cancelled"]).optional(), dateFrom: z.string().date().optional(), dateTo: z.string().date().optional() }).parse(req.query);
  const filters: string[] = []; const values: Array<string | number> = [];
  if (query.warehouseId) { filters.push("sa.warehouse_id = ?"); values.push(query.warehouseId); }
  if (query.status) { filters.push("sa.status = ?"); values.push(query.status); }
  if (query.dateFrom) { filters.push("sa.adjustment_date >= ?"); values.push(query.dateFrom); }
  if (query.dateTo) { filters.push("sa.adjustment_date <= ?"); values.push(query.dateTo); }
  const [rows] = await db.execute<any[]>(`${headerSelect}${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""} ORDER BY sa.created_at DESC`, values); res.json({ success: true, data: rows });
}));
stockAdjustmentsRouter.get("/:id", asyncHandler(async (req, res) => { const adjustment = await adjustmentDetails(id.parse(req.params.id)); if (!adjustment) throw new HttpError(404, "Stock adjustment not found"); res.json({ success: true, data: adjustment }); }));
stockAdjustmentsRouter.post("/", asyncHandler(async (req, res) => {
  const input = adjustmentInput.parse(req.body); const adjustmentDate = input.adjustmentDate ?? new Date().toISOString().slice(0, 10); const connection = await db.getConnection();
  try {
    await connection.beginTransaction(); const [result] = await connection.execute<any>("INSERT INTO stock_adjustments (adjustment_number, warehouse_id, adjustment_date, reason, status) VALUES (?, ?, ?, ?, 'completed')", [adjustmentNumber(), input.warehouseId, adjustmentDate, input.reason]);
    for (const item of input.items) {
      if (item.quantityChange < 0) { const [stock] = await connection.execute<any>("UPDATE warehouse_stocks SET quantity = quantity + ? WHERE warehouse_id = ? AND product_id = ? AND quantity >= ?", [item.quantityChange, input.warehouseId, item.productId, -item.quantityChange]); if (!stock.affectedRows) throw new HttpError(400, `Insufficient stock for product ID ${item.productId}`); }
      else await connection.execute("INSERT INTO warehouse_stocks (warehouse_id, product_id, quantity) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)", [input.warehouseId, item.productId, item.quantityChange]);
      await connection.execute("UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?", [item.quantityChange, item.productId]);
      await connection.execute("INSERT INTO stock_adjustment_items (stock_adjustment_id, product_id, quantity_change, note) VALUES (?, ?, ?, ?)", [result.insertId, item.productId, item.quantityChange, item.note ?? null]);
      await connection.execute("INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity_change, reference_type, reference_id, note) VALUES (?, ?, 'adjustment', ?, 'stock_adjustment', ?, ?)", [input.warehouseId, item.productId, item.quantityChange, result.insertId, item.note ?? input.reason]);
    }
    await connection.commit(); res.status(201).json({ success: true, data: await adjustmentDetails(result.insertId, connection) });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));
stockAdjustmentsRouter.patch("/:id/cancel", asyncHandler(async (req, res) => {
  const adjustmentId = id.parse(req.params.id); const connection = await db.getConnection();
  try {
    await connection.beginTransaction(); const adjustment = await adjustmentDetails(adjustmentId, connection); if (!adjustment) throw new HttpError(404, "Stock adjustment not found"); if (adjustment.status === "cancelled") throw new HttpError(400, "Stock adjustment is already cancelled");
    for (const item of adjustment.items as any[]) {
      const reversal = -Number(item.quantityChange);
      if (reversal < 0) { const [stock] = await connection.execute<any>("UPDATE warehouse_stocks SET quantity = quantity + ? WHERE warehouse_id = ? AND product_id = ? AND quantity >= ?", [reversal, adjustment.warehouseId, item.productId, -reversal]); if (!stock.affectedRows) throw new HttpError(400, `Cannot cancel: insufficient stock for ${item.productName}`); }
      else await connection.execute("INSERT INTO warehouse_stocks (warehouse_id, product_id, quantity) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)", [adjustment.warehouseId, item.productId, reversal]);
      await connection.execute("UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?", [reversal, item.productId]);
      await connection.execute("INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity_change, reference_type, reference_id, note) VALUES (?, ?, 'adjustment_cancel', ?, 'stock_adjustment', ?, 'Stock adjustment cancelled')", [adjustment.warehouseId, item.productId, reversal, adjustmentId]);
    }
    await connection.execute("UPDATE stock_adjustments SET status = 'cancelled' WHERE id = ?", [adjustmentId]); await connection.commit(); res.json({ success: true, data: await adjustmentDetails(adjustmentId, connection) });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));
