import type { RunnerCommand, RunnerCommandResult, RunnerEvent } from "@codeden/contracts";
import type { ProviderRegistry } from "@codeden/providers";
import { CommandError } from "./errors";
import {
  createCheckpoint,
  diffCheckpoints,
  listCheckpoints,
  restoreFiles,
} from "./git/checkpoints";
import * as gitOps from "./git/ops";
import type { Journal } from "./journal";
import { listPorts } from "./ports";
import type { ProcessSupervisor } from "./process/supervisor";
import type { TerminalHost } from "./pty/terminal-host";
import type { SessionHost } from "./session-host";
import { prepareWorkspace, removeWorkspace } from "./workspace/worktree";

/** Everything command handlers need; owned by `startRunner`. */
export interface RunnerCore {
  home: string;
  version: string;
  journal: Journal;
  host: SessionHost;
  terminals: TerminalHost;
  supervisor: ProcessSupervisor;
  registry: ProviderRegistry;
  startedAt: string;
  emit: (event: RunnerEvent) => void;
  isDraining: () => boolean;
  drain: (opts: { reason: string; timeoutMs?: number; exitWhenDrained?: boolean }) => void;
  /** Point the MCP proxy at an upstream; returns the agent-facing proxy URL. */
  configureMcp: (upstreamUrl: string | null) => string | null;
  /** Exit the process shortly after the current result is sent. */
  shutdown: () => void;
}

type AnyResult = RunnerCommandResult<RunnerCommand["name"]>;

/** Execute one server command (§4.3). Throws `CommandError` for expected failures. */
export async function executeCommand(core: RunnerCore, command: RunnerCommand): Promise<AnyResult> {
  const { host, journal, registry, terminals } = core;
  switch (command.name) {
    case "runner.status":
      return {
        sessions: host.list(),
        ptys: terminals.ids(),
        journal: { lastSeq: journal.lastSeq, unacked: journal.unacked },
        draining: core.isDraining(),
      };
    case "runner.drain":
      core.drain(command);
      return {};
    case "runner.configure":
      return { mcpProxyUrl: core.configureMcp(command.mcpUpstreamUrl) };
    case "runner.shutdown":
      core.shutdown();
      return {};
    case "provider.detect": {
      const adapters = command.providerId
        ? registry.list().filter((a) => a.id === command.providerId)
        : registry.list();
      return { statuses: await Promise.all(adapters.map((a) => a.detect())) };
    }

    case "provider.oneShot": {
      const adapter = registry.get(command.providerId);
      const utility = adapter?.utilityModel?.();
      if (!utility) {
        throw new CommandError(
          "unsupported",
          `Provider ${command.providerId} has no utility model`,
        );
      }
      const model = command.model ?? utility.defaultModel;
      const text = await utility.runOneShot({
        prompt: command.prompt,
        system: command.system,
        model,
        timeoutMs: command.timeoutMs,
      });
      return { text, model };
    }

    case "workspace.prepare":
      if (core.isDraining()) throw new CommandError("draining", "Runner is draining");
      return prepareWorkspace(command, {
        home: core.home,
        supervisor: core.supervisor,
        emit: core.emit,
      });
    case "workspace.remove":
      await terminals.closeUnder(command.path);
      await core.supervisor.killUnder(command.path);
      return removeWorkspace(command);

    case "session.start":
      if (core.isDraining()) throw new CommandError("draining", "Runner is draining");
      return host.start(command);
    case "session.send":
      await host.send(command);
      return {};
    case "session.steer":
      await host.steer(command);
      return {};
    case "session.interrupt":
      await host.interrupt(command.sessionId);
      return {};
    case "session.respond":
      await host.respond(command);
      return {};
    case "session.stop":
      await host.stop(command.sessionId);
      return {};

    case "pty.open":
      return terminals.open(command);
    case "pty.input":
      terminals.input(command.ptyId, command.data);
      return {};
    case "pty.resize":
      terminals.resize(command.ptyId, command.cols, command.rows);
      return {};
    case "pty.attach":
      return terminals.attach(command.ptyId);
    case "pty.close":
      await terminals.close(command.ptyId);
      return {};

    case "git.checkpoint": {
      const cp = await createCheckpoint(command.cwd, command.sessionId, command.index);
      const { index, ref, commit } = cp;
      core.emit({ kind: "checkpoint.created", sessionId: command.sessionId, index, ref, commit });
      return { ref: cp.ref, commit: cp.commit };
    }
    case "git.status":
      return gitOps.status(command.cwd);
    case "git.diff":
      return gitOps.diff(command);
    case "git.branches":
      return gitOps.branches(command);
    case "git.commit":
      return gitOps.commit(command);
    case "git.push":
      return gitOps.push(command);

    case "checkpoint.list":
      return { checkpoints: await listCheckpoints(command.cwd, command.sessionId) };
    case "checkpoint.diff":
      return diffCheckpoints(command.cwd, command.sessionId, command.from, command.to);
    case "checkpoint.restoreFiles":
      return restoreFiles(command.cwd, command.sessionId, command.index, command.paths);

    case "ports.list":
      return { ports: await listPorts(command.probe) };

    default: {
      // --- browser.* (apps/runner/src/browser) --- only browser commands reach here (checked).
      // Wire: return browserHandlers.execute(browserCommand) from createBrowserCommandHandlers.
      const browserCommand: Extract<RunnerCommand, { name: `browser.${string}` }> = command;
      throw new CommandError("not_implemented", `${browserCommand.name} is not implemented yet`);
    }
  }
}
