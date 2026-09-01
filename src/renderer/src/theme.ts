import type { Platform } from '@shared/types'

export const PLATFORM_COLOR: Record<Platform, string> = {
  twitch: '#9146ff',
  youtube: '#ff0033',
  kick: '#53fc18'
}

export const PLATFORM_NAME: Record<Platform, string> = {
  twitch: 'Twitch',
  youtube: 'YouTube',
  kick: 'Kick'
}

export type EventKind = 'subscription' | 'raid' | 'donation' | 'announcement' | 'system'

export interface EventAccent {
  label: string
  accent: string
  badgeText: string
}

/** Event rows carry a 2px accent border and a 7% wash; their badge uses the 15%
    tint and a lifted text tone so it stays legible at .75em. */
export const EVENT_ACCENT: Partial<Record<EventKind, EventAccent>> = {
  subscription: { label: 'SUB', accent: '#a78bfa', badgeText: '#bfa4ff' },
  raid: { label: 'RAID', accent: '#fbbf24', badgeText: '#f7c95a' },
  donation: { label: 'TIP', accent: '#34d399', badgeText: '#6ee7b7' },
  announcement: { label: 'NOTICE', accent: '#60a5fa', badgeText: '#8cc0fd' }
}

export const ROW_WASH = '12'
export const BADGE_WASH = '26'
