import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const cmsSectionsRouter = Router();
export const storefrontSectionsRouter = Router();
const id = z.coerce.number().int().positive();
const boolean = z.preprocess(value => value === "true" ? true : value === "false" ? false : value, z.boolean());
const nullableText = (max: number) => z.preprocess(value => value === "" ? null : value, z.string().trim().max(max).nullable().optional());
const sectionInput = z.object({
  sectionType: z.string().trim().regex(/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/, "Use lowercase letters, numbers, hyphens, or underscores only").max(100),
  title: nullableText(255),
  settings: z.record(z.string(), z.unknown()),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: boolean.optional().default(true),
});
const sectionSelect = `SELECT id, page_id AS pageId, section_type AS sectionType, title, settings,
  sort_order AS sortOrder, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt
  FROM cms_page_sections`;
const pageSelect = "SELECT id, title, slug, seo_title AS seoTitle, seo_description AS seoDescription FROM cms_pages";
function format(row: any) { return { ...row, settings: typeof row.settings === "string" ? JSON.parse(row.settings) : row.settings }; }
async function pageExists(pageId: number, activeOnly = false, connection: any = db) {
  const [rows] = await connection.execute(`${pageSelect} WHERE id = ?${activeOnly ? " AND is_active = TRUE" : ""}`, [pageId]);
  return rows[0] ?? null;
}
async function getSection(sectionId: number, connection: any = db) {
  const [rows] = await connection.execute(`${sectionSelect} WHERE id = ?`, [sectionId]);
  return rows[0] ? format(rows[0]) : null;
}

cmsSectionsRouter.get("/pages/:pageId/sections", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const pageId = id.parse(req.params.pageId); const page = await pageExists(pageId); if (!page) throw new HttpError(404, "CMS page not found");
  const [rows] = await db.execute<any[]>(`${sectionSelect} WHERE page_id = ? ORDER BY sort_order, id`, [pageId]);
  res.json({ success: true, data: rows.map(format) });
}));

cmsSectionsRouter.post("/pages/:pageId/sections", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const pageId = id.parse(req.params.pageId); if (!await pageExists(pageId)) throw new HttpError(404, "CMS page not found");
  const input = sectionInput.parse(req.body);
  const [result] = await db.execute<any>("INSERT INTO cms_page_sections (page_id, section_type, title, settings, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?)", [pageId, input.sectionType, input.title ?? null, JSON.stringify(input.settings), input.sortOrder, input.isActive]);
  res.status(201).json({ success: true, data: await getSection(result.insertId) });
}));

cmsSectionsRouter.patch("/sections/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const sectionId = id.parse(req.params.id); if (!await getSection(sectionId)) throw new HttpError(404, "CMS section not found");
  const input = sectionInput.partial().parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, "Provide at least one field to update");
  const columns: Record<string, string> = { sectionType: "section_type", title: "title", settings: "settings", sortOrder: "sort_order", isActive: "is_active" };
  const entries = Object.entries(input).map(([key, value]) => [columns[key]!, key === "settings" ? JSON.stringify(value) : value]);
  await db.execute(`UPDATE cms_page_sections SET ${entries.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`, [...entries.map(([, value]) => value), sectionId] as any);
  res.json({ success: true, data: await getSection(sectionId) });
}));

cmsSectionsRouter.delete("/sections/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const [result] = await db.execute<any>("DELETE FROM cms_page_sections WHERE id = ?", [id.parse(req.params.id)]);
  if (!result.affectedRows) throw new HttpError(404, "CMS section not found");
  res.status(204).send();
}));

cmsSectionsRouter.patch("/pages/:pageId/sections/order", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const pageId = id.parse(req.params.pageId); if (!await pageExists(pageId)) throw new HttpError(404, "CMS page not found");
  const input = z.object({ sections: z.array(z.object({ id, sortOrder: z.coerce.number().int().min(0) })).min(1).max(1000) }).parse(req.body);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    for (const item of input.sections) {
      const [result] = await connection.execute<any>("UPDATE cms_page_sections SET sort_order = ? WHERE id = ? AND page_id = ?", [item.sortOrder, item.id, pageId]);
      if (!result.affectedRows) throw new HttpError(400, `Section ID ${item.id} does not belong to this page`);
    }
    await connection.commit();
    const [rows] = await connection.execute<any[]>(`${sectionSelect} WHERE page_id = ? ORDER BY sort_order, id`, [pageId]);
    res.json({ success: true, data: rows.map(format) });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

storefrontSectionsRouter.get("/:slug/sections", asyncHandler(async (req, res) => {
  const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).parse(req.params.slug);
  const [pages] = await db.execute<any[]>(`${pageSelect} WHERE slug = ? AND is_active = TRUE`, [slug]);
  const page = pages[0]; if (!page) throw new HttpError(404, "Page not found");
  const [rows] = await db.execute<any[]>(`${sectionSelect} WHERE page_id = ? AND is_active = TRUE ORDER BY sort_order, id`, [page.id]);
  res.json({ success: true, data: { page, sections: rows.map(format) } });
}));
