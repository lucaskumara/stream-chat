import { describe, expect, it } from 'vitest'
import { OBS_CHAT_PREFIX, obsChatPath, obsMatchKey, parseObsChatPath } from './obs'

describe('obsMatchKey', () => {
  it('drops a leading @ and folds case', () => {
    expect(obsMatchKey('@LofiGirl')).toBe('lofigirl')
    expect(obsMatchKey('LofiGirl')).toBe('lofigirl')
    expect(obsMatchKey('lofigirl')).toBe('lofigirl')
  })

  it('trims before it strips', () => {
    expect(obsMatchKey('  @LofiGirl  ')).toBe('lofigirl')
  })

  it('drops only the first @', () => {
    expect(obsMatchKey('@@x')).toBe('@x')
  })

  it('answers empty for empty input', () => {
    expect(obsMatchKey('   ')).toBe('')
  })
})

describe('obsChatPath', () => {
  it('builds the dock path for a channel', () => {
    expect(obsChatPath('twitch', 'xqc')).toBe(`${OBS_CHAT_PREFIX}twitch/xqc`)
  })

  it('leaves the @ off a handle, so the link is typeable without one', () => {
    expect(obsChatPath('youtube', '@LofiGirl')).toBe(`${OBS_CHAT_PREFIX}youtube/LofiGirl`)
  })

  it('keeps the identifier cased, since the path is matched case-insensitively later', () => {
    expect(obsChatPath('youtube', 'UCSJ4gkVC6NrvII8umztf0Ow')).toContain('UCSJ4gkVC6NrvII8umztf0Ow')
  })

  it('percent-encodes anything that would split the path', () => {
    expect(obsChatPath('kick', 'a/b')).toBe(`${OBS_CHAT_PREFIX}kick/a%2Fb`)
  })
})

describe('parseObsChatPath', () => {
  it('reads the platform and key back out', () => {
    expect(parseObsChatPath('/chat/twitch/xqc')).toEqual({ platform: 'twitch', key: 'xqc' })
  })

  it('treats the three spellings of one channel as the same chat', () => {
    const spellings = ['/chat/youtube/LofiGirl', '/chat/youtube/lofigirl', '/chat/youtube/@LofiGirl']

    for (const spelling of spellings) {
      expect(parseObsChatPath(spelling)).toEqual({ platform: 'youtube', key: 'lofigirl' })
    }
  })

  it('decodes a percent-encoded key', () => {
    expect(parseObsChatPath('/chat/youtube/%40LofiGirl')?.key).toBe('lofigirl')
  })

  it('refuses a path outside the chat prefix', () => {
    expect(parseObsChatPath('/socket')).toBeNull()
    expect(parseObsChatPath('/assets/index.js')).toBeNull()
  })

  it('refuses a platform it does not know', () => {
    expect(parseObsChatPath('/chat/discord/general')).toBeNull()
  })

  it('refuses the wrong number of segments', () => {
    expect(parseObsChatPath('/chat/twitch')).toBeNull()
    expect(parseObsChatPath('/chat/twitch/xqc/extra')).toBeNull()
  })

  it('refuses an empty key', () => {
    expect(parseObsChatPath('/chat/twitch/')).toBeNull()
  })

  it('round-trips whatever obsChatPath builds', () => {
    expect(parseObsChatPath(obsChatPath('youtube', '@LofiGirl'))).toEqual({
      platform: 'youtube',
      key: 'lofigirl'
    })
  })
})
