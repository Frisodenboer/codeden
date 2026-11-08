import type { WhisperModelId } from "@codeden/contracts";

/**
 * What local Whisper downloads (§11.3), pinned by size and SHA-256 so a download is only
 * used when it is byte-for-byte the file CodeDen was tested with.
 *
 * - **Runtime:** whisper.cpp built as a Node-API addon, one prebuilt `index.node` per
 *   platform, published to the npm registry as `@fugood/node-whisper-<platform>-<arch>`
 *   (MIT). CodeDen fetches the package tarball over HTTPS and extracts the addon itself, so
 *   no npm, compiler or system Node.js is needed, and Node-API keeps it loadable from any
 *   Node or Electron version.
 * - **Models:** the whisper.cpp GGML models from Hugging Face (MIT), at a fixed revision.
 *   The 5-bit quantised (`q5_1`) files are about 40% the size of the full ones with nearly
 *   the same accuracy.
 */

/** One pinned download. */
export interface PinnedFile {
  url: string;
  sha256: string;
  bytes: number;
}

/** The runtime archive for one platform; `entry` is the addon inside the tarball. */
export interface RuntimePin extends PinnedFile {
  version: string;
  entry: string;
}

export interface ModelPin extends PinnedFile {
  id: WhisperModelId;
  /** File name in `<home>/models/whisper/`. */
  file: string;
  label: string;
  hint: string;
  englishOnly: boolean;
  recommended: boolean;
}

export const WHISPER_RUNTIME_VERSION = "1.1.3";

const runtime = (target: string, sha256: string, bytes: number): RuntimePin => ({
  version: WHISPER_RUNTIME_VERSION,
  url: `https://registry.npmjs.org/@fugood/node-whisper-${target}/-/node-whisper-${target}-${WHISPER_RUNTIME_VERSION}.tgz`,
  sha256,
  bytes,
  entry: "package/index.node",
});

/** Prebuilt runtimes by `process.platform-process.arch`. */
export const RUNTIME_PINS: Record<string, RuntimePin> = {
  "win32-x64": runtime(
    "win32-x64",
    "25d54aff191d51833a4941ed77d54beeef034fad585c485938fb34e59f32cb4a",
    1_205_460,
  ),
  "win32-arm64": runtime(
    "win32-arm64",
    "c6e36608d32aaec62e6f07bdfd7a29576c12b0eb2cf396bed6f6b5ee236a1342",
    1_226_903,
  ),
  "darwin-x64": runtime(
    "darwin-x64",
    "8f9af3930e94f7b4123cc39ae8fea2554477404e65d4d5ad6a0ca142a6add591",
    1_642_873,
  ),
  "darwin-arm64": runtime(
    "darwin-arm64",
    "cb54d7e9050a896d794193367769b0c93e77c51e34861d521140c2dd8cc501dc",
    1_516_419,
  ),
  "linux-x64": runtime(
    "linux-x64",
    "d847231487492e4bcaef2d6d47e06e4b4ea872ee621fc988d01b7f0733006224",
    1_279_405,
  ),
  "linux-arm64": runtime(
    "linux-arm64",
    "f392eacef6c773442e5c427a6dca5ab6cd3f4f104ca8d609c27c7cf97e6e2a4a",
    1_199_206,
  ),
};

/** Hugging Face revision of `ggerganov/whisper.cpp` the checksums below belong to. */
const MODEL_REVISION = "5359861c739e955e79d9a303bcbc70fb988958b1";

const model = (
  id: WhisperModelId,
  sha256: string,
  bytes: number,
  info: Pick<ModelPin, "label" | "hint" | "recommended">,
): ModelPin => {
  const file = `ggml-${id}-q5_1.bin`;
  return {
    id,
    file,
    url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${MODEL_REVISION}/${file}`,
    sha256,
    bytes,
    englishOnly: id.endsWith(".en"),
    ...info,
  };
};

/** The models offered in Settings, smallest first. */
export const MODEL_PINS: ModelPin[] = [
  model("tiny.en", "c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b", 32_166_155, {
    label: "Tiny (English)",
    hint: "Fastest, lower accuracy",
    recommended: false,
  }),
  model("tiny", "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7", 32_152_673, {
    label: "Tiny",
    hint: "Fastest, lower accuracy, many languages",
    recommended: false,
  }),
  model("base.en", "4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f", 59_721_011, {
    label: "Base (English)",
    hint: "Fast, good accuracy",
    recommended: true,
  }),
  model("base", "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898", 59_707_625, {
    label: "Base",
    hint: "Fast, good accuracy, many languages",
    recommended: false,
  }),
  model(
    "small.en",
    "bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30",
    190_098_681,
    { label: "Small (English)", hint: "Slower, best accuracy", recommended: false },
  ),
  model("small", "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb", 190_085_487, {
    label: "Small",
    hint: "Slower, best accuracy, many languages",
    recommended: false,
  }),
];

/** `win32-x64` style key for the current process. */
export function currentPlatform(): string {
  return `${process.platform}-${process.arch}`;
}
