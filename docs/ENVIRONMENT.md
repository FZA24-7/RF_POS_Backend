# Environment variables

Source of truth for parsing/validation: `apps/api/src/config/env.ts` (Zod
schema - the API refuses to boot if these are missing or malformed). Template
with local dev-only values: `.env.example` at the repo root.

| Variable                    | Required                                 | Side        | Default       | Notes                                                                                                        |
| --------------------------- | ---------------------------------------- | ----------- | ------------- | ------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                  | No                                       | Server      | `development` | `development` \| `test` \| `production`                                                                      |
| `PORT`                      | No                                       | Server      | `4000`        | API listen port                                                                                              |
| `DATABASE_URL`              | **Yes**                                  | Server-only | -             | PostgreSQL connection string                                                                                 |
| `TEST_DATABASE_URL`         | **Yes** (for tests that touch a real DB) | Server-only | -             | Must be a **different** database from `DATABASE_URL`                                                         |
| `JWT_SECRET`                | **Yes**                                  | Server-only | -             | ≥32 random chars. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `ACCESS_TOKEN_TTL_MINUTES`  | No                                       | Server      | `15`          | JWT access token lifetime                                                                                    |
| `REFRESH_TOKEN_TTL_DAYS`    | No                                       | Server      | `14`          | Refresh-session lifetime                                                                                     |
| `CLIENT_URL`                | **Yes**                                  | Server-only | -             | Allowed CORS origin(s), comma-separated                                                                      |
| `API_URL`                   | No                                       | Server      | -             | Informational; used in docs/links only                                                                       |
| `TRUST_PROXY`               | No                                       | Server      | `0`           | Number of reverse-proxy hops to trust for client IP                                                          |
| `LOGIN_MAX_FAILED_ATTEMPTS` | No                                       | Server      | `5`           | Failed attempts before per-account lockout                                                                   |
| `LOGIN_LOCKOUT_MINUTES`     | No                                       | Server      | `15`          | Lockout window length                                                                                        |
| `ARGON2_MEMORY_KIB`         | No                                       | Server-only | `65536`       | Argon2id memory cost                                                                                         |
| `ARGON2_TIME_COST`          | No                                       | Server-only | `3`           | Argon2id iterations                                                                                          |
| `MASTER_ADMIN_LOGIN_ID`     | Bootstrap only                           | Server-only | -             | Used **only** by `pnpm bootstrap:master`; remove after running                                               |
| `MASTER_ADMIN_PASSWORD`     | Bootstrap only                           | Server-only | -             | Same as above                                                                                                |
| `MASTER_ADMIN_NAME`         | Bootstrap only                           | Server-only | -             | Same as above                                                                                                |

## Rules this repo follows

- Nothing above is hardcoded in source. For LOCAL development `.env.example` carries dev-only placeholder values and
  is loaded automatically (`packages/database/src/load-example-env.ts`): real environment variables always win, and
  nothing is loaded when `NODE_ENV=production`. There is no `.env` file in this project.
- In production `loadEnv` rejects the dev-only `JWT_SECRET` and the dev-only database password from `.env.example`.
- `MASTER_ADMIN_PASSWORD` has no default anywhere; supply it for the one bootstrap command (e.g. cmd.exe:
  `set "MASTER_ADMIN_PASSWORD=..."`).
- No variable prefixed for client exposure (e.g. `VITE_*`) is defined yet
  because `apps/web` doesn't exist in Phase 1. When it does, only
  explicitly-`VITE_`-prefixed variables will ever reach the browser bundle -
  `JWT_SECRET`, `DATABASE_URL`, and the `MASTER_ADMIN_*` bootstrap variables
  must never be given that prefix.
- A real `.env` file is not used. `scripts/secret-scan.mjs` still fails the build if one is present in the packaged
  output, and `.env` stays git-ignored.
