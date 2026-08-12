import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "node:path";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errors";
import { authRouter } from "./routes/auth.routes";
import { brandsRouter } from "./routes/brands.routes";
import { colorsRouter } from "./routes/colors.routes";
import { customersRouter } from "./routes/customers.routes";
import { dashboardRouter } from "./routes/dashboard.routes";
import { employeesRouter } from "./routes/employees.routes";
import { ecommerceOrdersRouter } from "./routes/ecommerce-orders.routes";
import { productsRouter } from "./routes/products.routes";
import { purchasesRouter } from "./routes/purchases.routes";
import { purchaseReturnsRouter } from "./routes/purchase-returns.routes";
import { posSalesRouter } from "./routes/pos-sales.routes";
import { categoriesRouter } from "./routes/categories.routes";
import { subcategoriesRouter } from "./routes/subcategories.routes";
import { suppliersRouter } from "./routes/suppliers.routes";
import { sizesRouter } from "./routes/sizes.routes";
import { stockAdjustmentsRouter } from "./routes/stock-adjustments.routes";
import { stockReportsRouter } from "./routes/stock-reports.routes";
import { salesReturnsRouter } from "./routes/sales-returns.routes";
import { unitsRouter } from "./routes/units.routes";
import { warehousesRouter } from "./routes/warehouses.routes";
import { warehouseRequisitionsRouter } from "./routes/warehouse-requisitions.routes";
import { warehouseTransfersRouter } from "./routes/warehouse-transfers.routes";
import { uploadsRouter } from "./routes/uploads.routes";

const app = express();
const allowedOrigins = env.CORS_ORIGIN.split(",").map(origin => origin.trim()).filter(Boolean);

// Railway forwards HTTPS requests through a proxy; this preserves https in generated URLs.
app.set("trust proxy", 1);

// Allows the frontend browser to call this API from the approved origin(s).
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// Parses JSON request bodies, e.g. { "email": "admin@example.com" }.
app.use(express.json());
// Singular public aliases match the API response format while retaining existing upload folders.
app.use("/uploads/category", express.static(path.resolve("uploads", "categories")));
app.use("/uploads/subcategory", express.static(path.resolve("uploads", "subcategories")));
app.use("/uploads/brand", express.static(path.resolve("uploads", "brands")));
app.use("/uploads/supplier", express.static(path.resolve("uploads", "suppliers")));
app.use("/uploads/employee", express.static(path.resolve("uploads", "employees")));
app.use("/uploads/product", express.static(path.resolve("uploads", "products")));
app.use("/uploads", express.static(path.resolve("uploads")));

app.get("/health", (_req, res) => {
  res.status(200).json({ success: true, message: "ReadyEcommerce API is healthy" });
});

app.use("/auth", authRouter);
app.use("/brands", brandsRouter);
app.use("/colors", colorsRouter);
app.use("/customers", customersRouter);
app.use("/dashboard", dashboardRouter);
app.use("/employees", employeesRouter);
app.use("/ecommerce-orders", ecommerceOrdersRouter);
app.use("/products", productsRouter);
app.use("/purchases", purchasesRouter);
app.use("/purchase-returns", purchaseReturnsRouter);
app.use("/pos-sales", posSalesRouter);
app.use("/categories", categoriesRouter);
app.use("/subcategories", subcategoriesRouter);
app.use("/sizes", sizesRouter);
app.use("/stock-adjustments", stockAdjustmentsRouter);
app.use("/stock-reports", stockReportsRouter);
app.use("/sales-returns", salesReturnsRouter);
app.use("/units", unitsRouter);
app.use("/suppliers", suppliersRouter);
app.use("/warehouses", warehousesRouter);
app.use("/warehouse-requisitions", warehouseRequisitionsRouter);
app.use("/warehouse-transfers", warehouseTransfersRouter);
app.use("/uploads", uploadsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

// Railway assigns PORT. 0.0.0.0 accepts traffic from Railway's public proxy.
app.listen(env.PORT, "0.0.0.0", () => {
  console.log(`ReadyEcommerce API listening on port ${env.PORT}`);
});
