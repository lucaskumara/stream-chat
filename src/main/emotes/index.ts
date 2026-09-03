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

  lookup(binding: EmoteBinding, name: string): ThirdPartyEmote | undefined {
    const { platform, channelId } = binding

    return (
      this.seventv.lookup(platform, channelId, name) ??
      (platform === 'twitch' ? this.bttv.lookup(channelId, name) : undefined)
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
