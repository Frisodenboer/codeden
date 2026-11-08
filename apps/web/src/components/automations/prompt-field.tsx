import type { AutomationTrigger } from "@codeden/contracts";
import { Braces, ChevronDown } from "lucide-react";
import { useRef } from "react";
import { CodeEditor, type CodeEditorApi } from "@/components/editor/code-editor";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { placeholdersFor } from "./meta";

/** The "Insert placeholder" menu: always-available fields plus the trigger event's. */
function PlaceholderMenu({
  trigger,
  onPick,
  onClosed,
  disabled,
}: {
  trigger: AutomationTrigger;
  onPick: (token: string) => void;
  /** Called instead of focusing the trigger again when the menu closes. */
  onClosed: () => void;
  disabled?: boolean;
}) {
  const groups = placeholdersFor(trigger);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="xs" variant="outline" disabled={disabled}>
          <Braces /> Insert placeholder <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-80 w-72 overflow-y-auto"
        // Put the cursor back in the editor, so typing carries on after the placeholder.
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          onClosed();
        }}
      >
        {groups.map((g, i) => (
          <div key={g.group}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-3xs uppercase tracking-wide text-muted-foreground">
              {g.group}
            </DropdownMenuLabel>
            {g.items.map((p) => (
              <DropdownMenuItem key={p.token} onSelect={() => onPick(p.token)}>
                <span className="flex-1 text-xs">{p.label}</span>
                <code className="font-mono text-3xs text-muted-foreground">{p.token}</code>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The automation's prompt (or PM message) in a roomy Markdown editor, with an "Insert
 * placeholder" menu that inserts at the cursor. Read-only automations show plain text.
 */
export function PromptField({
  label,
  value,
  onChange,
  trigger,
  disabled,
  docKey,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  trigger: AutomationTrigger;
  disabled?: boolean;
  docKey: string;
  placeholder: string;
}) {
  const api = useRef<CodeEditorApi | null>(null);
  return (
    <div className="space-y-1.5">
      <div className="flex items-end gap-2">
        <span className="flex-1 text-xs font-medium">{label}</span>
        {!disabled && (
          <PlaceholderMenu
            trigger={trigger}
            onPick={(t) => api.current?.insert(t)}
            onClosed={() => api.current?.focus()}
          />
        )}
      </div>
      <div
        className="h-[26rem] overflow-hidden rounded-lg border border-border bg-surface"
        data-testid="prompt-editor"
      >
        {disabled ? (
          <pre className="h-full overflow-auto p-4 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-muted-foreground scroll-thin">
            {value}
          </pre>
        ) : (
          <CodeEditor
            value={value}
            onChange={onChange}
            path="prompt.md"
            docKey={docKey}
            apiRef={api}
            placeholder={placeholder}
          />
        )}
      </div>
      <p className="text-3xs text-muted-foreground">
        Markdown. Placeholders like <code className="font-mono">{"{{project.name}}"}</code> are
        filled in when it runs.
      </p>
    </div>
  );
}
