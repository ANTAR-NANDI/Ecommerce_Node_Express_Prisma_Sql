import "dotenv/config";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../config/db";

async function createAdmin() {
  const input = z.object({ ADMIN_NAME: z.string().min(2), ADMIN_EMAIL: z.string().email(), ADMIN_PASSWORD: z.string().min(8).max(72) }).parse(process.env);
  const passwordHash = await bcrypt.hash(input.ADMIN_PASSWORD, 12);
  await db.execute("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin') ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash), role = 'admin'", [input.ADMIN_NAME, input.ADMIN_EMAIL, passwordHash]);
  console.log(`Admin ${input.ADMIN_EMAIL} is ready.`);
  await db.end();
}
createAdmin().catch(error => { console.error("Creating admin failed:", error); process.exit(1); });
