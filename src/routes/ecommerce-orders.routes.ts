import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { postAccountEntries } from "../lib/accounting";
import { createPartyCoa } from "../lib/party-coa";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const ecommerceOrdersRouter = Router();
const id = z.coerce.number().int().positive();
const money = z.coerce.number().min(0);
const orderStatuses = ["pending", "confirmed", "processing", "pickup", "on_the_way", "delivered", "cancelled"] as const;
// "confirm" is accepted from an admin UI, while MySQL stores the clearer value "confirmed".
const orderStatusInput = z.enum(["pending", "confirm", "confirmed", "approve", "processing", "process", "pickup", "on_the_way", "ship", "delivered", "deliver", "cancelled", "cancel"]).transform(value => ({ confirm: "confirmed", approve: "confirmed", process: "processing", ship: "on_the_way", deliver: "delivered", cancel: "cancelled" } as Record<string, string>)[value] ?? value as typeof orderStatuses[number]);
const paymentStatusInput = z.enum(["pending", "unpaid", "paid", "failed", "refunded"]).transform(value => value === "unpaid" ? "pending" : value);
const customerInput = z.object({
  name: z.string().trim().min(2).max(150),
  phone: z.string().trim().min(6).max(30),
  email: z.preprocess(value => value === "" ? null : value, z.string().email().nullable().optional()),
  address: z.string().trim().min(5).max(2000),
});
const orderInput = z.object({
  warehouseId: id,
  customer: customerInput,
  paymentMethod: z.enum(["cod", "card", "mobile_banking", "bank_transfer"]),
  shippingCost: money.optional().default(0),
  discount: money.optional().default(0),
  note: z.preprocess(value => value === "" ? null : value, z.string().trim().max(1000).nullable().optional()),
  // Prices are intentionally absent: a public frontend must never be trusted to set product prices.
  items: z.array(z.object({ productId: id, sizeId: id.nullable().optional(), quantity: z.coerce.number().int().positive() })).min(1).max(100),
});
const headerSelect = `SELECT eo.id, eo.order_number AS orderNumber, eo.warehouse_id AS warehouseId,
  w.name AS warehouseName, eo.customer_id AS customerId, c.name AS customerName, c.phone AS customerPhone,
  c.email AS customerEmail, eo.order_date AS orderDate, eo.status, eo.payment_method AS paymentMethod,
  eo.payment_status AS paymentStatus, eo.shipping_address AS shippingAddress, eo.note,
  eo.subtotal, eo.discount, eo.shipping_cost AS shippingCost, eo.total_amount AS totalAmount,
  eo.created_at AS createdAt, eo.updated_at AS updatedAt
  FROM ecommerce_orders eo JOIN warehouses w ON w.id = eo.warehouse_id
  JOIN customers c ON c.id = eo.customer_id`;

function orderNumber() { return `ORD-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`; }
async function orderDetails(orderId: number, connection: any = db) {
  const [headers] = await connection.execute(`${headerSelect} WHERE eo.id = ?`, [orderId]);
  const order = (headers as any[])[0]; if (!order) return null;
  const [items] = await connection.execute(`SELECT eoi.id, eoi.product_id AS productId, p.name AS productName, p.sku,
    eoi.size_id AS sizeId, s.name AS sizeName,
    eoi.quantity, eoi.unit_price AS unitPrice, eoi.discount, eoi.line_total AS lineTotal
    FROM ecommerce_order_items eoi JOIN products p ON p.id = eoi.product_id LEFT JOIN sizes s ON s.id = eoi.size_id
    WHERE eoi.ecommerce_order_id = ? ORDER BY eoi.id`, [orderId]);
  return { ...order, items };
}

