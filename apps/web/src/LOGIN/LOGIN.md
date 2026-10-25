# LOGIN - the sign-in screen and its role in the database

This folder is the whole sign-in feature of the web app. Everything here was exercised end to end in a real
browser against a real PostgreSQL database (see "How it was verified" at the bottom).

## 1. What is in this folder

| File                 | Purpose                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `LoginPage.tsx`      | Full-page layout (title, card). Shown by `App.tsx` whenever there is no signed-in session.             |
| `LoginForm.tsx`      | The form: Login ID, password, show/hide, validation, error banner, loading state, double-submit guard. |
| `loginValidation.ts` | Client-side checks (same Login ID rule as the server: `@mafk/shared` `isValidLoginIdFormat`).          |
| `loginErrors.ts`     | Turns an API error code into one safe sentence. Never says whether a Login ID exists.                  |
| `index.ts`           | Public exports (`LoginPage`, `LoginForm`, helpers).                                                    |
| `LoginPage.test.tsx` | 12 behaviour tests (fetch is replaced by a small in-test router).                                      |
| `LOGIN.md`           | This document.                                                                                         |

Session state itself lives next to the other app state in `../state/auth.tsx` (`AuthProvider`, `useAuth`) because
every signed-in page uses it. The folder owns the screen; the provider owns the session.

## 2. What the user sees and can do

- **Login ID** and **Password** fields, a **show/hide password** toggle, and a **Sign in** button. Enter submits.
- Before any request is sent: an empty Login ID, a malformed Login ID (3-32 characters: letters, digits, `.` `_` `-`,
  starting with a letter or digit) or an empty password shows an inline message and focuses the offending field.
- While the request is in flight the fields and button are disabled and the button reads "Signing in...". A second
  submit (double click, Enter + click) is ignored, so exactly one request is sent.
- On failure: one red message above the form, the password field is cleared and focused again, the Login ID is kept.
- On success: the app switches to the signed-in shell (Master Admin dashboard, or the tenant menu for tenant users).
- **Reload keeps you signed in.** On first load the app shows "Checking your session..." while it silently asks the
  API whether the refresh cookie is still valid; only if not does it show this form.
- **Sign out** (in the header) revokes the session on the server; reloading afterwards shows this form again.
- There is **no "forgot password"** flow in this release - the screen says to ask an administrator.

### Error messages

| Server code (HTTP)          | Message shown                                                                 |
| --------------------------- | ----------------------------------------------------------------------------- |
| `INVALID_CREDENTIALS` (401) | Invalid Login ID or password. (same text for unknown user and wrong password) |
| `ACCOUNT_LOCKED` (423)      | Too many failed attempts. Please wait a few minutes and try again.            |
| `ACCOUNT_DISABLED` (403)    | This account has been disabled. Please contact your administrator.            |
| `TENANT_SUSPENDED` (403)    | This account is currently unavailable. Please contact your administrator.     |
| `RATE_LIMITED` (429)        | Too many requests. Please wait a moment and try again.                        |
| `VALIDATION_ERROR` (422)    | Please check your Login ID and password.                                      |
| any 5xx                     | The server had a problem. Please try again in a moment.                       |
| network failure             | Cannot reach the server. Check your connection and try again.                 |

## 3. How a sign-in works

```
Browser                                API (Express)                              PostgreSQL
  | POST /api/auth/login {loginId,pw}     |                                          |
  |-------------------------------------->| rate limit (30 / 15 min / IP)            |
  |                                       | count recent failures for this Login ID ->| login_attempts
  |                                       | find user by Login ID  ------------------>| users
  |                                       | status ACTIVE? tenant ACTIVE?  ---------->| users, tenants
  |                                       | verify Argon2id hash                      |
  |                                       | load role + permission keys  ------------>| roles, role_permissions, permissions
  |                                       | create session (refresh-token HASH) ----->| sessions
  |                                       | stamp last login; record attempt; audit ->| users, login_attempts, audit_logs
  |<--------------------------------------| 200 {accessToken, user}  +  Set-Cookie: mafk_refresh_token (httpOnly)
  | keeps accessToken in memory only      |                                          |
```

