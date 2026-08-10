# ReadyEcommerce backend

This is a TypeScript + Express + MySQL API. TypeScript adds type checks to JavaScript; Express maps an HTTP method and URL to a handler; MySQL stores permanent data.

## First run

1. Copy `.env.example` to `.env`, then set your MySQL credentials and two long, different JWT secrets. Keep `.env` private.
2. Run `npm run migrate`. A **migration** is a versioned SQL file: it creates the tables once and records its filename in the `migrations` table.
3. Set the `ADMIN_*` values in `.env`, then run `npm run create:admin`.
4. Start the development server with `npm run dev`. Test `GET http://localhost:5000/health`.

## Project map

- `src/server.ts` assembles Express, routes, and central error handling.
- `src/config/db.ts` creates the MySQL connection pool.
- `src/routes/` contains the HTTP endpoint handlers.
- `src/middleware/auth.ts` reads `Authorization: Bearer <accessToken>` and protects admin write operations.
- `migrations/001_initial_schema.sql` defines the database tables.

## Authentication flow

`POST /auth/admin/login` with `{ "email", "password" }` returns an access token (15 minutes) and refresh token (7 days). Send the access token in `Authorization: Bearer ...` for `/auth/me` and all category/subcategory writes. When the access token expires, send the refresh token to `/auth/refresh`; it returns a new pair and invalidates the old refresh token. `/auth/logout` revokes the submitted refresh token.

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
