import { type Automation, WorkKey } from "@codeden/contracts";
import { badRequest } from "../errors";
import { cronError, isValidTimezone } from "./cron";

/** The fields `validateAutomation` checks. */
export type ValidatedFields = Pick<Automation, "trigger" | "action" | "workKey">;

/** Reject cron expressions croner cannot parse, unknown timezones and malformed work keys. */
export function validateAutomation(a: ValidatedFields): void {
  if (a.trigger.type === "cron") {
    if (a.trigger.timezone && !isValidTimezone(a.trigger.timezone)) {
      throw badRequest(`Unknown timezone ${a.trigger.timezone}`, "invalid_timezone");
    }
    const error = cronError(a.trigger.expression, a.trigger.timezone);
    if (error) throw badRequest(`Invalid cron expression: ${error}`, "invalid_cron");
  }
  if (a.workKey && !a.workKey.includes("{{") && !WorkKey.safeParse(a.workKey).success) {
    throw badRequest(
      "workKey must look like <kind>:<id>, e.g. automation:audit",
      "invalid_work_key",
    );
  }
  if (a.action.type === "triage" && a.trigger.type === "cron") {
    throw badRequest("Triage runs on issue events, not on a schedule", "invalid_trigger");
  }
}
