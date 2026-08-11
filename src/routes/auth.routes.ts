import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { hashToken, makeAccessToken, makeRefreshToken, randomToken, verifyRefreshToken, type JwtPayload } from "../lib/tokens";
import { requireAuth } from "../middleware/auth";

export const authRouter = Router();
const credentials = z.object({ email: z.string().email(), password: z.string().min(8).max(72) });

async function saveRefreshToken(userId: number, token: string) {
  await db.execute("INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))", [userId, hashToken(token)]);
}

authRouter.post("/admin/login", asyncHandler(async (req, res) => {
  const { email, password } = credentials.parse(req.body);
  const [rows] = await db.execute<any[]>("SELECT id, name, email, password_hash, role FROM users WHERE email = ?", [email]);
  const user = rows[0];
  if (!user || user.role !== "admin" || !(await bcrypt.compare(password, user.password_hash))) throw new HttpError(401, "Invalid email or password");
  const payload: JwtPayload = { userId: user.id, email: user.email, role: user.role };
  const accessToken = makeAccessToken(payload);
  const refreshToken = makeRefreshToken(payload);
  await saveRefreshToken(user.id, refreshToken);
  res.json({ success: true, data: { user: { id: user.id, name: user.name, email: user.email, role: user.role }, accessToken, refreshToken } });
}));

// Employees have their own login because they cannot use admin-only APIs.
authRouter.post("/employee/login", asyncHandler(async (req, res) => {
  const { email, password } = credentials.parse(req.body);
  const [rows] = await db.execute<any[]>(`SELECT u.id, u.name, u.email, u.password_hash, u.role, e.id AS employeeId, e.employee_role AS employeeRole
    FROM users u JOIN employees e ON e.user_id = u.id
    WHERE u.email = ? AND u.role = 'employee' AND e.is_active = 1`, [email]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) throw new HttpError(401, "Invalid email or password");
  const payload: JwtPayload = { userId: user.id, email: user.email, role: "employee" };
  const accessToken = makeAccessToken(payload); const refreshToken = makeRefreshToken(payload);
  await saveRefreshToken(user.id, refreshToken);
  res.json({ success: true, data: { user: { id: user.id, employeeId: user.employeeId, name: user.name, email: user.email, role: user.role, employeeRole: user.employeeRole }, accessToken, refreshToken } });
}));

authRouter.get("/me", requireAuth, asyncHandler(async (req, res) => {
  const [rows] = await db.execute<any[]>("SELECT id, name, email, role, created_at FROM users WHERE id = ?", [req.user!.userId]);
  if (!rows[0]) throw new HttpError(404, "User not found");
  res.json({ success: true, data: rows[0] });
}));

authRouter.post("/refresh", asyncHandler(async (req, res) => {
  const token = z.object({ refreshToken: z.string().min(1) }).parse(req.body).refreshToken;
  let payload: JwtPayload;
  try { payload = verifyRefreshToken(token); } catch { throw new HttpError(401, "Invalid or expired refresh token"); }
  const [rows] = await db.execute<any[]>("SELECT id FROM refresh_tokens WHERE user_id = ? AND token_hash = ? AND expires_at > NOW()", [payload.userId, hashToken(token)]);
  if (!rows[0]) throw new HttpError(401, "Refresh token was revoked");
  await db.execute("DELETE FROM refresh_tokens WHERE token_hash = ?", [hashToken(token)]);
  const refreshToken = makeRefreshToken(payload);
  await saveRefreshToken(payload.userId, refreshToken);
  res.json({ success: true, data: { accessToken: makeAccessToken(payload), refreshToken } });
}));

authRouter.post("/logout", asyncHandler(async (req, res) => {
  const refreshToken = z.object({ refreshToken: z.string().min(1) }).parse(req.body).refreshToken;
  await db.execute("DELETE FROM refresh_tokens WHERE token_hash = ?", [hashToken(refreshToken)]);
  res.status(204).send();
}));

authRouter.post("/forgot-password", asyncHandler(async (req, res) => {
  const email = z.object({ email: z.string().email() }).parse(req.body).email;
  const [rows] = await db.execute<any[]>("SELECT id FROM users WHERE email = ?", [email]);
  let resetToken: string | undefined;
  if (rows[0]) {
    resetToken = randomToken();
    await db.execute("DELETE FROM password_reset_tokens WHERE user_id = ?", [rows[0].id]);
    await db.execute("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))", [rows[0].id, hashToken(resetToken)]);
  }
  // Replace the development-only token below with your email provider in production.
  res.json({ success: true, message: "If that email exists, a reset link has been sent", ...(process.env.NODE_ENV !== "production" && resetToken ? { developmentResetToken: resetToken } : {}) });
}));

authRouter.post("/reset-password", asyncHandler(async (req, res) => {
  const { token, password } = z.object({ token: z.string().min(1), password: z.string().min(8).max(72) }).parse(req.body);
  const [rows] = await db.execute<any[]>("SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND expires_at > NOW()", [hashToken(token)]);
  if (!rows[0]) throw new HttpError(400, "Invalid or expired reset token");
  await db.execute("UPDATE users SET password_hash = ? WHERE id = ?", [await bcrypt.hash(password, 12), rows[0].user_id]);
  await db.execute("DELETE FROM password_reset_tokens WHERE user_id = ?", [rows[0].user_id]);
  await db.execute("DELETE FROM refresh_tokens WHERE user_id = ?", [rows[0].user_id]);
  res.json({ success: true, message: "Password reset successfully. Please log in again." });
}));
