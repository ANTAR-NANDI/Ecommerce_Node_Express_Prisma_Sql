import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { publicImageUrl } from "../lib/public-image-url";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth, requireAdmin);

// One request supplies all home-dashboard cards, order counters and product rankings.
dashboardRouter.get("/", asyncHandler(async (req, res) => {
  const query = z.object({ dateFrom: z.string().date().optional(), dateTo: z.string().date().optional() }).parse(req.query);
  const [counts] = await db.query<any[]>(`SELECT
    (SELECT COUNT(*) FROM employees WHERE is_active = TRUE) AS totalEmployees,
    (SELECT COUNT(*) FROM products WHERE is_active = TRUE) AS totalProducts,
    (SELECT COUNT(*) FROM warehouses WHERE is_active = TRUE) AS totalWarehouses,
    (SELECT COUNT(*) FROM ecommerce_orders) AS totalOrders,
    (SELECT COUNT(*) FROM customers WHERE is_active = TRUE) AS totalCustomers`);
  const [statusRows] = await db.execute<any[]>(`SELECT status, COUNT(*) AS total FROM ecommerce_orders
    WHERE (? IS NULL OR order_date >= CONCAT(?, ' 00:00:00'))
      AND (? IS NULL OR order_date <= CONCAT(?, ' 23:59:59'))
    GROUP BY status`, [query.dateFrom ?? null, query.dateFrom ?? null, query.dateTo ?? null, query.dateTo ?? null]);
  const statusCounts: Record<string, number> = { pending: 0, confirm: 0, processing: 0, pickup: 0, onTheWay: 0, delivered: 0, cancelled: 0 };
  for (const row of statusRows) {
    const key = row.status === "confirmed" ? "confirm" : row.status === "on_the_way" ? "onTheWay" : row.status;
    statusCounts[key] = Number(row.total);
  }

  const saleWhere: string[] = ["ps.status = 'completed'"]; const saleValues: Array<string | null> = [];
  const orderWhere: string[] = ["eo.status = 'delivered'"]; const orderValues: Array<string | null> = [];
  if (query.dateFrom) { saleWhere.push("ps.sale_date >= ?"); saleValues.push(`${query.dateFrom} 00:00:00`); orderWhere.push("eo.order_date >= ?"); orderValues.push(`${query.dateFrom} 00:00:00`); }
  if (query.dateTo) { saleWhere.push("ps.sale_date <= ?"); saleValues.push(`${query.dateTo} 23:59:59`); orderWhere.push("eo.order_date <= ?"); orderValues.push(`${query.dateTo} 23:59:59`); }
  const [sellingRows] = await db.execute<any[]>(`SELECT p.id, p.name, p.slug, p.sku,
    (SELECT filename FROM product_images pi WHERE pi.product_id = p.id AND pi.image_type = 'thumbnail' ORDER BY pi.sort_order, pi.id LIMIT 1) AS image,
    SUM(s.quantity) AS soldQuantity, SUM(s.lineTotal) AS salesAmount
    FROM (
      SELECT psi.product_id AS productId, psi.quantity, psi.line_total AS lineTotal
      FROM pos_sale_items psi JOIN pos_sales ps ON ps.id = psi.pos_sale_id WHERE ${saleWhere.join(" AND ")}
      UNION ALL
      SELECT eoi.product_id AS productId, eoi.quantity, eoi.line_total AS lineTotal
      FROM ecommerce_order_items eoi JOIN ecommerce_orders eo ON eo.id = eoi.ecommerce_order_id WHERE ${orderWhere.join(" AND ")}
    ) s JOIN products p ON p.id = s.productId
    GROUP BY p.id, p.name, p.slug, p.sku
    ORDER BY soldQuantity DESC, salesAmount DESC LIMIT 10`, [...saleValues, ...orderValues]);
  const [favoriteRows] = await db.execute<any[]>(`SELECT p.id, p.name, p.slug, p.sku,
    (SELECT filename FROM product_images pi WHERE pi.product_id = p.id AND pi.image_type = 'thumbnail' ORDER BY pi.sort_order, pi.id LIMIT 1) AS image,
    COUNT(pf.id) AS favoriteCount
    FROM product_favorites pf JOIN products p ON p.id = pf.product_id
    WHERE (? IS NULL OR pf.created_at >= CONCAT(?, ' 00:00:00'))
      AND (? IS NULL OR pf.created_at <= CONCAT(?, ' 23:59:59'))
    GROUP BY p.id, p.name, p.slug, p.sku
    ORDER BY favoriteCount DESC, p.name ASC LIMIT 10`, [query.dateFrom ?? null, query.dateFrom ?? null, query.dateTo ?? null, query.dateTo ?? null]);
  const image = (product: any) => ({ ...product, image: publicImageUrl(req, "product", product.image), soldQuantity: product.soldQuantity === undefined ? undefined : Number(product.soldQuantity), salesAmount: product.salesAmount === undefined ? undefined : Number(product.salesAmount), favoriteCount: product.favoriteCount === undefined ? undefined : Number(product.favoriteCount) });
  res.json({ success: true, data: { overview: Object.fromEntries(Object.entries(counts[0]).map(([key, value]) => [key, Number(value)])), orderStatus: statusCounts, topSellingProducts: sellingRows.map(image), mostFavoriteProducts: favoriteRows.map(image) } });
}));
