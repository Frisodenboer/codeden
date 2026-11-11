import { join } from "node:path";
import {
  CalendarEventInput,
  DismissAgendaItem,
  FollowUpInput,
  FollowUpPatch,
  IdeaInput,
  IdeaPatch,
  UserInput,
} from "@codeden/contracts";
import { Hono } from "hono";
import type { AppServices } from "../services/container";
import { PlannerStore } from "../services/planner/planner-store";
import { jsonBody } from "./validate";

/** `/api/planner`: the user's calendar events and idea kanban (`~/.codeden/planner.json`). */
export function plannerRoutes(s: AppServices) {
  const store = new PlannerStore(join(s.paths.home, "planner.json"));
  return new Hono()
    .get("/", (c) => c.json(store.read()))
    .post("/events", jsonBody(CalendarEventInput), (c) =>
      c.json(store.createEvent(c.req.valid("json")), 201),
    )
    .put("/events/:id", jsonBody(CalendarEventInput), (c) =>
      c.json(store.updateEvent(c.req.param("id"), c.req.valid("json"))),
    )
    .delete("/events/:id", (c) => {
      store.deleteEvent(c.req.param("id"));
      return c.json({ ok: true });
    })
    .post("/ideas", jsonBody(IdeaInput), (c) => c.json(store.createIdea(c.req.valid("json")), 201))
    .patch("/ideas/:id", jsonBody(IdeaPatch), (c) =>
      c.json(store.updateIdea(c.req.param("id"), c.req.valid("json"))),
    )
    .post("/follow-ups", jsonBody(FollowUpInput), (c) => {
      const v = c.req.valid("json");
      return c.json(store.addFollowUp(v, { addedBy: "you", sessionId: v.sessionId }), 201);
    })
    .patch("/follow-ups/:id", jsonBody(FollowUpPatch), async (c) => {
      const { done, notify } = c.req.valid("json");
      const before = store.read().followUps.find((f) => f.id === c.req.param("id"));
      const item = store.setFollowUpDone(c.req.param("id"), done);
      // Ticked off an item that came from a chat: tell that chat, so it can carry on.
      if (done && notify && item.sessionId && !before?.doneAt) {
        await tellChatDone(s, item.sessionId, item.title).catch((error) =>
          console.warn(`follow-up ${item.id}: couldn't tell the chat it's done: ${String(error)}`),
        );
      }
      return c.json(item);
    })
    .delete("/follow-ups/:id", (c) => {
      store.deleteFollowUp(c.req.param("id"));
      return c.json({ ok: true });
    })
    .post("/dismiss", jsonBody(DismissAgendaItem), (c) => {
      store.dismiss(c.req.valid("json").id);
      return c.json({ ok: true });
    })
    .delete("/ideas/:id", (c) => {
      store.deleteIdea(c.req.param("id"));
      return c.json({ ok: true });
    });
}

/** Send "Done: …" to the chat a follow-up came from (queued if it is busy). */
async function tellChatDone(s: AppServices, sessionId: string, title: string): Promise<void> {
  const session = s.sessionRepo.get(sessionId);
  const input = UserInput.parse({ text: `Done: ${title}` });
  if (session.role === "orchestrator") {
    await s.orchestration.sendToRole("orchestrator", null, input, "queue");
  } else if (session.role === "pm" && session.projectId) {
    await s.orchestration.sendToRole("pm", session.projectId, input, "queue");
  } else {
    await s.sessions.send(sessionId, { input, whenBusy: "queue" });
  }
}
