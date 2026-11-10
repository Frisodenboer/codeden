import type { ApprovalAction } from "@codeden/contracts";

/** The classifier's verdict on one action: safe, or risky with the approval it needs. */
export type RiskAssessment =
  | { risky: false }
  | { risky: true; action: ApprovalAction; reason: string };

export const SAFE: RiskAssessment = { risky: false };

export const risky = (action: ApprovalAction, reason: string): RiskAssessment => ({
  risky: true,
  action,
  reason,
});
