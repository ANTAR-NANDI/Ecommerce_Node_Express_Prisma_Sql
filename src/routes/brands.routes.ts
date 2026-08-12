import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { publicImageUrl } from "../lib/public-image-url";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { uploadBrandImage } from "./uploads.routes";

export const brandsRouter = Router();
const withImageUrl = (req: Parameters<typeof publicImageUrl>[0], row: any) => ({ ...row, image: publicImageUrl(req, "brand", row.image) });

const boolean = z.preprocess(value => value === "true" ? true : value === "false" ? false : value, z.boolean());
const brandInput = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9-]+$/, "Slug may contain only lowercase letters, numbers, and hyphens"),
  image: z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(jpg|jpeg|png|webp|gif)$/i, "Image must be an uploaded image filename").nullable().optional(),
  isActive: boolean.optional(),
});

const select = "SELECT id, name, slug, logo_url AS image, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt FROM brands";

brandsRouter.get("/", asyncHandler(async (req, res) => {
  const where = req.baseUrl.startsWith("/admin/") ? "" : " WHERE is_active = TRUE";
  const [rows] = await db.query(`${select}${where} ORDER BY name`);
  res.json({ success: true, data: (rows as any[]).map(row => withImageUrl(req, row)) });
}));

brandsRouter.get("/:id", asyncHandler(async (req, res) => {
  const [rows] = await db.execute<any[]>(`${select} WHERE id = ?`, [Number(req.params.id)]);
  if (!rows[0]) throw new HttpError(404, "Brand not found");
  res.json({ success: true, data: withImageUrl(req, rows[0]) });
}));

brandsRouter.post("/", requireAuth, requireAdmin, uploadBrandImage.single("image"), asyncHandler(async (req, res) => {
  const input = brandInput.parse({ ...req.body, image: req.file?.filename ?? req.body?.image });
  const [result] = await db.execute<any>(
    "INSERT INTO brands (name, slug, logo_url, is_active) VALUES (?, ?, ?, ?)",
    [input.name, input.slug, input.image ?? null, input.isActive ?? true],
  );
  const [rows] = await db.execute<any[]>(`${select} WHERE id = ?`, [result.insertId]);
  res.status(201).json({ success: true, data: withImageUrl(req, rows[0]) });
}));

brandsRouter.patch("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const input = brandInput.partial().parse(req.body);
  if (!Object.keys(input).length) throw new HttpError(400, "Provide at least one field to update");
  const columnNames: Record<string, string> = { name: "name", slug: "slug", image: "logo_url", isActive: "is_active" };
  const fields = Object.entries(input).map(([key, value]) => ({ name: columnNames[key]!, value }));
  const [result] = await db.query<any>(`UPDATE brands SET ${fields.map(field => `${field.name} = ?`).join(", ")} WHERE id = ?`, [...fields.map(field => field.value), Number(req.params.id)] as any);
  if (!result.affectedRows) throw new HttpError(404, "Brand not found");
  res.json({ success: true, message: "Brand updated" });
}));

brandsRouter.delete("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const [result] = await db.execute<any>("DELETE FROM brands WHERE id = ?", [Number(req.params.id)]);
  if (!result.affectedRows) throw new HttpError(404, "Brand not found");
  res.status(204).send();
}));
