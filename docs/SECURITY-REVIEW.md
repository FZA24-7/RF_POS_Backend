# Final security review (Phase 7)

Scope: API, web app, desktop shell, database access, configuration and dependencies, as of this release.
Method: automated checks that run on every `pnpm run verify`, runtime tests, a dependency audit, and manual review of the
areas below. This is an **engineering review, not an independent penetration test**, and it does not make the project
"production-ready" (see `PHASE-7.md` for what is still unverified).

## What is enforced automatically

| Check                                           | Where                                        | What it catches                                                                                                                                                                                             |
| ----------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run scan:secrets`                         | `scripts/secret-scan.mjs`                    | committed keys, tokens, passwords, private keys                                                                                                                                                             |
| `pnpm run scan:security`                        | `scripts/security-scan.mjs`                  | weakened Electron flags, raw-HTML/eval/`Math.random`/TLS-off/secret-in-storage patterns, missing helmet/body limit/httpOnly+Secure cookie, unexpected install-script packages                               |
| Route authorization sweep                       | `apps/api/tests/http/route-authz.test.ts`    | enumerates **every registered route** from the live Express app: anonymous and garbage-token calls must get 401; tenant users get 403 on every `/api/master` route (proved to fail on a planted open route) |
| Tenant isolation, permissions, money, rollbacks | API contract suites (fake + real PostgreSQL) | cross-tenant reads/writes, permission gating, atomic transactions, no floating-point money                                                                                                                  |
| Desktop hardening                               | `e2e/desktop.e2e.mjs`, `apps/desktop/tests`  | isolation, CSP, blocked navigation/popups/permissions, settings-only server change, path traversal                                                                                                          |
| `pnpm audit`                                    | manual, see below                            | known-vulnerable dependencies                                                                                                                                                                               |

## Controls reviewed

- **Authentication:** Argon2id hashing; short-lived JWT access token held in memory only (never browser storage); rotating
  opaque refresh token in an `httpOnly`, `SameSite=Lax` cookie, `Secure` in production; per-IP rate limiting and per-account
  lockout; "unknown user" and "wrong password" are indistinguishable.
- **Authorization:** every route requires a token; permissions come from one central catalog; tenant id is taken from the token,
  never from the request; composite tenant-scoped foreign keys at the database level.
- **Input validation:** Zod schemas at every boundary; money is decimal strings (no floating point); impossible calendar dates
  are rejected (fixed in 6.1); JSON body limit 1 MB.
- **Output:** CSV export neutralises formula cells; CSP and security headers via helmet on the API; strict CSP in the desktop shell.
- **Secrets:** none committed; `.env.example` holds clearly labelled dev-only values that the API **refuses to start with in
  production**; no `.env` file is shipped.
- **Transport:** the API must be served over HTTPS in production (the refresh cookie is `Secure`). The project does not terminate TLS itself.
- **Desktop:** see `DESKTOP.md`. Renderer is sandboxed and isolated, the app can only reach the server the administrator configured,
  and the page cannot change that address.
- **Supply chain:** pnpm lockfile, `--frozen-lockfile` in clean builds, install scripts allowed only for a short allow-list
  (argon2, esbuild, prisma, @prisma/engines, @prisma/client, electron) and checked by `scan:security`. No checksum bypass, mirror
  or unverified binary is used anywhere.

## Dependency audit (`pnpm audit`, at release)

Before the review: 7 findings (4 high, 3 moderate), all in build/dev tooling and none in code that ships to a browser or the API.

Fixed by raising transitive packages to patched releases (`overrides` in `pnpm-workspace.yaml`; full verify, tests and the
production CSS output were unchanged): `mysql2` (2 findings, reached only through the Prisma CLI), `deepmerge-ts` (Prisma CLI config),
`source-map-js` (jsdom, test-only), `postcss-selector-parser` (Tailwind build).

**Accepted, no fixed version exists:**

| Package      | Severity | Reached through                        | Why accepted                                                                     |
| ------------ | -------- | -------------------------------------- | -------------------------------------------------------------------------------- |
| `braces`     | high     | Tailwind > chokidar (dev file watcher) | a regex DoS on crafted glob input in a developer tool; not in any shipped bundle |
| `sprintf-js` | moderate | electron-builder > roarr (build tool)  | DoS on crafted format strings in the installer builder; not in the installed app |

Re-run `pnpm audit` before each release; new advisories appear continuously.

**Overrides touch the Prisma CLI's dependencies.** The Prisma config still loads and the client generates in the sandbox, but the
official engine download could not be exercised there (`PRISMA-AND-WINDOWS-STEPS.md`). If `pnpm db:generate` fails on your PC after
`pnpm install`, remove the `deepmerge-ts` line from `overrides` in `pnpm-workspace.yaml`, run `pnpm install` again, and report it.

## Found and fixed during the project's final phases

- Impossible dates such as `2026-02-30` were accepted and rolled over silently (6.1): now 422, with a regression test.
- `typecheck` failed on a clean checkout because libraries were not built first (6): fixed.
- A refresh cookie cannot survive a cross-origin desktop UI; avoided by design (same-origin app scheme and main-process proxy).

## Known limitations and risks (not fixed)

- No external penetration test, no fuzzing, no load or soak testing; report performance at large data volumes is unmeasured.
- Rate limiting is in-memory per API process: with several API instances the limits are per instance.
- The Windows installer is unsigned; there is no auto-update, so Chromium/Electron security fixes reach cashier PCs only when you
  rebuild and redistribute the installer. Plan a routine for that.
- Real Windows behaviour, the Windows print path and physical printers are not verified (`PHASE-7.md`).
- Database backups, disk encryption and server hardening are the operator's responsibility (`DEPLOYMENT.md`).
