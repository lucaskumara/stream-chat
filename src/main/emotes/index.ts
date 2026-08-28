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
    if (fragment.kind !== 'text') {
      out.push(fragment)
      continue
    }

    const parts = fragment.text.split(/(\s+)/)
    let buffer = ''
    let replaced = false

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
      replaced = true
    }

    if (buffer !== '') out.push({ kind: 'text', text: buffer })

    if (!replaced && buffer === fragment.text) {
      out[out.length - 1] = fragment
    }
  }

  return out
}
