import { KeyRound, TerminalSquare } from "lucide-react";
import { Logo } from "./logo";

/**
 * Shown after a 401: this browser has no valid CodeDen cookie. The token only arrives through
 * the authenticated link the CLI prints and opens (§15), so point the user back to it.
 */
export function UnauthorizedScreen() {
  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-[radial-gradient(50%_100%_at_50%_0%,var(--glow),transparent)]"
      />
      <div className="relative w-full max-w-md text-center" data-testid="unauthorized">
        <Logo className="mx-auto mb-5 size-12" />
        <h1 className="text-xl font-semibold tracking-tight">
          Open CodeDen from the terminal link
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This browser isn't signed in to your local CodeDen server. For your safety the UI only
          unlocks through the private link CodeDen prints when it starts.
        </p>
        <div className="mt-6 space-y-2 rounded-xl border border-border bg-card p-4 text-left text-[13px]">
          <div className="flex items-start gap-2.5">
            <TerminalSquare className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              Run{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">npx codeden</code>{" "}
              again. It finds the running server and opens an authenticated tab.
            </span>
          </div>
          <div className="flex items-start gap-2.5">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              Or open the link it printed earlier (it ends in{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">?token=…</code>).
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
