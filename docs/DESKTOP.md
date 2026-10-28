# Desktop app (Electron, Windows)

`apps/desktop` is a **client only**. It shows the same screens as the browser app in its own window and talks to the
**API server** (Node + PostgreSQL) that runs on the shop's server PC or hosting. Nothing about the database lives on the
cashier PC.

```
 cashier PC (Windows)                               server PC / hosting
 ┌─────────────────────────────┐   http(s)         ┌──────────────────────┐
 │ MAFK-RetailFlow-POS.exe     │ ───────────────►  │ API (Express)        │ ──► PostgreSQL 16
 │  UI from mafk-app://local   │  /api/* proxied   └──────────────────────┘
 └─────────────────────────────┘  by the app
```

## How it works (and why)

- The UI is the built web app (`apps/web/dist`), served from a private scheme `mafk-app://local`. No remote code is loaded.
- Requests to `mafk-app://local/api/...` are forwarded by the desktop app to the configured server. The page therefore only ever
  talks to its own origin: no CORS configuration is needed, and the server's `SameSite=Lax` refresh cookie keeps working
  (a page on another origin would silently lose its session when the access token expires).
- The server address is stored in `%APPDATA%\MAFK Retail-Flow POS\config.json` (shown in the app under **File > Server
  settings**, `Ctrl+,`). The address is validated (http/https only, no credentials, no path), tested against `/api/health`, and
  changing it signs the old session out.
- Printing uses the normal Windows print dialog (`Ctrl+P` / the Print button on receipts). See `PRINTER-CHECKS.md`.

## Security settings

`contextIsolation` and `sandbox` on, `nodeIntegration` off, `webSecurity` on, all permission requests (camera, location, ...) denied,
navigation away from the app blocked, `window.open` denied (only `https://` links open in the system browser), webviews blocked,
single instance, DevTools only in unpackaged builds, a strict Content-Security-Policy on every page, path-traversal-safe file
serving, and a fixed, minimal preload API. Only the settings window may change the server address. These settings are enforced by
`pnpm run scan:security` and by the desktop E2E test. Details: `SECURITY-REVIEW.md`.

## Run it (cmd.exe, from the project folder)

First do the normal setup (`SETUP-WINDOWS-CMD.md`), with the API running somewhere. Then:

```
pnpm install
pnpm desktop
```

`pnpm desktop` builds the web app and the shell and opens the window. If the server is not on `http://localhost:4000`, open
**File > Server settings** and enter its address, for example `http://192.168.1.10:4000`.

The Electron program itself (about 100 MB) is **not** downloaded by `pnpm install`. `pnpm desktop` fetches it the first time
(`pnpm --filter @mafk/desktop run setup`, checksum-verified by Electron's own tooling from GitHub releases) and does nothing on
later runs. A machine that must stay offline can copy `apps\desktop\node_modules\electron\dist` from a prepared machine.

## Build the Windows installer (on Windows)

```
pnpm desktop:dist
```

The installer is written to `apps\desktop\release\` (NSIS, x64, per-user, lets the user choose the folder, creates a desktop and a
Start-menu shortcut; the executable is `MAFK-RetailFlow-POS.exe`). **The installer is not code-signed**, so Windows SmartScreen
will warn on first run ("More info" > "Run anyway") until you sign it with your own certificate (set `CSC_LINK` and
`CSC_KEY_PASSWORD` in the environment for electron-builder; never commit them). The app has no custom icon yet: put an
`icon.ico` (256x256) in `apps\desktop\build\` before building.

## Server requirements for desktop clients

- **LAN server over plain `http://`:** works for sign-in, but in production the refresh cookie is `Secure`, so the app cannot keep
  the session past the access-token lifetime. For real use put the API behind **HTTPS** (a reverse proxy such as Caddy, nginx or
  IIS) and enter the `https://` address. `http://localhost` is exempt.
- Allow the API port through the server's Windows Firewall (run in an elevated cmd.exe):
  `netsh advfirewall firewall add rule name="MAFK POS API" dir=in action=allow protocol=TCP localport=4000`
- No `CLIENT_URL` entry is needed for the desktop app (it does not use CORS).

## What was verified, and what was not

Verified in the build sandbox (Linux, real Electron under a virtual display, real API, real PostgreSQL): the E2E in `E2E.md`
runs 28 checks against both the source build and the packaged (unpacked) app, covering isolation, CSP, sign-in through the
proxy, a Phase 6 screen, session survival after reload, the settings window, an unreachable server, sign-out, blocked navigation.
Unit tests (29) cover the address rules, URL mapping, header filtering, path resolution (including Windows path rules) and config
storage.

**NOT VERIFIED:** running on real Windows; the NSIS installer build and install/uninstall; code signing; the Windows print
dialog and real printers; downloading a CSV through the native save dialog; auto-start; behaviour behind a corporate proxy.
Steps for those are in `PHASE-7.md`.
