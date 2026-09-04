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
import type {
  Badge,
  ChatMessage,
  EmoteProvider,
  EmoteProviderSettings,
  Fragment,
  Platform
} from '@shared/types'
import { nameColor, readable } from '../contrast'
import { emoteProviderEnabled } from '../emotes'
import type { NameColorMode } from '../store'
import {
  BADGE_WASH,
  EVENT_ACCENT,
  PLATFORM_COLOR,
  PLATFORM_NAME,
  ROW_WASH,
  type ThemeMode
} from '../theme'
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

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Source label for the hover popup below: 7TV and BTTV name themselves, and a native
    emote (Twitch/Kick/YouTube's own) names the platform it came from — there is no
    "native" to show a user. */
function emoteSource(provider: EmoteProvider | undefined, platform: Platform): string {
  if (provider === '7tv') return '7TV'
  if (provider === 'bttv') return 'BTTV'
  return PLATFORM_NAME[platform]
}

/** The one deliberate exception to "the chrome does not explain itself on hover" (see
    CLAUDE.md): a small popup showing the raw text that became this emote and which
    provider supplied the image, so a run of unfamiliar images stays legible. */
function Emote({
  name,
  url,
  provider,
  platform
}: {
  name: string
  url: string
  provider: EmoteProvider | undefined
  platform: Platform
}): React.ReactElement {
  const [failed, setFailed] = useState(false)
  const [hovered, setHovered] = useState(false)

  if (failed) return <span style={{ color: 'var(--chip-fg)' }}>{name}</span>

  return (
    <span
      className="relative inline-block align-middle"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <img
        src={url}
        alt={name}
        loading="lazy"
        draggable={false}
        className="mx-[1px] inline-block h-[1.55em] max-w-none align-middle"
        onError={() => setFailed(true)}
      />

      {hovered && (
        <span
          role="tooltip"
          className="pointer-events-none absolute z-10 -translate-x-1/2 text-[.9em] whitespace-nowrap"
          style={{
            bottom: 'calc(100% + 5px)',
            left: '50%',
            background: 'var(--ink-600)',
            border: '1px solid var(--line-2)',
            borderRadius: 6,
            padding: '.3em .55em',
            boxShadow: '0 8px 20px rgba(0,0,0,.5)'
          }}
        >
          <span style={{ color: 'var(--heading)' }}>{name}</span>
          <span style={{ color: 'var(--fg-4)' }}> · {emoteSource(provider, platform)}</span>
        </span>
      )}
    </span>
  )
}

/** The one other deliberate exception to "the chrome does not explain itself on
    hover" (see CLAUDE.md, alongside Emote's popup below): a badge image carries no
    text anywhere on it, and the three-letter chip that stands in for a missing one
    is the only place its full label survives — so both need the same hover popup
    an emote gets, not just the chip's plain `title`. */
function BadgeView({ badge, mode }: { badge: Badge; mode: ThemeMode }): React.ReactElement {
  const [failed, setFailed] = useState(false)
  const [hovered, setHovered] = useState(false)

  const glyph = badge.url && !failed ? undefined : badge.id ? BADGE_GLYPH[badge.id] : undefined

  return (
    <span
      className="relative mr-1 inline-block align-middle"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {badge.url && !failed ? (
        <img
          src={badge.url}
          srcSet={badge.srcSet}
          alt={badge.label}
          loading="lazy"
          draggable={false}
          className="inline-block h-[1.1em] w-[1.1em] object-contain align-middle"
          onError={() => setFailed(true)}
        />
      ) : glyph ? (
        <glyph.icon
          size="1.1em"
          strokeWidth={2.5}
          aria-hidden
          className="inline-block align-middle"
          style={{ color: readable(glyph.color, mode) }}
        />
      ) : (
        <span
          className="rounded-sm px-1 text-[.75em] font-semibold tracking-wide uppercase"
          style={{ background: 'var(--chip-bg)', color: 'var(--chip-fg)' }}
        >
          {badge.label.slice(0, 3)}
        </span>
      )}

      {hovered && (
        <span
          role="tooltip"
          className="pointer-events-none absolute z-10 -translate-x-1/2 text-[.9em] whitespace-nowrap"
          style={{
            bottom: 'calc(100% + 5px)',
            left: '50%',
            background: 'var(--ink-600)',
            border: '1px solid var(--line-2)',
            borderRadius: 6,
            padding: '.3em .55em',
            boxShadow: '0 8px 20px rgba(0,0,0,.5)',
            color: 'var(--heading)'
          }}
        >
          {badge.label}
        </span>
      )}
    </span>
  )
}

function FragmentView({
  fragment,
  platform,
  providers,
  onOpenLink
}: {
  fragment: Fragment
  platform: Platform
  providers: EmoteProviderSettings | undefined
  onOpenLink: (url: string) => void
}): React.ReactElement {
  switch (fragment.kind) {
    case 'text':
      return <span>{fragment.text}</span>
    case 'emote':
      if (!emoteProviderEnabled(fragment.provider, providers)) {
        return <span style={{ color: 'var(--chip-fg)' }}>{fragment.name}</span>
      }

      return (
        <Emote
          name={fragment.name}
          url={fragment.url}
          provider={fragment.provider}
          platform={platform}
        />
      )
    case 'mention':
      return (
        <span
          className="px-[4px] py-px"
          style={{ background: 'var(--mention-bg)', borderRadius: 3, color: 'var(--heading)' }}
        >
          {fragment.text}
        </span>
      )
    case 'link':
      return (
        <button
          type="button"
          className="cursor-pointer underline"
          style={{
            color: 'var(--link)',
            textUnderlineOffset: 2,
            background: 'none',
            border: 0,
            padding: 0
          }}
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

  /** Which background the row is painted on, so the author colour, the badge glyphs
      and the event badge are lifted or darkened toward it. The OBS dock omits it and
      keeps the dark treatment, which is what it renders on. */
  mode?: ThemeMode

  /** The OBS dock omits this too, and gets 'author' — its one column never merges
      platforms, so there is nothing for 'platform' or 'none' to usefully change. */
  nameColorMode?: NameColorMode

  /** Keyed by platform because a merged pane holds messages from more than one.
      Omitted by the OBS dock, which has no Settings screen of its own to read
      these from — its emotes stay always-on, same as before this existed. */
  emoteProviders?: Partial<Record<Platform, EmoteProviderSettings>>
  onOpenLink: (url: string) => void
}

function MessageRowImpl({
  msg,
  deleted,
  showTimestamps,
  showPlatform,
  compact,
  mode = 'dark',
  nameColorMode = 'author',
  emoteProviders,
  onOpenLink
}: MessageRowProps): React.ReactElement {
  const event = EVENT_ACCENT[msg.kind as keyof typeof EVENT_ACCENT]
  const Glyph = KIND_GLYPH[msg.kind]
  const providers = emoteProviders?.[msg.platform]

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
            <PlatformMark platform={msg.platform} height="1em" />
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
              color: readable(event.badgeText, mode),
              borderRadius: 3,
              letterSpacing: '.06em'
            }}
          >
            {event.label}
          </span>
        )}

        {msg.badges?.map((badge, i) => (
          <BadgeView key={`${badge.label}-${i}`} badge={badge} mode={mode} />
        ))}

        <span
          className="cursor-pointer font-semibold hover:underline"
          style={{ color: nameColor(msg, mode, nameColorMode) }}
          data-author={msg.authorName}
        >
          {msg.authorDisplayName ?? msg.authorName}
        </span>
        <span style={{ color: 'var(--fg-4)' }}>: </span>

        {msg.monetary && (
          <span
            className="mr-1 inline-block px-[5px] py-px font-semibold"
            style={{
              background: 'rgba(52,211,153,.18)',
              color: readable('#6ee7b7', mode),
              borderRadius: 3
            }}
          >
            {msg.monetary.currency === 'bits'
              ? `${msg.monetary.amount.toLocaleString()} bits`
              : `${msg.monetary.currency} ${msg.monetary.amount.toFixed(2)}`}
          </span>
        )}

        {msg.fragments.map((fragment, i) => (
          <span key={i}>
            <FragmentView
              fragment={fragment}
              platform={msg.platform}
              providers={providers}
              onOpenLink={onOpenLink}
            />{' '}
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
