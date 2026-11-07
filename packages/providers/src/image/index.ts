/** Image generation engines behind one `ImageEngine` interface (§12.5). */
export {
  buildCodexImagePrompt,
  CodexImageEngine,
  type CodexImageEngineOptions,
  codexUnavailableReason,
} from "./codex";
export {
  CODEX_IMAGE_INSTRUCTIONS,
  type ConnectCodex,
  codexImageConfig,
  type ImageTurnRpc,
} from "./codex-turn";
export { type ImageErrorCode, ImageGenerationError } from "./errors";
export {
  buildGeminiRequest,
  GEMINI_IMAGE_MODEL,
  GeminiImageEngine,
  type GeminiImageEngineOptions,
} from "./gemini";
export type { ApiKeySource, FetchLike } from "./http";
export { type ImageInfo, imageInfo } from "./image-file";
export {
  buildOpenAIRequest,
  OPENAI_IMAGE_MODEL,
  OpenAIImageEngine,
  type OpenAIImageEngineOptions,
} from "./openai";
export {
  DEFAULT_IMAGE_DIR,
  type ImageOutputTarget,
  imageFileNames,
  type ResolveImageOutputOptions,
  resolveImageOutput,
  sanitizeFileStem,
} from "./paths";
export {
  chooseImageEngine,
  createImageEngineRegistry,
  type DefaultImageEnginesOptions,
  type ImageEngineChoice,
  type ImageEnginePick,
  ImageEngineRegistry,
} from "./registry";
export * from "./types";
