import type { Badge, ChatMessage, Fragment, MessageKind } from '@shared/types'
import { parseBadgeTag, parseEmoteTag, type IrcMessage } from './ircparse'
import { splitLinks } from '../text/links'

const EMOTE_CDN = 'https://static-cdn.jtvnw.net/emoticons/v2'

function emoteUrls(id: string): { url: string; srcSet: string } {
  // IRC gives no format hint, so ask for the default and let Twitch pick.
  const at = (scale: string): string => `${EMOTE_CDN}/${id}/default/dark/${scale}`
  return { url: at('1.0'), srcSet: `${at('1.0')} 1x, ${at('2.0')} 2x, ${at('3.0')} 3x` }
}

/**
 * Builds fragments from the emote tag's positions.
 *
 * The offsets index CODE POINTS, so the text is split with [...text] first. A
 * message like "👨‍👩‍👧 Kappa" indexed as UTF-16 would slice mid-surrogate and
 * corrupt both the emote and the surrounding text — the exact failure the
 * fragment architecture exists to prevent.
 */
export function buildIrcFragments(text: string, emoteTag: string | undefined): Fragment[] {
  const spans = parseEmoteTag(emoteTag)
  if (spans.length === 0) return splitLinks(text)

  const chars = [...text]
  const out: Fragment[] = []
  let cursor = 0

  for (const span of spans) {
    if (span.start < cursor || span.start >= chars.length) continue
    const end = Math.min(span.end, chars.length - 1)

    if (span.start > cursor) {
      out.push(...splitLinks(chars.slice(cursor, span.start).join('')))
    }

    const name = chars.slice(span.start, end + 1).join('')
    const { url, srcSet } = emoteUrls(span.id)
    out.push({ kind: 'emote', name, url, srcSet, provider: 'native' })
    cursor = end + 1
  }

  if (cursor < chars.length) out.push(...splitLinks(chars.slice(cursor).join('')))
  return out
}

/**
 * Badge *images* need the Helix endpoint, which requires auth, and the old
 * public badges.twitch.tv host is gone (it no longer resolves). Anonymous mode
 * therefore has only set names to work with.
 *
 * Rendering every set as a truncated string produces noise like "SUBCRY" and
 * "UMB" for cosmetic badges nobody needs, so only the ones that say something
 * about who is speaking are kept.
 */
const BADGE_LABELS: Record<string, string> = {
  broadcaster: 'HOST',
  moderator: 'MOD',
  vip: 'VIP',
  staff: 'STAFF',
  admin: 'ADMIN',
  global_mod: 'GMOD',
  founder: 'SUB',
  subscriber: 'SUB',
  'artist-badge': 'ART'
}

function toBadges(tag: string | undefined): Badge[] {
  const out: Badge[] = []
  for (const { setId, version } of parseBadgeTag(tag)) {
    const label = BADGE_LABELS[setId]
    if (!label) continue
    out.push({ id: `${setId}/${version}`, label })
  }
  return out
}

/** USERNOTICE msg-id values worth surfacing distinctly in the feed. */
function noticeKind(msgId: string | undefined): MessageKind {
  switch (msgId) {
    case 'sub':
    case 'resub':
    case 'subgift':
    case 'submysterygift':
    case 'giftpaidupgrade':
    case 'anonsubgift':
      return 'subscription'
    case 'raid':
      return 'raid'
    case 'announcement':
      return 'announcement'
    default:
      return 'system'
  }
}

export function normalizeIrcPrivmsg(msg: IrcMessage, sourceId: string): ChatMessage | null {
  const text = msg.trailing ?? ''
  const login = msg.nick ?? msg.tags['login'] ?? 'unknown'
  const messageId = msg.tags['id'] ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const out: ChatMessage = {
    // Same id shape as the EventSub path so moderation binds identically.
    id: `twitch:${sourceId}:${messageId}`,
    sourceId,
    platform: 'twitch',
    kind: msg.tags['bits'] ? 'donation' : 'chat',
    authorId: msg.tags['user-id'] ?? login,
    authorName: login,
    badges: toBadges(msg.tags['badges']),
    fragments: buildIrcFragments(text, msg.tags['emotes']),
    plainText: text,
    timestamp: Number(msg.tags['tmi-sent-ts']) || Date.now()
  }

  const display = msg.tags['display-name']
  if (display) out.authorDisplayName = display

  const color = msg.tags['color']
  if (color) out.authorColor = color

  const bits = Number(msg.tags['bits'])
  if (Number.isFinite(bits) && bits > 0) out.monetary = { amount: bits, currency: 'bits' }

  const replyId = msg.tags['reply-parent-msg-id']
  if (replyId) {
    out.replyTo = {
      messageId: `twitch:${sourceId}:${replyId}`,
      authorName: msg.tags['reply-parent-display-name'] ?? msg.tags['reply-parent-user-login'] ?? '',
      excerpt: (msg.tags['reply-parent-msg-body'] ?? '').slice(0, 60)
    }
  }

  return out
}

/** Subs, resubs, gifts, raids and announcements arrive as USERNOTICE. */
export function normalizeIrcUsernotice(msg: IrcMessage, sourceId: string): ChatMessage | null {
  const systemMsg = msg.tags['system-msg']
  if (!systemMsg) return null

  const login = msg.tags['login'] ?? 'twitch'
  const messageId = msg.tags['id'] ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const userText = msg.trailing ?? ''

  const fragments: Fragment[] = [{ kind: 'text', text: systemMsg }]
  if (userText !== '') {
    fragments.push(...buildIrcFragments(userText, msg.tags['emotes']))
  }

  const out: ChatMessage = {
    id: `twitch:${sourceId}:${messageId}`,
    sourceId,
    platform: 'twitch',
    kind: noticeKind(msg.tags['msg-id']),
    authorId: msg.tags['user-id'] ?? login,
    authorName: login,
    badges: toBadges(msg.tags['badges']),
    fragments,
    plainText: userText === '' ? systemMsg : `${systemMsg} ${userText}`,
    timestamp: Number(msg.tags['tmi-sent-ts']) || Date.now()
  }

  const display = msg.tags['display-name']
  if (display) out.authorDisplayName = display

  const color = msg.tags['color']
  if (color) out.authorColor = color

  return out
}
