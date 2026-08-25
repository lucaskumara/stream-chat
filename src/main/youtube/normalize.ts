import type { Badge, ChatMessage, Fragment, MessageKind, ModerationEvent } from '@shared/types'
import { splitLinks } from '../text/links'
import type {
  YtAction,
  YtAuthorBadge,
  YtChatItem,
  YtChatRenderer,
  YtEmoji,
  YtRun,
  YtText,
  YtThumbnail
} from './types'

const RENDERER_KINDS: Record<string, MessageKind> = {
  liveChatTextMessageRenderer: 'chat',
  liveChatPaidMessageRenderer: 'donation',
  liveChatPaidStickerRenderer: 'donation',
  liveChatMembershipItemRenderer: 'subscription',
  liveChatSponsorshipsGiftPurchaseAnnouncementRenderer: 'subscription',
  liveChatSponsorshipsGiftRedemptionAnnouncementRenderer: 'subscription',
  liveChatViewerEngagementMessageRenderer: 'system'
}

const AUTHOR_COLORS = [
  '#ff7b72',
  '#ffa657',
  '#e3b341',
  '#7ee787',
  '#56d364',
  '#39d0d8',
  '#79c0ff',
  '#a5a5ff',
  '#d2a8ff',
  '#ff9bce',
  '#f78166',
  '#6cb6ff'
]

const SYSTEM_AUTHOR = 'YouTube'

export interface NormalizedAction {
  message?: ChatMessage
  moderation?: ModerationEvent
}

export function normalizeAction(action: YtAction, sourceId: string): NormalizedAction | null {
  const item = action.addChatItemAction?.item
  if (item) {
    const message = normalizeChatItem(item, sourceId)
    return message ? { message } : null
  }

  const deletedId =
    action.markChatItemAsDeletedAction?.targetItemId ?? action.removeChatItemAction?.targetItemId
  if (deletedId) {
    return {
      moderation: {
        type: 'delete-message',
        sourceId,
        messageId: messageId(sourceId, deletedId)
      }
    }
  }

  const bannedAuthor =
    action.markChatItemsByAuthorAsDeletedAction?.externalChannelId ??
    action.removeChatItemByAuthorAction?.externalChannelId
  if (bannedAuthor) {
    return { moderation: { type: 'clear-user', sourceId, userId: bannedAuthor } }
  }

  return null
}

export function messageId(sourceId: string, itemId: string): string {
  return `youtube:${sourceId}:${itemId}`
}

function normalizeChatItem(item: YtChatItem, sourceId: string): ChatMessage | null {
  for (const [name, renderer] of Object.entries(item)) {
    const kind = RENDERER_KINDS[name]
    if (!kind || !renderer?.id) continue
    return toChatMessage(renderer, kind, sourceId)
  }
  return null
}

function toChatMessage(
  renderer: YtChatRenderer,
  kind: MessageKind,
  sourceId: string
): ChatMessage {
  const author = renderer.header?.liveChatSponsorshipsHeaderRenderer ?? renderer
  const fragments = toFragments(bodyText(renderer), bodyText(author))
  const authorId = author.authorExternalChannelId ?? SYSTEM_AUTHOR

  const message: ChatMessage = {
    id: messageId(sourceId, renderer.id ?? ''),
    sourceId,
    platform: 'youtube',
    kind,
    authorId,
    authorName: readText(author.authorName) || SYSTEM_AUTHOR,
    authorColor: authorColor(authorId),
    badges: toBadges(author.authorBadges),
    fragments,
    plainText: fragments.map(fragmentText).join(''),
    timestamp: toTimestamp(renderer.timestampUsec)
  }

  const monetary = toMonetary(renderer.purchaseAmountText)
  if (monetary) message.monetary = monetary

  return message
}

function bodyText(renderer: YtChatRenderer): YtText | undefined {
  return (
    renderer.message ??
    renderer.headerPrimaryText ??
    renderer.headerSubtext ??
    renderer.primaryText ??
    renderer.text
  )
}

function toFragments(...candidates: (YtText | undefined)[]): Fragment[] {
  const text = candidates.find((candidate) => candidate !== undefined)
  if (!text) return []
  if (text.simpleText) return splitLinks(text.simpleText)

  const out: Fragment[] = []
  for (const run of text.runs ?? []) {
    if (run.emoji) {
      out.push(toEmojiFragment(run.emoji))
      continue
    }
    if (!run.text) continue
    out.push(...toRunFragments(run))
  }
  return mergeAdjacentText(out)
}

