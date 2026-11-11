import type { InboxItem } from "@codeden/contracts";
import { BellRing, Hourglass, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const heading: Partial<Record<InboxItem["kind"], string>> = {
  approval: "Approval needed",
  question: "Question from an agent",
};

export interface AttentionToastProps {
  item: InboxItem;
  /** Offer to turn on desktop notifications (once, while the permission is undecided). */
  offerNotifications: boolean;
  onOpen(): void;
  onDismiss(): void;
  /** Ask for permission and turn the setting on; resolves to whether they are now on. */
  onEnableNotifications(): Promise<boolean>;
  onDeclineNotifications(): void;
}

/** The sticky toast for an item that blocks an agent, shown until it is opened or resolved. */
export function AttentionToast(props: AttentionToastProps) {
  const { item } = props;
  const [offer, setOffer] = useState<"offer" | "on" | "none">(
    props.offerNotifications ? "offer" : "none",
  );
  return (
    <div
      data-testid="attention-toast"
      data-item-id={item.id}
      className="w-(--width) rounded-lg border border-status-waiting/40 bg-popover p-3 text-popover-foreground shadow-lg"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-status-waiting/15 text-status-waiting">
          <Hourglass className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">{heading[item.kind] ?? "Waiting on you"}</div>
          <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.title}</div>
        </div>
        <Button size="sm" onClick={props.onOpen}>
          Open
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Dismiss"
          className="-mr-1 text-muted-foreground"
          onClick={props.onDismiss}
        >
          <X />
        </Button>
      </div>
      {offer === "offer" && (
        <div className="mt-3 flex items-center gap-2 border-t border-border pt-2.5">
          <BellRing className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-xs text-muted-foreground">
            Get notified when CodeBench is in the background
          </span>
          <Button
            size="xs"
            variant="outline"
            onClick={async () => setOffer((await props.onEnableNotifications()) ? "on" : "none")}
          >
            Turn on
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              props.onDeclineNotifications();
              setOffer("none");
            }}
          >
            Not now
          </Button>
        </div>
      )}
      {offer === "on" && (
        <div className="mt-3 border-t border-border pt-2.5 text-xs text-muted-foreground">
          Desktop notifications are on.
        </div>
      )}
    </div>
  );
}

export const attentionToastId = (itemId: string) => `attention:${itemId}`;

/** Show (or replace) the sticky toast for a blocking item. */
export function showAttentionToast(
  item: InboxItem,
  opts: Omit<AttentionToastProps, "item" | "onDismiss">,
): void {
  const id = attentionToastId(item.id);
  toast.custom(
    () => (
      <AttentionToast
        item={item}
        {...opts}
        onOpen={() => {
          toast.dismiss(id);
          opts.onOpen();
        }}
        onDismiss={() => toast.dismiss(id)}
      />
    ),
    { id, duration: Number.POSITIVE_INFINITY, dismissible: false },
  );
}

export function dismissAttentionToast(itemId: string): void {
  toast.dismiss(attentionToastId(itemId));
}
