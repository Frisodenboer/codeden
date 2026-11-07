import type { AnyServerTool } from "../define";
import { askUser } from "./ask-user";
import { finish } from "./finish";
import { reportProgress } from "./report-progress";
import { shareToChat } from "./share-to-chat";
import { suggestFollowups } from "./suggest-followups";

/** Every CodeDen tool, in the order agents see them. Add new tools here (one file each). */
export const allTools: AnyServerTool[] = [
  reportProgress,
  askUser,
  shareToChat,
  suggestFollowups,
  finish,
];
