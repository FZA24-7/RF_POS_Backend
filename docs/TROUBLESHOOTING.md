# Troubleshooting

## "Failed to fetch sha256 checksum at https://binaries.prisma.sh/... - 403 Forbidden"

This is **the one environmental blocker in Phase 1**. It occurs on any of:

```bash
pnpm db:generate
pnpm db:validate
pnpm db:migrate:dev
pnpm --filter @mafk/database run build
```

**Cause:** Prisma's CLI downloads a native "schema-engine" binary from its own
CDN (`binaries.prisma.sh`) the first time it's needed, and caches it locally.
In a network environment where that domain is not reachable (e.g. an
allowlisted-domains sandbox, or a locked-down corporate/CI network), every one
of the commands above fails identically and immediately, before touching the
database at all.

**What was confirmed while diagnosing this** (so you don't have to re-check):

- Setting `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` does **not** help - the
  actual binary download (not just its checksum) is also blocked.
- There is **no alternate mirror**: the engine is not published as an npm
  package (only the orchestration code is), and the `prisma/prisma-engines`
  GitHub repository's releases contain only source archives, no binary
  assets.
- Prisma 7's CLI _does_ bundle a WASM schema engine
  (`node_modules/prisma/build/schema_engine_bg.wasm`) directly in the npm
  package, but the installed CLI version does not use it for `generate` /
  `validate` / `migrate dev` by default - it still attempts the native binary
  download first.
- This is unrelated to PostgreSQL itself: a real PostgreSQL 16 instance is
  installed, running, and confirmed reachable in this environment
  (`mafk_pos` and `mafk_pos_test` databases exist; `psql` connects
  successfully). The failure is specifically in Prisma's own CLI tooling
  reaching its binary CDN.

**Fix:** allow network access to `binaries.prisma.sh` from wherever you run
these commands (add it to your sandbox's/CI's domain allowlist, or run these
specific commands from a network that isn't restricted), then re-run the
commands in the exact order below.

### Exact commands to re-run, in order, once access is restored

```bash
# 1. Generate the Prisma Client (this is the one that was failing)
pnpm --filter @mafk/database run generate

# 2. Validate the schema against the real engine
pnpm --filter @mafk/database run validate

# 3. Apply the schema to your local database (creates the first migration)
pnpm --filter @mafk/database run migrate:dev

# 4. Now that generated types exist, the previously-blocked TypeScript
#    should resolve cleanly - confirm:
pnpm --filter @mafk/api run typecheck        # expect: 0 errors (was 4, all in infra/prisma + bin)
pnpm run typecheck                            # full workspace, root script

# 5. Build everything, including the now-unblocked @mafk/database and the
#    full (not just "pure") @mafk/api:
pnpm run build

# 6. Seed the permission catalog:
pnpm db:seed

# 7. Bootstrap the first Master Admin (see docs/SETUP.md step 6):
MASTER_ADMIN_LOGIN_ID=... MASTER_ADMIN_PASSWORD=... MASTER_ADMIN_NAME=... pnpm bootstrap:master

# 8. Add and run the Prisma-dependent tests described in docs/TESTING.md
#    section 2 (repository integration tests + a migration smoke test),
#    then re-run the full suite:
pnpm --filter @mafk/api run test
```

If step 4 still shows errors after step 1 succeeds, they are new/real bugs,
not the Prisma blocker - the blocker's blast radius was precisely isolated to
`src/infra/prisma/client.ts`, `src/infra/prisma/repositories.ts`,
`src/infra/prisma/master-admin-repositories.ts`,
`src/infra/prisma/catalog-repositories.ts`, and `src/bin/bootstrap-master.ts`
(see `docs/BUILD.md`'s command-result table).

## "Database connection failed" / `ECONNREFUSED` talking to Postgres

- Confirm PostgreSQL is actually running: `pg_lsclusters` (Debian/Ubuntu) or
  `pg_ctl status`.
- Confirm `DATABASE_URL` matches the running instance's host/port/user/
  password/database name exactly.
- If you see `Connection refused` on `/var/run/postgresql/.s.PGSQL.5432`,
  the server process isn't running - start it (e.g.
  `pg_ctlcluster 16 main start` on Debian/Ubuntu) before retrying.

## Missing environment variables

The API validates its environment with Zod at boot (`apps/api/src/config/
env.ts`) and will refuse to start with a message listing exactly which
variable is missing/invalid - there is no silent fallback to an insecure
default for anything security-sensitive (`JWT_SECRET`, `DATABASE_URL`).

## Port conflicts

Set `PORT` (e.g. `set "PORT=4001"` in cmd.exe before starting the API) to an unused port. The dev server logs the port it bound
on startup.

## Node version mismatch

`engines` in the root `package.json` (`"node": ">=22.12.0 <23"`) and
`engine-strict=true` in `.npmrc` mean `pnpm install` will refuse to proceed on
the wrong Node major version rather than installing anyway and failing later.

## Dependency version conflicts

There is exactly one lockfile (`pnpm-lock.yaml`, repo root) and one package
manager (pnpm, pinned via the `packageManager` field). If you see a
dependency conflict, check that you're not running `npm install` or
`yarn install` anywhere in the tree by mistake - that would create a second
lockfile and is not supported.

## Frontend/backend connection problems

Not yet applicable - `apps/web` doesn't exist in Phase 1. When it does: check
`CLIENT_URL` matches the dev server's actual origin exactly (CORS is
configured to allow only that origin, with credentials).

## Electron backend connection problems

Not yet applicable - `apps/desktop` doesn't exist in Phase 1 (planned Phase
7).

