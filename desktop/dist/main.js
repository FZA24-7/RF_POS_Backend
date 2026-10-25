"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
// Electron main process for MAFK-24/7 Retail-Flow POS (client only: the API and PostgreSQL run on the server PC).
//
// Security model (see docs/DESKTOP.md):
//  - The UI is served from a private scheme, mafk-app://local, from the built web app. No remote code is loaded.
//  - Requests to mafk-app://local/api/* are forwarded by THIS process to the configured server, so the page never talks to
//    another origin (no CORS, and the server's SameSite refresh cookie stays first-party inside the shell).
//  - contextIsolation + sandbox on, nodeIntegration off, all permission prompts denied, navigation and new windows blocked.
const electron_1 = require("electron");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const config_store_1 = require("./config-store");
const policy_1 = require("./policy");
const SETTINGS_PATH = '/__desktop/settings.html';
const ASSETS_DIR = path.resolve(__dirname, '..', 'assets');
const webRoot = () => electron_1.app.isPackaged
    ? path.join(process.resourcesPath, 'web')
    : path.resolve(__dirname, '..', '..', 'web', 'dist');
electron_1.protocol.registerSchemesAsPrivileged([
    {
        scheme: policy_1.APP_SCHEME,
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true,
        },
    },
]);
let config = { serverUrl: '' };
let mainWindow = null;
let settingsWindow = null;
const configFile = () => path.join(electron_1.app.getPath('userData'), 'config.json');
const securityHeaders = (contentType) => ({
    'content-type': contentType,
    'content-security-policy': (0, policy_1.buildCsp)(),
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
});
const text = (status, body) => new Response(body, { status, headers: securityHeaders('text/plain; charset=utf-8') });
const serveFile = async (file) => {
    try {
        return new Response(await fs.promises.readFile(file), {
            headers: securityHeaders((0, policy_1.mimeFor)(file)),
        });
    }
    catch {
        return text(404, 'Not found');
    }
};
const isFile = async (file) => {
    try {
        return (await fs.promises.stat(file)).isFile();
    }
    catch {
        return false;
    }
};
const proxyToServer = async (request) => {
    const target = (0, policy_1.toServerUrl)(config.serverUrl, request.url);
    if (!target)
        return text(404, 'Not found');
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    try {
        const upstream = await electron_1.net.fetch(target, {
            method: request.method,
            headers: (0, policy_1.filterRequestHeaders)(request.headers.entries()),
            ...(hasBody ? { body: request.body, duplex: 'half' } : {}),
            credentials: 'include',
            redirect: 'manual',
        });
        return new Response(upstream.status === 204 ? null : upstream.body, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: (0, policy_1.filterResponseHeaders)(upstream.headers.entries()),
        });
    }
    catch {
        return new Response(JSON.stringify({
            error: {
                code: 'SERVER_UNREACHABLE',
                message: `Cannot reach the server at ${config.serverUrl}. Check that it is running and the address is correct (File > Server settings).`,
            },
        }), { status: 502, headers: { 'content-type': 'application/json; charset=utf-8' } });
    }
};
const handleAppRequest = async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'local')
        return text(404, 'Not found');
    if (url.pathname.startsWith('/api/'))
        return proxyToServer(request);
    if (request.method !== 'GET' && request.method !== 'HEAD')
        return text(405, 'Method not allowed');
    if (url.pathname.startsWith('/__desktop/')) {
        const file = (0, policy_1.resolveStaticFile)(ASSETS_DIR, url.pathname.slice('/__desktop/'.length));
        const allowed = file !== null && (file.endsWith('settings.html') || file.endsWith('settings.js'));
        return allowed && file ? serveFile(file) : text(404, 'Not found');
    }
    const root = webRoot();
    const file = (0, policy_1.resolveStaticFile)(root, url.pathname);
    if (!file)
        return text(404, 'Not found');
    if (await isFile(file))
        return serveFile(file);
    // Single-page app: unknown paths without a file extension fall back to index.html; missing assets stay 404.
    if (path.extname(url.pathname) === '')
        return serveFile(path.join(root, 'index.html'));
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
    devTools: !electron_1.app.isPackaged,
};
const createMainWindow = () => {
    mainWindow = new electron_1.BrowserWindow({
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
    void mainWindow.loadURL(`${policy_1.APP_ORIGIN}/`);
};
const openSettings = () => {
    if (settingsWindow) {
        settingsWindow.focus();
        return;
    }
    settingsWindow = new electron_1.BrowserWindow({
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
    void settingsWindow.loadURL(`${policy_1.APP_ORIGIN}${SETTINGS_PATH}`);
};
// ── IPC (only the settings page may change the server address) ─────────────────────────────────────────────────────
const senderPath = (e) => {
    const url = e.senderFrame?.url ?? '';
    return (0, policy_1.isAppUrl)(url) ? new URL(url).pathname : null;
};
const checkServer = async (origin) => {
    try {
        const res = await electron_1.net.fetch(`${origin}/api/health`, {
            signal: AbortSignal.timeout(5000),
            credentials: 'omit',
        });
        if (!res.ok)
            return `The server answered with status ${res.status}, so this is probably not the POS server.`;
        return null;
    }
    catch {
        return 'Cannot reach this address. Check the address, that the server is running, and the firewall.';
    }
};
electron_1.ipcMain.handle('desktop:info', (e) => {
    if (!senderPath(e))
        return null;
    return { version: electron_1.app.getVersion(), platform: process.platform, serverUrl: config.serverUrl };
});
electron_1.ipcMain.handle('desktop:open-settings', (e) => {
    if (!senderPath(e))
        return;
    openSettings();
});
electron_1.ipcMain.handle('desktop:set-server', async (e, input, force) => {
    if (senderPath(e) !== SETTINGS_PATH)
        return { ok: false, error: 'Not allowed.' };
    if (typeof input !== 'string')
        return { ok: false, error: 'Enter the server address.' };
    const parsed = (0, policy_1.normalizeServerUrl)(input);
    if (!parsed.ok)
        return parsed;
    if (force !== true) {
        const problem = await checkServer(parsed.value);
        if (problem)
            return { ok: false, error: problem, canForce: true };
    }
    config = { serverUrl: parsed.value };
    (0, config_store_1.saveConfig)(configFile(), config);
    // A different server means a different login: drop the old session cookie, then reload the app.
    await electron_1.session.defaultSession.clearStorageData({ storages: ['cookies'] });
    mainWindow?.webContents.reload();
    settingsWindow?.close();
    return { ok: true, value: parsed.value };
});
electron_1.ipcMain.handle('desktop:close-settings', (e) => {
    if (senderPath(e) !== SETTINGS_PATH)
        return;
    settingsWindow?.close();
});
// ── App wiring ─────────────────────────────────────────────────────────────────────────────────────────────────────
const buildMenu = () => {
    const template = [
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
                ...(electron_1.app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
            ],
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'About',
                    click: () => {
                        void electron_1.dialog.showMessageBox({
                            type: 'info',
                            title: 'About MAFK-24/7 Retail-Flow POS',
                            message: `MAFK-24/7 Retail-Flow POS ${electron_1.app.getVersion()}`,
                            detail: `Server: ${config.serverUrl}\nElectron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
                        });
                    },
                },
            ],
        },
    ];
    electron_1.Menu.setApplicationMenu(electron_1.Menu.buildFromTemplate(template));
};
electron_1.app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault());
    contents.on('will-navigate', (e, url) => {
        if (!(0, policy_1.isAppUrl)(url))
            e.preventDefault();
    });
    contents.setWindowOpenHandler(({ url }) => {
        if (/^https:\/\//i.test(url))
            void electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
});
if (!electron_1.app.requestSingleInstanceLock()) {
    electron_1.app.quit();
}
else {
    electron_1.app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            mainWindow.focus();
        }
    });
    void electron_1.app.whenReady().then(() => {
        electron_1.app.setAppUserModelId('com.mafk.retailflow');
        config = (0, config_store_1.loadConfig)(configFile());
        const ses = electron_1.session.defaultSession;
        ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
        ses.setPermissionCheckHandler(() => false);
        electron_1.protocol.handle(policy_1.APP_SCHEME, handleAppRequest);
        buildMenu();
        createMainWindow();
        electron_1.app.on('activate', () => {
            if (electron_1.BrowserWindow.getAllWindows().length === 0)
                createMainWindow();
        });
    });
    electron_1.app.on('window-all-closed', () => {
        if (process.platform !== 'darwin')
            electron_1.app.quit();
    });
}
