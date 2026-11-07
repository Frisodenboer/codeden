import type { AgentEvent, ItemOf, RuntimeResponse } from "@codeden/contracts";
import { ProviderSessionError } from "./adapter";

/** Where an approval or question item lives. */
export interface ItemCtx {
  threadId: string;
  turnId: string;
}

type Request = ItemOf<"approval_request"> | ItemOf<"user_question">;

interface Pending {
  ctx: ItemCtx;
  item: Request;
  resolve: (response: RuntimeResponse) => void;
}

/**
 * Tracks `approval_request` / `user_question` items waiting on `ProviderSession.respond`.
 * Emits `item.started` when a request opens and `item.completed` with the decision when it is
 * answered, cancelled or aborted. Shared by all adapters.
 */
export class ApprovalBroker {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly emit: (event: AgentEvent) => void) {}

  get size(): number {
    return this.pending.size;
  }

  /** Open a request and wait for its response. Resolves `{ kind: "cancel" }` if aborted. */
  request(ctx: ItemCtx, item: Request, signal?: AbortSignal): Promise<RuntimeResponse> {
    return new Promise((resolve) => {
      const finish = (response: RuntimeResponse) => {
        if (!this.pending.delete(item.requestId)) return;
        signal?.removeEventListener("abort", onAbort);
        this.emit({ type: "item.completed", ...ctx, item: completed(item, response) });
        resolve(response);
      };
      const onAbort = () => finish({ kind: "cancel" });
      this.pending.set(item.requestId, { ctx, item, resolve: finish });
      this.emit({ type: "item.started", ...ctx, item });
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** Answer a pending request. Throws `unknown_request` for unknown ids. */
  respond(requestId: string, response: RuntimeResponse): void {
    const pending = this.pending.get(requestId);
    if (!pending) throw new ProviderSessionError("unknown_request", `Unknown request ${requestId}`);
    pending.resolve(response);
  }

  has(requestId: string): boolean {
    return this.pending.has(requestId);
  }

  /** Cancel every pending request (interrupt, close). */
  cancelAll(): void {
    for (const pending of [...this.pending.values()]) pending.resolve({ kind: "cancel" });
  }
}

function completed(item: Request, response: RuntimeResponse): Request {
  if (item.kind === "approval_request") {
    if (response.kind === "approval") {
      return {
        ...item,
        status: response.decision === "deny" ? "declined" : "completed",
        decision: response.decision,
        decidedBy: "user",
      };
    }
    return { ...item, status: "cancelled" };
  }
  if (response.kind === "answer")
    return { ...item, status: "completed", answers: response.answers };
  return { ...item, status: "cancelled" };
}
