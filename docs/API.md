# API (Phase 1)

Base path: `/api`. All responses are JSON. Errors follow:

```json
{ "error": { "code": "SOME_CODE", "message": "Human-readable message" } }
```

## Endpoints implemented in Phase 1

| Method | Path                                 | Auth           | Permission     | Description                                                                                          |
| ------ | ------------------------------------ | -------------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| GET    | `/api/health`                        | none           | -              | Liveness check (no DB access - see note below)                                                       |
| POST   | `/api/auth/login`                    | none           | -              | Login with `{ loginId, password }`; sets an httpOnly refresh cookie, returns `{ accessToken, user }` |
| POST   | `/api/auth/refresh`                  | refresh cookie | -              | Rotates the refresh token, returns a new `{ accessToken }`                                           |
| POST   | `/api/auth/logout`                   | refresh cookie | -              | Revokes the session, clears the cookie                                                               |
| GET    | `/api/users/:id/login-id/edit-state` | bearer token   | -              | Returns `{ editable, label }` - `label` is `"Login ID: LOCKED"` when not editable                    |
| PATCH  | `/api/users/:id/login-id`            | bearer token   | `users.manage` | Changes a user's Login ID, enforcing the full ownership/tenant policy                                |

Everything else in the product spec (Master Admin client-creation, POS,
products, purchases, inventory, reports, etc.) is scoped to later phases -
see `docs/RELEASE.md`.

## Authentication

- `POST /api/auth/login` returns a short-lived JWT **access token** (default
  15 minutes) in the response body, and sets a long-lived, httpOnly, `SameSite=
Lax` **refresh token** cookie (default 14 days) scoped to `/api/auth`.
- The access token is sent as `Authorization: Bearer <token>` on every
  subsequent request. It embeds the caller's `tenantId`, `systemRole`, and a
  snapshot of their permission keys (bounded staleness = the access-token
  TTL).
- `POST /api/auth/refresh` reads the cookie, verifies the session is still
  valid (not revoked, not expired, user still active, tenant still active),
  and **rotates** the refresh token (issues a new one, invalidates the old).
- `POST /api/auth/logout` revokes the session server-side.

## Authorization (RBAC)

Every protected route runs `requireAuth` (verifies the JWT) then, where
needed, `requirePermission('resource.action', ...)`. Permission checks are
enforced **only** on the server (`apps/api/src/http/middleware/require-
permission.ts`) - there is no code path where a route trusts a frontend-only
check. See `packages/shared/src/permissions.ts` for the full permission
catalog and default per-role grants.

## Tenant isolation

Tenant scoping happens at three layers (token, service, database) - see
`docs/ARCHITECTURE.md`. The Login ID endpoints are the concrete, tested
example in Phase 1: a Tenant A Client Master Admin holding `users.manage`
still receives `403 LOGIN_ID_TENANT_SCOPE` when targeting a Tenant B user -
proven in `apps/api/tests/http/app.test.ts`.

## Error codes

Defined centrally in `packages/shared/src/errors.ts`. Notable ones:
`INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`, `ACCOUNT_DISABLED`,
`TENANT_SUSPENDED`, `SESSION_REVOKED`, `PERMISSION_DENIED`,
`LOGIN_ID_SELF_EDIT_FORBIDDEN`, `LOGIN_ID_CHANGE_FORBIDDEN`,
`LOGIN_ID_TENANT_SCOPE`, `LOGIN_ID_TAKEN`, `LOGIN_ID_INVALID`,
`VALIDATION_ERROR`, `RATE_LIMITED`, `INTERNAL_ERROR`.

## Note on `/api/health`

Deliberately does not touch the database, so it stays meaningful as a process
liveness signal even in this sandbox where Prisma Client generation is
currently blocked. A `/health`-with-DB-ping variant should be added once
Prisma access is restored (see `docs/TROUBLESHOOTING.md`).

## Phase 2: Master Admin API

