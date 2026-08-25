import type { Fragment } from '@shared/types'

/**
 * Deliberately conservative: only obvious links. Applied to text fragments
 * *after* a platform has carved out its own emotes, so this never re-scans
 * content the platform already gave us positions for.
 */
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi

/** Trailing punctuation is almost never part of the URL. */
const TRAILING_PUNCTUATION = /[.,!?)\]}]+$/

/** Splits any URLs out of plain text into link fragments. */
export function splitLinks(text: string): Fragment[] {
  const fragments: Fragment[] = []
  let cursor = 0

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0
    const href = match[0].replace(TRAILING_PUNCTUATION, '')

    if (start > cursor) {
      fragments.push({ kind: 'text', text: text.slice(cursor, start) })
    }
    fragments.push({
      kind: 'link',
      text: href,
      href: href.startsWith('http') ? href : `https://${href}`
    })
    cursor = start + href.length
  }

  if (cursor < text.length) {
    fragments.push({ kind: 'text', text: text.slice(cursor) })
  }
  // Callers rely on empty input still yielding a fragment to append to.
  return fragments.length > 0 ? fragments : [{ kind: 'text', text }]
}
