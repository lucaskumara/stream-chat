import type { Fragment } from '@shared/types'

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi

const TRAILING_PUNCTUATION = /[.,!?)\]}]+$/

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
      href: href.startsWith('http') ? href : `https://${href}`,
    })
    cursor = start + href.length
  }

  if (cursor < text.length) {
    fragments.push({ kind: 'text', text: text.slice(cursor) })
  }

  return fragments.length > 0 ? fragments : [{ kind: 'text', text }]
}
