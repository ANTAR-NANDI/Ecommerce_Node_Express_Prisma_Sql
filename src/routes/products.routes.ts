import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { publicImageUrl } from "../lib/public-image-url";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { uploadProductImages } from "./uploads.routes";

export const productsRouter = Router();

const boolean = z.preprocess(value => value === "true" ? true : value === "false" ? false : value, z.boolean());
const imageFilename = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(jpg|jpeg|png|webp|gif)$/i, "Image must be an uploaded image filename");
const id = z.coerce.number().int().positive();
const nullableId = z.preprocess(value => value === "" ? null : value, id.nullable().optional());
const nullableNumber = z.preprocess(value => value === "" ? null : value, z.coerce.number().nonnegative().nullable().optional());
const optionalText = z.preprocess(value => value === "" ? null : value, z.string().trim().max(500).nullable().optional());
const sizeWithExtraPrice = z.object({ sizeId: id, extraPrice: z.coerce.number().nonnegative().default(0) });
const publicListQuery = z.object({ search: z.string().trim().max(200).optional(), categoryId: id.optional(), subcategoryId: id.optional(), brandId: id.optional(), page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(12) });

const productFields = z.object({
  name: z.string().trim().min(2).max(200),
  slug: z.string().trim().min(2).max(220).regex(/^[a-z0-9-]+$/),
  shortDescription: z.string().trim().min(2).max(500),
  description: z.string().trim().min(2),
  categoryId: id,
  subcategoryId: nullableId,
  brandId: nullableId,
  colorIds: z.array(id).max(20).optional(),
  unitId: nullableId,
  // New size-wise pricing input. sizeIds remains supported with an extraPrice of 0.
  sizes: z.array(sizeWithExtraPrice).max(20).optional(),
  sizeIds: z.array(id).max(20).optional(),
  sku: z.preprocess(value => value === "" ? null : value, z.string().trim().max(100).nullable().optional()),
  weightKg: nullableNumber,
  buyingPrice: z.coerce.number().nonnegative(),
  sellingPrice: z.coerce.number().nonnegative(),
  discountType: z.enum(["none", "percent", "fixed"]).optional(),
  discount: z.coerce.number().nonnegative().optional(),
  stockQuantity: z.coerce.number().int().nonnegative().optional(),
  thumbnailImages: z.array(imageFilename).min(1).max(5),
  additionalImages: z.array(imageFilename).max(5).optional(),
  metaTitle: optionalText,
  metaDescription: optionalText,
  metaKeywords: optionalText,
  isActive: boolean.optional(),
});

const createInput = productFields;
const updateInput = productFields.partial();

function arrayField(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  try { return JSON.parse(value); } catch { return value.split(",").map(item => item.trim()).filter(Boolean); }
}

// Supports both JSON (uploaded filenames) and multipart/form-data (actual image files).
function requestInput(req: any) {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  return {
    ...req.body,
    colorIds: arrayField(req.body?.colorIds),
    sizes: arrayField(req.body?.sizes),
    sizeIds: arrayField(req.body?.sizeIds),
    thumbnailImages: files?.thumbnailImages?.map(file => file.filename) ?? arrayField(req.body?.thumbnailImages),
    additionalImages: files?.additionalImages?.map(file => file.filename) ?? arrayField(req.body?.additionalImages),
  };
}

const productSelect = `SELECT p.id, p.name, p.slug, p.short_description AS shortDescription, p.description,
  p.category_id AS categoryId, c.name AS categoryName, p.subcategory_id AS subcategoryId, sc.name AS subcategoryName,
  p.brand_id AS brandId, b.name AS brandName, p.unit_id AS unitId, u.name AS unitName, p.sku,
  p.weight_kg AS weightKg, p.buying_price AS buyingPrice, p.selling_price AS sellingPrice,
  p.discount_type AS discountType, p.discount, p.stock_quantity AS stockQuantity,
  p.meta_title AS metaTitle, p.meta_description AS metaDescription, p.meta_keywords AS metaKeywords,
  p.is_active AS isActive, p.created_at AS createdAt, p.updated_at AS updatedAt
  FROM products p
  JOIN categories c ON c.id = p.category_id
  LEFT JOIN subcategories sc ON sc.id = p.subcategory_id
  LEFT JOIN brands b ON b.id = p.brand_id
  LEFT JOIN units u ON u.id = p.unit_id`;

