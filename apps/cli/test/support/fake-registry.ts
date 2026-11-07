/**
 * A tiny npm registry for self-update tests (§16): serves `codeden` versions packed from the
 * current build (relabelled, e.g. as `0.1.1-test`), their dist-tags and fake release notes.
 * Other packages are proxied to the public registry when `upstream` is set (real installs
 * with native dependencies), otherwise 404. Point CodeDen at it with `CODEDEN_UPDATE_REGISTRY`.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, relative, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

/** The published package folder (`apps/cli`), with `dist/` built. */
export const CLI_ROOT = resolve(import.meta.dirname, "../..");

export interface PackOptions {
  version: string;
  /** Drop `dependencies` (native modules, playwright-core) so npm installs nothing else. */
  stripDependencies?: boolean;
}

/** Pack the current build like `npm pack` (dist, README, LICENSE), relabelled as `version`. */
export function packCli(opts: PackOptions): Buffer {
  const pkg = JSON.parse(readFileSync(join(CLI_ROOT, "package.json"), "utf8")) as Record<
    string,
    unknown
  >;
  pkg.version = opts.version;
  delete pkg.devDependencies;
  delete pkg.scripts;
  if (opts.stripDependencies) delete pkg.dependencies;
  const entries: Array<[string, Buffer]> = [
    ["package/package.json", Buffer.from(`${JSON.stringify(pkg, null, 2)}\n`)],
  ];
  for (const file of ["README.md", "LICENSE"]) {
    try {
      entries.push([`package/${file}`, readFileSync(join(CLI_ROOT, file))]);
    } catch {
      // optional
    }
  }
  const dist = join(CLI_ROOT, "dist");
  for (const file of walk(dist)) {
    const rel = relative(CLI_ROOT, file).split("\\").join("/");
    entries.push([`package/${rel}`, readFileSync(file)]);
  }
  return gzipSync(tar(entries));
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** A minimal ustar archive (regular files only). */
function tar(entries: Array<[string, Buffer]>): Buffer {
  const blocks: Buffer[] = [];
  for (const [path, data] of entries) {
    const header = Buffer.alloc(512);
    let name = path;
    let prefix = "";
    if (Buffer.byteLength(name) > 100) {
      const cut = path.lastIndexOf("/", 155);
      prefix = path.slice(0, cut);
      name = path.slice(cut + 1);
    }
    header.write(name, 0, 100, "utf8");
    header.write("0000644\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write(
      `${Math.floor(Date.now() / 1000)
        .toString(8)
        .padStart(11, "0")}\0`,
      136,
    );
    header.write("        ", 148);
    header.write("0", 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    header.write(prefix, 345, 155, "utf8");
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

export interface FakeRegistry {
  url: string;
  /** Requests seen, e.g. `GET /-/package/codeden/dist-tags`. */
  requests: string[];
  /** Publish (or replace) a version and optionally move `latest` to it. */
  publish(version: string, tarball: Buffer, opts?: { latest?: boolean }): void;
  close(): Promise<void>;
}

/** Start the registry on a free 127.0.0.1 port. */
export async function startFakeRegistry(
  opts: { upstream?: string; notes?: (version: string) => string } = {},
): Promise<FakeRegistry> {
  const versions = new Map<string, { tarball: Buffer; manifest: Record<string, unknown> }>();
  let latest: string | null = null;
  const requests: string[] = [];
  let base = "";

  const server: Server = createServer((req, res) => {
    const url = req.url ?? "/";
    requests.push(`${req.method} ${url}`);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url === "/-/package/codeden/dist-tags") return json(200, { latest });
    if (url === "/codeden" || url === "/codeden/") {
      return json(200, {
        name: "codeden",
        "dist-tags": latest ? { latest } : {},
        versions: Object.fromEntries([...versions].map(([v, e]) => [v, e.manifest])),
      });
    }
    const tgz = /^\/codeden\/-\/codeden-(.+)\.tgz$/.exec(url);
    if (tgz) {
      const entry = versions.get(tgz[1] as string);
      if (!entry) return json(404, { error: "not found" });
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(entry.tarball);
      return;
    }
    const notes = /^\/notes\/v(.+)$/.exec(url);
    if (notes) {
      const version = decodeURIComponent(notes[1] as string);
      const body = opts.notes?.(version) ?? `### What's new in ${version}\n\n- One-click updates.`;
      return json(200, { body, html_url: `${base}/releases/v${version}` });
    }
    if (opts.upstream && req.method === "GET") {
      void proxy(`${opts.upstream}${url}`, res);
      return;
    }
    json(404, { error: "not found" });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    url: base,
    requests,
    publish(version, tarball, publishOpts = {}) {
      const pkg = readPackageJson(tarball);
      versions.set(version, {
        tarball,
        manifest: {
          ...pkg,
          name: "codeden",
          version,
          dist: {
            tarball: `${base}/codeden/-/codeden-${version}.tgz`,
            shasum: createHash("sha1").update(tarball).digest("hex"),
            integrity: `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
          },
        },
      });
      if (publishOpts.latest !== false) latest = version;
    },
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

async function proxy(url: string, res: import("node:http").ServerResponse): Promise<void> {
  try {
    const upstream = await fetch(url, { headers: { accept: "application/json" } });
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
    });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(error) }));
  }
}

/** The package.json inside a tarball we packed (first entry). */
function readPackageJson(tarball: Buffer): Record<string, unknown> {
  const raw = gunzipSync(tarball);
  const size = Number.parseInt(raw.subarray(124, 135).toString("utf8"), 8);
  return JSON.parse(raw.subarray(512, 512 + size).toString("utf8"));
}
