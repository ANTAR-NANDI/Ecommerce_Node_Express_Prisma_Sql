import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "node:path";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errors";
import { requireAdmin, requireAuth } from "./middleware/auth";
import { authRouter, customerAuthRouter } from "./routes/auth.routes";
import { accountsRouter } from "./routes/accounts.routes";
import { brandsRouter } from "./routes/brands.routes";
import { blogsRouter } from "./routes/blogs.routes";
import { colorsRouter } from "./routes/colors.routes";
import { contactUsRouter } from "./routes/contact-us.routes";
import { customersRouter } from "./routes/customers.routes";
import { customerDashboardRouter } from "./routes/customer-dashboard.routes";
import { dashboardRouter } from "./routes/dashboard.routes";
import { employeesRouter } from "./routes/employees.routes";
import { ecommerceOrdersRouter } from "./routes/ecommerce-orders.routes";
import { productsRouter } from "./routes/products.routes";
import { purchasesRouter } from "./routes/purchases.routes";
import { purchaseReturnsRouter } from "./routes/purchase-returns.routes";
import { rolesRouter } from "./routes/roles.routes";
import { posSalesRouter } from "./routes/pos-sales.routes";
import { promotionsRouter } from "./routes/promotions.routes";
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
import { themesRouter } from "./routes/themes.routes";

const app = express();
const allowedOrigins = env.CORS_ORIGIN.split(",").map(origin => origin.trim()).filter(Boolean);
const publicCategoriesOnly = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.method === "GET") return next();
  res.status(404).json({ success: false, message: "Not found" });
};
const publicProductsOnly = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const isFavorite = /^\/\d+\/favorites\/?$/.test(req.path) && ["POST", "DELETE"].includes(req.method);
  if (req.method === "GET" || isFavorite) return next();
  res.status(404).json({ success: false, message: "Not found" });
};
const publicCheckoutOnly = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.method === "POST" && (req.path === "/" || req.path === "")) return next();
  res.status(404).json({ success: false, message: "Not found" });
};
const publicBrandsOnly = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.method === "GET") return next();
  res.status(404).json({ success: false, message: "Not found" });
};

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
app.use("/uploads/blog", express.static(path.resolve("uploads", "blogs")));
app.use("/uploads/supplier", express.static(path.resolve("uploads", "suppliers")));
app.use("/uploads/customer", express.static(path.resolve("uploads", "customers")));
app.use("/uploads/employee", express.static(path.resolve("uploads", "employees")));
app.use("/uploads/product", express.static(path.resolve("uploads", "products")));
app.use("/uploads/promotion", express.static(path.resolve("uploads", "promotions")));
app.use("/uploads", express.static(path.resolve("uploads")));

app.get("/health", (_req, res) => {
  res.status(200).json({ success: true, message: "ReadyEcommerce API is healthy" });
});

app.use("/auth", authRouter);
app.use("/", customerAuthRouter);
// Public shop endpoints. Management operations are only available below /admin.
app.use("/categories", publicCategoriesOnly, categoriesRouter);
app.use("/products", publicProductsOnly, productsRouter);
app.use("/brands", publicBrandsOnly, brandsRouter);
app.use("/blogs", publicCategoriesOnly, blogsRouter);
app.use("/", promotionsRouter);
app.use("/contact-us", publicCategoriesOnly, contactUsRouter);
app.use("/orders", publicCheckoutOnly, ecommerceOrdersRouter);
app.use("/themes", themesRouter);
app.use("/storefront", themesRouter);
app.use("/customer", customerDashboardRouter);
app.use("/dashboard", customerDashboardRouter);

// Every management API is protected at the prefix, including operational read routes.
app.use("/admin", requireAuth, requireAdmin);
app.use("/admin/accounts", accountsRouter);
app.use("/admin/brands", brandsRouter);
app.use("/admin/blogs", blogsRouter);
app.use("/admin", promotionsRouter);
app.use("/admin/colors", colorsRouter);
app.use("/admin/contact-us", contactUsRouter);
app.use("/admin/customers", customersRouter);
app.use("/admin/dashboard", dashboardRouter);
app.use("/admin/employees", employeesRouter);
app.use("/admin/orders", ecommerceOrdersRouter);
app.use("/admin/products", productsRouter);
app.use("/admin/purchases", purchasesRouter);
app.use("/admin/purchase-returns", purchaseReturnsRouter);
app.use("/admin/roles", rolesRouter);
app.use("/admin/pos-sales", posSalesRouter);
app.use("/admin/categories", categoriesRouter);
app.use("/admin/subcategories", subcategoriesRouter);
app.use("/admin/sizes", sizesRouter);
app.use("/admin/stock-adjustments", stockAdjustmentsRouter);
app.use("/admin/stock-reports", stockReportsRouter);
app.use("/admin/sales-returns", salesReturnsRouter);
app.use("/admin/units", unitsRouter);
app.use("/admin/suppliers", suppliersRouter);
app.use("/admin/warehouses", warehousesRouter);
app.use("/admin/warehouse-requisitions", warehouseRequisitionsRouter);
app.use("/admin/warehouse-transfers", warehouseTransfersRouter);
app.use("/admin/themes", themesRouter);
app.use("/admin/uploads", uploadsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

// Railway assigns PORT. 0.0.0.0 accepts traffic from Railway's public proxy.
app.listen(env.PORT, "0.0.0.0", () => {
  console.log(`ReadyEcommerce API listening on port ${env.PORT}`);
});
