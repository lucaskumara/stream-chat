import { memo, useState } from 'react'
import type {
  Badge as BadgeType,
  ChatMessage,
  EmoteProvider,
  EmoteSettings,
  Fragment,
  Platform
} from '@shared/types'
import type { Decision } from '../rules'

export const PLATFORM_COLOR: Record<Platform, string> = {
  twitch: '#9146ff',
  youtube: '#ff0033',
  kick: '#53fc18',
  mock: '#64748b'
}

const KIND_LABEL: Partial<Record<ChatMessage['kind'], string>> = {
  subscription: 'SUB',
  donation: 'TIP',
  raid: 'RAID',
  announcement: 'NOTICE',
  system: 'SYS'
}

/**
 * Platform-chosen name colours are picked against each platform's own
 * background and some are unreadably dark on ours, so lift anything below a
 * legibility floor rather than dropping the user's colour entirely.
 */
function readableColor(hex: string | undefined): string {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return '#9aa4b2'

  let r = parseInt(hex.slice(1, 3), 16)
  let g = parseInt(hex.slice(3, 5), 16)
  let b = parseInt(hex.slice(5, 7), 16)

  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  if (luminance >= 0.4) return hex

  const boost = 0.4 / Math.max(luminance, 0.05)
  r = Math.min(255, Math.round(r * boost))
  g = Math.min(255, Math.round(g * boost))
  b = Math.min(255, Math.round(b * boost))
  return `rgb(${r}, ${g}, ${b})`
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function Emote({ name, url }: { name: string; url: string }): React.ReactElement {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className="text-indigo-300">{name}</span>
  return (
    <img
      src={url}
      alt={name}
      title={name}
      loading="lazy"
      draggable={false}
      className="mx-[1px] inline-block h-[1.55em] max-w-none align-middle"
      onError={() => setFailed(true)}
    />
  )
}

function BadgeView({ badge }: { badge: BadgeType }): React.ReactElement {
  const [failed, setFailed] = useState(false)

  // Mock sources and unresolved sets have no image; the short title is the
  // fallback rather than the default.
  if (!badge.url || failed) {
    return (
      <span
        title={badge.label}
        className="mr-1 rounded-sm bg-slate-600/40 px-1 text-[0.75em] text-slate-300"
      >
        {badge.label.length <= 5 ? badge.label : badge.label.slice(0, 3).toUpperCase()}
      </span>
    )
  }

  return (
    <img
      src={badge.url}
      alt={badge.label}
      title={badge.label}
      loading="lazy"
      draggable={false}
      className="mr-1 inline-block h-[1.15em] w-[1.15em] align-middle"
      onError={() => setFailed(true)}
    />
  )
}

/** A disabled provider renders as the original word, not a gap. */
function isEmoteEnabled(
  provider: EmoteProvider | undefined,
  settings: EmoteSettings
): boolean {
  switch (provider) {
    case '7tv':
      return settings.sevenTv
    case 'bttv':
      return settings.bttv
    default:
      // Native platform emotes are not optional.
      return true
  }
}

function FragmentView({
  fragment,
  emoteSettings,
  onOpenLink
}: {
  fragment: Fragment
  emoteSettings: EmoteSettings
  onOpenLink: (url: string) => void
}): React.ReactElement {
  switch (fragment.kind) {
    case 'text':
      return <span>{fragment.text}</span>
    case 'emote':
      return isEmoteEnabled(fragment.provider, emoteSettings) ? (
        <Emote name={fragment.name} url={fragment.url} />
      ) : (
        <span>{fragment.name}</span>
      )
    case 'mention':
      return (
        <span className="rounded-sm bg-indigo-500/20 px-1 font-medium text-indigo-200">
          {fragment.text}
        </span>
      )
    case 'link':
      return (
        <button
          type="button"
          className="cursor-pointer text-sky-400 underline underline-offset-2 hover:text-sky-300"
          onClick={() => onOpenLink(fragment.href)}
        >
          {fragment.text}
        </button>
      )
  }
}

export interface MessageRowProps {
  msg: ChatMessage
  decision: Decision
  deleted: boolean
  showTimestamps: boolean
  showPlatform: boolean
  emoteSettings: EmoteSettings
  onOpenLink: (url: string) => void
}

function MessageRowImpl({
  msg,
  decision,
  deleted,
  showTimestamps,
  showPlatform,
  emoteSettings,
  onOpenLink
}: MessageRowProps): React.ReactElement {
  const highlight = decision.highlight
  const kindLabel = KIND_LABEL[msg.kind]

  return (
    <div
      className={[
        'px-2 py-[3px] text-[length:var(--chat-font-size)] leading-snug break-words',
        highlight ? 'border-l-2' : 'border-l-2 border-l-transparent',
        deleted ? 'opacity-40' : ''
      ].join(' ')}
      style={
        highlight
          ? { borderLeftColor: highlight, backgroundColor: `${highlight}1f` }
          : undefined
      }
    >
      {msg.replyTo && (
        <div className="truncate pl-1 text-[0.82em] text-slate-500">
          ↳ replying to {msg.replyTo.authorName}: {msg.replyTo.excerpt}
        </div>
      )}

      <span className={deleted ? 'line-through' : undefined}>
        {showTimestamps && (
          <span className="mr-1 text-[0.82em] text-slate-600 tabular-nums">
            {formatTime(msg.timestamp)}
          </span>
        )}

        {showPlatform && (
          <span
            title={msg.platform}
            className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
            style={{ backgroundColor: PLATFORM_COLOR[msg.platform] }}
          />
        )}

        {kindLabel && (
          <span className="mr-1 rounded-sm bg-amber-500/20 px-1 text-[0.75em] font-bold tracking-wide text-amber-300">
            {kindLabel}
          </span>
        )}

        {msg.badges.map((badge) => (
          <BadgeView key={badge.id} badge={badge} />
        ))}

        <span className="font-semibold" style={{ color: readableColor(msg.authorColor) }}>
          {msg.authorDisplayName ?? msg.authorName}
        </span>
        <span className="text-slate-500">: </span>

        {msg.monetary && (
          <span className="mr-1 rounded-sm bg-emerald-500/20 px-1 text-[0.8em] font-semibold text-emerald-300">
            {msg.monetary.currency === 'bits'
              ? `${msg.monetary.amount.toLocaleString()} bits`
              : `${msg.monetary.currency} ${msg.monetary.amount.toFixed(2)}`}
          </span>
        )}

        {msg.fragments.map((fragment, i) => (
          <span key={i}>
            <FragmentView
              fragment={fragment}
              emoteSettings={emoteSettings}
              onOpenLink={onOpenLink}
            />{' '}
          </span>
        ))}
      </span>

      {deleted && <span className="ml-1 text-[0.75em] text-slate-500">(deleted)</span>}
    </div>
  )
}

/**
 * Messages are immutable, so a shallow compare here is what keeps a 50 msg/sec
 * feed from re-rendering the entire visible window on every batch.
 */
export const MessageRow = memo(MessageRowImpl)
