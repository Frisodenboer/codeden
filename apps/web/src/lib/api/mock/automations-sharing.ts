import {
  type Automation,
  type AutomationAction,
  type AutomationDraft,
  AutomationGuards,
  type AutomationImportFile,
  type AutomationImportPreviewItem,
  type AutomationListItem,
  type AutomationTrigger,
} from "@codeden/contracts";
import type { AutomationsApi } from "../automations-api";
import { uid } from "./live";

type SharingApi = Pick<
  AutomationsApi,
  "duplicate" | "exportOne" | "exportAll" | "previewImport" | "importAutomations"
>;

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "automation";

/** A JSON value is valid YAML, so the mock writes the frontmatter values as JSON. */
function mockMarkdown(a: Automation): string {
  const lines = [`name: ${JSON.stringify(a.name)}`, `trigger: ${JSON.stringify(a.trigger)}`];
  if (a.description) lines.splice(1, 0, `description: ${JSON.stringify(a.description)}`);
  lines.push(`action: ${a.action.type}`);
  if (a.workKey) lines.push(`workKey: ${JSON.stringify(a.workKey)}`);
  let body = "";
  if (a.action.type === "start_session") {
    for (const k of ["provider", "model", "effort", "autonomy"] as const) {
      if (a.action[k]) lines.push(`${k}: ${a.action[k]}`);
    }
    body = a.action.prompt;
  } else if (a.action.type === "message_pm") body = a.action.message;
  else body = a.action.instructions ?? "";
  return `---\n${lines.join("\n")}\n---\n${body}\n`;
}

/** A very small frontmatter reader, enough for the mock's import preview. */
function mockPreview(file: AutomationImportFile): AutomationImportPreviewItem {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(file.content);
  const fail = (error: string) => ({
    fileName: file.name,
    automation: null,
    error,
    fullPermissions: false,
  });
  if (!match) return fail("Missing YAML frontmatter (the file must start with ---)");
  const yaml = match[1] ?? "";
  const field = (key: string) =>
    new RegExp(`^\\s*${key}:\\s*["']?(.+?)["']?\\s*$`, "m").exec(yaml)?.[1];
  const name = field("name");
  if (!name) return fail("name: Invalid input: expected string, received undefined");
  const expression = field("expression");
  const event = field("event");
  const trigger: AutomationTrigger = expression
    ? { type: "cron", expression, ...(field("timezone") ? { timezone: field("timezone") } : {}) }
    : event
      ? ({ type: "event", event } as AutomationTrigger)
      : { type: "manual" };
  const autonomy = field("autonomy") as Extract<
    AutomationAction,
    { type: "start_session" }
  >["autonomy"];
  const provider = field("provider");
  const prompt = (match[2] ?? "").trim();
  if (!prompt) return fail("The Markdown body (the prompt) is empty");
  const automation: AutomationDraft = {
    name,
    description: field("description") ?? null,
    trigger,
    action: {
      type: "start_session",
      prompt,
      ...(provider ? { provider } : {}),
      ...(autonomy ? { autonomy } : {}),
    },
    guards: AutomationGuards.parse({}),
    workKey: field("workKey") ?? `automation:${slug(file.name.replace(/\.md$/i, ""))}`,
  };
  return { fileName: file.name, automation, error: null, fullPermissions: autonomy === "full" };
}

/** Duplicate, export and import in the mock (no real zip: the mock never downloads one). */
export function mockSharingApi(deps: {
  find: (id: string) => Automation;
  all: (projectId?: string) => Automation[];
  save: (a: Automation) => AutomationListItem;
}): SharingApi {
  const files = (source: Parameters<SharingApi["previewImport"]>[0]): AutomationImportFile[] => [
    ...(source.files ?? []),
    ...(source.text
      ? [
          {
            name: `${slug(/name:\s*(.+)/.exec(source.text)?.[1] ?? "pasted")}.md`,
            content: source.text,
          },
        ]
      : []),
  ];
  const create = (draft: AutomationDraft, projectId: string | undefined, createdBy?: "import") => {
    const now = new Date().toISOString();
    return deps.save({
      ...draft,
      id: uid("a"),
      enabled: false,
      source: "database",
      templateId: null,
      target: projectId ? { type: "project", projectId } : { type: "all_projects" },
      ...(createdBy ? { createdBy } : {}),
      createdAt: now,
      updatedAt: now,
    });
  };
  return {
    async duplicate(id, req = {}) {
      const a = deps.find(id);
      return create(
        { ...a, name: req.name ?? `${a.name} (copy)`, workKey: a.workKey ?? `automation:${id}` },
        req.projectId ?? (a.target.type === "project" ? a.target.projectId : undefined),
      );
    },
    async exportOne(id) {
      const a = deps.find(id);
      return { fileName: `${slug(a.name)}.md`, markdown: mockMarkdown(a) };
    },
    async exportAll(projectId) {
      const list = deps.all(projectId);
      return { fileName: "codeden-automations.zip", zipBase64: "", count: list.length };
    },
    async previewImport(source) {
      return { items: files(source).map(mockPreview) };
    },
    async importAutomations(req) {
      const items = files(req.source)
        .map(mockPreview)
        .filter((i) => !req.select || req.select.includes(i.fileName));
      return {
        created: items.flatMap((i) =>
          i.automation ? [create(i.automation, req.projectId, "import")] : [],
        ),
        failed: items.flatMap((i) =>
          i.automation ? [] : [{ fileName: i.fileName, error: i.error ?? "Invalid file" }],
        ),
      };
    },
  };
}
