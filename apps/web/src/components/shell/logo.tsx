import { cn } from "@/lib/utils";

/** CodeDen mark: a hexagonal den with a glowing core. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("shrink-0", className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-foreground/[0.06]" />
      <path
        d="M9 21V11l7-4 7 4v10l-7 4z"
        fill="none"
        className="stroke-primary"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="2.6" className="fill-primary" />
    </svg>
  );
}