## Build errors

Run `pnpm --filter <package> run typecheck` for the specific package to get a
scoped error list before running the full `pnpm build`.

## Login problems

- `INVALID_CREDENTIALS`: wrong Login ID or password. The API intentionally
  returns the same error for "no such user" and "wrong password" to avoid
  leaking which accounts exist.
- `ACCOUNT_LOCKED`: too many recent failed attempts (`LOGIN_MAX_FAILED_
ATTEMPTS` within `LOGIN_LOCKOUT_MINUTES`). Wait out the window, or (as an
  operator) inspect the `login_attempts` table.
- `ACCOUNT_DISABLED` / `TENANT_SUSPENDED`: the user or their tenant has been
  disabled/suspended by an administrator; this is not a bug.

## Phase 4.1 - Prisma 403 investigation (exact diagnosis)

**Status: UNRESOLVED in the cloud sandbox - environmental blocker. No bypass was used.**

- Command: `pnpm exec prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` (same for `migrate dev`, `migrate deploy`, `db push`).
- Error: `Failed to fetch sha256 checksum at https://binaries.prisma.sh/all_commits/0edf323efd1d98336f3f0a68684b56f689b900d3/debian-openssl-3.0.x/schema-engine.gz.sha256 - 403 Forbidden`
- Versions match: prisma CLI, @prisma/client and @prisma/adapter-pg are all 7.10.0; engines commit `0edf323efd1d98336f3f0a68684b56f689b900d3`.
- Cause: the sandbox's egress proxy answers 403 to `CONNECT binaries.prisma.sh:443` (organisation allowlist). `registry.npmjs.org` is allowed; `binaries.prisma.sh`, `github.com` and `static.crates.io` are not. It is not a version, config or checksum problem.
- Not done, deliberately: `PRISMA_ENGINES_MIRROR` to a third-party host (untrusted binaries), `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING` (weakens a security check and would not help), hand-written/fabricated generated client or migration SQL.
- Fix on the sandbox side: an administrator adds `binaries.prisma.sh` to the egress allowlist.
- Diagnostic-only finding: pointing `PRISMA_SCHEMA_ENGINE_BINARY` at a script that fails loudly lets the CLI's bundled WASM validator and client generator run. That produced a genuine `prisma validate` and `prisma generate`, and a genuine full API typecheck, which found real defects (fixed in 4.1, see RELEASE.md). It is NOT a resolution: `migrate`/`db push` need the native engine and still fail. Never commit that setting.
- Prisma 7 runtime uses the query compiler (WASM) with the `pg` driver adapter, so only the CLI's migrate step needs the native engine.

### What to run on your Windows machine (normal internet access)

Follow `docs/SETUP-WINDOWS-CMD.md` (Command Prompt, no `.env`). A migration now **ships** with the project
(`packages/database/prisma/migrations/20261010190408_init/migration.sql`, generated by Prisma's own schema engine), so
you run `pnpm db:migrate:deploy` rather than creating one with `migrate dev`.

How that migration was produced when the CLI could not download its native engine: the installed Prisma CLI already
contains the schema engine as WebAssembly (`prisma/build/schema_engine_bg.wasm`; the byte-identical official npm package
`@prisma/schema-engine-wasm@7.10.0-4.0edf323...` has sha256 `c8d00b95...7a1e`). It was driven with the project's own
`@prisma/adapter-pg` to diff "empty database -> schema.prisma", and the result was written to the migration folder
without edits. It was applied to PostgreSQL 16 with the same engine's `applyMigrations` (what `migrate deploy` does) and
the 10 real-database tests passed. The official `prisma migrate deploy` on your machine will see the same file and
record the same checksum. No third-party binary, mirror or checksum override was used.

## "Database connection failed" / `ECONNREFUSED` talking to Postgres

- Confirm PostgreSQL is actually running: `pg_lsclusters` (Debian/Ubuntu) or
  `pg_ctl status`.
- Confirm `DATABASE_URL` matches the running instance's host/port/user/
  password/database name exactly.
- If you see `Connection refused` on `/var/run/postgresql/.s.PGSQL.5432`,
  the server process isn't running - start it (e.g.
  `pg_ctlcluster 16 main start` on Debian/Ubuntu) before retrying.

## Missing environment variables

