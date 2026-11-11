/**
 * opencode adapter: one shared `opencode serve` per runner, driven over its HTTP API and
 * server-sent event stream. Brings GLM (Z.AI) and the other opencode providers to CodeBench.
 */
export { OPENCODE_PROVIDER_ID, OpencodeAdapter, type OpencodeAdapterOptions } from "./adapter";
export { OpencodeClient, OpencodeHttpError, SseParser } from "./client";
export {
  listOpencodeCommands,
  type OpencodeCommand,
  parseSlashCommand,
  toOpencodeCommands,
} from "./commands";
export { detectOpencode, OPENCODE_MIN_VERSION, parseOpencodeAuthList } from "./detect";
export { classifyOpencodeError } from "./errors";
export { OpencodeEventMapper } from "./mapper";
export {
  modelInfoFromOpencode,
  opencodeModelId,
  opencodeModels,
  splitOpencodeModel,
} from "./models";
export {
  decidePermission,
  opencodeMcpConfig,
  opencodeMcpName,
  opencodePermissions,
  permissionRisk,
} from "./policy";
export { OpencodeServer, parseListeningUrl } from "./process";
export {
  approvalItem,
  OpencodeSession,
  questionItem,
  toOpencodeParts,
} from "./session";
