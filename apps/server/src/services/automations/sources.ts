import { existsSync, type FSWatcher, watch } from "node:fs";
import { join } from "node:path";
import type {
  Automation,
  AutomationFileError,
  AutomationTemplate,
  NewEvent,
  Project,
} from "@codeden/contracts";
import { inArray } from "drizzle-orm";
import type { Db } from "../../db/client";
import { rowToAutomation } from "../../db/rows";
import { automations } from "../../db/schema";
import type { EventStore } from "../../events/store";
import { errorMessage } from "../errors";
import type { ProjectService } from "../projects/project-service";
import {
  findTemplatesDir,
  type ParsedAutomationFile,
  readAutomationDir,
  toTemplate,
} from "./templates";

export interface AutomationSourcesDeps {
  db: Db;
  store: EventStore;
  projects: ProjectService;
  /** `~/.codeden/automations`. */
  globalDir: string;
  /** Built-in templates folder (found automatically when omitted). */
  templatesDir?: string;
  /** Called after a reload changed any definition. */
  onChange?: () => void;
  /** Rescan interval for folders created after start (default 60 s; 0 disables). */
  rescanMs?: number;
  log?: (message: string) => void;
}

const FILE_SOURCES = ["global_file", "project_file"] as const;

/** Repo-relative folder of project automation files. */
export const PROJECT_AUTOMATIONS_DIR = join(".codeden", "automations");

/** The definition fields that, when changed in a file, update the stored automation. */
function definitionKey(a: Automation): string {
  return JSON.stringify([
    a.name,
    a.description,
    a.templateId,
    a.trigger,
    a.action,
    a.target,
    a.guards,
    a.workKey ?? null,
  ]);
}

/**
 * Automation definitions from Markdown files (§10): global ones in `~/.codeden/automations/`
 * (they target all projects) and each project's `.codeden/automations/` (that project only).
 * They are mirrored into the `automations` projection through `automation.saved` /
 * `automation.deleted`, keeping the enabled flag (files never enable anything). Folders are
 * watched, with a periodic rescan for folders created later. Built-in templates are read once.
 */
export class AutomationSources {
  private readonly paths = new Map<string, string>();
  private errors: AutomationFileError[] = [];
  private builtin: AutomationTemplate[] = [];
  private globalTemplates: AutomationTemplate[] = [];
  private readonly watchers = new Map<string, FSWatcher>();
  private timer: NodeJS.Timeout | undefined;
  private rescan: NodeJS.Timeout | undefined;

  constructor(private readonly deps: AutomationSourcesDeps) {
    const dir = findTemplatesDir(deps.templatesDir);
    if (dir) {
      const { files, errors } = readAutomationDir(dir);
      this.builtin = files.map((f) => toTemplate(f, "builtin"));
      for (const e of errors) deps.log?.(`automations: built-in template ${e.path}: ${e.message}`);
    } else {
      deps.log?.("automations: built-in templates folder not found");
    }
  }

  /** Built-in templates, then global automation files. */
  templates(): AutomationTemplate[] {
    const builtinIds = new Set(this.builtin.map((t) => t.id));
    return [...this.builtin, ...this.globalTemplates.filter((t) => !builtinIds.has(t.id))];
  }

  template(id: string): AutomationTemplate | undefined {
    return this.templates().find((t) => t.id === id);
  }

  fileErrors(): AutomationFileError[] {
    return this.errors;
  }

  pathOf(automationId: string): string | null {
    return this.paths.get(automationId) ?? null;
  }

