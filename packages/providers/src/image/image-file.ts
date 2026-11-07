import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ImageGenerationError } from "./errors";
import { imageFileNames } from "./paths";
import type { ImageEngineId } from "./types";

export type ImageFormat = "png" | "jpeg" | "webp" | "gif";

export interface ImageInfo {
  format: ImageFormat;
  mimeType: `image/${ImageFormat}`;
  width: number;
  height: number;
}

/** Sniff format and pixel size from the file header. `undefined` if not a supported image. */
export function imageInfo(data: Uint8Array): ImageInfo | undefined {
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) {
    return info("png", b.readUInt32BE(16), b.readUInt32BE(20));
  }
  if (b.length >= 10 && b.toString("ascii", 0, 6).startsWith("GIF8")) {
    return info("gif", b.readUInt16LE(6), b.readUInt16LE(8));
  }
  if (
    b.length >= 30 &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  ) {
    return webpInfo(b);
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return jpegInfo(b);
  return undefined;
}

function info(format: ImageFormat, width: number, height: number): ImageInfo | undefined {
  if (!width || !height) return undefined;
  return { format, mimeType: `image/${format}`, width, height };
}

function webpInfo(b: Buffer): ImageInfo | undefined {
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8X") return info("webp", b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1);
  if (chunk === "VP8L") {
    const bits = b.readUInt32LE(21);
    return info("webp", (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  if (chunk === "VP8 ")
    return info("webp", b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
  return undefined;
}

function jpegInfo(b: Buffer): ImageInfo | undefined {
  let offset = 2;
  while (offset + 9 < b.length) {
    if (b[offset] !== 0xff) return undefined;
    const marker = b[offset + 1] ?? 0;
    const length = b.readUInt16BE(offset + 2);
    // SOF0..SOF15, excluding DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return info("jpeg", b.readUInt16BE(offset + 7), b.readUInt16BE(offset + 5));
    }
    offset += 2 + length;
  }
  return undefined;
}

const EXTENSION: Record<ImageFormat, string> = {
  png: ".png",
  jpeg: ".jpg",
  webp: ".webp",
  gif: ".gif",
};

/**
 * Write generated images as `<stem><ext>`, `<stem>-2<ext>`, ... in `outputDir` (created if
 * missing; existing files with the same names are replaced). The extension follows the actual
 * bytes, so a JPEG is never saved as `.png`.
 */
export async function writeImages(
  engine: ImageEngineId,
  images: readonly Uint8Array[],
  outputDir: string,
  fileStem: string,
): Promise<string[]> {
  const formats = images.map((image) => {
    const meta = imageInfo(image);
    if (!meta) {
      throw new ImageGenerationError(
        "no_image",
        engine,
        "The engine returned data that is not an image",
      );
    }
    return meta.format;
  });
  const names = imageFileNames(
    fileStem,
    formats.map((f) => EXTENSION[f]),
  );
  try {
    await mkdir(outputDir, { recursive: true });
    const files: string[] = [];
    for (const [i, image] of images.entries()) {
      const file = path.join(outputDir, names[i] as string);
      await writeFile(file, image);
      files.push(file);
    }
    return files;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ImageGenerationError("io", engine, `Could not write the image: ${message}`, {
      cause: error,
    });
  }
}
