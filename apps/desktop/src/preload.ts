// Runs in the sandboxed renderer before the page. Exposes a tiny, fixed API; the page never gets Node or Electron.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('mafkDesktop', {
  isDesktop: true,
  /** The app is served from mafk-app://local, so the API is same-origin; the main process forwards it to the server. */
  apiBase: '/api',
  getInfo: (): Promise<unknown> => ipcRenderer.invoke('desktop:info'),
  openSettings: (): Promise<void> => ipcRenderer.invoke('desktop:open-settings'),
  setServer: (address: string, force?: boolean): Promise<unknown> =>
    ipcRenderer.invoke('desktop:set-server', address, force === true),
  closeSettings: (): Promise<void> => ipcRenderer.invoke('desktop:close-settings'),
});
