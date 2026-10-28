# Windows setup with Command Prompt (cmd.exe)

Everything below uses **cmd.exe** (not PowerShell). There is **no `.env` file**: the API, seed, bootstrap and Prisma
read the repo-root **`.env.example`** automatically for local development (real environment variables you `set`
always win, and nothing is read when `NODE_ENV=production`). The dev-only values in it match the database created in
step 3.

> Honesty note: these commands were written for cmd.exe and checked against the project's files; the same flow
> (migration, seed, bootstrap, API, login page, reload, sign-out) was run on Linux against PostgreSQL 16. The cmd.exe
> syntax itself has not been executed on Windows by the author.

## 1. Requirements

| Tool       | Version                                                             |
| ---------- | ------------------------------------------------------------------- |
| Node.js    | 22.22.2 recommended; `>=22.12.0 <23` accepted (`.nvmrc`, `engines`) |
| pnpm       | exactly 10.34.5 - `npm install -g pnpm@10.34.5`                     |
| PostgreSQL | 16 (installs `psql`)                                                |

## 2. Extract and open Command Prompt in the project root

Extract the ZIP to a **short path**, e.g. `C:\dev\mafk-pos` (right-click -> Extract All). `package.json` must sit
directly inside that folder. Then:

```
cd /d C:\dev\mafk-pos
dir package.json
node --version
pnpm --version
```

### Windows-specific safeguards built into the project

- `pnpm run scan:windows` (also part of `pnpm run verify`) statically checks that no file name, path length, case collision,
  symlink, CRLF line ending or `package.json` script would break a Windows checkout or cmd.exe. It runs on any OS.
- `.gitattributes` forces LF line endings; `.editorconfig` and Prettier `endOfLine: lf` match. No `.sh` scripts exist.
- Optional: enable Windows long paths (Administrator Command Prompt, then reboot):
  `reg add HKLM\SYSTEM\CurrentControlSet\Control\FileSystem /v LongPathsEnabled /t REG_DWORD /d 1 /f`.
- Antivirus real-time scanning can slow `pnpm install` a lot; excluding the project folder helps.

## 3. Create the local database (once)

Add `psql` to PATH for this window (default install folder shown) and connect as the `postgres` superuser (it asks
for the password you chose when installing PostgreSQL):

```
set "PATH=%PATH%;C:\Program Files\PostgreSQL\16\bin"
psql -U postgres -h localhost -d postgres
```

At the `postgres=#` prompt:

```
CREATE ROLE mafk WITH LOGIN CREATEDB PASSWORD 'mafk_local_dev';
CREATE DATABASE mafk_pos OWNER mafk;
CREATE DATABASE mafk_pos_test OWNER mafk;
\q
```

`mafk_local_dev` is the dev-only password already written in `.env.example`. Use it only on your own PC. If a role or
database with these names already exists, do **not** drop it - pick other names and edit the two URLs in
`.env.example`.

## 4. Install, generate, migrate, build

```
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate:deploy
pnpm build
```

- `db:generate` creates the Prisma client; `db:migrate:deploy` applies the **shipped** migration
  `packages/database/prisma/migrations/20261010190408_init/migration.sql` (no new migration is created).
- Both need Prisma's engine download from `binaries.prisma.sh`; if your network blocks it, see
  `docs/TROUBLESHOOTING.md` (do not work around it with mirrors or checksum overrides).

## 5. Seed and create the first Master Admin

```
pnpm db:seed
set "MASTER_ADMIN_PASSWORD=choose-your-own-strong-password"
pnpm bootstrap:master
set "MASTER_ADMIN_PASSWORD="
```

Avoid `& ^ % " <` in the password (cmd.exe treats them specially). The Login ID comes from `.env.example`
(`owner.admin`). The password is never stored in a file. Expected output: `Seed complete. Permission catalog: 189/189
entries ensured.` and `Master Admin "owner.admin" created.`

## 6. Run it (two Command Prompt windows, both in the project root)

Window 1 - API (port 4000):

```
pnpm dev:api
```

Window 2 - web app (port 5173):

