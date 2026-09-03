import { beforeEach, describe, expect, it } from 'vitest'
import { Secrets, secrets } from '@main/redact'

// This app's own window ends up on stream, and ffmpeg prints the destination URL —
// stream key and all — on stderr, which is logged, stored on the destination and drawn
// in the Broadcast view. Everything outbound goes through `scrub`.

describe('Secrets.scrub', () => {
  let keys: Secrets

  beforeEach(() => {
    keys = new Secrets()
  })

  it('masks a registered value wherever it appears', () => {
    keys.remember('live_12345_abcdefghijklmnop')

    expect(keys.scrub('pushing to live_12345_abcdefghijklmnop now')).toBe(
      'pushing to •••• now'
    )
  })

  it('masks every occurrence, not just the first', () => {
    keys.remember('sk-secret-value')

    expect(keys.scrub('sk-secret-value and sk-secret-value')).toBe('•••• and ••••')
  })

  it('leaves text with no secret in it untouched', () => {
    keys.remember('sk-secret-value')

    expect(keys.scrub('frame=  120 fps= 30 size=    2048kB')).toBe(
      'frame=  120 fps= 30 size=    2048kB'
    )
  })

  // The case that matters: ffmpeg quotes the URL it failed on before the key was ever
  // registered — a key typed into the ingest field still reaches a destination process.
  it('masks the last path segment of an rtmp url even for an unregistered key', () => {
    expect(
      keys.scrub("error opening 'rtmps://ingest.example.net/app/never-seen-before'")
    ).toBe("error opening 'rtmps://ingest.example.net/app/••••'")
  })

  it('masks the key in an rtmp url on the plain rtmp scheme too', () => {
    expect(keys.scrub('rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl-mnop')).toBe(
      'rtmp://a.rtmp.youtube.com/live2/••••'
    )
  })

  it('does not mask a url that has no key segment', () => {
    expect(keys.scrub('rtmp://localhost:1935/live')).toBe('rtmp://localhost:1935/live')
  })

  // Below the floor a "secret" is more likely to be ordinary text than the value, and
  // blanking it would corrupt every line it appears in.
  it('ignores a value too short to be a key', () => {
    keys.remember('live')

    expect(keys.scrub('the stream is live')).toBe('the stream is live')
  })

  it('ignores empty and whitespace-only values', () => {
    keys.remember('')
    keys.remember('   ')
    keys.remember(undefined)
    keys.remember(null)

    expect(keys.scrub('nothing to hide here')).toBe('nothing to hide here')
  })

  it('treats a value with regex metacharacters literally', () => {
    keys.remember('a+b(c)[d].*')

    expect(keys.scrub('key a+b(c)[d].* here')).toBe('key •••• here')
    expect(keys.scrub('key aab here')).toBe('key aab here')
  })

  it('forgets everything on clear', () => {
    keys.remember('sk-secret-value')
    keys.forget()

    expect(keys.scrub('sk-secret-value')).toBe('sk-secret-value')
  })
})

describe('Secrets.preview', () => {
  it('keeps the last four characters so two keys can be told apart', () => {
    expect(Secrets.preview('live_12345_abcdefgh')).toBe('••••efgh')
  })

  it('reveals nothing at all from a value too short to spare any', () => {
    expect(Secrets.preview('abcd')).toBe('••••')
  })
})

describe('the shared instance', () => {
  it('is a Secrets', () => {
    expect(secrets).toBeInstanceOf(Secrets)
  })
})
