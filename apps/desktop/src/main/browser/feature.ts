import { app, type BrowserWindow } from "electron";
import { CHANNELS } from "../../shared/channels";
import { HostChannel } from "./host-channel";
import { NativeBrowsers } from "./native-browsers";

export interface NativeBrowserFeatureOptions {
  window: () => BrowserWindow | null;
  log: (message: string) => void;
}

/**
 * Native browser views in the desktop app (§17 Phase 2), as one piece the app wires in: the
 * views, the relay listener, the link to the server and the hand-off on quit.
 */
export class NativeBrowserFeature {
  readonly browsers: NativeBrowsers;
  private channel: HostChannel | undefined;

  constructor(private readonly opts: NativeBrowserFeatureOptions) {
    this.browsers = new NativeBrowsers({
      window: opts.window,
      downloads: () => app.getPath("downloads"),
      onShortcut: (shortcut) => {
        const win = opts.window();
        if (win && !win.isDestroyed()) win.webContents.send(CHANNELS.browserShortcut, shortcut);
      },
      log: opts.log,
    });
  }

  /** Offer native views to this server (again, after the app reconnected or restarted it). */
  connect(server: { url: string; token: string }): void {
    this.channel?.stop();
    this.channel = new HostChannel({
      baseUrl: server.url,
      token: server.token,
      version: app.getVersion(),
      attach: (sessionId) => this.browsers.attach(sessionId),
      log: this.opts.log,
    });
    this.channel.start();
  }

  /**
   * The app is quitting: move each open session to the runner's Chromium (its tabs' URLs and
   * cookies; unsaved page state is lost), then close the views. Without a server to take them,
   * the runner reopens the tabs it last saw when its relay connection drops.
   */
  async quit(timeoutMs = 15_000): Promise<void> {
    const channel = this.channel;
    try {
      const sessions = await this.browsers.handoffSessions();
      if (sessions.length > 0 && channel) {
        const failed = await channel.handoff(sessions, timeoutMs);
        if (failed === null) this.opts.log("browser: the server did not take the open tabs over");
        else if (failed.length > 0) {
          this.opts.log(`browser: hand-off failed for ${failed.length} session(s)`);
        } else this.opts.log(`browser: handed ${sessions.length} session(s) to the runner`);
      }
    } catch (error) {
      this.opts.log(`browser: hand-off: ${String(error)}`);
    } finally {
      channel?.stop();
      this.browsers.closeAll();
    }
  }
}
