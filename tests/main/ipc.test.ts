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
  parsePlatformPatch,
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

describe('parsePlatformPatch', () => {
  it('reads the three fields', () => {
    expect(
      parsePlatformPatch({ channel: 'excorpse', ingestUrl: 'rtmp://x', streamKey: 'k' })
    ).toEqual({ channel: 'excorpse', ingestUrl: 'rtmp://x', streamKey: 'k' })
  })

  // The renderer is never given the stream key back, so it saves a channel by sending
  // that field alone — an absent field must mean "leave it", not "clear it".
  it('carries only the fields that were sent', () => {
    expect(parsePlatformPatch({ channel: 'excorpse' })).toEqual({ channel: 'excorpse' })
  })

  it('accepts an empty patch', () => {
    expect(parsePlatformPatch({})).toEqual({})
  })

  // A stream key copied out of a dashboard drags whitespace in more often than not.
  it('trims every field', () => {
    expect(parsePlatformPatch({ streamKey: '  live_123  ' })).toEqual({ streamKey: 'live_123' })
  })

  it('lets an empty string through, which is how a field is cleared', () => {
    expect(parsePlatformPatch({ streamKey: '' })).toEqual({ streamKey: '' })
  })

  it('refuses a non-string field', () => {
    expect(() => parsePlatformPatch({ channel: 7 })).toThrow(/channel must be a string/)
  })

  it('refuses a patch that is not an object', () => {
    for (const value of [null, undefined, 'twitch', 7]) {
      expect(() => parsePlatformPatch(value)).toThrow(/must be an object/)
    }
  })

  it('ignores fields it does not know', () => {
    expect(parsePlatformPatch({ channel: 'x', nonsense: 'y' })).toEqual({ channel: 'x' })
  })

  it('reads the forward switch', () => {
    expect(parsePlatformPatch({ forward: true })).toEqual({ forward: true })
    expect(parsePlatformPatch({ forward: false })).toEqual({ forward: false })
  })

  // The renderer is untrusted, and a truthy string here would silently switch forwarding
  // on for a platform the user did not pick.
  it('refuses a forward that is not a boolean', () => {
    expect(() => parsePlatformPatch({ forward: 'yes' })).toThrow(/must be a boolean/)
    expect(() => parsePlatformPatch({ forward: 1 })).toThrow(/must be a boolean/)
  })

  it('reads the emote provider toggles', () => {
    expect(parsePlatformPatch({ emoteProviders: { sevenTv: true, bttv: false } })).toEqual({
      emoteProviders: { sevenTv: true, bttv: false }
    })
  })

  it('leaves emoteProviders out when the patch does not carry it', () => {
    expect(parsePlatformPatch({ channel: 'x' })).toEqual({ channel: 'x' })
  })

  it('refuses an emoteProviders that is not an object', () => {
    expect(() => parsePlatformPatch({ emoteProviders: true })).toThrow(/emoteProviders must be an object/)
    expect(() => parsePlatformPatch({ emoteProviders: null })).toThrow(/emoteProviders must be an object/)
  })

  // A patch always carries the whole toggle pair — no partial-object merge inside main —
  // so a caller that forgets one flag must fail loudly rather than silently flip it on.
  it('refuses an emoteProviders missing either flag', () => {
    expect(() => parsePlatformPatch({ emoteProviders: { sevenTv: true } })).toThrow(
      /emoteProviders.sevenTv and emoteProviders.bttv must be booleans/
    )
    expect(() => parsePlatformPatch({ emoteProviders: { bttv: true } })).toThrow(
      /emoteProviders.sevenTv and emoteProviders.bttv must be booleans/
    )
  })

  it('refuses an emoteProviders with non-boolean flags', () => {
    expect(() =>
      parsePlatformPatch({ emoteProviders: { sevenTv: 'yes', bttv: false } })
    ).toThrow(/must be booleans/)
  })
})
