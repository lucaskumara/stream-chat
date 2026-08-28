import { useState } from 'react'
import type { Platform } from '@shared/types'

export const PLATFORM_COLOR: Record<Platform, string> = {
  twitch: '#9146ff',
  youtube: '#ff0033',
  kick: '#53fc18'
}

const FAVICON: Record<Platform, string> = {
  twitch: 'https://www.twitch.tv/favicon.ico',
  youtube: 'https://www.youtube.com/favicon.ico',
  kick: 'https://kick.com/favicon.ico'
}

export function PlatformIcon({
  platform,
  size = 14
}: {
  platform: Platform
  size?: number
}): React.ReactElement {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <span
        title={platform}
        style={{
          width: Math.round(size * 0.55),
          height: Math.round(size * 0.55),
          flexShrink: 0,
          borderRadius: '50%',
          background: PLATFORM_COLOR[platform]
        }}
      />
    )
  }

  return (
    <img
      src={FAVICON[platform]}
      alt={platform}
      title={platform}
      width={size}
      height={size}
      draggable={false}
      onError={() => setFailed(true)}
      style={{ flexShrink: 0, borderRadius: 2, objectFit: 'contain' }}
    />
  )
}
