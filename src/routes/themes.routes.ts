import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const themesRouter = Router();
const id = z.coerce.number().int().positive();
const boolean = z.preprocess(value => value === "true" ? true : value === "false" ? false : value, z.boolean());
const settings = z.record(z.string(), z.unknown());
const url = z.preprocess(value => value === "" ? null : value, z.string().url().max(2048).nullable().optional());
const nullableText = (max: number) => z.preprocess(value => value === "" ? null : value, z.string().trim().max(max).nullable().optional());
const themeInput = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens only").max(80),
  name: z.string().trim().min(2).max(150),
  description: nullableText(10_000),
  thumbnail: url,
  settings,
  isActive: boolean.optional(),
});

const select = "SELECT id, `key`, name, description, thumbnail, settings, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt FROM themes";
function format(row: any) {
  return { ...row, settings: typeof row.settings === "string" ? JSON.parse(row.settings) : row.settings };
}
async function findTheme(themeId: number, connection: any = db) {
  const [rows] = await connection.execute(`${select} WHERE id = ?`, [themeId]);
  return rows[0] ? format(rows[0]) : null;
}

// Public: React calls this once while it loads the storefront.
themesRouter.get("/active", asyncHandler(async (_req, res) => {
  const [rows] = await db.query<any[]>(`${select} WHERE is_active = TRUE LIMIT 1`);
  if (!rows[0]) throw new HttpError(404, "No active theme is configured");
  res.json({ success: true, data: format(rows[0]) });
}));

// Public alias with a stable root object for the storefront app.
themesRouter.get("/config", asyncHandler(async (_req, res) => {
  const [rows] = await db.query<any[]>(`${select} WHERE is_active = TRUE LIMIT 1`);
  if (!rows[0]) throw new HttpError(404, "No active theme is configured");
  res.json({ success: true, data: { theme: format(rows[0]) } });
}));

themesRouter.get("/", requireAuth, requireAdmin, asyncHandler(async (_req, res) => {
  const [rows] = await db.query<any[]>(`${select} ORDER BY is_active DESC, name, id`);
  res.json({ success: true, data: rows.map(format) });
}));

themesRouter.get("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const theme = await findTheme(id.parse(req.params.id));
  if (!theme) throw new HttpError(404, "Theme not found");
  res.json({ success: true, data: theme });
}));

themesRouter.post("/", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const input = themeInput.parse(req.body);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute<any>("INSERT INTO themes (`key`, name, description, thumbnail, settings, is_active) VALUES (?, ?, ?, ?, ?, ?)", [input.key, input.name, input.description ?? null, input.thumbnail ?? null, JSON.stringify(input.settings), input.isActive ?? false]);
    if (input.isActive) await connection.execute("UPDATE themes SET is_active = FALSE WHERE id <> ?", [result.insertId]);
    await connection.commit();
    res.status(201).json({ success: true, data: await findTheme(result.insertId, connection) });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

themesRouter.patch("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const themeId = id.parse(req.params.id); const input = themeInput.partial().parse(req.body);
  if (!Object.keys(input).length) throw new HttpError(400, "Provide at least one field to update");
  const columns: Record<string, string> = { key: "`key`", name: "name", description: "description", thumbnail: "thumbnail", settings: "settings", isActive: "is_active" };
  const entries = Object.entries(input).map(([key, value]) => [columns[key]!, key === "settings" ? JSON.stringify(value) : value]);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute<any>(`UPDATE themes SET ${entries.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`, [...entries.map(([, value]) => value), themeId] as any);
    if (!result.affectedRows) throw new HttpError(404, "Theme not found");
    if (input.isActive) await connection.execute("UPDATE themes SET is_active = FALSE WHERE id <> ?", [themeId]);
    await connection.commit();
    res.json({ success: true, data: await findTheme(themeId, connection) });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

themesRouter.patch("/:id/activate", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const themeId = id.parse(req.params.id); const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute<any>("UPDATE themes SET is_active = TRUE WHERE id = ?", [themeId]);
    if (!result.affectedRows) throw new HttpError(404, "Theme not found");
    await connection.execute("UPDATE themes SET is_active = FALSE WHERE id <> ?", [themeId]);
    await connection.commit();
    res.json({ success: true, data: await findTheme(themeId, connection) });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

themesRouter.delete("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const themeId = id.parse(req.params.id); const [rows] = await db.execute<any[]>("SELECT is_active AS isActive FROM themes WHERE id = ?", [themeId]);
  if (!rows[0]) throw new HttpError(404, "Theme not found");
  if (rows[0].isActive) throw new HttpError(400, "Activate another theme before deleting the current active theme");
  await db.execute("DELETE FROM themes WHERE id = ?", [themeId]);
  res.status(204).send();
}));
