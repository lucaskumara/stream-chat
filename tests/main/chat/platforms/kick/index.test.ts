import { describe, expect, it } from "vitest";
import { toChatMessage, toFragments } from "@main/chat/platforms/kick";
import { KickChannel } from "@main/chat/platforms/kick/channel";
import { REPLY_EXCERPT_LIMIT } from "@main/chat/fragments";

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

describe("kick toChatMessage", () => {
  const channel = KickChannel.fromApi(
    {
      slug: "xqc",
      user_id: 676,
      chatroom: { id: 668 },
      user: { username: "xQc" },
      subscriber_badges: [{ months: 1, badge_image: { src: "one.png" } }],
    },
    "xqc",
  )!;

  function event(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "m1",
      content: "hi",
      created_at: "2026-01-01T00:00:00Z",
      sender: { id: 5, username: "someone" },
      ...over,
    };
  }

  // A reply to an emote-only message used to show the raw [emote:id:name] token.
  it("runs the reply excerpt through the fragment parser", () => {
    const message = toChatMessage(
      event({
        metadata: {
          original_sender: { username: "other" },
          original_message: { id: "m0", content: "wow [emote:39284:xqcL]" },
        },
      }),
      "s",
      channel,
    );

    expect(message?.replyTo?.excerpt).toBe("wow xqcL");
  });

  it("clips a long reply excerpt", () => {
    const message = toChatMessage(
      event({
        metadata: {
          original_sender: { username: "other" },
          original_message: { id: "m0", content: "a".repeat(200) },
        },
      }),
      "s",
      channel,
    );

    expect(message?.replyTo?.excerpt).toHaveLength(REPLY_EXCERPT_LIMIT);
  });

  // Kick ships no image for these, so the renderer draws its own glyph off the id.
  it("keeps the badge type as an id on the imageless badges", () => {
    const message = toChatMessage(
      event({
        sender: {
          id: 5,
          username: "someone",
          identity: {
            badges: [
              { type: "broadcaster", text: "Broadcaster" },
              { type: "moderator", text: "Moderator" },
            ],
          },
        },
      }),
      "s",
      channel,
    );

    expect(message?.badges).toEqual([
      { label: "Broadcaster", id: "broadcaster" },
      { label: "Moderator", id: "moderator" },
    ]);
  });

  it("keeps the subscriber id on a tier with no image of its own", () => {
    const message = toChatMessage(
      event({
        sender: {
          id: 5,
          username: "someone",
          identity: { badges: [{ type: "subscriber", count: 0 }] },
        },
      }),
      "s",
      channel,
    );

    expect(message?.badges?.[0]).toMatchObject({ id: "subscriber" });
    expect(message?.badges?.[0].url).toBeUndefined();
  });

  it("prefers the tier image once one is earned", () => {
    const message = toChatMessage(
      event({
        sender: {
          id: 5,
          username: "someone",
          identity: { badges: [{ type: "subscriber", count: 3 }] },
        },
      }),
      "s",
      channel,
    );

    expect(message?.badges?.[0].url).toBe("one.png");
  });
});
