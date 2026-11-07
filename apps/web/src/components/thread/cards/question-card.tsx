import type { ItemOf } from "@codeden/contracts";
import { useMutation } from "@tanstack/react-query";
import { Check, MessageCircleQuestion } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useClient } from "@/lib/api";
import { cn } from "@/lib/utils";

type Answers = Record<string, string[]>;

/** Structured questions from the agent, answered inline with options and optional free text. */
export function QuestionCard({
  item,
  sessionId,
}: {
  item: ItemOf<"user_question">;
  sessionId: string;
}) {
  const client = useClient();
  const [answers, setAnswers] = useState<Answers>({});
  const [freeText, setFreeText] = useState<Record<string, string>>({});
  const pending = item.status === "in_progress";
  const submit = useMutation({
    mutationFn: (final: Answers) =>
      client.respond(sessionId, item.requestId, { kind: "answer", answers: final }),
    onError: (e) => toast.error("Couldn't send your answer", { description: e.message }),
  });

  if (!pending) {
    return (
      <div className="space-y-1.5 rounded-lg border border-border bg-card/50 px-3 py-2.5 text-[13px]">
        {item.questions.map((q) => (
          <div key={q.id} className="flex gap-2">
            <Check className="mt-0.5 size-3.5 shrink-0 text-status-done" />
            <span className="text-muted-foreground">{q.question}</span>
            <span className="ml-auto shrink-0 font-medium">
              {item.answers?.[q.id]?.join(", ") ?? "—"}
            </span>
          </div>
        ))}
      </div>
    );
  }

  const toggle = (qid: string, label: string, multi: boolean) =>
    setAnswers((prev) => {
      const cur = prev[qid] ?? [];
      const next = multi
        ? cur.includes(label)
          ? cur.filter((l) => l !== label)
          : [...cur, label]
        : [label];
      return { ...prev, [qid]: next };
    });

  const final = (): Answers =>
    Object.fromEntries(
      item.questions.map((q) => {
        const text = freeText[q.id]?.trim();
        return [q.id, [...(answers[q.id] ?? []), ...(text ? [text] : [])]];
      }),
    );
  const complete = item.questions.every((q) => (final()[q.id]?.length ?? 0) > 0);

  return (
    <div className="overflow-hidden rounded-xl border border-chart-2/30 bg-card animate-rise">
      <div className="flex items-center gap-2 border-b border-chart-2/15 bg-chart-2/[0.07] px-3.5 py-2">
        <MessageCircleQuestion className="size-4 text-chart-2" />
        <span className="text-2xs font-semibold tracking-wider text-chart-2 uppercase">
          {item.questions.length > 1 ? `${item.questions.length} questions` : "Question"}
        </span>
      </div>
      <div className="divide-y divide-border">
        {item.questions.map((q, qi) => (
          <section key={q.id} className="space-y-2 px-3.5 py-3" aria-label={q.question}>
            <div className="mb-2 flex items-baseline gap-2 text-[14px] font-medium">
              {q.header && (
                <span className="rounded bg-muted px-1.5 py-px text-3xs font-medium text-muted-foreground uppercase">
                  {q.header}
                </span>
              )}
              {q.question}
            </div>
            <div className="grid gap-1">
              {q.options.map((o, oi) => {
                const selected = answers[q.id]?.includes(o.label) ?? false;
                return (
                  <button
                    key={o.label}
                    type="button"
                    onClick={() => toggle(q.id, o.label, q.multiSelect)}
                    aria-pressed={selected}
                    className={cn(
                      "flex items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
                      selected
                        ? "border-chart-2/50 bg-chart-2/[0.08]"
                        : "border-border hover:bg-accent/50",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center border transition-colors",
                        q.multiSelect ? "rounded-[4px]" : "rounded-full",
                        selected ? "border-chart-2 bg-chart-2 text-background" : "border-input",
                      )}
                    >
                      {selected && <Check className="size-3" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px]">{o.label}</span>
                      {o.description && (
                        <span className="block text-2xs text-muted-foreground">
                          {o.description}
                        </span>
                      )}
                    </span>
                    <span className="text-3xs text-muted-foreground/60 tabular-nums">
                      {qi === 0 ? oi + 1 : ""}
                    </span>
                  </button>
                );
              })}
            </div>
            {q.allowFreeText && (
              <Input
                placeholder="Or type your own answer…"
                value={freeText[q.id] ?? ""}
                onChange={(e) => setFreeText((p) => ({ ...p, [q.id]: e.target.value }))}
                className="h-8 text-[13px]"
              />
            )}
          </section>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-3.5 py-2">
        <span className="mr-auto text-2xs text-muted-foreground">
          The agent is paused until you answer.
        </span>
        <Button
          size="sm"
          disabled={!complete || submit.isPending || submit.isSuccess}
          onClick={() => submit.mutate(final())}
        >
          Send answer
        </Button>
      </div>
    </div>
  );
}
