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

{ "name": "Electronics", "slug": "electronics", "imageUrl": "https://example.com/electronics.jpg", "isActive": true }
```

Subcategories use the same fields plus `categoryId`. `GET /subcategories?categoryId=1` filters by category. Read endpoints are public; create, update, and delete endpoints require an admin token.

## Category image upload

Create a category with one `multipart/form-data` request: send `POST /categories` with text fields `name`, `slug`, and optional `isActive`, plus an `image` **File** field and an admin access token. The backend saves the file, then stores its generated filename. `POST /uploads/categories` is also available when you want to upload first and later send the returned filename as `image` in category JSON. Uploaded images are served at `/uploads/category/<filename>`.

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
