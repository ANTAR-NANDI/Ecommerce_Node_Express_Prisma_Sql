import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { createPartyCoa } from "../lib/party-coa";
import { publicImageUrl } from "../lib/public-image-url";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { uploadSupplierImage } from "./uploads.routes";

export const suppliersRouter = Router();
const withImageUrl = (req: Parameters<typeof publicImageUrl>[0], row: any) => ({ ...row, image: publicImageUrl(req, "supplier", row.image) });
const boolean = z.preprocess(value => value === "true" ? true : value === "false" ? false : value, z.boolean());
const nullableText = z.preprocess(value => value === "" ? null : value, z.string().trim().max(500).nullable().optional());
const imageFilename = z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(jpg|jpeg|png|webp|gif)$/i, "Image must be an uploaded image filename");
const supplierInput = z.object({
  name: z.string().trim().min(2).max(150),
  image: imageFilename.nullable().optional(),
  phone: nullableText,
  email: z.preprocess(value => value === "" ? null : value, z.string().email().nullable().optional()),
  address: nullableText,
  isActive: boolean.optional(),
});
const select = "SELECT id, name, image AS image, phone, email, address, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt FROM suppliers";

suppliersRouter.get("/", asyncHandler(async (req, res) => { const [rows] = await db.query(`${select} ORDER BY name`); res.json({ success: true, data: (rows as any[]).map(row => withImageUrl(req, row)) }); }));
suppliersRouter.get("/:id", asyncHandler(async (req, res) => { const [rows] = await db.execute<any[]>(`${select} WHERE id = ?`, [Number(req.params.id)]); if (!rows[0]) throw new HttpError(404, "Supplier not found"); res.json({ success: true, data: withImageUrl(req, rows[0]) }); }));
suppliersRouter.post("/", requireAuth, requireAdmin, uploadSupplierImage.single("image"), asyncHandler(async (req, res) => {
  const input = supplierInput.parse({ ...req.body, image: req.file?.filename ?? req.body?.image });
  const [result] = await db.execute<any>("INSERT INTO suppliers (name, image, phone, email, address, is_active) VALUES (?, ?, ?, ?, ?, ?)", [input.name, input.image ?? null, input.phone ?? null, input.email ?? null, input.address ?? null, input.isActive ?? true]);
  await createPartyCoa("supplier", result.insertId, input.name);
  const [rows] = await db.execute<any[]>(`${select} WHERE id = ?`, [result.insertId]); res.status(201).json({ success: true, data: withImageUrl(req, rows[0]) });
}));
suppliersRouter.patch("/:id", requireAuth, requireAdmin, uploadSupplierImage.single("image"), asyncHandler(async (req, res) => {
  const updateBody = { ...(req.body ?? {}) };
  if (req.file) updateBody.image = req.file.filename;
  const input = supplierInput.partial().parse(updateBody); if (!Object.keys(input).length) throw new HttpError(400, "Provide at least one field to update");
  const names: Record<string, string> = { name: "name", image: "image", phone: "phone", email: "email", address: "address", isActive: "is_active" };
  const fields = Object.entries(input).map(([key, value]) => ({ name: names[key]!, value }));
  const [result] = await db.query<any>(`UPDATE suppliers SET ${fields.map(field => `${field.name} = ?`).join(", ")} WHERE id = ?`, [...fields.map(field => field.value), Number(req.params.id)] as any);
  if (!result.affectedRows) throw new HttpError(404, "Supplier not found"); res.json({ success: true, message: "Supplier updated" });
}));
suppliersRouter.delete("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => { const [result] = await db.execute<any>("DELETE FROM suppliers WHERE id = ?", [Number(req.params.id)]); if (!result.affectedRows) throw new HttpError(404, "Supplier not found"); res.status(204).send(); }));
