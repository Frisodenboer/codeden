import { FolderGit2, FolderOpen } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { platform } from "@/lib/platform";
import { FolderBrowser } from "./folder-browser";

/**
 * Folder choice with the OS's own picker (when the platform has one, §13), plus the
 * server-side browser as a fallback for folders the dialog can't reach.
 */
export function NativeFolderField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (path: string) => void;
}) {
  const [browse, setBrowse] = useState(false);
  const [picking, setPicking] = useState(false);
  const choose = async () => {
    setPicking(true);
    try {
      const path = await platform.pickFolder({
        title: "Choose a project folder",
        defaultPath: value ?? undefined,
      });
      if (path) onChange(path);
    } finally {
      setPicking(false);
    }
  };

  if (browse) {
    return (
      <div className="space-y-2">
        <FolderBrowser value={value} onChange={onChange} />
        <Button variant="link" size="xs" className="px-0" onClick={() => setBrowse(false)}>
          Use the system folder picker instead
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2" data-testid="native-folder-field">
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
        <FolderGit2 className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          {value ? (
            <div className="truncate font-mono text-[13px]" title={value}>
              {value}
            </div>
          ) : (
            <div className="text-[13px] text-muted-foreground">No folder chosen yet</div>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => void choose()} disabled={picking}>
          <FolderOpen /> {value ? "Change..." : "Choose folder..."}
        </Button>
      </div>
      <Button variant="link" size="xs" className="px-0" onClick={() => setBrowse(true)}>
        Browse folders in CodeBench instead
      </Button>
    </div>
  );
}
