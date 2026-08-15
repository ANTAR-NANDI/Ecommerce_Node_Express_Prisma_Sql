import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { publicImageUrl } from "../lib/public-image-url";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { uploadBlogImage } from "./uploads.routes";

export const blogsRouter = Router();
const id = z.coerce.number().int().positive();
const boolean = z.preprocess(value => value === "true" ? true : value === "false" ? false : value, z.boolean());
const imageFilename = z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(jpg|jpeg|png|webp|gif)$/i, "Image must be an uploaded image filename");
const tags = z.preprocess(value => { if (Array.isArray(value)) return value; if (typeof value !== "string") return value; try { return JSON.parse(value); } catch { return value.split(",").map(tag => tag.trim()).filter(Boolean); } }, z.array(z.string().trim().min(1).max(50)).max(30));
const input = z.object({ title: z.string().trim().min(2).max(255), slug: z.string().trim().min(2).max(280).regex(/^[a-z0-9-]+$/), category: id, tags, description: z.string().trim().min(2).max(50_000), image: imageFilename.nullable().optional(), isActive: boolean.optional() });
const select = "SELECT b.id, b.title, b.slug, b.category, c.name AS categoryName, b.tags, b.description, b.image, b.is_active AS isActive, b.created_at AS createdAt, b.updated_at AS updatedAt FROM blogs b JOIN categories c ON c.id = b.category";
const format = (req: Parameters<typeof publicImageUrl>[0], blog: any) => ({ ...blog, tags: typeof blog.tags === "string" ? JSON.parse(blog.tags) : blog.tags, image: publicImageUrl(req, "blog", blog.image) });
async function ensureCategoryExists(categoryId: number) { const [rows] = await db.execute<any[]>("SELECT id FROM categories WHERE id = ?", [categoryId]); if (!rows[0]) throw new HttpError(400, "Category not found"); }

blogsRouter.get("/", asyncHandler(async (req, res) => {
  const admin = req.baseUrl.startsWith("/admin/"); const query = z.object({ category: id.optional(), page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(12) }).parse(req.query);
  const filters: string[] = []; const values: number[] = []; if (!admin) filters.push("b.is_active = TRUE"); if (query.category) { filters.push("b.category = ?"); values.push(query.category); }
  const where = filters.length ? ` WHERE ${filters.join(" AND ")}` : ""; const [counts] = await db.execute<any[]>(`SELECT COUNT(*) AS total FROM blogs b${where}`, values); const total = Number(counts[0].total); const offset = (query.page - 1) * query.limit;
  const [rows] = await db.execute<any[]>(`${select}${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...values, query.limit, offset]);
  res.json({ success: true, data: rows.map(blog => format(req, blog)), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit), hasNextPage: query.page * query.limit < total } });
}));
blogsRouter.get("/:id", asyncHandler(async (req, res) => { const admin = req.baseUrl.startsWith("/admin/"); const [rows] = await db.execute<any[]>(`${select} WHERE b.id = ?${admin ? "" : " AND b.is_active = TRUE"}`, [id.parse(req.params.id)]); if (!rows[0]) throw new HttpError(404, "Blog not found"); res.json({ success: true, data: format(req, rows[0]) }); }));
blogsRouter.post("/", requireAuth, requireAdmin, uploadBlogImage.single("image"), asyncHandler(async (req, res) => { const body = input.parse({ ...req.body, image: req.file?.filename ?? req.body?.image }); await ensureCategoryExists(body.category); const [result] = await db.execute<any>("INSERT INTO blogs (title, slug, category, tags, description, image, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)", [body.title, body.slug, body.category, JSON.stringify(body.tags), body.description, body.image ?? null, body.isActive ?? true]); const [rows] = await db.execute<any[]>(`${select} WHERE b.id = ?`, [result.insertId]); res.status(201).json({ success: true, data: format(req, rows[0]) }); }));
blogsRouter.patch("/:id", requireAuth, requireAdmin, uploadBlogImage.single("image"), asyncHandler(async (req, res) => { const blogId = id.parse(req.params.id); const body = input.partial().parse({ ...req.body, image: req.file?.filename ?? req.body?.image }); if (!Object.keys(body).length) throw new HttpError(400, "Provide at least one field to update"); if (body.category) await ensureCategoryExists(body.category); const columns: Record<string, string> = { title: "title", slug: "slug", category: "category", tags: "tags", description: "description", image: "image", isActive: "is_active" }; const fields = Object.entries(body).map(([key, value]) => ({ column: columns[key]!, value: key === "tags" ? JSON.stringify(value) : value })); const [result] = await db.query<any>(`UPDATE blogs SET ${fields.map(field => `${field.column} = ?`).join(", ")} WHERE id = ?`, [...fields.map(field => field.value), blogId] as any); if (!result.affectedRows) throw new HttpError(404, "Blog not found"); const [rows] = await db.execute<any[]>(`${select} WHERE b.id = ?`, [blogId]); res.json({ success: true, data: format(req, rows[0]) }); }));
blogsRouter.delete("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => { const [result] = await db.execute<any>("DELETE FROM blogs WHERE id = ?", [id.parse(req.params.id)]); if (!result.affectedRows) throw new HttpError(404, "Blog not found"); res.status(204).send(); }));
