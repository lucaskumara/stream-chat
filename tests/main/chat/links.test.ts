import { describe, expect, it } from "vitest";
import { splitLinks } from "@main/chat/links";

describe("splitLinks", () => {
  it("returns one text fragment when there is no link", () => {
    expect(splitLinks("hello there")).toEqual([
      { kind: "text", text: "hello there" },
    ]);
  });

  it("returns a text fragment for empty input rather than nothing", () => {
    expect(splitLinks("")).toEqual([{ kind: "text", text: "" }]);
  });

  it("carves a link out of the surrounding text", () => {
    expect(splitLinks("see https://example.com now")).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", text: "https://example.com", href: "https://example.com" },
      { kind: "text", text: " now" },
    ]);
  });

  it("gives a bare www. link an https href while showing what was typed", () => {
    const [link] = splitLinks("www.example.com");

    expect(link).toEqual({
      kind: "link",
      text: "www.example.com",
      href: "https://www.example.com",
    });
  });

  it("leaves trailing sentence punctuation out of the link", () => {
    const fragments = splitLinks("go to https://example.com.");

    expect(fragments[1]).toMatchObject({ href: "https://example.com" });
    expect(fragments[2]).toEqual({ kind: "text", text: "." });
  });

  it("leaves a closing bracket out of the link", () => {
    const fragments = splitLinks("(https://example.com)");

    expect(fragments[1]).toMatchObject({ text: "https://example.com" });
    expect(fragments[2]).toEqual({ kind: "text", text: ")" });
  });

  it("keeps a path and query inside the link", () => {
    const [link] = splitLinks("https://example.com/a/b?c=d&e=f");

    expect(link).toMatchObject({ href: "https://example.com/a/b?c=d&e=f" });
  });

  it("splits several links in one message", () => {
    const kinds = splitLinks("a https://one.com b https://two.com c").map(
      (fragment) => fragment.kind,
    );

    expect(kinds).toEqual(["text", "link", "text", "link", "text"]);
  });

  it("matches a link at the very start with no leading text fragment", () => {
    expect(splitLinks("https://example.com trailing")[0]?.kind).toBe("link");
  });

  it("ignores a lone dot that is not a url", () => {
    expect(splitLinks("wait...what")).toEqual([
      { kind: "text", text: "wait...what" },
    ]);
  });
});
