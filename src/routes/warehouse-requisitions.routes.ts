import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const warehouseRequisitionsRouter = Router();
const id = z.coerce.number().int().positive();
const requestInput = z.object({ requestingWarehouseId: id, sourceWarehouseId: id, note: z.preprocess(value => value === "" ? null : value, z.string().trim().max(1000).nullable().optional()), items: z.array(z.object({ productId: id, quantity: z.coerce.number().int().positive() })).min(1).max(100) });
const headerSelect = `SELECT r.id, r.requisition_number AS requisitionNumber, r.requesting_warehouse_id AS requestingWarehouseId,
  requested.name AS requestingWarehouseName, r.source_warehouse_id AS sourceWarehouseId, source.name AS sourceWarehouseName,
  r.note, r.status, r.created_at AS createdAt, r.updated_at AS updatedAt FROM warehouse_requisitions r
  JOIN warehouses requested ON requested.id = r.requesting_warehouse_id JOIN warehouses source ON source.id = r.source_warehouse_id`;

// Requisitions reveal internal warehouse demand, so every endpoint is admin-only.
warehouseRequisitionsRouter.use(requireAuth, requireAdmin);

function requisitionNumber() { return `REQ-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`; }
function grouped(items: Array<{ productId: number; quantity: number }>) { return [...items.reduce((map, item) => map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity), new Map<number, number>())].map(([productId, quantity]) => ({ productId, quantity })); }
async function requisitionDetails(requisitionId: number, connection: any = db) {
  const [headers] = await connection.execute(`${headerSelect} WHERE r.id = ?`, [requisitionId]); const requisition = (headers as any[])[0]; if (!requisition) return null;
  const [items] = await connection.execute("SELECT ri.id, ri.product_id AS productId, p.name AS productName, p.sku, ri.quantity FROM warehouse_requisition_items ri JOIN products p ON p.id = ri.product_id WHERE ri.requisition_id = ? ORDER BY ri.id", [requisitionId]);
  return { ...requisition, items };
}

warehouseRequisitionsRouter.get("/", asyncHandler(async (req, res) => {
  const query = z.object({ status: z.enum(["pending", "approved", "rejected", "processing", "fulfilled", "cancelled"]).optional(), requestingWarehouseId: id.optional(), sourceWarehouseId: id.optional() }).parse(req.query);
  const filters: string[] = []; const values: Array<number | string> = [];
  if (query.status) { filters.push("r.status = ?"); values.push(query.status); }
  if (query.requestingWarehouseId) { filters.push("r.requesting_warehouse_id = ?"); values.push(query.requestingWarehouseId); }
  if (query.sourceWarehouseId) { filters.push("r.source_warehouse_id = ?"); values.push(query.sourceWarehouseId); }
  const [rows] = await db.execute<any[]>(`${headerSelect}${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""} ORDER BY r.created_at DESC`, values); res.json({ success: true, data: rows });
}));
warehouseRequisitionsRouter.get("/:id", asyncHandler(async (req, res) => { const item = await requisitionDetails(id.parse(req.params.id)); if (!item) throw new HttpError(404, "Warehouse requisition not found"); res.json({ success: true, data: item }); }));
warehouseRequisitionsRouter.post("/", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const input = requestInput.parse(req.body); if (input.requestingWarehouseId === input.sourceWarehouseId) throw new HttpError(400, "Requesting and source warehouses must be different");
  const connection = await db.getConnection(); try { await connection.beginTransaction(); const [result] = await connection.execute<any>("INSERT INTO warehouse_requisitions (requisition_number, requesting_warehouse_id, source_warehouse_id, note) VALUES (?, ?, ?, ?)", [requisitionNumber(), input.requestingWarehouseId, input.sourceWarehouseId, input.note ?? null]); for (const item of grouped(input.items)) await connection.execute("INSERT INTO warehouse_requisition_items (requisition_id, product_id, quantity) VALUES (?, ?, ?)", [result.insertId, item.productId, item.quantity]); await connection.commit(); res.status(201).json({ success: true, data: await requisitionDetails(result.insertId, connection) }); } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));
async function changeStatus(req: any, res: any, status: "approved" | "rejected" | "cancelled") {
  const requisitionId = id.parse(req.params.id); const [result] = await db.execute<any>("UPDATE warehouse_requisitions SET status = ? WHERE id = ? AND status = 'pending'", [status, requisitionId]); if (!result.affectedRows) throw new HttpError(400, "Only a pending requisition can be changed this way"); res.json({ success: true, data: await requisitionDetails(requisitionId) });
}
warehouseRequisitionsRouter.patch("/:id/approve", requireAuth, requireAdmin, asyncHandler(async (req, res) => changeStatus(req, res, "approved")));
warehouseRequisitionsRouter.post("/:id/approve", requireAuth, requireAdmin, asyncHandler(async (req, res) => changeStatus(req, res, "approved")));
warehouseRequisitionsRouter.patch("/:id/reject", requireAuth, requireAdmin, asyncHandler(async (req, res) => changeStatus(req, res, "rejected")));
warehouseRequisitionsRouter.patch("/:id/cancel", requireAuth, requireAdmin, asyncHandler(async (req, res) => changeStatus(req, res, "cancelled")));
