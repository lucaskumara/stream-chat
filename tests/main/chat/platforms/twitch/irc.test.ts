import { describe, expect, it } from "vitest";
import type { Fragment } from "@shared/types";
import {
  buildIrcFragments,
  noticeKind,
  normalizeIrcPrivmsg,
  normalizeIrcUsernotice,
  parseEmoteTag,
  parseIrcLine,
  unescapeTag,
  type IrcMessage,
} from "@main/chat/platforms/twitch/irc";

const BACKSLASH = String.fromCharCode(92);

function privmsg(
  tags: Record<string, string>,
  trailing: string,
  nick = "someone",
): IrcMessage {
  return { tags, nick, command: "PRIVMSG", params: ["#chan"], trailing };
}

describe("unescapeTag", () => {
  it("turns the IRCv3 escapes back into their characters", () => {
    expect(unescapeTag(BACKSLASH + "s")).toBe(" ");
    expect(unescapeTag(BACKSLASH + "n")).toBe("\n");
    expect(unescapeTag(BACKSLASH + "r")).toBe("\r");
    expect(unescapeTag(BACKSLASH + ":")).toBe(";");
    expect(unescapeTag(BACKSLASH + BACKSLASH)).toBe(BACKSLASH);
  });

  it("leaves ordinary text alone", () => {
    expect(unescapeTag("hello there")).toBe("hello there");
  });

  it("unescapes a whole system message", () => {
    expect(unescapeTag("xqc" + BACKSLASH + "ssubscribed" + BACKSLASH + "sfor")).toBe(
      "xqc subscribed for",
    );
  });

  it("passes an unknown escape through as the character itself", () => {
    expect(unescapeTag(BACKSLASH + "q")).toBe("q");
  });

  it("drops a trailing lone backslash rather than reading past the end", () => {
    expect(unescapeTag("done" + BACKSLASH)).toBe("done");
  });
});

describe("parseIrcLine", () => {
  it("reads tags, nick, command, params and trailing out of one line", () => {
    const parsed = parseIrcLine(
      "@id=abc;color=#FF0000 :xqc!xqc@xqc.tmi.twitch.tv PRIVMSG #chan :hello world",
    );

    expect(parsed).toMatchObject({
      tags: { id: "abc", color: "#FF0000" },
      nick: "xqc",
      command: "PRIVMSG",
      params: ["#chan"],
      trailing: "hello world",
    });
  });

  it("gives a valueless tag an empty string", () => {
    expect(parseIrcLine("@mod :x!x@x PRIVMSG #c :hi")?.tags["mod"]).toBe("");
  });

  it("unescapes tag values as it reads them", () => {
    const line =
      "@system-msg=xqc" + BACKSLASH + "ssubscribed :tmi.twitch.tv USERNOTICE #c";

    expect(parseIrcLine(line)?.tags["system-msg"]).toBe("xqc subscribed");
  });

  it("handles a line with no tags", () => {
    expect(parseIrcLine(":x!x@x JOIN #chan")).toMatchObject({
      nick: "x",
      command: "JOIN",
      params: ["#chan"],
    });
  });

  it("handles a line with no prefix", () => {
    expect(parseIrcLine("PING :tmi.twitch.tv")).toMatchObject({
      command: "PING",
      trailing: "tmi.twitch.tv",
    });
  });

  it("takes the nick from before the bang", () => {
    expect(parseIrcLine(":nick!user@host PRIVMSG #c :hi")?.nick).toBe("nick");
  });

  it("keeps a whole prefix as the nick when there is no bang", () => {
    expect(parseIrcLine(":tmi.twitch.tv NOTICE #c :hi")?.nick).toBe(
      "tmi.twitch.tv",
    );
  });

  it("keeps a colon that appears inside the message", () => {
    expect(parseIrcLine("PRIVMSG #c :look: over there")?.trailing).toBe(
      "look: over there",
    );
  });

  it("returns null for an empty line", () => {
    expect(parseIrcLine("")).toBeNull();
  });

  it("leaves trailing undefined when the line carries none", () => {
    expect(parseIrcLine("PRIVMSG #chan")?.trailing).toBeUndefined();
  });
});

