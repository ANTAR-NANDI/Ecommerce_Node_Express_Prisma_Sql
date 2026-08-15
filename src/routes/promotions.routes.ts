import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { publicImageUrl } from "../lib/public-image-url";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { uploadPromotionImage } from "./uploads.routes";

export const promotionsRouter = Router();
const id = z.coerce.number().int().positive();
const money = z.coerce.number().nonnegative();
const boolean = z.preprocess(value => value === "true" ? true : value === "false" ? false : value, z.boolean());
const nullableBoolean = z.preprocess(value => value === "" || value === null ? null : value === "true" ? true : value === "false" ? false : value, z.boolean().nullable().optional());
const dateTime = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Use HH:MM or HH:MM:SS");
const imageFilename = z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(jpg|jpeg|png|webp|gif)$/i, "Image must be an uploaded image filename");
const shopIds = z.preprocess(value => { if (Array.isArray(value)) return value; if (typeof value !== "string" || !value.trim()) return value; try { return JSON.parse(value); } catch { return value.split(",").map(item => item.trim()).filter(Boolean); } }, z.array(id).max(100).nullable().optional());
const flashInput = z.object({ name: z.string().trim().min(2).max(150), minimumDiscount: money, startDate: date, startTime: time, endDate: date, endTime: time, description: z.string().trim().min(2).max(10_000), image: imageFilename.nullable().optional(), isActive: boolean.optional() }).refine(value => !value.startDate || !value.startTime || !value.endDate || !value.endTime || `${value.endDate}T${value.endTime}` > `${value.startDate}T${value.startTime}`, { message: "End date and time must be after start date and time", path: ["endTime"] });
const bannerInput = z.object({ title: z.preprocess(value => value === "" ? null : value, z.string().trim().max(255).nullable().optional()), image: imageFilename, isOwnShop: nullableBoolean, isActive: boolean.optional() });
const adInput = z.object({ title: z.string().trim().min(2).max(255), image: imageFilename, isActive: boolean.optional() });
const promoInput = z.object({ shopIds, code: z.string().trim().min(2).max(100).transform(value => value.toUpperCase()), discountType: z.enum(["amount", "percent"]), discount: money, minimumOrderAmount: money, singleUserLimit: z.coerce.number().int().positive().default(1), maximumDiscountAmount: z.preprocess(value => value === "" ? null : value, money.nullable().optional()), startDate: date, startTime: time, endDate: date, endTime: time, isActive: boolean.optional() }).refine(value => !value.startDate || !value.startTime || !value.endDate || !value.endTime || `${value.endDate}T${value.endTime}` > `${value.startDate}T${value.startTime}`, { message: "End date and time must be after start date and time", path: ["endTime"] });