async function productDetails(req: any, productId: number, connection: any = db) {
  const [products] = await connection.execute(`${productSelect} WHERE p.id = ?`, [productId]);
  const product = products[0];
  if (!product) return null;
  const [colors] = await connection.execute("SELECT c.id, c.name, c.code FROM product_colors pc JOIN colors c ON c.id = pc.color_id WHERE pc.product_id = ? ORDER BY c.name", [productId]);
  const [sizes] = await connection.execute("SELECT s.id, s.name, ps.extra_price AS extraPrice FROM product_sizes ps JOIN sizes s ON s.id = ps.size_id WHERE ps.product_id = ? ORDER BY s.name", [productId]);
  const [images] = await connection.execute("SELECT filename, image_type AS imageType FROM product_images WHERE product_id = ? ORDER BY image_type, sort_order, id", [productId]);
  const price = Number(product.sellingPrice);
  const discountedPrice = product.discountType === "percent" ? Math.max(0, price - price * Number(product.discount) / 100) : product.discountType === "fixed" ? Math.max(0, price - Number(product.discount)) : price;
  return {
    ...product,
    price,
    discountedPrice,
    colors,
    sizes: (sizes as any[]).map(size => ({ ...size, extraPrice: Number(size.extraPrice), price: discountedPrice + Number(size.extraPrice) })),
    thumbnailImages: (images as any[]).filter(image => image.imageType === "thumbnail").map(image => publicImageUrl(req, "product", image.filename)),
    additionalImages: (images as any[]).filter(image => image.imageType === "additional").map(image => publicImageUrl(req, "product", image.filename)),
  };
}

async function ensureSubcategoryMatches(connection: any, categoryId: number, subcategoryId: number | null | undefined) {
  if (!subcategoryId) return;
  const [rows] = await connection.execute("SELECT subcategory_id FROM subcategory_categories WHERE subcategory_id = ? AND category_id = ?", [subcategoryId, categoryId]);
  if (!rows[0]) throw new HttpError(400, "The selected subcategory does not belong to the selected category");
}

function productSizes(input: { sizes?: { sizeId: number; extraPrice: number }[] | undefined; sizeIds?: number[] | undefined }) {
  const selected = input.sizes ?? input.sizeIds?.map(sizeId => ({ sizeId, extraPrice: 0 })) ?? [];
  const unique = new Map<number, { sizeId: number; extraPrice: number }>();
  for (const size of selected) unique.set(size.sizeId, size);
  return [...unique.values()];
}

async function addRelations(connection: any, productId: number, colorIds: number[], sizes: { sizeId: number; extraPrice: number }[], thumbnailImages: string[], additionalImages: string[]) {
  for (const colorId of [...new Set(colorIds)]) await connection.execute("INSERT INTO product_colors (product_id, color_id) VALUES (?, ?)", [productId, colorId]);
  for (const size of sizes) await connection.execute("INSERT INTO product_sizes (product_id, size_id, extra_price) VALUES (?, ?, ?)", [productId, size.sizeId, size.extraPrice]);
  for (const [sortOrder, filename] of thumbnailImages.entries()) await connection.execute("INSERT INTO product_images (product_id, filename, image_type, sort_order) VALUES (?, ?, 'thumbnail', ?)", [productId, filename, sortOrder]);
  for (const [sortOrder, filename] of additionalImages.entries()) await connection.execute("INSERT INTO product_images (product_id, filename, image_type, sort_order) VALUES (?, ?, 'additional', ?)", [productId, filename, sortOrder]);
}

