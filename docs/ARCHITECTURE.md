# Architecture

## Stack

| Layer             | Choice                                                                    | Version                                       |
| ----------------- | ------------------------------------------------------------------------- | --------------------------------------------- |
| Language          | TypeScript                                                                | 5.9.3                                         |
| Backend runtime   | Node.js                                                                   | 22.22.2 (engines: `>=22.12.0 <23`)            |
| Package manager   | pnpm (single lockfile, workspace)                                         | 10.34.5                                       |
| Backend framework | Express                                                                   | 5.2.1                                         |
| Validation        | Zod                                                                       | 4.6.5                                         |
| Database          | PostgreSQL                                                                | 16                                            |
| ORM               | Prisma + `@prisma/client` (matched)                                       | 7.10.0                                        |
| Prisma driver     | `@prisma/adapter-pg` (driver adapter, not the legacy binary query engine) | 7.10.0                                        |
| Password hashing  | argon2 (argon2id)                                                         | 0.45.1                                        |
| Access tokens     | JWT via `jose`                                                            | 6.2.12                                        |
| Frontend (future) | React + Vite + Tailwind + shadcn/ui                                       | pinned in package.json once `apps/web` starts |
| Desktop (future)  | Electron                                                                  | 44.4.5 (pinned, not yet scaffolded)           |
| Testing           | Vitest + Supertest                                                        | 4.1.11 / 7.3.0                                |
| Lint/format       | ESLint (flat config) + typescript-eslint + Prettier                       | 9.39.5 / 8.71.0 / 3.9.9                       |

Full version matrix: see `docs/BUILD.md`.

## Why this shape

**Monorepo, not a single package.** `apps/*` are deployables (API, web, desktop).
`packages/*` are libraries shared between them. This lets the web app (Phase 5+)
reuse `@mafk/shared` (roles/permissions/Login ID policy) and `@mafk/validation`
(Zod schemas) instead of re-implementing security-critical logic twice.

**Ports and adapters (hexagonal) inside `apps/api`.** Business logic
(`src/services/*`) depends only on repository _interfaces_
(`src/domain/ports.ts`), never on Prisma directly. Two implementations exist:

- `src/infra/prisma/*` - the real, production adapter, backed by PostgreSQL.
- `apps/api/tests/fakes/*` - an in-memory adapter used **only** by the test
  suite, never imported by production code (`src/composition/production.ts`
  wires the real Prisma adapters).

This is what let Phase 1 ship a genuinely tested auth/RBAC/tenant-isolation/
Login-ID-policy implementation even while Prisma Client generation was blocked
in this sandbox (see `docs/TROUBLESHOOTING.md`): the business logic and HTTP
layer are 100% exercised by real tests against the fakes; only the thin Prisma
adapter layer is unverified pending engine access, and it is isolated to
exactly three files (`src/infra/prisma/client.ts`, `src/infra/prisma/
repositories.ts`, and the two entrypoints that wire them:
`src/composition/production.ts`, `src/bin/*.ts`).

**Why Express 5, not Fastify.** Per explicit product decision. Express 5 adds
native async-handler support (a thrown/rejected promise in a route handler is
forwarded to the error middleware automatically), which keeps every controller
in this codebase free of manual try/catch boilerplate.

**Why a driver adapter (`@prisma/adapter-pg`) instead of Prisma's classic
binary query engine.** It keeps the runtime query path in pure JS/WASM talking
to `pg` directly, which is the direction Prisma's own roadmap is moving and
reduces the native-binary surface area at _query time_ (schema/migration
tooling still needs the schema-engine binary, which is the piece currently
blocked - see Troubleshooting).

## Request flow

```text
HTTP request
  → requestId middleware
  → helmet (security headers)
  → cors
  → express.json() / cookie-parser
  → pino-http (structured request logging)
  → route
      → validate(zodSchema)        [request shape]
      → requireAuth(accessTokens)  [authentication - verifies JWT, builds SecurityContext]
      → requirePermission(...)     [authorization - RBAC, server-side, never frontend-only]
      → controller
          → service (business logic, tenant rules, Login ID policy, audit logging)
              → repository (port interface)
                  → Prisma adapter → PostgreSQL   (production)
                  → in-memory fake                 (tests only)
  → errorHandler (DomainError → mapped status; anything else → 500, no stack leak)
```

## Multi-tenancy

