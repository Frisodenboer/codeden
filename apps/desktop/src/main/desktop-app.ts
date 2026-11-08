import { join } from "node:path";
import {
  type DesktopInfo,
  type DesktopUpdateCommand,
  deepLinkPath,
  parseDeepLink,
} from "@codeden/contracts";
import { app, dialog, Menu, Notification, shell } from "electron";
import { CHANNELS } from "../shared/channels";
import { ActivityMonitor, type ServerStatus } from "./activity";
import type { LaunchArgs } from "./args";
import { AppBadge } from "./badge";
import { type Connection, connect, launchUrl } from "./connection";
import { registerBridge } from "./ipc";
import { appMenuTemplate } from "./menu";
import { homeFiles, isProcessAlive } from "./server-plan";
import {
  applyLaunchAtLogin,
  fileLogger,
  KeepAwake,
  launchAtLoginSupported,
  macSigned,
  openedAtLogin,
} from "./system";
import { AppTray } from "./tray";
import { trayView } from "./tray-view";
import { UpdateController } from "./updates/controller";
import { quitAction, standaloneAction, updateSupport } from "./updates/policy";
import { MainWindow } from "./window";

const DOCS_URL = "https://github.com/leonvanzyl/codeden/blob/main/docs/desktop.md";

/**
 * The desktop app (§17): one window on the server's UI, a tray with live counts, the app
 * badge, keep-awake, native notifications and folder picking, `codeden://` links and updates
 * from GitHub Releases. It starts the server (or attaches to a running one for the same home)
 * and leaves the runner running when it quits, as `codeden` does.
 */
export class DesktopApp {
  private readonly log: (message: string) => void;
  private readonly dist = import.meta.dirname;
  private window!: MainWindow;
  private tray!: AppTray;
  private badge!: AppBadge;
  private readonly keepAwake = new KeepAwake();
  private updates!: UpdateController;
  private monitor: ActivityMonitor | undefined;
  private conn: Connection | undefined;
  private status: ServerStatus = { connected: false, activity: null, settings: null };
  private pendingPath: string | null = null;
  private loaded = false;
  private quitting = false;
  private quitReady = false;
  private standaloneTimer: NodeJS.Timeout | undefined;
  private notifiedUpdate: string | null = null;

  constructor(private readonly args: LaunchArgs) {
    this.log = fileLogger(join(homeFiles(args.home).logs, "desktop.log"));
    if (args.deepLink) this.pendingPath = this.pathFor(args.deepLink);
  }

  private asset(name: string): string {
    return join(this.dist, "assets", name);
  }

  async start(): Promise<void> {
    this.log(`app: CodeDen ${app.getVersion()} starting (home ${this.args.home})`);
    const unsupported = updateSupport({
      packaged: app.isPackaged,
      platform: process.platform,
      // `CodeDen.app/Contents/Resources/app` -> `CodeDen.app`.
      macSigned: await macSigned(join(app.getAppPath(), "..", "..", "..")),
    });
    this.updates = new UpdateController({
      current: app.getVersion(),
      unsupported,
      updater: () => loadUpdater(this.log),
      beforeInstall: () => this.prepareInstall(),
      log: this.log,
    });
    this.updates.onChange((state) => {
      this.conn?.server?.send({ type: "update.state", state });
      this.refresh();
      this.notifyUpdate();
    });

    Menu.setApplicationMenu(Menu.buildFromTemplate(this.menu()));
    this.tray = new AppTray(
      this.asset(process.platform === "darwin" ? "trayTemplate.png" : "tray.png"),
      {
        open: () => this.show(),
        openInbox: () => this.navigate("/inbox"),
        update: (command) => void this.runUpdate(command),
        quit: () => app.quit(),
      },
    );
    this.window = new MainWindow({
      preload: join(this.dist, "preload.cjs"),
      icon: this.asset("icon.png"),
      stateFile: join(homeFiles(this.args.home).desktop, "window-state.json"),
      show: !this.args.hidden && !openedAtLogin(),
      hideOnClose: () => this.status.settings?.desktop.closeToTray ?? true,
      log: this.log,
    });
    this.badge = new AppBadge(() => this.window.window, this.asset("badge.png"));
    registerBridge({
      info: () => this.info(),
      origin: () => this.window.serverOrigin,
      window: () => this.window.window,
      showWindow: () => this.show(),
      setBadge: (count) => this.badge.set(count),
      icon: this.asset("icon.png"),
      log: this.log,
    });
    this.exposeForTests();
    await this.open();
  }

