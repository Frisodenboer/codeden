import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, BellRing, Check, Mic, Volume2 } from "lucide-react";
import { useState } from "react";
import { useSettings } from "@/components/settings/settings-ui";
import { ProjectSourcePicker } from "@/components/setup/add-project-dialog";
import { SetupChecklist } from "@/components/setup/checklist";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useClient } from "@/lib/api";
import { platform } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { stt, tts } from "@/lib/voice/engines";

const STEPS = ["Check your tools", "Voice & notifications", "First project"];

function Extras() {
  const { settings, update } = useSettings();
  const [permission, setPermission] = useState(platform.notificationPermission());
  const row = "flex items-center gap-3 px-4 py-3.5";
  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-card">
      <div className={row}>
        <Mic className="size-4 text-muted-foreground" />
        <div className="flex-1">
          <div className="text-[13.5px] font-medium">Dictation</div>
          <div className="text-2xs text-muted-foreground">
            {stt.supported
              ? "Your browser supports speech to text. Press Ctrl Shift M in the composer."
              : "Not supported in this browser — a cloud engine can be chosen in Settings."}
          </div>
        </div>
        <span
          className={cn("text-2xs", stt.supported ? "text-status-done" : "text-muted-foreground")}
        >
          {stt.supported ? "Available" : "Unavailable"}
        </span>
      </div>
      <div className={row}>
        <Volume2 className="size-4 text-muted-foreground" />
        <div className="flex-1">
          <div className="text-[13.5px] font-medium">Read final messages aloud</div>
          <div className="text-2xs text-muted-foreground">
            When a turn completes and you're in another tab.
          </div>
        </div>
        <Button
          size="xs"
          variant="ghost"
          disabled={!tts.supported}
          onClick={() => tts.speak("Hi! I'll read agent summaries like this.")}
        >
          Test
        </Button>
        <Switch
          checked={settings.voice.readAloud.enabled}
          onCheckedChange={(enabled) => update({ voice: { readAloud: { enabled } } })}
        />
      </div>
      <div className={row}>
        <BellRing className="size-4 text-muted-foreground" />
        <div className="flex-1">
          <div className="text-[13.5px] font-medium">Browser notifications</div>
          <div className="text-2xs text-muted-foreground">
            Know when an agent needs you, even in another tab.
          </div>
        </div>
        {permission === "granted" ? (
          <span className="flex items-center gap-1 text-2xs text-status-done">
            <Check className="size-3" /> Allowed
          </span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={permission === "unsupported" || permission === "denied"}
            onClick={async () => setPermission(await platform.requestNotificationPermission())}
          >
            {permission === "denied" ? "Blocked" : "Allow"}
          </Button>
        )}
      </div>
    </div>
  );
}

/** First-run setup (§14): from `npx codeden` to a first session in under a minute. */
export function SetupPage() {
  const client = useClient();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const status = useQuery({ queryKey: ["setup"], queryFn: () => client.getSetupStatus() });
  const ready = status.data?.ready ?? false;
  const finish = async (projectId?: string) => {
    await client.completeSetup();
    void navigate(projectId ? { to: "/projects/$projectId", params: { projectId } } : { to: "/" });
  };

  return (
    <div className="relative flex min-h-dvh flex-col items-center overflow-y-auto bg-background px-6 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-[radial-gradient(50%_100%_at_50%_0%,var(--glow),transparent)]"
      />
      <div className="relative w-full max-w-2xl">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="mb-4 size-12" />
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to CodeDen</h1>
          <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
            We'll reuse what's already set up on this machine. Nothing to type if you're already
            signed in.
          </p>
        </div>

        <ol className="mb-6 flex items-center justify-center gap-2">
          {STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => i <= step && setStep(i)}
                className={cn(
                  "flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-xs transition-colors",
                  i === step ? "bg-accent text-foreground" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-3xs font-semibold",
                    i < step
                      ? "bg-status-done/15 text-status-done"
                      : i === step
                        ? "bg-primary text-primary-foreground"
                        : "border border-border",
                  )}
                >
                  {i < step ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                </span>
                {label}
              </button>
              {i < STEPS.length - 1 && <span className="h-px w-6 bg-border" />}
            </li>
          ))}
        </ol>

        {step === 0 && <SetupChecklist />}
        {step === 1 && <Extras />}
        {step === 2 && (
          <ProjectSourcePicker
            submitLabel="Add project & finish"
            onCreated={(id) => void finish(id)}
          />
        )}

        <div className="mt-6 flex items-center justify-between">
          <Button variant="ghost" className="text-muted-foreground" onClick={() => void finish()}>
            Skip setup
          </Button>
          {step < 2 ? (
            <Button disabled={step === 0 && !ready} onClick={() => setStep(step + 1)}>
              {step === 1 ? "Continue" : ready ? "Continue" : "Waiting for a provider…"}{" "}
              <ArrowRight />
            </Button>
          ) : (
            <Button variant="outline" onClick={() => void finish()}>
              I'll add a project later
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
