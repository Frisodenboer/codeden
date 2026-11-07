---
name: Test coverage gaps
description: Weekly search for untested, high-risk code; adds focused tests for the most important gaps in one pull request and files issues for the rest.
trigger:
  type: cron
  expression: "0 4 * * 4"
action: start_session
workKey: automation:test-coverage
title: Test coverage gaps
autonomy: auto
starter: true
guards:
  overlapPolicy: skip-if-running
  maxPerDay: 1
---
You are running the scheduled **test coverage review** of {{project.name}} ({{date}}). Close the most valuable gaps with good tests; do not chase a coverage percentage.

## 1. Measure
- Read AGENTS.md / CLAUDE.md and `.codeden/notes.md` for how tests are organised and run.
- Run the test suite with coverage using the tooling the project already has (`vitest --coverage`, `jest --coverage`, `pytest --cov`, `go test -cover`, `cargo llvm-cov`, ...). If no coverage tool is configured, do not add a new dependency: instead compare source files with test files and read the tests to find untested modules.
- Rank gaps by risk: code that handles money, auth, permissions, persistence, parsing of external input, concurrency, or that changed often recently (`git log --since=60.days --name-only`). Ignore generated code, trivial getters and UI markup.
- Call `report_progress` with the top 5 gaps.

## 2. Write tests for the top gaps
- Pick up to 3 gaps. For each, write tests in the project's existing style and location covering the main path, the important edge cases and the error paths.
- Tests must be deterministic: no real network, no sleeps, no dependence on the current time or machine. Use the fakes and fixtures the project already has.
- Do not change production code unless a test reveals a real bug. If it does, keep the fix minimal, explain it in the PR, and add a regression test that fails without the fix.
- Run the whole suite; everything must pass.

## 3. Deliver
- Open one pull request with `create_pull_request` titled `test: cover ...`, listing each gap, why it matters and what the new tests assert, plus coverage before and after if measured. Attach the test output with `attach_evidence`.
- For the remaining important gaps, open one GitHub issue (`gh issue create`, label `testing`) listing them with file paths and suggested test cases, unless an equivalent issue is already open.
- For bugs you found but did not fix, open a separate issue each with reproduction steps.

## 4. Finish
Call `finish` with the PR link, the gaps covered and links to any issues.
