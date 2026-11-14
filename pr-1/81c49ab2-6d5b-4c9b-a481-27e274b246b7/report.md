# Security and patch dependency batch — 2026-11-14

Session: `81c49ab2`. Branch: `codeden/security-and-patch-dependency-batch-81c4`.
Clean baseline HEAD: `8a05e5c2117b8ee5794f75538953a92e8f51b1ae`.
Runtime: Node `v24.22.3`, existing Corepack pnpm `10.12.1` (project-pinned).
Read AGENTS.md and DESIGN §§3–7, 15–18. No locked design decisions changed.

## Versions

| Dependency | Before | After |
|---|---|---|
| ws (all importers/transitives) | 8.22.1 | 8.23.0 |
| hono (all importers/transitives) | 4.13.17 | 4.13.18 |
| @hono/node-server | 2.1.6 | 2.1.8 |
| electron | 45.2.3 | 45.3.2 |
| electron-updater | 6.8.11 | 6.8.12 |
| electron-builder | 26.18.0 | 26.18.1 |
| electron-builder-squirrel-windows | 26.18.0 (auto peer) | 26.18.1 (explicit dev peer) |
| builder-util-runtime (transitive) | 9.7.0 | 9.7.1 |
| vite | 8.3.6 | 8.3.8 |
| @biomejs/biome | 2.6.6 | 2.6.7 |

The builder companion pin aligns app-builder-lib's exact auto-installed peer and avoids retaining the old builder/runtime tree. Both Biome schema URLs follow the CLI patch. Vite's Rolldown dependency resolves to compatible 1.2.19. Other direct dependencies are unchanged.

## Audit results

`corepack pnpm audit --json` and `corepack pnpm audit --prod --json` at workspace root; these are workspace-wide, no unsupported `-r` used. Audit exit 1 for all dependencies means findings, not command failure; production exits 0.

| Scope/state | Critical | High | Moderate | Low | Info | Dependency count |
|---|---:|---:|---:|---:|---:|---:|
| All before | 0 | 0 | 2 | 1 | 0 | 1103 |
| All after | 0 | 0 | 2 | 1 | 0 | 1104 |
| Production before | 0 | 0 | 0 | 0 | 0 | 470 |
| Production after | 0 | 0 | 0 | 0 | 0 | 470 |

Audit feed advisories resolved: **none**. The baseline and final responses contain the same two advisory IDs and three affected package/version findings:

- Low [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4): deepmerge 4.3.1 at `apps__web>shadcn>deepmerge`. No published patched version. Development UI-generation tooling, not shipped runtime code.
- Moderate [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249): minimatch 9.0.9 at `apps__desktop>electron-builder>app-builder-lib>@electron/universal>minimatch`, and 10.2.6 at `apps__desktop>electron-builder>app-builder-lib>minimatch`. Upstream patched range is >=11.0.1, outside both consumers' major ranges. Deferred rather than forcing an unvalidated transitive major override. Build-time packaging with repository-controlled glob patterns; not included in the shipped app's runtime dependency set.

**No critical/high findings remain in either audit.** Audit coverage alone is insufficient: the following newer upstream security fixes were verified separately because the audit response did not list them even before the update:

- ws [GHSA-37g9-w4hg-h9qr](https://github.com/websockets/ws/security/advisories/GHSA-37g9-w4hg-h9qr), high: unbounded automatic Pong buffering / memory exhaustion. [8.23.0 release](https://github.com/websockets/ws/releases/tag/8.23.0) fixes it; only ws 8.23.0 remains in the lockfile.
- Hono [4.13.18 security release](https://github.com/honojs/hono/releases/tag/v4.13.18): GHSA-92p4-j3wq-jmqx (Content-Type validation, completes GHSA-4h7h-rv7c-7m2v), GHSA-39q9-qp46-w8xg (bodyLimit memory exhaustion), GHSA-h25j-2p75-qj33 (mount path forwarding), GHSA-74fm-fwc7-3fwp (serveStatic double decode). Only 4.13.18 remains.
- [node-server 2.1.8](https://github.com/honojs/node-server/releases/tag/v2.1.8) fixes streaming cancellation and request duplex handling.
- [electron-updater 6.8.12](https://github.com/electron-userland/electron-builder/releases/tag/electron-updater%406.8.12): cross-origin redirect credential stripping, redirect limit/protocol validation and block-map fixes, with builder-util-runtime 9.7.1.
- [electron-builder 26.18.1](https://github.com/electron-userland/electron-builder/releases/tag/electron-builder%4026.18.1): compatible packaging dependency patches.
- [Electron 45.3.2](https://github.com/electron/electron/releases/tag/v45.3.2): Chromium 156.0.8078.100 and upstream engine/security fixes; remains on Electron 45 and embedded Node 24.

Official npm metadata was queried on 2026-11-14 for the highest stable version in each approved line. The builder/updater releases are stable (`prerelease: false`) on the official `v26` dist-tag despite `latest` still pointing at the previous versions.

## SDK deferral

Claude SDK remains 0.3.318 in both the package manifest and CLAUDE_SDK_VERSION. Latest stable 0.3.x is [0.3.325](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.325), whose release changes sandboxed command auto-approval, permission handling for read-only git outside trusted directories, canUseTool suggestions and SDK types. Those behavioral changes create material compatibility risk for this patch batch; defer to a dedicated adapter review. No protocol regeneration or live provider turns.

## Validation environment and original attempts

- `pnpm` was not on PATH. Existing `corepack pnpm` worked after authorized access to its cache; no global/runtime installation or credential changes.
- Initial full test attempt inherited `CODEDEN_DEPS_INSTALLER=registry` from the desktop app. Five SDK installer tests failed because this overrides their fake npm. Interrupted; preserved `test.log`.
- Removed only that environment override in the test subprocess and set CODEDEN_HOME to a worktree-local test home. The next unbounded run hit multiple existing five-second process/API test timeouts and one LAN-request failure. Interrupted; preserved `test-final.log`.
- Two-worker full-suite rerun (`corepack pnpm test --maxWorkers 2`): exit 1; 3 failed / 209 passed / 10 existing skipped files, 4 failed / 1540 passed / 34 existing skipped tests. Failures: one Codex model-discovery 300ms startup limit, two automation cases (first hit its existing 5s wait, next depended on its state), and the LAN fixture issue below. Preserved `test-bounded.log`. A diagnostic single-worker run of the first two files passed all 22 tests with unchanged timeouts/assertions (`process-diagnostic.log`).
- The unchanged LAN fixture chose the first OS IPv4 adapter, `vEthernet (WSL (Hyper-V firewall))`. CodeDen's existing `listAddresses` intentionally excludes host-only virtual interfaces, so the security middleware correctly returned 403. PM approved the concrete minimal test-only patch: choose a non-local entry from `listAddresses(0)` instead. No production Host/Origin checks changed. All four LAN tests actually executed and passed on an eligible interface (no skip), including real remote sign-in, WebSocket and revocation assertions (`network-final.log`).
- Final full-suite command is `corepack pnpm test --maxWorkers 1`, with CODEDEN_HOME in this worktree, CODEDEN_REQUIRE_CLI_DIST=1, and the inherited CODEDEN_DEPS_INSTALLER removed only from the child environment. PASS, exit 0: 212 passed / 10 existing conditional skipped files; 1544 passed / 34 existing conditional skipped tests; zero failures, 546.23s. No assertions, added skips, timeouts or committed concurrency/configuration were changed. Full output is `test-validated.log`; original attempts are preserved. Residual sensitivity: existing short process deadlines failed under concurrent jobs/two workers and passed with one; CI must independently pass.
- Existing slow suite: `corepack pnpm test:slow --maxWorkers 2`; isolated home, Fake providers. PASS: 11 files, 55 tests, exit 0. A node-pty child logged `AttachConsole failed` but every assertion passed.
- Existing Windows desktop suite: `corepack pnpm --filter @codeden/desktop e2e`. Initial attempt passed native-browser and lifecycle checks but the update test failed during temporary-directory cleanup with EPERM; preserved initial log and error context. Reran unchanged tests with TEMP/TMP inside the worktree and worktree-local LOCALAPPDATA (Corepack still uses its existing cache): PASS, 3/3 tests, exit 0, 1.0m. All run on the source-built app with isolated homes; no installed app or live user home touched.
- Packed CLI smoke uses worktree-local tarball, install, npm cache and a fresh home. PASS: SDK exclusion, native terminal/keychain modules, SDK 0.3.318 on-demand install/import without platform binaries, health/authenticated UI/templates, and shutdown. Initial helper attempts needed to accommodate prepack stdout, remove a desktop-only `--fake` flag and use a fresh home after testing SDK installation; no production code changed.

## Final checks

- lint: PASS (1147 files, no findings).
- typecheck: PASS (all seven workspace packages).
- build: PASS (web, CLI and desktop).
- Windows unpacked packaging: PASS (45.3.2 / builder 26.18.1, unsigned test artifact).
- all/prod audits: completed as above; known dev-only exceptions remain.
- Packed CLI, 55 slow tests and all 3 desktop E2E checks: PASS.
- Full tests: PASS as above, including required built CLI integration coverage. Existing conditional skips are reported rather than counted as executed passes; Windows-only desktop and installed-browser slow checks were run separately and passed.
- Tested commit: `b47f292e53b0d62540d19a2e54e6c08e9b094dd1` (`chore(deps): apply security and patch updates`). The staged tree checked before commit and committed tree are both `9eb91a1048dd61c55a291d7f1caf13754ba5c785`; tracked worktree is clean.
- PR: https://github.com/Frisodenboer/codeden/pull/1 . `git ls-remote origin refs/heads/codeden/security-and-patch-dependency-batch-81c4` confirms remote SHA equals the tested commit exactly. Tracked worktree is clean. PR is draft for CI handoff, not merged.
- **CI NOT RUN / HANDOFF BLOCKER:** GitHub's status API reports no checks; branch run listing is empty. Read-only `GET repos/Frisodenboer/codeden/actions/permissions` succeeds and reports `enabled: true`, `allowed_actions: all`. `GET .../actions/workflows` succeeds and reports `total_count: 0`. `GET .../contents/.github/workflows/ci.yml` succeeds (SHA `9e3c9d2f4f2129d5a863e3e3170af0595e9ba3e3`); the file defines both `pull_request` and `workflow_dispatch`, so the PR has a matching trigger. An explicit validation-only dispatch, `gh workflow run ci.yml --repo Frisodenboer/codeden --ref codeden/security-and-patch-dependency-batch-81c4`, fails with `HTTP 404: workflow ci.yml not found on the default branch (https://api.github.com/repos/Frisodenboer/codeden/actions/workflows/ci.yml)`. This is an unavailable/unregistered-workflow condition, not passing or pending CI, not Actions disabled and not an observed read-API permission denial. The underlying reason GitHub has not registered the existing file is not established. No repository Actions/permission/branch protection settings or main were changed. Factory/orchestrator must resolve workflow availability and obtain CI success at the exact tested SHA before merge.

No merge, main update, publish, release, deploy, installed app changes, credential/account changes or Node 26 migration.