  start(): void {
    this.reload();
    const every = this.deps.rescanMs ?? 60_000;
    if (every > 0) {
      this.rescan = setInterval(() => this.reload(), every);
      this.rescan.unref();
    }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.rescan) clearInterval(this.rescan);
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
  }

  /** Re-read every folder and sync the projection. Returns true when anything changed. */
  reload(): boolean {
    const now = new Date().toISOString();
    const errors: AutomationFileError[] = [];
    const found: Automation[] = [];
    const paths = new Map<string, string>();
    const add = (
      file: { path: string; parsed: ParsedAutomationFile },
      base: Pick<Automation, "id" | "source" | "target">,
    ) => {
      const { parsed } = file;
      found.push({
        ...base,
        name: parsed.frontmatter.name,
        description: parsed.frontmatter.description ?? null,
        enabled: false,
        templateId: parsed.id,
        trigger: parsed.frontmatter.trigger,
        action: parsed.action,
        guards: parsed.guards,
        workKey: parsed.workKey,
        createdAt: now,
        updatedAt: now,
      });
      paths.set(base.id, file.path);
    };

    const global = readAutomationDir(this.deps.globalDir);
    errors.push(...global.errors);
    this.globalTemplates = global.files.map((f) => toTemplate(f, "global_file"));
    for (const file of global.files) {
      add(file, {
        id: `global:${file.parsed.id}`,
        source: "global_file",
        target: { type: "all_projects" },
      });
    }
    const dirs = [this.deps.globalDir];
    for (const project of this.deps.projects.list()) {
      if (project.archivedAt) continue;
      const dir = join(project.path, PROJECT_AUTOMATIONS_DIR);
      dirs.push(dir);
      const local = readAutomationDir(dir);
      errors.push(...local.errors);
      for (const file of local.files) {
        add(file, {
          id: `project:${project.id}:${file.parsed.id}`,
          source: "project_file",
          target: { type: "project", projectId: project.id },
        });
      }
    }
    this.errors = errors;
    this.paths.clear();
    for (const [k, v] of paths) this.paths.set(k, v);
    this.watchDirs(dirs);
    return this.sync(found);
  }

  /** Store new or changed file definitions and delete those whose file is gone. */
  private sync(found: Automation[]): boolean {
    const existing = new Map(
      this.deps.db
        .select()
        .from(automations)
        .where(inArray(automations.source, [...FILE_SOURCES]))
        .all()
        .map((r) => {
          const a = rowToAutomation(r);
          return [a.id, a] as const;
        }),
    );
    const events: NewEvent[] = [];
    for (const next of found) {
      const prev = existing.get(next.id);
      existing.delete(next.id);
      if (prev && definitionKey(prev) === definitionKey(next)) continue;
      const automation: Automation = prev
        ? { ...next, enabled: prev.enabled, createdAt: prev.createdAt }
        : next;
      events.push({ type: "automation.saved", sessionId: null, payload: { automation } });
    }
    for (const gone of existing.keys()) {
      events.push({ type: "automation.deleted", sessionId: null, payload: { automationId: gone } });
    }
    if (events.length === 0) return false;
    this.deps.store.append(events);
    this.deps.onChange?.();
    return true;
  }

  private watchDirs(dirs: string[]): void {
    const wanted = new Set(dirs.filter((d) => existsSync(d)));
    for (const [dir, watcher] of this.watchers) {
      if (!wanted.has(dir)) {
        watcher.close();
        this.watchers.delete(dir);
      }
    }
    for (const dir of wanted) {
      if (this.watchers.has(dir)) continue;
      try {
        const watcher = watch(dir, () => this.scheduleReload());
        watcher.on("error", () => {
          watcher.close();
          this.watchers.delete(dir);
        });
        this.watchers.set(dir, watcher);
      } catch (error) {
        this.deps.log?.(`automations: cannot watch ${dir}: ${errorMessage(error)}`);
      }
    }
  }

  private scheduleReload(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      try {
        this.reload();
      } catch (error) {
        this.deps.log?.(`automations: reload failed: ${errorMessage(error)}`);
      }
    }, 200);
    this.timer.unref();
  }
}

/** True when a project can run a template (GitHub-only templates need a GitHub project). */
export function templateFits(template: AutomationTemplate, project: Project): boolean {
  return !template.requiresGithub || project.kind === "github";
}
