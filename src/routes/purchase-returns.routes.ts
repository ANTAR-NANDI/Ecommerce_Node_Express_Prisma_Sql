import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const purchaseReturnsRouter = Router();
const id = z.coerce.number().int().positive();
const returnInput = z.object({
  purchaseId: id,
  returnDate: z.string().date().optional(),
  reason: z.string().trim().min(2).max(500),
  items: z.array(z.object({ productId: id, quantity: z.coerce.number().int().positive() })).min(1).max(100),
});

const headerSelect = `SELECT pr.id, pr.return_number AS returnNumber, pr.purchase_id AS purchaseId,
  p.purchase_number AS purchaseNumber, pr.supplier_id AS supplierId, s.name AS supplierName,
  pr.warehouse_id AS warehouseId, w.name AS warehouseName, pr.return_date AS returnDate,
  pr.reason, pr.total_amount AS totalAmount, pr.status, pr.created_at AS createdAt
  FROM purchase_returns pr JOIN purchases p ON p.id = pr.purchase_id
  JOIN suppliers s ON s.id = pr.supplier_id JOIN warehouses w ON w.id = pr.warehouse_id`;

async function returnDetails(returnId: number, connection: any = db) {
  const [headers] = await connection.execute(`${headerSelect} WHERE pr.id = ?`, [returnId]);
  const purchaseReturn = (headers as any[])[0]; if (!purchaseReturn) return null;
  const [items] = await connection.execute(`SELECT pri.id, pri.product_id AS productId, p.name AS productName,
    p.sku, pri.quantity, pri.unit_price AS unitPrice, pri.line_total AS lineTotal
    FROM purchase_return_items pri JOIN products p ON p.id = pri.product_id
    WHERE pri.purchase_return_id = ? ORDER BY pri.id`, [returnId]);
  return { ...purchaseReturn, items };
}