- The **access token** (JWT, 15 minutes by default) carries: user id, tenant id, session id, system role and the
  permission keys. It is kept **only in memory** in the browser (never `localStorage`).
- The **refresh token** is a random value stored in an **httpOnly, SameSite=Lax cookie** scoped to `/api/auth`
  (`Secure` in production). The database stores only its **hash**, never the token.
- On reload: `POST /api/auth/refresh` (cookie) rotates the refresh token and returns a new access token, then
  `GET /api/auth/me` returns the profile. If either fails the form is shown.
- On a 401 during normal use, the API client tries exactly one silent refresh and retries once.

### Endpoints used

| Endpoint                 | Auth           | Result                                                                                 |
| ------------------------ | -------------- | -------------------------------------------------------------------------------------- |
| `POST /api/auth/login`   | none           | `200 {accessToken, user}` + refresh cookie; errors as above                            |
| `POST /api/auth/refresh` | refresh cookie | `200 {accessToken}` + rotated cookie; `401 SESSION_REVOKED`                            |
| `GET /api/auth/me`       | Bearer token   | `200 {user}` (never contains the password hash); `401` if the user is disabled or gone |
| `POST /api/auth/logout`  | refresh cookie | `204`; session revoked, cookie cleared                                                 |

`user` = `{ id, tenantId, loginId, displayName, systemRole }`. `tenantId` is `null` for platform users.

## 4. The role of login in the database

Login reads and writes these tables (names are the real PostgreSQL table names; defined in
`packages/database/prisma/schema.prisma`, created by `prisma/migrations/*_init/migration.sql`).

### Who may sign in: `users`

