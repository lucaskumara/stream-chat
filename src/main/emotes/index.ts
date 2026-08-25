import type { Fragment } from '@shared/types'
import { SevenTvEmotes, type SevenTvPlatform } from './seventv'
import { BttvEmotes } from './bttv'
import type { ThirdPartyEmote } from './types'

export type { ThirdPartyEmote } from './types'
export type { SevenTvPlatform } from './seventv'

/**
 * Aggregates the third-party emote providers behind one lookup.
 *
 * Precedence is 7TV then BTTV, matching what most Twitch clients do and what
 * viewers with both extensions installed actually see.
 */
export class ThirdPartyEmotes {
  private seventv = new SevenTvEmotes()
  private bttv = new BttvEmotes()

  /** Warms the global sets so common emotes resolve on the first message. */
  async loadGlobals(): Promise<void> {
    await Promise.all([this.seventv.loadGlobal(), this.bttv.loadGlobal()])
  }

  /** `channelId` is the platform's own id: Twitch room-id, Kick id, YouTube UC…. */
  async loadChannel(platform: SevenTvPlatform, channelId: string): Promise<void> {
    await Promise.all([
      this.seventv.loadChannel(platform, channelId),
      // BTTV is Twitch-only; it keys channels by Twitch user id.
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

/**
 * Replaces whole words in TEXT fragments with third-party emotes.
 *
 * Runs only over text the platform has already finished with, so native emotes,
 * mentions and links are never re-scanned. Matching is whole-token and
 * case-sensitive: substring matching would turn "GIGACHAD" inside a longer word
 * into an image, and lowercasing would collide distinct emote names.
 */
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

    // Capturing split keeps the original spacing intact for the rebuild.
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
    // Nothing matched: keep the original object so referential equality holds.
    if (!replaced && buffer === fragment.text) {
      out[out.length - 1] = fragment
    }
  }

  return out
}
