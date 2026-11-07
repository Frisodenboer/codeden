import type { ConflictRecord } from "@codeden/contracts";
import { X } from "lucide-react";
import { ConflictCard } from "@/components/project/conflict-card";
import { Button } from "@/components/ui/button";
import { useClient } from "@/lib/api";
import type { RunConflict } from "./use-automation-actions";

/**
 * A run-now that matched running work (§8.4), with the usual wait / skip / join / force
 * choices; the decision retries the run with `conflict`.
 */
export function RunConflictCard({
  conflict,
  projectId,
  onClose,
}: {
  conflict: RunConflict;
  projectId: string;
  onClose: () => void;
}) {
  const client = useClient();
  const record: ConflictRecord = {
    id: `run:${conflict.automationId}`,
    projectId,
    request: {
      purpose: `Run ${conflict.name} now`,
      workKey: conflict.workKey,
      startedBy: { kind: "user" },
    },
    existing: conflict.existing,
    start: null,
    status: "open",
    resolution: null,
    outcome: null,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
  return (
    <div className="space-y-1" data-testid="run-conflict">
      <ConflictCard
        conflict={record}
        decideWith={async (decision) => {
          const res = await client.automations.run(conflict.automationId, {
            projectId,
            conflict: decision,
          });
          if (res.status === "conflict") throw new Error("Matching work is still running");
          return { status: res.status, sessionId: "sessionId" in res ? res.sessionId : null };
        }}
        onResolved={onClose}
      />
      <Button
        size="xs"
        variant="ghost"
        className="text-muted-foreground"
        aria-label="Dismiss conflict"
        onClick={onClose}
      >
        <X /> Not now
      </Button>
    </div>
  );
}
