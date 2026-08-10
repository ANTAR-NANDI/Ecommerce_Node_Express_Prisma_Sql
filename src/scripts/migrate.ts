import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "../config/db";

async function migrate() {
  await db.query("CREATE TABLE IF NOT EXISTS migrations (id INT PRIMARY KEY AUTO_INCREMENT, filename VARCHAR(255) NOT NULL UNIQUE, run_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  const directory = path.resolve("migrations");
  const files = (await fs.readdir(directory)).filter(file => file.endsWith(".sql")).sort();
  const [applied] = await db.query<any[]>("SELECT filename FROM migrations");
  const done = new Set(applied.map(row => row.filename));
  for (const filename of files.filter(file => !done.has(file))) {
    const sql = await fs.readFile(path.join(directory, filename), "utf8");
    const connection = await db.getConnection();
    try { await connection.beginTransaction(); await connection.query(sql); await connection.execute("INSERT INTO migrations (filename) VALUES (?)", [filename]); await connection.commit(); console.log(`Applied ${filename}`); }
    catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }
  await db.end();
}
migrate().catch(error => { console.error("Migration failed:", error); process.exit(1); });
