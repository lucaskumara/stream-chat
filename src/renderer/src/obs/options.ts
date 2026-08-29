import type { Platform } from '@shared/types'
import { PLATFORMS } from '@shared/types'
import { obsMatchKey, parseObsChatPath } from '@shared/obs'
import { CHAT_FONT_DEFAULT, CHAT_FONT_SIZES } from '../store'

export interface DockOptions {
  platform: Platform
  channel: string

  fontSize: number
  showTimestamps: boolean
  transparent: boolean
}

function flag(params: URLSearchParams, name: string, fallback: boolean): boolean {
  const raw = params.get(name)
  if (raw === null) return fallback

  return raw !== '0' && raw !== 'false'
}

function fontSize(params: URLSearchParams): number {
  const raw = params.get('size')
  if (raw === null) return CHAT_FONT_DEFAULT

  const size = Number(raw)
  if (!Number.isFinite(size) || size <= 0) return CHAT_FONT_DEFAULT

  return CHAT_FONT_SIZES.reduce((best, candidate) =>
    Math.abs(candidate - size) < Math.abs(best - size) ? candidate : best
  )
}

/** The path is the whole contract — /chat/<platform>/<channel>. Query parameters
    only dress the page, so a link that carries none is still a working dock. */
export function readOptions(location: Location): DockOptions | null {
  const params = new URLSearchParams(location.search)
  const fromPath = parseObsChatPath(location.pathname)

  const platform =
    fromPath?.platform ?? PLATFORMS.find((candidate) => candidate === params.get('platform'))
  const channel = fromPath?.key ?? obsMatchKey(params.get('channel') ?? '')

  if (!platform || channel === '') return null

  return {
    platform,
    channel,
    fontSize: fontSize(params),
    showTimestamps: flag(params, 'timestamps', true),
    transparent: flag(params, 'transparent', false)
  }
}