```text
Software Owner
     ↓
Master Admin              (tenantId = null, systemRole = MASTER_ADMIN)
     ↓
Tenant / Client           (Tenant row)
     ↓
Client Master Admin       (tenantId = <tenant>, systemRole = CLIENT_MASTER_ADMIN)
     ↓
Manager / Cashier / Inventory Staff / Custom
```

Tenant isolation is enforced in three independent layers, so a bug in any one
layer cannot by itself leak data across tenants:

1. **Token-level:** the JWT access token carries the caller's `tenantId`, set
   once at login from the database - never taken from client input.
2. **Service-level:** every service method that touches a tenant-scoped
   resource compares the resource's `tenantId` against the caller's `tenantId`
   before acting (see `LoginIdService.changeLoginId`, which is unit- and
   HTTP-tested for exactly this in `apps/api/tests/`).
3. **Database-level:** every tenant-owned Prisma model has a composite unique
   key `@@unique([id, tenantId])`, and every relation from a child row to that
   parent is declared as `@relation(fields: [parentId, tenantId], references:
[id, tenantId])`. This makes it a _schema-level impossibility_ to create a
   row that points at a parent in a different tenant - Postgres itself rejects
   it via the foreign key, independent of any application code.

## Folder responsibilities

```text
apps/api/src/
  config/env.ts            Zod-validated environment loading (fails fast on boot)
  logger.ts                 Pino logger factory (redacts secrets from logs)
  domain/types.ts            Framework/Prisma-independent domain types + DomainError
  domain/ports.ts             Repository interfaces (the ports)
  security/                    Argon2, JWT, refresh-token primitives (pure, unit-testable)
  rbac/check.ts                 Pure permission-checking helpers
  services/                     Business logic: AuthService, LoginIdService
  http/app.ts                   Express app factory (dependency-injected)
  http/middleware/                Auth, RBAC, validation, rate-limit, error handling
  http/routes/ + controllers/      Thin HTTP adapters over the services
  infra/prisma/                    Real Prisma-backed repository adapters (see blocker note)
  composition/production.ts         Wires real adapters + services + app for production
  bin/server.ts                      Process entrypoint
  bin/bootstrap-master.ts             One-time Master Admin creation script (no hardcoded creds)

packages/database/
  prisma/schema.prisma        The complete production schema
  src/client.ts                 createPrismaClient() factory (driver-adapter based)
  src/seed.ts                    Idempotent permission-catalog seed

packages/shared/src/
  roles.ts                    SystemRole enum mirror + tenant-staff-role helper
  permissions.ts                Permission catalog + per-role default grants
  login-id.ts                    The Login ID ownership/tenant-scope policy (canChangeLoginId)

packages/validation/src/       Zod schemas: auth, tenant creation, user creation
```

## Phase 2 additions

**Master Admin surface** (`/api/master/*`) follows the identical layering as Phase 1: routes → validate → requireAuth → **requirePlatformActor** (new - see below) → requirePermission → controller → service → repository (port) → Prisma adapter or in-memory fake.

**`requirePlatformActor`** (`src/http/middleware/require-platform-actor.ts`) is a deliberate, redundant second gate on every Master Admin route: the caller's token must carry `systemRole === 'MASTER_ADMIN'` AND `tenantId === null`. Permission checks remain the primary defence (and `@mafk/shared`'s `TENANT_FORBIDDEN_PERMISSIONS` already makes it impossible to _grant_ a tenant role a platform permission), but this middleware means a bug in permission seeding alone is not enough to reach a Master Admin endpoint - it's tested directly with a forged token in `tests/unit/master-admin-rbac.test.ts` and end-to-end in `tests/http/master-admin.test.ts`.

**Transactional tenant provisioning.** `TenantProvisioningRepository.provision` (one port method) creates a Tenant, its default Store, all four default tenant Roles (with permission grants), the first Client Master Admin, and the initial License. The real adapter wraps all of it in a single Prisma `$transaction`; the in-memory test fake (`FakeTenantProvisioningRepository`) independently guarantees the same all-or-nothing contract by running every uniqueness check before writing anything to any of its composed fakes' maps. Both are exercised: the fake by `tests/unit/tenant-provisioning.service.test.ts` (proving rollback), the real adapter is written but unverified (see `docs/TROUBLESHOOTING.md`).

**License status is never trusted from storage alone.** `@mafk/shared`'s `resolveLicenseStatus` is the single place that decides whether a license is effectively `ACTIVE`/`EXPIRED`/`SUSPENDED`/`REVOKED`, called by `LicenseService` and `DashboardStatsService` alike, so a stale `ACTIVE` flag on an expired row can never surface as "active" anywhere in the API's responses.

