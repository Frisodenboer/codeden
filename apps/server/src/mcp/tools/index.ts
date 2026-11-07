import type { AnyServerTool } from "../define";
import { askUser } from "./ask-user";
import {
  browserClick,
  browserEvaluate,
  browserLogs,
  browserNavigate,
  browserOpenDevServer,
  browserPress,
  browserSnapshot,
  browserType,
  browserWait,
} from "./browser";
import { browserScreenshot } from "./browser-screenshot";
import { finish } from "./finish";
import { generateImage } from "./generate-image";
import { orchestratorTools } from "./orchestrator";
import { pmTools } from "./pm";
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
  browserNavigate,
  browserSnapshot,
  browserClick,
  browserType,
  browserPress,
  browserScreenshot,
  browserLogs,
  browserWait,
  browserEvaluate,
  browserOpenDevServer,
  generateImage,
  ...orchestratorTools,
  ...pmTools,
];
