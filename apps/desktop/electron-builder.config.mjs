// electron-builder configuration for the CodeDen desktop app (§17). Used by
// scripts/package.mjs, which first stages the app (dist + runtime dependencies) in .stage/app.
//
// Code signing is optional and driven by environment variables, so builds without secrets are
// simply unsigned:
//   Windows: CSC_LINK + CSC_KEY_PASSWORD (or WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD), a .pfx.
//   macOS:   CSC_LINK + CSC_KEY_PASSWORD (a Developer ID Application .p12); notarization with
//            APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID.
// An unsigned macOS app can't update itself; an unsigned Windows installer shows SmartScreen.

const macSigning = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
const notarize = Boolean(
  macSigning &&
    process.env.APPLE_ID &&
    process.env.APPLE_APP_SPECIFIC_PASSWORD &&
    process.env.APPLE_TEAM_ID,
);

/** @type {import("electron-builder").Configuration} */
export default {
  appId: "dev.codeden.app",
  productName: "CodeDen",
  copyright: "Copyright © 2026 Leon van Zyl",
  directories: { app: ".stage/app", output: "release", buildResources: "build" },
  // The runner and server are started from files on disk with the app's binary as Node.js;
  // keeping them out of an asar archive keeps native modules and playwright-core simple.
  asar: false,
  // Native modules are Node-API (node-pty, @napi-rs/keyring): no rebuild for Electron needed.
  npmRebuild: false,
  files: ["**/*", "!**/*.map", "!**/*.d.ts"],
  protocols: [{ name: "CodeDen", schemes: ["codeden"] }],
  publish: [{ provider: "github", owner: "leonvanzyl", repo: "codeden", releaseType: "release" }],
  electronFuses: {
    // The server and runner run on the app's binary as Node.js (ELECTRON_RUN_AS_NODE).
    runAsNode: true,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    onlyLoadAppFromAsar: false,
  },
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    executableName: "CodeDen",
  },
  nsis: {
    // Per-user install: no admin prompt, installs to %LOCALAPPDATA%\Programs\CodeDen.
    oneClick: true,
    perMachine: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "CodeDen",
    deleteAppDataOnUninstall: false,
    artifactName: "CodeDen-Setup-${version}.${ext}",
  },
  mac: {
    target: [
      { target: "dmg", arch: ["arm64", "x64"] },
      // The zip is what the updater downloads on macOS.
      { target: "zip", arch: ["arm64", "x64"] },
    ],
    category: "public.app-category.developer-tools",
    hardenedRuntime: true,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    identity: macSigning ? undefined : null,
    notarize,
    extendInfo: { NSMicrophoneUsageDescription: "CodeDen uses the microphone for dictation." },
    artifactName: "CodeDen-${version}-${arch}.${ext}",
  },
  dmg: { artifactName: "CodeDen-${version}-${arch}.${ext}" },
  linux: {
    target: ["AppImage", "deb"],
    category: "Development",
    executableName: "codeden",
    synopsis: "A local-first harness for coding agents",
    maintainer: "Leon van Zyl",
    artifactName: "CodeDen-${version}-${arch}.${ext}",
  },
  deb: { artifactName: "codeden_${version}_${arch}.${ext}" },
};
