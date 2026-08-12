import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const contactUsRouter = Router();
const nullableText = z.preprocess(value => value === "" ? null : value, z.string().trim().max(500).nullable().optional());
const contactInput = z.object({
  phoneNumber: nullableText,
  whatsappNumber: nullableText,
  messengerLink: z.preprocess(value => value === "" ? null : value, z.string().trim().url().max(500).nullable().optional()),
  email: z.preprocess(value => value === "" ? null : value, z.string().trim().email().max(191).nullable().optional()),
  address: z.preprocess(value => value === "" ? null : value, z.string().trim().max(5000).nullable().optional()),
});
const select = "SELECT id, phone_number AS phoneNumber, whatsapp_number AS whatsappNumber, messenger_link AS messengerLink, email, address, created_at AS createdAt, updated_at AS updatedAt FROM contact_us";

// Public frontend read endpoint. Contact details can only be created from the admin panel.
contactUsRouter.get("/", asyncHandler(async (_req, res) => {
  const [rows] = await db.query<any[]>(`${select} ORDER BY id DESC LIMIT 1`);
  res.json({ success: true, data: rows[0] ?? null });
}));

contactUsRouter.post("/", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const input = contactInput.parse(req.body);
  const [existing] = await db.query<any[]>("SELECT id FROM contact_us LIMIT 1");
  if (existing[0]) throw new HttpError(409, "Contact Us settings already exist");
  const [result] = await db.execute<any>("INSERT INTO contact_us (phone_number, whatsapp_number, messenger_link, email, address) VALUES (?, ?, ?, ?, ?)", [input.phoneNumber ?? null, input.whatsappNumber ?? null, input.messengerLink ?? null, input.email ?? null, input.address ?? null]);
  const [rows] = await db.execute<any[]>(`${select} WHERE id = ?`, [result.insertId]);
  res.status(201).json({ success: true, data: rows[0] });
}));