```
pnpm dev:web
```

Open <http://localhost:5173>, sign in as `owner.admin` with the password you chose. Reload the page: you stay signed
in. How the login screen and database fit together: `apps/web/src/LOGIN/LOGIN.md`.

## 7. Optional checks

```
pnpm test
set "DATABASE_URL=postgresql://mafk:mafk_local_dev@localhost:5432/mafk_pos_test"
pnpm db:migrate:deploy
set "DATABASE_URL="
pnpm --filter @mafk/api run test:integration
```

`pnpm test` needs no database (shared 85, API 285, web 34 expected). The last command runs the 49 real-PostgreSQL
tests (purchase integrity 10, sale/refund integrity 13, product create 1, Phase 6 contract 25) against `mafk_pos_test` (read from `.env.example`); `skipped` is **not** a pass.

## 8. Troubleshooting (cmd.exe)

| Symptom                                                          | Fix                                                                                                                   |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `'pnpm' is not recognized`                                       | Reopen Command Prompt after installing Node; `npm install -g pnpm@10.34.5`                                            |
| `ERR_PNPM_UNSUPPORTED_ENGINE`                                    | Wrong Node version - install Node 22.x                                                                                |
| `'psql' is not recognized`                                       | Run the `set "PATH=..."` line in step 3 in the same window                                                            |
| `password authentication failed for user "mafk"`                 | The role password must equal the one in `.env.example`; `ALTER ROLE mafk PASSWORD 'mafk_local_dev';` as `postgres`    |
| `Can't reach database server` / `ECONNREFUSED`                   | PostgreSQL service not running (`sc query postgresql-x64-16`), or a different port                                    |
| `permission denied to create database`                           | `ALTER ROLE mafk CREATEDB;` as `postgres`                                                                             |
| `Failed to fetch sha256 checksum ... binaries.prisma.sh ... 403` | Network/proxy blocks Prisma's CDN - see `docs/TROUBLESHOOTING.md`                                                     |
| `Invalid environment configuration`                              | A required value is missing from `.env.example` or overridden with a blank `set X=`                                   |
| Login says `Cannot reach the server`                             | API window not running, or `CLIENT_URL` does not match the web origin (`http://localhost:5173`)                       |
| `MASTER_ADMIN_LOGIN_ID and MASTER_ADMIN_PASSWORD must be set`    | Run the `set "MASTER_ADMIN_PASSWORD=..."` line first                                                                  |
| `Refusing to run ... does not contain "test"`                    | `TEST_DATABASE_URL` must name a database containing `test`                                                            |
| `ENAMETOOLONG` / `EPERM` / path-too-long during `pnpm install`   | Project folder is too deep. Move it to `C:\dev\mafk-pos`, or enable long paths (below)                                |
| `ECONNREFUSED ::1:5432` but PostgreSQL is running                | `localhost` resolved to IPv6. Use `127.0.0.1` in `DATABASE_URL` (`set "DATABASE_URL=postgresql://...@127.0.0.1:..."`) |
| Windows Firewall prompt when the API starts                      | Allow Node.js on **Private** networks (it only listens on `localhost`)                                                |
| `prettier --check` lists many files after a Git checkout         | CRLF line endings. The repo ships `.gitattributes` (`eol=lf`); run `git add --renormalize .` or re-extract the ZIP    |
| `argon2` install/build error                                     | Needs Windows x64/ARM64 prebuilt binaries via the registry; check proxy/antivirus. No compiler is normally needed     |

Never use `prisma migrate reset`, `db push --force-reset` or `DROP DATABASE` on a database you did not just create for
this purpose.

## 9. Desktop app (optional)

With the API running (section 6), in the same project folder:

```
pnpm desktop
```

The app window opens. If the server is not `http://localhost:4000`, use **File > Server settings** (`Ctrl+,`) and enter the
server's address (for example `http://192.168.1.10:4000`). To build the installer: `pnpm desktop:dist` (output in
`apps\desktop\release\`). Details, firewall and HTTPS notes: `DESKTOP.md`. This has **not** been run on Windows yet; send me the
first command that fails.
