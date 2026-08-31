const LIVE_CHAT_PAGE = "https://www.youtube.com/live_chat?v=";

const READY_DEADLINE_MS = 4_000;

const BUNDLE_SCAN_LIMIT = 4_000_000;

/** Without a browser User-Agent `live_chat` answers a 1.4KB stub carrying no script tags
    at all — 200 OK, so it reads as "the icons moved" rather than "we were served the
    no-JS page". With one it is ~227KB. */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface IconChoice {
  set: string;
  icon: string;
  color: string;
}

/** What YouTube's own live-chat bundle draws for each `icon_type`. `OWNER` is absent
    on purpose: YouTube tints the owner's name instead of giving them a badge. */
const WANTED: Record<string, IconChoice> = {
  moderator: { set: "live-chat-badges", icon: "moderator", color: "#5e84f1" },
  verified: {
    set: "yt-sys-icons",
    icon: "check_circle_thick",
    color: "#aaaaaa",
  },
};

class YouTubeBadges {
  private art = new Map<string, string>();

  private loading: Promise<void> | null = null;

  load(videoId: string): Promise<void> {
    if (this.loading) return this.loading;

    this.loading = this.fetchArt(videoId).catch(() => {});

    return this.loading;
  }

  ready(videoId: string): Promise<void> {
    return Promise.race([this.load(videoId), expire(READY_DEADLINE_MS)]);
  }

  lookup(iconType: string): string | null {
    return this.art.get(iconType.toLowerCase()) ?? null;
  }

  private async fetchArt(videoId: string): Promise<void> {
    const bundle = await this.findBundle(videoId);
    if (!bundle) return;

    const wanted = [...new Set(Object.values(WANTED).map((it) => it.set))];
    const source = await readUntilIconsets(bundle, wanted);
    const sets = parseIconsets(source);

    for (const [type, choice] of Object.entries(WANTED)) {
      const found = sets.get(choice.set)?.icons.get(choice.icon);
      if (!found) continue;

      const size = sets.get(choice.set)?.size ?? 24;
      this.art.set(type, dataUri(found, size, choice.color));
    }
  }

  private async findBundle(videoId: string): Promise<string | null> {
    const page = await fetch(`${LIVE_CHAT_PAGE}${encodeURIComponent(videoId)}`, {
      headers: { "User-Agent": BROWSER_UA },
    });
    if (!page.ok) return null;

    const html = await page.text();
    const match = html.match(/src="([^"]*live_chat_polymer[^"]*\.js)"/);
    if (!match) return null;

    return match[1].startsWith("http")
      ? match[1]
      : `https://www.youtube.com${match[1]}`;
  }
}

/** The bundle is ~8MB and the sets sit around 1.4MB in, so the body is streamed and
    abandoned the moment every set we want has closed. Reading it whole costs 8MB for two
    icons; stopping on the first `name=\"` instead stops before the sets even begin. */
async function readUntilIconsets(
  url: string,
  wanted: string[],
): Promise<string> {
  const response = await fetch(url, { headers: { "User-Agent": BROWSER_UA } });
  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder();

  let held = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      held += decoder.decode(value, { stream: true });

      if (held.length > BUNDLE_SCAN_LIMIT) break;
      if (wanted.every((name) => hasClosedSet(held, name))) break;
    }
  } finally {
    void reader.cancel().catch(() => {});
  }

  return held;
}

function hasClosedSet(source: string, name: string): boolean {
  const at = source.indexOf(`name=\\"${name}\\"`);

  return at !== -1 && source.indexOf("</iron-iconset-svg>", at) !== -1;
}

interface IconSet {
  size: number;
  icons: Map<string, string[]>;
}

/** The sets are Polymer `<iron-iconset-svg>` markup carried inside a JS string, so every
    quote arrives backslash-escaped — matching on `d="` finds nothing. */
export function parseIconsets(source: string): Map<string, IconSet> {
  const sets = new Map<string, IconSet>();

  const opening =
    /name=\\"([a-zA-Z0-9_-]+)\\"([^>]*)>[\s\S]*?<svg>([\s\S]*?)<\/iron-iconset-svg>/g;

  for (const match of source.matchAll(opening)) {
    const icons = new Map<string, string[]>();

    for (const group of match[3].matchAll(
      /<g id=\\"([a-zA-Z0-9_-]+)\\"[^>]*>([\s\S]*?)<\/g>/g,
    )) {
      const paths = [...group[2].matchAll(/d=\\"([^\\]+)\\"/g)].map(
        (path) => path[1],
      );

      if (paths.length > 0) icons.set(group[1], paths);
    }

    if (icons.size === 0) continue;

    const size = Number(match[2].match(/size=\\"(\d+)\\"/)?.[1]) || 24;

    sets.set(match[1], { size, icons });
  }

  return sets;
}

export function dataUri(paths: string[], size: number, color: string): string {
  const body = paths
    .map((path) => `<path fill="${color}" d="${path}"/>`)
    .join("");

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">` +
    `${body}</svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function expire(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs).unref());
}

export const youtubeBadges = new YouTubeBadges();
