import { join } from "node:path";
import {
  CalendarEventInput,
  DismissAgendaItem,
  FollowUpInput,
  FollowUpPatch,
  IdeaInput,
  IdeaPatch,
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
    .post("/follow-ups", jsonBody(FollowUpInput), (c) =>
      c.json(store.addFollowUp(c.req.valid("json"), { addedBy: "you", sessionId: null }), 201),
    )
    .patch("/follow-ups/:id", jsonBody(FollowUpPatch), (c) =>
      c.json(store.setFollowUpDone(c.req.param("id"), c.req.valid("json").done)),
    )
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
