import { afterEach, describe, expect, it } from 'vitest'
import { formatLine, shouldRotate } from '@main/log'
import { secrets } from '@main/redact'

const AT = new Date('2026-09-03T12:34:56.000Z')

afterEach(() => {
  secrets.forget()
})

describe('formatLine', () => {
  it('carries the timestamp, the level and the scope', () => {
    expect(formatLine(AT, 'warn', 'relay', ['kick exited'])).toBe(
      '2026-09-03T12:34:56.000Z WARN  [relay] kick exited'
    )
  })

  it('pads the level so scopes line up down the file', () => {
    const info = formatLine(AT, 'info', 'obs', ['x'])
    const debug = formatLine(AT, 'debug', 'obs', ['x'])

    expect(info.indexOf('[obs]')).toBe(debug.indexOf('[obs]'))
  })

  it('joins several parts with a space, the way console.warn did', () => {
    expect(formatLine(AT, 'info', 'obs', ['chat links on', 'http://localhost:4568'])).toBe(
      '2026-09-03T12:34:56.000Z INFO  [obs] chat links on http://localhost:4568'
    )
  })

  it('renders an Error as its stack rather than as {}', () => {
    const line = formatLine(AT, 'error', 'config', [new TypeError('nope')])

    expect(line).toContain('TypeError: nope')
  })

  it('renders a plain object as JSON', () => {
    expect(formatLine(AT, 'info', 'x', [{ a: 1 }])).toContain('{"a":1}')
  })

  // The whole point of routing every line through one formatter: the lines that leak a
  // key are the ones nobody thought to guard, so scrubbing happens here rather than at
  // each call site.
  it('scrubs a registered secret out of the body', () => {
    secrets.remember('live_99_supersecretkey')

    expect(formatLine(AT, 'warn', 'relay', ['pushing to live_99_supersecretkey'])).toBe(
      '2026-09-03T12:34:56.000Z WARN  [relay] pushing to ••••'
    )
  })

  it('scrubs a key out of an rtmp url that was never registered', () => {
    const line = formatLine(AT, 'warn', 'relay', [
      "kick error opening 'rtmps://x.example.net/app/unregistered-key'"
    ])

    expect(line).not.toContain('unregistered-key')
    expect(line).toContain('rtmps://x.example.net/app/••••')
  })
})

describe('shouldRotate', () => {
  it('holds while the file has room for the line', () => {
    expect(shouldRotate(0, 200)).toBe(false)
    expect(shouldRotate(1024 * 1024, 200)).toBe(false)
  })

  it('rotates once the line would take the file past the cap', () => {
    expect(shouldRotate(2 * 1024 * 1024, 1)).toBe(true)
  })

  it('rotates on the line that crosses, not the one after', () => {
    const cap = 2 * 1024 * 1024

    expect(shouldRotate(cap - 10, 10)).toBe(false)
    expect(shouldRotate(cap - 10, 11)).toBe(true)
  })
})
