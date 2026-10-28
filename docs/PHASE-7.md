# Phase 7: desktop app, final documentation, final security review

## What this phase added

- **Electron desktop shell** (`apps/desktop`, `DESKTOP.md`): sandboxed, same-origin app scheme, main-process proxy to the
  configured server, server-settings window, Windows installer configuration (NSIS, `MAFK-RetailFlow-POS.exe`).
- **Final security review** (`SECURITY-REVIEW.md`) with new automated checks: `pnpm run scan:security` and a route-authorization
  sweep over every registered API route (`apps/api/tests/http/route-authz.test.ts`). Dependency audit: 7 findings, 5 fixed with
  patched releases, 2 accepted (no fix exists, build tooling only).
- **Final documentation:** rewritten `DEPLOYMENT.md` (topology, HTTPS, backup/restore, upgrades), `DESKTOP.md`,
  `SECURITY-REVIEW.md`, this file, and updates to `README.md`, `SETUP-WINDOWS-CMD.md`, `E2E.md`, `TESTING.md`, `RELEASE.md`.
- **Web app:** uses the desktop's same-origin `/api` when inside the shell (browser behaviour unchanged); the login page explains
  an unreachable server.
- **Windows:** path-safe static serving tested with Windows path rules; cmd.exe-only scripts (`pnpm desktop`, `pnpm desktop:dist`).

## Verified in the build sandbox (Linux)

| Check                                                                                    | Result                                   |
| ---------------------------------------------------------------------------------------- | ---------------------------------------- |
| `pnpm run verify` (typecheck, ESLint, Prettier, all unit/HTTP tests, builds, 3 scans)    | passes (see `TESTING.md` for the counts) |
| Real PostgreSQL 16 integration suite                                                     | 49/49                                    |
| Phase 6 browser E2E (real Chromium, real API + PostgreSQL)                               | 33/33                                    |
| Desktop E2E (real Electron under a virtual display, real API + PostgreSQL), source build | 28/28                                    |
| Same desktop E2E against the **packaged** (unpacked Linux) app                           | 28/28                                    |
| `pnpm audit`                                                                             | 2 accepted findings remain               |
| Backup, restore into a new database, row counts compared                                 | matched                                  |

## NOT VERIFIED (cannot be done in the build sandbox)

1. **Anything on real Windows**: install, run, the cmd.exe guide, the desktop app, file paths.
2. **The Windows installer**: `pnpm desktop:dist` (NSIS) was not built; only an unpacked Linux build of the same configuration was.
   Install/uninstall, shortcuts and SmartScreen behaviour are untested. The installer is unsigned.
3. **Official Prisma engine download/migrate/generate** (blocked in the sandbox, no workaround used). The dependency overrides touch
   the Prisma CLI's helper packages; see `SECURITY-REVIEW.md` for the one-line rollback.
4. **Physical printers** and the Windows print dialog (`PRINTER-CHECKS.md`); CSV download through the native save dialog.
5. **Load, soak, performance at scale, external penetration testing.**
6. **HTTPS reverse-proxy setups, service supervision, multi-instance operation, monitoring.**

## Do this on your Windows PC, in order (cmd.exe). Stop at the first failure and send me the full output.

```
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate:deploy
pnpm run verify
pnpm desktop        (first run downloads the Electron program, about 100 MB)
```

Then: **File > Server settings**, enter your API address, sign in, make a test sale, print the receipt to your printer
(`PRINTER-CHECKS.md`). Then `pnpm desktop:dist` and run the installer from `apps\desktop\release\`.
For the browser and desktop E2E scripts see `E2E.md`.
