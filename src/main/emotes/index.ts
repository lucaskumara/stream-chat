import type { Fragment } from '@shared/types'
import { SevenTvEmotes, type SevenTvPlatform } from './seventv'
import { BttvEmotes } from './bttv'
import type { ThirdPartyEmote } from './types'

export type { ThirdPartyEmote } from './types'
export type { SevenTvPlatform } from './seventv'

export class ThirdPartyEmotes {
  private seventv = new SevenTvEmotes()
  private bttv = new BttvEmotes()

  async loadGlobals(): Promise<void> {
    await Promise.all([this.seventv.loadGlobal(), this.bttv.loadGlobal()])
  }

  async loadChannel(platform: SevenTvPlatform, channelId: string): Promise<void> {
    await Promise.all([
      this.seventv.loadChannel(platform, channelId),

      platform === 'twitch' ? this.bttv.loadChannel(channelId) : Promise.resolve()
    ])
  }

  lookup(
    platform: SevenTvPlatform,
    channelId: string,
    name: string,
    enabled: { sevenTv: boolean; bttv: boolean } = { sevenTv: true, bttv: true }
  ): ThirdPartyEmote | undefined {
    if (enabled.sevenTv) {
      const hit = this.seventv.lookup(platform, channelId, name)
      if (hit) return hit
    }
    if (enabled.bttv && platform === 'twitch') return this.bttv.lookup(channelId, name)
    return undefined
  }

  counts(platform: SevenTvPlatform, channelId: string): { seventv: number; bttv: number } {
    return {
      seventv: this.seventv.count(platform, channelId),
      bttv: platform === 'twitch' ? this.bttv.count(channelId) : 0
    }
  }
}

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
