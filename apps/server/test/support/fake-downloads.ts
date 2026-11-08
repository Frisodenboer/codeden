import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";

/** One file the fake download server serves. */
export interface FakeFile {
  body: Buffer;
  /** Cut the connection after this many bytes (once), to test resuming. */
  cutAfter?: number;
  /** Ignore `Range` and always send the whole file. */
  ignoreRange?: boolean;
  /** Wait this long before each chunk (to cancel mid-download). */
  slowMs?: number;
}

export interface FakeDownloads {
  url: string;
  files: Map<string, FakeFile>;
  /** `Range` header of every request, by path (`null` without one). */
  ranges: Map<string, Array<string | null>>;
  close: () => Promise<void>;
}

export const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** A small static file server with range requests, standing in for npm and Hugging Face. */
export async function startFakeDownloads(): Promise<FakeDownloads> {
  const files = new Map<string, FakeFile>();
  const ranges = new Map<string, Array<string | null>>();
  const server: Server = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://fake").pathname;
    const range = req.headers.range ?? null;
    ranges.set(path, [...(ranges.get(path) ?? []), range]);
    const file = files.get(path);
    if (!file) {
      res.statusCode = 404;
      return res.end("not found");
    }
    let start = 0;
    const match = range && !file.ignoreRange ? /^bytes=(\d+)-$/.exec(range) : null;
    if (match) {
      start = Number(match[1]);
      if (start >= file.body.length) {
        res.statusCode = 416;
        return res.end();
      }
      res.statusCode = 206;
      res.setHeader("content-range", `bytes ${start}-${file.body.length - 1}/${file.body.length}`);
    }
    res.setHeader("content-length", String(file.body.length - start));
    res.setHeader("content-type", "application/octet-stream");
    const body = file.body.subarray(start);
    if (file.cutAfter !== undefined) {
      const cut = file.cutAfter;
      file.cutAfter = undefined;
      res.write(body.subarray(0, cut));
      setTimeout(() => res.destroy(), 20);
      return;
    }
    const chunk = 4096;
    for (let at = 0; at < body.length; at += chunk) {
      if (file.slowMs) await new Promise((r) => setTimeout(r, file.slowMs));
      if (res.destroyed) return;
      res.write(body.subarray(at, at + chunk));
    }
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    files,
    ranges,
    close: async () => {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}

/** A gzipped tar holding the given files (ustar headers). */
export function makeTgz(entries: Record<string, Buffer>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, data] of Object.entries(entries)) {
    const header = Buffer.alloc(512);
    header.write(name, 0, "utf8");
    header.write("0000644\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write("00000000000\0", 136);
    header.write("        ", 148);
    header.write("0", 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

/** A WAV file: `seconds` of a quiet tone, 16-bit PCM by default. */
export function makeWav(
  opts: { seconds?: number; rate?: number; channels?: number; bits?: number } = {},
): Buffer {
  const { seconds = 1, rate = 16_000, channels = 1, bits = 16 } = opts;
  const frames = Math.round(seconds * rate);
  const bytesPerSample = bits / 8;
  const data = Buffer.alloc(frames * channels * bytesPerSample);
  if (bits === 16) {
    for (let i = 0; i < frames * channels; i++) {
      data.writeInt16LE(Math.round(Math.sin(i / 8) * 3000), i * 2);
    }
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * bytesPerSample, 28);
  header.writeUInt16LE(channels * bytesPerSample, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
