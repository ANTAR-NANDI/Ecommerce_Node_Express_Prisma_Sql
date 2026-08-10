import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const brandsRouter = Router();

const boolean = z.preprocess(value => value === "true" ? true : value === "false" ? false : value, z.boolean());
const brandInput = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9-]+$/, "Slug may contain only lowercase letters, numbers, and hyphens"),
  logoUrl: z.string().url().max(500).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  isActive: boolean.optional(),
});

const select = "SELECT id, name, slug, logo_url AS logoUrl, description, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt FROM brands";

brandsRouter.get("/", asyncHandler(async (_req, res) => {
  const [rows] = await db.query(`${select} ORDER BY name`);
  res.json({ success: true, data: rows });
}));

brandsRouter.get("/:id", asyncHandler(async (req, res) => {
  const [rows] = await db.execute<any[]>(`${select} WHERE id = ?`, [Number(req.params.id)]);
  if (!rows[0]) throw new HttpError(404, "Brand not found");
  res.json({ success: true, data: rows[0] });
}));

brandsRouter.post("/", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const input = brandInput.parse(req.body);
  const [result] = await db.execute<any>(
    "INSERT INTO brands (name, slug, logo_url, description, is_active) VALUES (?, ?, ?, ?, ?)",
    [input.name, input.slug, input.logoUrl ?? null, input.description ?? null, input.isActive ?? true],
  );
  const [rows] = await db.execute<any[]>(`${select} WHERE id = ?`, [result.insertId]);
  res.status(201).json({ success: true, data: rows[0] });
}));

brandsRouter.patch("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const input = brandInput.partial().parse(req.body);
  if (!Object.keys(input).length) throw new HttpError(400, "Provide at least one field to update");
  const columnNames: Record<string, string> = { name: "name", slug: "slug", logoUrl: "logo_url", description: "description", isActive: "is_active" };
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
