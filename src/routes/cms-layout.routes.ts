import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const cmsLayoutRouter = Router();
export const publicMenusRouter = Router();
export const storefrontFooterRouter = Router();
const id = z.coerce.number().int().positive();
const boolean = z.preprocess(value => value === "true" ? true : value === "false" ? false : value, z.boolean());
const nullableId = z.preprocess(value => value === "" || value === null ? null : value, id.nullable().optional());
const location = z.enum(["header", "footer"]);
const url = z.string().trim().min(1).max(2048);
const menuInput = z.object({
  location,
  label: z.string().trim().min(1).max(150),
  url,
  pageId: nullableId,
  parentId: nullableId,
  sortOrder: z.coerce.number().int().min(0).default(0),
  openInNewTab: boolean.optional().default(false),
  isActive: boolean.optional().default(true),
});
const nullableText = (max: number) => z.preprocess(value => value === "" ? null : value, z.string().trim().max(max).nullable().optional());
const footerInput = z.object({
  copyrightText: nullableText(500),
  phone: nullableText(50),
  email: z.preprocess(value => value === "" ? null : value, z.string().email().max(255).nullable().optional()),
  settings: z.record(z.string(), z.unknown()).optional(),
});
const menuSelect = `SELECT cm.id, cm.location, cm.label, cm.url, cm.page_id AS pageId, cm.parent_id AS parentId,
  cm.sort_order AS sortOrder, cm.open_in_new_tab AS openInNewTab, cm.is_active AS isActive,
  cm.created_at AS createdAt, cm.updated_at AS updatedAt
  FROM cms_menus cm`;
const footerSelect = "SELECT id, copyright_text AS copyrightText, phone, email, settings, updated_at AS updatedAt FROM cms_footer WHERE id = 1";
function footerFormat(row: any) { return { ...row, settings: typeof row.settings === "string" ? JSON.parse(row.settings) : row.settings }; }

async function findMenu(menuId: number) {
  const [rows] = await db.execute<any[]>(`${menuSelect} WHERE cm.id = ?`, [menuId]);
  return rows[0] ?? null;
}
async function footer() {
  const [rows] = await db.query<any[]>(footerSelect);
  if (!rows[0]) throw new HttpError(404, "Footer settings not found");
  return footerFormat(rows[0]);
}

cmsLayoutRouter.get("/menus", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const query = z.object({ location: location.optional() }).parse(req.query);
  const [rows] = await db.execute<any[]>(`${menuSelect}${query.location ? " WHERE cm.location = ?" : ""} ORDER BY cm.location, cm.sort_order, cm.id`, query.location ? [query.location] : []);
  res.json({ success: true, data: rows });
}));

cmsLayoutRouter.post("/menus", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const input = menuInput.parse(req.body);
  if (input.parentId) {
    const parent = await findMenu(input.parentId);
    if (!parent) throw new HttpError(400, "Parent menu not found");
    if (parent.location !== input.location) throw new HttpError(400, "Parent menu must have the same location");
  }
  if (input.pageId) { const [pages] = await db.execute<any[]>("SELECT id FROM cms_pages WHERE id = ?", [input.pageId]); if (!pages[0]) throw new HttpError(400, "CMS page not found"); }
  const [result] = await db.execute<any>("INSERT INTO cms_menus (location, label, url, page_id, parent_id, sort_order, open_in_new_tab, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [input.location, input.label, input.url, input.pageId ?? null, input.parentId ?? null, input.sortOrder, input.openInNewTab, input.isActive]);
  res.status(201).json({ success: true, data: await findMenu(result.insertId) });
}));

cmsLayoutRouter.patch("/menus/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const menuId = id.parse(req.params.id); const existing = await findMenu(menuId); if (!existing) throw new HttpError(404, "Menu item not found");
  const input = menuInput.partial().parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, "Provide at least one field to update");
  const nextLocation = input.location ?? existing.location; const nextParentId = input.parentId === undefined ? existing.parentId : input.parentId;
  if (nextParentId) { if (nextParentId === menuId) throw new HttpError(400, "A menu item cannot be its own parent"); const parent = await findMenu(nextParentId); if (!parent) throw new HttpError(400, "Parent menu not found"); if (parent.location !== nextLocation) throw new HttpError(400, "Parent menu must have the same location"); }
  if (input.pageId) { const [pages] = await db.execute<any[]>("SELECT id FROM cms_pages WHERE id = ?", [input.pageId]); if (!pages[0]) throw new HttpError(400, "CMS page not found"); }
  const columns: Record<string, string> = { location: "location", label: "label", url: "url", pageId: "page_id", parentId: "parent_id", sortOrder: "sort_order", openInNewTab: "open_in_new_tab", isActive: "is_active" };
  const entries = Object.entries(input).map(([key, value]) => [columns[key]!, value]);
  await db.execute(`UPDATE cms_menus SET ${entries.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`, [...entries.map(([, value]) => value), menuId] as any);
  res.json({ success: true, data: await findMenu(menuId) });
}));

cmsLayoutRouter.delete("/menus/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const [result] = await db.execute<any>("DELETE FROM cms_menus WHERE id = ?", [id.parse(req.params.id)]);
  if (!result.affectedRows) throw new HttpError(404, "Menu item not found");
  res.status(204).send();
}));

cmsLayoutRouter.get("/footer", requireAuth, requireAdmin, asyncHandler(async (_req, res) => res.json({ success: true, data: await footer() })));
cmsLayoutRouter.patch("/footer", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const input = footerInput.parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, "Provide at least one field to update");
  const columns: Record<string, string> = { copyrightText: "copyright_text", phone: "phone", email: "email", settings: "settings" };
  const entries = Object.entries(input).map(([key, value]) => [columns[key]!, key === "settings" ? JSON.stringify(value) : value]);
  await db.execute(`UPDATE cms_footer SET ${entries.map(([column]) => `${column} = ?`).join(", ")} WHERE id = 1`, entries.map(([, value]) => value) as any);
  res.json({ success: true, data: await footer() });
}));

publicMenusRouter.get("/", asyncHandler(async (req, res) => {
  const { location: selectedLocation } = z.object({ location }).parse(req.query);
  const [rows] = await db.execute<any[]>(`${menuSelect} WHERE cm.location = ? AND cm.is_active = TRUE ORDER BY cm.sort_order, cm.id`, [selectedLocation]);
  res.json({ success: true, data: rows });
}));
storefrontFooterRouter.get("/", asyncHandler(async (_req, res) => res.json({ success: true, data: await footer() })));