productsRouter.get("/", asyncHandler(async (req, res) => {
  if (!req.baseUrl.startsWith("/admin/")) {
    const query = publicListQuery.parse(req.query);
    const filters = ["p.is_active = TRUE"]; const values: Array<string | number> = [];
    if (query.categoryId) { filters.push("p.category_id = ?"); values.push(query.categoryId); }
    if (query.subcategoryId) { filters.push("p.subcategory_id = ?"); values.push(query.subcategoryId); }
    if (query.brandId) { filters.push("p.brand_id = ?"); values.push(query.brandId); }
    if (query.search) { filters.push("(p.name LIKE ? OR p.slug LIKE ? OR b.name LIKE ?)"); const search = `%${query.search}%`; values.push(search, search, search); }
    const joins = "FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id";
    const where = `WHERE ${filters.join(" AND ")}`;
    const [countRows] = await db.execute<any[]>(`SELECT COUNT(*) AS total ${joins} ${where}`, values);
    const total = Number(countRows[0].total); const offset = (query.page - 1) * query.limit;
    const [rows] = await db.execute<any[]>(`SELECT p.id, p.name, p.slug, p.selling_price AS price, p.discount_type AS discountType, p.discount, c.id AS categoryId, c.name AS categoryName, c.slug AS categorySlug,
      CASE p.discount_type WHEN 'percent' THEN GREATEST(0, p.selling_price - (p.selling_price * p.discount / 100)) WHEN 'fixed' THEN GREATEST(0, p.selling_price - p.discount) ELSE p.selling_price END AS discountedPrice,
      COALESCE((SELECT SUM(psi.quantity) FROM pos_sale_items psi JOIN pos_sales ps ON ps.id = psi.pos_sale_id WHERE psi.product_id = p.id AND ps.status = 'completed'), 0) + COALESCE((SELECT SUM(eoi.quantity) FROM ecommerce_order_items eoi JOIN ecommerce_orders eo ON eo.id = eoi.ecommerce_order_id WHERE eoi.product_id = p.id AND eo.status = 'delivered'), 0) AS totalSold
      ${joins} ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`, [...values, query.limit, offset]);
    const ids = rows.map(row => row.id); const imagesByProduct = new Map<number, string[]>();
    if (ids.length) {
      const [images] = await db.execute<any[]>(`SELECT product_id AS productId, filename FROM product_images WHERE product_id IN (${ids.map(() => "?").join(", ")}) ORDER BY product_id, CASE image_type WHEN 'thumbnail' THEN 0 ELSE 1 END, sort_order, id`, ids);
      for (const image of images) { const list = imagesByProduct.get(image.productId) ?? []; list.push(publicImageUrl(req, "product", image.filename)!); imagesByProduct.set(image.productId, list); }
    }
    const data = rows.map(row => ({ id: row.id, name: row.name, slug: row.slug, images: imagesByProduct.get(row.id) ?? [], price: Number(row.price), discountedPrice: Number(row.discountedPrice), discountType: row.discountType, discount: Number(row.discount), rating: 0, ratingCount: 0, totalSold: Number(row.totalSold), category: { id: row.categoryId, name: row.categoryName, slug: row.categorySlug } }));
    return res.json({ success: true, data, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit), hasNextPage: query.page * query.limit < total } });
  }
  const query = z.object({ categoryId: id.optional(), subcategoryId: id.optional(), brandId: id.optional(), colorId: id.optional(), sizeId: id.optional() }).parse(req.query);
  const clauses: string[] = []; const values: number[] = [];
  if (query.categoryId) { clauses.push("p.category_id = ?"); values.push(query.categoryId); }
  if (query.subcategoryId) { clauses.push("p.subcategory_id = ?"); values.push(query.subcategoryId); }
  if (query.brandId) { clauses.push("p.brand_id = ?"); values.push(query.brandId); }
  if (query.colorId) { clauses.push("EXISTS (SELECT 1 FROM product_colors filter_pc WHERE filter_pc.product_id = p.id AND filter_pc.color_id = ?)"); values.push(query.colorId); }
  if (query.sizeId) { clauses.push("EXISTS (SELECT 1 FROM product_sizes filter_ps WHERE filter_ps.product_id = p.id AND filter_ps.size_id = ?)"); values.push(query.sizeId); }
  const [rows] = await db.execute<any[]>(`${productSelect}${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY p.created_at DESC`, values);
  const data = await Promise.all(rows.map(row => productDetails(req, row.id)));
  res.json({ success: true, data });
}));

productsRouter.get("/:id", asyncHandler(async (req, res) => {
  const product = await productDetails(req, id.parse(req.params.id));
  if (!product) throw new HttpError(404, "Product not found");
  res.json({ success: true, data: product });
}));

// Public shop action. customerId comes from the signed-in customer session in a future customer-auth module.
productsRouter.post("/:id/favorites", asyncHandler(async (req, res) => {
  const productId = id.parse(req.params.id);
  const customerId = z.object({ customerId: id }).parse(req.body).customerId;
  const [product] = await db.execute<any[]>("SELECT id FROM products WHERE id = ? AND is_active = TRUE", [productId]);
  if (!product[0]) throw new HttpError(404, "Active product not found");
  const [customer] = await db.execute<any[]>("SELECT id FROM customers WHERE id = ? AND is_active = TRUE", [customerId]);
  if (!customer[0]) throw new HttpError(404, "Active customer not found");
  await db.execute("INSERT INTO product_favorites (customer_id, product_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE product_id = VALUES(product_id)", [customerId, productId]);
  res.status(201).json({ success: true, message: "Product added to favorites" });
}));

