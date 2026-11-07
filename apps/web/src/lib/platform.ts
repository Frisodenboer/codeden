/**
 * PlatformBridge (§13): every platform feature the UI uses goes through this interface.
 * A web implementation ships now; a desktop shell can provide its own later. Features are
 * detected through `capabilities`, never by asking which shell we're in.
 */
export interface PlatformBridge {
  readonly capabilities: {
    notifications: boolean;
    badge: boolean;
    clipboardImages: boolean;
    folderPicker: boolean;
  };
  notificationPermission(): NotificationPermission | "unsupported";
  requestNotificationPermission(): Promise<NotificationPermission | "unsupported">;
  notify(title: string, opts?: { body?: string; tag?: string; onClick?: () => void }): void;
  openExternal(url: string): void;
  /** Unread count on the app icon (or the tab title as a fallback). */
  setBadge(count: number): void;
  writeClipboard(text: string): Promise<void>;
  readClipboardImage(): Promise<Blob | null>;
  isFocused(): boolean;
}

const baseTitle = typeof document !== "undefined" ? document.title : "CodeDen";

type BadgeNavigator = Navigator & {
  setAppBadge?: (n: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function createWebPlatform(): PlatformBridge {
  const hasNotifications = typeof window !== "undefined" && "Notification" in window;
  const nav = (typeof navigator !== "undefined" ? navigator : undefined) as
    | BadgeNavigator
    | undefined;
  return {
    capabilities: {
      notifications: hasNotifications,
      badge: Boolean(nav?.setAppBadge),
      clipboardImages: Boolean(nav?.clipboard && "read" in nav.clipboard),
      // Browsers can't return real paths; the server-side picker is used instead (§13).
      folderPicker: false,
    },
    notificationPermission: () => (hasNotifications ? Notification.permission : "unsupported"),
    async requestNotificationPermission() {
      if (!hasNotifications) return "unsupported";
      return Notification.requestPermission();
    },
    notify(title, opts) {
      if (!hasNotifications || Notification.permission !== "granted") return;
      const n = new Notification(title, { body: opts?.body, tag: opts?.tag, icon: "/favicon.svg" });
      n.onclick = () => {
        window.focus();
        opts?.onClick?.();
        n.close();
      };
    },
    openExternal(url) {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    setBadge(count) {
      document.title = count > 0 ? `(${count}) ${baseTitle}` : baseTitle;
      if (nav?.setAppBadge) void (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge?.());
    },
    async writeClipboard(text) {
      await navigator.clipboard.writeText(text);
    },
    async readClipboardImage() {
      if (!nav?.clipboard || !("read" in nav.clipboard)) return null;
      const items = await nav.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) return item.getType(type);
      }
      return null;
    },
    isFocused: () => document.hasFocus() && document.visibilityState === "visible",
  };
}

export const platform: PlatformBridge = createWebPlatform();
