// Electron main process for MAFK-24/7 Retail-Flow POS (client only: the API and PostgreSQL run on the server PC).
//
// Security model (see docs/DESKTOP.md):
//  - The UI is served from a private scheme, mafk-app://local, from the built web app. No remote code is loaded.
//  - Requests to mafk-app://local/api/* are forwarded by THIS process to the configured server, so the page never talks to
//    another origin (no CORS, and the server's SameSite refresh cookie stays first-party inside the shell).
//  - contextIsolation + sandbox on, nodeIntegration off, all permission prompts denied, navigation and new windows blocked.
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } from 'electron';
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadConfig, saveConfig } from './config-store';
import type { DesktopConfig } from './config-store';
import {
  APP_ORIGIN,
  APP_SCHEME,
  buildCsp,
  filterRequestHeaders,
  filterResponseHeaders,
  isAppUrl,
  mimeFor,
  normalizeServerUrl,
  resolveStaticFile,
  toServerUrl,
} from './policy';

const SETTINGS_PATH = '/__desktop/settings.html';
const ASSETS_DIR = path.resolve(__dirname, '..', 'assets');
const webRoot = (): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'web')
    : path.resolve(__dirname, '..', '..', 'web', 'dist');

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let config: DesktopConfig = { serverUrl: '' };
let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
const configFile = (): string => path.join(app.getPath('userData'), 'config.json');

const securityHeaders = (contentType: string): Record<string, string> => ({
  'content-type': contentType,
  'content-security-policy': buildCsp(),
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
});

const text = (status: number, body: string): Response =>
  new Response(body, { status, headers: securityHeaders('text/plain; charset=utf-8') });

const serveFile = async (file: string): Promise<Response> => {
  try {
    return new Response(await fs.promises.readFile(file), {
      headers: securityHeaders(mimeFor(file)),
    });
  } catch {
    return text(404, 'Not found');
  }
};

const isFile = async (file: string): Promise<boolean> => {
  try {
    return (await fs.promises.stat(file)).isFile();
  } catch {
    return false;
  }
};

const proxyToServer = async (request: Request): Promise<Response> => {
  const target = toServerUrl(config.serverUrl, request.url);
  if (!target) return text(404, 'Not found');
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  try {
    const upstream = await net.fetch(target, {
      method: request.method,
      headers: filterRequestHeaders(request.headers.entries()),
      ...(hasBody ? { body: request.body, duplex: 'half' } : {}),
      credentials: 'include',
      redirect: 'manual',
    } as RequestInit);
    return new Response(upstream.status === 204 ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: filterResponseHeaders(upstream.headers.entries()),
    });
  } catch {
    return new Response(
      JSON.stringify({
        error: {
          code: 'SERVER_UNREACHABLE',
          message: `Cannot reach the server at ${config.serverUrl}. Check that it is running and the address is correct (File > Server settings).`,
        },
      }),
      { status: 502, headers: { 'content-type': 'application/json; charset=utf-8' } },
    );
  }
};

const handleAppRequest = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  if (url.host !== 'local') return text(404, 'Not found');
  if (url.pathname.startsWith('/api/')) return proxyToServer(request);
  if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Method not allowed');

  if (url.pathname.startsWith('/__desktop/')) {
    const file = resolveStaticFile(ASSETS_DIR, url.pathname.slice('/__desktop/'.length));
    const allowed =
      file !== null && (file.endsWith('settings.html') || file.endsWith('settings.js'));
    return allowed && file ? serveFile(file) : text(404, 'Not found');
  }

  const root = webRoot();
  const file = resolveStaticFile(root, url.pathname);
  if (!file) return text(404, 'Not found');
  if (await isFile(file)) return serveFile(file);
  // Single-page app: unknown paths without a file extension fall back to index.html; missing assets stay 404.
  if (path.extname(url.pathname) === '') return serveFile(path.join(root, 'index.html'));
  return text(404, 'Not found');
};

// ── Windows ────────────────────────────────────────────────────────────────────────────────────────────────────────
const webPreferences = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  spellcheck: false,
  devTools: !app.isPackaged,
};

const createMainWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#f8fafc',
    title: 'MAFK-24/7 Retail-Flow POS',
    webPreferences,
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  void mainWindow.loadURL(`${APP_ORIGIN}/`);
};

const openSettings = (): void => {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 560,
    height: 380,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Server settings',
    ...(mainWindow ? { parent: mainWindow, modal: true } : {}),
    autoHideMenuBar: true,
    webPreferences,
  });
  settingsWindow.removeMenu();
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
  void settingsWindow.loadURL(`${APP_ORIGIN}${SETTINGS_PATH}`);
};

// ── IPC (only the settings page may change the server address) ─────────────────────────────────────────────────────
const senderPath = (e: IpcMainInvokeEvent): string | null => {
  const url = e.senderFrame?.url ?? '';
  return isAppUrl(url) ? new URL(url).pathname : null;
};

const checkServer = async (origin: string): Promise<string | null> => {
  try {
    const res = await net.fetch(`${origin}/api/health`, {
      signal: AbortSignal.timeout(5000),
      credentials: 'omit',
    });
    if (!res.ok)
      return `The server answered with status ${res.status}, so this is probably not the POS server.`;
    return null;
  } catch {
    return 'Cannot reach this address. Check the address, that the server is running, and the firewall.';
  }
};

ipcMain.handle('desktop:info', (e) => {
  if (!senderPath(e)) return null;
  return { version: app.getVersion(), platform: process.platform, serverUrl: config.serverUrl };
});
ipcMain.handle('desktop:open-settings', (e) => {
  if (!senderPath(e)) return;
  openSettings();
});
ipcMain.handle('desktop:set-server', async (e, input: unknown, force: unknown) => {
  if (senderPath(e) !== SETTINGS_PATH) return { ok: false, error: 'Not allowed.' };
  if (typeof input !== 'string') return { ok: false, error: 'Enter the server address.' };
  const parsed = normalizeServerUrl(input);
  if (!parsed.ok) return parsed;
  if (force !== true) {
    const problem = await checkServer(parsed.value);
    if (problem) return { ok: false, error: problem, canForce: true };
  }
  config = { serverUrl: parsed.value };
  saveConfig(configFile(), config);
  // A different server means a different login: drop the old session cookie, then reload the app.
  await session.defaultSession.clearStorageData({ storages: ['cookies'] });
  mainWindow?.webContents.reload();
  settingsWindow?.close();
  return { ok: true, value: parsed.value };
});
ipcMain.handle('desktop:close-settings', (e) => {
  if (senderPath(e) !== SETTINGS_PATH) return;
  settingsWindow?.close();
});

// ── App wiring ─────────────────────────────────────────────────────────────────────────────────────────────────────
const buildMenu = (): void => {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Server settings…', accelerator: 'CmdOrCtrl+,', click: openSettings },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : ([{ role: 'toggleDevTools' }] as MenuItemConstructorOptions[])),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'About MAFK-24/7 Retail-Flow POS',
              message: `MAFK-24/7 Retail-Flow POS ${app.getVersion()}`,
              detail: `Server: ${config.serverUrl}\nElectron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
  contents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    app.setAppUserModelId('com.mafk.retailflow');
    config = loadConfig(configFile());
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    protocol.handle(APP_SCHEME, handleAppRequest);
    buildMenu();
    createMainWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
