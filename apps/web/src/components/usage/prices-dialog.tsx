import type { ModelPrice } from "@codeden/contracts";
import { Pencil, Tag, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSaveUsageSettings, useUsageSettings } from "./api";
import { localToday, PROVIDER_NAMES } from "./format";

const FIELDS = [
  ["inputPerMTok", "Input"],
  ["outputPerMTok", "Output"],
  ["cacheReadPerMTok", "Cache read"],
  ["cacheWritePerMTok", "Cache write"],
] as const;

type Draft = { provider: string; model: string } & Record<(typeof FIELDS)[number][0], string>;

const emptyDraft: Draft = {
  provider: "claude",
  model: "",
  inputPerMTok: "",
  outputPerMTok: "",
  cacheReadPerMTok: "",
  cacheWritePerMTok: "",
};

/** The price table behind estimated costs: bundled list prices plus your overrides. */
export function PricesDialog() {
  const settings = useUsageSettings();
  const save = useSaveUsageSettings();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const current = settings.data?.settings;
  const overrides = current?.prices ?? [];
  const bundled = settings.data?.bundledPrices ?? [];
  const overridden = new Set(overrides.map((p) => `${p.provider}:${p.model}`));

  const savePrices = (prices: ModelPrice[], message: string) => {
    if (!current) return;
    save.mutate(
      { ...current, prices },
      { onSuccess: () => toast.success(message), onError: (e) => toast.error(e.message) },
    );
  };

  const add = () => {
    const values = FIELDS.map(([k]) => Number(draft[k] || 0));
    if (!draft.model.trim() || values.some((v) => !(v >= 0))) {
      toast.error("Enter a model id and non-negative prices");
      return;
    }
    const price: ModelPrice = {
      provider: draft.provider.trim(),
      model: draft.model.trim(),
      inputPerMTok: values[0] ?? 0,
      outputPerMTok: values[1] ?? 0,
      cacheReadPerMTok: values[2] ?? 0,
      cacheWritePerMTok: values[3] ?? 0,
      asOf: localToday(),
    };
    const rest = overrides.filter(
      (p) => !(p.provider === price.provider && p.model === price.model),
    );
    savePrices([...rest, price], `Price for ${price.model} saved`);
    setDraft(emptyDraft);
  };

  const edit = (p: ModelPrice) =>
    setDraft({
      provider: p.provider,
      model: p.model,
      inputPerMTok: String(p.inputPerMTok),
      outputPerMTok: String(p.outputPerMTok),
      cacheReadPerMTok: String(p.cacheReadPerMTok),
      cacheWritePerMTok: String(p.cacheWritePerMTok),
    });

  const row = (p: ModelPrice, override: boolean) => (
    <TableRow key={`${override ? "o" : "b"}:${p.provider}:${p.model}`}>
      <TableCell className="py-1.5 text-muted-foreground">
        {PROVIDER_NAMES[p.provider] ?? p.provider}
      </TableCell>
      <TableCell className="py-1.5 font-mono">
        {p.model}
        {!override && overridden.has(`${p.provider}:${p.model}`) && (
          <span className="ml-1.5 text-2xs text-muted-foreground">(overridden)</span>
        )}
      </TableCell>
      {FIELDS.map(([k]) => (
        <TableCell key={k} className="py-1.5 text-right font-mono tabular-nums">
          ${p[k]}
        </TableCell>
      ))}
      <TableCell className="py-1.5 text-right text-2xs text-muted-foreground">{p.asOf}</TableCell>
      <TableCell className="py-1.5 text-right">
        {override ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove ${p.model} override`}
            onClick={() =>
              savePrices(
                overrides.filter((o) => o !== p),
                "Override removed",
              )
            }
          >
            <Trash2 />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Override ${p.model}`}
            onClick={() => edit(p)}
          >
            <Pencil />
          </Button>
        )}
      </TableCell>
    </TableRow>
  );

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <Tag className="size-3.5" /> Prices
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Model prices</DialogTitle>
          <DialogDescription>
            USD per million tokens. Estimated costs use these when a provider reports no cost (Codex
            always, Claude never). List prices are bundled with the date they were checked; your
            overrides win.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2 rounded-lg border border-border p-3 text-xs md:grid-cols-7">
          <Input
            aria-label="Provider"
            className="h-7"
            value={draft.provider}
            onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
            placeholder="provider"
          />
          <Input
            aria-label="Model id"
            className="col-span-2 h-7 font-mono"
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            placeholder="model id"
          />
          {FIELDS.map(([k, label]) => (
            <Input
              key={k}
              aria-label={`${label} per million tokens`}
              inputMode="decimal"
              className="h-7"
              value={draft[k]}
              onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
              placeholder={label}
            />
          ))}
          <div className="col-span-3 flex justify-end md:col-span-7">
            <Button size="sm" onClick={add} disabled={save.isPending || !current}>
              Save price
            </Button>
          </div>
        </div>
        <Table className="text-xs">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8 text-2xs">Provider</TableHead>
              <TableHead className="h-8 text-2xs">Model</TableHead>
              {FIELDS.map(([k, label]) => (
                <TableHead key={k} className="h-8 text-right text-2xs">
                  {label}
                </TableHead>
              ))}
              <TableHead className="h-8 text-right text-2xs">Checked</TableHead>
              <TableHead className="h-8 w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {overrides.map((p) => row(p, true))}
            {bundled.map((p) => row(p, false))}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
