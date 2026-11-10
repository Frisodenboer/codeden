import { afterEach, describe, expect, it, vi } from "vitest";

type MacConfig = {
  identity?: string | null;
  notarize?: boolean;
  hardenedRuntime?: boolean;
  entitlements?: string;
  entitlementsInherit?: string;
};

const SIGNING_ENV = [
  "CSC_LINK",
  "CSC_NAME",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
] as const;

/** The mac section of electron-builder.config.mjs, evaluated with these signing variables. */
async function macConfig(env: Partial<Record<(typeof SIGNING_ENV)[number], string>>) {
  for (const name of SIGNING_ENV) vi.stubEnv(name, env[name] ?? "");
  vi.resetModules();
  // A non-literal specifier: the config is plain JavaScript without type declarations.
  const file = "../electron-builder.config.mjs";
  const config = (await import(/* @vite-ignore */ file)).default as { mac: MacConfig };
  return config.mac;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("macOS signing (electron-builder config)", () => {
  it("signs ad hoc with the hardened runtime when no Developer ID is configured", async () => {
    const mac = await macConfig({});
    // Never null: an unsigned app is reported as "damaged" once downloaded.
    expect(mac.identity).toBe("-");
    expect(mac.notarize).toBe(false);
    expect(mac.hardenedRuntime).toBe(true);
    expect(mac.entitlements).toBe("build/entitlements.mac.plist");
    expect(mac.entitlementsInherit).toBe("build/entitlements.mac.plist");
  });

  it("uses the Developer ID and notarizes when the secrets are set", async () => {
    const mac = await macConfig({
      CSC_LINK: "base64-p12",
      APPLE_ID: "dev@example.com",
      APPLE_APP_SPECIFIC_PASSWORD: "app-password",
      APPLE_TEAM_ID: "TEAMID1234",
    });
    expect(mac.identity).toBeUndefined();
    expect(mac.notarize).toBe(true);
  });

  it("signs with the Developer ID but skips notarization without the Apple account", async () => {
    const mac = await macConfig({ CSC_NAME: "Developer ID Application: Example (TEAMID1234)" });
    expect(mac.identity).toBeUndefined();
    expect(mac.notarize).toBe(false);
  });
});
