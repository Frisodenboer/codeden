import { describe, expect, it } from "vitest";
import { replaceFileSync } from "../src/util/replace-file";

const busy = (code = "EPERM") => Object.assign(new Error(code), { code });

describe("replaceFileSync", () => {
  const run = (renames: (Error | null)[], copyFails = false) => {
    const calls: string[] = [];
    const slept: number[] = [];
    const fs = {
      rename: () => {
        const outcome = renames.shift() ?? null;
        calls.push("rename");
        if (outcome) throw outcome;
      },
      copy: () => {
        calls.push("copy");
        if (copyFails) throw busy();
      },
    };
    const result = () =>
      replaceFileSync("missing.tmp", "missing.json", fs as never, (ms) => slept.push(ms));
    return { result, calls, slept };
  };

  it("renames straight away when nothing holds the file", () => {
    const { result, calls, slept } = run([]);
    result();
    expect(calls).toEqual(["rename"]);
    expect(slept).toEqual([]);
  });

  it("retries while Windows reports the file busy", () => {
    const { result, calls } = run([busy(), busy("EBUSY"), busy("EACCES")]);
    result();
    expect(calls).toEqual(["rename", "rename", "rename", "rename"]);
  });

  it("copies over the file when renaming keeps failing", () => {
    const { result, calls } = run(Array.from({ length: 20 }, () => busy()));
    result();
    expect(calls.at(-1)).toBe("copy");
    expect(calls.filter((c) => c === "rename")).toHaveLength(8);
  });

  it("throws the rename error when copying fails too, and other errors at once", () => {
    expect(
      run(
        Array.from({ length: 20 }, () => busy()),
        true,
      ).result,
    ).toThrow("EPERM");
    const other = run([busy("ENOENT")]);
    expect(other.result).toThrow("ENOENT");
    expect(other.calls).toEqual(["rename"]);
  });
});
