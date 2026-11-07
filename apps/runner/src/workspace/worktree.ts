import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { RunnerCommandOf, RunnerCommandResult, RunnerEvent } from "@codeden/contracts";
import { CommandError } from "../errors";
import { topLevel } from "../git/checkpoints";
import { git, gitOk, isWorkTree } from "../git/exec";
import { currentBranch, defaultBranch } from "../git/ops";
import type { ProcessSupervisor } from "../process/supervisor";
import { readProjectConfig } from "./project-config";
import { runSetup, type SetupStep } from "./setup";

export interface WorkspaceContext {
  home: string;
  supervisor: ProcessSupervisor;
  emit: (event: RunnerEvent) => void;
}

/** Short, path-safe form of a session id (worktree directory and default branch name). */
export function sessionShort(sessionId: string): string {
  const cleaned = sessionId.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (cleaned.length >= 4) return cleaned.slice(0, 8);
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 8);
}

/** Project slug from a repo path when the server didn't send one. */
export function slugFromPath(repoPath: string): string {
  const slug = basename(resolve(repoPath))
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "project";
}

function branchExists(cwd: string, branch: string): Promise<boolean> {
  return gitOk(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
}

async function uniqueBranch(cwd: string, wanted: string): Promise<string> {
  if (!(await branchExists(cwd, wanted))) return wanted;
  for (let i = 2; i < 100; i++) {
    const candidate = `${wanted}-${i}`;
    if (!(await branchExists(cwd, candidate))) return candidate;
  }
  throw new CommandError("branch_exists", `No free branch name for ${wanted}`);
}

async function resolveBase(
  repo: string,
  cmd: RunnerCommandOf<"workspace.prepare">,
): Promise<string> {
  let fetched = false;
  const hasOrigin = await gitOk(repo, ["remote", "get-url", "origin"]);
  if (cmd.fetch && hasOrigin) {
    fetched = await git(repo, ["fetch", "--prune", "origin"], { timeoutMs: 120_000 }).then(
      () => true,
      () => false,
    );
  }
  if (cmd.baseRef) return cmd.baseRef;
  const def = await defaultBranch(repo);
  if (
    def &&
    fetched &&
    (await gitOk(repo, ["rev-parse", "--verify", "--quiet", `origin/${def}`]))
  ) {
    return `origin/${def}`;
  }
  return def ?? "HEAD";
}

async function createWorktree(
  cmd: RunnerCommandOf<"workspace.prepare">,
  home: string,
): Promise<{ cwd: string; branch: string | null; created: boolean }> {
  const repo = await topLevel(cmd.repoPath).catch(() => {
    throw new CommandError("not_a_repo", `${cmd.repoPath} is not a git repository`);
  });
  const short = sessionShort(cmd.sessionId);
  const path = resolve(cmd.path ?? join(home, "wt", cmd.projectSlug ?? slugFromPath(repo), short));
  if (existsSync(path)) {
    if (await isWorkTree(path)) {
      return { cwd: path, branch: await currentBranch(path), created: false };
    }
    if (readdirSync(path).length > 0) {
      throw new CommandError("path_exists", `${path} exists and is not a worktree`);
    }
  }
  await mkdir(dirname(path), { recursive: true });
  const base = await resolveBase(repo, cmd);
  if (cmd.branch && (await branchExists(repo, cmd.branch))) {
    await git(repo, ["worktree", "add", path, cmd.branch], { timeoutMs: 10 * 60_000 });
    return { cwd: path, branch: cmd.branch, created: true };
  }
  const branch = cmd.branch ?? (await uniqueBranch(repo, `codeden/${short}`));
  await git(repo, ["worktree", "add", "--no-track", "-b", branch, path, base], {
    timeoutMs: 10 * 60_000,
  });
  return { cwd: path, branch, created: true };
}

/**
 * `workspace.prepare` (§9): resolve the session's working directory (repo root, an existing
 * worktree, or a new worktree under `<home>/wt/<slug>/<short>` on a new branch), then run
 * `.codeden/project.json` setup (new worktrees only) and the explicit setup commands.
 */
export async function prepareWorkspace(
  cmd: RunnerCommandOf<"workspace.prepare">,
  ctx: WorkspaceContext,
): Promise<RunnerCommandResult<"workspace.prepare">> {
  let target: { cwd: string; branch: string | null; created: boolean };
  switch (cmd.strategy) {
    case "repo_root": {
      if (!existsSync(cmd.repoPath))
        throw new CommandError("not_found", `${cmd.repoPath} not found`);
      const isRepo = await isWorkTree(cmd.repoPath);
      const cwd = isRepo ? await topLevel(cmd.repoPath) : resolve(cmd.repoPath);
      target = { cwd, branch: isRepo ? await currentBranch(cwd) : null, created: false };
      break;
    }
    case "existing": {
      if (!cmd.path || !existsSync(cmd.path)) {
        throw new CommandError("not_found", `Existing worktree ${cmd.path ?? "(none)"} not found`);
      }
      if (!(await isWorkTree(cmd.path))) {
        throw new CommandError("not_a_repo", `${cmd.path} is not a git worktree`);
      }
      target = { cwd: resolve(cmd.path), branch: await currentBranch(cmd.path), created: false };
      break;
    }
    case "worktree":
      target = await createWorktree(cmd, ctx.home);
      break;
  }

  const { config, error } = await readProjectConfig(target.cwd);
  if (error) {
    ctx.emit({
      kind: "workspace.setup",
      sessionId: cmd.sessionId,
      status: "failed",
      command: ".codeden/project.json",
      output: error,
    });
  }
  const commands = [
    ...(target.created && cmd.runProjectSetup !== false ? (config?.setup ?? []) : []),
    ...cmd.setupCommands,
  ];
  let setup: SetupStep[] = [];
  if (commands.length > 0) {
    setup = await runSetup({
      sessionId: cmd.sessionId,
      cwd: target.cwd,
      commands,
      supervisor: ctx.supervisor,
      emit: ctx.emit,
    });
  }
  return { ...target, config, setup };
}

/** `workspace.remove`: remove a worktree (retrying briefly for Windows file locks). */
export async function removeWorkspace(
  cmd: RunnerCommandOf<"workspace.remove">,
): Promise<RunnerCommandResult<"workspace.remove">> {
  const path = resolve(cmd.path);
  let removed = false;
  let lastError: unknown;
  for (let attempt = 0; attempt < 5 && !removed; attempt++) {
    try {
      const args = ["worktree", "remove", ...(cmd.force ? ["--force"] : []), path];
      await git(cmd.repoPath, args);
      removed = true;
    } catch (error) {
      lastError = error;
      if (!existsSync(path)) break;
      if (!cmd.force && /modified or untracked|contains/.test(String(error))) break;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  if (!removed && existsSync(path) && cmd.force) {
    await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    removed = true;
  }
  await git(cmd.repoPath, ["worktree", "prune"]).catch(() => undefined);
  if (!removed && existsSync(path)) {
    throw lastError instanceof Error
      ? lastError
      : new CommandError("remove_failed", `Could not remove ${path}`);
  }
  if (cmd.deleteBranch) {
    await git(cmd.repoPath, ["branch", "-D", cmd.deleteBranch]).catch(() => undefined);
  }
  return { removed: removed || !existsSync(path) };
}
