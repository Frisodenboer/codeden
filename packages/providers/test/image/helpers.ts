import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CodexRpcHandlers } from "../../src/codex/rpc";
import type { ConnectCodex, ImageTurnRpc } from "../../src/image/codex-turn";

export function tempDir(prefix = "codeden-image-test-"): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/** A PNG header (signature + IHDR) with the given size; enough for format sniffing. */
export function fakePng(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b.writeUInt8(8, 24);
  b.writeUInt8(6, 25);
  return b;
}

/** A minimal JPEG: SOI, an APP0 segment, then SOF0 with the size. */
export function fakeJpeg(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(11, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(4)]);
}

export interface FakeCall {
  method: string;
  params: unknown;
}

/**
 * A scripted app-server: records requests and, on `turn/start`, plays the notifications the
 * script returns (each one async, like the real stdio stream).
 */
export function fakeCodex(
  script: (ctx: { threadId: string; params: unknown }) => unknown[],
  opts: { model?: string; capabilities?: { imageGeneration: boolean }; servers?: string[] } = {},
): { connect: ConnectCodex; calls: FakeCall[]; closed: () => number; cwds: string[] } {
  const calls: FakeCall[] = [];
  const cwds: string[] = [];
  let closed = 0;
  const connect: ConnectCodex = async (handlers: CodexRpcHandlers, cwd: string) => {
    cwds.push(cwd);
    const threadId = "thread-1";
    const rpc: ImageTurnRpc = {
      async request<T>(method: string, params: unknown): Promise<T> {
        calls.push({ method, params });
        if (method === "config/read") {
          const servers = Object.fromEntries(
            (opts.servers ?? []).map((s) => [s, { command: "x" }]),
          );
          return { config: { mcp_servers: servers } } as T;
        }
        if (method === "modelProvider/capabilities/read") {
          return (opts.capabilities ?? { imageGeneration: true }) as T;
        }
        if (method === "thread/start") {
          return { thread: { id: threadId }, model: opts.model ?? "gpt-test" } as T;
        }
        if (method === "turn/start") {
          const notes = script({ threadId, params });
          setTimeout(async () => {
            for (const n of notes) {
              await new Promise((r) => setTimeout(r, 1));
              handlers.onNotification(n as never);
            }
          }, 1);
          return { turn: { id: "turn-1" } } as T;
        }
        return {} as T;
      },
      close() {
        closed++;
      },
    };
    return rpc;
  };
  return { connect, calls, closed: () => closed, cwds };
}

export const imageItem = (
  threadId: string,
  result: Buffer | "",
  extra: Record<string, unknown> = {},
) => ({
  method: "item/completed",
  params: {
    threadId,
    turnId: "turn-1",
    item: {
      type: "imageGeneration",
      id: `img-${Math.random()}`,
      status: "completed",
      revisedPrompt: "revised",
      result: result === "" ? "" : result.toString("base64"),
      failure: null,
      ...extra,
    },
  },
});

export const turnCompleted = (threadId: string, status = "completed", error: unknown = null) => ({
  method: "turn/completed",
  params: { threadId, turn: { id: "turn-1", status, error, items: [] } },
});

export const agentMessage = (threadId: string, text: string) => ({
  method: "item/completed",
  params: { threadId, turnId: "turn-1", item: { type: "agentMessage", id: "m", text } },
});
