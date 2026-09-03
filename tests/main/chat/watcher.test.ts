import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BaseChatWatcher,
  messageId,
  type ChatFeed,
  type ChatWatcherEvents,
} from "@main/chat/watcher";
import { Channel, type ChannelLookup, type RetryPolicy } from "@main/chat/channel";
import type { Platform } from "@shared/types";

describe("messageId", () => {
  it("composes platform, source and native id in that order", () => {
    expect(messageId("twitch", "src-1", "abc")).toBe("twitch:src-1:abc");
  });

  it("keeps two sources of one channel apart", () => {
    expect(messageId("twitch", "src-1", "abc")).not.toBe(
      messageId("twitch", "src-2", "abc"),
    );
  });

  it("keeps the same native id on two platforms apart", () => {
    expect(messageId("kick", "src-1", "abc")).not.toBe(
      messageId("youtube", "src-1", "abc"),
    );
  });
});

class TestChannel extends Channel {
  readonly platform: Platform = "twitch";
}

function stubFeed(): ChatFeed {
  return { start: vi.fn(), stop: vi.fn() };
}

function stubEvents(): ChatWatcherEvents {
  return { message: vi.fn(), moderation: vi.fn(), status: vi.fn() };
}

class TestWatcher extends BaseChatWatcher<TestChannel> {
  readonly platform: Platform = "twitch";

  protected readonly retry: RetryPolicy = {
    offlineMs: 100_000,
    errorMs: 100_000,
    jitterMs: 0,
  };

  readonly resolveMock = vi.fn<() => Promise<ChannelLookup<TestChannel>>>();

  protected resolve(): Promise<ChannelLookup<TestChannel>> {
    return this.resolveMock();
  }

  protected createFeed(): ChatFeed {
    return stubFeed();
  }
}

// A watcher that only ever hears "offline" — every recheck() test needs one identical to
// this except for what it does once rechecked, so it is shared.
function offlineWatcher(): TestWatcher {
  const watcher = new TestWatcher({ sourceId: "src-1", identifier: "chan", events: stubEvents() });
  watcher.resolveMock.mockResolvedValue({ state: "offline", reason: "not live" });
  return watcher;
}

describe("BaseChatWatcher.recheck", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // The whole point: a platform going live through the app's own broadcast relay should
  // not have to wait out YouTube's ~2.5 minute offline retry to notice.
  it("jumps a pending offline retry and resolves again immediately", async () => {
    const watcher = offlineWatcher();

    await watcher.connect();
    expect(watcher.resolveMock).toHaveBeenCalledTimes(1);

    watcher.recheck();

    expect(watcher.resolveMock).toHaveBeenCalledTimes(2);
  });

  it("does nothing once the channel is already connected", async () => {
    const watcher = new TestWatcher({ sourceId: "src-1", identifier: "chan", events: stubEvents() });
    watcher.resolveMock.mockResolvedValue({ state: "ok", channel: new TestChannel("name") });

    await watcher.connect();
    expect(watcher.resolveMock).toHaveBeenCalledTimes(1);

    watcher.recheck();

    expect(watcher.resolveMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing before connect() or after disconnect()", async () => {
    const watcher = offlineWatcher();

    watcher.recheck();
    expect(watcher.resolveMock).not.toHaveBeenCalled();

    await watcher.connect();
    await watcher.disconnect();
    watcher.resolveMock.mockClear();

    watcher.recheck();
    expect(watcher.resolveMock).not.toHaveBeenCalled();
  });
});
