import { describe, expect, it } from 'vitest'
import { KICK_BADGE_ICON } from '@/components/badge-art'

function svgOf(uri: string): string {
  return decodeURIComponent(uri.replace('data:image/svg+xml,', ''))
}

const entries = Object.entries(KICK_BADGE_ICON)

describe('Kick badge art', () => {
  // The broadcaster is the reason this file exists: Kick's icon is a microphone, its icon
  // set calls it HostBadge, and guessing from Twitch's camera is what got it wrong.
  it('covers the role badges Kick ships no image url for', () => {
    for (const type of [
      'broadcaster',
      'moderator',
      'vip',
      'og',
      'subscriber',
      'founder',
      'sidekick',
      'verified',
      'staff',
      'bot'
    ]) {
      expect(KICK_BADGE_ICON[type], type).toBeTruthy()
    }
  })

  it.each(entries)('%s is a data uri holding one svg', (_type, uri) => {
    expect(uri.startsWith('data:image/svg+xml,')).toBe(true)

    const svg = svgOf(uri)
    expect(svg.startsWith('<svg ')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
  })

  // An <img> is its own document, so nothing outside the uri can be referenced. A gradient
  // whose def was stripped renders the shape black rather than failing loudly.
  it.each(entries)('%s resolves every url(#…) it references', (_type, uri) => {
    const svg = svgOf(uri)

    const referenced = [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1])
    const defined = [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])

    for (const id of referenced) expect(defined, id).toContain(id)
  })

  // The founder badge hangs a 240px base64 png off a pattern for a soft-light sheen: 66KB
  // of its 67KB, invisible at 17.6px, and the whole reason these stay small.
  it.each(entries)('%s carries no raster texture', (_type, uri) => {
    const svg = svgOf(uri)

    expect(svg).not.toContain('<image')
    expect(svg).not.toContain('<pattern')
    expect(svg).not.toContain('base64')
    expect(uri.length).toBeLessThan(5000)
  })
})
