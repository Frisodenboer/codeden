import { createHash, type Hash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { open, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { PinnedFile } from "./catalog";

/** Why a download failed; `incomplete` leaves the partial file so the next try resumes. */
export class DownloadError extends Error {
  constructor(
    readonly code: "http" | "checksum_mismatch" | "size_mismatch" | "incomplete",
    message: string,
  ) {
    super(message);
    this.name = "DownloadError";
  }
}

export interface DownloadOptions {
  file: PinnedFile;
  /** Final path; bytes go to `<dest>.partial` until they are verified. */
  dest: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (receivedBytes: number, totalBytes: number) => void;
}

/** The partial file a download writes to. */
export const partialPath = (dest: string) => `${dest}.partial`;

async function hashExisting(path: string, hash: Hash): Promise<void> {
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
}

/**
 * Download a pinned file to `dest`, resuming a previous partial download with an HTTP range
 * request when the server allows it (and starting over when it does not). The file only
 * becomes `dest` once its size and SHA-256 match the pin; a mismatch deletes it.
 */
export async function downloadVerified(opts: DownloadOptions): Promise<void> {
  const { file, dest } = opts;
  const fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
  const partial = partialPath(dest);
  mkdirSync(dirname(dest), { recursive: true });

  let hash = createHash("sha256");
  let received = 0;
  if (existsSync(partial)) {
    const size = statSync(partial).size;
    if (size > file.bytes) rmSync(partial, { force: true });
    else if (size > 0) {
      await hashExisting(partial, hash);
      received = size;
    }
  }

  if (received < file.bytes) {
    const res = await fetchImpl(file.url, {
      headers: received > 0 ? { range: `bytes=${received}-` } : {},
      signal: opts.signal,
    });
    const resumed =
      res.status === 206 &&
      (res.headers.get("content-range") ?? "").startsWith(`bytes ${received}-`);
    if (!resumed) {
      if (res.status === 206 || res.status === 416) {
        // The server ignored or refused the range: start over without it.
        await res.body?.cancel();
        rmSync(partial, { force: true });
        return downloadVerified(opts);
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new DownloadError("http", `Download failed: ${res.status} ${res.statusText}`);
      }
      hash = createHash("sha256");
      received = 0;
    }
    if (!res.body) throw new DownloadError("http", "Download failed: empty response");
    const out = await open(partial, received > 0 ? "a" : "w");
    let failure: unknown;
    try {
      opts.onProgress?.(received, file.bytes);
      for await (const chunk of res.body) {
        received += chunk.length;
        if (received > file.bytes) {
          throw new DownloadError("size_mismatch", "The download is larger than expected");
        }
        hash.update(chunk);
        await out.write(chunk);
        opts.onProgress?.(received, file.bytes);
      }
    } catch (error) {
      failure = error;
    } finally {
      await out.close();
    }
    if (failure) {
      // A wrong file is deleted; a cut connection keeps the partial file to resume.
      if (failure instanceof DownloadError) rmSync(partial, { force: true });
      throw failure;
    }
  }

  if (received !== file.bytes) {
    throw new DownloadError(
      "incomplete",
      `The download stopped at ${received} of ${file.bytes} bytes; try again to resume`,
    );
  }
  if (hash.digest("hex") !== file.sha256) {
    rmSync(partial, { force: true });
    throw new DownloadError(
      "checksum_mismatch",
      "The download did not match its pinned SHA-256 checksum and was deleted",
    );
  }
  await rename(partial, dest);
}
