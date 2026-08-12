import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { publicImageUrl } from "../lib/public-image-url";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { uploadSubcategoryImage } from "./uploads.routes";

export const subcategoriesRouter = Router();
const withImageUrl = (req: Parameters<typeof publicImageUrl>[0], row: any) => ({ ...row, image: publicImageUrl(req, "subcategory", row.image) });
const boolean = z.preprocess(value => value === "true" ? true : value === "false" ? false : value, z.boolean());
const id = z.coerce.number().int().positive();
const imageFilename = z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(jpg|jpeg|png|webp|gif)$/i, "Image must be an uploaded image filename");
const categoryIds = z.preprocess(value => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return value;
  try { return JSON.parse(value); } catch { return value.split(",").map(item => item.trim()).filter(Boolean); }
}, z.array(id).min(1).max(100));

const baseInput = z.object({
  categoryId: id.optional(), // Legacy single-category input remains supported.
  categoryIds: categoryIds.optional(),
  name: z.string().trim().min(2).max(100),
  slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9-]+$/),
  image: imageFilename.nullable().optional(),
  description: z.string().trim().max(10_000).nullable().optional(),
  isActive: boolean.optional(),
});
const createInput = baseInput.refine(input => input.categoryId || input.categoryIds?.length, { message: "Provide at least one categoryId", path: ["categoryIds"] });
const updateInput = baseInput.partial();
const select = "SELECT s.id, s.category_id AS categoryId, s.name, s.slug, s.image_url AS image, s.description, s.is_active AS isActive, s.created_at AS createdAt, s.updated_at AS updatedAt, c.name AS categoryName FROM subcategories s JOIN categories c ON c.id = s.category_id";

function selectedCategoryIds(input: { categoryId?: number | undefined; categoryIds?: number[] | undefined }) {
  return [...new Set(input.categoryIds ?? (input.categoryId ? [input.categoryId] : []))];
}

async function withCategories(req: Parameters<typeof publicImageUrl>[0], rows: any[], connection: any = db) {
  if (!rows.length) return [];
  const ids = rows.map(row => row.id);
  const [categoryRows] = await connection.query(`SELECT sc.subcategory_id AS subcategoryId, c.id, c.name, c.slug FROM subcategory_categories sc JOIN categories c ON c.id = sc.category_id WHERE sc.subcategory_id IN (${ids.map(() => "?").join(", ")}) ORDER BY c.name`, ids);
  const categoriesBySubcategory = new Map<number, any[]>();
  for (const category of categoryRows) {
    const categories = categoriesBySubcategory.get(category.subcategoryId) ?? [];
    categories.push({ id: category.id, name: category.name, slug: category.slug });
    categoriesBySubcategory.set(category.subcategoryId, categories);
  }
  return rows.map(row => {
    const categories = categoriesBySubcategory.get(row.id) ?? [];
    return withImageUrl(req, { ...row, categoryIds: categories.map(category => category.id), categories });
  });
}

async function replaceCategories(connection: any, subcategoryId: number, ids: number[]) {
  await connection.execute("DELETE FROM subcategory_categories WHERE subcategory_id = ?", [subcategoryId]);
  for (const categoryId of ids) await connection.execute("INSERT INTO subcategory_categories (subcategory_id, category_id) VALUES (?, ?)", [subcategoryId, categoryId]);
}

subcategoriesRouter.get("/", asyncHandler(async (req, res) => {
  const categoryId = req.query.categoryId ? id.parse(req.query.categoryId) : undefined;
  const [rows] = categoryId
    ? await db.execute(`${select} WHERE EXISTS (SELECT 1 FROM subcategory_categories sca WHERE sca.subcategory_id = s.id AND sca.category_id = ?) ORDER BY s.name`, [categoryId])
    : await db.query(`${select} ORDER BY s.name`);
  res.json({ success: true, data: await withCategories(req, rows as any[]) });
}));
subcategoriesRouter.get("/:id", asyncHandler(async (req, res) => {
  const [rows] = await db.execute<any[]>(`${select} WHERE s.id = ?`, [id.parse(req.params.id)]);
  if (!rows[0]) throw new HttpError(404, "Subcategory not found");
  res.json({ success: true, data: (await withCategories(req, rows))[0] });
}));
subcategoriesRouter.post("/", requireAuth, requireAdmin, uploadSubcategoryImage.single("image"), asyncHandler(async (req, res) => {
  const input = createInput.parse({ ...req.body, image: req.file?.filename ?? req.body?.image });
  const ids = selectedCategoryIds(input); const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute<any>("INSERT INTO subcategories (category_id, name, slug, image_url, description, is_active) VALUES (?, ?, ?, ?, ?, ?)", [ids[0]!, input.name, input.slug, input.image ?? null, input.description ?? null, input.isActive ?? true]);
    await replaceCategories(connection, result.insertId, ids);
    const [rows] = await connection.execute<any[]>(`${select} WHERE s.id = ?`, [result.insertId]);
    await connection.commit(); res.status(201).json({ success: true, data: (await withCategories(req, rows, connection))[0] });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));
subcategoriesRouter.patch("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const subcategoryId = id.parse(req.params.id); const input = updateInput.parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, "Provide at least one field to update");
  const ids = selectedCategoryIds(input); const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const names: Record<string, string> = { image: "image_url", isActive: "is_active", name: "name", slug: "slug", description: "description" };
    const fields = Object.entries(input).filter(([key]) => names[key]).map(([key, value]) => ({ name: names[key]!, value }));
    if (ids.length) fields.push({ name: "category_id", value: ids[0]! });
    if (fields.length) {
      const [result] = await connection.query<any>(`UPDATE subcategories SET ${fields.map(field => `${field.name} = ?`).join(", ")} WHERE id = ?`, [...fields.map(field => field.value), subcategoryId] as any);
      if (!result.affectedRows) throw new HttpError(404, "Subcategory not found");
    } else {
      const [rows] = await connection.execute<any[]>("SELECT id FROM subcategories WHERE id = ?", [subcategoryId]);
      if (!rows[0]) throw new HttpError(404, "Subcategory not found");
    }
    if (ids.length) await replaceCategories(connection, subcategoryId, ids);
    await connection.commit(); res.json({ success: true, message: "Subcategory updated" });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));
subcategoriesRouter.delete("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const [result] = await db.execute<any>("DELETE FROM subcategories WHERE id = ?", [id.parse(req.params.id)]);
  if (!result.affectedRows) throw new HttpError(404, "Subcategory not found"); res.status(204).send();
}));
