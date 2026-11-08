import { describe, expect, it } from "vitest";
import { ClaudePolicy } from "../src/claude/permissions";
import { classifyCommand, classifyWrite, type RiskContext } from "../src/policy/risk";

/**
 * Approvals CodeDen really raised on 2026-11-08 (issue #6), as recorded in the inbox. The
 * commands are verbatim apart from the home folder (`me`) and two long bodies, which are cut
 * down but keep the lines that caused the false positives.
 */

const temp = "C:\\Users\\me\\AppData\\Local\\Temp";
const worktree = (id: string): RiskContext => ({
  cwd: `C:\\Users\\me\\.codeden\\wt\\codeden\\${id}`,
  platform: "win32",
  home: "C:\\Users\\me",
  tempRoots: [temp],
});

const verdict = (command: string, ctx: RiskContext) => {
  const r = classifyCommand(command, ctx);
  return r.risky ? `${r.action}: ${r.reason}` : null;
};

describe("today's approvals", () => {
  it("Write to %TEMP%\\codeden-probe: asked (outside the worktree), now allowed (temp)", () => {
    const file = `${temp}\\codeden-probe\\probe-codex-models.ts`;
    expect(classifyWrite(file, worktree("24c5e697")).risky).toBe(false);
    expect(classifyWrite(file, { ...worktree("24c5e697"), tempRoots: [] })).toMatchObject({
      action: "outside_worktree",
    });
  });

  it("grep with a quoted \\| pattern: false positive (split inside quotes, `>\\` read as a write)", () => {
    const command =
      'grep -n "updateSession" -A3 src/lib/api/client.ts src/lib/api/mock/*.ts | head -40 && grep -rn "setQueryData<Snapshot>\\|setQueryData(snapshotKey" src | head';
    expect(verdict(command, { ...worktree("cc2cd882"), shell: "posix" })).toBeNull();
  });

  it("pnpm build > /tmp/…: asked (outside the worktree), now allowed (Git Bash /tmp is temp)", () => {
    const command =
      'cd /c/Users/me/.codeden/wt/codeden/7d44e009 && pnpm build > /tmp/codeden-build.log 2>&1; echo "build exit $?"; tail -5 /tmp/codeden-build.log; cd apps/web && pnpm exec playwright test e2e/project-order.spec.ts 2>&1 | tail -40';
    expect(verdict(command, { ...worktree("7d44e009"), shell: "posix" })).toBeNull();
  });

  it("node -e with a multi-line script: false positive (JSX `row.key` read as a key file)", () => {
    const command = [
      "node -e '",
      'const fs=require("fs");const p="src/components/composer/model-picker/model-list.tsx";let s=fs.readFileSync(p,"utf8");',
      'const rep=(a,b)=>{ if(!s.includes(a)) throw new Error("missing: "+a); s=s.replace(a,b); };',
      "rep(`function Row({",
      "  row,",
      "  selected,",
      "}: {",
      "  row: ModelRow;",
      "  selected: boolean;",
      "}) {`,`function Row({ row, selected, highlighted }) {`);",
      "rep(`          // Only the highlighted row\\x27s star is in the tab order.`, ``);",
      "rep(`            <Row key={row.key} row={row} selected={row.key === selectedKey} onPick={onPick} />`,`            <Row",
      "              key={row.key}",
      "              selected={row.key === selectedKey}",
      "            />`);",
      "fs.writeFileSync(p,s);",
      "'",
    ].join("\n");
    expect(verdict(command, { ...worktree("cc2cd882"), shell: "posix" })).toBeNull();
  });

  it("git add + git commit with here-string messages: false positive (message lines read as commands)", () => {
    const command = [
      "git add apps/server/src/services/artifacts.ts apps/server/src/services/sessions/client-items.ts apps/web/e2e/pasted-images.spec.ts",
      "git commit -q -F - @'",
      "fix(server): show pasted images from their artifact, never a file path",
      "",
      "- Stored input (queued messages, starts) now references the artifact. It is",
      "  resolved to a file path only when handed to the runner, so the provider",
      "  still reads the file and artifact inputs from API callers work too.",
      "",
      "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
      "'@",
      "git add apps/server/src/services/orchestration/digest.ts docs/orchestration.md",
      "git commit -q -F - @'",
      "fix(web): fold the injected updates block exactly, not at a blank line",
      "",
      "- The server now wraps the list in <codeden_updates>...</codeden_updates>,",
      "  like <codeden_status>, and defuses those tag names inside free text, so",
      "  only CodeDen's own tags open and close a block.",
      "",
      "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
      "'@",
      "git status --porcelain; git log --oneline -3",
    ].join("\n");
    expect(verdict(command, { ...worktree("47daf834"), shell: "powershell" })).toBeNull();
  });

  it("PowerShell $x = @(…) staging: false positive (here-string lines), and its %TEMP% write is now allowed", () => {
    const command = [
      "$bug2 = @('apps/server/src/services/orchestration/digest.ts','apps/server/src/services/orchestration/prompts.ts','apps/server/test/orchestration-digest.test.ts','docs/orchestration.md')",
      "git restore --staged -- $bug2",
      "$msg1 = @'",
      "fix(server): show pasted images from their artifact, never a file path",
      "",
      "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
      "'@",
      "$msg2 = @'",
      "fix(web): fold the injected updates block exactly, not at a blank line",
      "",
      "- The server now wraps the list in <codeden_updates>...</codeden_updates>,",
      "  like <codeden_status>, and defuses those tag names inside free text, so",
      "",
      "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
      "'@",
      "$f1 = Join-Path $env:TEMP 'codeden-47da-msg1.txt'; $f2 = Join-Path $env:TEMP 'codeden-47da-msg2.txt'",
      '[IO.File]::WriteAllText($f1, $msg1 + "`n"); [IO.File]::WriteAllText($f2, $msg2 + "`n")',
      "git commit -q -F $f1 && git add -- $bug2 && git commit -q -F $f2",
      "git status --porcelain; git log --stat --oneline -2",
    ].join("\n");
    expect(verdict(command, { ...worktree("47daf834"), shell: "powershell" })).toBeNull();
  });

  it("cp … ../../x.bak && sed -i …: false positive (the shell was in apps/web after an earlier cd)", () => {
    const command =
      'cp src/components/shell/sidebar/sidebar.tsx ../../sidebar.tsx.bak && sed -i \'s/ \\[&_\\[data-slot=scroll-area-viewport\\]>div\\]:block!//\' src/components/shell/sidebar/sidebar.tsx && grep -c "block!" src/components/shell/sidebar/sidebar.tsx; pnpm build 2>&1 | tail -1 && pnpm exec playwright test e2e/sidebar-layout.spec.ts 2>&1 | grep -E "ok|✘|x |Error|failed|passed|step" | head -12; cp ../../sidebar.tsx.bak src/components/shell/sidebar/sidebar.tsx && rm ../../sidebar.tsx.bak && grep -c "block!" src/components/shell/sidebar/sidebar.tsx && pnpm build 2>&1 | tail -1';
    const ctx = { ...worktree("7d44e009"), shell: "posix" as const };
    const inWeb = { ...ctx, dir: `${ctx.cwd}\\apps\\web` };
    expect(verdict(command, inWeb)).toBeNull();
    // From the worktree root the same paths really are outside it.
    expect(verdict(command, ctx)).toMatch(/^outside_worktree/);
    // The PreToolUse hook reports the shell's directory; the policy resolves from it.
    const policy = new ClaudePolicy("auto", worktree("7d44e009"));
    expect(policy.gate("Bash", { command }, inWeb.dir).ask).toBe(false);
    expect(policy.gate("Bash", { command }).ask).toBe(true);
  });

  it("pnpm e2e > /c/Users/me/scratch-ref/…: correct, still asks (outside the worktree, not temp)", () => {
    const command =
      'pnpm e2e > /c/Users/me/scratch-ref/e2e-run.log 2>&1; echo "EXIT=$?" >> /c/Users/me/scratch-ref/e2e-run.log';
    expect(verdict(command, { ...worktree("cc2cd882"), shell: "posix" })).toBe(
      "outside_worktree: Writes /c/Users/me/scratch-ref/e2e-run.log, outside the worktree",
    );
    const full = new ClaudePolicy("full", worktree("cc2cd882"));
    expect(full.gate("Bash", { command }).ask).toBe(true);
  });

  it("Write to %TEMP%\\codeden-issue6: asked (outside the worktree), now allowed (temp)", () => {
    const file = `${temp}\\codeden-issue6\\query.mjs`;
    expect(classifyWrite(file, worktree("ad3f9dd3")).risky).toBe(false);
    expect(
      new ClaudePolicy("auto", worktree("ad3f9dd3")).gate("Write", { file_path: file }).ask,
    ).toBe(false);
  });

  it("gh pr view > /tmp/pr7.md && sed -i …: asked (outside the worktree), now allowed (temp)", () => {
    const command =
      'gh pr view 7 --json body -q .body > /tmp/pr7.md && sed -i \'s/through the transition column/through the transcript column/\' /tmp/pr7.md && grep -c "transition column" /tmp/pr7.md; gh pr edit 7 --body-file /tmp/pr7.md >/dev/null && gh pr view 7 --json body -q .body | grep -n "inherited" ';
    expect(verdict(command, { ...worktree("921a6a4d"), shell: "posix" })).toBeNull();
  });
});
