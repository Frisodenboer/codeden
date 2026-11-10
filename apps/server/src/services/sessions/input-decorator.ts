import type { QueueSender, Session, UserInput } from "@codeden/contracts";

/**
 * A turn's input as rewritten at send time, with what to do once the runner took the turn
 * (`delivered`) or could not (`failed`): orchestration only counts the notices it carries as
 * delivered when they actually reached the session.
 */
export interface DecoratedInput {
  input: UserInput;
  delivered?: () => void;
  failed?: () => void;
}

/**
 * Rewrites a turn's input at send time. `from` is who sent the input that starts the turn, so
 * orchestration can tell the turns the user started from automatic ones (the loop guard).
 */
export type InputDecorator = (
  session: Session,
  input: UserInput,
  from: QueueSender,
) => DecoratedInput;
