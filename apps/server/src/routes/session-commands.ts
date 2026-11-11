import { listClaudeCommands } from "@codeden/providers";
import { Hono } from "hono";
import type { AppServices } from "../services/container";
import { workdir } from "../services/workbench/workbench-service";

/** What the composer's `/` menu shows (see the web client's `SlashCommand`). */
interface SlashCommandRow {
  name: string;
  description: string;
  kind: "command" | "skill";
  provider?: string;
}

/**
 * `GET /api/sessions/:id/commands`: the slash commands the session's provider accepts, for the
 * composer's `/` menu. Claude sessions ask Claude Code in the session's folder (its own
 * commands plus user, project and plugin commands and skills); Codex has none.
 */
export function sessionCommandRoutes(s: AppServices) {
  return new Hono().get("/:id/commands", async (c) => {
    const session = s.sessionRepo.get(c.req.param("id"));
    if (session.provider !== "claude") return c.json([] as SlashCommandRow[]);
    const commands = await listClaudeCommands(workdir(session));
    const rows: SlashCommandRow[] = commands.map((cmd) => ({
      name: cmd.name,
      description: cmd.argumentHint
        ? `${cmd.description} · ${cmd.argumentHint}`.trim()
        : cmd.description,
      kind: cmd.builtin ? "command" : "skill",
      provider: "claude",
    }));
    return c.json(rows);
  });
}
