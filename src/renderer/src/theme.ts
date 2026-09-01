/** The v2 palette. Mirrors the custom properties in index.css for the places that
    need a raw value in TS — inline styles, canvas-free SVG fills, event accents. */
export const INK = {
  app: '#141414',
  inset: '#181818',
  card: '#1c1c1c',
  raised: '#242424',

  line: '#262626',
  line2: '#303030',

  hoverRow: '#1e1e1e',
  segmentOn: '#333333',

  fg: '#e6e6e6',
  fg2: '#9d9d9d',
  fg3: '#767676',
  fg4: '#5f5f5f',
  heading: '#f2f2f2',

  offlineDot: '#4a4a4a'
} as const

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
