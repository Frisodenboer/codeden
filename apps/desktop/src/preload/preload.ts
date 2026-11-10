/**
 * Preload for the CodeDen window (sandboxed, context-isolated). Exposes the small, typed
 * `window.codedenDesktop` bridge the UI's desktop PlatformBridge is built on (§13, §17).
 * Nothing else from Node or Electron reaches the page; the main process validates every call.
 */
import type { CodedenDesktopApi } from "@codeden/contracts";
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import { CHANNELS } from "../shared/channels";

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.off(channel, handler);
  };
}

const api: CodedenDesktopApi = {
  info: () => ipcRenderer.invoke(CHANNELS.info),
  pickFolder: (opts) => ipcRenderer.invoke(CHANNELS.pickFolder, opts ?? {}),
  notify: (notification) => ipcRenderer.send(CHANNELS.notify, notification),
  onNotificationClick: (listener) => subscribe(CHANNELS.notificationClick, listener),
  openExternal: (url) => ipcRenderer.send(CHANNELS.openExternal, url),
  setBadge: (count) => ipcRenderer.send(CHANNELS.setBadge, count),
  onNavigate: (listener) => subscribe(CHANNELS.navigate, listener),
  browser: {
    show: (sessionId, bounds) => ipcRenderer.send(CHANNELS.browserShow, { sessionId, bounds }),
    hide: (sessionId) => ipcRenderer.send(CHANNELS.browserHide, sessionId),
    capture: (sessionId) => ipcRenderer.invoke(CHANNELS.browserCapture, sessionId),
    inspect: (sessionId) => ipcRenderer.send(CHANNELS.browserInspect, sessionId),
    onShortcut: (listener) => subscribe(CHANNELS.browserShortcut, listener),
  },
};

contextBridge.exposeInMainWorld("codedenDesktop", api);
