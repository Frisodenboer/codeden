import { z } from "zod";
import { AutomationListItem } from "./automations-api";
import { Id } from "./common";
import { AutomationAction, AutomationGuards, AutomationTrigger } from "./entities/automation";

/**
 * Sharing automations (§10): duplicate, export as the Markdown + YAML frontmatter file format
 * (one `.md`, or all of a project's as a `.zip`), and import those files back. Imports are
 * parsed with the same parser and validation as automation files, never run anything and
 * always start off.
 */

/** Size limits for an import, checked by the server before anything is parsed. */
export const AUTOMATION_IMPORT_LIMITS = {
  /** Automation files in one import (Markdown files, zip entries or pasted text). */
  maxFiles: 50,
  /** One file's text, in UTF-16 code units (about bytes for ASCII). */
  maxFileChars: 128 * 1024,
  /** All files together, after unzipping. */
  maxTotalChars: 1024 * 1024,
  /** A zip as uploaded, before base64 (base64 makes it about a third bigger). */
  maxZipBytes: 1024 * 1024,
  /** Entries a zip may list, `.md` or not (more is refused before inflating anything). */
  maxZipEntries: 200,
} as const;

/** One Markdown automation file to import. */
export const AutomationImportFile = z.object({
  /** File name, e.g. `release-notes.md`; its stem becomes the default work key. */
  name: z.string().trim().min(1).max(255),
  content: z.string().max(AUTOMATION_IMPORT_LIMITS.maxFileChars),
});
export type AutomationImportFile = z.infer<typeof AutomationImportFile>;

/** What to import: Markdown files, a zip of them (base64) and/or pasted Markdown. */
export const AutomationImportSource = z
  .object({
    files: z.array(AutomationImportFile).max(AUTOMATION_IMPORT_LIMITS.maxFiles).optional(),
    /** A `.zip` of `.md` files, base64-encoded. Other entries are ignored. */
    zipBase64: z
      .string()
      .max(Math.ceil(AUTOMATION_IMPORT_LIMITS.maxZipBytes / 3) * 4 + 4)
      .optional(),
    /** One automation pasted as text. */
    text: z.string().max(AUTOMATION_IMPORT_LIMITS.maxFileChars).optional(),
  })
  .refine((s) => Boolean(s.files?.length || s.zipBase64 || s.text?.trim()), {
    message: "Pass files, a zip or pasted text",
  });
export type AutomationImportSource = z.infer<typeof AutomationImportSource>;

/** The definition an import would create (no id, target or switch yet). */
export const AutomationDraft = z.object({
  name: z.string().min(1),
  description: z.string().nullable(),
  trigger: AutomationTrigger,
  action: AutomationAction,
  guards: AutomationGuards,
  workKey: z.string().min(1).max(200),
});
export type AutomationDraft = z.infer<typeof AutomationDraft>;

/** One file of an import preview: the parsed automation, or why it cannot be imported. */
export const AutomationImportPreviewItem = z.object({
  /** File name, unique within the import (duplicates get ` (2)`). */
  fileName: z.string(),
  /** Null when the file is invalid. */
  automation: AutomationDraft.nullable(),
  /** Validation error (bad YAML, unknown fields, invalid cron, ...); null when importable. */
  error: z.string().nullable(),
  /** Runs with Full permissions: it never asks before acting. */
  fullPermissions: z.boolean(),
});
export type AutomationImportPreviewItem = z.infer<typeof AutomationImportPreviewItem>;

/** `POST /api/automations/import/preview`. Parses only; nothing is saved or run. */
export const AutomationImportPreviewResponse = z.object({
  items: z.array(AutomationImportPreviewItem),
});
export type AutomationImportPreviewResponse = z.infer<typeof AutomationImportPreviewResponse>;

/**
 * `POST /api/automations/import`: re-parse the same source and create the selected files as
 * database automations, always off. `projectId` targets one project; omitted, all projects.
 */
export const ImportAutomationsRequest = z.object({
  source: AutomationImportSource,
  projectId: Id.optional(),
  /** File names (from the preview) to import; omitted, every valid file. */
  select: z.array(z.string()).max(AUTOMATION_IMPORT_LIMITS.maxFiles).optional(),
});
export type ImportAutomationsRequest = z.infer<typeof ImportAutomationsRequest>;

export const ImportAutomationsResponse = z.object({
  /** The new automations, all off. */
  created: z.array(AutomationListItem),
  /** Selected files that could not be imported, with the reason. */
  failed: z.array(z.object({ fileName: z.string(), error: z.string() })),
});
export type ImportAutomationsResponse = z.infer<typeof ImportAutomationsResponse>;

/** `GET /api/automations/:id/export`: one automation in the file format. */
export const AutomationExport = z.object({
  /** `<slug>.md`. */
  fileName: z.string().min(1),
  markdown: z.string(),
});
export type AutomationExport = z.infer<typeof AutomationExport>;

/** `GET /api/automations/export?projectId=`: the query; without a project, every automation. */
export const ExportAutomationsQuery = z.object({ projectId: Id.optional() });
export type ExportAutomationsQuery = z.infer<typeof ExportAutomationsQuery>;

/** All automations (of a project) as a zip of `.md` files. */
export const ExportAutomationsResponse = z.object({
  fileName: z.string().min(1),
  /** The zip, base64-encoded. */
  zipBase64: z.string(),
  count: z.int().nonnegative(),
});
export type ExportAutomationsResponse = z.infer<typeof ExportAutomationsResponse>;

/**
 * `POST /api/automations/:id/duplicate`: an editable copy (also of file-based and built-in
 * automations), off. `projectId` targets one project; omitted, the original's target.
 */
export const DuplicateAutomationRequest = z.object({
  projectId: Id.optional(),
  name: z.string().trim().min(1).max(200).optional(),
});
export type DuplicateAutomationRequest = z.infer<typeof DuplicateAutomationRequest>;
