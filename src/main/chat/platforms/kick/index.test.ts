import { describe, expect, it } from "vitest";
import { toFragments } from "./index";

describe("kick toFragments", () => {
  it("keeps plain text as one fragment", () => {
    expect(toFragments("hello there")).toEqual([
      { kind: "text", text: "hello there" },
    ]);
  });

  it("carves an inline emote token out of the content", () => {
    expect(toFragments("nice [emote:39284:xqcL] one")).toEqual([
      { kind: "text", text: "nice " },
      {
        kind: "emote",
        name: "xqcL",
        url: "https://files.kick.com/emotes/39284/fullsize",
        provider: "native",
      },
      { kind: "text", text: " one" },
    ]);
  });

  it("asks the cdn for fullsize, since the default variant is refused", () => {
    const [emote] = toFragments("[emote:1:a]");

    expect(emote).toMatchObject({ url: expect.stringMatching(/\/fullsize$/) });
  });

  it("handles several emotes in one message", () => {
    const kinds = toFragments("[emote:1:a] and [emote:2:b]").map((f) => f.kind);

    expect(kinds).toEqual(["emote", "text", "emote"]);
  });

  it("emits no empty text fragment around an emote that fills the message", () => {
    expect(toFragments("[emote:1:a]")).toHaveLength(1);
  });

  it("splits links out of the text left over around an emote", () => {
    const kinds = toFragments("[emote:1:a] see https://example.com").map(
      (f) => f.kind,
    );

    expect(kinds).toEqual(["emote", "text", "link"]);
  });

  it("leaves a malformed token as text", () => {
    expect(toFragments("[emote:abc:name]")).toEqual([
      { kind: "text", text: "[emote:abc:name]" },
    ]);
  });

  it("accepts an emote token with an empty name", () => {
    expect(toFragments("[emote:1:]")).toEqual([
      expect.objectContaining({ kind: "emote", name: "" }),
    ]);
  });

  it("answers empty for empty content", () => {
    expect(toFragments("")).toEqual([]);
  });
});
