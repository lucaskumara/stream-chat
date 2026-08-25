import type { Badge, ChatMessage, Fragment, MessageKind } from '@shared/types'
import type { BadgeCache } from './helix'

const EMOTE_CDN = 'https://static-cdn.jtvnw.net/emoticons/v2'

/** Twitch fragment shapes we care about, from channel.chat.message v1. */
interface TwitchFragment {
  type: 'text' | 'cheermote' | 'emote' | 'mention'
  text: string
  emote?: { id: string; emote_set_id?: string; owner_id?: string; format?: string[] } | null
  mention?: { user_id: string; user_login: string; user_name: string } | null
  cheermote?: { prefix: string; bits: number; tier: number } | null
}

export interface TwitchChatEvent {
  broadcaster_user_id: string
  chatter_user_id: string
  chatter_user_login: string
  chatter_user_name: string
  message_id: string
  message: { text: string; fragments: TwitchFragment[] }
  color?: string
  badges?: { set_id: string; id: string; info?: string }[]
  message_type?: string
  cheer?: { bits: number } | null
  reply?: {
    parent_message_id: string
    parent_message_body: string
    parent_user_name: string
  } | null
}

// Deliberately conservative: only obvious links, applied to *text* fragments
// after Twitch has already carved out emotes. Running a regex over the whole
// message would be the thing the fragment design exists to avoid.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi

function splitLinks(text: string): Fragment[] {
  const out: Fragment[] = []
  let last = 0

  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0
    const raw = match[0]
    // Trailing punctuation is almost never part of the URL.
    const trimmed = raw.replace(/[.,!?)\]}]+$/, '')

    if (start > last) out.push({ kind: 'text', text: text.slice(last, start) })
    out.push({
      kind: 'link',
      text: trimmed,
      href: trimmed.startsWith('http') ? trimmed : `https://${trimmed}`
    })
    last = start + trimmed.length
  }

  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out.length > 0 ? out : [{ kind: 'text', text }]
}

function emoteUrls(id: string, formats: string[] | undefined): { url: string; srcSet: string } {
  // Animated where offered, so BTTV-style moving emotes still move.
  const format = formats?.includes('animated') ? 'animated' : 'static'
  const at = (scale: string): string => `${EMOTE_CDN}/${id}/${format}/dark/${scale}`
  return {
    url: at('1.0'),
    srcSet: `${at('1.0')} 1x, ${at('2.0')} 2x, ${at('3.0')} 3x`
  }
}

function toFragments(fragments: TwitchFragment[]): Fragment[] {
  const out: Fragment[] = []

  for (const frag of fragments) {
    switch (frag.type) {
      case 'emote': {
        if (!frag.emote) break
        const { url, srcSet } = emoteUrls(frag.emote.id, frag.emote.format)
        out.push({ kind: 'emote', name: frag.text, url, srcSet })
        continue
      }
      case 'mention': {
        out.push({
          kind: 'mention',
          text: frag.text,
          ...(frag.mention ? { userId: frag.mention.user_id } : {})
        })
        continue
      }
      case 'cheermote': {
        // Rendered as text; the bit total is surfaced via `monetary` instead.
        out.push({ kind: 'text', text: frag.text })
        continue
      }
    }
    out.push(...splitLinks(frag.text))
  }

  return out
}

function toBadges(
  raw: { set_id: string; id: string; info?: string }[] | undefined,
  broadcasterId: string,
  badges: BadgeCache
): Badge[] {
  if (!raw?.length) return []

  return raw.map((b) => {
    const resolved = badges.resolve(broadcasterId, b.set_id, b.id)
    return {
      id: `${b.set_id}/${b.id}`,
      label: resolved?.title ?? b.set_id,
      ...(resolved ? { url: resolved.image_url_2x || resolved.image_url_1x } : {})
    }
  })
}

function toKind(event: TwitchChatEvent): MessageKind {
  if (event.cheer && event.cheer.bits > 0) return 'donation'
  switch (event.message_type) {
    case 'channel_points_highlighted':
    case 'power_ups_message_effect':
    case 'power_ups_gigantified_emote':
      return 'announcement'
    case 'user_intro':
      return 'announcement'
    default:
      return 'chat'
  }
}

export function normalizeChatMessage(
  event: TwitchChatEvent,
  sourceId: string,
  badges: BadgeCache
): ChatMessage {
  const msg: ChatMessage = {
    // Must match the id the moderation path composes, or deletions won't bind.
    id: `twitch:${sourceId}:${event.message_id}`,
    sourceId,
    platform: 'twitch',
    kind: toKind(event),
    authorId: event.chatter_user_id,
    authorName: event.chatter_user_login,
    authorDisplayName: event.chatter_user_name,
    badges: toBadges(event.badges, event.broadcaster_user_id, badges),
    fragments: toFragments(event.message.fragments ?? []),
    plainText: event.message.text ?? '',
    // EventSub carries no per-message timestamp in the payload, so receipt time
    // is the honest value here.
    timestamp: Date.now()
  }

  if (event.color) msg.authorColor = event.color

  if (event.reply) {
    msg.replyTo = {
      messageId: `twitch:${sourceId}:${event.reply.parent_message_id}`,
      authorName: event.reply.parent_user_name,
      excerpt: event.reply.parent_message_body.slice(0, 60)
    }
  }

  if (event.cheer && event.cheer.bits > 0) {
    msg.monetary = { amount: event.cheer.bits, currency: 'bits' }
  }

  return msg
}
