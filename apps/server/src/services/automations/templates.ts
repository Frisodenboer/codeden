import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type AutomationAction,
  type AutomationFileError,
  AutomationFileFrontmatter,
  AutomationGuards,
  type AutomationTemplate,
} from "@codeden/contracts";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/** An automation Markdown file, parsed and normalized. */
export interface ParsedAutomationFile {
  /** File name without `.md`, normalized to `[a-z0-9-]`. */
  id: string;
  frontmatter: AutomationFileFrontmatter;
  action: AutomationAction;
  guards: AutomationGuards;
  workKey: string;
}

const FRONTMATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

/** `Security Audit.md` -> `security-audit`. */
export function fileStemToId(fileName: string): string {
  return (
    fileName
      .replace(/\.md$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "automation"
  );
}

/**
 * Parse an automation file: YAML frontmatter (`AutomationFileFrontmatter`) and a Markdown body,
 * which is the prompt (`start_session`), the message (`message_pm`) or extra triage guidance.
 * Throws an `Error` with a readable message when the file is invalid.
 */
export function parseAutomationMarkdown(text: string, id: string): ParsedAutomationFile {
  const match = FRONTMATTER.exec(text);
  if (!match) throw new Error("Missing YAML frontmatter (the file must start with ---)");
  let raw: unknown;
  try {
    raw = parseYaml(match[1] ?? "");
  } catch (error) {
    throw new Error(`Invalid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = AutomationFileFrontmatter.safeParse(raw ?? {});
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
  const fm = parsed.data;
  const body = (match[2] ?? "").trim();
  return {
    id,
    frontmatter: fm,
    action: buildAction(fm, body),
    guards: AutomationGuards.parse(fm.guards ?? {}),
    workKey: fm.workKey ?? `automation:${id}`,
  };
}

function buildAction(fm: AutomationFileFrontmatter, body: string): AutomationAction {
  switch (fm.action) {
    case "start_session":
      if (!body) throw new Error("The Markdown body (the prompt) is empty");
      return {
        type: "start_session",
        prompt: body,
        ...(fm.title ? { title: fm.title } : {}),
        ...(fm.provider ? { provider: fm.provider } : {}),
        ...(fm.model ? { model: fm.model } : {}),
        ...(fm.effort ? { effort: fm.effort } : {}),
        ...(fm.autonomy ? { autonomy: fm.autonomy } : {}),
      };
    case "message_pm":
      if (!body) throw new Error("The Markdown body (the message) is empty");
      return { type: "message_pm", message: body };
    case "triage":
      return {
        type: "triage",
        ...(fm.policy ? { policy: fm.policy } : {}),
        ...(body ? { instructions: body } : {}),
      };
  }
}

/** Every `*.md` file in `dir` (sorted), parsed; invalid files become errors. */
export function readAutomationDir(dir: string): {
  files: { path: string; parsed: ParsedAutomationFile }[];
  errors: AutomationFileError[];
} {
  const files: { path: string; parsed: ParsedAutomationFile }[] = [];
  const errors: AutomationFileError[] = [];
  if (!existsSync(dir)) return { files, errors };
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".md"));
  } catch (error) {
    errors.push({ path: dir, message: error instanceof Error ? error.message : String(error) });
    return { files, errors };
  }
  for (const name of names.sort()) {
    const path = join(dir, name);
    try {
      files.push({
        path,
        parsed: parseAutomationMarkdown(readFileSync(path, "utf8"), fileStemToId(name)),
      });
    } catch (error) {
      errors.push({ path, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { files, errors };
}

/** A parsed file as a template. */
export function toTemplate(
  file: { path: string; parsed: ParsedAutomationFile },
  source: AutomationTemplate["source"],
): AutomationTemplate {
  const { parsed } = file;
  return {
    id: parsed.id,
    name: parsed.frontmatter.name,
    description: parsed.frontmatter.description ?? null,
    source,
    path: file.path,
    trigger: parsed.frontmatter.trigger,
    action: parsed.action,
    guards: parsed.guards,
    workKey: parsed.workKey,
    starter: parsed.frontmatter.starter,
    requiresGithub: parsed.frontmatter.requiresGithub,
  };
}

/**
 * The built-in templates folder: `dist/templates/automations` next to the CLI bundle (checked
 * first, so an installed package never picks up an unrelated folder), or
 * `apps/server/templates/automations` in the workspace.
 */
export function findTemplatesDir(explicit?: string): string | null {
  const here = import.meta.dirname;
  const candidates = [
    explicit,
    resolve(here, "templates/automations"),
    resolve(here, "../../../templates/automations"),
  ].filter((c): c is string => Boolean(c));
  return candidates.find((c) => existsSync(c)) ?? null;
}
