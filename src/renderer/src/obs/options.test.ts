import { describe, expect, it } from 'vitest'
import { CHAT_FONT_DEFAULT, CHAT_FONT_SIZES } from '../store'
import { readOptions } from './options'

function at(pathname: string, search = ''): Location {
  return { pathname, search } as Location
}

describe('readOptions', () => {
  describe('the path, which is the whole contract', () => {
    it('reads the platform and channel out of the path', () => {
      expect(readOptions(at('/chat/twitch/xqc'))).toMatchObject({
        platform: 'twitch',
        channel: 'xqc'
      })
    })

    it('folds the channel to the same key however the link is spelled', () => {
      for (const path of ['/chat/youtube/LofiGirl', '/chat/youtube/@lofigirl']) {
        expect(readOptions(at(path))?.channel).toBe('lofigirl')
      }
    })

    it('works with no query string at all', () => {
      expect(readOptions(at('/chat/kick/xqc'))).toEqual({
        platform: 'kick',
        channel: 'xqc',
        fontSize: CHAT_FONT_DEFAULT,
        showTimestamps: true,
        transparent: false
      })
    })

    it('falls back to query parameters when the path carries no target', () => {
      expect(readOptions(at('/', '?platform=twitch&channel=xqc'))).toMatchObject({
        platform: 'twitch',
        channel: 'xqc'
      })
    })

    it('answers null without a platform', () => {
      expect(readOptions(at('/', '?channel=xqc'))).toBeNull()
    })

    it('answers null without a channel', () => {
      expect(readOptions(at('/', '?platform=twitch'))).toBeNull()
    })

    it('answers null for a platform it does not know', () => {
      expect(readOptions(at('/', '?platform=discord&channel=general'))).toBeNull()
    })
  })

  describe('size', () => {
    it('defaults when the link carries no size', () => {
      expect(readOptions(at('/chat/twitch/xqc'))?.fontSize).toBe(CHAT_FONT_DEFAULT)
    })

    it('takes a size that is already on the scale', () => {
      expect(readOptions(at('/chat/twitch/xqc', '?size=20'))?.fontSize).toBe(20)
    })

    it('snaps a size between two steps to the nearest one', () => {
      expect(readOptions(at('/chat/twitch/xqc', '?size=19'))?.fontSize).toBe(18)
      expect(readOptions(at('/chat/twitch/xqc', '?size=21'))?.fontSize).toBe(20)
    })

    it('clamps a size past either end of the scale', () => {
      expect(readOptions(at('/chat/twitch/xqc', '?size=999'))?.fontSize).toBe(
        CHAT_FONT_SIZES[CHAT_FONT_SIZES.length - 1]
      )
      expect(readOptions(at('/chat/twitch/xqc', '?size=1'))?.fontSize).toBe(
        CHAT_FONT_SIZES[0]
      )
    })

    // Number(null) is 0 and Number.isFinite(0) is true, so a finiteness guard alone
    // snapped every dock to the smallest font on the scale.
    it('defaults rather than snapping to the smallest font for a zero or negative size', () => {
      expect(readOptions(at('/chat/twitch/xqc', '?size=0'))?.fontSize).toBe(CHAT_FONT_DEFAULT)
      expect(readOptions(at('/chat/twitch/xqc', '?size=-5'))?.fontSize).toBe(
        CHAT_FONT_DEFAULT
      )
    })

    it('defaults for a size that is not a number', () => {
      expect(readOptions(at('/chat/twitch/xqc', '?size=big'))?.fontSize).toBe(
        CHAT_FONT_DEFAULT
      )
    })
  })

  describe('flags', () => {
    it('shows timestamps unless the link turns them off', () => {
      expect(readOptions(at('/chat/twitch/xqc'))?.showTimestamps).toBe(true)
      expect(readOptions(at('/chat/twitch/xqc', '?timestamps=0'))?.showTimestamps).toBe(false)
      expect(readOptions(at('/chat/twitch/xqc', '?timestamps=false'))?.showTimestamps).toBe(
        false
      )
    })

    it('treats any other value as on', () => {
      expect(readOptions(at('/chat/twitch/xqc', '?timestamps=1'))?.showTimestamps).toBe(true)
      expect(readOptions(at('/chat/twitch/xqc', '?timestamps='))?.showTimestamps).toBe(true)
    })

    // transparent=1 is what makes the same URL usable as an on-stream browser source
    // rather than a dock, so it has to default the other way.
    it('is opaque unless the link asks for transparency', () => {
      expect(readOptions(at('/chat/twitch/xqc'))?.transparent).toBe(false)
      expect(readOptions(at('/chat/twitch/xqc', '?transparent=1'))?.transparent).toBe(true)
    })
  })
})
