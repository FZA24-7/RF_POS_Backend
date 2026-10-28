# Release status

## Phase 1 - Foundation (this release)

Scope delivered: monorepo, version matrix, full production Prisma schema,
authentication (Argon2id, JWT + rotating refresh tokens, per-account lockout,
per-IP rate limiting), tenant architecture with three-layer isolation, RBAC
with the full permission catalog, the complete Login ID security rule set,
audit logging, Master Admin bootstrap (no hardcoded credentials), and a real,
passing test suite (65 tests) covering all of the above at both the unit and
HTTP level.

Explicitly **not** in Phase 1: any UI (web or Electron), POS/sales/refunds,
products/categories/inventory, purchases, customers/suppliers, expenses,
employees beyond the schema, reports/analytics, or the license system's
business logic (the `License` table exists in the schema; nothing reads or
writes it yet).

Full verification results: see `docs/BUILD.md` (command-by-command PASS/FAIL
table) and `docs/TESTING.md` (test-by-test breakdown). Summary:

- **65/65 tests passing** (all DB-independent by design - see
  `docs/ARCHITECTURE.md`).
- TypeScript, ESLint, and Prettier all clean across every package that does
  not depend on the generated Prisma Client.
- **NOT VERIFIED — Prisma engine CDN blocked by environment:** `prisma
generate` / `validate` / `migrate dev`, and therefore the full build/
  typecheck of `@mafk/database` and the Prisma-adapter portion of `@mafk/api`.
  See `docs/TROUBLESHOOTING.md` for the exact cause and the exact commands to
  re-run once resolved.

## Next phase (Phase 2, pending approval)

Per the phased plan: Master Admin client-creation flow (provision a Tenant +
default Store + Client Master Admin + license in one transaction), and the
License model's business logic (expiration, module gating, user/device
limits).

Before Phase 2 begins, this checkpoint should ideally be re-verified with
Prisma engine access available, per the ordered command list at the end of
`docs/TROUBLESHOOTING.md` - but per explicit instruction, that is not a
blocker to continuing development; it's tracked and will be closed out
opportunistically.

## Phase 2 - Master Admin (this release)

Scope delivered: Master Admin dashboard (real stats - tenants/licenses/users/DB health, zero fabricated numbers), full Client/Tenant management (create - transactional, view, edit, activate/deactivate, search/filter, stores, users, license, audit activity), Client Master Admin management (create initial + additional admins, the Login ID lock rule unchanged and re-verified), License management (create/update/status/expiration via a single pure `resolveLicenseStatus` function, never trusting a stale stored flag), Module Management (`enabledModules` on License + a `hasModuleAccess` server-side enforcement point ready for Phase 3+ tenant-resource routes), cross-tenant/privilege-escalation defence in depth (`requirePlatformActor`, tested against a forged token), and a lean but genuinely working React/Vite/Tailwind frontend consuming the real API.

Explicitly **not** in Phase 2: POS/sales/refunds, products/categories/inventory, purchases, customers/suppliers, expenses, employees, reports/analytics (all still Phase 3+ per the original plan), client-side routing in the web app, session restore across a page reload, and a real Windows Electron build.

Full verification results: `docs/BUILD.md` (command table) and `docs/TESTING.md` (test-by-test breakdown). Summary:

- **125/125 tests passing** (45 `@mafk/shared` + 80 `@mafk/api`), all DB-independent by design, including every Phase 1 test re-run unmodified and still green.
- TypeScript, ESLint, and Prettier all clean across the whole repo, including the new `apps/web`.
- `apps/web` has a genuine, unblocked production build (`vite build`) - the first fully-verified, Prisma-independent build artifact in this project.
- **NOT VERIFIED — Prisma engine CDN blocked by environment**, unchanged from Phase 1, now also covering the Phase 2 Prisma adapters (`TenantProvisioningRepository`, `StoreRepository`, `LicenseRepository`, `SystemHealthRepository`). See `docs/TROUBLESHOOTING.md`.

## Next phase (Phase 3, pending approval)

Per the phased plan: Client Admin-side features (Products, Categories/Sub-Departments, Inventory) and the beginning of the POS module, which will be the first consumer of the `hasModuleAccess` enforcement point built in Phase 2.

The project-wide requirement stands: **the project is not considered fully production-ready until a future phase has successfully run the real PostgreSQL + Prisma path (generate, validate, migrate, and Prisma-backed integration tests) at least once.** This checkpoint keeps that blocker visible rather than hiding it behind "it probably works."

