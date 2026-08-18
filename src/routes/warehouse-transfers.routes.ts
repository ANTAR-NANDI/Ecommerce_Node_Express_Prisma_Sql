import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const warehouseTransfersRouter = Router();
const id = z.coerce.number().int().positive();
const transferInput = z.object({ fromWarehouseId: id, toWarehouseId: id, requisitionId: z.preprocess(value => value === "" ? null : value, id.nullable().optional()), note: z.preprocess(value => value === "" ? null : value, z.string().trim().max(1000).nullable().optional()), items: z.array(z.object({ productId: id, quantity: z.coerce.number().int().positive() })).min(1).max(100) });
const headerSelect = `SELECT t.id, t.transfer_number AS transferNumber, t.from_warehouse_id AS fromWarehouseId,
  source.name AS fromWarehouseName, t.to_warehouse_id AS toWarehouseId, destination.name AS toWarehouseName,
  t.requisition_id AS requisitionId, t.note, t.status, t.shipped_at AS shippedAt, t.received_at AS receivedAt,
  t.created_at AS createdAt FROM warehouse_transfers t JOIN warehouses source ON source.id = t.from_warehouse_id
  JOIN warehouses destination ON destination.id = t.to_warehouse_id`;

// Transfer data and stock locations are internal operations data.
warehouseTransfersRouter.use(requireAuth, requireAdmin);

function transferNumber() { return `TRF-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`; }
function grouped(items: Array<{ productId: number; quantity: number }>) { return [...items.reduce((map, item) => map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity), new Map<number, number>())].map(([productId, quantity]) => ({ productId, quantity })); }
async function transferDetails(transferId: number, connection: any = db) {
  const [headers] = await connection.execute(`${headerSelect} WHERE t.id = ?`, [transferId]); const transfer = (headers as any[])[0]; if (!transfer) return null;
  const [items] = await connection.execute("SELECT ti.id, ti.product_id AS productId, p.name AS productName, p.sku, ti.quantity FROM warehouse_transfer_items ti JOIN products p ON p.id = ti.product_id WHERE ti.transfer_id = ? ORDER BY ti.id", [transferId]);
  return { ...transfer, items };
}

