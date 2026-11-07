import { expect, test } from "@playwright/test";
import { NEXT_VERSION, startUpdateEnv, type UpdateEnv } from "./support/update-env";

/**
 * One-click self-update (§16): a published-style CodeDen sees a newer version on a local fake
 * registry, installs it with npm on "Update now", restarts into it and the page reconnects.
 */
let env: UpdateEnv;

test.beforeAll(async () => {
  env = await startUpdateEnv();
  const res = await fetch(`${env.origin}/api/setup/complete`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.token}`, "content-type": "application/json" },
    body: "{}",
  });
  expect(res.ok).toBe(true);
});

test.afterEach(async ({ page: _ }, info) => {
  // Both server versions write here: the first thing to read when the hand-over fails.
  if (info.status !== info.expectedStatus) console.log(env.log());
});

test.afterAll(async () => {
  await env?.stop();
});

test("banner -> What's new -> Update now -> reconnects to the new version", async ({ page }) => {
  test.setTimeout(240_000);
  const banner = page.getByTestId("update-banner");

  await test.step("the banner offers the newer version on open", async () => {
    await page.goto(env.launchUrl);
    await expect(banner).toHaveAttribute("data-state", "available");
    await expect(banner).toContainText(`CodeDen ${NEXT_VERSION} is available.`);
    await expect(banner).toContainText(`You're on ${env.current}.`);
  });

  await test.step("What's new shows the release notes", async () => {
    await banner.getByRole("button", { name: "What's new" }).click();
    const dialog = page.getByTestId("whats-new");
    await expect(dialog).toContainText(`What's new in CodeDen ${NEXT_VERSION}`);
    await expect(dialog).toContainText("One-click updates.");
    await page.keyboard.press("Escape");
  });

  await test.step("Update now installs, restarts and reloads on the new version", async () => {
    await banner.getByRole("button", { name: "Update now" }).click();
    await expect(banner).toHaveAttribute("data-state", /installing|restarting/);
    await expect(banner).toHaveAttribute("data-state", "updated", { timeout: 180_000 });
    await expect(banner).toContainText(`CodeDen updated to ${NEXT_VERSION}.`);
    const health = await (await page.request.get(`${env.origin}/api/health`)).json();
    expect(health.version).toBe(NEXT_VERSION);
    await banner.getByRole("button", { name: "Dismiss" }).click();
    await expect(banner).toHaveCount(0);
  });

  await test.step("the cookie still works and About lists both versions", async () => {
    await page.goto(`${env.origin}/settings/about`);
    await expect(page.getByText(`v${NEXT_VERSION}`)).toBeVisible();
    await expect(page.getByTestId("installed-versions")).toContainText(`${NEXT_VERSION} (current)`);
    await expect(page.getByRole("button", { name: `Roll back to ${env.current}` })).toBeVisible();
    expect(env.log()).toContain(`CodeDen ${NEXT_VERSION} is running at`);
  });
});
