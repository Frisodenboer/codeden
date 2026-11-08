import { Ellipsis } from "lucide-react";
import {
  type ComponentType,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** One action in a row menu. */
export interface RowMenuAction {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  variant?: "default" | "destructive";
  /** Keep focus where the action put it (an inline editor) instead of returning it. */
  keepFocus?: boolean;
}

/** A row menu's contents: actions, with `"separator"` between groups. */
export type RowMenuEntry = RowMenuAction | "separator";

/** State shared by a row's right-click menu and its ⋯ button. */
export interface RowMenuState {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Handlers for the row: Shift+F10 and the context-menu key open the ⋯ menu. */
  onKeyDown: (event: KeyboardEvent) => void;
  onContextMenu: (event: MouseEvent) => void;
  /** Set by an action with `keepFocus`; read when the menu closes. */
  keepFocus: { current: boolean };
}

/**
 * The row menu pattern for sidebar rows (§13): the same actions open on right-click
 * (`RowMenu` around the row), from a ⋯ button that shows on hover or focus (`RowMenuButton`),
 * and from the keyboard with Shift+F10 or the context-menu key, which open the ⋯ menu so it
 * anchors to the row rather than to the pointer.
 */
export function useRowMenu(): RowMenuState {
  const [open, setOpen] = useState(false);
  const keyboardAt = useRef(0);
  const keepFocus = useRef(false);
  return useMemo(
    () => ({
      open,
      setOpen,
      keepFocus,
      onKeyDown(event: KeyboardEvent) {
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        event.preventDefault();
        keyboardAt.current = Date.now();
        setOpen(true);
      },
      onContextMenu(event: MouseEvent) {
        // The browser may still send `contextmenu` for the key press; the ⋯ menu is open.
        if (Date.now() - keyboardAt.current < 1000) event.preventDefault();
      },
    }),
    [open],
  );
}

type ItemComponent = ComponentType<{
  onSelect?: (event: Event) => void;
  disabled?: boolean;
  variant?: "default" | "destructive";
  children?: ReactNode;
}>;

function Entries({
  entries,
  menu,
  Item,
  Separator,
}: {
  entries: RowMenuEntry[];
  menu: RowMenuState;
  Item: ItemComponent;
  Separator: ComponentType;
}) {
  return entries.map((entry, i) =>
    entry === "separator" ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity of their own
      <Separator key={`separator-${i}`} />
    ) : (
      <Item
        key={entry.label}
        disabled={entry.disabled}
        variant={entry.variant}
        onSelect={() => {
          menu.keepFocus.current = Boolean(entry.keepFocus);
          entry.onSelect();
        }}
      >
        {entry.icon}
        {entry.label}
      </Item>
    ),
  );
}

/** Return focus to the row when a menu closes, unless the chosen action took it. */
function closeAutoFocus(menu: RowMenuState) {
  return (event: Event) => {
    if (!menu.keepFocus.current) return;
    menu.keepFocus.current = false;
    event.preventDefault();
  };
}

/** Wrap a row (a single element) so right-click and the menu keys open its actions. */
export function RowMenu({
  menu,
  entries,
  children,
}: {
  menu: RowMenuState;
  entries: RowMenuEntry[];
  children: ReactElement;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onKeyDown={menu.onKeyDown} onContextMenu={menu.onContextMenu}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44" onCloseAutoFocus={closeAutoFocus(menu)}>
        <Entries
          entries={entries}
          menu={menu}
          Item={ContextMenuItem}
          Separator={ContextMenuSeparator}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** The ⋯ button for a row's actions; visible on hover or focus via the row's classes. */
export function RowMenuButton({
  menu,
  entries,
  label,
  className,
}: {
  menu: RowMenuState;
  entries: RowMenuEntry[];
  /** Accessible name, e.g. "Storefront actions". */
  label: string;
  className?: string;
}) {
  return (
    <DropdownMenu open={menu.open} onOpenChange={menu.setOpen}>
      <DropdownMenuTrigger
        aria-label={label}
        title="More actions"
        onPointerDown={(e) => e.stopPropagation()}
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-border hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-border data-[state=open]:text-foreground",
          className,
        )}
      >
        <Ellipsis className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44" onCloseAutoFocus={closeAutoFocus(menu)}>
        <Entries
          entries={entries}
          menu={menu}
          Item={DropdownMenuItem}
          Separator={DropdownMenuSeparator}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
