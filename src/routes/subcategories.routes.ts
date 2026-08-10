import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { uploadSubcategoryImage } from "./uploads.routes";

export const subcategoriesRouter = Router();
const boolean = z.preprocess(value => value === "true" ? true : value === "false" ? false : value, z.boolean());
const imageFilename = z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(jpg|jpeg|png|webp|gif)$/i, "Image must be an uploaded image filename");
const inputSchema = z.object({ categoryId: z.coerce.number().int().positive(), name: z.string().trim().min(2).max(100), slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9-]+$/), image: imageFilename.nullable().optional(), isActive: boolean.optional() });
const select = "SELECT s.id, s.category_id AS categoryId, s.name, s.slug, s.image_url AS image, s.is_active AS isActive, s.created_at AS createdAt, s.updated_at AS updatedAt, c.name AS categoryName FROM subcategories s JOIN categories c ON c.id = s.category_id";

subcategoriesRouter.get("/", asyncHandler(async (req, res) => {
  const categoryId = req.query.categoryId ? z.coerce.number().int().positive().parse(req.query.categoryId) : undefined;
  const [rows] = categoryId ? await db.execute(`${select} WHERE s.category_id = ? ORDER BY s.name`, [categoryId]) : await db.query(`${select} ORDER BY s.name`);
  res.json({ success: true, data: rows });
}));
subcategoriesRouter.get("/:id", asyncHandler(async (req, res) => {
  const [rows] = await db.execute<any[]>(`${select} WHERE s.id = ?`, [Number(req.params.id)]);
  if (!rows[0]) throw new HttpError(404, "Subcategory not found"); res.json({ success: true, data: rows[0] });
}));
subcategoriesRouter.post("/", requireAuth, requireAdmin, uploadSubcategoryImage.single("image"), asyncHandler(async (req, res) => {
  const input = inputSchema.parse({ ...req.body, image: req.file?.filename ?? req.body?.image });
  const [result] = await db.execute<any>("INSERT INTO subcategories (category_id, name, slug, image_url, is_active) VALUES (?, ?, ?, ?, ?)", [input.categoryId, input.name, input.slug, input.image ?? null, input.isActive ?? true]);
  res.status(201).json({ success: true, data: { id: result.insertId } });
}));
subcategoriesRouter.patch("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const input = inputSchema.partial().parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, "Provide at least one field to update");
  const names: Record<string, string> = { categoryId: "category_id", image: "image_url", isActive: "is_active", name: "name", slug: "slug" };
  const fields = Object.entries(input).map(([key, value]) => ({ name: names[key]!, value }));
  const [result] = await db.query<any>(`UPDATE subcategories SET ${fields.map(f => `${f.name} = ?`).join(", ")} WHERE id = ?`, [...fields.map(f => f.value), Number(req.params.id)] as any);
  if (!result.affectedRows) throw new HttpError(404, "Subcategory not found"); res.json({ success: true, message: "Subcategory updated" });
}));
subcategoriesRouter.delete("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const [result] = await db.execute<any>("DELETE FROM subcategories WHERE id = ?", [Number(req.params.id)]);
  if (!result.affectedRows) throw new HttpError(404, "Subcategory not found"); res.status(204).send();
}));
