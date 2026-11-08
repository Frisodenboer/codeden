import { expect, type Page, test } from "@playwright/test";

// Attention cues for items that block an agent. Runs after the m* specs (files run in name
// order): m1 needs a fresh install, and this spec completes setup and adds the demo project.

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`global setup did not set ${name}`);
  return value;
};

async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  const res = await page.request.fetch(`${env("CODEDEN_E2E_URL")}/api${path}`, {
    method,
    headers: { authorization: `Bearer ${env("CODEDEN_E2E_TOKEN")}` },
    data: body,
  });
  const json = (await res.json().catch(() => null)) as T;
  expect(res.status(), `${method} ${path}: ${JSON.stringify(json)}`).toBeLessThan(300);
  return json;
}

/** The demo repo's project (created by an earlier spec, or here). */
async function projectId(page: Page): Promise<string> {
  const repo = env("CODEDEN_E2E_REPO");
  const snap = await api<{ projects: { id: string; path: string }[] }>(page, "GET", "/snapshot");
  const norm = (p: string) => p.replaceAll("\\", "/").toLowerCase();
  const found = snap.projects.find((p) => norm(p.path) === norm(repo));
  if (found) return found.id;
  const created = await api<{ project: { id: string } }>(page, "POST", "/projects", {
    source: { type: "local", path: repo },
  });
  return created.project.id;
}

interface InboxRow {
  id: string;
  kind: string;
  sessionId: string | null;
}

/** Start a Fake session that stops at an approval; resolves with its open approval item. */
async function startApproval(page: Page, project: string, text: string) {
  const started = await api<{ status: string; sessionId: string }>(page, "POST", "/sessions", {
    projectId: project,
    provider: "fake",
    purpose: text,
    input: { text: `${text} [approval]` },
  });
  expect(started.status).toBe("started");
  let approval: InboxRow | undefined;
  await expect
    .poll(async () => {
      const open = await api<InboxRow[]>(page, "GET", `/inbox?sessionId=${started.sessionId}`);
      approval = open.find((i) => i.kind === "approval");
      return Boolean(approval);
    })
    .toBe(true);
  if (!approval) throw new Error("no approval item");
  return { sessionId: started.sessionId, approval };
}

/**
 * Stand in for the Web Audio API: count the notes the chime starts instead of playing sound.
 * Runs in the page before the app loads.
 */
function spyOnAudio() {
  const w = window as unknown as { __chimeNotes: number; AudioContext: unknown };
  w.__chimeNotes = 0;
  const param = () => ({ value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  w.AudioContext = class {
    state = "running";
    currentTime = 0;
    destination = {};
    resume() {
      return Promise.resolve();
    }
    createGain() {
      return { gain: param(), connect: (node: unknown) => node };
    }
    createOscillator() {
      return {
        type: "sine",
        frequency: param(),
        connect: (node: unknown) => node,
        start: () => {
          w.__chimeNotes += 1;
        },
        stop() {},
      };
    }
  };
}

const chimeNotes = (page: Page) =>
  page.evaluate(() => (window as unknown as { __chimeNotes: number }).__chimeNotes);

/**
 * Open the inbox and wait for the snapshot (the sidebar lists the project), so the approval
 * started next arrives as a live event rather than being there at load.
 */
async function openInbox(page: Page) {
  await page.goto(`${env("CODEDEN_E2E_URL")}/inbox`);
  await expect(page.getByText("demo-repo", { exact: true }).first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(spyOnAudio);
  await page.goto(env("CODEDEN_E2E_LAUNCH_URL"));
  await api(page, "POST", "/setup/complete", {});
  // Start from a quiet inbox: close approvals and questions earlier specs left open.
  const open = await api<InboxRow[]>(page, "GET", "/inbox");
  for (const item of open.filter((i) => i.kind === "approval" || i.kind === "question")) {
    await api(page, "POST", `/inbox/${item.id}/resolve`, { status: "dismissed" });
  }
});

test("an approval chimes, badges the favicon and keeps a sticky toast until resolved", async ({
  page,
}) => {
  const project = await projectId(page);
  await openInbox(page);
  const icon = page.locator('link[rel~="icon"]');
  const toast = page.getByTestId("attention-toast");
  await expect(icon).toHaveAttribute("href", "/favicon.svg");
  // Browsers only allow audio after a gesture; any keypress unlocks it.
  await page.keyboard.press("Shift");

  const { sessionId, approval } = await startApproval(page, project, "Check the cues");

  await test.step("the approval raises a sticky toast, a badged favicon and one chime", async () => {
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("Approval needed");
    await expect(toast.getByRole("button", { name: "Open" })).toBeVisible();
    await expect(icon).toHaveAttribute("href", /^data:image\/png;base64,/);
    await expect(icon).toHaveAttribute("data-attention", "waiting");
    await expect.poll(() => chimeNotes(page)).toBe(2);
    await page.screenshot({ path: test.info().outputPath("attention-toast.png") });
  });

  await test.step("in the background the title alternates with the waiting title", async () => {
    await page.evaluate(() => {
      document.hasFocus = () => false;
      window.dispatchEvent(new Event("blur"));
    });
    await expect(page).toHaveTitle(/^\(\d+\) ⏳ Waiting on you · CodeDen$/);
    await expect(page).toHaveTitle(/^\(\d+\) CodeDen$/);
    await page.evaluate(() => {
      document.hasFocus = () => true;
      window.dispatchEvent(new Event("focus"));
    });
    await expect(page).toHaveTitle(/^\(\d+\) CodeDen$/);
  });

  await test.step("resolving it elsewhere dismisses the toast and restores the favicon", async () => {
    await api(page, "POST", `/inbox/${approval.id}/resolve`, {
      response: { kind: "approval", decision: "allow_once" },
    });
    await expect(toast).toHaveCount(0);
    await expect(icon).toHaveAttribute("href", "/favicon.svg");
    await expect(icon).not.toHaveAttribute("data-attention");
  });

  await api(page, "POST", `/sessions/${sessionId}/stop`, {});
});

test("Open goes straight to the waiting session", async ({ page }) => {
  const project = await projectId(page);
  await openInbox(page);
  const { sessionId, approval } = await startApproval(page, project, "Open from the toast");
  const toast = page.getByTestId("attention-toast");
  await toast.getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${sessionId}$`));
  await expect(toast).toHaveCount(0);
  // Still waiting, so the favicon keeps its badge until the approval is answered.
  const icon = page.locator('link[rel~="icon"]');
  await expect(icon).toHaveAttribute("data-attention", "waiting");
  await api(page, "POST", `/inbox/${approval.id}/resolve`, {
    response: { kind: "approval", decision: "allow_once" },
  });
  await expect(icon).toHaveAttribute("href", "/favicon.svg");
  await api(page, "POST", `/sessions/${sessionId}/stop`, {});
});
