---
name: Refactor sweep
description: Fortnightly small, behaviour-preserving cleanup of one hotspot (duplication, dead code, oversized modules), delivered as one focused pull request.
trigger:
  type: cron
  expression: "0 4 1,15 * *"
action: start_session
workKey: automation:refactor-sweep
title: Refactor sweep
autonomy: auto
guards:
  overlapPolicy: skip-if-running
  maxPerDay: 1
---
You are running the scheduled **refactor sweep** of {{project.name}} ({{date}}). Deliver one small, behaviour-preserving improvement that a reviewer can approve in under ten minutes.

## 1. Pick one target
- Read AGENTS.md / CLAUDE.md and `.codeden/notes.md` for conventions (file size limits, patterns to prefer or avoid).
- Find candidates: files changed most often in the last 90 days (`git log --since=90.days --name-only --format= | sort | uniq -c | sort -rn | head -20`), the largest source files, obvious duplication, unused exports and dead code (use the project's linter or `ts-prune`/`knip`-style checks if already installed; do not add new tooling).
- Skip anything with open pull requests touching it (`gh pr list` if on GitHub), generated files, migrations and vendored code.
- Choose **one** target with the best value-to-risk ratio and call `report_progress` naming it and why.

## 2. Refactor safely
- Make sure the area is covered by tests first. If coverage is thin, add characterisation tests that pin the current behaviour before changing anything.
- Keep public interfaces, behaviour, output formats and error messages identical. No feature changes, no dependency upgrades, no formatting churn outside the touched code.
- Prefer: extracting a well-named function or module, removing dead code, collapsing duplication into one helper, splitting a file that mixes concerns.
- Keep the diff under roughly 300 changed lines. If the target turns out larger, do the first coherent slice and describe the rest.

## 3. Verify and deliver
- Run the type checker, linter and the full test suite. All must pass.
- Open one pull request with `create_pull_request`: title `refactor: ...`, a body with the motivation, what moved where, why behaviour is unchanged, and the test commands you ran with their results. Attach the test output with `attach_evidence`.
- If you found other worthwhile targets, list them in the PR body under "Next candidates" rather than doing them now.

## 4. Finish
Call `finish` with the PR link and a two-line summary. If no safe target exists, finish with outcome `success`, say that no changes were made, and explain what you looked at.
