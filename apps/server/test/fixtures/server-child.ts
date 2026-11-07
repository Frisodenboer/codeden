/**
 * A server process for the runner lifecycle test: starts a server (which spawns a detached
 * runner), starts a long Fake session, prints `ready` and waits to be killed.
 *   node --import tsx server-child.ts <home> <token> <prompt>
 */
import { startServer } from "../../src";
import { sampleSession } from "../helpers";

const [home, token, prompt] = process.argv.slice(2) as [string, string, string];
const server = await startServer({
  port: 0,
  dataDir: home,
  token,
  enableFakeProvider: true,
  waitForRunner: true,
  // Tool detection spawns claude/codex/gh; not needed here and it slows a loaded machine.
  checkSetupOnStart: false,
});
server.store.append([
  { type: "session.created", sessionId: "s1", payload: { session: sampleSession } },
]);
await server.runner?.request({
  name: "session.start",
  sessionId: "s1",
  providerId: "fake",
  options: {
    sessionId: "s1",
    role: "agent",
    cwd: home,
    autonomy: "auto",
    mcpServers: [],
    additionalDirectories: [],
    planMode: false,
  },
  input: { text: prompt, attachments: [] },
});
process.stdout.write("ready\n");
setInterval(() => {}, 1000);
