/**
 * A local npm registry for on-demand install tests: serves version manifests
 * (`GET /<name>/<version>`, scoped names with `%2f`) and tarballs, with `dist.integrity`
 * computed from the bytes served unless a test overrides it.
 */
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";

export interface TarEntry {
  path: string;
  data?: Buffer | string;
  /** ustar type flag: "0" file (default), "5" directory, "x" pax header, "2" symlink. */
  type?: string;
}

/** A gzipped ustar archive. Long paths are stored with a pax `path` record. */
export function makeTarball(entries: TarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  const push = (name: string, type: string, data: Buffer) => {
    const header = Buffer.alloc(512);
    header.write(name.slice(0, 100), 0, 100, "utf8");
    header.write("0000644\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write(`${(0).toString(8).padStart(11, "0")}\0`, 136);
    header.write("        ", 148);
    header.write(type, 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  };
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? "");
    if (Buffer.byteLength(entry.path) > 100) {
      const body = ` path=${entry.path}\n`;
      let len = Buffer.byteLength(body);
      len += String(len + String(len).length).length;
      push("PaxHeader", "x", Buffer.from(`${len}${body}`));
    }
    push(entry.path, entry.type ?? "0", data);
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

/** A tiny ESM package that looks like the Claude Agent SDK to the loader. */
export function fakeSdkTarball(name: string, version: string): Buffer {
  return makeTarball([
    {
      path: "package/package.json",
      data: JSON.stringify({ name, version, type: "module", exports: { ".": "./sdk.mjs" } }),
    },
    { path: "package/sdk.mjs", data: "export function query() { return 'from-registry'; }\n" },
    { path: `package/${"deep/".repeat(25)}notes.txt`, data: "long path via pax\n" },
  ]);
}

export interface FakeNpmRegistry {
  url: string;
  requests: string[];
  publish(name: string, version: string, tarball: Buffer, opts?: { integrity?: string }): void;
  close(): Promise<void>;
}

export async function startFakeNpmRegistry(): Promise<FakeNpmRegistry> {
  const manifests = new Map<string, Record<string, unknown>>();
  const tarballs = new Map<string, Buffer>();
  const requests: string[] = [];
  let base = "";
  const server: Server = createServer((req, res) => {
    const url = decodeURIComponent(req.url ?? "/");
    requests.push(`${req.method} ${req.url}`);
    const tgz = tarballs.get(url);
    if (tgz) {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(tgz);
      return;
    }
    const manifest = manifests.get(url);
    res.writeHead(manifest ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify(manifest ?? { error: "not found" }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: base,
    requests,
    publish(name, version, tarball, opts = {}) {
      const file = `/${name}/-/${name.split("/").pop()}-${version}.tgz`;
      tarballs.set(file, tarball);
      manifests.set(`/${name}/${version}`, {
        name,
        version,
        dist: {
          tarball: `${base}${file}`,
          integrity:
            opts.integrity ?? `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
        },
      });
    },
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
