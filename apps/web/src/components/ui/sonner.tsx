import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { resolveTheme, useThemeStore } from "@/stores/theme";

const Toaster = ({ ...props }: ToasterProps) => {
  const preference = useThemeStore((s) => s.preference);

  return (
    <Sonner
      theme={resolveTheme(preference)}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-status-done" />,
        info: <InfoIcon className="size-4 text-status-running" />,
        warning: <TriangleAlertIcon className="size-4 text-status-waiting" />,
        error: <OctagonXIcon className="size-4 text-status-failed" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
