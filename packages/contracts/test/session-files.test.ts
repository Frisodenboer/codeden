import { describe, expect, it } from "vitest";
import { SessionFileContent, SessionFileList, SessionFileQuery } from "../src";

const roundTrip = <T>(schema: { parse: (v: unknown) => T }, value: T) =>
  expect(schema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);

describe("session file contracts", () => {
  it("round-trips a file listing and a file", () => {
    roundTrip(SessionFileList, {
      root: "/home/me/.codeden/wt/app/s1",
      entries: [
        { path: "src", kind: "dir" },
        { path: "src/index.ts", kind: "file", sizeBytes: 120 },
      ],
      truncated: false,
    });
    roundTrip(SessionFileContent, {
      path: "src/index.ts",
      content: "export {};\n",
      sizeBytes: 11,
      binary: false,
      truncated: false,
    });
  });

  it("rejects an empty path", () => {
    expect(SessionFileQuery.safeParse({ path: "" }).success).toBe(false);
  });
});