Base path: `/api/master`. Every route in this section requires, in order:

1. `requireAuth` - a valid access token.
2. `requirePlatformActor` - the token must genuinely be `systemRole: MASTER_ADMIN` with `tenantId: null`. This runs in addition to (not instead of) permission checks, specifically to stop privilege escalation if a permission were ever mis-granted to a tenant role - see `src/http/middleware/require-platform-actor.ts`.
3. `requirePermission('resource.action')` using the same central catalog from Phase 1 (`@mafk/shared`) - no permission keys are duplicated or redefined here.

| Method | Path                                  | Permission        | Description                                                                                                                |
| ------ | ------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/master/stats`                       | `tenants.view`    | Platform dashboard counters (tenants, licenses, users, DB health) - all real, computed, non-fabricated                     |
| GET    | `/master/tenants`                     | `tenants.view`    | Paginated, searchable, status-filterable tenant list                                                                       |
| POST   | `/master/tenants`                     | `tenants.create`  | Transactional client creation: Tenant + default Store + 4 default Roles + Client Master Admin + License, or nothing at all |
| GET    | `/master/tenants/:id`                 | `tenants.view`    | Tenant detail                                                                                                              |
| PATCH  | `/master/tenants/:id`                 | `tenants.edit`    | Update tenant profile fields                                                                                               |
| PATCH  | `/master/tenants/:id/status`          | `tenants.approve` | Activate/suspend/archive - suspending/archiving revokes every session for that tenant's users immediately                  |
| GET    | `/master/tenants/:id/stores`          | `tenants.view`    | Tenant's branches                                                                                                          |
| GET    | `/master/tenants/:id/users`           | `users.view`      | Tenant's users                                                                                                             |
| GET    | `/master/tenants/:id/audit-logs`      | `audit.view`      | Tenant's audit trail                                                                                                       |
| POST   | `/master/tenants/:id/client-admins`   | `users.manage`    | Create an ADDITIONAL Client Master Admin for an existing tenant                                                            |
| GET    | `/master/licenses`                    | `licenses.view`   | All licenses, platform-wide                                                                                                |
| GET    | `/master/tenants/:id/licenses`        | `licenses.view`   | A tenant's licenses                                                                                                        |
| POST   | `/master/tenants/:id/licenses`        | `licenses.manage` | Issue a new license to a tenant                                                                                            |
| PATCH  | `/master/licenses/:licenseId`         | `licenses.manage` | Update plan/limits/expiry                                                                                                  |
| PATCH  | `/master/licenses/:licenseId/status`  | `licenses.manage` | Activate/suspend/revoke                                                                                                    |
| PATCH  | `/master/licenses/:licenseId/modules` | `licenses.manage` | Module Management - which tenant modules this license enables                                                              |
| PATCH  | `/master/users/:id/status`            | `users.manage`    | Enable/disable any user - revokes sessions on disable                                                                      |
| POST   | `/master/users/:id/reset-password`    | `users.manage`    | Secure admin-driven password reset - revokes every existing session for that user immediately                              |

### License status

Every read resolves the EFFECTIVE status via `@mafk/shared`'s `resolveLicenseStatus` (see `docs/DATABASE.md`) - a stored `ACTIVE` row past its `expiresAt` is always reported as `EXPIRED`, everywhere, including the dashboard stats and every tenant/license read path. Nothing computes this independently on the frontend.

### Module gating

A License's `enabledModules` array is the single source of truth for which tenant-facing modules (`pos`, `sales`, `inventory`, ...) that tenant may use. `src/rbac/modules.ts`'s `hasModuleAccess` is the enforcement point every future tenant-resource route (POS, purchases, reports, ...) must call server-side before acting - module gating is never "hide the nav item and hope." No tenant-resource routes exist yet in Phase 2 to _call_ it (Phase 2 is Master-Admin-only), so this is documented as an enforcement point ready for Phase 3+, not yet exercised by a live route - it IS unit-tested directly (`tests/unit/master-admin-rbac.test.ts`).

## Phase 3: Catalog & Inventory API

Base paths: `/api/catalog/*`, `/api/inventory/*`, `/api/stores`. Every route
requires `requireAuth` + `requireTenant` (these are genuinely tenant-scoped
routes - a Master Admin token, which carries no `tenantId`, is 403'd with
`TENANT_REQUIRED`) + the relevant permission from the existing central
catalog (`@mafk/shared` - nothing new was added to it; Phase 1 already
defined `categories.*`, `sub_departments.*`, `brands.*`, `products.*`,
`inventory.*`, `barcode.*`, and `stock.adjust`).

| Method    | Path                              | Permission                         | Description                                                                                                         |
| --------- | --------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| GET       | `/catalog/categories`             | `categories.view`                  | List/search/filter                                                                                                  |
| POST      | `/catalog/categories`             | `categories.create`                | Create                                                                                                              |
| GET/PATCH | `/catalog/categories/:id`         | `categories.view` / `.edit`        | Detail / update                                                                                                     |
| PATCH     | `/catalog/categories/:id/status`  | `categories.edit`                  | Activate/deactivate                                                                                                 |
| GET/POST  | `/catalog/sub-departments`        | `sub_departments.view` / `.create` | List (optionally by `categoryId`) / create - **rejects a Category that doesn't exist or belongs to another tenant** |
| GET/PATCH | `/catalog/sub-departments/:id`    | `sub_departments.view` / `.edit`   | Detail / update                                                                                                     |
| GET/POST  | `/catalog/brands`                 | `brands.view` / `.create`          | List / create                                                                                                       |
| GET/POST  | `/catalog/products`               | `products.view` / `.create`        | List/search/filter/paginate / create - **rejects a Sub-Department that doesn't belong to the given Category**       |
| GET       | `/catalog/products/export`        | `products.export`                  | CSV export, this tenant only                                                                                        |
| POST      | `/catalog/products/import`        | `products.create`                  | CSV import - see "Import semantics" below                                                                           |
| GET/PATCH | `/catalog/products/:id`           | `products.view` / `.edit`          | Detail / update (re-validates the Category/Sub-Department pair if either changes)                                   |
| GET       | `/catalog/barcode/:code`          | `barcode.view`                     | Barcode → product lookup                                                                                            |
| GET       | `/inventory`                      | `inventory.view`                   | Stock levels, filterable by store/search/stock status, paginated                                                    |
| GET       | `/inventory/low-stock`            | `inventory.view`                   | Only `LOW_STOCK`/`OUT_OF_STOCK` rows - every count is a real repository read                                        |
| GET       | `/inventory/:productId/movements` | `inventory.view`                   | Traceable movement history for one product                                                                          |
| POST      | `/inventory/opening-stock`        | `inventory.create`                 | One-time initial quantity                                                                                           |
| POST      | `/inventory/adjust`               | `stock.adjust`                     | The only manual stock-correction path - rejects a change that would take quantity below zero                        |
| GET       | `/stores`                         | `stores.view`                      | The caller's own tenant's branches (distinct from the Master Admin's cross-tenant store view)                       |

### Category → Sub-Department → Product relationship

Enforced at three layers, same pattern as Phase 1/2's tenant isolation:

1. **Service layer** (`ProductService.requireConsistentCategory`,
   `SubDepartmentService.requireCategory`) - a friendly 422
   `VALIDATION_ERROR` before anything is written, verified against both the
   real Prisma adapter's future behavior and the in-memory fakes (which have
   no real foreign keys, so this check is the ONLY thing protecting them).
2. **Database schema** (`Product` has a second composite foreign key
   `(subDepartmentId, categoryId) → SubDepartment(id, categoryId)` - see
   `docs/DATABASE.md`, unchanged from Phase 1).
3. **Frontend UX** (`apps/web`'s Product form clears an incompatible
   Sub-Department the moment the Category changes) - explicitly the LAST
   layer, not the only one.

### Import semantics (CSV)

Documented explicitly per the spec's requirement: each row is validated and
imported independently. A row with a validation error (bad category, duplicate
SKU/barcode, invalid price, etc.) is rejected and reported with its row number
and every error found - it never blocks the other rows in the same file.
The import is therefore **not** a single all-or-nothing transaction across the
whole file (a 500-row file with one bad row still imports 499) - each row's
own creation is atomic (one `ProductService.create` call), and the response
always reports `totalRows` / `successCount` / `failedCount` / `rowErrors` so
the caller never has to guess what happened. See `product-import.service.ts`'s
doc comment for the full rationale.

### Inventory movement transactionality

Every stock-changing call goes through one repository method,
`InventoryRepository.applyMovement`, which reads the current quantity,
computes the new one, writes the `Inventory` row, and writes the
`InventoryMovement` row as a single atomic unit (a Prisma `$transaction` in
the real adapter; a single synchronous function in the in-memory fake - see
`docs/ARCHITECTURE.md`). A decrease that would take quantity below zero is
rejected with `InsufficientStockError` → HTTP 409, before anything is
written.

## Phase 4: Suppliers & Purchases API

All routes require authentication and a tenant context; permissions come from the
central catalog (`packages/shared/src/permissions.ts`) - no new permissions were added.

| Method & path                        | Permission         | Notes                                                                                                                                              |
| ------------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/suppliers?search=`         | `suppliers.view`   | Tenant-scoped.                                                                                                                                     |
| `POST /api/suppliers`                | `suppliers.create` | 409 on duplicate name within the tenant. Audited.                                                                                                  |
| `GET /api/purchases`                 | `purchases.view`   | Filters: `search`, `supplierId`, `storeId`, `paymentStatus`; paginated.                                                                            |
| `POST /api/purchases`                | `purchases.create` | **Record Purchase** - one atomic repository call. 201 + saved purchase.                                                                            |
| `GET /api/purchases/:id`             | `purchases.view`   | Saved purchase with items. 404 for another tenant's id.                                                                                            |
| `GET /api/purchases/:id/invoice`     | `purchases.view`   | Invoice built from saved records (business, branch, supplier, creator, items, paid, outstanding). Used for the auto-open, view, print and reprint. |
| `GET /api/purchases/:id/invoice.pdf` | `purchases.print`  | Real A4 PDF (pdfkit) from the saved purchase. Audited (`PURCHASE_INVOICE_PDF_EXPORTED`).                                                           |
| `POST /api/purchases/:id/payments`   | `purchases.edit`   | Records a supplier payment. 409 if it exceeds the outstanding balance.                                                                             |

Purchases are **not editable after recording** (editing would have to reverse stock
movements and rewrite financial records). Corrections go through payments now, and a
Purchase Return flow in a later phase. This is the documented "edit where safe" decision.

### Request body for `POST /api/purchases`

`supplierId`, `storeId`, `invoiceNo`, `purchaseDate`, `items[]` (`productId`, `quantity`,
`costPrice`, `taxRate` default `0`, and optionally ONE of `discountPercent` / `discountAmount`),
optional purchase-level `discountPercent` / `discountAmount` (again one of), and optional
`initialPayment { amount, method }`. All money/quantities are decimal **strings**.

### Discount rules

Percentage and fixed-amount discounts are mutually exclusive per line and for the
purchase as a whole (422 if both are non-zero) - this prevents accidental double
discounting. The applied discount is stored and displayed in both forms (the unused one
is derived/normalised). The purchase-level discount applies to the subtotal after line
discounts; tax is calculated per line on the discounted line amount.

### Money & rounding (single implementation: `packages/shared/src/purchase-math.ts`)

All amounts are exact decimal strings (BigInt fixed point, never JS floats). Scale 2,
**half-up**, rounded once per step:

1. gross = quantity x cost, rounded to 2dp
2. line discount = gross x % (rounded) or the fixed amount; net = gross - discount (must be >= 0)
3. line tax = net x tax% (rounded); line total = net + tax
4. subtotal = sum of gross; purchase discount applies to (subtotal - line discounts)
5. grand total = (subtotal - all discounts) + sum of line tax
6. payments are normalised to 2dp; outstanding = total - paid

The web form's live preview imports these same functions, so preview and server agree;
the server recomputes and stores the authoritative values.

### Duplicate-submission strategy

A purchase is unique per `(tenant, supplier, invoiceNo)`. A retried or double-clicked
submission therefore gets 409 `CONFLICT` and cannot double-count stock; the DB enforces
it with a unique constraint and the service pre-checks for a friendly message. The UI
also disables the button while submitting.

### Transaction & inventory behaviour

`PurchaseRepository.recordPurchase` is a single port method. The Prisma adapter runs, in
one `$transaction`: validate supplier/branch/products in tenant -> reject duplicate invoice
-> create Purchase + PurchaseItems -> claim `PO-nnnnnn` from `DocumentSequence` -> for each
line increase branch Inventory and write an `InventoryMovement` of type `PURCHASE`
(`referenceType='Purchase'`, `referenceId=<purchase id>`) -> optional SupplierPayment. Any
failure rolls everything back. The Prisma adapter and `InventoryRepository.applyMovement`
share one stock function (`applyMovementInTx`). The in-memory test double models the same
all-or-nothing behaviour; only the real-PostgreSQL contract run proves it. **Prisma adapter: NOT VERIFIED - Prisma
engine CDN blocked by environment.**

Audit actions: `SUPPLIER_CREATED`, `PURCHASE_RECORDED`, `PURCHASE_PAYMENT_RECORDED`,
`PURCHASE_INVOICE_PDF_EXPORTED`. For `PURCHASE_RECORDED` and `PURCHASE_PAYMENT_RECORDED` the
audit row is written INSIDE the same transaction as the purchase, stock, movements and
payment (Phase 4.1): if the audit write fails, everything rolls back. Concurrent payments
that lose the optimistic-concurrency check return 409. Purchase numbers are per branch.

### Create product inside a purchase

The Purchase screen's "+ Create New Product" opens the shared `ProductForm` (also used by the
Products page) as a dialog. It calls the existing `POST /api/catalog/products` - no product
business logic is duplicated - then appends the new product as a line on the open purchase.
The purchase state lives in `PurchaseForm`, which the dialog never unmounts.

## Phase 4.2: `GET /api/auth/me`

Requires a Bearer access token. Returns `200 {"user": {id, tenantId, loginId, displayName, systemRole}}` (never the
password hash) or `401` when the token is missing/invalid or the user is disabled/removed. Used by the web app to restore
a session after a page reload (refresh cookie -> `POST /api/auth/refresh` -> `GET /api/auth/me`).

## Phase 5: POS, sales, refunds, receipts

Details and rules: `docs/POS.md`. All routes need a tenant token; permissions are enforced on the server.

| Method & path                             | Permission           | Notes                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/pos/products?storeId=&search=`  | `pos.view`           | Barcode exact match first, then name/SKU; each with branch `stock`.                                                                                                                                                                                                                                                          |
| `POST /api/sales`                         | `pos.create`         | Body: `clientRequestId`, `storeId`, `items[{productId,quantity,unitPrice?,discountPercent?\|discountAmount?}]`, `discountPercent?\|discountAmount?`, `payments[{method,amount,reference?}]`, `customerName?`, `customerPhone?`, `notes?`. `201` new sale; `200` + `Idempotent-Replayed: true` when the key was already used. |
| `GET /api/sales`                          | `sales.view`         | Filters: `search`, `storeId`, `status`, `from`, `to`, `page`, `pageSize`.                                                                                                                                                                                                                                                    |
| `GET /api/sales/:id`                      | `sales.view`         | Items (with `returnedQuantity`), payments, refunds.                                                                                                                                                                                                                                                                          |
| `GET /api/sales/:id/receipt?format=`      | `sales.print`        | `58mm` \| `80mm` (default) \| `a4`. `{format, receipt, text}`; `text` is null for A4.                                                                                                                                                                                                                                        |
| `GET /api/sales/:id/receipt.pdf?format=`  | `sales.print`        | Real PDF; audited as `RECEIPT_PRINTED`.                                                                                                                                                                                                                                                                                      |
| `POST /api/sales/:id/returns`             | `sale.refund`        | Body: `items[{saleItemId,quantity}]`, `refundMethod` (CASH\|CARD\|BANK_TRANSFER), `reason?`.                                                                                                                                                                                                                                 |
| `GET /api/sale-returns/:id`               | `sale_returns.view`  |                                                                                                                                                                                                                                                                                                                              |
| `GET /api/sale-returns/:id/receipt[.pdf]` | `sale_returns.print` | Refund slip, same formats.                                                                                                                                                                                                                                                                                                   |

Error codes added: `INSUFFICIENT_STOCK` (409), `PAYMENT_INSUFFICIENT` (422), `RETURN_NOT_ALLOWED` (409). Money values are
decimal strings with 2 decimals; quantities have 3. Discounts need `discount.apply` (403), a non-catalogue price needs `price.change` (403).
`CUSTOMER_CREDIT` is rejected (422) until the Phase 6 customer ledger.

## Phase 6: customers, expenses, employees, reports, analytics, supplier ledger

All routes need a tenant token. Permissions in brackets. Validation failures are `422`; cross-tenant ids are `404`.

| Method & path                                                                                                              | Permission                                  | Notes                                                                                |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `GET/POST /customers`                                                                                                      | `customers.view` / `customers.create`       | `creditLimit` and `openingBalance` on create need `customers.edit` (403 otherwise)   |
| `GET/PATCH /customers/:id`                                                                                                 | `customers.view` / `customers.edit`         | balance is derived                                                                   |
| `GET /customers/:id/ledger`                                                                                                | `customers.view`                            | running balance                                                                      |
| `POST /customers/:id/payments`                                                                                             | `customers.edit`                            | `409 PAYMENT_EXCEEDS_BALANCE`                                                        |
| `POST /sales` (changed)                                                                                                    | `pos.create`                                | optional `customerId`; payment method `CUSTOMER_CREDIT`; `409 CREDIT_LIMIT_EXCEEDED` |
| `POST /sales/:id/returns` (changed)                                                                                        | `sale.refund`                               | `refundMethod: CUSTOMER_CREDIT` needs a sale with a customer                         |
| `GET /suppliers/:id/ledger`                                                                                                | `suppliers.view`                            | `POST /suppliers` accepts `openingBalance`                                           |
| `GET/POST /expenses`, `GET/PATCH/DELETE /expenses/:id`                                                                     | `expenses.view/create/edit/delete`          | list returns `totalAmount` over all matches                                          |
| `GET/POST /employees`, `GET/PATCH /employees/:id`                                                                          | `employees.view/create/edit`                | salary & national ID only with `employees.edit`                                      |
| `GET /reports/{sales-summary,daily,hourly,top-products,by-cashier,by-category,profit-loss}?from&to[&storeId][&format=csv]` | `reports.view` (+ `reports.export` for CSV) | days in the tenant time zone, max 366                                                |
| `GET /reports/{stock-valuation,receivables,payables}[?format=csv]`                                                         | `reports.view`                              |                                                                                      |
| `GET /analytics/overview?from&to`                                                                                          | `analytics.view`                            | includes the previous period                                                         |

Rules and definitions: `docs/PHASE-6.md`.
