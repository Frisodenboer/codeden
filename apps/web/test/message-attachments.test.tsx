import type { Attachment } from "@codeden/contracts";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UserMessage } from "@/components/thread/messages";
import { renderWithClient } from "./utils";

const message = (attachments: Attachment[]) => (
  <UserMessage
    item={{
      id: "u1",
      kind: "user_message",
      status: "completed",
      input: { text: "see attached", attachments },
    }}
  />
);

describe("user message attachments", () => {
  it("loads a stored image from its artifact", () => {
    const { client } = renderWithClient(
      message([
        {
          type: "image",
          mediaType: "image/png",
          name: "image.png",
          source: { type: "artifact", artifactId: "art-1" },
        },
      ]),
    );
    const img = screen.getByRole("img", { name: "image.png" });
    expect(img.getAttribute("src")).toBe(client.artifactUrl("art-1"));
    // The thumbnail opens the in-app viewer rather than navigating to the artifact.
    expect(img.closest("button")?.getAttribute("aria-label")).toBe("View image.png");
  });

  it("shows an image the server could not map to an artifact as a file name", () => {
    renderWithClient(
      message([
        { type: "image", mediaType: "image/png", source: { type: "path", path: "photo.png" } },
      ]),
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("photo.png")).toBeTruthy();
  });

  it("truncates a long file name and keeps the full name on hover", () => {
    const name = `${"very-long-screenshot-name-".repeat(6)}.png`;
    renderWithClient(message([{ type: "file", path: `src/${name}`, name }]));
    const label = screen.getByText(name);
    expect(label.className).toContain("truncate");
    expect(label.closest("[title]")?.getAttribute("title")).toBe(name);
  });
});