describe("parseEmoteTag", () => {
  it("reads one emote at one position", () => {
    expect(parseEmoteTag("25:0-4")).toEqual([{ id: "25", start: 0, end: 4 }]);
  });

  it("reads several ranges for one emote", () => {
    expect(parseEmoteTag("25:0-4,6-10")).toEqual([
      { id: "25", start: 0, end: 4 },
      { id: "25", start: 6, end: 10 },
    ]);
  });

  it("sorts spans by where they start, whatever order they arrive in", () => {
    expect(parseEmoteTag("1902:12-16/25:0-4").map((span) => span.start)).toEqual([
      0, 12,
    ]);
  });

  it("answers empty for a missing or empty tag", () => {
    expect(parseEmoteTag(undefined)).toEqual([]);
    expect(parseEmoteTag("")).toEqual([]);
  });

  it("skips a range whose end is before its start", () => {
    expect(parseEmoteTag("25:5-1")).toEqual([]);
  });

  it("skips a range that is not two numbers", () => {
    expect(parseEmoteTag("25:x-y")).toEqual([]);
  });
});

describe("buildIrcFragments", () => {
  it("splits links when there are no emotes", () => {
    expect(buildIrcFragments("see https://example.com", undefined)).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", text: "https://example.com", href: "https://example.com" },
    ]);
  });

  it("carves an emote out of the middle of the text", () => {
    const fragments = buildIrcFragments("hey Kappa there", "25:4-8");

    expect(fragments).toEqual([
      { kind: "text", text: "hey " },
      {
        kind: "emote",
        name: "Kappa",
        url: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0",
        srcSet:
          "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0 1x, " +
          "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0 2x, " +
          "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/3.0 3x",
        provider: "native",
      },
      { kind: "text", text: " there" },
    ]);
  });

  // The invariant this whole function exists for: Twitch counts code points, and a
  // ZWJ family emoji is 7 of them but 11 UTF-16 units. Slicing by index would cut a
  // surrogate pair in half and corrupt both the emoji and the emote beside it.
  it("indexes emote offsets by code point, not by UTF-16 unit", () => {
    const family = "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}";
    const text = `${family} Kappa`;

    expect([...text].length).toBe(13);
    expect(text.length).toBe(17);

    const fragments = buildIrcFragments(text, "25:8-12");

    expect(fragments[0]).toEqual({ kind: "text", text: `${family} ` });
    expect(fragments[1]).toMatchObject({ kind: "emote", name: "Kappa" });
  });

  it("keeps an astral emoji whole when the emote sits before it", () => {
    const fragments = buildIrcFragments("Kappa \u{1F600}", "25:0-4");

    expect(fragments[0]).toMatchObject({ name: "Kappa" });
    expect(fragments[1]).toEqual({ kind: "text", text: " \u{1F600}" });
  });

  it("handles two emotes with text between them", () => {
    const kinds = buildIrcFragments("Kappa and Kappa", "25:0-4,10-14").map(
      (fragment) => fragment.kind,
    );

    expect(kinds).toEqual(["emote", "text", "emote"]);
  });

  it("emits nothing before an emote that starts the message", () => {
    expect(buildIrcFragments("Kappa", "25:0-4")).toEqual([
      expect.objectContaining({ kind: "emote", name: "Kappa" }),
    ]);
  });

  it("skips a span that reaches past the end of the text", () => {
    const fragments = buildIrcFragments("hi", "25:50-54");

    expect(fragments).toEqual([{ kind: "text", text: "hi" }]);
  });

  it("clamps a span whose end runs past the text", () => {
    expect(buildIrcFragments("Kappa", "25:0-99")[0]).toMatchObject({
      kind: "emote",
      name: "Kappa",
    });
  });

  it("skips an overlapping span rather than emitting it twice", () => {
    const kinds = buildIrcFragments("Kappa", "25:0-4/1902:2-4").map(
      (fragment) => fragment.kind,
    );

    expect(kinds).toEqual(["emote"]);
  });
});

