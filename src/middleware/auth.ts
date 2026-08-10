import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../lib/http-error";
import { verifyAccessToken, type JwtPayload } from "../lib/tokens";

declare global {
  namespace Express {
    interface Request { user?: JwtPayload }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return next(new HttpError(401, "Missing Bearer access token"));
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    next(new HttpError(401, "Invalid or expired access token"));
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") return next(new HttpError(403, "Admin access is required"));
  next();
}
