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
exports.mimeFor = exports.buildCsp = exports.resolveStaticFile = exports.filterResponseHeaders = exports.filterRequestHeaders = exports.toServerUrl = exports.isAppUrl = exports.normalizeServerUrl = exports.DEFAULT_SERVER_URL = exports.API_PATH_PREFIX = exports.APP_ORIGIN = exports.APP_SCHEME = void 0;
// Pure security/configuration rules for the desktop shell. No Electron imports, so every rule here is unit-tested
// (tests/policy.test.ts). main.ts only wires these rules into Electron.
const path = __importStar(require("node:path"));
exports.APP_SCHEME = 'mafk-app';
exports.APP_ORIGIN = `${exports.APP_SCHEME}://local`;
exports.API_PATH_PREFIX = '/api/';
exports.DEFAULT_SERVER_URL = 'http://localhost:4000';
/**
 * Validates the address of the API server typed by the user. Accepts `http://host:port` or `https://host`
 * (an optional trailing `/api` or `/` is tolerated) and returns the bare origin. Rejects anything else:
 * other schemes, embedded credentials, query strings, fragments and extra paths.
 */
const normalizeServerUrl = (input) => {
    const raw = input.trim();
    if (raw.length === 0)
        return { ok: false, error: 'Enter the server address.' };
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        return { ok: false, error: 'This is not a valid address. Example: http://192.168.1.10:4000' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, error: 'Only http:// or https:// addresses are allowed.' };
    }
    if (url.username !== '' || url.password !== '') {
        return { ok: false, error: 'Do not put a user name or password in the address.' };
    }
    if (url.search !== '' || url.hash !== '') {
        return { ok: false, error: 'The address must not contain a query string or fragment.' };
    }
    const p = url.pathname.replace(/\/+$/, '');
    if (p !== '' && p !== '/api') {
        return {
            ok: false,
            error: 'Enter only the server address, without a path (for example http://192.168.1.10:4000).',
        };
    }
    return { ok: true, value: url.origin };
};
exports.normalizeServerUrl = normalizeServerUrl;
/** True only for pages of this app itself. Every other navigation is blocked. */
const isAppUrl = (url) => {
    try {
        const u = new URL(url);
        return u.protocol === `${exports.APP_SCHEME}:` && u.host === 'local';
    }
    catch {
        return false;
    }
};
exports.isAppUrl = isAppUrl;
/** Maps an app request `mafk-app://local/api/...` onto the configured server. Returns null for non-API paths. */
const toServerUrl = (serverOrigin, requestUrl) => {
    let u;
    try {
        u = new URL(requestUrl);
    }
    catch {
        return null;
    }
    if (!(0, exports.isAppUrl)(requestUrl))
        return null;
    if (!u.pathname.startsWith(exports.API_PATH_PREFIX))
        return null;
    if (u.pathname.includes('..') || u.pathname.includes('//'))
        return null;
    return `${serverOrigin}${u.pathname}${u.search}`;
};
exports.toServerUrl = toServerUrl;
const HOP_BY_HOP = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'host',
    'content-length',
]);
/** Request headers forwarded to the server. `origin`/`referer`/`cookie` are dropped: the shell supplies its own. */
const filterRequestHeaders = (headers) => {
    const out = [];
    for (const [k, v] of headers) {
        const key = k.toLowerCase();
        if (HOP_BY_HOP.has(key) || key === 'origin' || key === 'referer' || key === 'cookie')
            continue;
        out.push([k, v]);
    }
    return out;
};
exports.filterRequestHeaders = filterRequestHeaders;
/** Response headers handed back to the page. `set-cookie` never reaches the page (the shell's cookie jar keeps it). */
const filterResponseHeaders = (headers) => {
    const out = [];
    for (const [k, v] of headers) {
        const key = k.toLowerCase();
        if (HOP_BY_HOP.has(key) || key === 'set-cookie' || key === 'content-encoding')
            continue;
        out.push([k, v]);
    }
    return out;
};
exports.filterResponseHeaders = filterResponseHeaders;
/**
 * Resolves a request path to a file inside `root`, or null when it would escape it. `root` must be absolute.
 * Works with both `/` and `\` separators so it behaves the same on Windows.
 */
const resolveStaticFile = (root, urlPath, pathApi = path) => {
    let decoded;
    try {
        decoded = decodeURIComponent(urlPath);
    }
    catch {
        return null;
    }
    if (decoded.includes('\0') || decoded.includes('\\'))
        return null;
    const relative = decoded.replace(/^\/+/, '');
    // A drive letter or device path ("C:/Windows/win.ini", "C:foo") would make resolve() ignore the root on Windows.
    if (/^[a-zA-Z]:/.test(relative))
        return null;
    const resolved = pathApi.resolve(root, relative);
    const rootWithSep = root.endsWith(pathApi.sep) ? root : root + pathApi.sep;
    if (resolved !== root && !resolved.startsWith(rootWithSep))
        return null;
    return resolved;
};
exports.resolveStaticFile = resolveStaticFile;
/** Content-Security-Policy for pages served by the shell. No remote scripts, frames or objects. */
const buildCsp = () => [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
].join('; ');
exports.buildCsp = buildCsp;
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
    '.map': 'application/json',
};
const mimeFor = (file) => MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
exports.mimeFor = mimeFor;
