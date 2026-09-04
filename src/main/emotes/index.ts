import type { Fragment } from '@shared/types'
import { SevenTvEmotes, type SevenTvPlatform } from './seventv'
import { BttvEmotes } from './bttv'
import type { ThirdPartyEmote } from './types'

export type { ThirdPartyEmote } from './types'
export type { SevenTvPlatform } from './seventv'

export interface EmoteBinding {
  platform: SevenTvPlatform

  channelId: string
}

export class ThirdPartyEmotes {
  private seventv = new SevenTvEmotes()
  private bttv = new BttvEmotes()

  async load(binding: EmoteBinding): Promise<void> {
    const { platform, channelId } = binding

    await Promise.all([
      this.seventv.loadChannel(platform, channelId),

      platform === 'twitch' ? this.bttv.loadChannel(channelId) : Promise.resolve()
    ])
  }

  /** Every provider's match for this name, in priority order (7TV first, then Twitch-only
      BTTV) — not just the one lookup() used to prefer. An earlier version gated this by a
      per-platform enabled setting (Settings -> Platforms' toggles, pushed in via a since-
      removed setEnabled), so a name both providers had was still only ever resolved to
      whichever one happened to be enabled, and the fragment built from it carried nothing
      to fall back to. Filtering now happens in the renderer instead — see
      src/renderer/src/emotes.ts's selectEmote — off every match here rather than the one
      main used to pick, so toggling live can choose a different one without a reconnect. */
  lookup(binding: EmoteBinding, name: string): ThirdPartyEmote[] {
    const { platform, channelId } = binding
    const matches: ThirdPartyEmote[] = []

    const sevenTv = this.seventv.lookup(platform, channelId, name)
    if (sevenTv) matches.push(sevenTv)

    if (platform === 'twitch') {
      const bttv = this.bttv.lookup(channelId, name)
      if (bttv) matches.push(bttv)
    }

    return matches
  }
}

export const thirdPartyEmotes = new ThirdPartyEmotes()

export function applyEmotes(
  fragments: Fragment[],
  lookup: (name: string) => ThirdPartyEmote[]
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
  lookup: (name: string) => ThirdPartyEmote[]
): Fragment[] {
  const parts = fragment.text.split(/(\s+)/)
  const out: Fragment[] = []
  let buffer = ''

  for (const part of parts) {
    const matches = part !== '' && !/^\s+$/.test(part) ? lookup(part) : []

    if (matches.length === 0) {
      buffer += part
      continue
    }

    if (buffer !== '') {
      out.push({ kind: 'text', text: buffer })
      buffer = ''
    }

    const [primary, ...rest] = matches

    out.push({
      kind: 'emote',
      name: primary.name,
      url: primary.url,
      srcSet: primary.srcSet,
      provider: primary.provider,
      ...(rest.length > 0 && {
        alternates: rest.map((match) => ({
          provider: match.provider,
          url: match.url,
          srcSet: match.srcSet
        }))
      })
    })
  }

  if (out.length === 0) return [fragment]

  if (buffer !== '') out.push({ kind: 'text', text: buffer })

  return out
}
