import { memo, useState } from 'react'
import {
  BadgeCheck,
  Coins,
  Crown,
  Gem,
  Gift,
  Shield,
  ShieldCheck,
  Star,
  Sword,
  Video,
  Wrench,
  Zap,
  type LucideIcon
} from 'lucide-react'
import type { Badge, ChatMessage, Fragment } from '@shared/types'
import { PLATFORM_COLOR } from './PlatformIcon'

const KIND_LABEL: Partial<Record<ChatMessage['kind'], string>> = {
  subscription: 'SUB',
  donation: 'TIP',
  raid: 'RAID',
  announcement: 'NOTICE',
  system: 'SYS'
}

const KIND_ACCENT: Partial<Record<ChatMessage['kind'], string>> = {
  subscription: '#a78bfa',
  donation: '#34d399',
  raid: '#fbbf24',
  announcement: '#60a5fa',
  system: '#9ca3af'
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
        className="mr-1 inline-block h-[1.1em] w-[1.1em] align-middle"
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
      className="mr-1 rounded-sm bg-neutral-700/60 px-1 text-[length:var(--text-sm)] font-semibold tracking-wide text-neutral-300 uppercase"
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
        <span className="rounded-sm bg-neutral-600/40 px-1 font-medium text-neutral-100">
          {fragment.text}
        </span>
      )
    case 'link':
      return (
        <button
          type="button"
          className="cursor-pointer text-neutral-200 underline underline-offset-2 hover:text-white"
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
  onOpenLink: (url: string) => void
}

function MessageRowImpl({
  msg,
  deleted,
  showTimestamps,
  showPlatform,
  onOpenLink
}: MessageRowProps): React.ReactElement {
  const kindLabel = KIND_LABEL[msg.kind]
  const accent = KIND_ACCENT[msg.kind]

  return (
    <div
      className={[
        'border-l-[3px] py-[3px] pr-2 pl-[5px] text-[length:var(--chat-font-size)] leading-snug break-words',
        deleted ? 'opacity-40' : ''
      ].join(' ')}
      style={{
        borderLeftColor: accent ?? 'transparent',
        background: accent ? `${accent}14` : undefined
      }}
    >
      {msg.replyTo && (
        <div className="truncate pl-1 text-[length:var(--text-sm)] text-neutral-500">
          ↳ replying to {msg.replyTo.authorName}: {msg.replyTo.excerpt}
        </div>
      )}

      <span className={deleted ? 'line-through' : undefined}>
        {showTimestamps && (
          <span className="mr-1 text-[length:var(--text-sm)] text-neutral-500 tabular-nums">
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
          <span
            className="mr-1 rounded-sm px-1 text-[length:var(--text-sm)] font-bold tracking-wide"
            style={{ background: `${accent}2e`, color: accent }}
          >
            {kindLabel}
          </span>
        )}

        {msg.badges?.map((badge, i) => (
          <BadgeView key={`${badge.label}-${i}`} badge={badge} />
        ))}

        <span
          className="cursor-pointer font-semibold hover:underline"
          style={{ color: nameColor(msg) }}
          data-author={msg.authorName}
          title="Filter this chat by this author"
        >
          {msg.authorDisplayName ?? msg.authorName}
        </span>
        <span className="text-neutral-500">: </span>

        {msg.monetary && (
          <span className="mr-1 rounded-sm bg-emerald-500/20 px-1 text-[length:var(--text-sm)] font-semibold text-emerald-300">
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

      {deleted && <span className="ml-1 text-[length:var(--text-sm)] text-neutral-500">(deleted)</span>}
    </div>
  )
}

export const MessageRow = memo(MessageRowImpl)
