---
name: Security audit
description: Weekly review of the code, configuration and dependencies for vulnerabilities, leaked secrets and unsafe patterns. Files one issue per confirmed finding and fixes the small ones.
trigger:
  type: cron
  expression: "0 3 * * 1"
action: start_session
workKey: automation:security-audit
title: Security audit
autonomy: auto
starter: true
guards:
  overlapPolicy: skip-if-running
  maxPerDay: 1
  catchUpMissed: true
---
You are running the scheduled **security audit** of {{project.name}} ({{date}}). Work only inside your worktree. Your goal is a short list of confirmed, actionable findings, not a long list of maybes.

## 1. Orient (10 minutes at most)
- Read the README, AGENTS.md / CLAUDE.md and `.codeden/notes.md` if they exist, to learn the stack, how to run the tests and the project's conventions for issues and PRs.
- Find the entry points that handle untrusted input: HTTP routes, CLI arguments, file uploads, webhooks, message queues, anything parsing user-supplied data.
- Call `report_progress` with a one-line plan.

## 2. Look for real problems
Check each of these and note file:line evidence for anything you find:
- **Secrets:** API keys, tokens, private keys or passwords committed in code, config, fixtures or history of recently changed files (`git log -p -S` for suspicious strings). Never print a secret in full in any output; show the first 4 characters only.
- **Injection:** SQL built by string concatenation, shell commands built from input (`exec`, `spawn` with `shell: true`, `child_process`), path traversal (`..` reaching `fs` calls), template injection, `eval`/`new Function`, unsafe deserialization.
- **AuthN/AuthZ:** routes missing authentication or ownership checks, insecure session/cookie flags, tokens compared without constant-time comparison, permissive CORS with credentials.
- **Web:** XSS through `dangerouslySetInnerHTML` / `innerHTML` / unescaped templates, missing CSRF protection on state-changing requests, open redirects, SSRF via user-controlled URLs.
- **Dependencies:** run the ecosystem's audit (`pnpm audit --prod`, `npm audit --omit=dev`, `pip-audit`, `cargo audit`, `govulncheck`, whichever applies and is installed). Only report advisories that affect code paths actually used.
- **Configuration:** debug mode in production config, servers binding 0.0.0.0 without need, overly broad file permissions, disabled TLS verification.

Discard anything you cannot point to in the code. Rate each confirmed finding: critical / high / medium / low, with a one-sentence exploit scenario.

## 3. Act on the findings
- **Small, safe fixes** (an obvious missing escape, a dependency patch bump with no breaking changes, a flag): fix them on your branch, add or update a test that proves the fix, run the test suite, and open one pull request with `create_pull_request`. The PR body lists each fix with the file, the risk and how it was verified.
- **Everything else:** if the project is on GitHub, open one issue per finding with `gh issue create` using the label `security` (create it if missing). Each issue has: severity, affected files with line numbers, the exploit scenario, and a suggested fix. Do not include working exploit code or full secrets. Before creating an issue, search open issues (`gh issue list --search`) to avoid duplicates.
- Attach the audit command output as evidence with `attach_evidence` on the PR when you open one.
- If the project has no GitHub remote, put the findings in your final summary instead.

## 4. Finish
Call `finish` with outcome `success` (or `partial` if a tool could not run), a summary listing counts by severity, and links to every issue and PR you created. If nothing was found, say which areas you checked so the next audit can go deeper elsewhere.