| Column                                    | Role in login                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `loginId`                                 | What the user types. Stored lower-case and trimmed; globally unique. Rules: 3-32 chars `[a-z0-9._-]`. |
| `passwordHash`                            | Argon2id hash (starts with `$argon2id$`). The plain password is never stored or logged.               |
| `status`                                  | `ACTIVE` or `DISABLED`. Anything but `ACTIVE` is refused with `ACCOUNT_DISABLED`.                     |
| `tenantId`                                | `NULL` = platform user (Master Admin). Otherwise the client business the user belongs to.             |
| `roleId`                                  | Which role the user has (see below).                                                                  |
| `lastLoginAt`                             | Stamped on each successful sign-in.                                                                   |
| `mustChangePassword`, `passwordChangedAt` | Reserved for the password-change flow (not part of this release's UI).                                |

### What a user may do: `roles` -> `role_permissions` -> `permissions`

```
users.roleId ---> roles.id          roles.systemRole = MASTER_ADMIN | CLIENT_MASTER_ADMIN | MANAGER
                    |                                  | CASHIER | INVENTORY_STAFF | CUSTOM
                    +--< role_permissions >--- permissions.key   e.g. "purchases.view", "users.manage"
```

- `roles.tenantId` is `NULL` only for the platform's `master-admin` role; every client tenant gets **its own copy**
  of each role (`client-master-admin`, `manager`, `cashier`, `inventory-staff`), so editing one tenant's role never
  affects another tenant.
- `users.roleId` is a plain foreign key. (Earlier it was a composite `(roleId, tenantId)` key, which could not join for
  platform users whose `tenantId` is `NULL`; the Master Admin loaded with no role. Fixed and covered by a real-database
  run.) Tenant/role consistency is enforced by the provisioning code, not by the key.
- At sign-in the API collects the role's permission keys, keeps only keys that exist in the central catalogue
  (`PERMISSION_CATALOG`, 189 entries seeded by `pnpm db:seed`) and puts them in the access token. Routes check them
  with `requirePermission(...)`. The seeded Master Admin role holds 20 platform-level permissions.
- Login proves **who** you are; the role decides **what** you may do. Neither lets a tenant user see another tenant:
  the tenant id comes from the verified token, never from the request.

### Proof and history of sign-ins

| Table              | What login writes                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessions`         | One row per sign-in: `refreshTokenHash` (unique), `userAgent`, `ipAddress`, `expiresAt` (14 days by default), `revokedAt`/`revokedReason` (`LOGOUT`). Refresh rotates the hash. |
| `login_attempts`   | One row per attempt: `loginId`, `success`, `failureReason` (`INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`, `ACCOUNT_DISABLED`, `TENANT_SUSPENDED`), ip, user agent.                   |
| `audit_logs`       | `AUTH_LOGIN` and `AUTH_LOGOUT` (entity `User`) for the user's tenant (or `NULL` for platform users).                                                                            |
| `login_id_history` | Written when an administrator changes someone's Login ID (old -> new, who, why); not by sign-in itself.                                                                         |
| `tenants`          | Read: a tenant user is refused (`TENANT_SUSPENDED`) when their tenant is not `ACTIVE`.                                                                                          |

### Lockout rule (uses `login_attempts`)

Before checking the password the API counts **failed** attempts for that Login ID in the last
`LOGIN_LOCKOUT_MINUTES` (default 15). At `LOGIN_MAX_FAILED_ATTEMPTS` (default 5) it refuses with `ACCOUNT_LOCKED`
(HTTP 423) and records that refusal too. A separate per-IP limiter allows 30 requests per 15 minutes on the login and
refresh endpoints.

### Looking at it yourself (psql, read-only)

```sql
-- who exists and what role they hold
select u."loginId", u.status, u."tenantId", r.key as role, r."systemRole",
       (select count(*) from role_permissions rp where rp."roleId" = r.id) as permissions
from users u join roles r on r.id = u."roleId";

-- recent sign-in attempts
select "loginId", success, "failureReason", "createdAt" from login_attempts order by "createdAt" desc limit 20;

-- sessions (hash prefix only) and audit trail
select left("refreshTokenHash", 6) as hash, "expiresAt", "revokedReason" from sessions order by "createdAt" desc;
select action, entity, "createdAt" from audit_logs order by "createdAt" desc limit 20;
```

## 5. Creating the first user

There is no built-in account. Create the first Master Admin explicitly (cmd.exe):

```
set MASTER_ADMIN_PASSWORD=<choose your own strong password>
pnpm bootstrap:master
```

`MASTER_ADMIN_LOGIN_ID` (`owner.admin`) and `MASTER_ADMIN_NAME` come from `.env.example`; the password is never
stored in any file. The script creates the `master-admin` role (with its permissions) if missing, then the user.
Everything else (tenants, their admins, staff) is created from the signed-in Master Admin screens / API.

## 6. Security notes

- Same message for "no such user" and "wrong password"; no user-enumeration through wording.
- Passwords: Argon2id. Refresh tokens: only a hash is stored. Access token: memory only.
- A rejected password is cleared from the field immediately.
- All server rules are authoritative; the client checks only save a round trip.

## 7. Known limitations (not hidden)

- No self-service password reset, change-password screen, or two-factor sign-in yet.
- The failed-attempt counter does not reset after a success; it is simply "failures in the last N minutes".
- Anyone can deliberately lock a known Login ID for the lockout window by failing 5 times (an inherent trade-off of
  per-account lockout; the per-IP limiter only partly mitigates it).
- A signed-out access token stays valid until it expires (max 15 minutes); the refresh cookie is revoked at once.

## 8. How it was verified

- `pnpm --filter @mafk/web test` - the 12 tests in `LoginPage.test.tsx` (validation, messages, restore, double submit,
  focus handling). These use a stubbed `fetch`; they test the screen, not the server.
- `pnpm --filter @mafk/api test` - server login rules, `/auth/me`, lockout, disabled user, tenant suspension.
- A manual run in headless Chromium against the built web app, the built API and a real PostgreSQL 16 database
  (migration applied, seed + bootstrap run): empty-field errors, wrong password message + cleared/refocused field,
  successful sign-in, reload keeps the session, sign-out revokes it. The database rows listed in section 4 were
  confirmed with the `psql` queries above.
