# Browser end-to-end test (Phase 6 screens)

`e2e/phase6.e2e.mjs` drives a **real browser** through the Phase 6 screens against the **real API and real PostgreSQL**
(no mocks): supplier opening balance and ledger, customer with credit limit, POS sale on account (and its 58 mm / 80 mm /
A4 receipt), credit-limit refusal, customer payment and refused overpayment, expenses, employees, ten reports, CSV export and
analytics. It creates its own throwaway tenant with a random password on every run and checks figures that were computed by
hand (ledger 1650.00, customer balance 350.00 then 230.00, expenses 70.00, P&L 400.00 - 240.00 - 70.00 = 90.00).

It writes data. **Only run it against a database you created for testing** (name containing `test`).

## Prerequisites

The normal setup from `SETUP-WINDOWS-CMD.md`: database migrated, `pnpm db:seed`, Master Admin created with
`pnpm bootstrap:master`, API running (`pnpm dev:api`), web running (`pnpm dev:web`). If the API is not on port 4000, start the
web app with `VITE_API_URL` pointing at it. Install the dev dependency once: `pnpm install`.

## Run (cmd.exe)

```
set E2E_MASTER_LOGIN_ID=owner.admin
set E2E_MASTER_PASSWORD=<the Master Admin password you chose when bootstrapping>
set E2E_CHANNEL=msedge
pnpm run e2e
```

`E2E_CHANNEL` can be `chrome` or `msedge` (uses the browser already installed - no download). Alternatives:
`E2E_CHROMIUM=<full path to a chrome executable>`. Optional: `E2E_API_URL` (default `http://localhost:4000/api`),
`E2E_WEB_URL` (default `http://localhost:5173`), `E2E_SCREENSHOT_DIR` (saves a screenshot if the run aborts).

The script exits non-zero when any check fails. Never put the password in a file that is committed.

## What this does NOT prove

- It does not print on paper. See `PRINTER-CHECKS.md`.
- It ran on Linux in the build sandbox (Chromium). It has **not** been run on Windows.

## Desktop app E2E (`e2e/desktop.e2e.mjs`)

Launches the **real Electron app** (source build, or a packaged build with `E2E_PACKAGED=1`) against the real API and PostgreSQL:
isolation (no `require`/`process` in the page, fixed bridge API), CSP and path-traversal checks, sign-in through the proxy,
a Phase 6 screen, session survival after reload, the server-settings window (bad address, unreachable address, save anyway),
a dead server producing a readable error, recovery, sign-out, and blocked navigation, popups and permission requests.

Build first: `pnpm --filter @mafk/web run build` and `pnpm --filter @mafk/desktop run build`. Then (cmd.exe):

```
set E2E_MASTER_LOGIN_ID=owner.admin
set E2E_MASTER_PASSWORD=<the Master Admin password you chose>
set E2E_API_URL=http://localhost:4000/api
pnpm run e2e:desktop
```

On headless Linux run it under a virtual display: `xvfb-run -a pnpm run e2e:desktop`. To test an installed/packaged app set
`E2E_PACKAGED=1` and `E2E_ELECTRON=<full path to MAFK-RetailFlow-POS.exe>`. It creates a throwaway tenant, writes data, and
uses a temporary user-data folder, so it never touches your real desktop settings. Only run it against a test database.
It has **not** been run on Windows.
