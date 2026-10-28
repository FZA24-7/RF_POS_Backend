# MAFK-24/7 Retail-Flow POS

A multi-tenant retail platform: point of sale, inventory, purchases and suppliers, customers and credit, expenses,
employees, reports and analytics, administration, and a Windows desktop app.

**Status: all seven planned phases are built. This is not declared production-ready.** It was developed and tested on Linux
against a real PostgreSQL 16 and real browsers/Electron, but it has **not** been run on real Windows, with a physical receipt
printer, or at production load. The exact list of what is and is not verified is in `docs/PHASE-7.md`.

## Project overview

|                  |                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------- |
| Product          | MAFK-24/7 Retail-Flow POS                                                           |
| Desktop app name | MAFK Retail-Flow POS (installer target: `MAFK-RetailFlow-POS.exe`)                  |
| Package scope    | `@mafk/*`                                                                           |
| Stack            | Node 22, TypeScript, Express 5, Prisma 7 + PostgreSQL 16, React 19 + Vite, Electron |

## What it does

- **Foundation (1-2):** multi-tenant data model with database-enforced tenant isolation, Argon2id passwords, JWT access
  tokens with rotating refresh tokens, lockout and rate limiting, RBAC with one central permission catalog, the Login ID rules,
  audit logging, and the Master Admin surface (tenants, licenses, modules).
- **Catalog and inventory (3):** categories, sub-departments, brands, products, barcodes, branch-aware stock with traceable movements,
  low-stock detection, CSV import/export.
- **Suppliers and purchases (4):** atomic purchase recording, payment status, purchase invoices (print and PDF).
- **POS (5):** checkout with cash/card/bank split payments, change, discounts, tax, refunds, idempotent sale submission,
  58 mm / 80 mm / A4 receipts.
- **Business (6):** customers and store credit with a credit limit enforced under a row lock, customer payments, supplier ledger,
  expenses, employees (salary/ID visible only with permission), ten reports, analytics, CSV export.
- **Desktop and release (7):** sandboxed Electron app, final security review, final documentation.

Money is always exact decimal strings (no floating point). Every tenant-owned query is scoped to the tenant in the token.

## Requirements

- Node.js `22.12 - 22.x`, pnpm `10.34.5`, PostgreSQL 16
- Windows users: Command Prompt (cmd.exe) steps are in `docs/SETUP-WINDOWS-CMD.md`. PowerShell is not used.

## Quick start

There is no `.env` file; local development reads the dev-only defaults in `.env.example` (see `docs/ENVIRONMENT.md`).

```
pnpm install
pnpm db:generate
pnpm db:migrate:deploy
pnpm db:seed
pnpm bootstrap:master        (needs MASTER_ADMIN_PASSWORD set first; see docs/SETUP-WINDOWS-CMD.md)
pnpm dev:api                 (terminal 1)
pnpm dev:web                 (terminal 2, http://localhost:5173)
pnpm desktop                 (optional: the Electron app)
```

`pnpm run verify` runs typecheck, lint, formatting, every test, all builds and the three scans.

## Documentation map

| Need                                  | Read                                                                 |
| ------------------------------------- | -------------------------------------------------------------------- |
| Set up on Windows (cmd.exe)           | `docs/SETUP-WINDOWS-CMD.md`, then `docs/PRISMA-AND-WINDOWS-STEPS.md` |
| Set up elsewhere                      | `docs/SETUP.md`, `docs/ENVIRONMENT.md`, `docs/DATABASE.md`           |
| Deploy for real                       | `docs/DEPLOYMENT.md` (HTTPS, backups, upgrades)                      |
| Desktop app and installer             | `docs/DESKTOP.md`                                                    |
| Security                              | `docs/SECURITY-REVIEW.md`                                            |
| Tests and what they prove             | `docs/TESTING.md`, `docs/E2E.md`                                     |
| Receipts and printers                 | `docs/POS.md`, `docs/PRINTER-CHECKS.md`                              |
| API reference and architecture        | `docs/API.md`, `docs/ARCHITECTURE.md`                                |
| Business modules (customers, reports) | `docs/PHASE-6.md`                                                    |
| Release history and open items        | `docs/RELEASE.md`, `docs/PHASE-7.md`                                 |
| Something broke                       | `docs/TROUBLESHOOTING.md`                                            |
| Sign-in screen and its database role  | `apps/web/src/LOGIN/LOGIN.md`                                        |

## Folder structure

```text
MAFK-24-7-Retail-Flow-POS/
├── apps/
│   ├── api/        Express + TypeScript REST API (hexagonal: ports, Prisma adapters, in-memory fakes for tests)
│   ├── web/        React + Vite + Tailwind app (all screens)
│   └── desktop/    Electron shell (client only; connects to the API server)
├── packages/
│   ├── shared/     Roles, permissions, Login ID policy, decimal money, time zones
│   ├── validation/ Zod schemas shared by API and web
│   └── database/   Prisma schema, shipped migration, client wrapper, seed
├── e2e/            Browser and desktop end-to-end tests (real browser/Electron, real API, real PostgreSQL)
├── scripts/        Secret scan, security scan, Windows guard
└── docs/           Documentation
```

## Verified in the build environment (Linux)

Unit and HTTP tests, a shared contract suite run on both in-memory fakes and real PostgreSQL 16 (49 tests), browser E2E of the Phase 6
screens, and Electron E2E of the desktop app (source and packaged build). The official Prisma engine download is blocked in that
environment; see `docs/PRISMA-AND-WINDOWS-STEPS.md` for what to run on your own machine.
