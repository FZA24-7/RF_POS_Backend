# Deployment

How to run MAFK-24/7 Retail-Flow POS for real. Read `SECURITY-REVIEW.md` and the "NOT VERIFIED" list in `PHASE-7.md` first:
this project has **not** been run on real Windows hardware, with real printers, or at production load.

## Topology

```
 cashier PCs ── desktop app (apps/desktop) or browser (apps/web/dist)
        │                         │
        └──────── HTTPS ──────────┤
                                  ▼
                       reverse proxy (TLS)  ──►  API (apps/api, Node 22)  ──►  PostgreSQL 16
```

- **One server** runs PostgreSQL and the API (Windows or Linux). Cashier PCs only run the desktop app (or open the web app).
- The API does not terminate TLS. Put it behind a reverse proxy that does (Caddy, nginx, IIS ARR, a cloud load balancer) and set
  `TRUST_PROXY` to the number of proxy hops, so rate limiting and audit logs see real client IPs.
- HTTPS is **required** for real use: in production the refresh cookie is `Secure`, so without HTTPS sessions end when the
  access token expires. `http://localhost` is exempt.

## Server prerequisites

- Node.js 22.x and pnpm 10.34.5 (see `.nvmrc`, `package.json` `engines`)
- PostgreSQL 16 with a dedicated database and a dedicated login role (not a superuser) that owns it
- Outbound access to `binaries.prisma.sh` once, at build time (Prisma engines); see `PRISMA-AND-WINDOWS-STEPS.md`
- Environment variables from `ENVIRONMENT.md`, with **real** values supplied by the platform's secret store. Never commit them. The
  API refuses the dev-only values from `.env.example` when `NODE_ENV=production`.

## Build and migrate

```
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate:deploy
pnpm build
```

`db:migrate:deploy` applies the shipped migration non-interactively. Never use `migrate reset`, `db push --force-reset` or
`DROP DATABASE` on a database that holds real data.

## First run

1. Start the API: `node apps\api\dist\bin\server.js` (set `NODE_ENV=production` and the variables first).
2. Seed the permission catalog once: `pnpm db:seed`.
3. Create the first Master Admin once, from a trusted machine, then remove these variables from the environment:
   `MASTER_ADMIN_LOGIN_ID`, `MASTER_ADMIN_PASSWORD`, `MASTER_ADMIN_NAME`, then `pnpm bootstrap:master`.
4. Sign in as the Master Admin and create the first client (tenant).

## Web app

`pnpm --filter @mafk/web run build` creates `apps/web/dist` (static files). Serve it from the same reverse proxy. Build it with
`VITE_API_URL` set to the public API address (for example `https://pos.example.com/api`) and add the web origin to the API's
`CLIENT_URL` (comma separated).

## Desktop app

See `DESKTOP.md`. The desktop app needs no `CLIENT_URL` entry and no CORS; it is configured with the server address in-app.

## Keeping it running

- Run the API under a supervisor that restarts it (a Windows service wrapper such as NSSM, `systemd`, or a container runtime).
  This was **not** tested here.
- Allow the API port through the firewall only from the shop network (or expose just the reverse proxy).

## Backups (do this before you have real data)

Back up the database daily, keep copies off the server, and **test a restore**. Verified round trip in the build sandbox
(row counts of users, customers, tenants, stores matched after restore):

```
pg_dump -Fc -d <database> -f mafk-backup.dump
createdb <new_empty_database>
pg_restore --no-owner -d <new_empty_database> mafk-backup.dump
```

Restore into a **new** database, check it, and only then switch over; do not restore over a live database.

## Upgrades

1. Back up. 2. Stop the API. 3. Get the new version, `pnpm install --frozen-lockfile`, `pnpm db:migrate:deploy`, `pnpm build`.
2. Start the API. 5. Rebuild and redistribute the desktop installer if the shell or UI changed (there is no auto-update).

## Not covered

Containerisation, zero-downtime migrations, multi-instance scaling (the login rate limiter is per process; the per-account
lockout is database-backed and safe across instances), monitoring and alerting, and disaster-recovery drills.
