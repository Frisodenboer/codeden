import type { Session } from "@codeden/contracts";
import { TerminalSquare } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TerminalView } from "@/components/workbench/terminal-view";

/** The real CLI for each provider that has one CodeBench can resume into. */
const CLIS: Record<string, { name: string; bin: string; resume: string }> = {
  claude: { name: "Claude Code", bin: "claude", resume: "--resume" },
  opencode: { name: "opencode", bin: "opencode", resume: "--session" },
};

/**
 * The command that continues this session's conversation in the provider's real CLI:
 * `claude --resume <id>` or `opencode --session <id>`.
 */
export function cliCommand(session: Pick<Session, "resumeToken"> & { provider?: string }): string {
  const cli = CLIS[session.provider ?? "claude"] ?? CLIS.claude;
  if (!cli) return "claude";
  const token =
    session.resumeToken && /^[\w-]+$/.test(session.resumeToken) ? session.resumeToken : null;
  return token ? `${cli.bin} ${cli.resume} ${token}` : cli.bin;
}

/**
 * "Open in CLI" for Claude and opencode sessions: the real CLI in a terminal in the session's
 * folder, resuming the same conversation, so every CLI command works (/context, /exit, ...).
 * Disabled while CodeBench itself is running a turn, so the two never write at once.
 */
export function OpenInCli({ session, running }: { session: Session; running: boolean }) {
  const [open, setOpen] = useState(false);
  const cli = Object.hasOwn(CLIS, session.provider) ? CLIS[session.provider] : undefined;
  if (!cli) return null;
  const label = `Open in ${cli.name} CLI`;
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              disabled={running}
              onClick={() => setOpen(true)}
              aria-label={label}
            >
              <TerminalSquare />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {running ? "Wait until the turn ends to open the CLI" : label}
        </TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[85vh] w-[min(96vw,80rem)] max-w-none flex-col gap-3 sm:max-w-none">
          <DialogHeader>
            <DialogTitle>{cli.name} CLI</DialogTitle>
            <DialogDescription>
              The real CLI in this session&apos;s folder, continuing the same conversation (
              <code className="font-mono">{cliCommand(session)}</code>). Every command works here.
              Turns you take here don&apos;t show in CodeBench&apos;s chat. Close this window (or
              type /exit) before you send CodeBench a new message.
            </DialogDescription>
          </DialogHeader>
          {open && (
            <TerminalView
              sessionId={session.id}
              command={cliCommand(session)}
              slot="cli"
              ephemeral
              className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
