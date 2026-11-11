import { describe, expect, it } from "vitest";
import { followUpTitle } from "../src/components/thread/messages";

describe("follow-up title from a reply", () => {
  it("takes the first sentence as plain text", () => {
    expect(
      followUpTitle(
        "The Monday check is ready under **Uridan Website → Automations**. Switch it on.",
      ),
    ).toBe("The Monday check is ready under Uridan Website → Automations.");
  });
  it("keeps link text and shortens long lines", () => {
    expect(followUpTitle("See [the PR](https://x.y/1)")).toBe("See the PR");
    expect(followUpTitle("a".repeat(200))).toHaveLength(118);
  });
});
