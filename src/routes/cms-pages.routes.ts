import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const cmsPagesRouter = Router();
const id = z.coerce.number().int().positive();
const boolean = z.preprocess(value => value === "true" ? true : value === "false" ? false : value, z.boolean());
const nullableText = (max: number) => z.preprocess(value => value === "" ? null : value, z.string().trim().max(max).nullable().optional());
const pageInput = z.object({
  title: z.string().trim().min(2).max(255),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens only").max(255),
  content: z.string().trim().min(1).max(1_000_000),
  seoTitle: nullableText(255),
  seoDescription: nullableText(500),
  isActive: boolean.optional(),
});
const select = "SELECT id, title, slug, content, seo_title AS seoTitle, seo_description AS seoDescription, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt FROM cms_pages";

cmsPagesRouter.get("/", requireAuth, requireAdmin, asyncHandler(async (_req, res) => {
  const [rows] = await db.query<any[]>(`${select} ORDER BY title, id`);
  res.json({ success: true, data: rows });
}));

cmsPagesRouter.post("/", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const input = pageInput.parse(req.body);
  const [result] = await db.execute<any>("INSERT INTO cms_pages (title, slug, content, seo_title, seo_description, is_active) VALUES (?, ?, ?, ?, ?, ?)", [input.title, input.slug, input.content, input.seoTitle ?? null, input.seoDescription ?? null, input.isActive ?? true]);
  const [rows] = await db.execute<any[]>(`${select} WHERE id = ?`, [result.insertId]);
  res.status(201).json({ success: true, data: rows[0] });
}));

cmsPagesRouter.get("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const [rows] = await db.execute<any[]>(`${select} WHERE id = ?`, [id.parse(req.params.id)]);
  if (!rows[0]) throw new HttpError(404, "CMS page not found");
  res.json({ success: true, data: rows[0] });
}));

cmsPagesRouter.patch("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const pageId = id.parse(req.params.id); const input = pageInput.partial().parse(req.body);
  if (!Object.keys(input).length) throw new HttpError(400, "Provide at least one field to update");
  const columns: Record<string, string> = { title: "title", slug: "slug", content: "content", seoTitle: "seo_title", seoDescription: "seo_description", isActive: "is_active" };
  const entries = Object.entries(input).map(([key, value]) => [columns[key]!, value]);
  const [result] = await db.execute<any>(`UPDATE cms_pages SET ${entries.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`, [...entries.map(([, value]) => value), pageId] as any);
  if (!result.affectedRows) throw new HttpError(404, "CMS page not found");
  const [rows] = await db.execute<any[]>(`${select} WHERE id = ?`, [pageId]);
  res.json({ success: true, data: rows[0] });
}));

cmsPagesRouter.delete("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const [result] = await db.execute<any>("DELETE FROM cms_pages WHERE id = ?", [id.parse(req.params.id)]);
  if (!result.affectedRows) throw new HttpError(404, "CMS page not found");
  res.status(204).send();
}));

export const storefrontPagesRouter = Router();
storefrontPagesRouter.get("/:slug", asyncHandler(async (req, res) => {
  const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).parse(req.params.slug);
  const [rows] = await db.execute<any[]>(`${select} WHERE slug = ? AND is_active = TRUE`, [slug]);
  if (!rows[0]) throw new HttpError(404, "Page not found");
  res.json({ success: true, data: rows[0] });
}));
