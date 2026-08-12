# ReadyEcommerce backend

This is a TypeScript + Express + MySQL API. TypeScript adds type checks to JavaScript; Express maps an HTTP method and URL to a handler; MySQL stores permanent data.

## First run

1. Copy `.env.example` to `.env`, then set your MySQL credentials and two long, different JWT secrets. Keep `.env` private.
2. Run `npm run migrate`. A **migration** is a versioned SQL file: it creates the tables once and records its filename in the `migrations` table.
3. Set the `ADMIN_*` values in `.env`, then run `npm run create:admin`.
4. Start the server with `npm run dev`. Test `GET http://localhost:5000/health`. This command compiles TypeScript into `dist/` and then runs it.

## Project map

- `src/server.ts` assembles Express, routes, and central error handling.
- `src/config/db.ts` creates the MySQL connection pool.
- `src/routes/` contains the HTTP endpoint handlers.
- `src/middleware/auth.ts` reads `Authorization: Bearer <accessToken>` and protects admin write operations.
- `migrations/001_initial_schema.sql` defines the database tables.

## Frontend CORS

Browsers can call the API only from origins in `CORS_ORIGIN`. Locally, it defaults to `http://localhost:5173` (Vite's usual development URL). In Railway, set `CORS_ORIGIN` to your deployed frontend URL. For more than one frontend, separate URLs with commas, for example `https://shop.example.com,https://admin.example.com`.

## Authentication flow

`POST /auth/admin/login` with `{ "email", "password" }` returns an access token (1 hour) and refresh token (7 days). Send the access token in `Authorization: Bearer ...` for `/auth/me` and all protected writes. When the access token expires, send the refresh token to `/auth/refresh`; it returns a new pair and invalidates the old refresh token. `/auth/logout` revokes the submitted refresh token.

`/auth/forgot-password` deliberately returns the same message for any email so attackers cannot discover registered accounts. In development it also returns `developmentResetToken`; production should email that value in a reset link. Send `{ "token", "password" }` to `/auth/reset-password`.

## Category requests

Create a category (admin token required):

```http
POST /categories
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "name": "Electronics", "slug": "electronics", "image": "category-image.jpg", "banner": "category-banner.jpg", "order": 0, "description": "Electronic devices and accessories", "isActive": true }
```

Subcategories use the same fields plus `categoryId`. `GET /subcategories?categoryId=1` filters by category. Read endpoints are public; create, update, and delete endpoints require an admin token.

## Category image upload

Create a category with one `multipart/form-data` request: send `POST /categories` with text fields `name`, `slug`, optional `banner`, `order`, `description`, and `isActive`, plus an `image` **File** field and an admin access token. The backend saves the file, then stores its generated filename. `POST /uploads/categories` is also available when you want to upload first and later send the returned filename as `image` or `banner` in category JSON. Uploaded images are served at `/uploads/category/<filename>`.

Local files are stored in `uploads/categories`. On Railway, attach a persistent Volume at `/app/uploads`, otherwise uploads are removed on the next deployment.

Subcategories work the same way: submit `POST /subcategories` as `multipart/form-data` with `categoryId`, `name`, `slug`, optional `isActive`, and an `image` File. Files are saved in `uploads/subcategories`.

## Brand requests

`GET /brands` and `GET /brands/:id` are public. Admin-only CRUD uses `POST`, `PATCH`, and `DELETE` on `/brands`. A brand accepts `name`, a lowercase `slug`, optional `logoUrl`, optional `description`, and optional `isActive`.

Create a brand with `multipart/form-data`: send `name`, `slug`, optional `description`, optional `isActive`, and an `image` File to `POST /brands`. Brand images are saved in `uploads/brands`.

## Color, size, and unit requests

Each module has standard CRUD at `/colors`, `/sizes`, and `/units`. Reads are public; create, update, and delete require an admin access token. Colors accept `{ "name": "Red", "code": "#FF0000", "isActive": true }`; sizes and units accept `{ "name": "S", "isActive": true }` and `{ "name": "KG", "isActive": true }`.

## Product requests

Products use `/products` CRUD. Upload files first using `POST /uploads/products` as `multipart/form-data`, with up to five `thumbnailImages` files and five `additionalImages` files. Use the returned filenames in `thumbnailImages` and `additionalImages` when creating the product. A product can have multiple `colorIds` and `sizeIds`; `categoryId` is required and `subcategoryId` must belong to that category. List filters: `?categoryId=1&subcategoryId=2&brandId=1&colorId=1&sizeId=1`.

## Supplier, warehouse, and purchase requests

Suppliers and warehouses each provide CRUD at `/suppliers` and `/warehouses`. `GET /warehouses/:id/stocks` returns current stock in a selected warehouse. Create a received purchase with `POST /purchases`; it accepts one supplier, one warehouse, and an `items` array of products. It increases the warehouse stock and total product stock in one database transaction. Purchases are audit records: use `PATCH /purchases/:id/cancel` to reverse a received purchase rather than deleting it.

## Purchase return requests

Purchase returns use `/purchase-returns`. Create a return from the original `purchaseId` with product quantities and a reason. The API derives the supplier and warehouse from the original purchase, rejects quantities greater than the received-minus-previously-returned amount, and reduces stock. Use `PATCH /purchase-returns/:id/cancel` to restore stock if a return is cancelled.

## Customer requests

Customer data is private, so every `/customers` endpoint requires an admin access token. Standard CRUD is available and `GET /customers?search=phone-or-name` supports customer selection in POS and order screens.

## Warehouse requisition and transfer requests

Create a stock request at `/warehouse-requisitions`, then approve it and create a linked draft `/warehouse-transfers` record using its `requisitionId`. Ship a transfer to remove stock from the source warehouse; receive it to add stock to the destination warehouse. Total product stock does not change during a transfer because the stock only moves between warehouses.

## Stock adjustment and report requests

Create an audited stock correction with `POST /stock-adjustments`; each item has a positive `quantityChange` for found/extra stock or a negative quantity for damaged/lost stock. `GET /stock-reports?warehouseId=1&productId=1&dateFrom=2026-08-01&dateTo=2026-08-31` returns current stock balances and all matching stock movements.

## POS sales and sales history

All `/pos-sales` endpoints require an admin access token. Create a completed counter sale with `POST /pos-sales`. It reduces the selected warehouse's stock and the product's total stock in one database transaction. `customerId` is optional; send `null` for a walk-in customer. Read sales history with `GET /pos-sales`, optionally filtering by `warehouseId`, `customerId`, `status`, `dateFrom`, and `dateTo`. Use `PATCH /pos-sales/:id/cancel` only to void the complete sale; it restores all of the sale's stock. A partial customer return will be handled separately as a sales-return module.

## E-commerce orders

`POST /ecommerce-orders` is public and intended for the shop frontend checkout. It accepts the customer's contact and shipping details, creates or updates the customer by phone number, and creates a `pending` order. The request sends only product IDs and quantities: the server reads selling prices from the database, which prevents browser price tampering. It reserves stock immediately from the selected `warehouseId`, so the same stock cannot also be sold through POS. The admin order list is `GET /ecommerce-orders`; filter with `warehouseId`, `customerId`, `status`, `paymentStatus`, `dateFrom`, or `dateTo`. Admins can see one order at `GET /ecommerce-orders/:id` and update operational/payment state at `PATCH /ecommerce-orders/:id/status`. Changing an order to `cancelled` returns its reserved stock.

## Sales returns

Sales returns use `/sales-returns` and require an admin access token. `POST /sales-returns` accepts either a completed `pos_sale` or delivered `ecommerce_order`, then restores the returned products to the original warehouse. It prevents returning more than the original sold quantity across all prior completed returns. Use `GET /sales-returns` for history and `PATCH /sales-returns/:id/cancel` to reverse an accidental return only when the returned stock remains available.

## Employee requests

Employee management uses admin-only CRUD at `/employees`. Creating or updating an employee accepts JSON or `multipart/form-data`; when uploading a photo, use an `image` File field. An employee has `firstName`, optional `lastName`, `phone`, optional `gender`, `email`, `role` (job designation such as `Cashier` or `Manager`), `password`, and optional `isActive`. Passwords are bcrypt-hashed and never returned by any API. `DELETE /employees/:id` is a safe deactivation, not a database delete. Employees log in with `POST /auth/employee/login`; their system access role is `employee`, so they cannot use admin-only APIs without a future permission module.

## Dashboard and favorites

`GET /dashboard` is admin-only and returns total active employees, products, warehouses, e-commerce orders, customers, all order-status counters, top-selling products, and most-favorited products. Optional dashboard date filtering uses `?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD`. The order workflow supports `pending`, `confirm` (stored as `confirmed`), `processing`, `pickup`, `on_the_way`, `delivered`, and `cancelled`. The public shop can add/remove favorites with `POST /products/:id/favorites` body `{ "customerId": 1 }` and `DELETE /products/:id/favorites?customerId=1`; this feeds the dashboard favorite ranking.