  /** Connect to (or start) the server and load the UI. */
  private async open(): Promise<void> {
    try {
      this.conn = await connect({
        args: this.args,
        serverEntry: join(this.dist, "server.js"),
        onUpdateCommand: (id, command) => void this.onServerCommand(id, command),
        onUnexpectedExit: (code) => void this.onServerExit(code),
        log: this.log,
      });
    } catch (error) {
      this.log(`app: no server: ${String(error)}`);
      await dialog.showMessageBox({
        type: "error",
        title: "CodeDen could not start",
        message: "CodeDen could not start its server.",
        detail: `${error instanceof Error ? error.message : String(error)}\n\nSee ${homeFiles(this.args.home).logs}.`,
      });
      app.quit();
      return;
    }
    this.conn.server?.send({ type: "update.state", state: this.updates.state });
    await this.window.load(launchUrl(this.conn, this.pendingPath ?? "/"));
    this.pendingPath = null;
    this.loaded = true;
    this.monitor?.stop();
    this.monitor = new ActivityMonitor({
      baseUrl: this.conn.url,
      token: this.conn.token,
      onChange: (status) => this.onStatus(status),
    });
    this.monitor.start();
    if (!this.conn.server) this.startStandaloneUpdates();
  }

  show(): void {
    this.window?.show();
  }

  /** A second launch (or a `codeden://` link on Windows and Linux) focuses this instance. */
  secondInstance(args: LaunchArgs): void {
    if (args.deepLink) this.openLink(args.deepLink);
    else if (!args.hidden) this.show();
  }

  openLink(url: string): void {
    const path = this.pathFor(url);
    if (!path) return;
    if (this.loaded) this.navigate(path);
    else this.pendingPath = path;
  }

  private pathFor(url: string): string | null {
    const target = parseDeepLink(url);
    if (!target) this.log(`app: ignored link ${url.slice(0, 200)}`);
    return target ? deepLinkPath(target) : null;
  }

  private navigate(path: string): void {
    this.show();
    if (this.loaded) this.window.window.webContents.send(CHANNELS.navigate, path);
    else this.pendingPath = path;
  }

  /** Quitting: install a downloaded update on the way out, else leave the runner running. */
  beforeQuit(event: Electron.Event): void {
    if (this.quitReady) return;
    event.preventDefault();
    if (this.quitting) return;
    this.quitting = true;
    void (async () => {
      this.window?.allowClose();
      clearInterval(this.standaloneTimer);
      this.monitor?.stop();
      this.keepAwake.set(false);
      if (this.updates && quitAction(this.updates.state.phase) === "install") {
        await this.updates.installOnQuit();
        return;
      }
      await this.conn?.server?.stop({ stopRunner: false });
      this.tray?.destroy();
      this.quitReady = true;
      app.quit();
    })();
  }

  /** Before the installer runs: stop the server and drain the runner (as `codeden stop`). */
  private async prepareInstall(): Promise<void> {
    this.window.allowClose();
    this.monitor?.stop();
    const server = this.conn?.server;
    if (server) {
      await server.stop({ stopRunner: true, timeoutMs: 90_000 });
      await waitForRunnerExit(homeFiles(this.args.home).runnerLock, 15_000, this.log);
    }
    this.quitReady = true;
  }

