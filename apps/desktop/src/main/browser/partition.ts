import { basename } from "node:path";
import { Notification, type Session, session as sessions, shell } from "electron";
import { allowViewPermission, browserUserAgent, partitionName, uniquePath } from "./policy";

export { partitionName };

export interface PartitionOptions {
  /** Where downloads go (the OS Downloads folder). */
  downloads: () => string;
  log: (message: string) => void;
}

const configured = new WeakSet<Session>();

/** The session partition for a CodeDen session's native views, hardened once. */
export function sessionPartition(sessionId: string, opts: PartitionOptions): Session {
  const partition = sessions.fromPartition(partitionName(sessionId), { cache: true });
  if (configured.has(partition)) return partition;
  configured.add(partition);
  partition.setUserAgent(browserUserAgent(partition.getUserAgent()));
  partition.setPermissionRequestHandler((_wc, permission, callback) => {
    const ok = allowViewPermission(permission);
    if (!ok) opts.log(`browser: denied ${permission} for session ${sessionId}`);
    callback(ok);
  });
  partition.setPermissionCheckHandler((_wc, permission) => allowViewPermission(permission));
  partition.setDevicePermissionHandler(() => false);
  partition.on("will-download", (_event, item) => {
    const path = uniquePath(opts.downloads(), item.getFilename());
    item.setSavePath(path);
    opts.log(`browser: downloading ${item.getURL().slice(0, 200)} to ${path}`);
    item.once("done", (_e, state) => {
      if (state !== "completed" || !Notification.isSupported()) return;
      const note = new Notification({ title: "Download finished", body: basename(path) });
      note.on("click", () => shell.showItemInFolder(path));
      note.show();
    });
  });
  return partition;
}
