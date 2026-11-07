# CodeDen: agent guide

CodeDen is a local-first harness for coding agents. **`docs/DESIGN.md` is the locked design and the source of truth.** Read the relevant sections before changing behaviour; anything in its "Locked decisions" table needs a design discussion first.

## Layout

```
apps/
  server/     Hono server: security, SQLite event log + projections (Drizzle), UI WebSocket, RunnerClient
  runner/     Runner process: provider sessions, event journal, lock file, WebSocket protocol server
  web/        React 19 + Vite SPA (Tailwind v4, shadcn/ui, TanStack Router + Query, Zustand)
  cli/        The published `codeden` package: CLI entry, bundles server + runner + web with tsdown
packages/
  contracts/  zod schemas for everything that crosses a boundary (events, entities, protocols, settings)
  providers/  ProviderAdapter / ProviderSession interfaces, the Fake provider, Claude/Codex stubs
docs/DESIGN.md
```

Key entry points:
- Contracts: `packages/contracts/src/` (agent events `agent-events.ts`, items `items.ts`, runner protocol `runner/`, UI WebSocket `ws.ts`, persisted events `events.ts`, work/conflicts `work.ts`, factory `factory.ts`).
- Server: `apps/server/src/server.ts` (`startServer({ port, dataDir, token })`), dev entry `src/dev.ts`.
- Runner: `apps/runner/src/runner.ts` (`startRunner`), process entry `src/main.ts`.
- Web shell: `apps/web/src/components/shell/`.
- CLI: `apps/cli/src/cli.ts`.

## Commands

Node 24+ and pnpm 10 (`corepack enable`).

| Command | What it does |
|---|---|
| `pnpm install` | Install the workspace |
| `pnpm dev` | Server on 127.0.0.1:4318 (data in `.codeden-dev/`, Fake provider on) + Vite on http://localhost:5173 |
| `pnpm build` | Build the web app, then bundle `apps/cli/dist` |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm lint` / `pnpm format` | Biome check / Biome fix + format |
| `pnpm test` | Vitest across all packages (includes a server -> runner -> Fake provider end-to-end test) |
| `pnpm db:generate` | Generate a Drizzle migration after editing `apps/server/src/db/schema.ts` |
| `node apps/cli/dist/cli.js --home <dir>` | Run the built CLI (`doctor`, `stop`, `--port`, `--no-open`) |

## Conventions

- **Contracts first.** Any new message, event, entity or setting is added to `packages/contracts` (with JSDoc and a round-trip test) before it is used. Validate at boundaries with the shared schemas.
- **Plain TypeScript**, strict, ESM. **No Effect**, no clever abstractions; mainstream patterns that other agents can follow.
- **Small modules:** keep files under ~400 lines; split by concern.
- **Honest capabilities:** UI and orchestration read `ProviderCapabilities`, never branch on a provider id.
- **Events are append-only.** Projections are written in the same transaction as their event (`apps/server/src/events/`), so they can be rebuilt from the log.
- **Security:** server and runner bind 127.0.0.1 only; every request needs the install token; never log or persist tokens in transcripts.
- **Tests are required** for new behaviour (Vitest, next to the package in `test/`). Use the Fake provider, never live agent turns.
- **Never mention other harnesses or products as inspiration** anywhere: code, comments, docs, commits. Describe CodeDen on its own terms.
- **Commits:** conventional commits (`feat(server): ...`, `fix(runner): ...`, `chore: ...`), one logical change per commit. `pnpm typecheck && pnpm lint && pnpm test` must pass.
- Generated files: `apps/server/drizzle/` (migrations, via drizzle-kit) and `apps/web/src/components/ui/` (shadcn). Add shadcn components with `pnpm dlx shadcn@latest add <name>` from `apps/web`.

## Releasing

The published package is `apps/cli` (`codeden` on npm). `.github/workflows/release.yml` builds, tests, checks versions, publishes and creates a GitHub Release.

1. Bump the version in `apps/cli/package.json` **and** `CODEDEN_VERSION` in `packages/contracts/src/version.ts` (a test keeps them in sync). Commit.
2. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`. The tag must match the package version or the workflow fails.
3. The workflow publishes with `npm publish --provenance --access public` using the `NPM_TOKEN` repository secret (Settings > Secrets and variables > Actions). If the secret is missing it warns, skips publishing, and still creates the GitHub Release with the packed `.tgz`. npm provenance requires a public repository.
4. To rehearse, run the workflow manually (Actions > Release > Run workflow) with **dry run** on: it builds and packs and uploads the tarball as an artifact, without publishing.
