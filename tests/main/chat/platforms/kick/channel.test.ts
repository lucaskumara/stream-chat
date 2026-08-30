import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveChannel } from "@main/chat/platforms/kick/channel";

function answering(status: number, body: unknown): void {
  vi.stubGlobal("fetch", async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body
  }));
}

function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: "excorpse",
    user_id: 6750874,
    chatroom: { id: 6659000 },
    user: { username: "excorpse" },
    ...over
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("resolveChannel", () => {
  // Kick's chatroom exists independently of the stream, so a channel that exists
  // always connects — and must carry its name, live or not.
  it("connects and names the channel from user.username", async () => {
    answering(200, payload());

    const lookup = await resolveChannel("excorpse");

    expect(lookup.state).toBe("ok");
    expect(lookup.state === "ok" && lookup.channel.displayName).toBe("excorpse");
  });

  // Kick stores the capitalisation the account chose; xQc, Trainwreckstv and
  // NickEh30 all come back cased, so nothing here may lowercase it.
  it("preserves the capitalisation Kick sends", async () => {
    for (const username of ["xQc", "Trainwreckstv", "NickEh30"]) {
      answering(200, payload({ user: { username } }));

      const lookup = await resolveChannel(username.toLowerCase());

      expect(lookup.state === "ok" && lookup.channel.displayName).toBe(username);
    }
  });

  it("falls back to the slug, then to what was asked for", async () => {
    answering(200, payload({ user: {} }));
    expect(
      (await resolveChannel("excorpse")).state === "ok" &&
        ((await resolveChannel("excorpse")) as { channel: { displayName: string } }).channel
          .displayName
    ).toBe("excorpse");

    answering(200, payload({ user: {}, slug: undefined }));
    const lookup = await resolveChannel("askedfor");
    expect(lookup.state === "ok" && lookup.channel.displayName).toBe("askedfor");
  });

  // chatroom.id is not channel.id — they match on old channels and diverge on new
  // ones, and chat lives on the chatroom.
  it("subscribes to the chatroom id, not the channel id", async () => {
    answering(200, payload({ id: 875396, chatroom: { id: 875062 } }));

    const lookup = await resolveChannel("adinross");

    expect(lookup.state === "ok" && lookup.channel.room).toBe("chatrooms.875062.v2");
  });

  // 7TV keys Kick by user_id; the channel id is a 404 there.
  it("binds emotes to user_id", async () => {
    answering(200, payload({ id: 668, user_id: 676 }));

    const lookup = await resolveChannel("xqc");

    expect(lookup.state === "ok" && lookup.channel.emotes).toEqual({
      platform: "kick",
      channelId: "676"
    });
  });

  it("refuses a slug Kick does not know", async () => {
    answering(404, {});

    const lookup = await resolveChannel("nobodyowns");

    expect(lookup.state).toBe("missing");
    expect(lookup.state === "missing" && lookup.reason).toMatch(/nobodyowns/);
  });

  it("retries rather than refusing on any other status", async () => {
    answering(503, {});

    expect((await resolveChannel("excorpse")).state).toBe("unreachable");
  });

  it("retries rather than refusing when the request never lands", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("socket hang up");
    });

    expect(await resolveChannel("excorpse")).toEqual({
      state: "unreachable",
      reason: "socket hang up"
    });
  });

  it("reports a channel with no readable chatroom rather than connecting", async () => {
    answering(200, payload({ chatroom: undefined }));

    expect((await resolveChannel("excorpse")).state).toBe("unreachable");
  });

  it("matches the highest subscriber tier at or below the badge count", async () => {
    answering(
      200,
      payload({
        subscriber_badges: [
          { months: 1, badge_image: { src: "one.png" } },
          { months: 6, badge_image: { src: "six.png" } },
          { months: 12, badge_image: { src: "twelve.png" } }
        ]
      })
    );

    const lookup = await resolveChannel("excorpse");
    if (lookup.state !== "ok") throw new Error("expected ok");

    expect(lookup.channel.subscriberBadge(1).url).toBe("one.png");
    expect(lookup.channel.subscriberBadge(7).url).toBe("six.png");
    expect(lookup.channel.subscriberBadge(99).url).toBe("twelve.png");
    expect(lookup.channel.subscriberBadge(0).url).toBeUndefined();
  });
});
