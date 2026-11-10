import type { AgentEvent } from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import { ApprovalBroker } from "../src/approvals";

describe("ApprovalBroker", () => {
  it("records who decided: the user by default, or CodeDen's policy", async () => {
    const events: AgentEvent[] = [];
    const broker = new ApprovalBroker((e) => events.push(e));
    const ctx = { threadId: "t1", turnId: "u1" };
    const item = (requestId: string) => ({
      id: `approval-${requestId}`,
      kind: "approval_request" as const,
      status: "in_progress" as const,
      requestId,
      action: "git_destructive" as const,
      title: "Run `git push --force`",
      options: ["allow_once" as const, "allow_session" as const, "deny" as const],
    });
    const byUser = broker.request(ctx, item("r1"));
    broker.respond("r1", { kind: "approval", decision: "allow_once" });
    await byUser;
    const byPolicy = broker.request(ctx, item("r2"));
    broker.respond("r2", {
      kind: "approval",
      decision: "deny",
      message: "Nobody is watching",
      decidedBy: "policy",
    });
    await byPolicy;
    const done = events.filter((e) => e.type === "item.completed");
    expect(done.map((e) => (e as { item: { decidedBy?: string } }).item.decidedBy)).toEqual([
      "user",
      "policy",
    ]);
  });
});