**Module gating is a Prisma-independent, server-side function** (`src/rbac/modules.ts`), sitting on top of a License's `enabledModules` array (`@mafk/shared`'s `MODULE_CATALOG` is the canonical list). No tenant-resource route calls it yet (Phase 2 has none), but it exists now specifically so Phase 3+ routes have a ready, tested enforcement point instead of re-deriving the rule per-route.

**Web app (`apps/web`)** is a lean React 19 + Vite + Tailwind single-page app: a login screen and a Master Admin dashboard (stats, searchable/filterable tenant list, create-tenant form, tenant detail with stores/license/users/audit log). It talks to the real API only - no mock data anywhere. Deliberately deferred for this phase: client-side routing (a library like `react-router` isn't pulled in yet; navigation is plain React state, documented in `App.tsx`), and session restore across a page reload (the API supports it via the refresh cookie, but the frontend has no "who am I" endpoint to repopulate the user's identity yet - see the comment in `src/state/auth.tsx`). Both are natural Phase 3 additions once more pages exist to justify a router.

## Phase 3 additions

**No schema changes.** Every entity Phase 3 needed (Category, SubDepartment,
Brand, Product, Barcode, Inventory, InventoryMovement) already existed in
Phase 1's schema, including the composite foreign keys that make a
Category/Sub-Department mismatch a database-level impossibility. Phase 3 is
entirely a new service/API/frontend layer on top of unchanged Phase 1
database design.

**Money and quantities are decimal strings, never JS numbers.** Every price
and quantity field is validated as text (`@mafk/validation`'s `decimalString`)
and passed through unchanged end to end. The one place arithmetic genuinely
happens - inventory quantity changes - uses `@mafk/shared`'s
`addDecimalStrings`/`compareDecimalStrings`, a small `BigInt`-backed
fixed-point helper, so `0.1 + 0.2` never becomes `0.30000000000000004`. Both
the real Prisma adapter (which will eventually use Prisma's native `Decimal`
type for the authoritative on-disk value) and the in-memory fake use this
same helper, so the arithmetic is identical in both.

**The single stock-mutation choke point.** `InventoryRepository.applyMovement`
is the only method in the entire codebase that changes an `Inventory` row's
quantity. `InventoryService.adjustStock` and `.setOpeningStock` are the only
callers today; Phase 4 (Purchases) and Phase 5 (POS/Refunds) will call the
same method with `type: 'PURCHASE'` / `'SALE'` / `'SALE_RETURN'` /
`'PURCHASE_RETURN'` instead of writing their own inventory-mutation logic -
this is why the port method takes a `type` rather than being named
`adjustStock` itself.

**Barcode lookup as a hardware-agnostic service.** `BarcodeService.lookup`
takes a plain string and returns a product (or a safe, tenant-scoped
not-found/inactive error) - there is no scanner object, SDK, or device
abstraction anywhere. A USB keyboard-emulation scanner "types" into whatever
input has focus and sends Enter; the Phase 3 frontend's barcode page and the
future POS screen both just need a text input wired to this same endpoint.

**Two genuine bugs found and fixed while building Phase 3's tests** (both
affect the whole API, not just Phase 3 - documented here because Phase 3's
broader route surface is what exposed them):

1. **Router-scoping bug.** Every route file's blanket `router.use(...)` call
   (e.g. `requirePlatformActor` in Master Admin routes) was unscoped. Since
   `app.use('/api', someRouter)` mounts every router at the identical
   prefix, an unscoped `router.use()` runs for _every_ request that reaches
   that router instance - including ones destined for a completely different
   router mounted alongside it - not just requests matching that router's own
   routes. Fixed by scoping each to its own path (`router.use('/master', ...)`,
   `router.use('/catalog', ...)`, etc.) in `master-admin.routes.ts`,
   `catalog.routes.ts`, `inventory.routes.ts`, `store.routes.ts`, and
   `users.routes.ts`.
2. **Express 5's `req.query` is a getter-only accessor.** `validate.ts`'s
   plain `req.query = result.data` assignment threw
   `TypeError: Cannot set property query of #<IncomingMessage> which has only
a getter` for any query-validated GET route. Fixed with
   `Object.defineProperty(req, 'query', { value, writable: true, ... })`,
   which shadows the inherited accessor on the specific request instance
   instead of trying to invoke a (non-existent) inherited setter.

Both were caught by the Phase 3 HTTP test suite before being reported here -
exactly the value of writing real tests against real HTTP requests rather
than only unit-testing services in isolation.
