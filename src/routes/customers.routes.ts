import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const customersRouter = Router();
const boolean = z.preprocess(value => value === "true" ? true : value === "false" ? false : value, z.boolean());
const customerInput = z.object({
  name: z.string().trim().min(2).max(150),
  phone: z.string().trim().min(6).max(30),
  email: z.preprocess(value => value === "" ? null : value, z.string().email().nullable().optional()),
  address: z.preprocess(value => value === "" ? null : value, z.string().trim().max(2000).nullable().optional()),
  isActive: boolean.optional(),
});
const select = "SELECT id, name, phone, email, address, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt FROM customers";

customersRouter.use(requireAuth, requireAdmin);

customersRouter.get("/", asyncHandler(async (req, res) => {
  const search = z.string().trim().max(100).optional().parse(req.query.search);
  const [rows] = search ? await db.execute<any[]>(`${select} WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? ORDER BY name`, [`%${search}%`, `%${search}%`, `%${search}%`]) : await db.query(`${select} ORDER BY name`);
  res.json({ success: true, data: rows });
}));

customersRouter.get("/:id", asyncHandler(async (req, res) => {
  const [rows] = await db.execute<any[]>(`${select} WHERE id = ?`, [Number(req.params.id)]);
  if (!rows[0]) throw new HttpError(404, "Customer not found");
  res.json({ success: true, data: rows[0] });
}));

customersRouter.post("/", asyncHandler(async (req, res) => {
  const input = customerInput.parse(req.body);
  const [result] = await db.execute<any>("INSERT INTO customers (name, phone, email, address, is_active) VALUES (?, ?, ?, ?, ?)", [input.name, input.phone, input.email ?? null, input.address ?? null, input.isActive ?? true]);
  const [rows] = await db.execute<any[]>(`${select} WHERE id = ?`, [result.insertId]);
  res.status(201).json({ success: true, data: rows[0] });
}));

customersRouter.patch("/:id", asyncHandler(async (req, res) => {
  const input = customerInput.partial().parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, "Provide at least one field to update");
  const fields = Object.entries(input).map(([key, value]) => ({ name: key === "isActive" ? "is_active" : key, value }));
  const [result] = await db.query<any>(`UPDATE customers SET ${fields.map(field => `${field.name} = ?`).join(", ")} WHERE id = ?`, [...fields.map(field => field.value), Number(req.params.id)] as any);
  if (!result.affectedRows) throw new HttpError(404, "Customer not found");
  res.json({ success: true, message: "Customer updated" });
}));

customersRouter.delete("/:id", asyncHandler(async (req, res) => {
  const [result] = await db.execute<any>("DELETE FROM customers WHERE id = ?", [Number(req.params.id)]);
  if (!result.affectedRows) throw new HttpError(404, "Customer not found");
  res.status(204).send();
}));
