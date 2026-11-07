import { useQuery } from "@tanstack/react-query";
import { snapshotQuery } from "@/lib/api";
import { PageHeader } from "./page-header";

/** Settings (placeholder): shows the effective settings from the server. */
export function SettingsPage() {
  const { data, error } = useQuery(snapshotQuery);
  return (
    <>
      <PageHeader title="Settings" />
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {error ? (
          <p className="text-sm text-destructive">Could not reach the server.</p>
        ) : (
          <pre className="rounded-xl border border-border bg-card p-4 font-mono text-xs leading-relaxed text-muted-foreground">
            {data ? JSON.stringify(data.settings, null, 2) : "Loading…"}
          </pre>
        )}
      </div>
    </>
  );
}
