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
exports.saveConfig = exports.loadConfig = void 0;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const policy_1 = require("./policy");
/** Reads the saved server address; falls back to the default when the file is missing, unreadable or invalid. */
const loadConfig = (file) => {
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        const candidate = typeof parsed === 'object' && parsed !== null && 'serverUrl' in parsed
            ? parsed.serverUrl
            : undefined;
        if (typeof candidate === 'string') {
            const r = (0, policy_1.normalizeServerUrl)(candidate);
            if (r.ok)
                return { serverUrl: r.value };
        }
    }
    catch {
        // missing or corrupt file: use the default
    }
    return { serverUrl: policy_1.DEFAULT_SERVER_URL };
};
exports.loadConfig = loadConfig;
/** Writes the config atomically (temp file + rename) so a crash cannot leave a half-written file. */
const saveConfig = (file, config) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
    fs.renameSync(tmp, file);
};
exports.saveConfig = saveConfig;
