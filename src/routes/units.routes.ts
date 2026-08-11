import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const unitsRouter = Router();
const boolean = z.preprocess(value => value === "true" ? true : value === "false" ? false : value, z.boolean());
const unitInput = z.object({ name: z.string().trim().min(1).max(50), isActive: boolean.optional() });
const select = "SELECT id, name, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt FROM units";

unitsRouter.get("/", asyncHandler(async (_req, res) => { const [rows] = await db.query(`${select} ORDER BY name`); res.json({ success: true, data: rows }); }));
unitsRouter.get("/:id", asyncHandler(async (req, res) => { const [rows] = await db.execute<any[]>(`${select} WHERE id = ?`, [Number(req.params.id)]); if (!rows[0]) throw new HttpError(404, "Unit not found"); res.json({ success: true, data: rows[0] }); }));
unitsRouter.post("/", requireAuth, requireAdmin, asyncHandler(async (req, res) => { const input = unitInput.parse(req.body); const [result] = await db.execute<any>("INSERT INTO units (name, is_active) VALUES (?, ?)", [input.name, input.isActive ?? true]); const [rows] = await db.execute<any[]>(`${select} WHERE id = ?`, [result.insertId]); res.status(201).json({ success: true, data: rows[0] }); }));
unitsRouter.patch("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => { const input = unitInput.partial().parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, "Provide at least one field to update"); const fields = Object.entries(input).map(([key, value]) => ({ name: key === "isActive" ? "is_active" : key, value })); const [result] = await db.query<any>(`UPDATE units SET ${fields.map(f => `${f.name} = ?`).join(", ")} WHERE id = ?`, [...fields.map(f => f.value), Number(req.params.id)] as any); if (!result.affectedRows) throw new HttpError(404, "Unit not found"); res.json({ success: true, message: "Unit updated" }); }));
unitsRouter.delete("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => { const [result] = await db.execute<any>("DELETE FROM units WHERE id = ?", [Number(req.params.id)]); if (!result.affectedRows) throw new HttpError(404, "Unit not found"); res.status(204).send(); }));