The API validates its environment with Zod at boot (`apps/api/src/config/
env.ts`) and will refuse to start with a message listing exactly which
variable is missing/invalid - there is no silent fallback to an insecure
default for anything security-sensitive (`JWT_SECRET`, `DATABASE_URL`).

## Port conflicts

Set `PORT` (e.g. `set "PORT=4001"` in cmd.exe before starting the API) to an unused port. The dev server logs the port it bound
on startup.

## Node version mismatch

`engines` in the root `package.json` (`"node": ">=22.12.0 <23"`) and
`engine-strict=true` in `.npmrc` mean `pnpm install` will refuse to proceed on
the wrong Node major version rather than installing anyway and failing later.

## Dependency version conflicts

There is exactly one lockfile (`pnpm-lock.yaml`, repo root) and one package
manager (pnpm, pinned via the `packageManager` field). If you see a
dependency conflict, check that you're not running `npm install` or
`yarn install` anywhere in the tree by mistake - that would create a second
lockfile and is not supported.

## Frontend/backend connection problems

Not yet applicable - `apps/web` doesn't exist in Phase 1. When it does: check
`CLIENT_URL` matches the dev server's actual origin exactly (CORS is
configured to allow only that origin, with credentials).

## Electron backend connection problems

Not yet applicable - `apps/desktop` doesn't exist in Phase 1 (planned Phase
7).

## Build errors

Run `pnpm --filter <package> run typecheck` for the specific package to get a
scoped error list before running the full `pnpm build`.

## Login problems

- `INVALID_CREDENTIALS`: wrong Login ID or password. The API intentionally
  returns the same error for "no such user" and "wrong password" to avoid
  leaking which accounts exist.
- `ACCOUNT_LOCKED`: too many recent failed attempts (`LOGIN_MAX_FAILED_
ATTEMPTS` within `LOGIN_LOCKOUT_MINUTES`). Wait out the window, or (as an
  operator) inspect the `login_attempts` table.
- `ACCOUNT_DISABLED` / `TENANT_SUSPENDED`: the user or their tenant has been
  disabled/suspended by an administrator; this is not a bug.

## Phase 4.1 - Prisma 403 investigation (exact diagnosis)

**Status: UNRESOLVED in the cloud sandbox - environmental blocker. No bypass was used.**

- Command: `pnpm exec prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` (same for `migrate dev`, `migrate deploy`, `db push`).
- Error: `Failed to fetch sha256 checksum at https://binaries.prisma.sh/all_commits/0edf323efd1d98336f3f0a68684b56f689b900d3/debian-openssl-3.0.x/schema-engine.gz.sha256 - 403 Forbidden`
- Versions match: prisma CLI, @prisma/client and @prisma/adapter-pg are all 7.10.0; engines commit `0edf323efd1d98336f3f0a68684b56f689b900d3`.
- Cause: the sandbox's egress proxy answers 403 to `CONNECT binaries.prisma.sh:443` (organisation allowlist). `registry.npmjs.org` is allowed; `binaries.prisma.sh`, `github.com` and `static.crates.io` are not. It is not a version, config or checksum problem.
- Not done, deliberately: `PRISMA_ENGINES_MIRROR` to a third-party host (untrusted binaries), `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING` (weakens a security check and would not help), hand-written/fabricated generated client or migration SQL.
- Fix on the sandbox side: an administrator adds `binaries.prisma.sh` to the egress allowlist.
- Diagnostic-only finding: pointing `PRISMA_SCHEMA_ENGINE_BINARY` at a script that fails loudly lets the CLI's bundled WASM validator and client generator run. That produced a genuine `prisma validate` and `prisma generate`, and a genuine full API typecheck, which found real defects (fixed in 4.1, see RELEASE.md). It is NOT a resolution: `migrate`/`db push` need the native engine and still fail. Never commit that setting.
- Prisma 7 runtime uses the query compiler (WASM) with the `pg` driver adapter, so only the CLI's migrate step needs the native engine.

### What to run on your Windows machine (normal internet access)

```powershell
pnpm install --frozen-lockfile
# PostgreSQL 16 running; create two EMPTY databases, e.g. mafk_pos_dev and mafk_pos_test
$env:DATABASE_URL = "postgresql://<user>:<password>@localhost:5432/mafk_pos_dev"
pnpm --filter @mafk/database exec prisma validate
pnpm --filter @mafk/database exec prisma generate
pnpm --filter @mafk/database exec prisma migrate dev --name init   # creates + commits the first migration
pnpm --filter @mafk/api typecheck
pnpm --filter @mafk/api build
# isolated test DB: apply the same migration, then run the real PostgreSQL tests
$env:DATABASE_URL = "postgresql://<user>:<password>@localhost:5432/mafk_pos_test"
pnpm --filter @mafk/database exec prisma migrate deploy
$env:TEST_DATABASE_URL = $env:DATABASE_URL
pnpm --filter @mafk/api test:integration
```

No migration exists in the repository yet: it could never be generated without the engine. The first `migrate dev` run on your machine creates it; please commit it.
