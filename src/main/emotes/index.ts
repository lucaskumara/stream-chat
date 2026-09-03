import type { EmoteProviderSettings, Fragment, Platform } from '@shared/types'
import { SevenTvEmotes, type SevenTvPlatform } from './seventv'
import { BttvEmotes } from './bttv'
import type { ThirdPartyEmote } from './types'

export type { ThirdPartyEmote } from './types'
export type { SevenTvPlatform } from './seventv'

export interface EmoteBinding {
  platform: SevenTvPlatform

  channelId: string
}

const ALL_ENABLED: EmoteProviderSettings = { sevenTv: true, bttv: true }

/** 7TV calls YouTube "google", not "youtube" — see the same trap noted in seventv.ts. This
    is the one place the app's own Platform meets that naming. */
function toSevenTvPlatform(platform: Platform): SevenTvPlatform {
  return platform === 'youtube' ? 'google' : platform
}

export class ThirdPartyEmotes {
  private seventv = new SevenTvEmotes()
  private bttv = new BttvEmotes()
  private enabled = new Map<SevenTvPlatform, EmoteProviderSettings>()

  /** Settings -> Platforms calls this on every save (and once at startup), keyed by the
      app's own Platform rather than by binding.platform, so a toggle takes effect on the
      very next lookup() with no reconnect. load() deliberately ignores this and always
      fetches both providers — fetching is already cheap and additive, and doing it
      unconditionally is what makes re-enabling a provider instant too. */
  setEnabled(platform: Platform, settings: EmoteProviderSettings): void {
    this.enabled.set(toSevenTvPlatform(platform), settings)
  }

  async load(binding: EmoteBinding): Promise<void> {
    const { platform, channelId } = binding

    await Promise.all([
      this.seventv.loadChannel(platform, channelId),

      platform === 'twitch' ? this.bttv.loadChannel(channelId) : Promise.resolve()
    ])
  }

  lookup(binding: EmoteBinding, name: string): ThirdPartyEmote | undefined {
    const { platform, channelId } = binding
    const settings = this.enabled.get(platform) ?? ALL_ENABLED

    return (
      (settings.sevenTv ? this.seventv.lookup(platform, channelId, name) : undefined) ??
      (platform === 'twitch' && settings.bttv ? this.bttv.lookup(channelId, name) : undefined)
    )
  }
}

export const thirdPartyEmotes = new ThirdPartyEmotes()

export function applyEmotes(
  fragments: Fragment[],
  lookup: (name: string) => ThirdPartyEmote | undefined
): Fragment[] {
  const out: Fragment[] = []

  for (const fragment of fragments) {
    if (fragment.kind !== 'text') out.push(fragment)
    else out.push(...splitOutEmotes(fragment, lookup))
  }

  return out
}

/** Whole tokens only, and case-sensitively: substring matching turns GIGACHAD inside a
    longer word into an image, and folding case collides distinct names. This runs last,
    over text fragments alone, so it cannot disturb a native emote or a link that has
    already been carved out.

    The fragment itself comes back when nothing matched, rather than a copy of it — most
    messages carry no third-party emote at all, so this is the common path and it should
    not allocate. */
function splitOutEmotes(
  fragment: Extract<Fragment, { kind: 'text' }>,
  lookup: (name: string) => ThirdPartyEmote | undefined
): Fragment[] {
  const parts = fragment.text.split(/(\s+)/)
  const out: Fragment[] = []
  let buffer = ''

  for (const part of parts) {
    const emote = part !== '' && !/^\s+$/.test(part) ? lookup(part) : undefined

    if (!emote) {
      buffer += part
      continue
    }

    if (buffer !== '') {
      out.push({ kind: 'text', text: buffer })
      buffer = ''
    }

    out.push({
      kind: 'emote',
      name: emote.name,
      url: emote.url,
      srcSet: emote.srcSet,
      provider: emote.provider
    })
  }

  if (out.length === 0) return [fragment]

  if (buffer !== '') out.push({ kind: 'text', text: buffer })

  return out
}
