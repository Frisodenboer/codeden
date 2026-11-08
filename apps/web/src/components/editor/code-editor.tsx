import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const highlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "600", color: "var(--foreground)" },
  { tag: tags.heading1, fontSize: "1.15em" },
  { tag: [tags.strong], fontWeight: "600" },
  { tag: [tags.emphasis], fontStyle: "italic" },
  { tag: [tags.link, tags.url], color: "var(--primary)" },
  { tag: [tags.monospace, tags.string], color: "var(--chart-3)" },
  {
    tag: [tags.list, tags.quote, tags.processingInstruction, tags.meta],
    color: "var(--muted-foreground)",
  },
  { tag: [tags.keyword, tags.propertyName], color: "var(--chart-2)" },
  { tag: [tags.number, tags.bool], color: "var(--chart-4)" },
]);

const theme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    backgroundColor: "transparent",
    color: "var(--foreground)",
  },
  ".cm-scroller": {
    fontFamily: '"Geist Mono Variable", ui-monospace, monospace',
    lineHeight: "1.65",
  },
  ".cm-content": { padding: "14px 0", caretColor: "var(--primary)" },
  ".cm-line": { padding: "0 18px" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "color-mix(in oklch, var(--muted-foreground) 55%, transparent)",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 6px 0 14px", fontSize: "11px" },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklch, var(--foreground) 3.5%, transparent)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in oklch, var(--primary) 22%, transparent) !important",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--primary)", borderLeftWidth: "2px" },
  ".cm-placeholder": { color: "var(--muted-foreground)" },
});

function languageFor(path: string): Extension {
  if (path.endsWith(".json")) return json();
  return markdown();
}

/** Imperative handle of a `CodeEditor`. */
export interface CodeEditorApi {
  /** Insert text at the cursor (replacing the selection) and focus the editor. */
  insert(text: string): void;
  focus(): void;
}

/** CodeMirror 6 editor for memory files, the vision and other text configs (§12.3, §12.4). */
export function CodeEditor({
  value,
  onChange,
  path = "file.md",
  docKey,
  placeholder,
  onSave,
  className,
  apiRef,
}: {
  value: string;
  onChange: (value: string) => void;
  path?: string;
  /** Changing this recreates the editor with `value` (e.g. a different file). */
  docKey: string;
  placeholder?: string;
  onSave?: () => void;
  className?: string;
  /** Receives an insert handle while the editor is mounted. */
  apiRef?: { current: CodeEditorApi | null };
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const handlers = useRef({ onChange, onSave });
  handlers.current = { onChange, onSave };

  // biome-ignore lint/correctness/useExhaustiveDependencies: recreate only when the document changes identity.
  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        languageFor(path),
        syntaxHighlighting(highlight),
        theme,
        placeholder ? placeholderExt(placeholder) : [],
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              handlers.current.onSave?.();
              return true;
            },
          },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) handlers.current.onChange(u.state.doc.toString());
        }),
      ],
    });
    view.current = new EditorView({ state, parent: host.current });
    if (apiRef) {
      apiRef.current = {
        insert(text) {
          const v = view.current;
          if (!v) return;
          const { from, to } = v.state.selection.main;
          v.dispatch({
            changes: { from, to, insert: text },
            selection: { anchor: from + text.length },
          });
          v.focus();
        },
        focus() {
          view.current?.focus();
        },
      };
    }
    return () => {
      view.current?.destroy();
      view.current = null;
      if (apiRef) apiRef.current = null;
    };
  }, [docKey, path]);

  // Keep the editor in sync when `value` changes from outside (revert, async load).
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current !== value) v.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return <div ref={host} className={cn("h-full min-h-0 overflow-hidden", className)} />;
}
