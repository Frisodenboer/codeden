import { Eye, EyeOff, Loader2, LockKeyhole } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useClient } from "@/lib/api";
import { SignInFailure } from "@/lib/api/network-api";
import { Logo } from "./logo";

/** Counts a wait down to zero, one second at a time. */
function useCountdown(): [number, (seconds: number) => void] {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  return [left, setLeft];
}

/**
 * Sign-in for a phone or tablet reaching CodeDen over the network (§15.1). A correct password
 * sets a 90-day session cookie; the page then reloads into the app.
 */
export function SignInScreen({ onSignedIn }: { onSignedIn?: () => void }) {
  const client = useClient();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useCountdown();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password || busy || wait > 0) return;
    setBusy(true);
    setError(null);
    try {
      await client.auth.signIn(password);
      if (onSignedIn) onSignedIn();
      else window.location.reload();
    } catch (err) {
      if (err instanceof SignInFailure) {
        setError(err.message);
        if (err.retryAfterSec) setWait(err.retryAfterSec);
      } else {
        setError(err instanceof Error ? err.message : "Sign-in failed.");
      }
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh items-start justify-center bg-background px-5 pt-[14vh] text-foreground sm:items-center sm:pt-0">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-[radial-gradient(50%_100%_at_50%_0%,var(--glow),transparent)]"
      />
      <form
        onSubmit={submit}
        className="relative w-full max-w-sm"
        data-testid="sign-in"
        aria-describedby="sign-in-help"
      >
        <Logo className="mx-auto mb-5 size-14" />
        <h1 className="text-center text-xl font-semibold tracking-tight">Sign in to CodeBench</h1>
        <p id="sign-in-help" className="mt-2 text-center text-sm text-muted-foreground">
          Enter the network access password you set on the computer running CodeDen.
        </p>

        <label htmlFor="codeden-password" className="mt-7 mb-1.5 block text-[13px] font-medium">
          Password
        </label>
        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="codeden-password"
            name="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 pr-12 pl-9 text-base"
            aria-invalid={error ? true : undefined}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute top-1/2 right-1 flex size-10 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
            aria-label={show ? "Hide password" : "Show password"}
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
            {wait > 0 && <span className="text-muted-foreground"> ({wait} s)</span>}
          </p>
        )}

        <Button
          type="submit"
          className="mt-5 h-12 w-full text-base"
          disabled={!password || busy || wait > 0}
        >
          {busy && <Loader2 className="animate-spin" />}
          {wait > 0 ? `Try again in ${wait} s` : "Sign in"}
        </Button>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          You stay signed in on this device for 90 days. Forgot the password? Set a new one in
          Settings › Network access on the computer.
        </p>
      </form>
    </div>
  );
}
