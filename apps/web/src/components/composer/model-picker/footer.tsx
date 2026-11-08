import { Check, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A full-width choice in the picker footer, such as "Auto". */
export function PickerFooterChoice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:bg-accent",
        active && "text-foreground",
      )}
    >
      <Sparkles className="size-3.5" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {active && <Check className="size-3.5" aria-hidden />}
    </button>
  );
}
