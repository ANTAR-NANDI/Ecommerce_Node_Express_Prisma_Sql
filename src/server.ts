import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "node:path";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errors";
import { authRouter } from "./routes/auth.routes";
import { brandsRouter } from "./routes/brands.routes";
import { categoriesRouter } from "./routes/categories.routes";
import { subcategoriesRouter } from "./routes/subcategories.routes";
import { uploadsRouter } from "./routes/uploads.routes";

const app = express();
const allowedOrigins = env.CORS_ORIGIN.split(",").map(origin => origin.trim()).filter(Boolean);

// Allows the frontend browser to call this API from the approved origin(s).
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// Parses JSON request bodies, e.g. { "email": "admin@example.com" }.
app.use(express.json());
app.use("/uploads", express.static(path.resolve("uploads")));

app.get("/health", (_req, res) => {
  res.status(200).json({ success: true, message: "ReadyEcommerce API is healthy" });
});

app.use("/auth", authRouter);
app.use("/brands", brandsRouter);
app.use("/categories", categoriesRouter);
app.use("/subcategories", subcategoriesRouter);
app.use("/uploads", uploadsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

// Railway assigns PORT. 0.0.0.0 accepts traffic from Railway's public proxy.
app.listen(env.PORT, "0.0.0.0", () => {
  console.log(`ReadyEcommerce API listening on port ${env.PORT}`);
});