## Phase 3 - Catalog, Inventory & Barcode (this release)

Scope delivered: full Category/Sub-Department/Brand/Product CRUD with
server-side enforcement of the Category→Sub-Department→Product relationship
(not just frontend filtering); SKU/barcode uniqueness scoped correctly per
tenant; a hardware-agnostic barcode lookup service; branch-aware inventory
with a single atomic stock-mutation choke point (`InventoryRepository.
applyMovement`) shared by opening stock and manual adjustment today, and
reserved for Purchases/POS/Refunds in later phases; real low-stock/
out-of-stock detection from live data; CSV product import (per-row validation
and error reporting, documented non-atomic-across-rows semantics) and export;
a lean but real frontend covering all of the above plus a barcode lookup
screen. No fabricated data or metrics anywhere - every dashboard number,
stock status, and list is computed from repository reads.

Two genuine, repo-wide bugs were found and fixed via the Phase 3 test suite
(an unscoped router middleware bug, and an Express 5 `req.query` accessor
bug) - see `docs/ARCHITECTURE.md`. Both are corrected everywhere they
occurred, not patched locally.

Explicitly **not** in Phase 3: Purchases, POS, Sales/Refunds, Customers/
Suppliers, Expenses, Reports/Analytics (still later phases); Excel (.xlsx)
import/export (CSV only, per the spec's "where appropriate" / "may be
implemented" wording - deferred since no xlsx dependency has been added to
the version matrix yet); reserved/available-quantity tracking on Inventory
(only current quantity is modeled, as that's all Phase 3's own requirements
needed - reservations are a natural Phase 5 POS addition).

Full verification: `docs/BUILD.md` (commands) and `docs/TESTING.md` (test
breakdown). Summary: **208/208 tests passing**, TypeScript/ESLint/Prettier
clean repo-wide, a genuine `@mafk/web` production build, and the Prisma
blocker reproduced identically to Phase 1/2 with its error surface still
precisely confined to the Prisma-adapter files.

## Next phase (Phase 4, pending approval)

Per the phased plan: Purchases, including "create product inside purchase"
and the automatic Purchase Invoice - the first real consumer of
`InventoryRepository.applyMovement` with `type: 'PURCHASE'`.

The project-wide requirement stands unchanged: **not fully production-ready
until a future phase successfully runs the real PostgreSQL + Prisma path.**

## Phase 4 - Purchases & Purchase Invoices (this release)

Scope delivered: suppliers (create/list, tenant-scoped, audited); Purchases (record with multiple lines, per-line and purchase-level discount as % XOR Rs, tax, exact decimal totals, payment status UNPAID/PARTIAL/PAID, optional initial payment, later payments with over-balance protection, list/search/filter/paginate, detail); stock increase through the single inventory mutation path with `PURCHASE` movements traceable to the purchase; duplicate-submission protection; automatic invoice after Record Purchase (print stylesheet, real PDF download, reprint from saved data, view purchase, close); inline "Create New Product" without losing the purchase; shared money math moved to `@mafk/shared` so UI preview and server agree; web test harness (Vitest + Testing Library).

Not in Phase 4: editing a recorded purchase (by design - see API.md), purchase returns, a full supplier ledger/balances view (Phase 6; payments are stored as `SupplierPayment` rows), POS/sales/refunds (Phase 5), customers/expenses/employees/reports (Phase 6), Electron (Phase 7). The PDF embeds a logo only when it is a PNG/JPEG data-URI (remote logo URLs are not fetched server-side).

Prisma blocker unchanged: generate/validate/migrate, full API typecheck/build, DB integration tests remain NOT VERIFIED - Prisma engine CDN blocked by environment. The project is not claimed production-ready.

## Phase 4.1 - Purchase integrity and release hardening

Changed: the purchase audit record now commits inside the purchase transaction (it was written after commit, so a failed audit left a purchase without an audit and vice versa). `PurchaseService` passes an audit descriptor; the repository writes it in the same transaction. Payments do the same. Per-branch purchase numbers. Concurrent payment guard (409). Shared stock function for inventory and purchases.

Defects found by the first genuine schema validation / client generation / API typecheck, all fixed: invalid `User.role` relation (P1012); `export * as Prisma` hid `Prisma.Decimal`/`TransactionClient`; nullable role mapping; platform-role upsert on a NULL unique; audit JSON typing; fake `productName` fidelity bug and a fake barcode signature drift.

