import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveURL = vi.fn();
const getInfo = vi.fn();
const getChannel = vi.fn();

vi.mock("@main/chat/platforms/youtube/connection", () => ({
  innertube: async () => ({ resolveURL, getInfo, getChannel })
}));

const { resolveChannel, canonicalHandle } = await import("@main/chat/platforms/youtube/channel");

const VIDEO_ID = "jNQXAC9IVRw";

function info(basic: Record<string, unknown>, continuation?: string) {
  return {
    basic_info: basic,
    livechat: continuation ? { continuation } : undefined
  };
}

beforeEach(() => {
  resolveURL.mockReset();
  getInfo.mockReset();
  getChannel.mockReset();
});

describe("resolveChannel", () => {
  it("connects when the channel is live and chat is on", async () => {
    resolveURL.mockResolvedValue({ payload: { videoId: VIDEO_ID } });
    getInfo.mockResolvedValue(
      info({ is_live: true, author: "Lofi Girl", channel_id: "UC1" }, "token")
    );

    const lookup = await resolveChannel("@LofiGirl");

    expect(lookup.state).toBe("ok");
    expect(lookup.state === "ok" && lookup.channel.displayName).toBe("Lofi Girl");
    expect(lookup.state === "ok" && lookup.channel.continuation).toBe("token");
  });

  // The bug this pins: /@handle/live keeps resolving to the just-ended stream's
  // videoId and carries no browseId, so channelName() never runs — and getInfo
  // has the real name in hand on exactly this path. Dropping it left the tab
  // showing the raw @handle until the channel happened to go live again.
  it("keeps the name when the channel has a video id but is no longer live", async () => {
    resolveURL.mockResolvedValue({ payload: { videoId: VIDEO_ID } });
    getInfo.mockResolvedValue(info({ is_live: false, author: "Excorpse", channel_id: "UC2" }));

    const lookup = await resolveChannel("@excorpse");

    expect(lookup).toEqual({
      state: "offline",
      reason: "not streaming right now",
      displayName: "Excorpse"
    });
  });

  it("keeps the name when the stream is live but chat is turned off", async () => {
    resolveURL.mockResolvedValue({ payload: { videoId: VIDEO_ID } });
    getInfo.mockResolvedValue(info({ is_live: true, author: "Sky News", channel_id: "UC3" }));

    const lookup = await resolveChannel("@SkyNews");

    expect(lookup).toEqual({
      state: "offline",
      reason: "live chat is turned off for this stream",
      displayName: "Sky News"
    });
  });

  it("still reports offline when there is no name to be had", async () => {
    resolveURL.mockResolvedValue({ payload: { videoId: VIDEO_ID } });
    getInfo.mockResolvedValue(info({ is_live: false }));

    const lookup = await resolveChannel("@nameless");

    expect(lookup.state).toBe("offline");
    expect(lookup.state === "offline" && lookup.displayName).toBeUndefined();
  });

  it("falls back to the channel page for the name when the channel is dark", async () => {
    resolveURL.mockResolvedValue({ payload: { browseId: "UC_dark_1" } });
    getChannel.mockResolvedValue({ metadata: { title: "TheBurntPeanut" } });

    const lookup = await resolveChannel("@theburntpeanut");

    expect(lookup).toEqual({
      state: "offline",
      reason: "not streaming right now",
      displayName: "TheBurntPeanut"
    });
    expect(getInfo).not.toHaveBeenCalled();
  });

  it("is still offline when the channel page has no title to give", async () => {
    resolveURL.mockResolvedValue({ payload: { browseId: "UC_dark_2" } });
    getChannel.mockRejectedValue(new Error("nope"));

    expect(await resolveChannel("@quiet")).toMatchObject({ state: "offline" });
  });

  // Never percent-encode the @: %40LofiGirl resolves and %40TheBurntPeanut 404s,
  // so the fault reads as "that channel is broken" rather than "our URL is wrong".
  it("leaves the @ literal in the handle url", async () => {
    resolveURL.mockResolvedValue({ payload: { videoId: VIDEO_ID } });
    getInfo.mockResolvedValue(info({ is_live: true, author: "x" }, "t"));

    await resolveChannel("@TheBurntPeanut");

    expect(resolveURL).toHaveBeenCalledWith("https://www.youtube.com/@TheBurntPeanut/live");
  });

  it("takes a bare video id straight to the stream, skipping the url lookup", async () => {
    getInfo.mockResolvedValue(info({ is_live: true, author: "Someone" }, "t"));

    expect((await resolveChannel(VIDEO_ID)).state).toBe("ok");
    expect(resolveURL).not.toHaveBeenCalled();
  });

  it("builds a /channel/ url for a UC id", async () => {
    resolveURL.mockResolvedValue({ payload: { videoId: VIDEO_ID } });
    getInfo.mockResolvedValue(info({ is_live: true, author: "x" }, "t"));

    await resolveChannel("UCSJ4gkVC6NrvII8umztf0Ow");

    expect(resolveURL).toHaveBeenCalledWith(
      "https://www.youtube.com/channel/UCSJ4gkVC6NrvII8umztf0Ow/live"
    );
  });

  describe("failures", () => {
    it("treats a 404 as terminal, so the add is refused", async () => {
      resolveURL.mockRejectedValue(new Error("Request failed with status 404"));

      const lookup = await resolveChannel("@nobody");

      expect(lookup.state).toBe("missing");
      expect(lookup.state === "missing" && lookup.reason).toMatch(/@nobody/);
    });

    it("treats 'not found' and 'does not exist' the same way", async () => {
      for (const message of ["channel not found", "that does not exist"]) {
        resolveURL.mockRejectedValue(new Error(message));

        expect((await resolveChannel("@nobody")).state).toBe("missing");
      }
    });

    // An outage must not read as "your channel was deleted" — that one keeps retrying.
    it("treats anything else as retryable", async () => {
      resolveURL.mockRejectedValue(new Error("socket hang up"));

      expect(await resolveChannel("@LofiGirl")).toEqual({
        state: "unreachable",
        reason: "socket hang up"
      });
    });
  });
});

describe("canonicalHandle", () => {
  // YouTube handles are the one identifier shape it's safe to lowercase — a
  // UC… id and a video id are case-sensitive and break when folded, which is
  // exactly why those two are left alone below.
  it("lowercases a handle", () => {
    expect(canonicalHandle("@TheBurntPeanut")).toBe("@theburntpeanut");
  });

  it("adds the @ back for a handle typed without one", () => {
    expect(canonicalHandle("LofiGirl")).toBe("@lofigirl");
  });

  it("leaves a UC… channel id untouched", () => {
    expect(canonicalHandle("UCSJ4gkVC6NrvII8umztf0Ow")).toBeUndefined();
  });

  it("leaves an 11-character video id untouched", () => {
    expect(canonicalHandle(VIDEO_ID)).toBeUndefined();
  });
});
