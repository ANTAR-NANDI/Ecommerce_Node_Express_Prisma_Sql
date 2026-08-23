import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const storeSettingsRouter = Router();
export const storefrontSettingsRouter = Router();
const nullableText = (max: number) => z.preprocess(value => value === "" ? null : value, z.string().trim().max(max).nullable().optional());
const url = z.preprocess(value => value === "" ? null : value, z.string().url().max(2048).nullable().optional());
const settingsInput = z.object({
  storeName: z.string().trim().min(2).max(255),
  logo: url,
  favicon: url,
  phone: nullableText(50),
  email: z.preprocess(value => value === "" ? null : value, z.string().email().max(255).nullable().optional()),
  address: nullableText(10_000),
  facebookUrl: url,
  instagramUrl: url,
  defaultSeoTitle: nullableText(255),
  defaultSeoDescription: nullableText(500),
});
const select = "SELECT store_name AS storeName, logo, favicon, phone, email, address, facebook_url AS facebookUrl, instagram_url AS instagramUrl, default_seo_title AS defaultSeoTitle, default_seo_description AS defaultSeoDescription, updated_at AS updatedAt FROM store_settings WHERE id = 1";
async function getSettings() {
  const [rows] = await db.query<any[]>(select);
  if (!rows[0]) throw new HttpError(404, "Store settings not found");
  return rows[0];
}

storefrontSettingsRouter.get("/", asyncHandler(async (_req, res) => res.json({ success: true, data: await getSettings() })));
storeSettingsRouter.get("/", requireAuth, requireAdmin, asyncHandler(async (_req, res) => res.json({ success: true, data: await getSettings() })));
storeSettingsRouter.patch("/", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const input = settingsInput.partial().parse(req.body);
  if (!Object.keys(input).length) throw new HttpError(400, "Provide at least one field to update");
  const columns: Record<string, string> = { storeName: "store_name", logo: "logo", favicon: "favicon", phone: "phone", email: "email", address: "address", facebookUrl: "facebook_url", instagramUrl: "instagram_url", defaultSeoTitle: "default_seo_title", defaultSeoDescription: "default_seo_description" };
  const entries = Object.entries(input).map(([key, value]) => [columns[key]!, value]);
  await db.execute(`UPDATE store_settings SET ${entries.map(([column]) => `${column} = ?`).join(", ")} WHERE id = 1`, entries.map(([, value]) => value) as any);
  res.json({ success: true, data: await getSettings() });
}));
