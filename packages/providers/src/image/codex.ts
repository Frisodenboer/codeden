import { rm, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { ProviderStatus } from "@codeden/contracts";
import { detectCodex } from "../codex/detect";
import { startAppServer } from "../codex/process";
import type { ModelProviderCapabilitiesReadResponse } from "../codex/protocol/v2";
import { type ResolvedCommand, resolveExecutable } from "../util/exec";
import { type ConnectCodex, runCodexImageTurn } from "./codex-turn";
import { ImageGenerationError, toImageError } from "./errors";
import { writeImages } from "./image-file";
import {
  deadline,
  normalizeRequest,
  orientationOf,
  parseSize,
  readReferenceImages,
  requestedRatio,
} from "./request";
import type {
  ImageEngine,
  ImageEngineAvailability,
  ImageGenerateRequest,
  ImageGenerateResult,
} from "./types";

export interface CodexImageEngineOptions {
  /** Defaults to `codex` on PATH. */
  executable?: ResolvedCommand;
  /** Empty/undefined = the user's configured Codex model. */
  model?: string;
  /** Default 300s. */
  timeoutMs?: number;
  /** Delete the copy Codex keeps under `~/.codex/generated_images/` (default true). */
  removeCodexCopies?: boolean;
  /** Defaults to `$CODEX_HOME` or `~/.codex`; only files under it are ever removed. */
  codexHome?: string;
  /** Injected for tests. */
  detectStatus?: () => Promise<ProviderStatus>;
  /** Injected for tests; defaults to spawning `codex app-server`. */
  connect?: ConnectCodex;
}

const STANDARD_SHAPES = { square: "1024x1024", landscape: "1536x1024", portrait: "1024x1536" };

/** The user turn sent to Codex. Pure; exported for tests. */
export function buildCodexImagePrompt(
  request: Pick<ImageGenerateRequest, "prompt" | "size" | "aspectRatio" | "quality"> & {
    count: number;
    referenceImages: readonly string[];
  },
): string {
  const lines: string[] = [];
  lines.push(
    request.count === 1
      ? "Generate one image with your built-in image generation tool."
      : `Generate ${request.count} separate images with your built-in image generation tool: call the tool ${request.count} times, one image per call.`,
  );
  const size = request.size ? parseSize(request.size) : undefined;
  const orientation = orientationOf(requestedRatio(request));
  if (size?.kind === "pixels") {
    lines.push(`Size: ${size.width}x${size.height} (${orientation}).`);
  } else if (orientation) {
    const ratio = request.aspectRatio ? `aspect ratio ${request.aspectRatio}, ` : "";
    lines.push(`Shape: ${orientation} (${ratio}${STANDARD_SHAPES[orientation]}).`);
  }
  if (size?.kind === "class") lines.push(`Resolution: ${size.value}.`);
  if (request.quality && request.quality !== "auto") lines.push(`Quality: ${request.quality}.`);
  if (request.referenceImages.length) {
    lines.push(
      request.referenceImages.length === 1
        ? "Use the attached image as the reference to edit or vary."
        : "Use the attached images as references.",
    );
  }
  lines.push(
    "Do not run commands or use any other tool.",
    "",
    "Image description:",
    request.prompt.trim(),
  );
  return lines.join("\n");
}

/** Reason text for an unusable Codex install, or `undefined` when it can be used. */
export function codexUnavailableReason(status: ProviderStatus): string | undefined {
  if (!status.installed) return status.issues[0]?.message ?? "Codex is not installed.";
  if (!status.supported) {
    return (
      status.issues.find((i) => i.code === "version_unsupported")?.message ??
      "This Codex version is not supported."
    );
  }
  if (status.loggedIn === false) return "Codex is not logged in (run `codex login`).";
  if (status.loggedIn === null) return "Could not read `codex login status`.";
  return undefined;
}

/**
 * Image generation through the user's own Codex login (no API key): an ephemeral,
 * tool-restricted `codex app-server` turn whose built-in image generation tool returns the
 * image bytes, which CodeDen writes to the requested path itself.
 */
export class CodexImageEngine implements ImageEngine {
  readonly id = "codex" as const;
  readonly label = "Codex";
  readonly capabilities = { referenceImages: true, exactSize: false, requiresApiKey: false };
  readonly defaultModel = "";
  private readonly connect: ConnectCodex;

  constructor(private readonly opts: CodexImageEngineOptions = {}) {
    const exe = opts.executable;
    this.connect =
      opts.connect ??
      ((handlers, cwd) => {
        const resolved = exe ?? resolveExecutable("codex");
        if (!resolved) return Promise.reject(new Error("Codex is not installed"));
        return startAppServer(resolved, handlers, { cwd }).then(({ rpc }) => ({
          request: <T>(method: string, params: unknown) =>
            rpc.request<T>(method as never, params as never),
          close: () => rpc.close(),
        }));
      });
  }

  async detect(): Promise<ImageEngineAvailability> {
    try {
      const status = await (this.opts.detectStatus?.() ??
        detectCodex(this.opts.executable ? { executable: this.opts.executable } : {}));
      const reason = codexUnavailableReason(status);
      if (reason) return { available: false, reason };
      const caps = await this.readCapabilities();
      if (!caps.imageGeneration) {
        return {
          available: false,
          reason: "The configured Codex model provider does not support image generation.",
        };
      }
      return {
        available: true,
        reason: `Uses the Codex login (${status.authMethod ?? "unknown"}).`,
      };
    } catch (error) {
      return {
        available: false,
        reason: `Could not check Codex image generation: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async generate(input: ImageGenerateRequest): Promise<ImageGenerateResult> {
    const request = normalizeRequest(this.id, input);
    const { signal, dispose } = deadline(
      this.id,
      request.timeoutMs ?? this.opts.timeoutMs ?? 300_000,
      request.signal,
    );
    try {
      if (!this.opts.connect && !(this.opts.executable ?? resolveExecutable("codex"))) {
        throw new ImageGenerationError("unavailable", this.id, "Codex is not installed");
      }
      // Validate up front; Codex reads the files itself from the paths.
      await readReferenceImages(this.id, request.referenceImages);
      const turn = await runCodexImageTurn(this.connect, {
        prompt: buildCodexImagePrompt(request),
        referenceImages: request.referenceImages,
        count: request.count,
        ...(this.opts.model ? { model: this.opts.model } : {}),
        signal,
      });
      const files = await writeImages(
        this.id,
        turn.images.map((i) => i.data),
        request.outputDir,
        request.fileStem,
      );
      if (this.opts.removeCodexCopies !== false) {
        await this.removeCopies(turn.images.map((i) => i.savedPath));
      }
      const revisedPrompt = turn.images.find((i) => i.revisedPrompt)?.revisedPrompt ?? undefined;
      return {
        files,
        engine: this.id,
        model: turn.model,
        ...(revisedPrompt ? { revisedPrompt } : {}),
      };
    } catch (error) {
      throw toImageError(error, this.id, signal);
    } finally {
      dispose();
    }
  }

  private async readCapabilities(): Promise<ModelProviderCapabilitiesReadResponse> {
    const rpc = await this.connect(
      { onNotification: () => {}, onRequest: async () => ({}), onExit: () => {} },
      homedir(),
    );
    try {
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timed out")), 20_000).unref();
      });
      return await Promise.race([
        rpc.request<ModelProviderCapabilitiesReadResponse>("modelProvider/capabilities/read", {}),
        timeout,
      ]);
    } finally {
      await rpc.close();
    }
  }

  /** Remove Codex's cached copies of our images (only inside `<codexHome>/generated_images`). */
  private async removeCopies(savedPaths: readonly (string | undefined)[]): Promise<void> {
    const home = this.opts.codexHome ?? process.env.CODEX_HOME ?? path.join(homedir(), ".codex");
    const root = path.resolve(home, "generated_images");
    for (const saved of savedPaths) {
      if (!saved) continue;
      const file = path.resolve(saved);
      const rel = path.relative(root, file);
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
      await rm(file, { force: true }).catch(() => {});
      const dir = path.dirname(file);
      if (dir !== root) await rmdir(dir).catch(() => {}); // only succeeds when empty
    }
  }
}
