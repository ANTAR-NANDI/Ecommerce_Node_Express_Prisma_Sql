import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const suppliersRouter = Router();
const boolean = z.preprocess(value => value === "true" ? true : value === "false" ? false : value, z.boolean());
const nullableText = z.preprocess(value => value === "" ? null : value, z.string().trim().max(500).nullable().optional());
const supplierInput = z.object({ name: z.string().trim().min(2).max(150), contactPerson: nullableText, phone: nullableText, email: z.preprocess(value => value === "" ? null : value, z.string().email().nullable().optional()), address: nullableText, isActive: boolean.optional() });
const select = "SELECT id, name, contact_person AS contactPerson, phone, email, address, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt FROM suppliers";

suppliersRouter.get("/", asyncHandler(async (_req, res) => { const [rows] = await db.query(`${select} ORDER BY name`); res.json({ success: true, data: rows }); }));
suppliersRouter.get("/:id", asyncHandler(async (req, res) => { const [rows] = await db.execute<any[]>(`${select} WHERE id = ?`, [Number(req.params.id)]); if (!rows[0]) throw new HttpError(404, "Supplier not found"); res.json({ success: true, data: rows[0] }); }));
suppliersRouter.post("/", requireAuth, requireAdmin, asyncHandler(async (req, res) => { const input = supplierInput.parse(req.body); const [result] = await db.execute<any>("INSERT INTO suppliers (name, contact_person, phone, email, address, is_active) VALUES (?, ?, ?, ?, ?, ?)", [input.name, input.contactPerson ?? null, input.phone ?? null, input.email ?? null, input.address ?? null, input.isActive ?? true]); const [rows] = await db.execute<any[]>(`${select} WHERE id = ?`, [result.insertId]); res.status(201).json({ success: true, data: rows[0] }); }));
suppliersRouter.patch("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => { const input = supplierInput.partial().parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, "Provide at least one field to update"); const names: Record<string, string> = { name: "name", contactPerson: "contact_person", phone: "phone", email: "email", address: "address", isActive: "is_active" }; const fields = Object.entries(input).map(([key, value]) => ({ name: names[key]!, value })); const [result] = await db.query<any>(`UPDATE suppliers SET ${fields.map(field => `${field.name} = ?`).join(", ")} WHERE id = ?`, [...fields.map(field => field.value), Number(req.params.id)] as any); if (!result.affectedRows) throw new HttpError(404, "Supplier not found"); res.json({ success: true, message: "Supplier updated" }); }));
suppliersRouter.delete("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => { const [result] = await db.execute<any>("DELETE FROM suppliers WHERE id = ?", [Number(req.params.id)]); if (!result.affectedRows) throw new HttpError(404, "Supplier not found"); res.status(204).send(); }));
