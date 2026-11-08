/**
 * The one-time offer, in a blocking item's toast, to turn on desktop notifications. It is only
 * made while the browser permission is still undecided, and never again once the user has
 * answered it (turned them on, refused the browser prompt, or said "Not now").
 */

const KEY = "codeden:notification-offer";

type OfferStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): OfferStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function canOfferNotifications(
  permission: NotificationPermission | "unsupported",
  storage: OfferStorage | null = browserStorage(),
): boolean {
  if (permission !== "default") return false;
  try {
    return storage?.getItem(KEY) !== "answered";
  } catch {
    return false;
  }
}

export function markNotificationOfferAnswered(
  storage: OfferStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(KEY, "answered");
  } catch {
    // Private modes can refuse storage; the offer may then come back next load.
  }
}
