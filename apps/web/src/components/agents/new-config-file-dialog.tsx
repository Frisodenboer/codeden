import type { AgentConfigFileContent, AgentConfigProvider } from "@codeden/contracts";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Segmented } from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useClient } from "@/lib/api";
import {
  CONFIG_NAME,
  type NewConfigKind,
  newConfigLocation,
  newConfigTemplate,
} from "./config-templates";

/** Create a skill or subagent in the provider's own folder, from a small template. */
export function NewConfigFileDialog({
  kind,
  projectId,
  open,
  onOpenChange,
  onCreated,
}: {
  kind: NewConfigKind;
  projectId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (file: AgentConfigFileContent) => void;
}) {
  const client = useClient();
  const [provider, setProvider] = useState<AgentConfigProvider>("claude");
  const [scope, setScope] = useState<"user" | "project">(projectId ? "project" : "user");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const valid = CONFIG_NAME.test(name) && (scope === "user" || projectId !== null);
  const location = newConfigLocation(kind, provider, scope, name || "<name>", projectId);
  const noun = kind === "skill" ? "skill" : "subagent";

  const create = useMutation({
    mutationFn: () =>
      client.agentConfig.write(
        {
          ...newConfigLocation(kind, provider, scope, name, projectId),
          content: newConfigTemplate(kind, provider, name, description),
        },
        { create: true },
      ),
    onSuccess: (res) => {
      toast.success(`Created ${name}`, { description: res.file.absolutePath });
      onCreated(res.file);
      onOpenChange(false);
      setName("");
      setDescription("");
    },
    onError: (e) => toast.error(`Couldn't create the ${noun}`, { description: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New {noun}</DialogTitle>
          <DialogDescription>
            Written to the provider's own folder, so the CLI picks it up too.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              value={provider}
              onChange={setProvider}
              options={[
                { value: "claude", label: "Claude Code" },
                { value: "codex", label: "Codex" },
              ]}
            />
            <Segmented
              value={scope}
              onChange={setScope}
              options={[
                { value: "user", label: "Everywhere (user)" },
                ...(projectId ? [{ value: "project" as const, label: "This project" }] : []),
              ]}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-config-name">Name</Label>
            <Input
              id="new-config-name"
              value={name}
              onChange={(e) => setName(e.target.value.trim())}
              placeholder={kind === "skill" ? "release-notes" : "code-reviewer"}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-config-desc">Description</Label>
            <Input
              id="new-config-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="When the agent should use it"
            />
          </div>
          <p className="font-mono text-3xs break-all text-muted-foreground">
            {location.root === "home" ? "~/" : "<project>/"}
            {location.path}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!valid || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "Creating…" : `Create ${noun}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
