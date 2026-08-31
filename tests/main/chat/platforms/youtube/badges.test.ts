import { describe, expect, it } from "vitest";
import { dataUri, parseIconsets } from "@main/chat/platforms/youtube/badges";

/** The sets arrive as Polymer markup inside a JS string literal, so every quote in the
    bundle is backslash-escaped. Matching on a bare `d="` finds nothing at all. */
function iconset(name: string, size: number, groups: string): string {
  const q = String.fromCharCode(92) + '"';
  return (
    `<iron-iconset-svg name=${q}${name}${q} size=${q}${size}${q}>` +
    `<svg><defs>${groups}</defs></svg></iron-iconset-svg>`
  );
}

function group(id: string, ...paths: string[]): string {
  const q = String.fromCharCode(92) + '"';
  return (
    `<g id=${q}${id}${q}>` +
    paths.map((d) => `<path d=${q}${d}${q}></path>`).join("") +
    `</g>`
  );
}

describe("youtube parseIconsets", () => {
  it("reads an escaped iconset out of the bundle", () => {
    const sets = parseIconsets(
      `blah();var a="${iconset("live-chat-badges", 16, group("moderator", "M1 2"))}";`,
    );

    expect([...sets.keys()]).toEqual(["live-chat-badges"]);
    expect(sets.get("live-chat-badges")!.size).toBe(16);
    expect(sets.get("live-chat-badges")!.icons.get("moderator")).toEqual(["M1 2"]);
  });

  // yt-sys-icons is 24 and live-chat-badges is 16; using one viewBox for both would
  // crop the wrench or shrink the check.
  it("keeps each set's own size", () => {
    const sets = parseIconsets(
      iconset("live-chat-badges", 16, group("moderator", "M1 2")) +
        iconset("yt-sys-icons", 24, group("check_circle_thick", "M3 4"))
    );

    expect(sets.get("live-chat-badges")!.size).toBe(16);
    expect(sets.get("yt-sys-icons")!.size).toBe(24);
  });

  it("collects every path in a multi-path icon", () => {
    const sets = parseIconsets(iconset("s", 24, group("i", "M1 1", "M2 2")));

    expect(sets.get("s")!.icons.get("i")).toEqual(["M1 1", "M2 2"]);
  });

  it("skips a group with no path", () => {
    const sets = parseIconsets(iconset("s", 24, group("empty")));

    expect(sets.size).toBe(0);
  });

  it("answers empty when the bundle carries no iconset", () => {
    expect(parseIconsets("function x(){return 1}").size).toBe(0);
  });
});

describe("youtube dataUri", () => {
  // The icons inherit currentColor, which an <img> has no value for — without an
  // explicit fill every badge renders solid black.
  it("paints an explicit fill on every path", () => {
    const svg = decodeURIComponent(
      dataUri(["M1 2", "M3 4"], 16, "#5e84f1").replace("data:image/svg+xml,", "")
    );

    expect(svg.match(/fill="#5e84f1"/g)).toHaveLength(2);
  });

  it("sizes the viewBox from the set", () => {
    const svg = decodeURIComponent(
      dataUri(["M1 2"], 16, "#fff").replace("data:image/svg+xml,", "")
    );

    expect(svg).toContain('viewBox="0 0 16 16"');
  });

  it("encodes so the uri carries no raw markup", () => {
    const uri = dataUri(["M1 2"], 24, "#fff");

    expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
    expect(uri).not.toContain("<");
    expect(uri).not.toContain('"');
  });
});
