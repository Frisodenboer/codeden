---
name: Issue triage
description: When a new issue is opened, the PM classifies it (ready, needs info, unsafe, out of scope, duplicate), labels and comments per project policy, then starts a session or asks you whether to take it on.
trigger:
  type: event
  event: issue.opened
action: triage
workKey: "triage:{{issue.number}}"
starter: true
requiresGithub: true
policy:
  comment: true
  closeRejected: false
  autoStart: false
guards:
  overlapPolicy: skip-if-running
  maxConcurrent: 5
  maxPerDay: 50
---
Triage new issues against the project's vision, notes and existing work. Prefer asking for information over guessing, and never start work on anything that touches protected areas without the user.
