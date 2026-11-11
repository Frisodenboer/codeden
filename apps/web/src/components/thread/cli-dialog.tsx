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

/** `claude --resume <id>` continues this session's conversation in the real CLI. */
export function cliCommand(session: Pick<Session, "resumeToken">): string {
  const token =
    session.resumeToken && /^[\w-]+$/.test(session.resumeToken) ? session.resumeToken : null;
  return token ? `claude --resume ${token}` : "claude";
}

/**
 * "Open in CLI" for Claude sessions: a real Claude Code CLI in a terminal in the session's
 * folder, resuming the same conversation, so every CLI command works (/context, /exit, ...).
 * Disabled while CodeBench itself is running a turn, so the two never write at once.
 */
export function OpenInCli({ session, running }: { session: Session; running: boolean }) {
  const [open, setOpen] = useState(false);
  if (session.provider !== "claude") return null;
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
              aria-label="Open in Claude Code CLI"
            >
              <TerminalSquare />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {running ? "Wait until the turn ends to open the CLI" : "Open in Claude Code CLI"}
        </TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[85vh] w-[min(96vw,80rem)] max-w-none flex-col gap-3 sm:max-w-none">
          <DialogHeader>
            <DialogTitle>Claude Code CLI</DialogTitle>
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
