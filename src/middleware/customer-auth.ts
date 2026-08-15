import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../lib/http-error";
import { requireAuth } from "./auth";

// Customer access tokens use the customer ID as userId. This prevents a
// browser from requesting another customer's private orders or profile.
export function requireCustomer(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, error => {
    if (error) return next(error);
    if (req.user?.role !== "customer") return next(new HttpError(403, "Customer access is required"));
    next();
  });
}
