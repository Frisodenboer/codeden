import type { JsonValue } from "@codeden/contracts";

/** A long, unbroken token, like the ids, hashes and base64 blobs real tool results carry. */
const blob = "c0de".repeat(12) + "d3n".repeat(60);

/** Input of the scripted `[mcp]` tool call: an issue reference with a long unbroken URL. */
export const fakeMcpInput: JsonValue = {
  issue: {
    number: 3,
    url: `https://github.com/codeden-e2e/demo-repo/issues/3?trace=${blob}`,
  },
  priority: "low",
};

/**
 * Result text of the scripted `[mcp]` tool call: one compact line of JSON, several kilobytes
 * long, shaped like a triage result. Lets tests check that long tool output stays inside the
 * transcript column.
 */
export function fakeMcpResult(): string {
  const body = Array.from(
    { length: 12 },
    (_, i) => `Step ${i + 1}: list the models the provider reports before a session starts.`,
  ).join(" ");
  return JSON.stringify({
    issue: {
      projectId: "a72f9074-7b37-4693-bbae-8b108576aefc",
      number: 3,
      title: "Discover the real model list without running a session first",
      state: "open",
      url: `https://github.com/codeden-e2e/demo-repo/issues/3?trace=${blob}`,
      labels: ["enhancement", "providers", "low-priority"],
      body,
      trace: blob,
      blockedBy: [{ number: 2, title: "Model picker redesign", state: "open" }],
    },
  });
}
