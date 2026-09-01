import { describe, expect, it, vi } from 'vitest'

const app = {
  userAgentFallback:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'stream-chat/0.0.1 Chrome/140.0.0.0 Electron/44.0.0 Safari/537.36',
  getName: (): string => 'stream-chat'
}

vi.mock('electron', () => ({
  app,
  BrowserWindow: class {},
  session: { fromPartition: () => ({ setUserAgent: () => {} }) }
}))

const { browserUserAgent } = await import('@main/accounts/window')

describe('browserUserAgent', () => {
  // Google refuses its sign-in page to anything advertising itself as an embedded
  // view, and the Electron token is exactly what it matches on. Leaving it in is a
  // "this browser or app may not be secure" wall, not a subtle degradation.
  it('drops the Electron token', () => {
    expect(browserUserAgent()).not.toMatch(/Electron/)
  })

  it('drops our own product token', () => {
    expect(browserUserAgent()).not.toMatch(/stream-chat/)
  })

  it('leaves a plain Chrome user agent behind', () => {
    expect(browserUserAgent()).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/140.0.0.0 Safari/537.36'
    )
  })

  it('collapses the gap both removals leave behind', () => {
    expect(browserUserAgent()).not.toMatch(/ {2}/)
  })

  it('is unchanged when there is nothing to strip', () => {
    const plain = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0 Safari/537.36'

    app.userAgentFallback = plain
    expect(browserUserAgent()).toBe(plain)

    app.userAgentFallback =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'stream-chat/0.0.1 Chrome/140.0.0.0 Electron/44.0.0 Safari/537.36'
  })

  // The app name goes into a RegExp, so a name carrying regex punctuation must not
  // change what the pattern matches.
  it('treats a punctuated app name literally', () => {
    app.getName = (): string => 'stream.chat'
    app.userAgentFallback = 'Mozilla/5.0 streamXchat/1.0 Chrome/140.0.0.0 Safari/537.36'

    expect(browserUserAgent()).toContain('streamXchat/1.0')

    app.getName = (): string => 'stream-chat'
  })
})
