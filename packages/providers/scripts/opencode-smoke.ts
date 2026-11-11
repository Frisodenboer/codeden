/**
 * Manual smoke test for the opencode adapter against a real `opencode serve` (uses the logged-in
 * provider, so it costs a few tokens): `pnpm --filter @codeden/providers exec tsx scripts/opencode-smoke.ts <dir> [model]`.
 */
import type { AgentEvent } from "@codeden/contracts";
import { OpencodeAdapter } from "../src/opencode/adapter";

const cwd = process.argv[2] ?? process.cwd();
const model = process.argv[3] ?? "zai-coding-plan/glm-5.3-flash";
const adapter = new OpencodeAdapter();
const status = await adapter.detect();
console.log(
  "detect:",
  JSON.stringify({
    v: status.version,
    ok: status.supported,
    in: status.loggedIn,
    acct: status.account,
    issues: status.issues,
  }),
);
await adapter.refreshModels();
const models = adapter.models();
console.log("models:", models.length, JSON.stringify(models.find((m) => m.id === model)));

async function run(
  resumeToken: string | undefined,
  text: string,
  interruptAfterMs?: number,
  extra: Record<string, unknown> = {},
) {
  const session = await adapter.openSession({
    sessionId: "smoke",
    role: "agent",
    cwd,
    model,
    effort: "low",
    autonomy: "supervised",
    mcpServers: [],
    additionalDirectories: [],
    planMode: false,
    ...(resumeToken ? { resumeToken } : {}),
    ...extra,
  });
  const seen: string[] = [];
  const done = (async () => {
    for await (const e of session.events as AsyncIterable<AgentEvent>) {
      const tag =
        e.type.startsWith("item.") && "item" in e
          ? `${e.type}:${e.item.kind}${e.item.kind === "tool_call" ? `/${e.item.toolKind}` : ""}`
          : e.type;
      if (e.type !== "item.delta") seen.push(tag);
      if (e.type === "item.started" && e.item.kind === "approval_request") {
        console.log("  approval:", e.item.title);
        await session.respond(e.item.requestId, { kind: "approval", decision: "allow_once" });
      }
      if (e.type === "item.completed" && e.item.kind === "approval_request")
        console.log("  decided:", e.item.decidedBy, e.item.decision, e.item.title);
      if (e.type === "item.completed" && e.item.kind === "tool_call" && e.item.toolKind === "mcp")
        console.log("  mcp:", e.item.server, e.item.tool, e.item.output?.text);
      if (e.type === "item.completed" && e.item.kind === "assistant_message")
        console.log("  text:", e.item.text.slice(0, 120));
      if (e.type === "usage.updated") console.log("  usage:", JSON.stringify(e.usage));
      if (e.type === "turn.failed") console.log("  failed:", JSON.stringify(e.error));
      if (e.type === "turn.completed" || e.type === "turn.failed" || e.type === "turn.interrupted")
        return e.type;
    }
  })();
  await session.send({ text, attachments: [] });
  if (interruptAfterMs) setTimeout(() => void session.interrupt(), interruptAfterMs);
  const end = await Promise.race([
    done,
    new Promise((r) => setTimeout(() => r("timeout"), 120_000)),
  ]);
  const token = session.resumeToken();
  await session.close();
  console.log("end:", end, "token:", token, "\n  events:", seen.join(" "));
  return token;
}

const token = await run(
  undefined,
  "Create a file smoke.txt containing 'ok' and then reply with the word done.",
);
if (token) await run(token, "What file did you just create? Answer in one short sentence.");
if (token) await run(token, "Count slowly from 1 to 200, one number per line.", 2500);
if (process.env.SMOKE_MCP_URL) {
  // Phase 2: CodeBench-style MCP server (trusted), system prompt, Auto permission level.
  await run(
    undefined,
    "Call the report_progress tool with text smoke, run `git --version`, then reply.",
    undefined,
    {
      autonomy: "auto",
      systemPrompt: "You run inside CodeBench. End every answer with the word BANANA.",
      mcpServers: [
        {
          transport: "http",
          name: "codeden",
          url: process.env.SMOKE_MCP_URL,
          headers: { Authorization: "Bearer smoke" },
          toolTimeoutSec: 600,
          trusted: true,
        },
      ],
    },
  );
}
await adapter.dispose();
process.exit(0);