function admin(req: any) { return req.baseUrl.startsWith("/admin/"); }
function image(req: any, row: any) { return { ...row, image: publicImageUrl(req, "promotion", row.image) }; }
async function list(req: any, res: any, table: string, select: string, formatter: (row: any) => any = row => row) {
  const where = admin(req) ? "" : " WHERE is_active = TRUE";
  const [rows] = await db.query<any[]>(`${select} FROM ${table}${where} ORDER BY created_at DESC`);
  res.json({ success: true, data: rows.map(formatter) });
}
function crud(path: string, table: string, select: string, schema: any, columns: Record<string, string>, needsImage = false, formatter: (req: any, row: any) => any = (_req, row) => row) {
  promotionsRouter.get(path, asyncHandler(async (req, res) => list(req, res, table, select, row => formatter(req, row))));
  promotionsRouter.get(`${path}/:id`, asyncHandler(async (req, res) => { const where = admin(req) ? "" : " AND is_active = TRUE"; const [rows] = await db.execute<any[]>(`${select} FROM ${table} WHERE id = ?${where}`, [id.parse(req.params.id)]); if (!rows[0]) throw new HttpError(404, "Promotion not found"); res.json({ success: true, data: formatter(req, rows[0]) }); }));
  promotionsRouter.post(path, requireAuth, requireAdmin, ...(needsImage ? [uploadPromotionImage.single("image")] : []), asyncHandler(async (req, res) => { const input = schema.parse({ ...req.body, image: req.file?.filename ?? req.body?.image }); const entries = Object.entries(input).map(([key, value]) => [columns[key]!, key === "shopIds" ? JSON.stringify(value) : value]); const [result] = await db.query<any>(`INSERT INTO ${table} (${entries.map(([column]) => column).join(", ")}) VALUES (${entries.map(() => "?").join(", ")})`, entries.map(([, value]) => value) as any); const [rows] = await db.execute<any[]>(`${select} FROM ${table} WHERE id = ?`, [result.insertId]); res.status(201).json({ success: true, data: formatter(req, rows[0]) }); }));
  promotionsRouter.patch(`${path}/:id`, requireAuth, requireAdmin, ...(needsImage ? [uploadPromotionImage.single("image")] : []), asyncHandler(async (req, res) => { const input = schema.partial().parse({ ...req.body, image: req.file?.filename ?? req.body?.image }); if (!Object.keys(input).length) throw new HttpError(400, "Provide at least one field to update"); const entries = Object.entries(input).map(([key, value]) => [columns[key]!, key === "shopIds" ? JSON.stringify(value) : value]); const [result] = await db.query<any>(`UPDATE ${table} SET ${entries.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`, [...entries.map(([, value]) => value), id.parse(req.params.id)] as any); if (!result.affectedRows) throw new HttpError(404, "Promotion not found"); const [rows] = await db.execute<any[]>(`${select} FROM ${table} WHERE id = ?`, [id.parse(req.params.id)]); res.json({ success: true, data: formatter(req, rows[0]) }); }));
  promotionsRouter.delete(`${path}/:id`, requireAuth, requireAdmin, asyncHandler(async (req, res) => { const [result] = await db.execute<any>(`DELETE FROM ${table} WHERE id = ?`, [id.parse(req.params.id)]); if (!result.affectedRows) throw new HttpError(404, "Promotion not found"); res.status(204).send(); }));
}

crud("/flash-sales", "flash_sales", "SELECT id, name, minimum_discount AS minimumDiscount, start_date AS startDate, start_time AS startTime, end_date AS endDate, end_time AS endTime, description, image, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt", flashInput, { name: "name", minimumDiscount: "minimum_discount", startDate: "start_date", startTime: "start_time", endDate: "end_date", endTime: "end_time", description: "description", image: "image", isActive: "is_active" }, true, image);
crud("/banners", "banners", "SELECT id, title, image, is_own_shop AS isOwnShop, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt", bannerInput, { title: "title", image: "image", isOwnShop: "is_own_shop", isActive: "is_active" }, true, image);
crud("/ad-campaigns", "ad_campaigns", "SELECT id, title, image, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt", adInput, { title: "title", image: "image", isActive: "is_active" }, true, image);
crud("/promo-codes", "promo_codes", "SELECT id, shop_ids AS shopIds, code, discount_type AS discountType, discount, minimum_order_amount AS minimumOrderAmount, single_user_limit AS singleUserLimit, maximum_discount_amount AS maximumDiscountAmount, start_date AS startDate, start_time AS startTime, end_date AS endDate, end_time AS endTime, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt", promoInput, { shopIds: "shop_ids", code: "code", discountType: "discount_type", discount: "discount", minimumOrderAmount: "minimum_order_amount", singleUserLimit: "single_user_limit", maximumDiscountAmount: "maximum_discount_amount", startDate: "start_date", startTime: "start_time", endDate: "end_date", endTime: "end_time", isActive: "is_active" }, false, (_req, row) => ({ ...row, shopIds: typeof row.shopIds === "string" ? JSON.parse(row.shopIds) : row.shopIds }));
