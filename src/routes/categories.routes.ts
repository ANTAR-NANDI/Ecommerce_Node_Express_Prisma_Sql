import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { publicImageUrl } from "../lib/public-image-url";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { uploadCategoryImage } from "./uploads.routes";

export const categoriesRouter = Router();
const withImageUrls = (req: Parameters<typeof publicImageUrl>[0], row: any) => ({
  ...row,
  image: publicImageUrl(req, "category", row.image),
  banner: publicImageUrl(req, "category", row.banner),
});
const boolean = z.preprocess(value => value === "true" ? true : value === "false" ? false : value, z.boolean());
const imageFilename = z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(jpg|jpeg|png|webp|gif)$/i, "Image must be an uploaded image filename");
const categoryInput = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9-]+$/),
  image: imageFilename.nullable().optional(),
  banner: imageFilename.nullable().optional(),
  order: z.coerce.number().int().nonnegative().optional(),
  description: z.string().trim().max(10_000).nullable().optional(),
  isActive: boolean.optional(),
});

categoriesRouter.get("/", asyncHandler(async (req, res) => {
  const [rows] = await db.query("SELECT id, name, slug, image_url AS image, banner, `order`, description, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt FROM categories ORDER BY `order`, name");
  res.json({ success: true, data: (rows as any[]).map(row => withImageUrls(req, row)) });
}));
categoriesRouter.get("/:id", asyncHandler(async (req, res) => {
  const [rows] = await db.execute<any[]>("SELECT id, name, slug, image_url AS image, banner, `order`, description, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt FROM categories WHERE id = ?", [Number(req.params.id)]);
  if (!rows[0]) throw new HttpError(404, "Category not found");
  res.json({ success: true, data: withImageUrls(req, rows[0]) });
}));
categoriesRouter.post("/", requireAuth, requireAdmin, uploadCategoryImage.single("image"), asyncHandler(async (req, res) => {
  // With multipart/form-data, Multer puts text fields in req.body and the file in req.file.
  // With JSON, clients may still send a previously uploaded image filename in req.body.image.
  const input = categoryInput.parse({ ...req.body, image: req.file?.filename ?? req.body?.image });
  const [result] = await db.execute<any>("INSERT INTO categories (name, slug, image_url, banner, `order`, description, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)", [input.name, input.slug, input.image ?? null, input.banner ?? null, input.order ?? 0, input.description ?? null, input.isActive ?? true]);
  const [rows] = await db.execute<any[]>("SELECT id, name, slug, image_url AS image, banner, `order`, description, is_active AS isActive FROM categories WHERE id = ?", [result.insertId]);
  res.status(201).json({ success: true, data: withImageUrls(req, rows[0]) });
}));
categoriesRouter.patch("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const input = categoryInput.partial().parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, "Provide at least one field to update");
  const fields = Object.entries(input).map(([key]) => ({ name: key === "image" ? "image_url" : key === "isActive" ? "is_active" : key === "order" ? "`order`" : key, value: input[key as keyof typeof input] }));
  const [result] = await db.query<any>(`UPDATE categories SET ${fields.map(f => `${f.name} = ?`).join(", ")} WHERE id = ?`, [...fields.map(f => f.value), Number(req.params.id)] as any);
  if (!result.affectedRows) throw new HttpError(404, "Category not found"); res.json({ success: true, message: "Category updated" });
}));
categoriesRouter.delete("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const [result] = await db.execute<any>("DELETE FROM categories WHERE id = ?", [Number(req.params.id)]);
  if (!result.affectedRows) throw new HttpError(404, "Category not found"); res.status(204).send();
}));
