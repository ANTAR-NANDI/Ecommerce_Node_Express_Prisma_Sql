import mysql from "mysql2/promise";
import { env } from "./env";

// A pool reuses a small set of database connections instead of opening one per request.
export const db = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  // Migrations contain multiple CREATE TABLE statements. Application values still use parameterized queries.
  multipleStatements: true,
});