productsRouter.delete("/:id/favorites", asyncHandler(async (req, res) => {
  const productId = id.parse(req.params.id);
  const customerId = z.object({ customerId: id }).parse(req.query).customerId;
  await db.execute("DELETE FROM product_favorites WHERE customer_id = ? AND product_id = ?", [customerId, productId]);
  res.status(204).send();
}));

productsRouter.post("/", requireAuth, requireAdmin, uploadProductImages.fields([{ name: "thumbnailImages", maxCount: 5 }, { name: "additionalImages", maxCount: 5 }]), asyncHandler(async (req, res) => {
  const input = createInput.parse(requestInput(req)); const connection = await db.getConnection();
  try {
    await connection.beginTransaction(); await ensureSubcategoryMatches(connection, input.categoryId, input.subcategoryId);
    const [result] = await connection.execute<any>(`INSERT INTO products (name, slug, short_description, description, category_id, subcategory_id, brand_id, unit_id, sku, weight_kg, buying_price, selling_price, discount_type, discount, stock_quantity, meta_title, meta_description, meta_keywords, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [input.name, input.slug, input.shortDescription, input.description, input.categoryId, input.subcategoryId ?? null, input.brandId ?? null, input.unitId ?? null, input.sku ?? null, input.weightKg ?? null, input.buyingPrice, input.sellingPrice, input.discountType ?? "none", input.discount ?? 0, input.stockQuantity ?? 0, input.metaTitle ?? null, input.metaDescription ?? null, input.metaKeywords ?? null, input.isActive ?? true]);
    await addRelations(connection, result.insertId, input.colorIds ?? [], productSizes(input), input.thumbnailImages, input.additionalImages ?? []);
    await connection.commit(); const product = await productDetails(req, result.insertId, connection); res.status(201).json({ success: true, data: product });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

productsRouter.patch("/:id", requireAuth, requireAdmin, uploadProductImages.fields([{ name: "thumbnailImages", maxCount: 5 }, { name: "additionalImages", maxCount: 5 }]), asyncHandler(async (req, res) => {
  const productId = id.parse(req.params.id); const input = updateInput.parse(requestInput(req)); if (!Object.keys(input).length) throw new HttpError(400, "Provide at least one field to update");
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction(); const current = await productDetails(req, productId, connection); if (!current) throw new HttpError(404, "Product not found");
    const categoryId = input.categoryId ?? current.categoryId; const subcategoryId = input.subcategoryId === undefined ? current.subcategoryId : input.subcategoryId; await ensureSubcategoryMatches(connection, categoryId, subcategoryId);
    const columns: Record<string, string> = { name: "name", slug: "slug", shortDescription: "short_description", description: "description", categoryId: "category_id", subcategoryId: "subcategory_id", brandId: "brand_id", unitId: "unit_id", sku: "sku", weightKg: "weight_kg", buyingPrice: "buying_price", sellingPrice: "selling_price", discountType: "discount_type", discount: "discount", stockQuantity: "stock_quantity", metaTitle: "meta_title", metaDescription: "meta_description", metaKeywords: "meta_keywords", isActive: "is_active" };
    const fields = Object.entries(input).filter(([key]) => columns[key]).map(([key, value]) => ({ column: columns[key]!, value }));
    if (fields.length) await connection.query(`UPDATE products SET ${fields.map(field => `${field.column} = ?`).join(", ")} WHERE id = ?`, [...fields.map(field => field.value), productId] as any);
    if (input.colorIds !== undefined) { await connection.execute("DELETE FROM product_colors WHERE product_id = ?", [productId]); for (const colorId of [...new Set(input.colorIds)]) await connection.execute("INSERT INTO product_colors (product_id, color_id) VALUES (?, ?)", [productId, colorId]); }
    if (input.sizes !== undefined || input.sizeIds !== undefined) { await connection.execute("DELETE FROM product_sizes WHERE product_id = ?", [productId]); await addRelations(connection, productId, [], productSizes(input), [], []); }
    if (input.thumbnailImages !== undefined || input.additionalImages !== undefined) { await connection.execute("DELETE FROM product_images WHERE product_id = ?", [productId]); await addRelations(connection, productId, [], [], input.thumbnailImages ?? current.thumbnailImages.map((url: string) => url.split("/").pop()!), input.additionalImages ?? current.additionalImages.map((url: string) => url.split("/").pop()!)); }
    await connection.commit(); res.json({ success: true, data: await productDetails(req, productId, connection) });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

productsRouter.delete("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const [result] = await db.execute<any>("DELETE FROM products WHERE id = ?", [id.parse(req.params.id)]);
  if (!result.affectedRows) throw new HttpError(404, "Product not found");
  res.status(204).send();
}));
