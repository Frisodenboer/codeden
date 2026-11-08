import type { EventEnvelope, InboxItem, Snapshot } from "@codeden/contracts";
import { isOpenBlocking } from "./blocking";
import { CHIME_DEBOUNCE_MS, createChimeDebouncer } from "./chime";
import type { TitleState } from "./title";

/** What the attention logic does to the outside world; the app passes the real ones. */
export interface AttentionEffects {
  chime(): void;
  showToast(item: InboxItem, opts: { offerNotifications: boolean }): void;
  dismissToast(itemId: string): void;
  setFavicon(active: boolean): void;
  setTitle(state: TitleState): void;
  canOfferNotifications(): boolean;
}

export interface Attention {
  /** The snapshot or the tab's focus changed: update the favicon, title and sticky toasts. */
  sync(snapshot: Snapshot, focused: boolean): void;
  /** A live event arrived. `snapshot` is the cache after the event was applied. */
  onEvent(env: EventEnvelope, snapshot: Snapshot): void;
}

export interface AttentionOptions {
  debounceMs?: number;
  now?: () => number;
}

/**
 * Getting the user's attention when an agent is blocked on them (an approval or a question):
 * a debounced chime and a sticky toast when one arrives live, and a favicon badge and a
 * flashing background title while any is open. Items already open when the page loaded never
 * chime or toast; their favicon and title cues still show.
 */
export function createAttention(effects: AttentionEffects, opts: AttentionOptions = {}): Attention {
  /** Inbox ids the page already knows about; seeded from the first snapshot. */
  let known: Set<string> | null = null;
  /** Items with a sticky toast, and the event seq that raised it. */
  const toasts = new Map<string, number>();
  /** The toast currently carrying the desktop notification offer. */
  let offerItemId: string | null = null;
  const requestChime = createChimeDebouncer(
    () => effects.chime(),
    opts.debounceMs ?? CHIME_DEBOUNCE_MS,
    opts.now,
  );

  const seed = (items: InboxItem[], except?: string): Set<string> => {
    known = new Set(items.filter((i) => i.id !== except).map((i) => i.id));
    return known;
  };

  const dismiss = (itemId: string) => {
    toasts.delete(itemId);
    if (offerItemId === itemId) offerItemId = null;
    effects.dismissToast(itemId);
  };

  return {
    sync(snapshot, focused) {
      if (!known) seed(snapshot.inbox);
      const blocking = snapshot.inbox.filter(isOpenBlocking).length;
      const open = snapshot.inbox.filter((i) => i.status === "open").length;
      effects.setFavicon(blocking > 0);
      effects.setTitle({ count: open, flashing: blocking > 0 && !focused });
      for (const [itemId, raisedAt] of toasts) {
        const item = snapshot.inbox.find((i) => i.id === itemId);
        // Missing from a snapshot newer than the toast means it was closed and dropped.
        if (item ? item.status !== "open" : snapshot.seq >= raisedAt) dismiss(itemId);
      }
    },

    onEvent(env, snapshot) {
      if (env.type !== "inbox.created") return;
      const item = env.payload.item;
      // The snapshot already holds this item, so leave it out when seeding.
      const seen = known ?? seed(snapshot.inbox, item.id);
      if (seen.has(item.id)) return;
      seen.add(item.id);
      if (!isOpenBlocking(item)) return;
      const notifications = snapshot.settings.notifications;
      if (notifications.sound) requestChime();
      if (!notifications.toasts) return;
      const offerNotifications = offerItemId === null && effects.canOfferNotifications();
      if (offerNotifications) offerItemId = item.id;
      toasts.set(item.id, env.seq);
      effects.showToast(item, { offerNotifications });
    },
  };
}
