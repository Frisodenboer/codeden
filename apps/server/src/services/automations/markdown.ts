import {
  type Automation,
  type AutomationExport,
  type AutomationFileFrontmatter,
  AutomationGuards,
} from "@codeden/contracts";
import { stringify } from "yaml";
import { fileStemToId } from "./templates";

/** The parts of an automation its file holds (not its id, target, switch or history). */
export type ExportableAutomation = Pick<
  Automation,
  "name" | "description" | "trigger" | "action" | "guards" | "workKey"
>;

type Frontmatter = Partial<Record<keyof AutomationFileFrontmatter, unknown>>;

/** Guards that differ from the defaults, so an exported file stays short. */
function changedGuards(guards: Automation["guards"]): Record<string, unknown> | undefined {
  const defaults = AutomationGuards.parse({});
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(guards) as (keyof Automation["guards"])[]) {
    if (JSON.stringify(guards[key]) !== JSON.stringify(defaults[key])) out[key] = guards[key];
  }
  return Object.keys(out).length ? out : undefined;
}

/** `<slug>.md` for an automation, e.g. `release-notes-draft.md`. */
export function exportFileName(a: Pick<Automation, "name">): string {
  return `${fileStemToId(a.name)}.md`;
}

/**
 * An automation in the file format (§10): YAML frontmatter plus a Markdown body (the prompt,
 * the PM message or extra triage guidance). The result parses back to the same definition
 * with `parseAutomationMarkdown`, so it also works dropped into `.codeden/automations/`.
 */
export function automationToMarkdown(a: ExportableAutomation): string {
  const fm: Frontmatter = { name: a.name };
  if (a.description) fm.description = a.description;
  fm.trigger = a.trigger;
  fm.action = a.action.type;
  // The default work key comes from the file name, which may differ when shared.
  if (a.workKey) fm.workKey = a.workKey;
  let body = "";
  if (a.action.type === "start_session") {
    const { prompt, title, provider, model, effort, autonomy } = a.action;
    Object.assign(fm, { title, provider, model, effort, autonomy });
    body = prompt;
  } else if (a.action.type === "message_pm") {
    body = a.action.message;
  } else {
    if (a.action.policy) fm.policy = a.action.policy;
    body = a.action.instructions ?? "";
  }
  const guards = changedGuards(a.guards);
  if (guards) fm.guards = guards;
  for (const key of Object.keys(fm) as (keyof Frontmatter)[]) {
    if (fm[key] === undefined) delete fm[key];
  }
  const yaml = stringify(fm, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n${body.trim()}\n`;
}

/** The export of one automation: file name and Markdown. */
export function exportAutomation(a: ExportableAutomation): AutomationExport {
  return { fileName: exportFileName(a), markdown: automationToMarkdown(a) };
}
