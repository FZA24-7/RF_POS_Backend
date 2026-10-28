# Testing

## 1. VERIFIED TESTS (actually executed, passing, in this environment)

These require **no database and no generated Prisma Client**. They run
against pure logic and, for the HTTP layer, an in-memory repository
implementation of the same interfaces the real Prisma adapters implement (see
`docs/ARCHITECTURE.md` → "Ports and adapters"). This is a standard
dependency-injection testing pattern - it is not a substitute for real
database verification, and it is not presented as one; it verifies the
business logic and HTTP wiring, which is exactly what it can prove.

```bash
pnpm --filter @mafk/shared run test   # 32 tests
pnpm --filter @mafk/api run test       # 33 tests
```

**Result at last run: 65/65 passing (5 test files, 0 failing).**

| File                                           | Count | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/tests/login-id.test.ts`       | 22    | Every Login ID rule from the spec: self-edit forbidden for all four tenant roles _and_ Master Admin; Client Master Admin can edit Manager/Cashier/Inventory Staff in their own tenant; cannot cross tenants; cannot edit another Client Master Admin; Master Admin can reassign any non-Master ID but not another Master's; format validation; the `"Login ID: LOCKED"` UI label                                                                                                                         |
| `packages/shared/tests/permissions.test.ts`    | 10    | Permission catalog has no duplicates; platform permissions can never be granted to a tenant role; least-privilege shape per role (Cashier can't refund/void, Manager can, Inventory Staff can adjust stock but not run the POS, etc.)                                                                                                                                                                                                                                                                    |
| `apps/api/tests/unit/auth.service.test.ts`     | 9     | Login success; unknown Login ID and wrong password both return the same generic error (no user enumeration); per-account lockout after N failures; suspended-tenant login rejected; disabled-user login rejected; login attempts recorded for audit; refresh-token rotation (old token dies, new one works); logout revokes the session                                                                                                                                                                  |
| `apps/api/tests/unit/login-id.service.test.ts` | 12    | Same rule set as the shared-package tests, but exercised through the full service (repository calls, audit log entry, Login ID history entry) rather than the pure policy function alone                                                                                                                                                                                                                                                                                                                 |
| `apps/api/tests/http/app.test.ts`              | 12    | End-to-end over real HTTP (supertest): health check; login success/failure/validation; 401 with no token; 403 with insufficient permission; 403 on self-edit; 200 on an authorized cross-role edit; **403 `LOGIN_ID_TENANT_SCOPE` on a cross-tenant edit attempt that DOES hold the `users.manage` permission** (proves tenant isolation is enforced by the service layer, not just the permission grid); the `edit-state` endpoint's LOCKED/editable label; refresh-token rotation and logout over HTTP |

Run everything with logs:

```bash
pnpm --filter @mafk/shared run test
pnpm --filter @mafk/api run test
```

## 2. PRISMA-DEPENDENT TESTS (cannot currently execute)

None have been written as automated tests yet, because there is no generated
Prisma Client to run them against - writing them now would mean either (a)
they can't run and would misleadingly appear in a test report as "skipped"
rather than "blocked", or (b) they'd need to be faked, which the task
explicitly rules out. Once `pnpm db:generate` and `pnpm db:migrate:dev`
succeed (see `docs/TROUBLESHOOTING.md`), Phase 1's test suite should be
extended with:

- A migration smoke test (`prisma migrate deploy` against
  `TEST_DATABASE_URL`, then assert every table exists).
- Repository-level integration tests for each class in
  `apps/api/src/infra/prisma/repositories.ts`, run against the real
  `mafk_pos_test` database (already created and reachable in this sandbox -
  only Prisma's own engine download is blocked).
- Re-running `apps/api/tests/unit/*` and `apps/api/tests/http/*` a second time
  with the Prisma adapters swapped in for the in-memory fakes (the ports/
  adapters design means this requires no rewrite of the tests' assertions -
  only the composition of `Repositories` passed into each service).

**Do not count anything in this section as passing.** It is a to-do list, not
a result.

## Coverage explicitly NOT yet attempted

- Playwright end-to-end tests (no UI exists yet in Phase 1).
- Load/performance testing.
- Multi-device/multi-session concurrency tests for the Session/refresh-token
  rotation logic (single-session rotation is tested; concurrent-rotation
  reuse-detection is a designed-for-later hardening, not yet implemented -
  see `docs/ARCHITECTURE.md` note in `SessionRepository`).

## Phase 2 additions

**Result at last run: 125/125 tests passing** across the whole repo (45 in `@mafk/shared`, 80 in `@mafk/api`), all DB-independent for the same reason as Phase 1 (see "Ports and adapters" in `docs/ARCHITECTURE.md`) - the Prisma-backed adapters for the new Phase 2 ports (`TenantProvisioningRepository`, `StoreRepository`, `LicenseRepository`, `SystemHealthRepository`) are written in `src/infra/prisma/master-admin-repositories.ts` but remain unverified for the identical reason documented in `docs/TROUBLESHOOTING.md`.

| File                                                      | Count | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/tests/modules.test.ts`                   | 4     | Module catalog integrity and sanitization                                                                                                                                                                                                                                                                                                                                                                                                             |
| `packages/shared/tests/license.test.ts`                   | 9     | Pure license-status resolution - a stale `ACTIVE` flag never beats an expired date; suspended/revoked always win                                                                                                                                                                                                                                                                                                                                      |
| `apps/api/tests/unit/tenant-provisioning.service.test.ts` | 4     | Full atomic client creation; **rollback proof**: a duplicate tenant code or duplicate Login ID leaves the tenant/store/role/user/license maps at their exact prior size - nothing partial survives a failed attempt                                                                                                                                                                                                                                   |
| `apps/api/tests/unit/tenant-management.service.test.ts`   | 9     | List/search/filter, tenant status changes revoke sessions (and only for that tenant - Tenant B is untouched), additional Client Master Admin creation, user disable, admin-driven password reset (including the self-reset refusal)                                                                                                                                                                                                                   |
| `apps/api/tests/unit/license.service.test.ts`             | 6     | Create/update/status/module changes, all audited; effective-status resolution on read                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/api/tests/unit/dashboard-stats.service.test.ts`     | 5     | Every counter is arithmetic over the seeded scenario - changing seeded data changes the numbers; no fabricated metric                                                                                                                                                                                                                                                                                                                                 |
| `apps/api/tests/unit/master-admin-rbac.test.ts`           | 7     | `requirePlatformActor` rejects a missing/tenant-scoped/role-tenantId-inconsistent token and passes a genuine platform actor; `hasModuleAccess` pure logic                                                                                                                                                                                                                                                                                             |
| `apps/api/tests/http/master-admin.test.ts`                | 16    | End-to-end over real HTTP: every `/api/master/*` route 401s with no token; a Client Master Admin, a Manager, and a Cashier are all 403'd from platform routes; **a forged token claiming `MASTER_ADMIN` while still carrying a `tenantId` is 403'd** (proves the belt-and-suspenders guard, not just the permission grid); full tenant-creation-to-login flow; tenant suspension blocking login; license lifecycle; user disable/reset-password flows |

### Login ID rules re-verified

Every Phase 1 Login ID rule is exercised again in Phase 2's own tests against the SAME shared policy function (`canChangeLoginId`) - nothing was duplicated or re-implemented. The original Phase 1 test files (`apps/api/tests/unit/login-id.service.test.ts`, part of `tests/http/app.test.ts`) were re-run unmodified and still pass (33/33 Phase 1 API tests, unchanged from Phase 1's report).

## Phase 2 PRISMA-DEPENDENT TESTS (still cannot execute)

Everything listed in Phase 1's section 2 remains outstanding, plus, once unblocked:

- Repository integration tests for `PrismaTenantProvisioningRepository.provision` specifically verifying the `$transaction` rollback against real PostgreSQL (the in-memory fake proves the _contract_; only a real DB run proves Prisma's transaction actually rolls back a partial multi-table write).
- `PrismaSystemHealthRepository.checkDatabase()` against a real, and then a deliberately unreachable, database.

## Phase 3 additions

**Result at last run: 208/208 tests passing** across the whole repo (53 in
`@mafk/shared`, 155 in `@mafk/api`), still entirely DB-independent for the
same reason as Phase 1/2.

| File                                                 | Count            | Covers                                                                                                                                                                                                                                                        |
| ---------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/tests/decimal.test.ts`              | 9                | Fixed-point decimal string arithmetic, including the classic `0.1 + 0.2` float trap                                                                                                                                                                           |
| `apps/api/tests/unit/category.service.test.ts`       | 6                | CRUD, duplicate-name rejection, tenant isolation (same name allowed in a different tenant, cross-tenant read blocked)                                                                                                                                         |
| `apps/api/tests/unit/sub-department.service.test.ts` | 7                | Category relationship (unknown category, cross-tenant category both rejected), duplicate-within-category rejection, same name allowed in a different category                                                                                                 |
| `apps/api/tests/unit/brand.service.test.ts`          | 3                | CRUD, duplicate, tenant isolation                                                                                                                                                                                                                             |
| `apps/api/tests/unit/product.service.test.ts`        | 11               | Category/Sub-Department consistency on create AND update, duplicate SKU/barcode (tenant-scoped - same SKU allowed in a different tenant), negative-price rejection, `maxStock < minStock` rejection                                                           |
| `apps/api/tests/unit/barcode.service.test.ts`        | 4                | Lookup, unknown code, inactive product, tenant isolation                                                                                                                                                                                                      |
| `apps/api/tests/unit/inventory.service.test.ts`      | 8                | Opening stock, adjustment (increase/decrease), **negative-stock prevention**, cross-tenant product/branch rejection, low/out-of-stock classification from real data                                                                                           |
| `apps/api/tests/unit/csv.test.ts`                    | 8                | The hand-rolled CSV parser: quoted fields, embedded commas, escaped quotes, round-trip                                                                                                                                                                        |
| `apps/api/tests/unit/product-import.service.test.ts` | 8                | Valid rows import; an invalid row (bad category) fails WITHOUT blocking other valid rows in the same file; duplicate SKU/barcode reported per-row; missing required column rejected up front; tenant isolation of imported data                               |
| `apps/api/tests/http/catalog.test.ts`                | 13               | End-to-end RBAC (Cashier blocked from everything catalog-related per the real default grants, Manager allowed), the Category/Sub-Department relationship enforced over HTTP (422), tenant isolation (404 on a Tenant B category), CSV import/export over HTTP |
| `apps/api/tests/http/inventory.test.ts`              | 5                | View vs. adjust permission split, negative-stock rejection (409), cross-tenant branch rejection (404)                                                                                                                                                         |
| `apps/api/tests/http/stores.test.ts`                 | 2                | Tenant-scoped store listing                                                                                                                                                                                                                                   |
| `apps/api/tests/unit/master-admin-rbac.test.ts`      | +3 (now 7 total) | `hasModuleAccess` pure-function tests added alongside the existing `requirePlatformActor` tests                                                                                                                                                               |

### Regression

All 155 Phase 1 + Phase 2 tests were re-run, unmodified, and still pass. The
only non-test-file change that affected existing behavior was the two bug
fixes described in `docs/ARCHITECTURE.md` ("Phase 3 additions") - both are
pure bug fixes with no behavior change for any already-passing test; they
were only _visible_ once Phase 3 added routes whose query-validation and
router-mounting position exposed them.

## Phase 3 PRISMA-DEPENDENT TESTS (still cannot execute)

Everything from Phase 1/2's lists, plus: repository integration tests for
`PrismaCategoryRepository`, `PrismaSubDepartmentRepository`,
`PrismaBrandRepository`, `PrismaProductRepository`, `PrismaBarcodeRepository`,
and especially `PrismaInventoryRepository.applyMovement`'s `$transaction`
rollback behavior against a real concurrent-write scenario (the in-memory
fake proves the _contract_; only a real database run proves Prisma's
transaction isolation actually holds under concurrency).

## Phase 4 additions

Verified (executed, passing): **275 tests** = 64 shared + 206 API + 5 web.

- `packages/shared`: `roundDecimalString`, `multiplyDecimalStrings`, `percentageOf`, `subtractDecimalStrings` (incl. the 0.1 x 3 float trap).
- `apps/api/tests/unit/purchase-calculations.test.ts` (13): line/purchase discount %, Rs, tax, rounding, payment status.
- `apps/api/tests/unit/purchase.service.test.ts` (19): multi-line purchase, discounts+tax totals, payments (UNPAID/PARTIAL/PAID), relationship validation (supplier/branch/product, other tenant), quantity validation, duplicate invoice, no double stock increment, multi-line rollback, payment over-balance, tenant isolation, audit.
- `apps/api/tests/unit/supplier.service.test.ts` (4).
- `apps/api/tests/http/purchases.test.ts` (15): 401/403 (Cashier), exact totals + stock + `PURCHASE` movement, duplicate 409, double-discount 422, cross-tenant supplier/branch/product, IDOR on get/invoice/pdf/payments, payment flow, initial payment normalisation, create-product-then-purchase, invoice matches saved purchase, real `%PDF-` download, reprint creates nothing.
- `apps/web/src/tests/purchase-flow.test.tsx` (5, jsdom + Testing Library): the purchase form (header, lines) is preserved while a product is created inline and the new product is added; inline server error keeps all input; exact-decimal preview; invoice auto-opens after record showing the SAVED values with PRINT / DOWNLOAD PDF / CLOSE / VIEW PURCHASE / REPRINT; server rejection keeps data and opens no invoice. These use a stubbed `fetch` (UI behaviour only; server behaviour is covered above).

## Phase 4 PRISMA-DEPENDENT TESTS (still cannot execute)

`PrismaSupplierRepository` / `PrismaPurchaseRepository` (real `$transaction`, composite-FK
tenant checks, `DocumentSequence`, unique `(tenant, supplier, invoiceNo)`) have no executed
tests: NOT VERIFIED - Prisma engine CDN blocked by environment.

## Phase 4.1 additions

**Executed here (PASS):** all shared/API/web suites, including 10 new transaction-integrity contract tests run against the in-memory fakes (`tests/contract/purchase-integrity.contract.ts`, `tests/unit/purchase-integrity.fake.test.ts`). The fake models a transaction (serialised, snapshot + restore on failure) with fault injection. Disabling the rollback in the fake makes 5 of the 10 fail, so the suite does detect missing atomicity.

**Fake tests are NOT proof of PostgreSQL behaviour.** The same contract is wired to real PostgreSQL in `tests/integration/purchase-integrity.pg.test.ts` (faults injected with PostgreSQL triggers that `RAISE EXCEPTION`).

**NOT VERIFIED - ENVIRONMENTAL BLOCKER:** the real-PostgreSQL run. The schema cannot be migrated here (see TROUBLESHOOTING.md). Without `TEST_DATABASE_URL` the suite is reported as skipped, never as passed.

Running it: migrate an isolated database whose name contains `test`, then `TEST_DATABASE_URL=<url> pnpm --filter @mafk/api test:integration`. The suite refuses to run against a database name without "test". Do not put real credentials in committed files.

Contract cases: success writes everything together; audit / 2nd-line movement / supplier-payment failure each roll back everything; failed submission retries cleanly; duplicate sequential and concurrent submissions raise stock once; payment audit failure rolls back; concurrent payments cannot overpay; foreign-tenant supplier writes nothing.

## Phase 4.2 additions

- **Real PostgreSQL 16 (sandbox): `tests/integration/purchase-integrity.pg.test.ts` - 10/10 PASSED** against the shipped migration, using `.env.example` defaults. This also found and fixed two real adapter bugs that the in-memory fakes could not show. Run: `pnpm --filter @mafk/api run test:integration` (the test database must be migrated; see `docs/SETUP-WINDOWS-CMD.md` section 7). Still **pending on your Windows machine**.
- API: `/api/auth/me` (3 tests) and `loadEnv` production guards (5 tests).
- Web: 12 LOGIN screen tests (`apps/web/src/LOGIN/LoginPage.test.tsx`).
- Manual end-to-end in headless Chromium against the built web app, built API and real PostgreSQL: validation messages, wrong-password message and refocus, sign-in, reload keeps session, sign-out revokes it.
- Not covered by any database run yet: the category/product/brand/barcode/supplier/tenant/licence adapters, invoice PDF values.

## Phase 5 additions (POS, sales, refunds, receipts)

Executed in the Phase 5 sandbox and PASSING: **shared 78** (14 new: `sale-math.test.ts`), **API 251** (27 new), **web 26**
(9 new), plus **24 tests on real PostgreSQL 16** (`pnpm --filter @mafk/api run test:integration`; repeated 5 times with no
flakiness). Lint, Prettier, typecheck (full and pure), web build and API build clean; secret scan passed.

- `packages/shared/tests/sale-math.test.ts` (14): totals with tax, item % and fixed discounts, float-trap cases, cart-discount
  allocation that sums exactly, 100% discount, rejections, `allocateCents`, pro-rata refunds whose parts sum to the line total.
- `apps/api/tests/contract/sale-integrity.contract.ts` (13) - ONE suite, two backends: in-memory fakes
  (`tests/unit/sale-integrity.fake.test.ts`) and real PostgreSQL (`tests/integration/sale-integrity.pg.test.ts`). Covers:
  exact sale + stock + movements + audit; insufficient stock writes nothing; audit-write and movement-write failures roll the
  whole sale back (PostgreSQL triggers `RAISE EXCEPTION`); idempotent replay; 5 concurrent identical `clientRequestId`s -> one
  sale; 5 concurrent sales of 3 against 10 in stock -> exactly 3 succeed, stock 1; per-branch invoice numbers; partial then
  final refund (restock, statuses, exact sums); over-return and foreign-item rejection; concurrent over-refund -> exactly one
  succeeds; refund audit failure rolls back; tenant isolation.
- `apps/api/tests/integration/catalog-product.pg.test.ts` (1): product create with barcodes on PostgreSQL (regression for the
  nested-barcode `tenantId` bug found by the Phase 5 browser run).
- `apps/api/tests/http/sales.test.ts` (14): auth/tenant context, cashier sale with server totals and stock, price override and
  discount permissions, 11 rejection cases, idempotent replay (201 then 200), tenant isolation on sale/receipt/PDF/refund, POS
  search by barcode and name, refund permission and flow, over-return/CUSTOMER_CREDIT/duplicate-line/empty rejections, receipts
  (58mm <= 32 cols, 80mm <= 48 cols, A4 JSON, default format, bad format 422), PDFs with the correct MediaBox width for
  58mm / 80mm / A4 and a single page, and print auditing.
- `apps/web/src/tests/pos-flow.test.tsx` (9, jsdom): barcode scan to cart, live total via the shared math, change/tender gating,
  cart discount, payload has no price or total, double click = one request, error keeps cart and REUSES the idempotency key,
  next sale gets a new key, invalid quantity feedback, receipt paper-size switching. (Stubbed `fetch`: UI behaviour only.)
- Manual headless-Chromium run against the real API and PostgreSQL: scan -> discount preview -> cash/change -> sale -> 80mm,
  58mm and A4 receipt preview -> refund -> refund slip; DB rows (sale, SALE / SALE_RETURN movements, stock 10 -> 8 -> 9,
  audit rows, return row) confirmed with psql.

NOT VERIFIED: everything above on the author's Windows machine; `PrismaSaleRepository.list` with date/status/search filters;
real printer output (physical 58/80 mm paper); the PDFs were inspected as rendered images in the sandbox only.

## Phase 6 additions (customers, credit, expenses, employees, reports)

Executed in the Phase 6 sandbox and PASSING: **shared 85** (7 new: `tz.test.ts`), **API 285** (34 new), **web 34** (8 new). Real PostgreSQL 16:
**49/49** (`purchase-integrity` 10, `sale-integrity` 13, `catalog-product` 1, **`phase6` 25**), run 3 times in a row. `pnpm run verify`
(typecheck, lint, format, tests, builds, secret scan, Windows guard) passes.

- `tests/contract/phase6.contract.ts` - one suite, run on the in-memory fakes (`tests/unit/phase6.fake.test.ts`) and on PostgreSQL
  (`tests/integration/phase6.pg.test.ts`): credit limit (none / exceeded / cumulative / exactly at limit), concurrent credit sales and
  concurrent payments, refund to account, audit-fault rollback (PG triggers `RAISE EXCEPTION`), tenant isolation, supplier ledger, expenses,
  employees (private fields, one login per employee), and every report at exact day-boundary instants in `Asia/Karachi`.
- `tests/http/phase6.test.ts` - authentication, permissions (cashier cannot grant credit / take payments / see reports), 422 validation, a full
  credit-sale -> ledger -> payment -> receivables -> CSV flow, cross-tenant 404s.
- `apps/web/src/tests/phase6.test.tsx` - customers, POS sale on account, expenses, reports, analytics screens.

**NOT VERIFIED:** anything on Windows; the official Prisma CLI on a normal network; real printers; report performance on large data sets;
a headless-browser end-to-end run of the Phase 6 screens (only the component tests above were run).

**Full-stack smoke run (Phase 6, sandbox, real PostgreSQL 16 + the production composition, no mocks):** a throwaway database was migrated with
the shipped `migration.sql`, seeded, a Master Admin bootstrapped, then over HTTP: tenant created -> product -> supplier with opening balance 250 +
purchase 3000 (paid 1000) -> supplier ledger 2250.00 -> customer with limit 500 -> sale 330 (100 cash + 230 on account) -> a second credit sale
refused (409) -> payment 30 -> overpayment refused (409) -> expense, employee -> sales summary, profit & loss (revenue 300.00, COGS 180.00,
expenses 40.00, net 80.00), stock valuation, receivables 200.00, payables 2250.00, analytics, CSV export. All responses matched hand-computed
values. The smoke script is not shipped and the database was dropped afterwards. This was **not** run through a browser.

## Phase 6.1 follow-up

- Browser end-to-end test of the Phase 6 screens against the real API and PostgreSQL: `pnpm run e2e` (see `E2E.md`).
- Fixed: a date that has the right shape but does not exist (for example `2026-02-30`) was accepted and silently rolled over.
  All date inputs (report ranges, expense date, hire date) now return 422. Regression test in `tests/http/phase6.test.ts`.
- Open items and exact steps for your PC and printers: `PRISMA-AND-WINDOWS-STEPS.md`, `PRINTER-CHECKS.md`.

## Phase 7 (final) test inventory

| Suite                                                                               | Count | How it runs                                                      |
| ----------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------- |
| `@mafk/shared` unit tests                                                           | 85    | `pnpm test`                                                      |
| `@mafk/api` unit, contract (fakes) and HTTP tests (incl. route authorization sweep) | 289   | `pnpm test`                                                      |
| `@mafk/web` component tests                                                         | 37    | `pnpm test`                                                      |
| `@mafk/desktop` unit tests (policy, Windows path rules, config)                     | 29    | `pnpm test`                                                      |
| Real PostgreSQL 16 integration                                                      | 49    | `TEST_DATABASE_URL=... pnpm --filter @mafk/api test:integration` |
| Browser E2E, Phase 6 screens (real Chromium)                                        | 33    | `pnpm run e2e` (see `E2E.md`)                                    |
| Desktop E2E (real Electron; source and packaged)                                    | 28    | `pnpm run e2e:desktop` (see `E2E.md`)                            |
| Static scans                                                                        | 3     | `scan:secrets`, `scan:security`, `scan:windows`                  |

Skipped is not passed: the integration and E2E suites refuse to run without a test database and say so.
Not covered anywhere: real Windows, physical printers, load. See `PHASE-7.md`.
