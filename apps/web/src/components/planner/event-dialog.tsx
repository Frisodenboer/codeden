import type { CalendarEvent, EventRepeat } from "@codeden/contracts";
import { type FormEvent, useEffect, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { usePlannerActions } from "@/lib/planner";
import { useSnapshotData } from "@/lib/queries";

const pad = (n: number) => String(n).padStart(2, "0");
/** `YYYY-MM-DD` of a date in local time. */
export const localDay = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus:border-primary/50";

/** What the dialog opens on: an existing event, or a new one on a day. */
export type EventDialogTarget = { event: CalendarEvent } | { day: Date } | null;

/** Add or edit one of the user's own calendar events. */
export function EventDialog({
  target,
  onClose,
}: {
  target: EventDialogTarget;
  onClose: () => void;
}) {
  const { createEvent, updateEvent, deleteEvent } = usePlannerActions();
  const projects = useSnapshotData((s) => s.projects, []);
  const editing = target && "event" in target ? target.event : null;
  const [title, setTitle] = useState("");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("09:00");
  const [endTime, setEndTime] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [repeat, setRepeat] = useState<EventRepeat>("none");
  const [projectId, setProjectId] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!target) return;
    if ("event" in target) {
      const e = target.event;
      const start = new Date(e.at);
      setTitle(e.title);
      setDay(localDay(start));
      setTime(e.allDay ? "09:00" : localTime(start));
      setEndTime(e.endAt && !e.allDay ? localTime(new Date(e.endAt)) : "");
      setAllDay(e.allDay);
      setRepeat(e.repeat);
      setProjectId(e.projectId ?? "");
      setNotes(e.notes);
    } else {
      setTitle("");
      setDay(localDay(target.day));
      setTime("09:00");
      setEndTime("");
      setAllDay(false);
      setRepeat("none");
      setProjectId("");
      setNotes("");
    }
  }, [target]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !day) return;
    const start = new Date(`${day}T${allDay ? "00:00" : time}`);
    const end = !allDay && endTime ? new Date(`${day}T${endTime}`) : null;
    const input = {
      title: title.trim(),
      at: start.toISOString(),
      endAt: end ? end.toISOString() : null,
      allDay,
      repeat,
      projectId: projectId || null,
      notes,
    };
    if (editing) updateEvent.mutate({ id: editing.id, input }, { onSuccess: onClose });
    else createEvent.mutate(input, { onSuccess: onClose });
  };

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-3">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit event" : "New event"}</DialogTitle>
            <DialogDescription>
              Saved on this computer, in ~/.codeden/planner.json.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What's happening?"
            aria-label="Title"
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1 text-xs text-muted-foreground">
              Day
              <Input
                type="date"
                aria-label="Day"
                value={day}
                onChange={(e) => setDay(e.target.value)}
                required
              />
            </div>
            <div className="flex items-end justify-between gap-2 pb-2 text-xs text-muted-foreground">
              All day
              <Switch checked={allDay} onCheckedChange={setAllDay} aria-label="All day" />
            </div>
            {!allDay && (
              <>
                <div className="space-y-1 text-xs text-muted-foreground">
                  Start
                  <Input
                    type="time"
                    aria-label="Start"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  End (optional)
                  <Input
                    type="time"
                    aria-label="End"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              </>
            )}
            <div className="space-y-1 text-xs text-muted-foreground">
              Repeat
              <select
                aria-label="Repeat"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value as EventRepeat)}
                className={selectClass}
              >
                <option value="none">Doesn't repeat</option>
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
                <option value="monthly">Every month</option>
                <option value="yearly">Every year</option>
              </select>
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">
              Project
              <select
                aria-label="Project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className={selectClass}
              >
                <option value="">None</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes"
            aria-label="Notes"
            rows={3}
          />
          <DialogFooter className="gap-2">
            {editing && (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-status-failed"
                onClick={() => deleteEvent.mutate(editing.id, { onSuccess: onClose })}
              >
                Delete
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim() || !day}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
