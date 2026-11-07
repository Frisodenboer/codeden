// Minimal `codex app-server` stand-in: answers the requests a session makes, records each
// request to FAKE_CODEX_LOG (one JSON line per request) and completes every turn at once.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const log = process.env.FAKE_CODEX_LOG;
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
let turns = 0;

createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.id === undefined || !msg.method) return;
  if (log) appendFileSync(log, `${JSON.stringify({ method: msg.method, params: msg.params })}\n`);
  switch (msg.method) {
    case "initialize":
      return send({ id: msg.id, result: { userAgent: "fake-codex/0.0.0" } });
    case "thread/start":
    case "thread/resume":
      return send({ id: msg.id, result: { thread: { id: "thread-1" }, model: "gpt-configured" } });
    case "model/list":
      return send({
        id: msg.id,
        result: {
          data: [
            { model: "gpt-other", displayName: "Other", isDefault: false, hidden: false },
            { model: "gpt-configured", displayName: "Configured", isDefault: true, hidden: false },
          ],
        },
      });
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
