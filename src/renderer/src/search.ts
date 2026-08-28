import type { ChatMessage } from '@shared/types'

export type SearchField = 'content' | 'author'

export interface SearchTerm {
  field: SearchField
  needle: string
}

const FIELD_PREFIXES: Record<string, SearchField> = {
  author: 'author',
  from: 'author'
}

/** YouTube author names carry a leading @; Twitch and Kick names do not. Dropping
    it makes `author:name` and `author:@name` the same search on every platform. */
function withoutHandlePrefix(name: string): string {
  return name.startsWith('@') ? name.slice(1) : name
}

export function parseTerm(text: string): SearchTerm | null {
  const trimmed = text.trim()
  if (trimmed === '') return null

  const colon = trimmed.indexOf(':')
  if (colon === -1) return { field: 'content', needle: trimmed.toLowerCase() }

  const field = FIELD_PREFIXES[trimmed.slice(0, colon).trim().toLowerCase()]
  if (!field) return { field: 'content', needle: trimmed.toLowerCase() }

  const needle = withoutHandlePrefix(trimmed.slice(colon + 1).trim()).toLowerCase()
  if (needle === '') return null

  return { field, needle }
}

export function parseSearch(inputs: string[]): SearchTerm[] {
  const terms: SearchTerm[] = []

  for (const input of inputs) {
    for (const piece of input.split(',')) {
      const term = parseTerm(piece)
      if (term) terms.push(term)
    }
  }

  return terms
}

export function matchesSearch(message: ChatMessage, terms: SearchTerm[]): boolean {
  for (const term of terms) {
    const haystack = term.field === 'author' ? message.authorName : message.plainText
    if (!haystack.toLowerCase().includes(term.needle)) return false
  }

  return true
}

export function authorTerm(authorName: string): string {
  return `author:${withoutHandlePrefix(authorName.trim())}`
}

export function termLabel(text: string): string {
  const trimmed = text.trim()

  const colon = trimmed.indexOf(':')
  if (colon === -1) return trimmed

  const field = FIELD_PREFIXES[trimmed.slice(0, colon).trim().toLowerCase()]
  if (!field) return trimmed

  return `author: ${withoutHandlePrefix(trimmed.slice(colon + 1).trim())}`
}