  private async onServerCommand(id: string, command: DesktopUpdateCommand): Promise<void> {
    let error: string | null = null;
    try {
      await this.updates.run(command);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    this.conn?.server?.send({ type: "update.done", id, error });
  }

  private async runUpdate(command: DesktopUpdateCommand): Promise<void> {
    await this.updates.run(command).catch((e: unknown) => this.log(`updates: ${String(e)}`));
  }

  private async onServerExit(code: number | null): Promise<void> {
    if (this.quitting) return;
    if (code === 0) {
      // Stopped on purpose (`codeden stop` from a terminal): quit with it.
      this.log("app: the server was stopped; quitting");
      app.quit();
      return;
    }
    const { response } = await dialog.showMessageBox({
      type: "error",
      title: "CodeDen",
      message: "The CodeDen server stopped unexpectedly.",
      detail: `Agents keep running in the runner. See ${homeFiles(this.args.home).logs}.`,
      buttons: ["Restart", "Quit"],
      defaultId: 0,
    });
    if (response === 0) await this.open();
    else app.quit();
  }

  private onStatus(status: ServerStatus): void {
    this.status = status;
    const desktop = status.settings?.desktop;
    if (desktop) applyLaunchAtLogin(desktop.launchAtLogin);
    const running = status.activity?.running ?? 0;
    this.keepAwake.set(Boolean(desktop?.keepAwake ?? true) && running > 0);
    this.refresh();
  }

  private refresh(): void {
    if (!this.tray || !this.updates) return;
    const view = trayView({
      activity: this.status.activity,
      connected: this.status.connected,
      update: this.updates.state,
      autoUpdate: this.status.settings?.updates.mode === "auto",
    });
    this.tray.update(view);
    if (this.status.connected) this.badge?.set(view.badge);
  }

  /** Attached to a server started by `codeden`: follow the update mode here (§17). */
  private startStandaloneUpdates(): void {
    const tick = () => {
      const settings = this.status.settings;
      if (!settings) return;
      const state = this.updates.state;
      const action = standaloneAction({
        mode: settings.updates.mode,
        phase: state.phase,
        unsupported: state.unsupported,
        checkedAt: state.checkedAt ? Date.parse(state.checkedAt) : null,
        now: Date.now(),
      });
      if (action) void this.runUpdate(action);
    };
    this.standaloneTimer = setInterval(tick, 60_000);
    setTimeout(tick, 5_000).unref();
  }

  /** Without our own server there is no update banner: say it with a notification. */
  private notifyUpdate(): void {
    const state = this.updates.state;
    if (this.conn?.server !== null || !Notification.isSupported() || !state.latest) return;
    if (state.phase !== "available" && state.phase !== "downloaded") return;
    const key = `${state.phase}:${state.latest}`;
    if (this.notifiedUpdate === key) return;
    this.notifiedUpdate = key;
    new Notification({
      title: `CodeDen ${state.latest} is ${state.phase === "downloaded" ? "ready" : "available"}`,
      body:
        state.phase === "downloaded"
          ? "It installs when you quit CodeDen, or choose Restart to update in the tray menu."
          : "Download it from the tray menu.",
    }).show();
  }

  private info(): DesktopInfo {
    return {
      version: app.getVersion(),
      platform: process.platform as DesktopInfo["platform"],
      packaged: app.isPackaged,
      ownsServer: Boolean(this.conn?.server),
      launchAtLoginSupported,
    };
  }

  private menu() {
    return appMenuTemplate(process.platform, {
      openSettings: () => this.navigate("/settings/general"),
      openInbox: () => this.navigate("/inbox"),
      checkForUpdates: () => {
        this.navigate("/settings/about");
        void this.runUpdate("check");
      },
      openDocs: () => void shell.openExternal(DOCS_URL),
      openLogs: () => void shell.openPath(homeFiles(this.args.home).logs),
      quit: () => app.quit(),
      zoom: (command) => this.window?.zoom(command),
    });
  }

  /** Read-only hooks for the desktop smoke test (`CODEDEN_DESKTOP_TEST=1`). */
  private exposeForTests(): void {
    if (process.env.CODEDEN_DESKTOP_TEST !== "1") return;
    (globalThis as Record<string, unknown>).__codedenDesktopTest = {
      trayLabels: () => this.tray.menuLabels(),
      status: () => this.status,
      ownsServer: () => Boolean(this.conn?.server),
      serverPid: () => this.conn?.server?.pid ?? null,
      keepAwake: () => this.keepAwake.active,
      updateState: () => this.updates.state,
      zoomFactor: () => this.window.zoomFactor,
    };
  }
}

/** electron-updater, loaded on first use (GitHub Releases, from `app-update.yml`). */
async function loadUpdater(log: (m: string) => void) {
  const mod = (await import("electron-updater")) as unknown as {
    autoUpdater?: import("electron-updater").AppUpdater;
    default?: { autoUpdater: import("electron-updater").AppUpdater };
  };
  const updater = mod.autoUpdater ?? mod.default?.autoUpdater;
  if (!updater) throw new Error("electron-updater did not load");
  // Tests only: a local feed instead of GitHub Releases (like CODEDEN_UPDATE_REGISTRY for npm),
  // with its own download cache so a test never touches a real install's.
  const feed = process.env.CODEDEN_DESKTOP_UPDATE_URL;
  if (feed) {
    const config = join(app.getPath("userData"), "test-app-update.yml");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      config,
      `provider: generic\nurl: ${feed}\nupdaterCacheDirName: codeden-updater-test\n`,
    );
    updater.updateConfigPath = config;
    updater.setFeedURL({ provider: "generic", url: feed });
  }
  updater.logger = {
    info: (m: unknown) => log(`updater: ${String(m)}`),
    warn: (m: unknown) => log(`updater: ${String(m)}`),
    error: (m: unknown) => log(`updater: ${String(m)}`),
    debug: () => {},
  };
  return updater;
}

/** Wait for the runner in the lock file to exit; kill it if it outstays the timeout. */
async function waitForRunnerExit(lockFile: string, timeoutMs: number, log: (m: string) => void) {
  let pid: number | null = null;
  try {
    const { readFileSync } = await import("node:fs");
    pid = Number(JSON.parse(readFileSync(lockFile, "utf8")).pid) || null;
  } catch {
    return;
  }
  if (!pid) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && isProcessAlive(pid)) await new Promise((r) => setTimeout(r, 200));
  if (isProcessAlive(pid)) {
    log(`updates: runner ${pid} still running; stopping it`);
    try {
      process.kill(pid);
    } catch {
      // gone
    }
  }
}
