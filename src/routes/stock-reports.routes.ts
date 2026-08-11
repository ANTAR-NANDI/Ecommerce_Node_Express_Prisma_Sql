import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const stockReportsRouter = Router();
const id = z.coerce.number().int().positive();

stockReportsRouter.use(requireAuth, requireAdmin);
stockReportsRouter.get("/", asyncHandler(async (req, res) => {
  const query = z.object({ warehouseId: id.optional(), productId: id.optional(), dateFrom: z.string().date().optional(), dateTo: z.string().date().optional() }).parse(req.query);
  const filters: string[] = []; const values: Array<number | string> = [];
  if (query.warehouseId) { filters.push("ws.warehouse_id = ?"); values.push(query.warehouseId); }
  if (query.productId) { filters.push("ws.product_id = ?"); values.push(query.productId); }
  const [stockBalances] = await db.execute<any[]>(`SELECT ws.warehouse_id AS warehouseId, w.name AS warehouseName, ws.product_id AS productId, p.name AS productName, p.sku, ws.quantity, ws.updated_at AS updatedAt FROM warehouse_stocks ws JOIN warehouses w ON w.id = ws.warehouse_id JOIN products p ON p.id = ws.product_id${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""} ORDER BY w.name, p.name`, values);
  const movementFilters: string[] = []; const movementValues: Array<number | string> = [];
  if (query.warehouseId) { movementFilters.push("sm.warehouse_id = ?"); movementValues.push(query.warehouseId); }
  if (query.productId) { movementFilters.push("sm.product_id = ?"); movementValues.push(query.productId); }
  if (query.dateFrom) { movementFilters.push("DATE(sm.created_at) >= ?"); movementValues.push(query.dateFrom); }
  if (query.dateTo) { movementFilters.push("DATE(sm.created_at) <= ?"); movementValues.push(query.dateTo); }
  const [movements] = await db.execute<any[]>(`SELECT sm.id, sm.warehouse_id AS warehouseId, w.name AS warehouseName, sm.product_id AS productId, p.name AS productName, p.sku, sm.movement_type AS movementType, sm.quantity_change AS quantityChange, sm.reference_type AS referenceType, sm.reference_id AS referenceId, sm.note, sm.created_at AS createdAt FROM stock_movements sm JOIN warehouses w ON w.id = sm.warehouse_id JOIN products p ON p.id = sm.product_id${movementFilters.length ? ` WHERE ${movementFilters.join(" AND ")}` : ""} ORDER BY sm.created_at DESC`, movementValues);
  const totalQuantity = stockBalances.reduce((sum, row) => sum + Number(row.quantity), 0);
  const movementQuantity = movements.reduce((sum, row) => sum + Number(row.quantityChange), 0);
  res.json({ success: true, filters: query, summary: { stockRows: stockBalances.length, currentTotalQuantity: totalQuantity, movementQuantity }, stockBalances, movements });
}));
