import type { Request } from "express";

// Shared rule for every image module: store only a filename, return a direct public URL.
export function publicImageUrl(req: Request, folder: string, filename: string | null) {
  if (!filename) return null;
  // Preserve any legacy external URLs already saved in the database.
  if (/^https?:\/\//i.test(filename)) return filename;
  return `${req.protocol}://${req.get("host")}/uploads/${folder}/${encodeURIComponent(filename)}`;
}
