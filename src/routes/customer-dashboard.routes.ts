import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { requireCustomer } from "../middleware/customer-auth";

export const customerDashboardRouter = Router();
const id = z.coerce.number().int().positive();
const optionalText = (max: number) => z.preprocess(value => value === "" ? null : value, z.string().trim().max(max).nullable().optional());
const addressInput = z.object({ name: z.string().trim().min(2).max(150), phone: z.string().trim().min(6).max(30), area: z.string().trim().min(1).max(100), addressLine: z.string().trim().min(5).max(2000), addressTag: z.enum(["home", "office", "other", "HOME", "OFFICE", "OTHER"]).transform(value => value.toLowerCase() as "home" | "office" | "other").optional(), isDefault: z.preprocess(value => value === "true" ? true : value === "false" ? false : value, z.boolean().optional()) });
const addressSelect = "SELECT id, name, phone, area, address_line AS addressLine, address_tag AS addressTag, is_default AS isDefault, created_at AS createdAt, updated_at AS updatedAt FROM customer_addresses";
const orderSelect = `SELECT eo.id, eo.order_number AS orderNumber, eo.order_date AS orderDate, eo.status, eo.payment_method AS paymentMethod, eo.payment_status AS paymentStatus, eo.shipping_address AS shippingAddress, eo.subtotal, eo.discount, eo.shipping_cost AS shippingCost, eo.total_amount AS totalAmount, eo.created_at AS createdAt FROM ecommerce_orders eo`;

customerDashboardRouter.use(requireCustomer);
const customerId = (req: any) => req.user!.userId as number;

customerDashboardRouter.post("/logout", (_req, res) => res.status(204).send());

const dashboard = asyncHandler(async (req, res) => {
  const currentCustomerId = customerId(req);
  const [[orders], [wishlist], [addresses], [messages]] = await Promise.all([
    db.execute<any[]>("SELECT COUNT(*) AS totalOrders, COALESCE(SUM(status NOT IN ('delivered', 'cancelled')), 0) AS ongoingOrders, COALESCE(SUM(status = 'delivered'), 0) AS deliveredOrders FROM ecommerce_orders WHERE customer_id = ?", [currentCustomerId]),
    db.execute<any[]>("SELECT COUNT(*) AS total FROM product_favorites WHERE customer_id = ?", [currentCustomerId]),
    db.execute<any[]>("SELECT id, name, phone, area, address_line AS addressLine, address_tag AS addressTag FROM customer_addresses WHERE customer_id = ? AND is_default = TRUE LIMIT 1", [currentCustomerId]),
    db.execute<any[]>("SELECT COUNT(*) AS total FROM customer_messages WHERE customer_id = ? AND sender_type = 'admin' AND is_read = FALSE", [currentCustomerId]),
  ]);
  res.json({ success: true, data: { totalOrders: Number(orders[0].totalOrders), ongoingOrders: Number(orders[0].ongoingOrders), deliveredOrders: Number(orders[0].deliveredOrders), wishlistCount: Number(wishlist[0].total), unreadMessages: Number(messages[0].total), cartCount: 0, defaultAddress: addresses[0] ?? null } });
});
customerDashboardRouter.get("/dashboard", dashboard);
customerDashboardRouter.get("/", dashboard);

customerDashboardRouter.get("/orders", asyncHandler(async (req, res) => {
  const [rows] = await db.execute<any[]>(`${orderSelect} WHERE eo.customer_id = ? ORDER BY eo.order_date DESC, eo.id DESC`, [customerId(req)]);
  res.json({ success: true, data: rows });
}));
customerDashboardRouter.get("/orders/:id", asyncHandler(async (req, res) => {
  const orderId = id.parse(req.params.id); const [orders] = await db.execute<any[]>(`${orderSelect} WHERE eo.id = ? AND eo.customer_id = ?`, [orderId, customerId(req)]); if (!orders[0]) throw new HttpError(404, "Order not found");
  const [items] = await db.execute<any[]>("SELECT eoi.id, eoi.product_id AS productId, p.name AS productName, p.sku, eoi.quantity, eoi.unit_price AS unitPrice, eoi.discount, eoi.line_total AS lineTotal FROM ecommerce_order_items eoi JOIN products p ON p.id = eoi.product_id WHERE eoi.ecommerce_order_id = ? ORDER BY eoi.id", [orderId]);
  res.json({ success: true, data: { ...orders[0], items } });
}));

