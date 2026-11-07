import type { AnyServerTool } from "../../define";
import { createIssue, getIssue, getPrStatus, listIssues, triageIssue } from "./github";
import { messageOrchestrator, readProjectNotes, updateProjectNotes } from "./notes";
import { listSessions, messageSession, startSession, stopSession } from "./sessions";
import {
  cancelQueuedRun,
  getProjectStatus,
  listScheduledRuns,
  pauseAutomation,
  resumeAutomation,
  skipNextRun,
} from "./status";

/** Project manager tools (§8.3, §8.4). `ask_user` is shared with agents (`../ask-user`). */
export const pmTools: AnyServerTool[] = [
  getProjectStatus,
  listSessions,
  startSession,
  messageSession,
  stopSession,
  listScheduledRuns,
  skipNextRun,
  pauseAutomation,
  resumeAutomation,
  cancelQueuedRun,
  messageOrchestrator,
  readProjectNotes,
  updateProjectNotes,
  listIssues,
  getIssue,
  triageIssue,
  createIssue,
  getPrStatus,
];
