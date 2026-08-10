import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  DB_HOST: z.string().default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().default("ready_ecommerce"),
  DB_USER: z.string().default("root"),
  DB_PASSWORD: z.string().default(""),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  // Comma-separated frontend URLs allowed to call this API from a browser.
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
});

export const env = schema.parse(process.env);
