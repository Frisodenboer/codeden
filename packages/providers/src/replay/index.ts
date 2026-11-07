/** Replay provider (§7.2): record live sessions to fixtures and play them back in tests. */
export { ReplayProvider, type ReplayProviderOptions, ReplaySession } from "./adapter";
export {
  CWD_PLACEHOLDER,
  instantiateFixture,
  loadFixture,
  parseFixture,
  type ReplayFixture,
  type ReplayTurn,
  SESSION_PLACEHOLDER,
  sanitizeFixture,
  saveFixture,
} from "./fixture";
export { RecordingSession } from "./recorder";
export { validateEventStream } from "./validate";
