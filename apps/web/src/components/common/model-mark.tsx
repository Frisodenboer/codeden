import type { Session } from "@codeden/contracts";
import { cn } from "@/lib/utils";
import { providerLogo } from "./provider-logos";

/** Models served through Claude Code but by another vendor (e.g. GLM via Z.AI). */
function otherVendor(model: string | null): { label: string; className: string } | null {
  if (!model) return null;
  if (/^glm/i.test(model))
    return { label: "GLM", className: "bg-indigo-500/20 text-indigo-700 dark:text-indigo-300" };
  if (/^(kimi|moonshot)/i.test(model))
    return { label: "K", className: "bg-sky-500/20 text-sky-700 dark:text-sky-300" };
  if (/^(qwen)/i.test(model))
    return { label: "Q", className: "bg-violet-500/20 text-violet-700 dark:text-violet-300" };
  if (/^(deepseek)/i.test(model))
    return { label: "DS", className: "bg-blue-500/20 text-blue-700 dark:text-blue-300" };
  return null;
}

/**
 * A small mark for the model a session runs on: the vendor's model (GLM, …) when Claude Code is
 * routed elsewhere, otherwise the provider logo (Claude, Codex). The model name shows on hover.
 * Reads the session live, so it follows model switches.
 */
export function ModelMark({
  session,
  className,
}: {
  session: Pick<Session, "provider" | "model"> | undefined;
  className?: string;
}) {
  if (!session) return null;
  const title = session.model ? `${session.model} (${session.provider})` : session.provider;
  const vendor = otherVendor(session.model);
  if (vendor) {
    return (
      <span
        title={title}
        role="img"
        aria-label={title}
        className={cn(
          "inline-flex h-3.5 shrink-0 items-center rounded-[3px] px-0.5 text-[8px] leading-none font-bold tracking-tight",
          vendor.className,
          className,
        )}
      >
        {vendor.label}
      </span>
    );
  }
  const Logo = providerLogo(session.provider);
  if (!Logo) return null;
  return (
    <span
      title={title}
      role="img"
      aria-label={title}
      className={cn("inline-flex shrink-0", className)}
    >
      <Logo className="size-3.5" />
    </span>
  );
}
