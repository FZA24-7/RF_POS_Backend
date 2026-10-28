# Database

Engine: **PostgreSQL 16**. ORM: **Prisma 7.10.0** (`prisma` and
`@prisma/client` are pinned to the identical version, as required), using the
`@prisma/adapter-pg` driver adapter rather than the legacy binary query
engine. Schema: `packages/database/prisma/schema.prisma`.

## Conventions used throughout the schema

- **Every tenant-owned table carries `tenantId`.**
- **Composite tenant-safety keys.** Every tenant-scoped parent model declares
  `@@unique([id, tenantId])`, and every child relation references
  `[id, tenantId]` instead of just `[id]`. This makes cross-tenant references
  a schema-level impossibility - Tenant A's `Product` literally cannot be
  attached to Tenant B's `Purchase`, because the foreign key itself encodes
  both IDs. See `docs/ARCHITECTURE.md` → "Multi-tenancy" for the full
  rationale.
- **No floating-point money.** All financial fields are `Decimal`:
  `Decimal(18,2)` for totals/payments, `Decimal(18,4)` for unit prices/costs
  (so a fractional-cent unit cost times a large quantity still rounds
  correctly at the line-total stage), `Decimal(14,3)` for quantities,
  `Decimal(7,4)` for percentages.
- **History is append-only where it matters.** `AuditLog` and
  `LoginIdHistory` are insert-only from the application's perspective; the
  application code never updates or deletes rows in these tables.
  (A database-level trigger that physically rejects `UPDATE`/`DELETE` on
  `audit_logs` is planned for the Phase 1 migration - see "Known gap" below,
  since it cannot be verified without applying a migration in this
  environment.)
- **Users are soft-deleted; financial/history rows are never deleted.**
  `User.deletedAt` and `Product.deletedAt` support soft delete; the schema has
  no `onDelete: Cascade` on financial history models (Sale, Purchase,
  Payment, etc.) - deleting a parent falls back to Prisma's default
  (`Restrict`), so a referenced Product/Customer/Supplier cannot be hard
  deleted while it has transaction history.

## Full entity list

Tenant, Store, User, Role, Permission, RolePermission, License, Device,
Session, LoginAttempt, LoginIdHistory, Product, Category, SubDepartment,
Brand, Barcode, Inventory, InventoryMovement, Sale, SaleItem, SaleReturn,
SaleReturnItem, Payment, Purchase, PurchaseItem, Supplier, SupplierPayment,
Customer, CustomerPayment, Expense, Employee, AuditLog, Setting,
DocumentSequence.

Every model is documented inline in `schema.prisma`.

## Commands

```bash
pnpm db:generate          # prisma generate
pnpm db:validate          # prisma validate
pnpm db:migrate:dev        # prisma migrate dev   (local development)
pnpm db:migrate:deploy      # prisma migrate deploy (CI/production)
pnpm db:seed                # idempotent permission-catalog seed
```

## Status in this environment

**NOT VERIFIED — Prisma engine CDN blocked by environment.**

Real PostgreSQL 16 **is** installed, running, and reachable in this sandbox
(`mafk_pos` and `mafk_pos_test` databases exist, connection confirmed with
`psql`). What could **not** be verified is Prisma's own tooling: `prisma
generate` / `validate` / `migrate dev` all fail identically, trying to
download a schema-engine binary from `binaries.prisma.sh`, which returns
`403 Forbidden` in this network environment. No migration has been applied,
and the Prisma Client has never been generated here. See
`docs/TROUBLESHOOTING.md` for the exact command and error, and the exact
commands to re-run once engine access is available.

**Known gap pending that access:** the append-only enforcement on `AuditLog`
(a `BEFORE UPDATE OR DELETE` trigger raising an exception) is designed but not
yet written as a migration, since there is no way to test a migration against
this database right now without the schema engine. Add it as the first custom
SQL migration once `db:migrate:dev` is unblocked.

## Phase 4.1 schema changes

- `User.role` is a plain FK on `roleId`. The previous composite `(roleId, tenantId)` relation was rejected by the real Prisma validator (P1012) and could not join for platform users whose `tenantId` is NULL.
- `Purchase` uniqueness is `(tenantId, storeId, purchaseNo)`: purchase numbers are per branch. `(tenantId, supplierId, invoiceNo)` remains unique and is the final guard against concurrent duplicate submissions.
- PostgreSQL treats NULLs as distinct, so platform roles (`tenantId` NULL) cannot be looked up by the `(tenantId, key)` unique; bootstrap uses find-then-create.
- Purchase writes (purchase + lines, stock, `PURCHASE` movements, initial supplier payment, audit row) happen in ONE transaction: `applyMovementInTx` is shared with `InventoryRepository.applyMovement`; stock uses an atomic upsert + increment; payments use optimistic concurrency on `paidAmount`.
- **Migration shipped (Phase 4.2):** `prisma/migrations/20261010190408_init/migration.sql` (34 tables, enums, indexes, composite foreign keys) plus `migration_lock.toml`. Apply with `pnpm db:migrate:deploy`. Do not edit it; future schema changes get new migrations via `prisma migrate dev`.
- Phase 4.2 also: a real-database run found and fixed two adapter bugs (nested purchase-item create must not pass `tenantId`; money fields are returned with fixed 2 decimals).
