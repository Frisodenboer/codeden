---
name: UI review
description: Weekly walkthrough of the running app in the session browser with screenshots, checking layout, accessibility and console errors; files issues with screenshot evidence and fixes small defects.
trigger:
  type: cron
  expression: "0 6 * * 3"
action: start_session
workKey: automation:ui-review
title: UI review
autonomy: auto
guards:
  overlapPolicy: skip-if-running
  maxPerDay: 1
---
You are running the scheduled **UI review** of {{project.name}} ({{date}}). Review the real, running app in your session browser and report what a careful designer and an accessibility tester would flag. Every finding needs a screenshot.

## 1. Start the app
- Read the README, AGENTS.md / CLAUDE.md and `.codeden/project.json` to find the dev-server command and port. Install dependencies if needed and start the dev server in the background from your worktree.
- Open it with `browser_open_dev_server` (or `browser_navigate` to `http://localhost:<port>`). If the app cannot start, report the error with `finish` (outcome `failed`) instead of guessing.
- Call `report_progress` with the URL and the main routes you plan to visit (from the router config or navigation).

## 2. Walk the main flows
For each main page or flow (at most 8):
- `browser_navigate` to it, `browser_snapshot` to read the structure, then `browser_screenshot` with `share: true`.
- Repeat at a narrow viewport (about 375 px wide) by resizing through the page or a responsive route if the app supports it, and capture a screenshot.
- Check `browser_logs` for console errors, failed network requests and warnings.
- Interact with the primary action on the page (`browser_click`, `browser_type`) and confirm feedback appears (loading, success, error states).

Look specifically for:
- **Layout:** overflow or horizontal scrolling on narrow screens, overlapping or clipped text, misaligned elements, inconsistent spacing.
- **Accessibility:** images without alt text, buttons and inputs without accessible names (visible in the snapshot), missing focus styles, low-contrast text, headings out of order, interactive elements that are not reachable by keyboard (`browser_press` Tab).
- **States:** empty states, error states and loading states that are missing or confusing.
- **Errors:** console errors, 4xx/5xx requests, broken links or images.

## 3. Act on the findings
- **Small, clear defects** (a missing label, an overflow, a broken link): fix them, take a before and after screenshot, run the tests, and open one pull request with `create_pull_request`. Attach the screenshots with `attach_evidence` so they render in the PR.
- **Larger findings:** if the project is on GitHub, open one issue per finding with `gh issue create` labelled `ui`, then call `attach_evidence` on that issue with the screenshot and a description: the page, the viewport, steps to reproduce, expected vs actual. Search existing issues first to avoid duplicates.
- Stop the dev server when you are done.

## 4. Finish
Call `finish` with a summary table (page, finding, severity, link to issue or PR) and the number of screenshots taken.
