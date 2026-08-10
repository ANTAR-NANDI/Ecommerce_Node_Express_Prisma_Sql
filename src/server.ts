import "dotenv/config";
import express from "express";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errors";
import { authRouter } from "./routes/auth.routes";
import { categoriesRouter } from "./routes/categories.routes";
import { subcategoriesRouter } from "./routes/subcategories.routes";

const app = express();

// Parses JSON request bodies, e.g. { "email": "admin@example.com" }.
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ success: true, message: "ReadyEcommerce API is healthy" });
});

app.use("/auth", authRouter);
app.use("/categories", categoriesRouter);
app.use("/subcategories", subcategoriesRouter);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`ReadyEcommerce API listening at http://localhost:${env.PORT}`);
});
