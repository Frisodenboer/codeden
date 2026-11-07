import { createHash } from "node:crypto";

/** The Git Data API part of the fake GitHub: blobs, trees, commits and refs, in memory. */
export class FakeGitData {
  blobs = new Map<string, string>();
  trees = new Map<string, { base: string | null; entries: Array<{ path: string; sha: string }> }>();
  commits = new Map<string, { tree: string; parents: string[]; message: string }>();
  refs = new Map<string, string>();
  private nextId = 1;

  route(method: string, rest: string, b: Record<string, unknown>) {
    const ok = (data: unknown, status = 200) => ({ status, data });
    const sha = () =>
      createHash("sha1")
        .update(String(this.nextId++))
        .digest("hex");
    if (method === "POST" && rest === "/git/blobs") {
      const id = sha();
      this.blobs.set(id, String(b.content));
      return ok({ sha: id }, 201);
    }
    if (method === "POST" && rest === "/git/trees") {
      const id = sha();
      const entries = (b.tree as Array<{ path: string; sha: string }>).map((e) => ({
        path: e.path,
        sha: e.sha,
      }));
      this.trees.set(id, { base: (b.base_tree as string | undefined) ?? null, entries });
      return ok({ sha: id }, 201);
    }
    if (method === "POST" && rest === "/git/commits") {
      const id = sha();
      this.commits.set(id, {
        tree: String(b.tree),
        parents: b.parents as string[],
        message: String(b.message),
      });
      return ok({ sha: id }, 201);
    }
    let m = rest.match(/^\/git\/ref\/(.+)$/);
    if (m && method === "GET") {
      const target = this.refs.get(`refs/${m[1]}`);
      return target
        ? ok({ ref: `refs/${m[1]}`, object: { sha: target } })
        : { status: 404, data: { message: "Not Found" } };
    }
    m = rest.match(/^\/git\/commits\/(.+)$/);
    if (m && method === "GET") {
      const commit = this.commits.get(m[1] ?? "");
      return commit ? ok({ sha: m[1], tree: { sha: commit.tree } }) : null;
    }
    if (method === "POST" && rest === "/git/refs") {
      this.refs.set(String(b.ref), String(b.sha));
      return ok({ ref: b.ref }, 201);
    }
    m = rest.match(/^\/git\/refs\/(.+)$/);
    if (m && method === "PATCH") {
      this.refs.set(`refs/${m[1]}`, String(b.sha));
      return ok({ ref: `refs/${m[1]}` });
    }
    return null;
  }
}
