import type { CodedenDesktopApi } from "@codeden/contracts";
import type { PlatformBridge } from "./platform";

/** Click handlers kept for notifications still on screen (oldest dropped first). */
const MAX_PENDING_CLICKS = 50;

/**
 * The desktop app's PlatformBridge (§13, §17), built on `window.codedenDesktop`: native
 * notifications (no permission prompt), the app icon badge, the native folder picker, links
 * in the system browser and `codeden://` navigation. Clipboard and focus use the web APIs,
 * which work the same inside the app window.
 */
export function createDesktopPlatform(api: CodedenDesktopApi, web: PlatformBridge): PlatformBridge {
  const clicks = new Map<string, () => void>();
  let counter = 0;
  api.onNotificationClick((tag) => {
    const handler = clicks.get(tag);
    clicks.delete(tag);
    handler?.();
  });
  let loginSupport: Promise<boolean> | undefined;

  return {
    capabilities: {
      notifications: true,
      badge: true,
      clipboardImages: web.capabilities.clipboardImages,
      folderPicker: true,
      osIntegration: true,
    },
    notificationPermission: () => "granted",
    requestNotificationPermission: async () => "granted",
    notify(title, opts) {
      const tag = opts?.tag ?? `n${++counter}`;
      if (opts?.onClick) {
        clicks.delete(tag);
        clicks.set(tag, opts.onClick);
        while (clicks.size > MAX_PENDING_CLICKS) {
          const oldest = clicks.keys().next().value;
          if (oldest === undefined) break;
          clicks.delete(oldest);
        }
      }
      api.notify({ title, body: opts?.body, tag });
    },
    openExternal: (url) => api.openExternal(url),
    setBadge(count) {
      api.setBadge(count);
    },
    writeClipboard: (text) => web.writeClipboard(text),
    readClipboardImage: () => web.readClipboardImage(),
    isFocused: () => web.isFocused(),
    pickFolder: (opts) => api.pickFolder(opts),
    onNavigate: (listener) => api.onNavigate(listener),
    launchAtLoginSupported() {
      loginSupport ??= api.info().then(
        (info) => info.launchAtLoginSupported,
        () => false,
      );
      return loginSupport;
    },
  };
}
