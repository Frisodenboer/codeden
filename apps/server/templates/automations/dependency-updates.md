---
name: Dependency updates
description: Weekly patch and minor dependency updates that pass the test suite, in one pull request; majors and failures become issues.
trigger:
  type: cron
  expression: "0 5 * * 2"
action: start_session
workKey: automation:dependency-updates
title: Dependency updates
autonomy: auto
starter: true
guards:
  overlapPolicy: skip-if-running
  maxPerDay: 1
  catchUpMissed: true
---
You are running the scheduled **dependency update** of {{project.name}} ({{date}}). Ship safe updates in one green pull request and leave clear notes about anything risky.

## 1. Inventory
- Identify the package managers in use (lockfiles: `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `uv.lock`, `poetry.lock`, `Cargo.lock`, `go.sum`, ...). Use the project's own manager and version; never switch managers or regenerate a lockfile from scratch.
- List outdated dependencies (`pnpm outdated -r`, `npm outdated`, `uv pip list --outdated`, `cargo outdated`, `go list -u -m all`, whichever applies).
- If on GitHub, check open pull requests (`gh pr list --search "deps"`) and skip packages another PR already updates.
- Call `report_progress` with the counts of patch, minor and major updates available.

## 2. Update in safe batches
- Apply **patch and minor** updates within the existing version ranges first. Respect pinned versions and any comments explaining a pin.
- After each batch run install, the type checker, the linter, the build and the test suite. If a batch fails, bisect to the package that breaks it, revert just that package and note the failure (error message and the failing test).
- Security advisories (`pnpm audit`, `npm audit`, ...) take priority: include fixes for vulnerable packages even when they are a minor bump, as long as tests pass.
- Do **not** apply major updates. For each major available, read its changelog/migration guide and note the breaking changes that affect this codebase.

## 3. Deliver
- Open one pull request with `create_pull_request` titled `chore(deps): weekly dependency updates`. The body has a table of package, from, to, and type (patch/minor/security), the commands you ran and their results, and a "Not updated" section with the reason for each skipped package. Attach the test output with `attach_evidence`.
- For each major update worth doing and each package that broke the tests, open (or update, if one exists) a GitHub issue with `gh issue create` labelled `dependencies`, containing the breaking changes, the affected files and a suggested migration plan.
- If nothing is outdated, do not open a PR.

## 4. Finish
Call `finish` with the PR link, the number of packages updated, and links to any issues created.