**Not production-ready: the Prisma/PostgreSQL path is NOT VERIFIED** (migrations, real-DB integration tests, seed/bootstrap and runtime behaviour have never run against PostgreSQL). See TROUBLESHOOTING.md for the blocker and the Windows steps.

## Phase 4.2 - Login folder, shipped migration, `.env.example` configuration

- `apps/web/src/LOGIN/` - the complete sign-in screen (validation, error messages, show/hide password, double-submit
  guard, focus handling) with `LOGIN.md` describing it and the login tables/roles in the database. Session survives a
  page reload via the new `GET /api/auth/me`.
- **`migration.sql` shipped** (`packages/database/prisma/migrations/20261010190408_init`), produced by Prisma's own
  schema engine (see `docs/TROUBLESHOOTING.md`), applied to PostgreSQL 16 and exercised by the real-database tests.
- No `.env`: local config comes from `.env.example` (dev-only values, never loaded in production, rejected by the API in
  production). Windows guide for Command Prompt: `docs/SETUP-WINDOWS-CMD.md`.
- Fixes found by running against a real database: purchase line-item create, money formatting, platform-role lookup,
  `User.role` relation, and a UI bug where the focus ring was always drawn.
- **Verified here:** sandbox PostgreSQL 16 + headless Chromium (see `docs/TESTING.md`). **Not verified:** the official
  `prisma generate`/`migrate deploy` commands (CDN blocked in the sandbox), anything on Windows, and the adapters listed
  in `docs/TESTING.md` as not covered. **Not production-ready.**

## Phase 5 - POS, sales, refunds, receipts (this release)

Scope delivered: tenant POS checkout with server-side pricing and exact money math; atomic sales (stock, payments, numbering,
audit in one transaction); idempotent checkout; refunds with restock and race-free over-return protection; receipts at 58mm,
80mm and A4 (text, PDF and on-screen preview with print); web POS and Sales & Refunds screens. Design and rules: `docs/POS.md`.

Bug found and fixed by the real-browser run: `PrismaProductRepository.create` passed `tenantId` in the nested barcode create,
which Prisma rejects, so creating a product with barcodes returned 500 against PostgreSQL (regression test added).

Not in Phase 5: sales on account / customer ledger (Phase 6), voiding a sale, ESC/POS hardware and cash drawer (Phase 7), offline
sync. See `docs/POS.md` section 7.

Verification: see `docs/TESTING.md` "Phase 5 additions". Real PostgreSQL 16 in the sandbox: 24/24 passed. **Not yet run on the
author's Windows machine. Not production-ready**: the Windows verification, a normal-network Prisma CLI run, the remaining
unexercised adapters (see the DATABASE STATUS headers in `apps/api/src/infra/prisma/`) and real receipt-printer testing are open.

## Phase 6 - Customers, credit, expenses, employees, reports, analytics, supplier ledger (this release)

Scope delivered: customers with credit limits and a derived balance; sales and refunds on account with a row-locked limit check; payments
received; supplier opening balance and payable ledger; expenses; employees (salary/national ID hidden without `employees.edit`); sales, hourly,
product, category, cashier, profit & loss, stock valuation, receivables and payables reports with CSV; analytics overview; web screens for all of it.
Design and rules: `docs/PHASE-6.md`. No schema change. Windows hardening shipped with it: `pnpm run scan:windows`, `.gitattributes` (LF),
`.editorconfig` and the cmd.exe guide (`docs/SETUP-WINDOWS-CMD.md`).

Verification: see `docs/TESTING.md` "Phase 6 additions". Real PostgreSQL 16 in the sandbox: 49/49 passed (3 consecutive runs).
**Not yet run on a Windows machine. Not production-ready**: Windows verification, a normal-network Prisma CLI run, the remaining unexercised
adapters (see the DATABASE STATUS headers), real printers and load testing of reports are open. Phase 7 (Electron, final docs, final security scan,
final ZIP) has **not** started.

## Phase 7: desktop app, final documentation, final security review

Delivered: the Electron desktop shell (`DESKTOP.md`), the final security review and new automated security checks
(`SECURITY-REVIEW.md`), the final deployment guide (`DEPLOYMENT.md`), and the final README. Verification results and the full list of
**NOT VERIFIED** items (Windows, the NSIS installer, official Prisma engines, physical printers, load) are in `PHASE-7.md`.
The project is feature-complete for the original plan but is **not** declared production-ready.
