// Minimal `codex app-server` stand-in: answers the requests a session makes, records each
// request to FAKE_CODEX_LOG (one JSON line per request) and completes every turn at once.
// FAKE_CODEX_MODEL_LIST picks the `model/list` behaviour:
//   (unset)  two bare models, one page
//   "paged"  real-shaped models over two pages, with a hidden model and unknown efforts
//   "error"  a JSON-RPC error
//   "hang"   never answers `initialize`
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const log = process.env.FAKE_CODEX_LOG;
const mode = process.env.FAKE_CODEX_MODEL_LIST;
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
let turns = 0;

const efforts = (...names) => names.map((reasoningEffort) => ({ reasoningEffort, description: "" }));
const model = (slug, extra) => ({
  id: slug,
  model: slug,
  displayName: slug.toUpperCase(),
  description: `${slug} description`,
  hidden: false,
  supportedReasoningEfforts: efforts("low", "medium", "high", "xhigh", "max", "ultra"),
  defaultReasoningEffort: "medium",
  isDefault: false,
  ...extra,
});
const PAGES = {
  first: {
    data: [
      model("gpt-sol", { isDefault: true, defaultReasoningEffort: "low" }),
      model("gpt-internal", { hidden: true }),
    ],
    nextCursor: "page-2",
  },
  "page-2": {
    data: [model("gpt-luna", { supportedReasoningEfforts: efforts("low", "medium") })],
    nextCursor: null,
  },
};

function modelList(msg) {
  if (mode === "error") return send({ id: msg.id, error: { code: -32603, message: "no models" } });
  if (mode === "paged") return send({ id: msg.id, result: PAGES[msg.params?.cursor ?? "first"] });
  return send({
    id: msg.id,
    result: {
      data: [
        { model: "gpt-other", displayName: "Other", isDefault: false, hidden: false },
        { model: "gpt-configured", displayName: "Configured", isDefault: true, hidden: false },
      ],
    },
  });
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.id === undefined || !msg.method) return;
  if (log) appendFileSync(log, `${JSON.stringify({ method: msg.method, params: msg.params })}\n`);
  switch (msg.method) {
    case "initialize":
      if (mode === "hang") return;
      return send({ id: msg.id, result: { userAgent: "fake-codex/0.0.0" } });
    case "thread/start":
    case "thread/resume":
      return send({ id: msg.id, result: { thread: { id: "thread-1" }, model: "gpt-configured" } });
    case "model/list":
      return modelList(msg);
    case "turn/start": {
      const turn = { id: `turn-${++turns}`, status: "completed", items: [], error: null };
      send({ id: msg.id, result: { turn: { ...turn, status: "inProgress" } } });
      // Like the real server: the turn completes after the response has been handled.
      setTimeout(() => send({ method: "turn/completed", params: { threadId: "thread-1", turn } }), 50);
      return;
    }
    default:
      return send({ id: msg.id, result: {} });
  }
});
