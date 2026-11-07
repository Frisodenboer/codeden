import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClient } from "@/lib/api";
import { useSnapshotData } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { SettingRow, SettingsSection } from "./settings-ui";

/** GitHub connection (§9): the `gh` login CodeDen reads at runtime, and which projects use it. */
export function GithubSettings() {
  const client = useClient();
  const projects = useSnapshotData((s) => s.projects, []);
  const { data, isFetching, refetch, error } = useQuery({
    queryKey: ["github", "connection"],
    queryFn: () => client.github.connection(),
  });
  const connected = data?.connected ?? false;
  return (
    <SettingsSection
      title="GitHub"
      description="Issues, pull requests, checks and evidence use the token from the GitHub CLI (`gh auth token`), read at runtime and never stored."
    >
      <SettingRow
        label="Connection"
        help={
          error
            ? error.message
            : connected
              ? `Signed in${data?.login ? ` as ${data.login}` : ""} via ${data?.source === "keychain" ? "the OS keychain" : "the GitHub CLI"}.`
              : (data?.message ?? "Checking…")
        }
      >
        <div className="flex items-center gap-2" data-testid="github-connection">
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs",
              connected ? "text-status-done" : "text-status-waiting",
            )}
          >
            {connected ? (
              <CheckCircle2 className="size-3.5" />
            ) : (
              <CircleAlert className="size-3.5" />
            )}
            {data ? (connected ? "Connected" : "Not connected") : "…"}
          </span>
          <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={cn(isFetching && "animate-spin")} /> Re-check
          </Button>
        </div>
      </SettingRow>
      {projects.map((p) => (
        <SettingRow
          key={p.id}
          label={p.name}
          help={p.kind === "github" ? `${p.github.owner}/${p.github.repo}` : "No GitHub remote"}
        >
          <span className="text-2xs text-muted-foreground">
            {p.kind === "github" ? "Issue and PR flow" : "Local only"}
          </span>
        </SettingRow>
      ))}
    </SettingsSection>
  );
}
