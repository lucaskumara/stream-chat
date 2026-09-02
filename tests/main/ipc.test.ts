import { describe, expect, it, vi } from 'vitest'

// The renderer is untrusted by construction — it renders remote chat content — so
// every handler validates its own arguments rather than trusting the preload.
// Only the validators are under test here, so electron itself is a stub.
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => null },
  clipboard: { writeText: () => {} },
  ipcMain: { handle: () => {}, removeHandler: () => {} },
  shell: { openExternal: async () => {} }
}))

const {
  parseAddSource,
  parseMessageText,
  parseWatchTarget,
  parsePlatform,
  parseSourceIds,
  parseWebUrl,
  requireString
} = await import('@main/ipc')

describe('requireString', () => {
  it('passes a string through', () => {
    expect(requireString('x', 'field')).toBe('x')
  })

  it('names the field it refused', () => {
    expect(() => requireString(7, 'sourceId')).toThrow(/sourceId must be a string/)
  })

  it('refuses null, undefined and objects alike', () => {
    for (const value of [null, undefined, {}, [], 0, true]) {
      expect(() => requireString(value, 'field')).toThrow()
    }
  })
})

describe('parseSourceIds', () => {
  it('accepts an array of strings', () => {
    expect(parseSourceIds(['src-1', 'src-2'])).toEqual(['src-1', 'src-2'])
  })

  it('accepts an empty array', () => {
    expect(parseSourceIds([])).toEqual([])
  })

  it('refuses anything that is not an array', () => {
    expect(() => parseSourceIds('src-1')).toThrow(/must be an array/)
  })

  it('points at the entry that was not a string', () => {
    expect(() => parseSourceIds(['src-1', 7])).toThrow(/orderedIds\[1\]/)
  })
})

describe('parseWebUrl', () => {
  it('accepts http and https', () => {
    expect(parseWebUrl('https://example.com')).toBe('https://example.com/')
    expect(parseWebUrl('http://example.com')).toBe('http://example.com/')
  })

  // openExternal hands this to the OS. A file: url or a custom protocol handler is
  // exactly what an untrusted renderer would reach for.
  it('refuses every protocol but http and https', () => {
    for (const url of [
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'ms-settings:',
      'steam://run/1'
    ]) {
      expect(() => parseWebUrl(url)).toThrow(/refusing to open protocol/)
    }
  })

  it('refuses a string that is not a url at all', () => {
    expect(() => parseWebUrl('not a url')).toThrow(/invalid url/)
  })

  it('names the field when handed a non-string, rather than reporting a bad url', () => {
    for (const value of [null, undefined, 7, {}]) {
      expect(() => parseWebUrl(value)).toThrow(/url must be a string/)
    }
  })
})

describe('parsePlatform', () => {
  it('accepts each platform the app knows', () => {
    for (const platform of ['twitch', 'youtube', 'kick']) {
      expect(parsePlatform(platform)).toBe(platform)
    }
  })

  it('refuses anything else, and says what it was given', () => {
    expect(() => parsePlatform('discord')).toThrow(/unknown platform: discord/)
    expect(() => parsePlatform(undefined)).toThrow(/unknown platform/)
  })
})

describe('parseAddSource', () => {
  it('reads a well-formed request', () => {
    expect(parseAddSource({ platform: 'twitch', label: 'xQc', identifier: 'xqc' })).toEqual({
      platform: 'twitch',
      label: 'xQc',
      identifier: 'xqc'
    })
  })

  it('trims the identifier', () => {
    expect(parseAddSource({ platform: 'kick', identifier: '  xqc  ' }).identifier).toBe('xqc')
  })

  it('treats a missing label as empty rather than failing', () => {
    expect(parseAddSource({ platform: 'twitch', identifier: 'xqc' }).label).toBe('')
  })

  it('caps the label and the identifier', () => {
    const parsed = parseAddSource({
      platform: 'twitch',
      label: 'a'.repeat(200),
      identifier: 'b'.repeat(200)
    })

    expect(parsed.label).toHaveLength(80)
    expect(parsed.identifier).toHaveLength(100)
  })

  it('refuses a request with no identifier', () => {
    expect(() => parseAddSource({ platform: 'twitch' })).toThrow(/need a channel identifier/)
    expect(() => parseAddSource({ platform: 'twitch', identifier: '   ' })).toThrow(
      /need a channel identifier/
    )
  })

  it('refuses a request that is not an object', () => {
    for (const value of [null, undefined, 'twitch', 7]) {
      expect(() => parseAddSource(value)).toThrow(/must be an object/)
    }
  })

  it('checks the platform before anything else', () => {
    expect(() => parseAddSource({ platform: 'discord', identifier: 'x' })).toThrow(
      /unknown platform/
    )
  })
})

describe('parseMessageText', () => {
  it('trims surrounding whitespace', () => {
    expect(parseMessageText('  hello  ')).toBe('hello')
  })

  it('refuses a message that is empty or only whitespace', () => {
    for (const value of ['', '   ', '\n\t']) {
      expect(() => parseMessageText(value)).toThrow(/empty/)
    }
  })

  it('refuses a non-string', () => {
    for (const value of [null, undefined, 7, {}, []]) {
      expect(() => parseMessageText(value)).toThrow()
    }
  })

  // Twitch caps a message at 500 characters, so main clamps rather than trusting the
  // renderer to have done it and spending a request to be told no.
  it('clamps to the platform limit', () => {
    expect(parseMessageText('x'.repeat(600))).toHaveLength(500)
  })

  it('leaves a message at the limit untouched', () => {
    expect(parseMessageText('x'.repeat(500))).toHaveLength(500)
  })
})

describe('parseWatchTarget', () => {
  // Null is the normal state: no override, so the pane shows the account's own channel.
  it('treats null and undefined as "back to my own channel"', () => {
    expect(parseWatchTarget(null)).toBeNull()
    expect(parseWatchTarget(undefined)).toBeNull()
  })

  it('treats an empty or blank string the same way', () => {
    expect(parseWatchTarget('')).toBeNull()
    expect(parseWatchTarget('   ')).toBeNull()
  })

  it('trims a channel name', () => {
    expect(parseWatchTarget('  lofigirl  ')).toBe('lofigirl')
  })

  it('refuses a non-string that is not null', () => {
    for (const value of [7, {}, [], true]) {
      expect(() => parseWatchTarget(value)).toThrow()
    }
  })

  it('clamps an absurdly long identifier', () => {
    expect(parseWatchTarget('x'.repeat(500))).toHaveLength(100)
  })
})