warehouseTransfersRouter.get("/", asyncHandler(async (req, res) => {
  const query = z.object({ status: z.enum(["draft", "shipped", "received", "cancelled"]).optional(), fromWarehouseId: id.optional(), toWarehouseId: id.optional(), requisitionId: id.optional() }).parse(req.query);
  const filters: string[] = []; const values: Array<number | string> = [];
  if (query.status) { filters.push("t.status = ?"); values.push(query.status); }
  if (query.fromWarehouseId) { filters.push("t.from_warehouse_id = ?"); values.push(query.fromWarehouseId); }
  if (query.toWarehouseId) { filters.push("t.to_warehouse_id = ?"); values.push(query.toWarehouseId); }
  if (query.requisitionId) { filters.push("t.requisition_id = ?"); values.push(query.requisitionId); }
  const [rows] = await db.execute<any[]>(`${headerSelect}${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""} ORDER BY t.created_at DESC`, values); res.json({ success: true, data: rows });
}));
warehouseTransfersRouter.get("/:id", asyncHandler(async (req, res) => { const transfer = await transferDetails(id.parse(req.params.id)); if (!transfer) throw new HttpError(404, "Warehouse transfer not found"); res.json({ success: true, data: transfer }); }));
warehouseTransfersRouter.post("/", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const input = transferInput.parse(req.body); if (input.fromWarehouseId === input.toWarehouseId) throw new HttpError(400, "Source and destination warehouses must be different");
  const connection = await db.getConnection(); try {
    await connection.beginTransaction();
    if (input.requisitionId) { const [rows] = await connection.execute<any[]>("SELECT requesting_warehouse_id AS requestingWarehouseId, source_warehouse_id AS sourceWarehouseId, status FROM warehouse_requisitions WHERE id = ? FOR UPDATE", [input.requisitionId]); const requisition = rows[0]; if (!requisition || requisition.status !== "approved") throw new HttpError(400, "Only an approved requisition can create a transfer"); if (requisition.sourceWarehouseId !== input.fromWarehouseId || requisition.requestingWarehouseId !== input.toWarehouseId) throw new HttpError(400, "Transfer warehouses must match the requisition"); }
    const [result] = await connection.execute<any>("INSERT INTO warehouse_transfers (transfer_number, from_warehouse_id, to_warehouse_id, requisition_id, note) VALUES (?, ?, ?, ?, ?)", [transferNumber(), input.fromWarehouseId, input.toWarehouseId, input.requisitionId ?? null, input.note ?? null]);
    for (const item of grouped(input.items)) await connection.execute("INSERT INTO warehouse_transfer_items (transfer_id, product_id, quantity) VALUES (?, ?, ?)", [result.insertId, item.productId, item.quantity]);
    const transfer = await transferDetails(result.insertId, connection);
    for (const item of transfer!.items as any[]) {
      const [stock] = await connection.execute<any>("UPDATE warehouse_stocks SET quantity = quantity - ? WHERE warehouse_id = ? AND product_id = ? AND quantity >= ?", [item.quantity, input.fromWarehouseId, item.productId, item.quantity]);
      if (!stock.affectedRows) throw new HttpError(400, `Insufficient source stock for ${item.productName}`);
      await connection.execute("INSERT INTO warehouse_stocks (warehouse_id, product_id, quantity) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)", [input.toWarehouseId, item.productId, item.quantity]);
      await connection.execute("INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity_change, reference_type, reference_id, note) VALUES (?, ?, 'transfer_out', ?, 'warehouse_transfer', ?, ?)", [input.fromWarehouseId, item.productId, -item.quantity, result.insertId, `Transfer to ${transfer!.toWarehouseName}`]);
      await connection.execute("INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity_change, reference_type, reference_id, note) VALUES (?, ?, 'transfer_in', ?, 'warehouse_transfer', ?, ?)", [input.toWarehouseId, item.productId, item.quantity, result.insertId, `Transfer from ${transfer!.fromWarehouseName}`]);
    }
    await connection.execute("UPDATE warehouse_transfers SET status = 'received', shipped_at = NOW(), received_at = NOW() WHERE id = ?", [result.insertId]);
    if (input.requisitionId) await connection.execute("UPDATE warehouse_requisitions SET status = 'fulfilled' WHERE id = ?", [input.requisitionId]);
    await connection.commit(); res.status(201).json({ success: true, data: await transferDetails(result.insertId, connection) });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

warehouseTransfersRouter.patch("/:id/ship", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const transferId = id.parse(req.params.id); const connection = await db.getConnection(); try {
    await connection.beginTransaction(); const transfer = await transferDetails(transferId, connection); if (!transfer) throw new HttpError(404, "Warehouse transfer not found"); if (transfer.status !== "draft") throw new HttpError(400, "Only a draft transfer can be shipped");
    for (const item of transfer.items as any[]) { const [stock] = await connection.execute<any>("UPDATE warehouse_stocks SET quantity = quantity - ? WHERE warehouse_id = ? AND product_id = ? AND quantity >= ?", [item.quantity, transfer.fromWarehouseId, item.productId, item.quantity]); if (!stock.affectedRows) throw new HttpError(400, `Insufficient source stock for ${item.productName}`); await connection.execute("INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity_change, reference_type, reference_id, note) VALUES (?, ?, 'transfer_out', ?, 'warehouse_transfer', ?, ?)", [transfer.fromWarehouseId, item.productId, -item.quantity, transferId, `Transfer to ${transfer.toWarehouseName}`]); }
    await connection.execute("UPDATE warehouse_transfers SET status = 'shipped', shipped_at = NOW() WHERE id = ?", [transferId]); await connection.commit(); res.json({ success: true, data: await transferDetails(transferId, connection) });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

warehouseTransfersRouter.patch("/:id/receive", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const transferId = id.parse(req.params.id); const connection = await db.getConnection(); try {
    await connection.beginTransaction(); const transfer = await transferDetails(transferId, connection); if (!transfer) throw new HttpError(404, "Warehouse transfer not found"); if (transfer.status !== "shipped") throw new HttpError(400, "Only a shipped transfer can be received");
    for (const item of transfer.items as any[]) { await connection.execute("INSERT INTO warehouse_stocks (warehouse_id, product_id, quantity) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)", [transfer.toWarehouseId, item.productId, item.quantity]); await connection.execute("INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity_change, reference_type, reference_id, note) VALUES (?, ?, 'transfer_in', ?, 'warehouse_transfer', ?, ?)", [transfer.toWarehouseId, item.productId, item.quantity, transferId, `Transfer from ${transfer.fromWarehouseName}`]); }
    await connection.execute("UPDATE warehouse_transfers SET status = 'received', received_at = NOW() WHERE id = ?", [transferId]); if (transfer.requisitionId) await connection.execute("UPDATE warehouse_requisitions SET status = 'fulfilled' WHERE id = ?", [transfer.requisitionId]); await connection.commit(); res.json({ success: true, data: await transferDetails(transferId, connection) });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

warehouseTransfersRouter.patch("/:id/cancel", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const transferId = id.parse(req.params.id); const connection = await db.getConnection(); try {
    await connection.beginTransaction(); const transfer = await transferDetails(transferId, connection); if (!transfer) throw new HttpError(404, "Warehouse transfer not found"); if (transfer.status === "received" || transfer.status === "cancelled") throw new HttpError(400, "A received or cancelled transfer cannot be cancelled");
    if (transfer.status === "shipped") for (const item of transfer.items as any[]) { await connection.execute("INSERT INTO warehouse_stocks (warehouse_id, product_id, quantity) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)", [transfer.fromWarehouseId, item.productId, item.quantity]); await connection.execute("INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity_change, reference_type, reference_id, note) VALUES (?, ?, 'transfer_cancel', ?, 'warehouse_transfer', ?, 'Shipped transfer cancelled')", [transfer.fromWarehouseId, item.productId, item.quantity, transferId]); }
    await connection.execute("UPDATE warehouse_transfers SET status = 'cancelled' WHERE id = ?", [transferId]); if (transfer.requisitionId) await connection.execute("UPDATE warehouse_requisitions SET status = 'approved' WHERE id = ?", [transfer.requisitionId]); await connection.commit(); res.json({ success: true, data: await transferDetails(transferId, connection) });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));
