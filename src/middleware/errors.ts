import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { HttpError } from "../lib/http-error";

export const notFoundHandler: RequestHandler = (req, _res, next) => next(new HttpError(404, `Route ${req.method} ${req.path} was not found`));

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) return res.status(400).json({ success: false, message: "Validation failed", errors: error.issues });
  if (error instanceof HttpError) return res.status(error.statusCode).json({ success: false, message: error.message });
  if (error?.code === "ER_DUP_ENTRY") return res.status(409).json({ success: false, message: "A record with that value already exists" });
  console.error(error);
  return res.status(500).json({ success: false, message: "Internal server error" });
};
