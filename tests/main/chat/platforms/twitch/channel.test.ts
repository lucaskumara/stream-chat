import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TwitchAuth } from "@main/twitch/auth";
import type { Helix } from "@main/twitch/helix";

const twitchGql = vi.fn();

vi.mock("@main/chat/platforms/twitch/gql", () => ({
  twitchGql: (...args: unknown[]) => twitchGql(...args)
}));

const { resolveChannel } = await import("@main/chat/platforms/twitch/channel");

const signedOut = { isSignedIn: () => false } as unknown as TwitchAuth;
const signedIn = { isSignedIn: () => true } as unknown as TwitchAuth;

function helixReturning(user: unknown): Helix {
  return { getUserByLogin: async () => user } as unknown as Helix;
}

const noHelix = {} as Helix;

beforeEach(() => {
  twitchGql.mockReset();
});

describe("resolveChannel, signed out", () => {
  // Twitch chat reads whether or not the channel is live, so a channel that
  // exists always connects — and must carry the cased name when it does.
  it("takes the cased display name from anonymous GQL", async () => {
    twitchGql.mockResolvedValue({ user: { id: "100", displayName: "Excorpse" } });

    const lookup = await resolveChannel("excorpse", signedOut, noHelix);

    expect(lookup.state).toBe("ok");
    expect(lookup.state === "ok" && lookup.channel.displayName).toBe("Excorpse");
    expect(lookup.state === "ok" && lookup.channel.login).toBe("excorpse");
  });

  it("carries the numeric user id 7TV needs, not the login", async () => {
    twitchGql.mockResolvedValue({ user: { id: "100289331", displayName: "Excorpse" } });

    const lookup = await resolveChannel("excorpse", signedOut, noHelix);

    expect(lookup.state === "ok" && lookup.channel.emotes).toEqual({
      platform: "twitch",
      channelId: "100289331"
    });
  });

  it("strips a leading @ and lowercases before asking", async () => {
    twitchGql.mockResolvedValue({ user: { id: "1", displayName: "Excorpse" } });

    await resolveChannel("@ExCorpse", signedOut, noHelix);

    expect(twitchGql).toHaveBeenCalledWith(expect.any(String), { login: "excorpse" });
  });

  // GQL answering {user: null} is the anonymous existence check, and is terminal.
  it("refuses a login nobody owns", async () => {
    twitchGql.mockResolvedValue({ user: null });

    const lookup = await resolveChannel("nobodyowns", signedOut, noHelix);

    expect(lookup.state).toBe("missing");
    expect(lookup.state === "missing" && lookup.reason).toMatch(/nobodyowns/);
  });

  // A request that never landed is not evidence about the channel, so it still
  // connects — and the cost is casing, not the connection.
  it("still connects when GQL is unreachable, falling back to the login", async () => {
    twitchGql.mockResolvedValue(null);

    const lookup = await resolveChannel("excorpse", signedOut, noHelix);

    expect(lookup.state).toBe("ok");
    expect(lookup.state === "ok" && lookup.channel.displayName).toBe("excorpse");
  });

  it("treats a thrown GQL error the same way", async () => {
    twitchGql.mockRejectedValue(new Error("socket hang up"));

    expect((await resolveChannel("excorpse", signedOut, noHelix)).state).toBe("ok");
  });

  it("refuses an empty identifier before asking anything", async () => {
    expect((await resolveChannel("   ", signedOut, noHelix)).state).toBe("missing");
    expect(twitchGql).not.toHaveBeenCalled();
  });
});

describe("resolveChannel, signed in", () => {
  it("takes the cased display name from Helix", async () => {
    const helix = helixReturning({ id: "100", login: "excorpse", display_name: "Excorpse" });

    const lookup = await resolveChannel("excorpse", signedIn, helix);

    expect(lookup.state === "ok" && lookup.channel.displayName).toBe("Excorpse");
  });

  it("falls back to the login when Helix has no display name", async () => {
    const helix = helixReturning({ id: "100", login: "excorpse", display_name: "" });

    const lookup = await resolveChannel("excorpse", signedIn, helix);

    expect(lookup.state === "ok" && lookup.channel.displayName).toBe("excorpse");
  });

  it("refuses a login Helix does not know", async () => {
    expect((await resolveChannel("nobody", signedIn, helixReturning(null))).state).toBe(
      "missing"
    );
  });

  it("retries rather than refusing when Helix throws", async () => {
    const helix = {
      getUserByLogin: async () => {
        throw new Error("503 from Twitch");
      }
    } as unknown as Helix;

    expect(await resolveChannel("excorpse", signedIn, helix)).toEqual({
      state: "unreachable",
      reason: "503 from Twitch"
    });
  });
});
