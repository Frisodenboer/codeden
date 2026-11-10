/** IPC channels between the preload bridge and the main process. */
export const CHANNELS = {
  info: "codeden:info",
  pickFolder: "codeden:pick-folder",
  notify: "codeden:notify",
  notificationClick: "codeden:notification-click",
  openExternal: "codeden:open-external",
  setBadge: "codeden:set-badge",
  navigate: "codeden:navigate",
  browserShow: "codeden:browser-show",
  browserHide: "codeden:browser-hide",
  browserCapture: "codeden:browser-capture",
  browserInspect: "codeden:browser-inspect",
  browserShortcut: "codeden:browser-shortcut",
} as const;
