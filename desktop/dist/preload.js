"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Runs in the sandboxed renderer before the page. Exposes a tiny, fixed API; the page never gets Node or Electron.
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('mafkDesktop', {
    isDesktop: true,
    /** The app is served from mafk-app://local, so the API is same-origin; the main process forwards it to the server. */
    apiBase: '/api',
    getInfo: () => electron_1.ipcRenderer.invoke('desktop:info'),
    openSettings: () => electron_1.ipcRenderer.invoke('desktop:open-settings'),
    setServer: (address, force) => electron_1.ipcRenderer.invoke('desktop:set-server', address, force === true),
    closeSettings: () => electron_1.ipcRenderer.invoke('desktop:close-settings'),
});
