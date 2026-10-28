# Setup

## Prerequisites

- Node.js 22.12.0 - 22.x (`.nvmrc` pins 22.22.2)
- pnpm 10.34.5 (`packageManager` field in `package.json` pins this exactly)
- PostgreSQL 16 (a local instance, or a connection string to one)

## 1. Install

```bash
corepack enable        # or: npm install -g pnpm@10.34.5
pnpm install
```

This installs every workspace package with a single lockfile (`pnpm-lock.yaml`
at the repo root - there is no second lockfile anywhere in the repo).

## 2. Configure the environment

There is **no `.env` file**. For local development the API, seed, bootstrap and Prisma CLI read the repo-root
`.env.example`, which already holds dev-only values for `DATABASE_URL`, `TEST_DATABASE_URL`, `JWT_SECRET` and
`CLIENT_URL`. Variables you set in your shell win over it; in production (`NODE_ENV=production`) it is never read and
the dev-only secrets are refused. Full reference: `docs/ENVIRONMENT.md`. Windows users: follow
`docs/SETUP-WINDOWS-CMD.md` instead of this file.

## 3. Create the database

```sql
CREATE ROLE mafk WITH LOGIN CREATEDB PASSWORD 'mafk_local_dev';   -- LOGIN is required; password matches .env.example
CREATE DATABASE mafk_pos OWNER mafk;
CREATE DATABASE mafk_pos_test OWNER mafk;   -- for the test suite
```

## 4. Generate the Prisma Client and migrate

```bash
pnpm db:generate
pnpm db:migrate:deploy    # applies the shipped migration packages/database/prisma/migrations/*_init
```

> If this fails with a `403 Forbidden` fetching from `binaries.prisma.sh`, your
> network cannot reach Prisma's engine CDN. See `docs/TROUBLESHOOTING.md` -
> this is a network/firewall issue, not a problem with the schema or code.

## 5. Build and test

```bash
pnpm build
pnpm test
```

## 6. Bootstrap the first Master Admin

There is no default/hardcoded Master Admin account. Create one explicitly:

```bash
MASTER_ADMIN_LOGIN_ID=owner.admin \
MASTER_ADMIN_PASSWORD='ChangeMe123!StrongPassword' \
MASTER_ADMIN_NAME="Platform Owner" \
pnpm bootstrap:master
```

The password is never stored in a file; unset `MASTER_ADMIN_PASSWORD` afterwards. (`MASTER_ADMIN_LOGIN_ID` and `MASTER_ADMIN_NAME` default from `.env.example`.)

## 7. Run the API

```bash
pnpm dev:api        # watch mode, tsx
# or, after `pnpm build`:
node apps/api/dist/bin/server.js
```

The API listens on `PORT` (default `4000`). `GET /api/health` is a liveness
check that requires no authentication and no database.
