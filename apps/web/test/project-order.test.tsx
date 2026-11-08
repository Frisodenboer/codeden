import type { EventEnvelope, Project, Snapshot } from "@codeden/contracts";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/shell/sidebar/sidebar";
import { createMockClient } from "@/lib/api/mock";
import { projects as fixtureProjects } from "@/lib/api/mock/fixtures/world";
import { MockWorld } from "@/lib/api/mock/world";
import {
  moveWithinGroup,
  restoreOrder,
  splitPinned,
  withOrder,
  withPinned,
} from "@/lib/project-order";
import { snapshotKey } from "@/lib/queries";
import { applyDomainEvent } from "@/lib/snapshot-reducer";
import { renderWithClient } from "./utils";

const base = fixtureProjects[0] as Project;
const project = (id: string, name: string, sortOrder: number, pinned = false): Project => ({
  ...base,
  id,
  name,
  slug: id,
  sortOrder,
  pinned,
});
const ids = (list: Project[]) => list.map((p) => p.id);

// a, b, c unpinned in that order; p, q pinned.
const list = [
  project("p", "Pinned one", 3, true),
  project("q", "Pinned two", 4, true),
  project("a", "Alpha", 0),
  project("b", "Beta", 1),
  project("c", "Gamma", 2),
];

describe("project order helpers", () => {
  it("splits the canonical list into pinned and the rest", () => {
    const { pinned, others } = splitPinned(list);
    expect(ids(pinned)).toEqual(["p", "q"]);
    expect(ids(others)).toEqual(["a", "b", "c"]);
  });

  it("moves within a group only and returns the full order", () => {
    expect(moveWithinGroup(list, "c", 0)).toEqual(["p", "q", "c", "a", "b"]);
    expect(moveWithinGroup(list, "q", 0)).toEqual(["q", "p", "a", "b", "c"]);
    // Clamped to the group: a pinned project never moves below the pinned group.
    expect(moveWithinGroup(list, "p", 9)).toEqual(["q", "p", "a", "b", "c"]);
    expect(moveWithinGroup(list, "a", -1)).toBeNull();
    expect(moveWithinGroup(list, "nope", 1)).toBeNull();
  });

  it("applies an order and a pin the way the server does", () => {
    const reordered = withOrder(list, ["p", "q", "c", "a", "b"]);
    expect(ids(reordered)).toEqual(["p", "q", "c", "a", "b"]);
    expect(reordered.map((p) => p.sortOrder)).toEqual([0, 1, 2, 3, 4]);
    // Pinning keeps the slot, so Gamma (slot 2) leads the pinned group ahead of slots 3 and 4.
    const pinned = withPinned(list, "c", true);
    expect(ids(pinned)).toEqual(["c", "p", "q", "a", "b"]);
    expect(pinned.find((p) => p.id === "c")?.sortOrder).toBe(2);
  });

  it("restores pin and order fields after a rejected change, keeping other edits", () => {
    const changed = withPinned(withOrder(list, ["q", "p", "b", "a", "c"]), "a", true).map((p) =>
      p.id === "b" ? { ...p, name: "Beta renamed" } : p,
    );
    const restored = restoreOrder(changed, list);
    expect(ids(restored)).toEqual(ids(list));
    expect(restored.find((p) => p.id === "b")?.name).toBe("Beta renamed");
  });
});

describe("snapshot reducer: project order", () => {
  const event = (snap: Snapshot, init: Omit<EventEnvelope, "seq" | "ts">) =>
    ({ ...init, seq: snap.seq + 1, ts: new Date().toISOString() }) as EventEnvelope;

  it("applies projects.reordered and keeps the canonical order on updates", () => {
    const snap = new MockWorld().snapshot;
    expect(ids(snap.projects)).toEqual(["p-storefront", "p-billing", "p-notes"]);
    const reordered = applyDomainEvent(
      snap,
      event(snap, {
        type: "projects.reordered",
        sessionId: null,
        payload: { projectIds: ["p-notes", "p-storefront", "p-billing"] },
      }),
    );
    expect(ids(reordered.projects)).toEqual(["p-notes", "p-storefront", "p-billing"]);

    const billing = reordered.projects[2] as Project;
    const pinned = applyDomainEvent(
      reordered,
      event(reordered, {
        type: "project.updated",
        sessionId: null,
        payload: { project: { ...billing, pinned: true } },
      }),
    );
    expect(ids(pinned.projects)).toEqual(["p-billing", "p-notes", "p-storefront"]);

    const archived = applyDomainEvent(
      pinned,
      event(pinned, {
        type: "project.updated",
        sessionId: null,
        payload: { project: { ...billing, archivedAt: new Date().toISOString() } },
      }),
    );
    expect(ids(archived.projects)).toEqual(["p-notes", "p-storefront"]);
  });
});

/** Project names in sidebar order, read from each row's reorder grip. */
async function sidebarOrder(region?: HTMLElement): Promise<string[]> {
  const scope = region ? within(region) : screen;
  const grips = await scope.findAllByRole("button", { name: /^Reorder / });
  return grips.map((g) => (g.getAttribute("aria-label") ?? "").replace(/^Reorder /, ""));
}

async function chooseFromMenu(projectName: string, item: RegExp) {
  fireEvent.keyDown(await screen.findByRole("button", { name: `${projectName} actions` }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
}

describe("sidebar project groups", () => {
  it("pins into a Pinned group and moves projects with the row menu", async () => {
    renderWithClient(<Sidebar width={280} />, createMockClient(), { withRouter: true });
    expect(await sidebarOrder()).toEqual(["Storefront", "Billing API", "notes-cli"]);
    expect(screen.queryByRole("region", { name: "Pinned projects" })).toBeNull();

    await chooseFromMenu("notes-cli", /^Pin$/);
    const pinned = await screen.findByRole("region", { name: "Pinned projects" });
    expect(await sidebarOrder(pinned)).toEqual(["notes-cli"]);
    expect(await sidebarOrder()).toEqual(["notes-cli", "Storefront", "Billing API"]);

    await chooseFromMenu("Billing API", /Move up/);
    await waitFor(async () =>
      expect(await sidebarOrder()).toEqual(["notes-cli", "Billing API", "Storefront"]),
    );

    await chooseFromMenu("notes-cli", /^Unpin$/);
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Pinned projects" })).toBeNull(),
    );
  });

  it("rolls a rejected reorder back and says so", async () => {
    const client = createMockClient();
    client.reorderProjects = () => Promise.reject(new Error("The server said no"));
    const error = vi.spyOn(toast, "error").mockImplementation(() => "t");
    const { queryClient } = renderWithClient(<Sidebar width={280} />, client, {
      withRouter: true,
    });
    expect(await sidebarOrder()).toEqual(["Storefront", "Billing API", "notes-cli"]);

    await chooseFromMenu("Storefront", /Move down/);
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("Couldn't save the project order", {
        description: "The server said no",
      }),
    );
    expect(await sidebarOrder()).toEqual(["Storefront", "Billing API", "notes-cli"]);
    const snap = queryClient.getQueryData<Snapshot>(snapshotKey);
    expect(snap?.projects.map((p) => p.sortOrder)).toEqual([0, 1, 2]);
    error.mockRestore();
  });
});