customerDashboardRouter.get("/returns", asyncHandler(async (req, res) => {
  const [rows] = await db.execute<any[]>("SELECT id, return_number AS returnNumber, source_type AS sourceType, source_id AS sourceId, return_date AS returnDate, reason, status, created_at AS createdAt FROM sales_returns WHERE customer_id = ? ORDER BY return_date DESC, id DESC", [customerId(req)]);
  res.json({ success: true, data: rows });
}));

customerDashboardRouter.get("/wishlist", asyncHandler(async (req, res) => {
  const [rows] = await db.execute<any[]>("SELECT pf.product_id AS productId, pf.created_at AS createdAt, p.name, p.slug, p.selling_price AS sellingPrice, p.image AS image FROM product_favorites pf JOIN products p ON p.id = pf.product_id WHERE pf.customer_id = ? ORDER BY pf.created_at DESC", [customerId(req)]);
  res.json({ success: true, data: rows });
}));
customerDashboardRouter.post("/wishlist/:productId", asyncHandler(async (req, res) => {
  const productId = id.parse(req.params.productId); const currentCustomerId = customerId(req); const [products] = await db.execute<any[]>("SELECT id FROM products WHERE id = ? AND is_active = TRUE", [productId]); if (!products[0]) throw new HttpError(404, "Product not found");
  await db.execute("INSERT IGNORE INTO product_favorites (customer_id, product_id) VALUES (?, ?)", [currentCustomerId, productId]); res.status(201).json({ success: true, message: "Product added to wishlist" });
}));
customerDashboardRouter.delete("/wishlist/:productId", asyncHandler(async (req, res) => { await db.execute("DELETE FROM product_favorites WHERE customer_id = ? AND product_id = ?", [customerId(req), id.parse(req.params.productId)]); res.status(204).send(); }));

customerDashboardRouter.get("/messages", asyncHandler(async (req, res) => { const [rows] = await db.execute<any[]>("SELECT id, subject, message, sender_type AS senderType, is_read AS isRead, created_at AS createdAt, updated_at AS updatedAt FROM customer_messages WHERE customer_id = ? ORDER BY created_at DESC", [customerId(req)]); res.json({ success: true, data: rows }); }));
customerDashboardRouter.post("/messages", asyncHandler(async (req, res) => { const input = z.object({ subject: z.string().trim().min(2).max(255), message: z.string().trim().min(2).max(10000) }).parse(req.body); const [result] = await db.execute<any>("INSERT INTO customer_messages (customer_id, subject, message, sender_type) VALUES (?, ?, ?, 'customer')", [customerId(req), input.subject, input.message]); res.status(201).json({ success: true, data: { id: result.insertId } }); }));
customerDashboardRouter.patch("/messages/:id/read", asyncHandler(async (req, res) => { const [result] = await db.execute<any>("UPDATE customer_messages SET is_read = TRUE WHERE id = ? AND customer_id = ?", [id.parse(req.params.id), customerId(req)]); if (!result.affectedRows) throw new HttpError(404, "Message not found"); res.json({ success: true, message: "Message marked as read" }); }));

