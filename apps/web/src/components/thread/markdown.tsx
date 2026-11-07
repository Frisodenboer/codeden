import { createCodePlugin } from "@streamdown/code";
import { memo } from "react";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

const code = createCodePlugin({ themes: ["github-light-default", "github-dark-default"] });
const plugins = { code };

/** Streaming-safe markdown with Shiki-highlighted code blocks (§13). */
export const Markdown = memo(function Markdown({
  children,
  streaming = false,
  className,
}: {
  children: string;
  streaming?: boolean;
  className?: string;
}) {
  return (
    <Streamdown
      className={cn("markdown", className)}
      plugins={plugins}
      shikiTheme={["github-light-default", "github-dark-default"]}
      isAnimating={streaming}
      mode={streaming ? "streaming" : "static"}
      linkSafety={{ enabled: false }}
      caret={streaming ? "block" : undefined}
    >
      {children}
    </Streamdown>
  );
});
