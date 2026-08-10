import type { RequestHandler } from "express";

// Express 5 catches rejected promises, but this keeps route handlers readable and explicit.
export const asyncHandler = (handler: RequestHandler): RequestHandler =>
  (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
