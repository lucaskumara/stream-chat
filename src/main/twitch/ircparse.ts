/**
 * IRCv3 line parsing for Twitch's chat gateway. Kept pure and dependency-free
 * so it can be unit tested without a socket.
 */

export interface IrcMessage {
  tags: Record<string, string>
  /** Nick from the prefix, when present. */
  nick?: string
  command: string
  params: string[]
  /** The trailing parameter (message text), if any. */
  trailing?: string
}

/** Tag values escape spaces, semicolons and CRLF per IRCv3. */
function unescapeTag(value: string): string {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '\\') {
      out += value[i]
      continue
    }
    const next = value[++i]
    if (next === 's') out += ' '
    else if (next === 'n') out += '\n'
    else if (next === 'r') out += '\r'
    else if (next === ':') out += ';'
    else if (next === '\\') out += '\\'
    else if (next === undefined) break
    else out += next
  }
  return out
}

export function parseIrcLine(line: string): IrcMessage | null {
  if (line === '') return null
  let rest = line

  const tags: Record<string, string> = {}
  if (rest.startsWith('@')) {
    const end = rest.indexOf(' ')
    if (end === -1) return null
    for (const pair of rest.slice(1, end).split(';')) {
      if (pair === '') continue
      const eq = pair.indexOf('=')
      if (eq === -1) tags[pair] = ''
      else tags[pair.slice(0, eq)] = unescapeTag(pair.slice(eq + 1))
    }
    rest = rest.slice(end + 1)
  }

  let nick: string | undefined
  if (rest.startsWith(':')) {
    const end = rest.indexOf(' ')
    if (end === -1) return null
    const prefix = rest.slice(1, end)
    const bang = prefix.indexOf('!')
    nick = bang === -1 ? prefix : prefix.slice(0, bang)
    rest = rest.slice(end + 1)
  }

  // Trailing parameter starts at the first " :" and runs to end of line.
  let trailing: string | undefined
  const trailingAt = rest.indexOf(' :')
  if (rest.startsWith(':')) {
    trailing = rest.slice(1)
    rest = ''
  } else if (trailingAt !== -1) {
    trailing = rest.slice(trailingAt + 2)
    rest = rest.slice(0, trailingAt)
  }

  const parts = rest.split(' ').filter(Boolean)
  const command = parts.shift() ?? ''
  if (command === '') return null

  const result: IrcMessage = { tags, command, params: parts }
  if (nick !== undefined) result.nick = nick
  if (trailing !== undefined) result.trailing = trailing
  return result
}

export interface EmoteSpan {
  id: string
  /** Inclusive code-point offsets into the message text. */
  start: number
  end: number
}

/**
 * Parses the `emotes` tag: `25:0-4,12-16/1902:6-10`.
 *
 * Offsets index code points, not UTF-16 units, which is exactly the trap the
 * fragment design exists to avoid — a message containing an astral emoji would
 * slice apart mid-surrogate if indexed naively. Callers must split the text
 * with [...text] before applying these.
 */
export function parseEmoteTag(tag: string | undefined): EmoteSpan[] {
  if (!tag) return []
  const spans: EmoteSpan[] = []

  for (const group of tag.split('/')) {
    if (group === '') continue
    const colon = group.indexOf(':')
    if (colon === -1) continue
    const id = group.slice(0, colon)

    for (const range of group.slice(colon + 1).split(',')) {
      const dash = range.indexOf('-')
      if (dash === -1) continue
      const start = Number(range.slice(0, dash))
      const end = Number(range.slice(dash + 1))
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue
      spans.push({ id, start, end })
    }
  }

  return spans.sort((a, b) => a.start - b.start)
}

export interface ParsedBadge {
  setId: string
  version: string
}

/** Parses the `badges` tag: `moderator/1,subscriber/12`. */
export function parseBadgeTag(tag: string | undefined): ParsedBadge[] {
  if (!tag) return []
  const out: ParsedBadge[] = []
  for (const entry of tag.split(',')) {
    if (entry === '') continue
    const slash = entry.lastIndexOf('/')
    if (slash === -1) continue
    out.push({ setId: entry.slice(0, slash), version: entry.slice(slash + 1) })
  }
  return out
}