customerDashboardRouter.get("/profile", asyncHandler(async (req, res) => { const [rows] = await db.execute<any[]>("SELECT id, first_name AS firstName, last_name AS lastName, name, phone, email, gender, date_of_birth AS dateOfBirth, image AS image, created_at AS createdAt, updated_at AS updatedAt FROM customers WHERE id = ?", [customerId(req)]); if (!rows[0]) throw new HttpError(404, "Customer not found"); res.json({ success: true, data: rows[0] }); }));
customerDashboardRouter.patch("/profile", asyncHandler(async (req, res) => { const input = z.object({ firstName: optionalText(100), lastName: optionalText(100), phone: optionalText(30), email: optionalText(191), gender: z.enum(["male", "female", "other"]).nullable().optional(), dateOfBirth: optionalText(10) }).parse(req.body); const fields = Object.entries(input).filter(([, value]) => value !== undefined).map(([key, value]) => ({ column: ({ firstName: "first_name", lastName: "last_name", phone: "phone", email: "email", gender: "gender", dateOfBirth: "date_of_birth" } as Record<string, string>)[key], value })); if (!fields.length) throw new HttpError(400, "Provide at least one profile field"); await db.query(`UPDATE customers SET ${fields.map(field => `${field.column} = ?`).join(", ")} WHERE id = ?`, [...fields.map(field => field.value), customerId(req)]); res.json({ success: true, message: "Profile updated" }); }));
customerDashboardRouter.patch("/change-password", asyncHandler(async (req, res) => { const input = z.object({ currentPassword: z.string().min(6).max(200), newPassword: z.string().min(8).max(200) }).parse(req.body); const [rows] = await db.execute<any[]>("SELECT password_hash AS passwordHash FROM customers WHERE id = ?", [customerId(req)]); if (!rows[0]?.passwordHash || !(await bcrypt.compare(input.currentPassword, rows[0].passwordHash))) throw new HttpError(400, "Current password is incorrect"); await db.execute("UPDATE customers SET password_hash = ? WHERE id = ?", [await bcrypt.hash(input.newPassword, 12), customerId(req)]); res.json({ success: true, message: "Password changed" }); }));

customerDashboardRouter.get("/addresses", asyncHandler(async (req, res) => { const [rows] = await db.execute<any[]>(`${addressSelect} WHERE customer_id = ? ORDER BY is_default DESC, id DESC`, [customerId(req)]); res.json({ success: true, data: rows }); }));
customerDashboardRouter.post("/addresses", asyncHandler(async (req, res) => { const input = addressInput.parse(req.body); const currentCustomerId = customerId(req); const connection = await db.getConnection(); try { await connection.beginTransaction(); const [existing] = await connection.execute<any[]>("SELECT id FROM customer_addresses WHERE customer_id = ? LIMIT 1", [currentCustomerId]); const makeDefault = input.isDefault ?? !existing[0]; if (makeDefault) await connection.execute("UPDATE customer_addresses SET is_default = FALSE WHERE customer_id = ?", [currentCustomerId]); const [result] = await connection.execute<any>("INSERT INTO customer_addresses (customer_id, name, phone, area, address_line, address_tag, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)", [currentCustomerId, input.name, input.phone, input.area, input.addressLine, input.addressTag ?? "home", makeDefault]); await connection.commit(); const [rows] = await db.execute<any[]>(`${addressSelect} WHERE id = ?`, [result.insertId]); res.status(201).json({ success: true, data: rows[0] }); } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); } }));
customerDashboardRouter.patch("/addresses/:id", asyncHandler(async (req, res) => { const addressId = id.parse(req.params.id); const input = addressInput.partial().parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, "Provide at least one address field"); const currentCustomerId = customerId(req); const connection = await db.getConnection(); try { await connection.beginTransaction(); if (input.isDefault) await connection.execute("UPDATE customer_addresses SET is_default = FALSE WHERE customer_id = ?", [currentCustomerId]); const names: Record<string, string> = { name: "name", phone: "phone", area: "area", addressLine: "address_line", addressTag: "address_tag", isDefault: "is_default" }; const fields = Object.entries(input).map(([key, value]) => ({ column: names[key]!, value })); const [result] = await connection.query<any>(`UPDATE customer_addresses SET ${fields.map(field => `${field.column} = ?`).join(", ")} WHERE id = ? AND customer_id = ?`, [...fields.map(field => field.value), addressId, currentCustomerId]); if (!result.affectedRows) throw new HttpError(404, "Address not found"); await connection.commit(); res.json({ success: true, message: "Address updated" }); } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); } }));
customerDashboardRouter.delete("/addresses/:id", asyncHandler(async (req, res) => { const [result] = await db.execute<any>("DELETE FROM customer_addresses WHERE id = ? AND customer_id = ?", [id.parse(req.params.id), customerId(req)]); if (!result.affectedRows) throw new HttpError(404, "Address not found"); res.status(204).send(); }));