describe("noticeKind", () => {
  it("maps every subscription flavour onto one kind", () => {
    const ids = [
      "sub",
      "resub",
      "subgift",
      "submysterygift",
      "giftpaidupgrade",
      "anonsubgift",
    ];

    for (const id of ids) expect(noticeKind(id)).toBe("subscription");
  });

  it("maps raid and announcement to themselves", () => {
    expect(noticeKind("raid")).toBe("raid");
    expect(noticeKind("announcement")).toBe("announcement");
  });

  it("falls back to system for anything else", () => {
    expect(noticeKind("ritual")).toBe("system");
    expect(noticeKind(undefined)).toBe("system");
  });
});

describe("normalizeIrcPrivmsg", () => {
  it("composes the message id through the shared composer", () => {
    const message = normalizeIrcPrivmsg(
      privmsg({ id: "abc" }, "hello"),
      "src-1",
      "chan",
    );

    expect(message.id).toBe("twitch:src-1:abc");
  });

  it("invents an id when Twitch sends none, so nothing collides", () => {
    const first = normalizeIrcPrivmsg(privmsg({}, "a"), "src-1", "chan");
    const second = normalizeIrcPrivmsg(privmsg({}, "b"), "src-1", "chan");

    expect(first.id).not.toBe(second.id);
  });

  it("takes the author name from the nick", () => {
    const message = normalizeIrcPrivmsg(
      privmsg({ "user-id": "77" }, "hi", "xqc"),
      "src-1",
      "chan",
    );

    expect(message).toMatchObject({ authorName: "xqc", authorId: "77" });
  });

  it("falls back to the login tag, then to unknown", () => {
    const fromTag = { tags: { login: "bot" }, command: "PRIVMSG", params: ["#c"] };
    const fromNothing = { tags: {}, command: "PRIVMSG", params: ["#c"] };

    expect(normalizeIrcPrivmsg(fromTag, "src-1", "chan").authorName).toBe("bot");
    expect(normalizeIrcPrivmsg(fromNothing, "src-1", "chan").authorName).toBe(
      "unknown",
    );
  });

  it("falls back to the login for the author id when there is no user-id", () => {
    expect(normalizeIrcPrivmsg(privmsg({}, "hi", "xqc"), "s", "chan").authorId).toBe(
      "xqc",
    );
  });

  // Twitch sends an empty color tag for a user who never picked one, and the
  // renderer fills that gap from its own palette. Main must not invent one.
  it("carries a colour only when the user actually chose one", () => {
    const chosen = normalizeIrcPrivmsg(
      privmsg({ color: "#FF0000" }, "hi"),
      "s",
      "chan",
    );
    const unchosen = normalizeIrcPrivmsg(privmsg({ color: "" }, "hi"), "s", "chan");

    expect(chosen.authorColor).toBe("#FF0000");
    expect(unchosen.authorColor).toBeUndefined();
    expect("authorColor" in unchosen).toBe(false);
  });

  it("carries a display name only when one is sent", () => {
    expect(
      normalizeIrcPrivmsg(privmsg({ "display-name": "xQc" }, "hi"), "s", "chan")
        .authorDisplayName,
    ).toBe("xQc");
    expect(
      normalizeIrcPrivmsg(privmsg({}, "hi"), "s", "chan").authorDisplayName,
    ).toBeUndefined();
  });

  it("composes each badge key and falls back to the set id before the set loads", () => {
    const message = normalizeIrcPrivmsg(
      privmsg({ badges: "subscriber/12,moderator/1" }, "hi"),
      "s",
      "chan",
    );

    expect(message.badges).toEqual([
      { label: "subscriber" },
      { label: "moderator" },
    ]);
  });

  it("leaves badges off entirely when the tag is empty", () => {
    expect(normalizeIrcPrivmsg(privmsg({}, "hi"), "s", "chan").badges).toBeUndefined();
  });

  it("reads bits as a donation", () => {
    const message = normalizeIrcPrivmsg(privmsg({ bits: "100" }, "cheer100"), "s", "chan");

    expect(message.kind).toBe("donation");
    expect(message.monetary).toEqual({ amount: 100, currency: "bits" });
  });

  it("is an ordinary chat message without bits", () => {
    const message = normalizeIrcPrivmsg(privmsg({}, "hi"), "s", "chan");

    expect(message.kind).toBe("chat");
    expect(message.monetary).toBeUndefined();
  });

  it("binds a reply to the parent through the same id composer", () => {
    const message = normalizeIrcPrivmsg(
      privmsg(
        {
          "reply-parent-msg-id": "parent",
          "reply-parent-display-name": "xQc",
          "reply-parent-msg-body": "original",
        },
        "answer",
      ),
      "src-1",
      "chan",
    );

    expect(message.replyTo).toEqual({
      messageId: "twitch:src-1:parent",
      authorName: "xQc",
      excerpt: "original",
    });
  });

  it("cuts a long reply excerpt to sixty characters", () => {
    const message = normalizeIrcPrivmsg(
      privmsg(
        { "reply-parent-msg-id": "p", "reply-parent-msg-body": "x".repeat(200) },
        "answer",
      ),
      "s",
      "chan",
    );

    expect(message.replyTo?.excerpt).toHaveLength(60);
  });

  it("uses the sent timestamp when Twitch supplies one", () => {
    expect(
      normalizeIrcPrivmsg(privmsg({ "tmi-sent-ts": "1700000000000" }, "hi"), "s", "chan")
        .timestamp,
    ).toBe(1700000000000);
  });

  it("keeps the raw text as plainText", () => {
    expect(normalizeIrcPrivmsg(privmsg({}, "hello there"), "s", "chan").plainText).toBe(
      "hello there",
    );
  });
});

