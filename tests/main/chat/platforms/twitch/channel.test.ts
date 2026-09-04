import { beforeEach, describe, expect, it, vi } from "vitest";

const twitchGql = vi.fn();

vi.mock("@main/chat/platforms/twitch/gql", () => ({
  twitchGql: (...args: unknown[]) => twitchGql(...args)
}));

const { resolveChannel } = await import("@main/chat/platforms/twitch/channel");

beforeEach(() => {
  twitchGql.mockReset();
});

describe("resolveChannel", () => {
  // Twitch chat reads whether or not the channel is live, so a channel that
  // exists always connects — and must carry the cased name when it does.
  it("takes the cased display name from anonymous GQL", async () => {
    twitchGql.mockResolvedValue({ user: { id: "100", displayName: "Excorpse" } });

    const lookup = await resolveChannel("excorpse");

    expect(lookup.state).toBe("ok");
    expect(lookup.state === "ok" && lookup.channel.displayName).toBe("Excorpse");
    expect(lookup.state === "ok" && lookup.channel.login).toBe("excorpse");
  });

  // The clickable name in the pane bar opens this, so it has to be the login
  // (case-insensitive on Twitch's side) rather than the cased display name.
  it("builds the channel url from the login", async () => {
    twitchGql.mockResolvedValue({ user: { id: "100", displayName: "Excorpse" } });

    const lookup = await resolveChannel("Excorpse");

    expect(lookup.state === "ok" && lookup.channel.url).toBe("https://twitch.tv/excorpse");
  });

  it("carries the numeric user id 7TV needs, not the login", async () => {
    twitchGql.mockResolvedValue({ user: { id: "100289331", displayName: "Excorpse" } });

    const lookup = await resolveChannel("excorpse");

    expect(lookup.state === "ok" && lookup.channel.emotes).toEqual({
      platform: "twitch",
      channelId: "100289331"
    });
  });

  it("strips a leading @ and lowercases before asking", async () => {
    twitchGql.mockResolvedValue({ user: { id: "1", displayName: "Excorpse" } });

    await resolveChannel("@ExCorpse");

    expect(twitchGql).toHaveBeenCalledWith(expect.any(String), { login: "excorpse" });
  });

  // GQL answering {user: null} is the anonymous existence check, and is terminal.
  it("refuses a login nobody owns", async () => {
    twitchGql.mockResolvedValue({ user: null });

    const lookup = await resolveChannel("nobodyowns");

    expect(lookup.state).toBe("missing");
    expect(lookup.state === "missing" && lookup.reason).toMatch(/nobodyowns/);
  });

  // A request that never landed is not evidence about the channel, so it still
  // connects — and the cost is casing, not the connection.
  it("still connects when GQL is unreachable, falling back to the login", async () => {
    twitchGql.mockResolvedValue(null);

    const lookup = await resolveChannel("excorpse");

    expect(lookup.state).toBe("ok");
    expect(lookup.state === "ok" && lookup.channel.displayName).toBe("excorpse");
  });

  it("treats a thrown GQL error the same way", async () => {
    twitchGql.mockRejectedValue(new Error("socket hang up"));

    expect((await resolveChannel("excorpse")).state).toBe("ok");
  });

  it("refuses an empty identifier before asking anything", async () => {
    expect((await resolveChannel("   ")).state).toBe("missing");
    expect(twitchGql).not.toHaveBeenCalled();
  });
});