function returnNumber(date: string) {
  return `PRET-${date.replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

purchaseReturnsRouter.get("/", asyncHandler(async (req, res) => {
  const query = z.object({ purchaseId: id.optional(), supplierId: id.optional(), warehouseId: id.optional(), status: z.enum(["completed", "cancelled"]).optional() }).parse(req.query);
  const filters: string[] = []; const values: Array<number | string> = [];
  if (query.purchaseId) { filters.push("pr.purchase_id = ?"); values.push(query.purchaseId); }
  if (query.supplierId) { filters.push("pr.supplier_id = ?"); values.push(query.supplierId); }
  if (query.warehouseId) { filters.push("pr.warehouse_id = ?"); values.push(query.warehouseId); }
  if (query.status) { filters.push("pr.status = ?"); values.push(query.status); }
  const [rows] = await db.execute<any[]>(`${headerSelect}${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""} ORDER BY pr.created_at DESC`, values);
  res.json({ success: true, data: rows });
}));

purchaseReturnsRouter.get("/:id", asyncHandler(async (req, res) => {
  const purchaseReturn = await returnDetails(id.parse(req.params.id));
  if (!purchaseReturn) throw new HttpError(404, "Purchase return not found");
  res.json({ success: true, data: purchaseReturn });
}));

purchaseReturnsRouter.post("/", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const input = returnInput.parse(req.body); const returnDate = input.returnDate ?? new Date().toISOString().slice(0, 10);
  const groupedItems = [...input.items.reduce((map, item) => map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity), new Map<number, number>())].map(([productId, quantity]) => ({ productId, quantity }));
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [purchaseRows] = await connection.execute<any[]>("SELECT id, supplier_id AS supplierId, warehouse_id AS warehouseId, status FROM purchases WHERE id = ? FOR UPDATE", [input.purchaseId]);
    const purchase = purchaseRows[0]; if (!purchase) throw new HttpError(404, "Original purchase not found"); if (purchase.status !== "received") throw new HttpError(400, "Only a received purchase can be returned");
    const items: Array<{ productId: number; quantity: number; unitPrice: number; lineTotal: number }> = [];
    for (const requested of groupedItems) {
      const [totalsRows] = await connection.execute<any[]>(`SELECT COALESCE(SUM(pi.quantity), 0) AS purchasedQuantity,
        COALESCE(SUM(pi.line_total), 0) / NULLIF(COALESCE(SUM(pi.quantity), 0), 0) AS unitPrice,
        COALESCE((SELECT SUM(pri.quantity) FROM purchase_return_items pri JOIN purchase_returns previous_pr ON previous_pr.id = pri.purchase_return_id WHERE previous_pr.purchase_id = ? AND previous_pr.status = 'completed' AND pri.product_id = ?), 0) AS returnedQuantity
        FROM purchase_items pi WHERE pi.purchase_id = ? AND pi.product_id = ?`, [input.purchaseId, requested.productId, input.purchaseId, requested.productId]);
      const totals = totalsRows[0]; const available = Number(totals.purchasedQuantity) - Number(totals.returnedQuantity);
      if (!totals.purchasedQuantity) throw new HttpError(400, `Product ID ${requested.productId} is not in the original purchase`);
      if (requested.quantity > available) throw new HttpError(400, `Return quantity for product ID ${requested.productId} exceeds the available quantity (${available})`);
      items.push({ productId: requested.productId, quantity: requested.quantity, unitPrice: Number(totals.unitPrice), lineTotal: requested.quantity * Number(totals.unitPrice) });
    }
    const totalAmount = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const [result] = await connection.execute<any>("INSERT INTO purchase_returns (return_number, purchase_id, supplier_id, warehouse_id, return_date, reason, total_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')", [returnNumber(returnDate), input.purchaseId, purchase.supplierId, purchase.warehouseId, returnDate, input.reason, totalAmount]);
    for (const item of items) {
      await connection.execute("INSERT INTO purchase_return_items (purchase_return_id, product_id, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?)", [result.insertId, item.productId, item.quantity, item.unitPrice, item.lineTotal]);
      const [stock] = await connection.execute<any>("UPDATE warehouse_stocks SET quantity = quantity - ? WHERE warehouse_id = ? AND product_id = ? AND quantity >= ?", [item.quantity, purchase.warehouseId, item.productId, item.quantity]);
      if (!stock.affectedRows) throw new HttpError(400, `Insufficient current warehouse stock for product ID ${item.productId}`);
      await connection.execute("UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?", [item.quantity, item.productId]);
      await connection.execute("INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity_change, reference_type, reference_id, note) VALUES (?, ?, 'purchase_return', ?, 'purchase_return', ?, ?)", [purchase.warehouseId, item.productId, -item.quantity, result.insertId, input.reason]);
    }
    await connection.commit(); res.status(201).json({ success: true, data: await returnDetails(result.insertId, connection) });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

purchaseReturnsRouter.patch("/:id/cancel", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const returnId = id.parse(req.params.id); const connection = await db.getConnection();
  try {
    await connection.beginTransaction(); const purchaseReturn = await returnDetails(returnId, connection);
    if (!purchaseReturn) throw new HttpError(404, "Purchase return not found"); if (purchaseReturn.status === "cancelled") throw new HttpError(400, "Purchase return is already cancelled");
    for (const item of purchaseReturn.items as any[]) {
      await connection.execute("INSERT INTO warehouse_stocks (warehouse_id, product_id, quantity) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)", [purchaseReturn.warehouseId, item.productId, item.quantity]);
      await connection.execute("UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?", [item.quantity, item.productId]);
      await connection.execute("INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity_change, reference_type, reference_id, note) VALUES (?, ?, 'purchase_return_cancel', ?, 'purchase_return', ?, 'Purchase return cancelled')", [purchaseReturn.warehouseId, item.productId, item.quantity, returnId]);
    }
    await connection.execute("UPDATE purchase_returns SET status = 'cancelled' WHERE id = ?", [returnId]); await connection.commit();
    res.json({ success: true, data: await returnDetails(returnId, connection) });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));
