import { FileDiff, Files, Globe, Info, SquareTerminal } from "lucide-react";
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const tabs = [
  { id: "diff", label: "Diff", icon: FileDiff, hint: "Turn and session diffs from checkpoints." },
  { id: "files", label: "Files", icon: Files, hint: "Worktree file tree and editor." },
  {
    id: "browser",
    label: "Browser",
    icon: Globe,
    hint: "The browser agents drive, streamed live.",
  },
  {
    id: "terminal",
    label: "Terminal",
    icon: SquareTerminal,
    hint: "Terminals in the session worktree.",
  },
  { id: "details", label: "Info", icon: Info, hint: "Session, issue and PR details." },
] as const;

/** Right panel (§13): diff, files, browser, terminal, details. Placeholders in M0. */
export function RightPanel() {
  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-border bg-panel">
      <Tabs defaultValue="diff" className="flex h-full flex-col gap-0">
        <div className="flex h-12 items-center border-b border-border px-2">
          <TabsList variant="line" className="h-12 gap-1">
            {tabs.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="gap-1 px-1.5 text-xs">
                <t.icon className="size-3.5" />
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {tabs.map((t) => (
          <TabsContent key={t.id} value={t.id} className="m-0 flex-1">
            <Placeholder icon={<t.icon className="size-5" />} title={t.label} hint={t.hint} />
          </TabsContent>
        ))}
      </Tabs>
    </aside>
  );
}

function Placeholder({ icon, title, hint }: { icon: ReactNode; title: string; hint: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
        {icon}
      </div>
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-56 text-xs text-muted-foreground">{hint}</p>
      <p className="mt-1 text-[11px] text-muted-foreground/70">Select a session to see it here.</p>
    </div>
  );
}
