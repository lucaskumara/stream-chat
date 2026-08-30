import { describe, expect, it } from 'vitest'
import { parseChannelInput } from './channel'

describe('parseChannelInput', () => {
  describe('links', () => {
    it('reads a twitch channel out of its url', () => {
      expect(parseChannelInput('https://twitch.tv/xqc').ref).toMatchObject({
        platform: 'twitch',
        kind: 'twitch-login',
        value: 'xqc'
      })
    })

    it('skips the popout segment a chat link carries', () => {
      expect(parseChannelInput('https://www.twitch.tv/popout/xqc/chat').ref).toMatchObject({
        kind: 'twitch-login',
        value: 'xqc'
      })
    })

    it('accepts a link with no scheme', () => {
      expect(parseChannelInput('twitch.tv/xqc').ref?.value).toBe('xqc')
    })

    it('reads a kick slug', () => {
      expect(parseChannelInput('https://kick.com/trainwreckstv').ref).toMatchObject({
        platform: 'kick',
        kind: 'kick-slug',
        value: 'trainwreckstv'
      })
    })

    it('reads a youtube watch link', () => {
      expect(parseChannelInput('https://youtube.com/watch?v=jNQXAC9IVRw').ref).toMatchObject({
        platform: 'youtube',
        kind: 'youtube-video-id',
        value: 'jNQXAC9IVRw'
      })
    })

    it('reads a youtube /live/ link', () => {
      expect(parseChannelInput('https://youtube.com/live/jNQXAC9IVRw').ref).toMatchObject({
        kind: 'youtube-video-id',
        value: 'jNQXAC9IVRw'
      })
    })

    it('reads a youtu.be short link', () => {
      expect(parseChannelInput('https://youtu.be/jNQXAC9IVRw').ref).toMatchObject({
        kind: 'youtube-video-id',
        value: 'jNQXAC9IVRw'
      })
    })

    it('reads a youtube handle url', () => {
      expect(parseChannelInput('https://youtube.com/@LofiGirl').ref).toMatchObject({
        kind: 'youtube-handle',
        value: '@LofiGirl'
      })
    })

    it('reads a youtube channel-id url', () => {
      expect(
        parseChannelInput('https://youtube.com/channel/UCSJ4gkVC6NrvII8umztf0Ow').ref
      ).toMatchObject({ kind: 'youtube-channel-id', value: 'UCSJ4gkVC6NrvII8umztf0Ow' })
    })

    it('lowercases a twitch login but leaves a youtube handle cased', () => {
      expect(parseChannelInput('https://twitch.tv/XQC').ref?.value).toBe('xqc')
      expect(parseChannelInput('https://youtube.com/@LofiGirl').ref?.value).toBe('@LofiGirl')
    })

    it('rejects a platform link with nothing after the host', () => {
      const result = parseChannelInput('https://twitch.tv/')

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/no channel name/i)
    })

    it('rejects a youtube link with no channel or video in it', () => {
      expect(parseChannelInput('https://youtube.com/feed/subscriptions').ok).toBe(false)
    })

    it('falls through to the bare-name path for a host it does not know', () => {
      expect(parseChannelInput('example.com/xqc').needsPlatform).toBe(true)
    })
  })

  describe('platform prefixes', () => {
    it('accepts a colon prefix', () => {
      expect(parseChannelInput('kick:xqc').ref).toMatchObject({
        platform: 'kick',
        value: 'xqc'
      })
    })

    it('accepts a slash prefix and surrounding space', () => {
      expect(parseChannelInput('twitch / xqc').ref).toMatchObject({
        platform: 'twitch',
        value: 'xqc'
      })
    })

    it('ignores the case of the prefix', () => {
      expect(parseChannelInput('TWITCH:XQC').ref).toMatchObject({
        platform: 'twitch',
        value: 'xqc'
      })
    })

    it('beats the platform hint with the prefix', () => {
      expect(parseChannelInput('kick:xqc', 'twitch').ref?.platform).toBe('kick')
    })
  })

  describe('self-describing names', () => {
    it('recognises an @handle with no platform picked', () => {
      expect(parseChannelInput('@LofiGirl').ref).toMatchObject({
        platform: 'youtube',
        kind: 'youtube-handle',
        value: '@LofiGirl'
      })
    })

    it('recognises a UC channel id with no platform picked', () => {
      expect(parseChannelInput('UCSJ4gkVC6NrvII8umztf0Ow').ref).toMatchObject({
        platform: 'youtube',
        kind: 'youtube-channel-id'
      })
    })
  })

  describe('bare names', () => {
    it('asks for a platform when the name says nothing about itself', () => {
      const result = parseChannelInput('xqc')

      expect(result.ok).toBe(false)
      expect(result.needsPlatform).toBe(true)
    })

    it('takes a twitch login once a platform is picked', () => {
      expect(parseChannelInput('xqc', 'twitch').ref).toMatchObject({
        kind: 'twitch-login',
        value: 'xqc'
      })
    })

    it('builds a handle out of a bare youtube name', () => {
      expect(parseChannelInput('LofiGirl', 'youtube').ref).toMatchObject({
        kind: 'youtube-handle',
        value: '@LofiGirl'
      })
    })

    it('takes a bare 11-character youtube video id', () => {
      expect(parseChannelInput('jNQXAC9IVRw', 'youtube').ref).toMatchObject({
        kind: 'youtube-video-id',
        value: 'jNQXAC9IVRw'
      })
    })

    it('holds twitch to 3-25 characters', () => {
      expect(parseChannelInput('ab', 'twitch').ok).toBe(false)
      expect(parseChannelInput('a'.repeat(26), 'twitch').ok).toBe(false)
      expect(parseChannelInput('a'.repeat(25), 'twitch').ok).toBe(true)
    })

    it('holds kick to 2-25 characters', () => {
      expect(parseChannelInput('a', 'kick').ok).toBe(false)
      expect(parseChannelInput('ab', 'kick').ok).toBe(true)
      expect(parseChannelInput('a'.repeat(26), 'kick').ok).toBe(false)
    })

    it('holds a youtube handle to 3-30 characters after the @', () => {
      expect(parseChannelInput('ab', 'youtube').ok).toBe(false)
      expect(parseChannelInput('a'.repeat(31), 'youtube').ok).toBe(false)
      expect(parseChannelInput('a'.repeat(30), 'youtube').ok).toBe(true)
    })

    it('rejects a twitch login carrying a character the platform does not allow', () => {
      const result = parseChannelInput('xq-c', 'twitch')

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/not a valid Twitch channel name/)
    })

    it('allows a hyphen in a kick slug', () => {
      expect(parseChannelInput('train-wrecks', 'kick').ok).toBe(true)
    })
  })

  it('refuses empty input', () => {
    expect(parseChannelInput('   ').ok).toBe(false)
    expect(parseChannelInput('').error).toMatch(/Enter a channel name/)
  })

  it('trims the input before reading it', () => {
    expect(parseChannelInput('  xqc  ', 'twitch').ref?.value).toBe('xqc')
  })

  it('labels a ref with its own value', () => {
    const ref = parseChannelInput('xqc', 'twitch').ref

    expect(ref?.label).toBe(ref?.value)
  })
})
