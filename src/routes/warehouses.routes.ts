import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const warehousesRouter = Router();
const boolean = z.preprocess(value => value === "true" ? true : value === "false" ? false : value, z.boolean());
const nullableText = z.preprocess(value => value === "" ? null : value, z.string().trim().max(500).nullable().optional());
const warehouseInput = z.object({ name: z.string().trim().min(2).max(150), code: z.string().trim().min(2).max(50).regex(/^[A-Z0-9-]+$/, "Use uppercase letters, numbers, and hyphens"), phone: nullableText, address: nullableText, isActive: boolean.optional() });
const select = "SELECT id, name, code, phone, address, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt FROM warehouses";

warehousesRouter.get("/", asyncHandler(async (_req, res) => { const [rows] = await db.query(`${select} ORDER BY name`); res.json({ success: true, data: rows }); }));
warehousesRouter.get("/:id", asyncHandler(async (req, res) => { const [rows] = await db.execute<any[]>(`${select} WHERE id = ?`, [Number(req.params.id)]); if (!rows[0]) throw new HttpError(404, "Warehouse not found"); res.json({ success: true, data: rows[0] }); }));
warehousesRouter.post("/", requireAuth, requireAdmin, asyncHandler(async (req, res) => { const input = warehouseInput.parse(req.body); const [result] = await db.execute<any>("INSERT INTO warehouses (name, code, phone, address, is_active) VALUES (?, ?, ?, ?, ?)", [input.name, input.code, input.phone ?? null, input.address ?? null, input.isActive ?? true]); const [rows] = await db.execute<any[]>(`${select} WHERE id = ?`, [result.insertId]); res.status(201).json({ success: true, data: rows[0] }); }));
warehousesRouter.patch("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => { const input = warehouseInput.partial().parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, "Provide at least one field to update"); const fields = Object.entries(input).map(([key, value]) => ({ name: key === "isActive" ? "is_active" : key, value })); const [result] = await db.query<any>(`UPDATE warehouses SET ${fields.map(field => `${field.name} = ?`).join(", ")} WHERE id = ?`, [...fields.map(field => field.value), Number(req.params.id)] as any); if (!result.affectedRows) throw new HttpError(404, "Warehouse not found"); res.json({ success: true, message: "Warehouse updated" }); }));
warehousesRouter.delete("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => { const [result] = await db.execute<any>("DELETE FROM warehouses WHERE id = ?", [Number(req.params.id)]); if (!result.affectedRows) throw new HttpError(404, "Warehouse not found"); res.status(204).send(); }));

// This is the dynamic stock balance for the selected warehouse.
warehousesRouter.get("/:id/stocks", asyncHandler(async (req, res) => {
  const warehouseId = z.coerce.number().int().positive().parse(req.params.id);
  const [warehouses] = await db.execute<any[]>("SELECT id, name, code FROM warehouses WHERE id = ? AND is_active = TRUE", [warehouseId]);
  if (!warehouses[0]) throw new HttpError(404, "Active warehouse not found");
  const [rows] = await db.execute<any[]>(
    `SELECT ws.product_id AS productId, p.name AS productName, p.slug, p.sku,
      p.selling_price AS sellingPrice, p.discount_type AS discountType, p.discount,
      ws.quantity AS availableQuantity, ws.updated_at AS updatedAt
     FROM warehouse_stocks ws
     JOIN products p ON p.id = ws.product_id
     WHERE ws.warehouse_id = ? AND ws.quantity > 0 AND p.is_active = TRUE
     ORDER BY p.name`,
    [warehouseId],
  );
  res.json({ success: true, data: { warehouse: warehouses[0], products: rows } });
}));
