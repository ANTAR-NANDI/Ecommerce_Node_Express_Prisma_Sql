import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const rolesRouter = Router();
const id = z.coerce.number().int().positive();
const roleInput = z.object({ name: z.string().trim().min(2).max(100), slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9-]+$/), description: z.preprocess(value => value === "" ? null : value, z.string().trim().max(500).nullable().optional()), permissionIds: z.array(id).max(200).optional() });
const roleSelect = "SELECT r.id, r.name, r.slug, r.description, r.is_system AS isSystem, r.created_at AS createdAt, r.updated_at AS updatedAt FROM roles r";

async function permissionsForRole(roleId: number) {
  const [rows] = await db.execute<any[]>("SELECT p.id, p.permission_key AS permissionKey, p.module_name AS moduleName, p.action_name AS actionName FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ? ORDER BY p.module_name, p.action_name", [roleId]);
  return rows;
}
async function roleDetails(roleId: number) {
  const [rows] = await db.execute<any[]>(`${roleSelect} WHERE r.id = ?`, [roleId]);
  if (!rows[0]) return null;
  return { ...rows[0], permissions: await permissionsForRole(roleId) };
}
async function replacePermissions(connection: any, roleId: number, permissionIds: number[]) {
  if (permissionIds.length) { const [valid] = await connection.query(`SELECT id FROM permissions WHERE id IN (${permissionIds.map(() => "?").join(",")})`, permissionIds); if (valid.length !== permissionIds.length) throw new HttpError(400, "One or more permission IDs are invalid"); }
  await connection.execute("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);
  for (const permissionId of permissionIds) await connection.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleId, permissionId]);
}

rolesRouter.use(requireAuth, requireAdmin);
rolesRouter.get("/permissions", asyncHandler(async (_req, res) => { const [rows] = await db.query<any[]>("SELECT id, permission_key AS permissionKey, module_name AS moduleName, action_name AS actionName FROM permissions ORDER BY module_name, action_name"); res.json({ success: true, data: rows }); }));
rolesRouter.get("/", asyncHandler(async (req, res) => { const search = z.string().trim().max(100).optional().parse(req.query.search); const [rows] = search ? await db.execute<any[]>(`${roleSelect} WHERE r.name LIKE ? ORDER BY r.name`, [`%${search}%`]) : await db.query<any[]>(`${roleSelect} ORDER BY r.name`); const data = await Promise.all(rows.map(async role => ({ ...role, permissionCount: Number((await db.execute<any[]>("SELECT COUNT(*) AS total FROM role_permissions WHERE role_id = ?", [role.id]))[0][0].total) }))); res.json({ success: true, data }); }));
rolesRouter.get("/:id", asyncHandler(async (req, res) => { const role = await roleDetails(id.parse(req.params.id)); if (!role) throw new HttpError(404, "Role not found"); res.json({ success: true, data: role }); }));
rolesRouter.post("/", asyncHandler(async (req, res) => { const input = roleInput.parse(req.body); const connection = await db.getConnection(); try { await connection.beginTransaction(); const [result] = await connection.execute<any>("INSERT INTO roles (name, slug, description) VALUES (?, ?, ?)", [input.name, input.slug, input.description ?? null]); await replacePermissions(connection, result.insertId, input.permissionIds ?? []); await connection.commit(); res.status(201).json({ success: true, data: await roleDetails(result.insertId) }); } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); } }));
rolesRouter.patch("/:id", asyncHandler(async (req, res) => { const roleId = id.parse(req.params.id); const input = roleInput.partial().parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, "Provide at least one field to update"); const [system] = await db.execute<any[]>("SELECT is_system AS isSystem FROM roles WHERE id = ?", [roleId]); if (!system[0]) throw new HttpError(404, "Role not found"); if (system[0].isSystem && (input.name !== undefined || input.slug !== undefined)) throw new HttpError(400, "System role name and slug cannot be changed"); const connection = await db.getConnection(); try { await connection.beginTransaction(); const fields = Object.entries(input).filter(([key]) => key !== "permissionIds").map(([key, value]) => ({ column: ({ name: "name", slug: "slug", description: "description" } as Record<string, string>)[key], value })); if (fields.length) await connection.query(`UPDATE roles SET ${fields.map(field => `${field.column} = ?`).join(", ")} WHERE id = ?`, [...fields.map(field => field.value), roleId]); if (input.permissionIds !== undefined) await replacePermissions(connection, roleId, input.permissionIds); await connection.commit(); res.json({ success: true, data: await roleDetails(roleId) }); } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); } }));
rolesRouter.delete("/:id", asyncHandler(async (req, res) => { const roleId = id.parse(req.params.id); const [result] = await db.execute<any>("DELETE FROM roles WHERE id = ? AND is_system = FALSE", [roleId]); if (!result.affectedRows) throw new HttpError(400, "Role not found or is a protected system role"); res.status(204).send(); }));
rolesRouter.put("/users/:userId", asyncHandler(async (req, res) => { const userId = id.parse(req.params.userId); const { roleIds } = z.object({ roleIds: z.array(id).max(50) }).parse(req.body); const connection = await db.getConnection(); try { await connection.beginTransaction(); if (roleIds.length) { const [valid] = await connection.query<any[]>(`SELECT id FROM roles WHERE id IN (${roleIds.map(() => "?").join(",")})`, roleIds); if (valid.length !== roleIds.length) throw new HttpError(400, "One or more role IDs are invalid"); } await connection.execute("DELETE FROM user_roles WHERE user_id = ?", [userId]); for (const roleId of roleIds) await connection.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]); await connection.commit(); res.json({ success: true, message: "User roles updated" }); } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); } }));
