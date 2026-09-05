import { describe, expect, it } from 'vitest'
import { parseIcons } from '@main/chat/platforms/kick/badges'

function chunk(...entries: string[]): string {
  return `someMinifiedPrelude();${entries.join(',')};tail()`
}

function entry(name: string, body: string, viewBox = '0 0 20 20'): string {
  return `name:"${name}",viewBox:"${viewBox}",body:'${body}'`
}

describe('kick parseIcons', () => {
  it('reads a badge out of the minified chunk', () => {
    const icons = parseIcons(chunk(entry('HostBadge', '<path d="M1 2"/>')))

    expect([...icons.keys()]).toEqual(['HostBadge'])
    expect(icons.get('HostBadge')).toMatch(/^data:image\/svg\+xml,/)
  })

  it("wraps the body in an svg carrying the icon's own viewBox", () => {
    const icons = parseIcons(
      chunk(entry('VIPBadge', '<path d="M1 2"/>', '0 0 32 32')),
    )

    const svg = decodeURIComponent(
      icons.get('VIPBadge')!.replace('data:image/svg+xml,', ''),
    )

    expect(svg).toContain('viewBox="0 0 32 32"')
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('<path d="M1 2"/>')
  })

  it("keeps gradients, which are what make the badges Kick's own", () => {
    const body =
      '<path fill="url(#a)" d="M1 2"/><defs><linearGradient id="a">' +
      '<stop stop-color="#ff1cd2"/></linearGradient></defs>'

    const svg = decodeURIComponent(
      parseIcons(chunk(entry('HostBadge', body)))
        .get('HostBadge')!
        .replace('data:image/svg+xml,', ''),
    )

    expect(svg).toContain('linearGradient')
    expect(svg).toContain('#ff1cd2')
  })

  // The founder badge hangs a 240px base64 png off a pattern for a soft-light sheen:
  // 66KB of its 67KB, and invisible at 17.6px.
  it('strips the raster texture layer', () => {
    const body =
      '<path fill="#feb635" d="M1 2"/>' +
      '<path style="mix-blend-mode:soft-light" fill="url(#d)" d="M3 4"/>' +
      '<defs><pattern id="d"><use href="#e"/></pattern>' +
      '<image href="data:image/png;base64,AAAA" id="e"/></defs>'

    const svg = decodeURIComponent(
      parseIcons(chunk(entry('FounderBadge', body)))
        .get('FounderBadge')!
        .replace('data:image/svg+xml,', ''),
    )

    expect(svg).not.toContain('base64')
    expect(svg).not.toContain('<pattern')
    expect(svg).not.toContain('<image')
    expect(svg).toContain('#feb635')
  })

  it('takes the first definition when a chunk repeats one', () => {
    const icons = parseIcons(
      chunk(
        entry('StaffBadge', '<path d="M1 1"/>'),
        entry('StaffBadge', '<path d="M9 9"/>'),
      ),
    )

    expect(
      decodeURIComponent(icons.get('StaffBadge')!).includes('d="M1 1"'),
    ).toBe(true)
  })

  it('answers empty for a chunk with no icon set', () => {
    expect(parseIcons('nothing to see here').size).toBe(0)
  })
})
