const SITE = 'https://kick.com'

const READY_DEADLINE_MS = 4_000

const CHUNK_WORKERS = 8

const ICON_MARKER = 'Badge",viewBox:"'

/** Kick's wire type -> the name its own icon set uses. The two disagree on the one that
    matters: the broadcaster's icon is `HostBadge`, so a name match finds nothing and a
    guess from Twitch's shapes puts a camera where Kick draws a microphone. Kick's own
    `{broadcaster:3, moderator:4, ...}` map in the same bundle is what joins them. */
const ICON_NAME: Record<string, string> = {
  broadcaster: 'HostBadge',
  moderator: 'ModeratorBadge',
  vip: 'VIPBadge',
  og: 'OGBadge',
  subscriber: 'SubscriberBadge',
  founder: 'FounderBadge',
  sidekick: 'SidekickBadge',
  verified: 'VerifiedBadge',
  staff: 'StaffBadge',
  bot: 'BotBadge',
}

class KickBadges {
  private art = new Map<string, string>()

  private loading: Promise<void> | null = null

  load(slug: string): Promise<void> {
    if (this.loading) return this.loading

    this.loading = this.fetchArt(slug).catch(() => {})

    return this.loading
  }

  ready(slug: string): Promise<void> {
    return Promise.race([this.load(slug), expire(READY_DEADLINE_MS)])
  }

  lookup(type: string): string | null {
    return this.art.get(type) ?? null
  }

  private async fetchArt(slug: string): Promise<void> {
    const icons = await sweepChunks(slug, new Set(Object.values(ICON_NAME)))

    for (const [type, name] of Object.entries(ICON_NAME)) {
      const icon = icons.get(name)
      if (icon) this.art.set(type, icon)
    }
  }
}

/** The set is split across the ~70 hashed Next chunks, and not all into one — `HostBadge`
    and `VerifiedBadge` sit in different files, so stopping at the first chunk that answers
    silently loses the rest. They are swept concurrently, merged, and abandoned once every
    wanted name is in hand: ~5MB in under a second, once per session and only when a Kick
    channel is open. */
async function sweepChunks(
  slug: string,
  wanted: Set<string>,
): Promise<Map<string, string>> {
  const found = new Map<string, string>()

  const page = await fetch(`${SITE}/${encodeURIComponent(slug)}`)
  if (!page.ok) return found

  const html = await page.text()

  const queue = [
    ...new Set(
      [...html.matchAll(/src="(https:\/\/assets\.kick\.com[^"]+\.js)"/g)].map(
        (match) => match[1],
      ),
    ),
  ]

  const complete = (): boolean => [...wanted].every((name) => found.has(name))

  const sweep = async (): Promise<void> => {
    while (queue.length > 0 && !complete()) {
      const url = queue.shift()
      if (!url) return

      let text: string

      try {
        text = await (await fetch(url)).text()
      } catch {
        continue
      }

      if (!text.includes(ICON_MARKER)) continue

      for (const [name, icon] of parseIcons(text)) {
        if (wanted.has(name) && !found.has(name)) found.set(name, icon)
      }
    }
  }

  await Promise.all(Array.from({ length: CHUNK_WORKERS }, () => sweep()))

  return found
}

/** The founder badge hangs a 240px base64 png off a pattern for a soft-light sheen —
    66KB of its 67KB, and invisible at badge size. */
function stripTexture(body: string): string {
  return body
    .replace(/<path[^>]*mix-blend-mode[^>]*\/>/g, '')
    .replace(/<pattern[\s\S]*?<\/pattern>/g, '')
    .replace(/<image[^>]*\/>/g, '')
}

export function parseIcons(source: string): Map<string, string> {
  const icons = new Map<string, string>()

  const entry =
    /name:"([A-Za-z0-9]+Badge)",viewBox:"([^"]*)",body:'((?:[^'\\]|\\.)*)'/g

  for (const match of source.matchAll(entry)) {
    if (icons.has(match[1])) continue

    const body = stripTexture(match[3].replace(/\\'/g, "'"))

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${match[2]}">` +
      `${body}</svg>`

    icons.set(match[1], `data:image/svg+xml,${encodeURIComponent(svg)}`)
  }

  return icons
}

function expire(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs).unref())
}

export const kickBadges = new KickBadges()