// Public: called by the shop frontend during checkout. It creates or reuses a customer by phone number.
ecommerceOrdersRouter.post("/", asyncHandler(async (req, res) => {
  const input = orderInput.parse(req.body);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [warehouse] = await connection.execute<any[]>("SELECT id FROM warehouses WHERE id = ? AND is_active = 1", [input.warehouseId]);
    if (!warehouse.length) throw new HttpError(400, "Active warehouse not found");
    const items: Array<{ productId: number; sizeId: number | null; quantity: number; unitPrice: number; discount: number; lineTotal: number }> = [];
    for (const requestedItem of input.items) {
      const [products] = await connection.execute<any[]>("SELECT id, selling_price AS sellingPrice, discount_type AS discountType, discount FROM products WHERE id = ? AND is_active = 1", [requestedItem.productId]);
      if (!products[0]) throw new HttpError(400, `Active product ID ${requestedItem.productId} was not found`);
      const product = products[0]; const sellingPrice = Number(product.sellingPrice);
      const basePrice = product.discountType === "percent" ? Math.max(0, sellingPrice - sellingPrice * Number(product.discount) / 100) : product.discountType === "fixed" ? Math.max(0, sellingPrice - Number(product.discount)) : sellingPrice;
      let extraPrice = 0;
      if (requestedItem.sizeId) {
        const [sizes] = await connection.execute<any[]>("SELECT extra_price AS extraPrice FROM product_sizes WHERE product_id = ? AND size_id = ?", [requestedItem.productId, requestedItem.sizeId]);
        if (!sizes[0]) throw new HttpError(400, `Size ID ${requestedItem.sizeId} is not available for product ID ${requestedItem.productId}`);
        extraPrice = Number(sizes[0].extraPrice);
      }
      const unitPrice = Number((basePrice + extraPrice).toFixed(2));
      items.push({ productId: requestedItem.productId, sizeId: requestedItem.sizeId ?? null, quantity: requestedItem.quantity, unitPrice, discount: 0, lineTotal: Number((requestedItem.quantity * unitPrice).toFixed(2)) });
    }
    const subtotal = Number(items.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2));
    if (input.discount > subtotal) throw new HttpError(400, "Order discount cannot exceed the subtotal");
    const totalAmount = Number((subtotal - input.discount + input.shippingCost).toFixed(2));
    const [existingCustomer] = await connection.execute<any[]>("SELECT id FROM customers WHERE phone = ?", [input.customer.phone]);
    let customerId: number;
    if (existingCustomer[0]) {
      customerId = existingCustomer[0].id;
      await connection.execute("UPDATE customers SET name = ?, email = ?, address = ? WHERE id = ?", [input.customer.name, input.customer.email ?? null, input.customer.address, customerId]);
    } else {
      const [customer] = await connection.execute<any>("INSERT INTO customers (name, phone, email, address, is_active) VALUES (?, ?, ?, ?, TRUE)", [input.customer.name, input.customer.phone, input.customer.email ?? null, input.customer.address]);
      customerId = customer.insertId;
      await createPartyCoa("customer", customerId, input.customer.name, connection);
    }
    const [result] = await connection.execute<any>(`INSERT INTO ecommerce_orders (order_number, warehouse_id, customer_id, order_date, payment_method, payment_status, shipping_address, note, subtotal, discount, shipping_cost, total_amount, status)
      VALUES (?, ?, ?, NOW(), ?, 'pending', ?, ?, ?, ?, ?, ?, 'pending')`, [orderNumber(), input.warehouseId, customerId, input.paymentMethod, input.customer.address, input.note ?? null, subtotal, input.discount, input.shippingCost, totalAmount]);
    for (const item of items) {
      const [stock] = await connection.execute<any>("UPDATE warehouse_stocks SET quantity = quantity - ? WHERE warehouse_id = ? AND product_id = ? AND quantity >= ?", [item.quantity, input.warehouseId, item.productId, item.quantity]);
      if (!stock.affectedRows) throw new HttpError(400, `Insufficient stock in this warehouse for product ID ${item.productId}`);
      const [product] = await connection.execute<any>("UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND stock_quantity >= ?", [item.quantity, item.productId, item.quantity]);
      if (!product.affectedRows) throw new HttpError(400, `Product ID ${item.productId} was not found or does not have enough stock`);
      await connection.execute("INSERT INTO ecommerce_order_items (ecommerce_order_id, product_id, size_id, quantity, unit_price, discount, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)", [result.insertId, item.productId, item.sizeId, item.quantity, item.unitPrice, item.discount, item.lineTotal]);
      await connection.execute("INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity_change, reference_type, reference_id, note) VALUES (?, ?, 'ecommerce_order', ?, 'ecommerce_order', ?, ?)", [input.warehouseId, item.productId, -item.quantity, result.insertId, "E-commerce order reserved stock"]);
    }
    await connection.commit();
    // Do not expose the full admin order list: checkout receives only its new order.
    res.status(201).json({ success: true, data: await orderDetails(result.insertId, connection) });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

// Admin order list and details.
ecommerceOrdersRouter.get("/", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const query = z.object({ warehouseId: id.optional(), customerId: id.optional(), status: orderStatusInput.optional(), paymentStatus: z.enum(["pending", "paid", "failed", "refunded"]).optional(), dateFrom: z.string().date().optional(), dateTo: z.string().date().optional() }).parse(req.query);
  const filters: string[] = []; const values: Array<string | number> = [];
  if (query.warehouseId) { filters.push("eo.warehouse_id = ?"); values.push(query.warehouseId); }
  if (query.customerId) { filters.push("eo.customer_id = ?"); values.push(query.customerId); }
  if (query.status) { filters.push("eo.status = ?"); values.push(query.status); }
  if (query.paymentStatus) { filters.push("eo.payment_status = ?"); values.push(query.paymentStatus); }
  if (query.dateFrom) { filters.push("eo.order_date >= ?"); values.push(`${query.dateFrom} 00:00:00`); }
  if (query.dateTo) { filters.push("eo.order_date <= ?"); values.push(`${query.dateTo} 23:59:59`); }
  const [rows] = await db.execute<any[]>(`${headerSelect}${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""} ORDER BY eo.order_date DESC, eo.id DESC`, values);
  res.json({ success: true, data: rows });
}));

ecommerceOrdersRouter.get("/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const order = await orderDetails(id.parse(req.params.id)); if (!order) throw new HttpError(404, "E-commerce order not found"); res.json({ success: true, data: order });
}));