describe("normalizeIrcUsernotice", () => {
  const usernotice = (tags: Record<string, string>, trailing?: string): IrcMessage => ({
    tags,
    command: "USERNOTICE",
    params: ["#chan"],
    ...(trailing === undefined ? {} : { trailing }),
  });

  it("is dropped when there is no system message to show", () => {
    expect(normalizeIrcUsernotice(usernotice({}), "s", "chan")).toBeNull();
  });

  it("renders the system message on its own when the user typed nothing", () => {
    const message = normalizeIrcUsernotice(
      usernotice({ "system-msg": "xqc subscribed", "msg-id": "sub" }),
      "s",
      "chan",
    );

    expect(message?.kind).toBe("subscription");
    expect(message?.fragments).toEqual([{ kind: "text", text: "xqc subscribed" }]);
    expect(message?.plainText).toBe("xqc subscribed");
  });

  it("puts the user's own words after the system message", () => {
    const message = normalizeIrcUsernotice(
      usernotice({ "system-msg": "xqc subscribed" }, "love the stream"),
      "s",
      "chan",
    );

    expect(message?.fragments[0]).toEqual({ kind: "text", text: "xqc subscribed" });
    expect(message?.plainText).toBe("xqc subscribed love the stream");
  });

  it("parses emotes in the user's words but not in the system message", () => {
    const message = normalizeIrcUsernotice(
      usernotice({ "system-msg": "xqc subscribed", emotes: "25:0-4" }, "Kappa"),
      "s",
      "chan",
    );

    const emotes = message?.fragments.filter(
      (fragment: Fragment) => fragment.kind === "emote",
    );

    expect(emotes).toHaveLength(1);
  });

  it("falls back to twitch as the author when no login is sent", () => {
    expect(
      normalizeIrcUsernotice(usernotice({ "system-msg": "a raid arrived" }), "s", "chan")
        ?.authorName,
    ).toBe("twitch");
  });
});
