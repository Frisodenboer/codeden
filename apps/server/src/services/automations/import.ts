import {
  type AutomationImportFile,
  type AutomationImportPreviewItem,
  type AutomationImportSource,
  AUTOMATION_IMPORT_LIMITS as LIMITS,
} from "@codeden/contracts";
import { strFromU8, strToU8, type UnzipFileInfo, unzipSync, zipSync } from "fflate";
import { badRequest, errorMessage, ServiceError } from "../errors";
import { type ExportableAutomation, exportAutomation } from "./markdown";
import { fileStemToId, parseAutomationMarkdown } from "./templates";
import { validateAutomation } from "./validate";

const tooLarge = (message: string) => new ServiceError(413, "import_too_large", message);

/** The last path segment of a zip entry or uploaded file name. */
const baseName = (name: string) => name.split(/[\\/]/).pop()?.trim() || "automation.md";

/** Read the `.md` entries of a zip, refusing oversized or overfull archives before inflating. */
function unzipMarkdown(zipBase64: string): AutomationImportFile[] {
  const data = Buffer.from(zipBase64, "base64");
  if (data.length === 0) throw badRequest("The zip is empty or not base64", "invalid_zip");
  if (data.length > LIMITS.maxZipBytes) {
    throw tooLarge(`The zip is larger than ${LIMITS.maxZipBytes / 1024} KB`);
  }
  let entries = 0;
  let total = 0;
  const wanted = (file: UnzipFileInfo) => {
    entries++;
    if (entries > LIMITS.maxZipEntries) {
      throw tooLarge(`The zip lists more than ${LIMITS.maxZipEntries} entries`);
    }
    const name = file.name.replace(/\\/g, "/");
    if (name.endsWith("/") || name.startsWith("__MACOSX/") || !/\.md$/i.test(name)) return false;
    if (file.originalSize > LIMITS.maxFileChars) {
      throw tooLarge(`${baseName(name)} is larger than ${LIMITS.maxFileChars / 1024} KB`);
    }
    total += file.originalSize;
    if (total > LIMITS.maxTotalChars) {
      throw tooLarge(`The zip holds more than ${LIMITS.maxTotalChars / 1024} KB of automations`);
    }
    return true;
  };
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(data), { filter: wanted });
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw badRequest(`Not a readable zip: ${errorMessage(error)}`, "invalid_zip");
  }
  return Object.entries(files).map(([name, bytes]) => {
    // Sizes in the zip header are the archive's claim; check what actually came out.
    if (bytes.length > LIMITS.maxFileChars) throw tooLarge(`${baseName(name)} is too large`);
    return { name: baseName(name), content: strFromU8(bytes) };
  });
}

/** The pasted text as a file named after its `name:` (or `pasted.md`). */
function pastedFile(text: string): AutomationImportFile {
  const name = /^name:\s*["']?(.+?)["']?\s*$/m.exec(text)?.[1];
  return { name: name ? `${fileStemToId(name)}.md` : "pasted.md", content: text };
}

/**
 * Every file of an import with unique names (`a.md`, `a (2).md`), within the limits of
 * `AUTOMATION_IMPORT_LIMITS`. Throws 400 or 413 before anything is parsed.
 */
export function collectImportFiles(source: AutomationImportSource): AutomationImportFile[] {
  const files: AutomationImportFile[] = [
    ...(source.files ?? []).map((f) => ({ name: baseName(f.name), content: f.content })),
    ...(source.zipBase64 ? unzipMarkdown(source.zipBase64) : []),
    ...(source.text?.trim() ? [pastedFile(source.text)] : []),
  ];
  if (files.length === 0) throw badRequest("No .md automation files found", "import_empty");
  if (files.length > LIMITS.maxFiles) {
    throw tooLarge(`At most ${LIMITS.maxFiles} automations can be imported at once`);
  }
  const total = files.reduce((n, f) => n + f.content.length, 0);
  if (total > LIMITS.maxTotalChars) {
    throw tooLarge(`The import holds more than ${LIMITS.maxTotalChars / 1024} KB`);
  }
  const seen = new Map<string, number>();
  return files.map((f) => {
    const key = f.name.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n === 1 ? f : { ...f, name: f.name.replace(/(\.md)?$/i, ` (${n})$1`) };
  });
}

/**
 * Parse one file exactly like an automation file (same parser and validation), and refuse
 * unknown fields. Nothing is saved or run.
 */
export function previewFile(file: AutomationImportFile): AutomationImportPreviewItem {
  const fail = (error: string): AutomationImportPreviewItem => ({
    fileName: file.name,
    automation: null,
    error,
    fullPermissions: false,
  });
  try {
    const parsed = parseAutomationMarkdown(file.content, fileStemToId(file.name));
    if (parsed.unknownFields.length) {
      return fail(
        `Unknown field${parsed.unknownFields.length > 1 ? "s" : ""}: ${parsed.unknownFields.join(", ")}`,
      );
    }
    const automation = {
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description ?? null,
      trigger: parsed.frontmatter.trigger,
      action: parsed.action,
      guards: parsed.guards,
      workKey: parsed.workKey,
    };
    validateAutomation(automation);
    const autonomy =
      automation.action.type === "start_session"
        ? automation.action.autonomy
        : automation.action.type === "triage"
          ? automation.action.policy?.autonomy
          : undefined;
    return { fileName: file.name, automation, error: null, fullPermissions: autonomy === "full" };
  } catch (error) {
    return fail(errorMessage(error));
  }
}

/** Preview every file of an import. */
export function previewImport(source: AutomationImportSource): AutomationImportPreviewItem[] {
  return collectImportFiles(source).map(previewFile);
}

/** A zip of automations as `.md` files (unique names), base64-encoded. */
export function zipAutomations(automations: ExportableAutomation[]): string {
  const entries: Record<string, Uint8Array> = {};
  for (const a of automations) {
    const { fileName, markdown } = exportAutomation(a);
    let name = fileName;
    for (let n = 2; entries[name]; n++) name = fileName.replace(/\.md$/, `-${n}.md`);
    entries[name] = strToU8(markdown);
  }
  return Buffer.from(zipSync(entries, { level: 6 })).toString("base64");
}
