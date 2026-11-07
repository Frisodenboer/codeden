import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Hotkey } from "@/components/common/bits";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCombo, isTyping, matchesCombo, SHORTCUTS, type ShortcutId } from "@/lib/shortcuts";
import { useComposerStore } from "@/stores/composer";
import { type RightTab, useLayoutStore } from "@/stores/layout";
import { useThemeStore } from "@/stores/theme";
import { useUiStore } from "@/stores/ui";

const tabs: Record<string, RightTab> = {
  tab1: "diff",
  tab2: "files",
  tab3: "browser",
  tab4: "terminal",
  tab5: "github",
  tab6: "details",
};

/** Bind app-wide shortcuts. Composer-only shortcuts are handled in the composer. */
export function useGlobalShortcuts() {
  const navigate = useNavigate();
  useEffect(() => {
    const handlers: Partial<Record<ShortcutId, () => void>> = {
      palette: () => useUiStore.getState().setPaletteOpen(!useUiStore.getState().paletteOpen),
      help: () => useUiStore.getState().setShortcutsOpen(true),
      theme: () => useThemeStore.getState().toggle(),
      settings: () => void navigate({ to: "/settings/$section", params: { section: "general" } }),
      orchestrator: () => void navigate({ to: "/" }),
      inbox: () => void navigate({ to: "/inbox" }),
      sidebar: () => useLayoutStore.getState().toggleSidebar(),
      rightPanel: () => useLayoutStore.getState().toggleRight(),
      terminal: () => useLayoutStore.getState().toggleDrawer(),
      focusComposer: () => useComposerStore.getState().focus(),
    };
    for (const [id, tab] of Object.entries(tabs)) {
      handlers[id as ShortcutId] = () => useLayoutStore.getState().openRightTab(tab);
    }
    const onKey = (e: KeyboardEvent) => {
      const typing = isTyping(e.target);
      for (const s of SHORTCUTS) {
        const handler = handlers[s.id];
        if (!handler || !matchesCombo(e, s.combo)) continue;
        const singleKey = !s.combo.includes("mod") && !s.combo.includes("alt");
        if (singleKey && typing) continue;
        e.preventDefault();
        handler();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}

/** A grouped list of shortcuts, used by the dialog and Settings. */
export function ShortcutList() {
  const groups = ["General", "Navigation", "Panels", "Composer"] as const;
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {groups.map((g) => (
        <div key={g}>
          <div className="mb-1.5 text-2xs font-medium tracking-wider text-muted-foreground uppercase">
            {g}
          </div>
          <div className="divide-y divide-border rounded-lg border border-border">
            {SHORTCUTS.filter((s) => s.group === g).map((s) => (
              <div key={s.id} className="flex items-center justify-between px-3 py-1.5 text-[13px]">
                <span>{s.label}</span>
                <Hotkey keys={formatCombo(s.combo)} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ShortcutsDialog() {
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Everything important is one keystroke away.</DialogDescription>
        </DialogHeader>
        <ShortcutList />
      </DialogContent>
    </Dialog>
  );
}
