# PR #1 — merged-main validation

Session: `81c49ab2-6d5b-4c9b-a481-27e274b246b7`.
Repository: `Frisodenboer/codeden` (explicit on every GitHub CLI command).
PR: https://github.com/Frisodenboer/codeden/pull/1
Branch: `codeden/security-and-patch-dependency-batch-81c4`.
Original tested head: `b47f292e53b0d62540d19a2e54e6c08e9b094dd1`.
Fetched/merged base: `08329a8ea035aed027b4c93a318810c184d8a295`.
Protected local/remote main at resume: `08329a8ea035aed027b4c93a318810c184d8a295`.
Node `24.22.3`, existing Corepack pnpm `10.12.1`; no runtime/global install.

## Merge resolution

An ordinary non-rewriting merge of `origin/main` into the PR branch had three conflicts:

- Runner manifest: retained main's `@modelcontextprotocol/sdk@1.32.2` and `cross-spawn@7.0.6`, alongside this batch's Hono/node-server patches.
- Lockfile: retained those added importer entries and the security versions; `pnpm install` verified it up-to-date. Package-key comparison against merged main finds only scoped package families changed.
- Changelog: removed only our eight historical Unreleased lines, preserving main's complete changelog and release notice byte-for-byte. Converted our notes into `changes/1-security-dependency-patches.md` and `changes/1-build-tool-patches.md`, per current AGENTS.md and changes/README.md.

Preserved main's CLI/desktop/contracts version 0.7.1, all new providers and new test configuration/harness. The approved LAN fixture correction remains necessary and intact. No test assertions, security checks or skip conditions were weakened. No workflows or repository settings were edited.

## Versions versus merged main

| Dependency | Main | PR |
|---|---|---|
| ws, shared importers/transitives | 8.22.1 | 8.23.0 |
| hono, shared importers/transitives | 4.13.17 | 4.13.18 |
| @hono/node-server | 2.1.6 | 2.1.8 |
| Electron | 45.2.3 | 45.3.2 |
| electron-updater | 6.8.11 | 6.8.12 |
| electron-builder | 26.18.0 | 26.18.1 |
| electron-builder-squirrel-windows | 26.18.0 auto peer | 26.18.1 explicit dev peer |
| builder-util-runtime, transitive | 9.7.0 | 9.7.1 |
| Vite | 8.3.6 | 8.3.8 |
| Biome and both schema URLs | 2.6.6 | 2.6.7 |

Claude SDK stays synchronized at 0.3.318 in package and installer; the 0.3.325 permission-behavior change remains deferred. Node24, pnpm10, Drizzle, Playwright and Codex protocol stay unchanged. No unrelated dependency bumps.

## Final local gates

- `corepack pnpm install`: PASS; existing final lockfile/install state coherent.
- `corepack pnpm lint`: PASS, 1561 files.
- `corepack pnpm typecheck`: PASS, seven workspace packages.
- `CODEDEN_REQUIRE_CLI_DIST=1 corepack pnpm test`: PASS, exit 0; **2795 passed, 50 existing conditional skips, zero failures** (362 passed / 11 skipped files, 209.02s). Used current main's test config and automatic busy-machine conventions, without a custom worker override. Removed inherited CODEDEN_DEPS_INSTALLER and CODEDEN_LIVE only in test child; used an isolated test home. No live provider turns.
- `corepack pnpm build`: PASS, web/CLI/desktop.
- `node .codeden-dev/security-batch/revalidation/packed-smoke.mjs`: PASS, packed CLI 0.7.1 excludes SDK code, installs in a fresh worktree-local install, loads terminal/keychain native modules, installs/imports pinned SDK in an isolated home without platform binaries, starts health/authenticated UI/templates, and stops server/runner. No installed app/live home changes.
- `corepack pnpm --filter @codeden/desktop package --dir`: PASS, source-only Windows unpacked build (Electron45.3.2/builder26.18.1).
- `corepack pnpm --filter @codeden/desktop e2e`: PASS, all three existing Windows desktop tests: native browser/relay, lifecycle and local update feed. Worktree-local TEMP/TMP/LOCALAPPDATA updater cache and isolated homes; 1.6m.
- `corepack pnpm test:slow --maxWorkers 2`: PASS, exit0, 13 files / 73 tests, no skips, 119.96s. Existing node-pty child emitted `AttachConsole failed`; every assertion passed despite that warning.
- `git diff --check` and staged check: PASS; no unresolved conflict markers.

