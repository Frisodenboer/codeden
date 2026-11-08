import type { Snapshot } from "@codeden/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { type CodeDenClient, useClient } from "@/lib/api";
import { createAttention } from "@/lib/attention/attention";
import { attentionTarget } from "@/lib/attention/blocking";
import { chime } from "@/lib/attention/chime";
import { createFaviconBadge } from "@/lib/attention/favicon";
import {
  canOfferNotifications,
  markNotificationOfferAnswered,
} from "@/lib/attention/notification-offer";
import { createTitleFlasher } from "@/lib/attention/title";
import { platform } from "@/lib/platform";
import { snapshotKey, useSnapshot } from "@/lib/queries";
import { onLiveEvent } from "@/lib/realtime";
import { dismissAttentionToast, showAttentionToast } from "./attention-toast";

/** Whether the CodeDen tab is focused and visible, kept current. */
export function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(() => platform.isFocused());
  useEffect(() => {
    const update = () => setFocused(platform.isFocused());
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return focused;
}

/** Ask for desktop notification permission and turn the setting on when granted. */
async function enableBrowserNotifications(client: CodeDenClient): Promise<boolean> {
  markNotificationOfferAnswered();
  const permission = await platform.requestNotificationPermission();
  if (permission !== "granted") return false;
  await client.updateSettings({ notifications: { browser: true } }).catch(() => undefined);
  return true;
}

/**
 * Wire the attention cues (§11.1) to the app: chime and sticky toast for blocking items that
 * arrive live, favicon badge and background title while any is open.
 */
export function useAttention(): void {
  const client = useClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const { data } = useSnapshot();
  const focused = useWindowFocused();

  const favicon = useMemo(() => createFaviconBadge(), []);
  const title = useMemo(() => createTitleFlasher(), []);
  const attention = useMemo(
    () =>
      createAttention({
        chime: () => chime.play(),
        showToast: (item, { offerNotifications }) =>
          showAttentionToast(item, {
            offerNotifications,
            onOpen: () => void navigateRef.current(attentionTarget(item)),
            onEnableNotifications: () => enableBrowserNotifications(client),
            onDeclineNotifications: () => markNotificationOfferAnswered(),
          }),
        dismissToast: dismissAttentionToast,
        setFavicon: (active) => favicon.set(active),
        setTitle: (state) => title.update(state),
        canOfferNotifications: () => canOfferNotifications(platform.notificationPermission()),
      }),
    [client, favicon, title],
  );

  useEffect(() => chime.installUnlock(), []);

  useEffect(() => {
    if (data) attention.sync(data, focused);
  }, [attention, data, focused]);

  useEffect(
    () =>
      onLiveEvent((env) => {
        const snap = queryClient.getQueryData<Snapshot>(snapshotKey);
        if (snap) attention.onEvent(env, snap);
      }),
    [attention, queryClient],
  );

  useEffect(
    () => () => {
      title.stop();
      favicon.set(false);
    },
    [title, favicon],
  );
}
