import { memo, useState } from 'react'
import {
  BadgeCheck,
  Coins,
  Crown,
  Gem,
  Gift,
  Megaphone,
  Shield,
  ShieldCheck,
  Star,
  Sword,
  Users,
  Video,
  Wrench,
  Zap,
  type LucideIcon
} from 'lucide-react'
import type { Badge, ChatMessage, Fragment } from '@shared/types'
import { BADGE_WASH, EVENT_ACCENT, PLATFORM_COLOR, ROW_WASH } from '../theme'
import { PlatformMark } from './PlatformMark'

const KIND_GLYPH: Partial<Record<ChatMessage['kind'], LucideIcon>> = {
  subscription: Star,
  donation: Gift,
  raid: Users,
  announcement: Megaphone
}

const BADGE_GLYPH: Record<string, { icon: LucideIcon; color: string }> = {
  broadcaster: { icon: Video, color: '#f0685f' },
  moderator: { icon: Sword, color: '#4ade80' },
  global_mod: { icon: Shield, color: '#4ade80' },
  vip: { icon: Gem, color: '#f472b6' },
  subscriber: { icon: Star, color: '#a78bfa' },
  founder: { icon: Crown, color: '#e0b252' },
  staff: { icon: Wrench, color: '#b794f6' },
  admin: { icon: ShieldCheck, color: '#fbbf24' },
  partner: { icon: BadgeCheck, color: '#b794f6' },
  verified: { icon: BadgeCheck, color: '#60a5fa' },
  bits: { icon: Coins, color: '#e0b252' },
  turbo: { icon: Zap, color: '#b794f6' },
  premium: { icon: Crown, color: '#60a5fa' },
  sub_gifter: { icon: Gift, color: '#c070ff' },
  'sub-gifter': { icon: Gift, color: '#c070ff' }
}

const DEFAULT_NAME_COLORS = [
  '#FF0000',
  '#0000FF',
  '#00FF00',
  '#B22222',
  '#FF7F50',
  '#9ACD32',
  '#FF4500',
  '#2E8B57',
  '#DAA520',
  '#D2691E',
  '#5F9EA0',
  '#1E90FF',
  '#FF69B4',
  '#8A2BE2',
  '#00FF7F'
]

const LUMINANCE_FLOOR = 0.4

function readableColor(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return '#a1a1a1'

  const channels = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16))

  const luminance =
    (0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]) / 255

  if (luminance >= LUMINANCE_FLOOR) return hex

  const towardsWhite = (LUMINANCE_FLOOR - luminance) / (1 - luminance)
  const lifted = channels.map((value) =>
    Math.round(value + (255 - value) * towardsWhite)
  )

  return `rgb(${lifted[0]}, ${lifted[1]}, ${lifted[2]})`
}

