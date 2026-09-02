import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { createPartyCoa } from "../lib/party-coa";
import { publicImageUrl } from "../lib/public-image-url";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { uploadCustomerImage } from "./uploads.routes";

export const customersRouter = Router();
const id = z.coerce.number().int().positive();
const boolean = z.preprocess(value => value === "true" ? true : value === "false" ? false : value, z.boolean());
const imageFilename = z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(jpg|jpeg|png|webp|gif)$/i, "Image must be an uploaded image filename");
const dateOfBirth = z.preprocess(value => value === "" ? null : value, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateOfBirth must use YYYY-MM-DD").nullable().optional());
const customerInput = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(6).max(30),
  email: z.string().trim().email(),
  password: z.string().min(6).max(200),
  gender: z.enum(["male", "female", "other"]),
  dateOfBirth,
  image: imageFilename.nullable().optional(),
  isActive: boolean.optional(),
});
const select = "SELECT id, first_name AS firstName, last_name AS lastName, phone, email, gender, date_of_birth AS dateOfBirth, image_url AS image, is_active AS isActive, is_walk_in AS isWalkIn, created_at AS createdAt, updated_at AS updatedAt FROM customers";
const withImageUrl = (req: Parameters<typeof publicImageUrl>[0], row: any) => ({ ...row, image: publicImageUrl(req, "customer", row.image) });

customersRouter.use(requireAuth, requireAdmin);

customersRouter.get("/", asyncHandler(async (req, res) => {
  const search = z.string().trim().max(100).optional().parse(req.query.search);
  const [rows] = search
    ? await db.execute<any[]>(`${select} WHERE first_name LIKE ? OR last_name LIKE ? OR phone LIKE ? OR email LIKE ? ORDER BY is_walk_in DESC, first_name, last_name`, [`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`])
    : await db.query(`${select} ORDER BY is_walk_in DESC, first_name, last_name`);
  res.json({ success: true, data: (rows as any[]).map(row => withImageUrl(req, row)) });
}));

// The ledger is the source of truth, so this includes sales, receipts and manual adjustments.
customersRouter.get("/:id/due", asyncHandler(async (req, res) => {
  const customerId = id.parse(req.params.id);
  const [rows] = await db.execute<any[]>(
    `SELECT c.id AS customerId, c.name AS customerName, c.is_walk_in AS isWalkIn,
      coa.id AS accountId, coa.HeadCode AS headCode,
      COALESCE(SUM(at.debit), 0) AS totalDebit,
      COALESCE(SUM(at.credit), 0) AS totalCredit,
      GREATEST(COALESCE(SUM(at.debit), 0) - COALESCE(SUM(at.credit), 0), 0) AS totalDue,
      GREATEST(COALESCE(SUM(at.credit), 0) - COALESCE(SUM(at.debit), 0), 0) AS advanceAmount
     FROM customers c
     LEFT JOIN account_coa coa ON coa.customer_id = c.id
     LEFT JOIN account_transactions at ON at.head_code = coa.HeadCode
     WHERE c.id = ?
     GROUP BY c.id, c.name, c.is_walk_in, coa.id, coa.HeadCode`,
    [customerId],
  );
  if (!rows[0]) throw new HttpError(404, "Customer not found");
  res.json({ success: true, data: rows[0] });
}));

customersRouter.get("/:id", asyncHandler(async (req, res) => {
  const [rows] = await db.execute<any[]>(`${select} WHERE id = ?`, [id.parse(req.params.id)]);
  if (!rows[0]) throw new HttpError(404, "Customer not found");
  res.json({ success: true, data: withImageUrl(req, rows[0]) });
}));

customersRouter.post("/", uploadCustomerImage.single("image"), asyncHandler(async (req, res) => {
  const input = customerInput.parse({ ...req.body, image: req.file?.filename ?? req.body?.image });
  const passwordHash = await bcrypt.hash(input.password, 12);
  const name = `${input.firstName} ${input.lastName}`;
  const [result] = await db.execute<any>("INSERT INTO customers (name, first_name, last_name, phone, email, password_hash, gender, date_of_birth, image_url, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [name, input.firstName, input.lastName, input.phone, input.email, passwordHash, input.gender, input.dateOfBirth ?? null, input.image ?? null, input.isActive ?? true]);
  await createPartyCoa("customer", result.insertId, name);
  const [rows] = await db.execute<any[]>(`${select} WHERE id = ?`, [result.insertId]);
  res.status(201).json({ success: true, data: withImageUrl(req, rows[0]) });
}));

customersRouter.patch("/:id", uploadCustomerImage.single("image"), asyncHandler(async (req, res) => {
  const customerId = id.parse(req.params.id);
  const updateBody = { ...(req.body ?? {}) };
  if (req.file) updateBody.image = req.file.filename;
  const input = customerInput.partial().parse(updateBody);
  if (!Object.keys(input).length) throw new HttpError(400, "Provide at least one field to update");
  const [currentRows] = await db.execute<any[]>("SELECT first_name AS firstName, last_name AS lastName, is_walk_in AS isWalkIn FROM customers WHERE id = ?", [customerId]);
  if (!currentRows[0]) throw new HttpError(404, "Customer not found");
  if (currentRows[0].isWalkIn) throw new HttpError(400, "Walking Customer is a protected system customer and cannot be updated");
  const names: Record<string, string> = { firstName: "first_name", lastName: "last_name", phone: "phone", email: "email", gender: "gender", dateOfBirth: "date_of_birth", image: "image_url", isActive: "is_active" };
  const fields = Object.entries(input).filter(([key]) => key !== "password").map(([key, value]) => ({ name: names[key]!, value }));
  if (input.password !== undefined) fields.push({ name: "password_hash", value: await bcrypt.hash(input.password, 12) });
  const firstName = input.firstName ?? currentRows[0].firstName; const lastName = input.lastName ?? currentRows[0].lastName;
  if (input.firstName !== undefined || input.lastName !== undefined) fields.push({ name: "name", value: `${firstName} ${lastName}`.trim() });
  await db.query<any>(`UPDATE customers SET ${fields.map(field => `${field.name} = ?`).join(", ")} WHERE id = ?`, [...fields.map(field => field.value), customerId] as any);
  res.json({ success: true, message: "Customer updated" });
}));

customersRouter.delete("/:id", asyncHandler(async (req, res) => {
  const customerId = id.parse(req.params.id);
  const [walking] = await db.execute<any[]>("SELECT is_walk_in AS isWalkIn FROM customers WHERE id = ?", [customerId]);
  if (walking[0]?.isWalkIn) throw new HttpError(400, "Walking Customer is a protected system customer and cannot be deleted");
  const [result] = await db.execute<any>("DELETE FROM customers WHERE id = ?", [customerId]);
  if (!result.affectedRows) throw new HttpError(404, "Customer not found");
  res.status(204).send();
}));
