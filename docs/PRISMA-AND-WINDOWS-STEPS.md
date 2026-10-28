# Prisma generation/migration and Windows: what is open, and exactly what to do on your PC

## Status (honest)

- **Official `prisma generate` / `migrate deploy` could not be run in the build sandbox.** Prisma downloads its schema engine
  from `binaries.prisma.sh`, which the sandbox network blocks (HTTP 403). No fake client, checksum bypass or mirror was used.
  The sandbox applied the **shipped** `migration.sql` with `psql` instead and generated the client with a sandbox-only stub
  that is not part of this project. So the official CLI path is **NOT VERIFIED**.
- **Nothing was run on Windows.** `pnpm run scan:windows` checks file names, path length, line endings and cmd.exe-safe scripts;
  that is a static check, not a Windows run.

## Run on your Windows PC (cmd.exe), stop at the first failure and send me the full output

```
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate:deploy
pnpm --filter @mafk/database exec prisma migrate status
pnpm db:seed
pnpm run verify
```

Expected: Node 22, pnpm 10.34.5; `db:generate` prints "Generated Prisma Client"; `migrate deploy` applies
`20261010190408_init`; `migrate status` says "Database schema is up to date"; `verify` ends with both scans PASSED.
Use a database you created for this (never reset or drop one that holds real data).

If `db:generate` or `migrate deploy` fails with a download or checksum error on your PC, copy the exact message. Do **not**
set `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING` and do not download engines from anywhere else.
Common causes: corporate proxy/antivirus blocking `binaries.prisma.sh` (allow it, or set `HTTPS_PROXY`), or a path with
very long/special characters (move the project to `C:\mafk`).

Then the browser test and the printers: `E2E.md`, `PRINTER-CHECKS.md`.