function nameColor(msg: ChatMessage): string {
  if (msg.authorColor) return readableColor(msg.authorColor)

  const seed = msg.authorId || msg.authorName
  let hash = 0

  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0

  const picked = DEFAULT_NAME_COLORS[Math.abs(hash) % DEFAULT_NAME_COLORS.length]

  return readableColor(picked)
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function Emote({ name, url }: { name: string; url: string }): React.ReactElement {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className="text-neutral-300">{name}</span>
  return (
    <img
      src={url}
      alt={name}
      loading="lazy"
      draggable={false}
      className="mx-[1px] inline-block h-[1.55em] max-w-none align-middle"
      onError={() => setFailed(true)}
    />
  )
}

function BadgeView({ badge }: { badge: Badge }): React.ReactElement {
  const [failed, setFailed] = useState(false)

  if (badge.url && !failed) {
    return (
      <img
        src={badge.url}
        srcSet={badge.srcSet}
        alt={badge.label}
        loading="lazy"
        draggable={false}
        className="mr-1 inline-block h-[1.1em] w-[1.1em] object-contain align-middle"
        onError={() => setFailed(true)}
      />
    )
  }

  const glyph = badge.id ? BADGE_GLYPH[badge.id] : undefined

  if (glyph) {
    const Glyph = glyph.icon

    return (
      <Glyph
        size="1.1em"
        strokeWidth={2.5}
        aria-label={badge.label}
        className="mr-1 inline-block align-middle"
        style={{ color: glyph.color }}
      />
    )
  }

  return (
    <span
      title={badge.label}
      className="mr-1 rounded-sm bg-neutral-700/60 px-1 text-[.75em] font-semibold tracking-wide text-neutral-300 uppercase"
    >
      {badge.label.slice(0, 3)}
    </span>
  )
}

function FragmentView({
  fragment,
  onOpenLink
}: {
  fragment: Fragment
  onOpenLink: (url: string) => void
}): React.ReactElement {
  switch (fragment.kind) {
    case 'text':
      return <span>{fragment.text}</span>
    case 'emote':
      return <Emote name={fragment.name} url={fragment.url} />
    case 'mention':
      return (
        <span
          className="px-[4px] py-px"
          style={{ background: 'rgba(255,255,255,.1)', borderRadius: 3, color: '#f2f2f2' }}
        >
          {fragment.text}
        </span>
      )
    case 'link':
      return (
        <button
          type="button"
          className="cursor-pointer underline"
          style={{ color: '#c9c9c9', textUnderlineOffset: 2, background: 'none', border: 0, padding: 0 }}
          onClick={() => onOpenLink(fragment.href)}
        >
          {fragment.text}
        </button>
      )
  }
}

export interface MessageRowProps {
  msg: ChatMessage
  deleted: boolean
  showTimestamps: boolean
  showPlatform: boolean
  compact?: boolean
  onOpenLink: (url: string) => void
}

function MessageRowImpl({
  msg,
  deleted,
  showTimestamps,
  showPlatform,
  compact,
  onOpenLink
}: MessageRowProps): React.ReactElement {
  const event = EVENT_ACCENT[msg.kind as keyof typeof EVENT_ACCENT]
  const Glyph = KIND_GLYPH[msg.kind]

  return (
    <div
      className="border-l-2 px-[12px] text-[length:var(--chat-font-size)] break-words"
      style={{
        // Always in the layout, transparent on chat rows, so a notice arriving
        // mid-scroll cannot shift every other row sideways.
        borderLeftColor: event?.accent ?? 'transparent',
        background: event ? `${event.accent}${ROW_WASH}` : undefined,
        paddingTop: compact ? 2 : 5,
        paddingBottom: compact ? 2 : 5,
        lineHeight: 1.45,
        opacity: deleted ? 0.38 : undefined
      }}
    >
      {msg.replyTo && (
        <div className="truncate text-[.86em]" style={{ color: 'var(--fg-4)' }}>
          ↳ {msg.replyTo.authorName}: {msg.replyTo.excerpt}
        </div>
      )}

      <span className={deleted ? 'line-through' : undefined}>
        {showTimestamps && (
          <span
            className="mr-[6px] text-[.86em] tabular-nums"
            style={{ color: 'var(--fg-4)' }}
          >
            {formatTime(msg.timestamp)}
          </span>
        )}

        {showPlatform && (
          <span
            className="mr-[6px] inline-block"
            style={{ color: PLATFORM_COLOR[msg.platform], verticalAlign: -1 }}
          >
            <PlatformMark platform={msg.platform} height="0.85em" />
          </span>
        )}

        {Glyph && event && (
          <Glyph
            size="1em"
            strokeWidth={1.8}
            aria-hidden
            className="mr-[5px] inline-block"
            style={{ color: event.accent, verticalAlign: -1 }}
          />
        )}

        {event && (
          <span
            className="mr-1 inline-block px-[5px] py-px text-[.75em] font-bold uppercase"
            style={{
              background: `${event.accent}${BADGE_WASH}`,
              color: event.badgeText,
              borderRadius: 3,
              letterSpacing: '.06em'
            }}
          >
            {event.label}
          </span>
        )}

        {msg.badges?.map((badge, i) => (
          <BadgeView key={`${badge.label}-${i}`} badge={badge} />
        ))}

        <span
          className="cursor-pointer font-semibold hover:underline"
          style={{ color: nameColor(msg) }}
          data-author={msg.authorName}
        >
          {msg.authorDisplayName ?? msg.authorName}
        </span>
        <span style={{ color: 'var(--fg-4)' }}>: </span>

        {msg.monetary && (
          <span
            className="mr-1 inline-block px-[5px] py-px font-semibold"
            style={{ background: 'rgba(52,211,153,.18)', color: '#6ee7b7', borderRadius: 3 }}
          >
            {msg.monetary.currency === 'bits'
              ? `${msg.monetary.amount.toLocaleString()} bits`
              : `${msg.monetary.currency} ${msg.monetary.amount.toFixed(2)}`}
          </span>
        )}

        {msg.fragments.map((fragment, i) => (
          <span key={i}>
            <FragmentView fragment={fragment} onOpenLink={onOpenLink} />{' '}
          </span>
        ))}
      </span>

      {deleted && (
        <span className="ml-1 text-[.86em]" style={{ color: 'var(--fg-4)' }}>
          (deleted)
        </span>
      )}
    </div>
  )
}

export const MessageRow = memo(MessageRowImpl)
