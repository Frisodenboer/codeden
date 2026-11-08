import {
  type EditQueuedMessageRequest,
  QueuedMessage,
  QueuedMessageList,
  SendQueuedNowResponse,
} from "@codeden/contracts";
import type { Fetcher } from "./http";

/**
 * A session's queued messages (`/api/sessions/:id/queue`): sent while a turn runs, delivered
 * one at a time when it ends. Edit, delete and send-now reject with a 409 `already_sent`
 * `ApiRequestError` once delivery has taken the message.
 */
export interface QueueApi {
  list(sessionId: string): Promise<QueuedMessage[]>;
  /** Replace the text; attachments stay. */
  edit(sessionId: string, messageId: string, text: string): Promise<QueuedMessage>;
  remove(sessionId: string, messageId: string): Promise<void>;
  /** Steer the running turn with it now (or send it, if the session went idle). */
  sendNow(sessionId: string, messageId: string): Promise<SendQueuedNowResponse>;
}

export function httpQueueApi(http: Fetcher): QueueApi {
  const enc = encodeURIComponent;
  const path = (sessionId: string, messageId?: string) =>
    `/sessions/${enc(sessionId)}/queue${messageId ? `/${enc(messageId)}` : ""}`;
  return {
    list: (sessionId) => http.get(path(sessionId), (v) => QueuedMessageList.parse(v).messages),
    edit: (sessionId, messageId, text) =>
      http.call(
        "PATCH",
        path(sessionId, messageId),
        { text } satisfies EditQueuedMessageRequest,
        (v) => QueuedMessage.parse(v),
      ),
    async remove(sessionId, messageId) {
      await http.call("DELETE", path(sessionId, messageId));
    },
    sendNow: (sessionId, messageId) =>
      http.post(`${path(sessionId, messageId)}/send-now`, {}, (v) =>
        SendQueuedNowResponse.parse(v),
      ),
  };
}
