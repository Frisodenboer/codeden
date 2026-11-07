import type { ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { killTree } from "../util/exec";
import type { ClientRequest, RequestId, ServerNotification, ServerRequest } from "./protocol";

/** A JSON-RPC error returned by the app-server. */
export class CodexRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "CodexRpcError";
  }
}

export interface CodexRpcHandlers {
  onNotification: (notification: ServerNotification) => void;
  /** Server -> client request; resolve with the result (or throw to send an error). */
  onRequest: (request: ServerRequest) => Promise<unknown>;
  onExit: (code: number | null, stderrTail: string) => void;
}

type ClientMethod = ClientRequest["method"];
type ParamsOf<M extends ClientMethod> = Extract<ClientRequest, { method: M }>["params"];

/**
 * JSON-RPC over the `codex app-server` stdio transport: one JSON message per line, no
 * `jsonrpc` field. Ids are numbers we allocate; server requests carry their own ids (which
 * start at 0, so never test them for truthiness).
 */
export class CodexRpc {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private stderrTail = "";
  private exited = false;

  constructor(
    private readonly child: ChildProcess,
    private readonly handlers: CodexRpcHandlers,
  ) {
    const stdout = child.stdout;
    if (!stdout || !child.stdin) throw new Error("codex app-server needs piped stdio");
    createInterface({ input: stdout }).on("line", (line) => this.onLine(line));
    child.stderr?.setEncoding("utf8").on("data", (d: string) => {
      this.stderrTail = (this.stderrTail + d).slice(-4000);
    });
    child.stdin.on("error", () => {});
    child.on("exit", (code) => this.onExit(code));
    child.on("error", (error) => {
      this.stderrTail += `\n${error.message}`;
      this.onExit(null);
    });
  }

  get isClosed(): boolean {
    return this.exited;
  }

  request<T, M extends ClientMethod = ClientMethod>(method: M, params: ParamsOf<M>): Promise<T> {
    if (this.exited)
      return Promise.reject(new CodexRpcError(-32000, "codex app-server is not running"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  /**
   * Stop the server: close stdin, then kill the process tree if it lingers. Resolves once the
   * process has exited (a thread can only have one writer, so a resume must wait for this).
   */
  close(): Promise<void> {
    if (this.exited) return Promise.resolve();
    const exited = new Promise<void>((resolve) => {
      this.child.once("exit", () => resolve());
      const hardStop = setTimeout(() => resolve(), 5000);
      hardStop.unref();
    });
    try {
      this.child.stdin?.end();
    } catch {
      // ignore
    }
    setTimeout(() => {
      if (!this.exited) killTree(this.child);
    }, 1500).unref();
    return exited;
  }

  private write(message: object): void {
    if (this.exited) return;
    this.child.stdin?.write(`${JSON.stringify(message)}\n`);
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const hasId = msg.id !== undefined && msg.id !== null;
    if (hasId && typeof msg.method === "string") {
      void this.answer(msg as unknown as ServerRequest);
    } else if (hasId) {
      const pending = this.pending.get(msg.id as number);
      if (!pending) return;
      this.pending.delete(msg.id as number);
      const error = msg.error as { code?: number; message?: string; data?: unknown } | undefined;
      if (error)
        pending.reject(
          new CodexRpcError(error.code ?? -32000, error.message ?? "Request failed", error.data),
        );
      else pending.resolve(msg.result);
    } else if (typeof msg.method === "string") {
      this.handlers.onNotification(msg as unknown as ServerNotification);
    }
  }

  private async answer(request: ServerRequest): Promise<void> {
    const id: RequestId = request.id;
    try {
      const result = await this.handlers.onRequest(request);
      this.write({ id, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof CodexRpcError ? error.code : -32603;
      this.write({ id, error: { code, message } });
    }
  }

  private onExit(code: number | null): void {
    if (this.exited) return;
    this.exited = true;
    const error = new CodexRpcError(-32000, `codex app-server exited (code ${code ?? "unknown"})`);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.handlers.onExit(code, this.stderrTail);
  }
}
