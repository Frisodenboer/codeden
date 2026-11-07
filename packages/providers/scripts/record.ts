/**
 * Record live provider sessions as Replay fixtures (§7.2, §18):
 *   pnpm --filter @codeden/providers record:claude [scenario]
 *   pnpm --filter @codeden/providers record:codex [scenario]
 * Runs tiny real prompts in a temp dir (costs a few cents of the user's subscription) and
 * writes test/fixtures/<provider>-<scenario>.json. Approvals are answered `allow_once`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent, AutonomyLevel, SessionOptions } from "@codeden/contracts";
import type { ProviderAdapter } from "../src/adapter";
import { ClaudeAdapter } from "../src/claude/adapter";
import { CodexAdapter } from "../src/codex/adapter";
import { saveFixture } from "../src/replay/fixture";
import { RecordingSession } from "../src/replay/recorder";

interface Scenario {
  name: string;
  autonomy: AutonomyLevel;
  prompts: string[];
  only?: string;
}

const SCENARIOS: Scenario[] = [
  {
    name: "basic",
    autonomy: "auto",
    prompts: [
      "Create hello.txt containing hi, then tell me you're done.",
      "Append a second line containing bye to hello.txt, then tell me you're done.",
    ],
  },
  {
    name: "approval",
    autonomy: "supervised",
    prompts: ["Run the shell command `echo approved` and tell me exactly what it printed."],
  },
  {
    name: "subagent",
    autonomy: "auto",
    only: "claude",
    prompts: [
      "Use the Agent tool to spawn exactly one general-purpose subagent that runs the shell command `echo from-subagent` and reports what it printed. Wait for it, then tell me the result in one sentence.",
    ],
  },
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const providerId = process.argv[2];
const only = process.argv[3];
const provider: ProviderAdapter | undefined =
  providerId === "claude"
    ? new ClaudeAdapter()
    : providerId === "codex"
      ? new CodexAdapter()
      : undefined;
if (!provider) {
  console.error("usage: record.ts <claude|codex> [scenario]");
  process.exit(1);
}
const model = process.env.CODEDEN_RECORD_MODEL ?? (providerId === "claude" ? "haiku" : undefined);

const isRootEnd = (e: AgentEvent, root: string) =>
  (e.type === "turn.completed" || e.type === "turn.failed" || e.type === "turn.interrupted") &&
  e.threadId === root;

async function record(adapter: ProviderAdapter, scenario: Scenario): Promise<void> {
  const cwd = mkdtempSync(path.join(tmpdir(), "cd-rec-"));
  const sessionId = `rec-${scenario.name}`;
  const options: SessionOptions = {
    sessionId,
    role: "agent",
    cwd,
    autonomy: scenario.autonomy,
    ...(model ? { model } : {}),
    ...(adapter.id === "codex" ? { effort: "low" as const } : {}),
    mcpServers: [],
    additionalDirectories: [],
    planMode: false,
  };
  const status = await adapter.detect();
  const session = new RecordingSession(await adapter.openSession(options), {
    provider: adapter,
    status,
    scenario: scenario.name,
    options,
  });
  const iterator = session.events[Symbol.asyncIterator]();
  const rootThread = `${sessionId}:thread-root`;
  for (const prompt of scenario.prompts) {
    await session.send({ text: prompt, attachments: [] });
    for (;;) {
      const next = await iterator.next();
      if (next.done) throw new Error("Session ended early");
      const e = next.value;
      if (e.type === "item.started" && e.item.kind === "approval_request") {
        await session.respond(e.item.requestId, { kind: "approval", decision: "allow_once" });
      } else if (e.type === "item.started" && e.item.kind === "user_question") {
        const answers = Object.fromEntries(
          e.item.questions.map((q) => [q.id, [q.options[0]?.label ?? "yes"]]),
        );
        await session.respond(e.item.requestId, { kind: "answer", answers });
      }
      if (isRootEnd(e, rootThread)) {
        console.log(`  turn ${e.type}`);
        break;
      }
    }
  }
  // Let trailing background events (subagent completion) arrive.
  await new Promise((r) => setTimeout(r, 1500));
  const fixture = session.fixture();
  await session.close();
  const file = path.join(root, "test", "fixtures", `${adapter.id}-${scenario.name}.json`);
  saveFixture(file, fixture);
  const count = fixture.turns.reduce((n, t) => n + t.events.length, 0);
  console.log(`  saved ${path.relative(process.cwd(), file)} (${count} events)`);
  // The CLI may still hold the directory open for a moment on Windows; leave it if so.
  await new Promise((r) => setTimeout(r, 1000));
  try {
    rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {
    console.log(`  (left ${cwd} behind)`);
  }
}

for (const scenario of SCENARIOS) {
  if (scenario.only && scenario.only !== provider.id) continue;
  if (only && scenario.name !== only) continue;
  console.log(`Recording ${provider.id}/${scenario.name}...`);
  await record(provider, scenario);
}
process.exit(0);
