import { spawn } from "node:child_process";

/** Open a URL in the default browser without a shell (no quoting pitfalls). */
export function openBrowser(url: string): void {
  const [command, args]: [string, string[]] =
    process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => console.log(`Open ${url} in your browser.`));
  child.unref();
}