function mergeAdjacentText(fragments: Fragment[]): Fragment[] {
  const merged: Fragment[] = []

  for (const fragment of fragments) {
    const previous = merged[merged.length - 1]
    if (fragment.kind === 'text' && previous?.kind === 'text') {
      merged[merged.length - 1] = { kind: 'text', text: previous.text + fragment.text }
      continue
    }
    merged.push(fragment)
  }

  return merged
}

function toRunFragments(run: YtRun): Fragment[] {
  const text = run.text ?? ''
  const href = linkTarget(run)
  if (href) return [{ kind: 'link', text, href }]

  const browseId = run.navigationEndpoint?.browseEndpoint?.browseId
  if (browseId && text.startsWith('@')) return [{ kind: 'mention', text, userId: browseId }]

  return splitLinks(text)
}

function linkTarget(run: YtRun): string | null {
  const direct = run.navigationEndpoint?.urlEndpoint?.url
  if (direct) return unwrapRedirect(direct)

  const path = run.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url
  if (path?.startsWith('http')) return path
  if (path?.startsWith('/watch')) return `https://www.youtube.com${path}`
  return null
}

function unwrapRedirect(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.pathname === '/redirect') return parsed.searchParams.get('q') ?? url
  } catch {
    return url
  }
  return url
}

function toEmojiFragment(emoji: YtEmoji): Fragment {
  const name = emoji.shortcuts?.[0] ?? emoji.emojiId ?? ''
  const thumbnails = emoji.image?.thumbnails ?? []

  if (!emoji.isCustomEmoji || thumbnails.length === 0) {
    return { kind: 'text', text: emoji.emojiId ?? name }
  }

  const scales = [...thumbnails].sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
  return {
    kind: 'emote',
    name,
    url: scales[0]?.url ?? '',
    srcSet: scales.map((scale, i) => `${scale.url} ${i + 1}x`).join(', '),
    provider: 'native'
  }
}

function toBadges(badges: YtAuthorBadge[] | undefined): Badge[] {
  const out: Badge[] = []

  for (const [index, entry] of (badges ?? []).entries()) {
    const badge = entry.liveChatAuthorBadgeRenderer
    if (!badge) continue

    const url = largest(badge.customThumbnail?.thumbnails)
    out.push({
      id: `${badge.icon?.iconType ?? 'member'}/${index}`,
      label: badge.tooltip ?? badge.icon?.iconType ?? 'badge',
      ...(url ? { url } : {})
    })
  }

  return out
}

function largest(thumbnails: YtThumbnail[] | undefined): string | undefined {
  if (!thumbnails?.length) return undefined
  return thumbnails.reduce((best, next) => ((next.width ?? 0) > (best.width ?? 0) ? next : best))
    .url
}

function toMonetary(amount: YtText | undefined): ChatMessage['monetary'] | null {
  const text = readText(amount)
  if (!text) return null

  const digits = /[\d.,]+/.exec(text)?.[0]
  if (!digits) return null

  const value = Number.parseFloat(digits.replace(/,/g, ''))
  if (!Number.isFinite(value)) return null

  const currency = text.replace(/[\d.,\s]/g, '') || 'USD'
  return { amount: value, currency }
}

function readText(text: YtText | undefined): string {
  if (!text) return ''
  if (text.simpleText) return text.simpleText
  return (text.runs ?? []).map((run) => run.text ?? run.emoji?.emojiId ?? '').join('')
}

function fragmentText(fragment: Fragment): string {
  return fragment.kind === 'emote' ? fragment.name : fragment.text
}

function toTimestamp(timestampUsec: string | undefined): number {
  const micros = Number(timestampUsec)
  return Number.isFinite(micros) && micros > 0 ? Math.round(micros / 1000) : Date.now()
}

function authorColor(authorId: string): string {
  let hash = 0
  for (let i = 0; i < authorId.length; i++) {
    hash = (hash * 31 + authorId.charCodeAt(i)) >>> 0
  }
  return AUTHOR_COLORS[hash % AUTHOR_COLORS.length] as string
}
