import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shared/types'
import { authorTerm, matchesSearch, parseSearch, parseTerm, termLabel } from './search'

function message(plainText: string, authorName = 'someone'): ChatMessage {
  return {
    id: 'twitch:src-1:a',
    sourceId: 'src-1',
    platform: 'twitch',
    kind: 'chat',
    authorId: 'author-1',
    authorName,
    fragments: [{ kind: 'text', text: plainText }],
    plainText,
    timestamp: 0
  }
}

describe('parseTerm', () => {
  it('reads a bare word as a content search', () => {
    expect(parseTerm('hello')).toEqual({ field: 'content', needle: 'hello' })
  })

  it('reads author: as an author search', () => {
    expect(parseTerm('author:xqc')).toEqual({ field: 'author', needle: 'xqc' })
  })

  it('treats from: as another spelling of author:', () => {
    expect(parseTerm('from:xqc')).toEqual({ field: 'author', needle: 'xqc' })
  })

  // A prefix only counts if it names a field the filter knows. Otherwise a pasted
  // link would become a search for the "https" field and match nothing.
  it('leaves an unknown prefix as part of a content search', () => {
    expect(parseTerm('https://youtube.com')).toEqual({
      field: 'content',
      needle: 'https://youtube.com'
    })
  })

  it('drops a leading @ from the author needle, so both spellings are one search', () => {
    expect(parseTerm('author:@LofiGirl')).toEqual(parseTerm('author:LofiGirl'))
  })

  it('lowercases the needle', () => {
    expect(parseTerm('Hello')?.needle).toBe('hello')
    expect(parseTerm('author:XQC')?.needle).toBe('xqc')
  })

  it('tolerates space around the field and the needle', () => {
    expect(parseTerm(' author : xqc ')).toEqual({ field: 'author', needle: 'xqc' })
  })

  it('ignores an empty term', () => {
    expect(parseTerm('   ')).toBeNull()
  })

  it('ignores a field prefix with nothing after it', () => {
    expect(parseTerm('author:')).toBeNull()
  })
})

describe('parseSearch', () => {
  it('splits a comma-separated list', () => {
    expect(parseSearch(['def, author:abc'])).toEqual([
      { field: 'content', needle: 'def' },
      { field: 'author', needle: 'abc' }
    ])
  })

  it('reads several inputs as one list, which is how the draft joins the pills', () => {
    expect(parseSearch(['a', 'b'])).toHaveLength(2)
  })

  it('drops the empty pieces a trailing comma leaves behind', () => {
    expect(parseSearch(['a,,b,'])).toHaveLength(2)
  })

  it('answers empty for no input', () => {
    expect(parseSearch([])).toEqual([])
    expect(parseSearch([''])).toEqual([])
  })
})

describe('matchesSearch', () => {
  it('keeps everything when there are no terms', () => {
    expect(matchesSearch(message('anything'), [])).toBe(true)
  })

  it('matches content anywhere in the message', () => {
    expect(matchesSearch(message('well hello there'), parseSearch(['hello']))).toBe(true)
  })

  it('ignores case on both sides', () => {
    expect(matchesSearch(message('HELLO'), parseSearch(['hello']))).toBe(true)
    expect(matchesSearch(message('hello'), parseSearch(['HELLO']))).toBe(true)
  })

  it('ANDs the terms together', () => {
    const terms = parseSearch(['def, author:abc'])

    expect(matchesSearch(message('xdefx', 'abc'), terms)).toBe(true)
    expect(matchesSearch(message('xdefx', 'someone'), terms)).toBe(false)
    expect(matchesSearch(message('nothing', 'abc'), terms)).toBe(false)
  })

  it('matches an author whose name carries an @ against a needle without one', () => {
    expect(matchesSearch(message('hi', '@LofiGirl'), parseSearch(['author:lofigirl']))).toBe(
      true
    )
  })

  it('searches the author name rather than the text for an author term', () => {
    expect(matchesSearch(message('xqc', 'someone'), parseSearch(['author:xqc']))).toBe(false)
  })
})

describe('authorTerm', () => {
  it('builds the term a clicked name filters by', () => {
    expect(authorTerm('xqc')).toBe('author:xqc')
  })

  it('drops the @ a YouTube name carries', () => {
    expect(authorTerm('@LofiGirl')).toBe('author:LofiGirl')
  })

  it('trims before building', () => {
    expect(authorTerm('  xqc  ')).toBe('author:xqc')
  })

  it('round-trips back through the parser', () => {
    expect(parseTerm(authorTerm('@LofiGirl'))).toEqual({
      field: 'author',
      needle: 'lofigirl'
    })
  })
})

describe('termLabel', () => {
  it('shows a content term as typed', () => {
    expect(termLabel('hello')).toBe('hello')
  })

  it('spaces out an author term for the pill', () => {
    expect(termLabel('author:xqc')).toBe('author: xqc')
  })

  it('normalises from: to author: in the pill', () => {
    expect(termLabel('from:xqc')).toBe('author: xqc')
  })

  it('drops the @ in the pill too', () => {
    expect(termLabel('author:@LofiGirl')).toBe('author: LofiGirl')
  })

  it('leaves a pasted link alone', () => {
    expect(termLabel('https://youtube.com')).toBe('https://youtube.com')
  })
})
