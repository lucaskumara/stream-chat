import type { Badge, ChatMessage, Fragment, MessageKind, Platform } from './types'

export const MOCK_PLATFORMS: Platform[] = ['twitch', 'youtube', 'kick']

const NAMES = [
  'xQcOW', 'pokimane', 'sodapoppin', 'nmplol', 'Mizkif', 'Emiru', 'Hasanabi',
  'lirik', 'summit1g', 'shroud', 'TimTheTatman', 'DrLupo', 'Sykkuno', 'Valkyrae',
  'Ludwig', 'QTCinderella', 'Trainwreck', 'Adin_Ross', 'Amouranth', 'Asmongold',
  'Forsen', 'Nymn', 'Vedal987', 'Neuro_sama', 'Jerma985', 'DougDoug', 'Atrioc'
]

const COLORS = [
  '#FF4A80', '#00D2FF', '#7CFF4A', '#FFB84A', '#B44AFF',
  '#4AFFD2', '#FF6B4A', '#4A8CFF', '#FFE74A', '#FF4AE0'
]

const WORDS = [
  'LUL', 'KEKW', 'Pog', 'PogChamp', 'monkaS', 'OMEGALUL', 'Sadge', 'EZ', 'Clap',
  'that was insane', 'no way', 'gg', 'first', 'chat is this real', 'W streamer',
  'L take', 'copium', 'based', 'ratio', 'actually cracked', 'holy', 'lets go',
  'im dead', 'nah thats crazy', 'he did not just do that', 'clip it', 'peak',
  'seven', 'malding', 'KEKL', 'this is fine', 'source?', 'buffering again'
]

const EMOTES: Record<string, string> = {
  LUL: 'https://static-cdn.jtvnw.net/emoticons/v2/425618/default/dark/1.0',
  KEKW: 'https://cdn.7tv.app/emote/01F6MZGCNG000255KH7C1SGWX1/1x.webp',
  Pog: 'https://cdn.7tv.app/emote/01F6MADQ7G000FFM4H7C4BAJ0A/1x.webp',
  PogChamp: 'https://static-cdn.jtvnw.net/emoticons/v2/305954156/default/dark/1.0',
  monkaS: 'https://cdn.7tv.app/emote/01F6ME5CBR000255KH7C4BFRV6/1x.webp',
  OMEGALUL: 'https://cdn.7tv.app/emote/01F6MDMH1000059T1QVE4S3JMD/1x.webp',
  Sadge: 'https://cdn.7tv.app/emote/01F6MZGCNG000255KH7C1SGWX1/1x.webp'
}

const LINKS = [
  'https://clips.twitch.tv/AbrasiveSpicyOtterKappa',
  'https://youtu.be/dQw4w9WgXcQ',
  'https://github.com/lucaskumara/stream-chat'
]

const BADGE_POOL: Badge[] = [
  { id: 'moderator', label: 'Moderator' },
  { id: 'subscriber', label: 'Subscriber' },
  { id: 'vip', label: 'VIP' },
  { id: 'broadcaster', label: 'Broadcaster' }
]

const CURRENCIES = ['USD', 'EUR', 'GBP']

export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T
}

function buildFragments(): { fragments: Fragment[]; plainText: string } {
  const count = 1 + Math.floor(Math.random() * 6)
  const fragments: Fragment[] = []
  const parts: string[] = []

  for (let i = 0; i < count; i++) {
    const roll = Math.random()

    if (roll < 0.04) {
      const href = pick(LINKS)
      parts.push(href)
      fragments.push({ kind: 'link', text: href, href })
      continue
    }

    if (roll < 0.09) {
      const text = `@${pick(NAMES)}`
      parts.push(text)
      fragments.push({ kind: 'mention', text })
      continue
    }

    const word = pick(WORDS)
    parts.push(word)
    const emoteUrl = EMOTES[word]
    if (emoteUrl) {
      fragments.push({ kind: 'emote', name: word, url: emoteUrl })
    } else {
      fragments.push({ kind: 'text', text: word })
    }
  }

  return { fragments, plainText: parts.join(' ') }
}

function rollKind(): MessageKind {
  const r = Math.random()
  if (r < 0.015) return 'subscription'
  if (r < 0.025) return 'donation'
  if (r < 0.03) return 'raid'
  if (r < 0.035) return 'announcement'
  return 'chat'
}

export interface MockMessageOptions {
  sourceId: string
  platform: Platform

  seq: number

  recent?: ChatMessage[]
}

export function makeMockMessage(opts: MockMessageOptions): ChatMessage {
  const { sourceId, platform, seq, recent } = opts
  const author = pick(NAMES)
  const { fragments, plainText } = buildFragments()
  const kind = rollKind()

  const msg: ChatMessage = {
    id: `${platform}:${sourceId}:${seq}`,
    sourceId,
    platform,
    kind,
    authorId: author.toLowerCase(),
    authorName: author,
    authorColor: pick(COLORS),
    badges: Math.random() < 0.3 ? [pick(BADGE_POOL)] : [],
    fragments,
    plainText,
    timestamp: Date.now()
  }

  if (recent && recent.length > 0 && Math.random() < 0.05) {
    const target = pick(recent)
    msg.replyTo = {
      messageId: target.id,
      authorName: target.authorName,
      excerpt: target.plainText.slice(0, 40)
    }
  }

  if (kind === 'donation' || (kind === 'subscription' && Math.random() < 0.5)) {
    msg.monetary = {
      amount: Math.round(Math.random() * 4900 + 100) / 100,
      currency: pick(CURRENCIES),
      tier: kind === 'subscription' ? pick(['1000', '2000', '3000']) : undefined
    }
  }

  return msg
}
