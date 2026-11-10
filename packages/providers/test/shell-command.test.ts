import { describe, expect, it } from "vitest";
import { defaultShell, shellCommandLine, shellSyntax } from "../src/util/shell-command";
import { parseRegQuery } from "../src/util/system-path";

describe("sign-in command lines", () => {
  const spaced = "C:\\Users\\Ada Lovelace\\.local\\bin\\claude.exe";

  it("runs a full path in PowerShell with the call operator", () => {
    expect(
      shellCommandLine("powershell.exe", "C:\\Users\\x\\.local\\bin\\claude.exe", [
        "auth",
        "login",
      ]),
    ).toBe("& 'C:\\Users\\x\\.local\\bin\\claude.exe' auth login");
    expect(
      shellCommandLine("C:\\Program Files\\PowerShell\\7\\pwsh.exe", spaced, ["auth", "login"]),
    ).toBe(`& '${spaced}' auth login`);
    // A quote in the path is doubled inside single quotes.
    expect(shellCommandLine("pwsh", "C:\\Users\\O'Brien\\claude.exe", ["login"])).toBe(
      "& 'C:\\Users\\O''Brien\\claude.exe' login",
    );
  });

  it("quotes for cmd and POSIX shells", () => {
    expect(shellCommandLine("C:\\Windows\\System32\\cmd.exe", spaced, ["auth", "login"])).toBe(
      `"${spaced}" auth login`,
    );
    expect(shellCommandLine("/bin/bash", "/home/ada/.local/bin/claude", ["auth", "login"])).toBe(
      "/home/ada/.local/bin/claude auth login",
    );
    expect(
      shellCommandLine("/bin/zsh", "/Users/Ada Lovelace/.local/bin/claude", ["auth", "login"]),
    ).toBe("'/Users/Ada Lovelace/.local/bin/claude' auth login");
    expect(
      shellCommandLine("/usr/bin/fish", "/home/o'brien/bin/gh", ["auth", "login", "--web"]),
    ).toBe("'/home/o'\\''brien/bin/gh' auth login --web");
  });

  it("leaves a bare command name alone", () => {
    expect(
      shellCommandLine("powershell.exe", "gh", [
        "auth",
        "login",
        "--web",
        "--git-protocol",
        "https",
      ]),
    ).toBe("gh auth login --web --git-protocol https");
  });

  it("knows each shell's syntax and the default shell", () => {
    expect(shellSyntax("powershell.exe")).toBe("powershell");
    expect(shellSyntax("pwsh")).toBe("powershell");
    expect(shellSyntax("C:\\Windows\\system32\\CMD.EXE")).toBe("cmd");
    expect(shellSyntax("/bin/zsh")).toBe("posix");
    expect(defaultShell({}, "win32")).toBe("powershell.exe");
    expect(defaultShell({ SHELL: "/bin/zsh" }, "darwin")).toBe("/bin/zsh");
    expect(defaultShell({ CODEDEN_SHELL: "pwsh" }, "linux")).toBe("pwsh");
  });
});

describe("registry PATH", () => {
  it("parses reg query output", () => {
    const out =
      "\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\.local\\bin;C:\\tools\r\n\r\n";
    expect(parseRegQuery(out)).toBe("%USERPROFILE%\\.local\\bin;C:\\tools");
    expect(
      parseRegQuery("ERROR: The system was unable to find the specified registry key"),
    ).toBeNull();
  });
});