Main's current config handles process-heavy suites with documented generous deadlines; this branch does not change those settings. The old pre-merge timing failures remain in original evidence, and are not claimed as final results. Current full-suite warnings include jsdom scrollTo/canvas stubs; no assertion failures. Desktop unsigned packaging warnings are expected for this test artifact. macOS/Linux desktop smoke was not run on this Windows host.

## Audit comparison

Original before/after audit files and original PR evidence are preserved. Refreshed root `corepack pnpm audit --json` and `corepack pnpm audit --prod --json` use the final merged lockfile/install state. UTF-8 machine-readable copies are alongside this report.

| Scope/state | Critical | High | Moderate | Low | Info |
|---|---:|---:|---:|---:|---:|
| Original all baseline | 0 | 0 | 2 | 1 | 0 |
| Original all final | 0 | 0 | 2 | 1 | 0 |
| Merged all final | 0 | 0 | 2 | 1 | 0 |
| Production, original before/after and merged final | 0 | 0 | 0 | 0 | 0 |

All-dependency audit exit1 denotes these known findings; production exit0. **No audit-feed advisory IDs disappeared, and no critical/high is reported.** Do not confuse unchanged feed counts with separately verified newer upstream fixes absent from the feed:

- ws [GHSA-37g9-w4hg-h9qr](https://github.com/websockets/ws/security/advisories/GHSA-37g9-w4hg-h9qr), high, fixed by8.23.0; no older ws remains.
- [Hono4.13.18](https://github.com/honojs/hono/releases/tag/v4.13.18): GHSA-92p4-j3wq-jmqx (completes GHSA-4h7h-rv7c-7m2v), GHSA-39q9-qp46-w8xg, GHSA-h25j-2p75-qj33, GHSA-74fm-fwc7-3fwp. No older Hono/node-server remains.
- [Updater6.8.12](https://github.com/electron-userland/electron-builder/releases/tag/electron-updater%406.8.12): redirect credential stripping, redirect limit/protocol hardening and block-map fixes; builder-util-runtime9.7.1 only.
- [Electron45.3.2](https://github.com/electron/electron/releases/tag/v45.3.2): upstream engine/security fixes, embedded Node24 retained.

Remaining development-tool exceptions:

- Low GHSA-gcqx-w48m-w2h4, deepmerge4.3.1: `apps__web>shadcn>deepmerge`; no published fixed version.
- Moderate GHSA-g3hv-75wg-m249, minimatch9.0.9: `apps__desktop>electron-builder>app-builder-lib>@electron/universal>minimatch`; and minimatch10.2.6: `apps__desktop>electron-builder>app-builder-lib>minimatch`. Fix >=11.0.1 expands consumer major ranges; no unvalidated major override. Build/component-generation tooling rather than shipped runtime dependencies.

## Commit, remote and CI

Final tested/pushed merge commit: `a4e53e79a57dfceab2d18e3817485e6af19e8e53` (`chore(deps): merge main and migrate batch release notes`). Parents: original PR head `b47f292e53b0d62540d19a2e54e6c08e9b094dd1` and fetched main `08329a8ea035aed027b4c93a318810c184d8a295`. Tested index tree and committed tree: `51af0360e724c56d091d9084504763f65e2ba509`. Normal push only to the PR branch succeeded; `git ls-remote` confirms exact tested/remote SHA equality. Both local main and remote main remained `08329a8ea035aed027b4c93a318810c184d8a295`; tracked worktree clean.

Re-read workflow418218513 metadata: active, CI, `.github/workflows/ci.yml`. Exactly one authorized manual dispatch was made for the PR branch after verifying its GitHub head SHA. Response: `HTTP/2.0 204 No Content`, request ID `D048:30D5D5:457ABC2:6A3DB66:6AF84384`. No Release dispatch, rerun or retry. Run `43589390949`, event `workflow_dispatch`, created `2026-11-14T11:18:29Z`, **completed with conclusion success**; its `head_sha` matches final tested commit `a4e53e79a57dfceab2d18e3817485e6af19e8e53`. URL: https://github.com/Frisodenboer/codeden/actions/runs/43589390949 . All required jobs completed successfully: **Detect changes**, **Build, test and install**, **CI result**. Build/test/install includes frozen installation, typecheck, lint, tests, build, self-update fixture and packed CLI install/start. This supersedes the historical CI registration blocker.

PR #1 verified **open, ready for review (`draft: false`), mergeable, clean**, base `main` at `08329a8ea035aed027b4c93a318810c184d8a295`, head `a4e53e79a57dfceab2d18e3817485e6af19e8e53`, `merged_at: null`. Final local/remote main refs still equal the resume snapshot. Tracked worktree remains clean. Merge is left entirely to the USER; no main, repository settings, credential or installed app changes.