// Convenience action for admin order-confirm buttons. Only pending orders can be confirmed.
ecommerceOrdersRouter.patch("/:id/confirm", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const orderId = id.parse(req.params.id);
  const [result] = await db.execute<any>("UPDATE ecommerce_orders SET status = 'confirmed' WHERE id = ? AND status = 'pending'", [orderId]);
  if (!result.affectedRows) {
    const order = await orderDetails(orderId);
    if (!order) throw new HttpError(404, "E-commerce order not found");
    throw new HttpError(400, "Only a pending order can be confirmed");
  }
  res.json({ success: true, data: await orderDetails(orderId) });
}));

// Update the operational or payment status. Setting status to cancelled restores the reserved stock.
ecommerceOrdersRouter.patch("/:id/status", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const orderId = id.parse(req.params.id);
  const input = z.object({ status: orderStatusInput.optional(), paymentStatus: paymentStatusInput.optional() }).refine(value => value.status || value.paymentStatus, "Provide status or paymentStatus").parse(req.body);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction(); const order = await orderDetails(orderId, connection);
    if (!order) throw new HttpError(404, "E-commerce order not found");
    if (input.status === "cancelled" && order.status !== "cancelled") {
      for (const item of order.items as any[]) {
        await connection.execute("INSERT INTO warehouse_stocks (warehouse_id, product_id, quantity) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)", [order.warehouseId, item.productId, item.quantity]);
        await connection.execute("UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?", [item.quantity, item.productId]);
        await connection.execute("INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity_change, reference_type, reference_id, note) VALUES (?, ?, 'ecommerce_order_cancel', ?, 'ecommerce_order', ?, 'E-commerce order cancelled')", [order.warehouseId, item.productId, item.quantity, orderId]);
      }
    }
    if (order.status === "cancelled" && input.status && input.status !== "cancelled") throw new HttpError(400, "A cancelled order cannot be reopened; create a new order instead");
    const status = input.status ?? order.status; const paymentStatus = input.paymentStatus ?? order.paymentStatus;
    await connection.execute("UPDATE ecommerce_orders SET status = ?, payment_status = ? WHERE id = ?", [status, paymentStatus, orderId]);
    const [customerRows] = await connection.execute<any[]>("SELECT name FROM customers WHERE id = ?", [order.customerId]);
    const customerCoa = await createPartyCoa("customer", order.customerId, customerRows[0].name, connection);
    if (status === "delivered" && order.status !== "delivered") {
      const [costRows] = await connection.execute<any[]>("SELECT COALESCE(SUM(eoi.quantity * p.buying_price), 0) AS cost FROM ecommerce_order_items eoi JOIN products p ON p.id = eoi.product_id WHERE eoi.ecommerce_order_id = ?", [orderId]);
      const cost = Number(costRows[0].cost);
      await postAccountEntries(connection, { referenceType: "ecommerce_order", referenceId: orderId, customerId: order.customerId, description: `Ecommerce order ${order.orderNumber} delivered`, lines: [{ headCode: Number(customerCoa.HeadCode), debit: Number(order.totalAmount) }, { headCode: 4000101, credit: Number(order.totalAmount) }, { headCode: 5000107, debit: cost }, { headCode: 1000108, credit: cost }] });
    }
    if (paymentStatus === "paid" && order.paymentStatus !== "paid") await postAccountEntries(connection, { referenceType: "ecommerce_payment", referenceId: orderId, customerId: order.customerId, description: `Ecommerce order ${order.orderNumber} payment`, lines: [{ headCode: 1000101, debit: Number(order.totalAmount) }, { headCode: Number(customerCoa.HeadCode), credit: Number(order.totalAmount) }] });
    await connection.commit(); res.json({ success: true, data: await orderDetails(orderId, connection) });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

ecommerceOrdersRouter.patch("/:id/payment-status", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const orderId = id.parse(req.params.id); const { paymentStatus } = z.object({ paymentStatus: paymentStatusInput }).parse(req.body);
  const connection = await db.getConnection(); try { await connection.beginTransaction(); const order = await orderDetails(orderId, connection); if (!order) throw new HttpError(404, "E-commerce order not found"); await connection.execute("UPDATE ecommerce_orders SET payment_status = ? WHERE id = ?", [paymentStatus, orderId]); if (paymentStatus === "paid" && order.paymentStatus !== "paid") { const [customers] = await connection.execute<any[]>("SELECT name FROM customers WHERE id = ?", [order.customerId]); const customerCoa = await createPartyCoa("customer", order.customerId, customers[0].name, connection); await postAccountEntries(connection, { referenceType: "ecommerce_payment", referenceId: orderId, customerId: order.customerId, description: `Ecommerce order ${order.orderNumber} payment`, lines: [{ headCode: 1000101, debit: Number(order.totalAmount) }, { headCode: Number(customerCoa.HeadCode), credit: Number(order.totalAmount) }] }); } await connection.commit(); res.json({ success: true, data: await orderDetails(orderId, connection) }); } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));
