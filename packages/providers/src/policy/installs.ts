import { type RiskAssessment, risky, SAFE } from "./assessment";

/** Install rules of the risk classifier (§11.2): global, user-wide and system installs. */
const GLOBAL_FLAGS = new Set(["-g", "--global", "--location=global"]);

export function classifyInstall(bin: string, args: string[]): RiskAssessment {
  const sub = args[0];
  const isInstall = (verbs: string[]) => sub !== undefined && verbs.includes(sub);
  if (
    ["npm", "pnpm", "bun", "cnpm"].includes(bin) &&
    isInstall(["i", "install", "add", "link", "update", "up", "remove", "rm", "uninstall"])
  ) {
    if (args.some((a) => GLOBAL_FLAGS.has(a)))
      return risky("other", `Installs packages globally (${bin} ${sub} -g)`);
  }
  if (bin === "yarn" && sub === "global")
    return risky("other", "Installs packages globally (yarn global)");
  if (bin === "volta" && sub === "install")
    return risky("other", "Installs a global tool (volta install)");
  if (
    (bin === "pip" || bin === "pip3" || bin === "uv" || bin === "pipx") &&
    args.includes("install")
  ) {
    if (
      bin === "pipx" ||
      args.includes("--user") ||
      args.includes("--system") ||
      args.includes("--break-system-packages")
    ) {
      return risky("other", `Installs Python packages outside the project (${bin})`);
    }
  }
  if (bin === "uv" && sub === "tool" && args[1] === "install")
    return risky("other", "Installs a global tool (uv tool install)");
  if (
    (bin === "cargo" || bin === "go" || bin === "gem" || bin === "dotnet") &&
    (sub === "install" || (bin === "dotnet" && sub === "tool" && args.includes("-g")))
  ) {
    return risky("other", `Installs a global tool (${bin} ${sub})`);
  }
  if (
    [
      "brew",
      "apt",
      "apt-get",
      "yum",
      "dnf",
      "pacman",
      "zypper",
      "apk",
      "choco",
      "winget",
      "scoop",
      "port",
      "snap",
    ].includes(bin)
  ) {
    if (args.some((a) => ["install", "upgrade", "remove", "uninstall", "-s", "add"].includes(a))) {
      return risky("other", `Changes system packages (${bin})`);
    }
  }
  if (bin === "install-module" || bin === "install-package")
    return risky("other", `Installs a system-wide module (${bin})`);
  return SAFE;
}
