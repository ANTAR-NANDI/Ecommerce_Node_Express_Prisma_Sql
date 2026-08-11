import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { publicImageUrl } from "../lib/public-image-url";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { uploadEmployeeImage } from "./uploads.routes";

export const employeesRouter = Router();
const id = z.coerce.number().int().positive();
const boolean = z.preprocess(value => value === "true" ? true : value === "false" ? false : value, z.boolean());
const emptyToUndefined = (value: unknown) => value === "" ? undefined : value;
const createInput = z.object({
  firstName: z.string().trim().min(2).max(100),
  lastName: z.preprocess(value => value === "" ? null : value, z.string().trim().max(100).nullable().optional()),
  phone: z.string().trim().min(6).max(30),
  gender: z.preprocess(value => value === "" ? null : value, z.enum(["male", "female", "other"]).nullable().optional()),
  email: z.string().trim().email().max(191),
  role: z.string().trim().min(2).max(100).optional().default("staff"),
  password: z.string().min(8).max(72),
  isActive: boolean.optional().default(true),
});
const updateInput = z.object({
  firstName: z.preprocess(emptyToUndefined, z.string().trim().min(2).max(100).optional()),
  lastName: z.preprocess(value => value === "" ? null : value, z.string().trim().max(100).nullable().optional()),
  phone: z.preprocess(emptyToUndefined, z.string().trim().min(6).max(30).optional()),
  gender: z.preprocess(value => value === "" ? null : value, z.enum(["male", "female", "other"]).nullable().optional()),
  email: z.preprocess(emptyToUndefined, z.string().trim().email().max(191).optional()),
  role: z.preprocess(emptyToUndefined, z.string().trim().min(2).max(100).optional()),
  password: z.preprocess(emptyToUndefined, z.string().min(8).max(72).optional()),
  isActive: boolean.optional(),
});
const select = `SELECT e.id, e.user_id AS userId, e.first_name AS firstName, e.last_name AS lastName,
  e.phone, e.gender, e.image_url AS image, u.email, e.employee_role AS role,
  e.is_active AS isActive, e.created_at AS createdAt, e.updated_at AS updatedAt
  FROM employees e JOIN users u ON u.id = e.user_id`;

function publicEmployee(employee: any, req: any) {
  return { ...employee, image: publicImageUrl(req, "employee", employee.image) };
}
async function employeeById(employeeId: number, req: any, connection: any = db) {
  const [rows] = await connection.execute(`${select} WHERE e.id = ?`, [employeeId]);
  return (rows as any[])[0] ? publicEmployee((rows as any[])[0], req) : null;
}

employeesRouter.use(requireAuth, requireAdmin);

employeesRouter.get("/", asyncHandler(async (req, res) => {
  const query = z.object({ search: z.string().trim().max(100).optional(), role: z.string().trim().max(100).optional(), isActive: boolean.optional() }).parse(req.query);
  const filters: string[] = []; const values: Array<string | number | boolean> = [];
  if (query.search) { filters.push("(e.first_name LIKE ? OR e.last_name LIKE ? OR e.phone LIKE ? OR u.email LIKE ?)"); values.push(`%${query.search}%`, `%${query.search}%`, `%${query.search}%`, `%${query.search}%`); }
  if (query.role) { filters.push("e.employee_role = ?"); values.push(query.role); }
  if (query.isActive !== undefined) { filters.push("e.is_active = ?"); values.push(query.isActive); }
  const [rows] = await db.execute<any[]>(`${select}${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""} ORDER BY e.created_at DESC`, values);
  res.json({ success: true, data: rows.map(employee => publicEmployee(employee, req)) });
}));

employeesRouter.get("/:id", asyncHandler(async (req, res) => {
  const employee = await employeeById(id.parse(req.params.id), req);
  if (!employee) throw new HttpError(404, "Employee not found");
  res.json({ success: true, data: employee });
}));

employeesRouter.post("/", uploadEmployeeImage.single("image"), asyncHandler(async (req, res) => {
  const input = createInput.parse(req.body); const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const fullName = [input.firstName, input.lastName].filter(Boolean).join(" ");
    const [user] = await connection.execute<any>("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'employee')", [fullName, input.email, await bcrypt.hash(input.password, 12)]);
    const [employee] = await connection.execute<any>(`INSERT INTO employees (user_id, first_name, last_name, phone, gender, image_url, employee_role, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [user.insertId, input.firstName, input.lastName ?? null, input.phone, input.gender ?? null, req.file?.filename ?? null, input.role, input.isActive]);
    await connection.commit(); res.status(201).json({ success: true, data: await employeeById(employee.insertId, req, connection) });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

employeesRouter.patch("/:id", uploadEmployeeImage.single("image"), asyncHandler(async (req, res) => {
  const employeeId = id.parse(req.params.id); const input = updateInput.parse(req.body);
  if (!Object.keys(input).length && !req.file) throw new HttpError(400, "Provide at least one field to update");
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction(); const existing = await employeeById(employeeId, req, connection);
    if (!existing) throw new HttpError(404, "Employee not found");
    const firstName = input.firstName ?? existing.firstName; const lastName = input.lastName === undefined ? existing.lastName : input.lastName;
    const phone = input.phone ?? existing.phone; const gender = input.gender === undefined ? existing.gender : input.gender;
    const email = input.email ?? existing.email; const role = input.role ?? existing.role; const isActive = input.isActive ?? Boolean(existing.isActive);
    const image = req.file?.filename ?? existing.image?.split("/").pop() ?? null;
    await connection.execute("UPDATE users SET name = ?, email = ?, password_hash = COALESCE(?, password_hash) WHERE id = ?", [[firstName, lastName].filter(Boolean).join(" "), email, input.password ? await bcrypt.hash(input.password, 12) : null, existing.userId]);
    await connection.execute("UPDATE employees SET first_name = ?, last_name = ?, phone = ?, gender = ?, image_url = ?, employee_role = ?, is_active = ? WHERE id = ?", [firstName, lastName, phone, gender, image, role, isActive, employeeId]);
    await connection.commit(); res.json({ success: true, data: await employeeById(employeeId, req, connection) });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

// Employees are soft-deactivated instead of deleted, so their login can be stopped without losing records.
employeesRouter.delete("/:id", asyncHandler(async (req, res) => {
  const [result] = await db.execute<any>("UPDATE employees SET is_active = FALSE WHERE id = ?", [id.parse(req.params.id)]);
  if (!result.affectedRows) throw new HttpError(404, "Employee not found");
  res.status(204).send();
}));
