import type { ChatMessage } from '@shared/types'
import { PLATFORM_COLOR, type ThemeMode } from './theme'
import type { NameColorMode } from './store'

/** What Twitch's own client picks from when a user never chose a colour. */
const DEFAULT_NAME_COLORS = [
  '#FF0000',
  '#0000FF',
  '#00FF00',
  '#B22222',
  '#FF7F50',
  '#9ACD32',
  '#FF4500',
  '#2E8B57',
  '#DAA520',
  '#D2691E',
  '#5F9EA0',
  '#1E90FF',
  '#FF69B4',
  '#8A2BE2',
  '#00FF7F'
]

const LUMINANCE_FLOOR = 0.4
const LUMINANCE_CEILING = 0.5

const FALLBACK: Record<ThemeMode, string> = { dark: '#a1a1a1', light: '#5f5f5f' }

function luminanceOf(channels: number[]): number {
  return (0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]) / 255
}

function rgb(channels: number[]): string {
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`
}

/** Platform-chosen colours are picked against the site's own background, so half of
    them are illegible on ours. On dark, blend toward white — multiplying channels
    cannot lift #0000FF at all, which is in the palette above. On light, scaling *down*
    is exact: this luminance is linear in the channels, so one factor lands the colour
    on the ceiling and keeps the hue untouched. */
export function readable(hex: string, mode: ThemeMode): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return FALLBACK[mode]

  const channels = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16))
  const luminance = luminanceOf(channels)

  if (mode === 'light') {
    if (luminance <= LUMINANCE_CEILING) return hex

    return rgb(channels.map((value) => Math.round((value * LUMINANCE_CEILING) / luminance)))
  }

  if (luminance >= LUMINANCE_FLOOR) return hex

  const towardsWhite = (LUMINANCE_FLOOR - luminance) / (1 - luminance)

  return rgb(channels.map((value) => Math.round(value + (255 - value) * towardsWhite)))
}

/** 'none' drops colour for the same heading tone the rest of the chrome uses for
    emphasis — not a hardcoded black or white, so it still inverts with the theme.
    'platform' paints every name with its message's own platform colour, lifted or
    darkened the same as any other colour. 'author' (the original, only behaviour
    before the other two existed) prefers a message's own colour, and falls back to
    a hash of the author id the same way Twitch's own client does — main never
    invents one, so the gap is filled here. */
export function nameColor(msg: ChatMessage, mode: ThemeMode, colorMode: NameColorMode): string {
  if (colorMode === 'none') return 'var(--heading)'

  if (colorMode === 'platform') return readable(PLATFORM_COLOR[msg.platform], mode)

  if (msg.authorColor) return readable(msg.authorColor, mode)

  const seed = msg.authorId || msg.authorName
  let hash = 0

  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0

  return readable(DEFAULT_NAME_COLORS[Math.abs(hash) % DEFAULT_NAME_COLORS.length], mode)
}
