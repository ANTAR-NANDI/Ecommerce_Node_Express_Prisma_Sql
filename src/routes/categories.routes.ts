import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const categoriesRouter = Router();
const boolean = z.preprocess(value => value === "true" ? true : value === "false" ? false : value, z.boolean());
const categoryInput = z.object({ name: z.string().trim().min(2).max(100), slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9-]+$/), imageUrl: z.string().url().max(500).nullable().optional(), isActive: boolean.optional() });

categoriesRouter.get("/", asyncHandler(async (_req, res) => {
  const [rows] = await db.query("SELECT id, name, slug, image_url AS imageUrl, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt FROM categories ORDER BY name");
  res.json({ success: true, data: rows });
}));
categoriesRouter.get("/:id", asyncHandler(async (req, res) => {
  const [rows] = await db.execute<any[]>("SELECT id, name, slug, image_url AS imageUrl, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt FROM categories WHERE id = ?", [Number(req.params.id)]);
  if (!rows[0]) throw new HttpError(404, "Category not found");
  res.json({ success: true, data: rows[0] });
}));
categoriesRouter.post("/", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const input = categoryInput.parse(req.body);
  const [result] = await db.execute<any>("INSERT INTO categories (name, slug, image_url, is_active) VALUES (?, ?, ?, ?)", [input.name, input.slug, input.imageUrl ?? null, input.isActive ?? true]);
  const [rows] = await db.execute<any[]>("SELECT id, name, slug, image_url AS imageUrl, is_active AS isActive FROM categories WHERE id = ?", [result.insertId]);
  res.status(201).json({ success: true, data: rows[0] });
}));
categoriesRouter.patch("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const input = categoryInput.partial().parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, "Provide at least one field to update");
  const fields = Object.entries(input).map(([key]) => ({ name: key === "imageUrl" ? "image_url" : key === "isActive" ? "is_active" : key, value: input[key as keyof typeof input] }));
  const [result] = await db.query<any>(`UPDATE categories SET ${fields.map(f => `${f.name} = ?`).join(", ")} WHERE id = ?`, [...fields.map(f => f.value), Number(req.params.id)] as any);
  if (!result.affectedRows) throw new HttpError(404, "Category not found"); res.json({ success: true, message: "Category updated" });
}));
categoriesRouter.delete("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const [result] = await db.execute<any>("DELETE FROM categories WHERE id = ?", [Number(req.params.id)]);
  if (!result.affectedRows) throw new HttpError(404, "Category not found"); res.status(204).send();
}));
