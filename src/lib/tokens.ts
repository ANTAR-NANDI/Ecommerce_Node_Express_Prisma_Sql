import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

export type JwtPayload = { userId: number; email: string; role: "admin" | "customer" };

export const makeAccessToken = (payload: JwtPayload) =>
  jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: "7d" });

export const makeRefreshToken = (payload: JwtPayload) =>
  jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: "7d" });

export const verifyAccessToken = (token: string) => jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
export const verifyRefreshToken = (token: string) => jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtPayload;
export const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
export const randomToken = () => crypto.randomBytes(32).toString("hex");
