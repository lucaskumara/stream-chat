import { describe, expect, it } from "vitest";
import { messageId } from "./watcher";

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
