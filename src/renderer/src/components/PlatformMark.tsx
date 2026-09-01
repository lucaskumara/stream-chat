import type { Platform } from '@shared/types'

interface Mark {
  viewBox: string
  height: number
  path: string
}

/** Each mark is the site's own logo geometry, lifted once from the asset it ships:
    Twitch's header glitch, YouTube's `yt-ringo2` badge and kick.com/img/kick-logo.svg.
    Brand marks do not change the way badge art does, so these are inlined rather than
    fetched — the fetch-at-runtime rule exists for artwork the sites redraw. */
const MARK: Record<Platform, Mark> = {
  twitch: {
    viewBox: '0 0 25 30',
    height: 14,
    path:
      'M19 6v6h-2V6h2zm-7 0h2v6h-2V6zM5 0L0 5v18h6v5l5-5h4l9-9V0H5zm17 13l-4 4h-4l-4 4v-4H6V2h16v11z'
  },

  youtube: {
    viewBox: '0 0 29 20',
    height: 12,
    path:
      'M14.4848 20C14.4848 20 23.5695 20 25.8229 19.4C27.0917 19.06 28.0459 18.08 28.3808 16.87' +
      'C29 14.65 29 9.98 29 9.98C29 9.98 29 5.34 28.3808 3.14C28.0459 1.9 27.0917 0.94 25.8229 0.61' +
      'C23.5695 0 14.4848 0 14.4848 0C14.4848 0 5.42037 0 3.17711 0.61C1.9286 0.94 0.954148 1.9 0.59888 3.14' +
      'C0 5.34 0 9.98 0 9.98C0 9.98 0 14.65 0.59888 16.87C0.954148 18.08 1.9286 19.06 3.17711 19.4' +
      'C5.42037 20 14.4848 20 14.4848 20Z' +
      'M19 10L11.5 5.75V14.25L19 10Z'
  },

  kick: {
    viewBox: '0 0 22.24 26',
    height: 13,
    path:
      'M0 0.0307H8.3407V5.7942H11.1163V2.9125H13.8919V0.0307H22.2326V8.6927H19.457V11.5745' +
      'H16.6815V14.4562H19.457V17.338H22.2326V26H13.8919V23.1182H11.1163V20.2365H8.3407V26H0V0.0307Z'
  }
}

export interface PlatformMarkProps {
  platform: Platform
  height?: number
}

export function PlatformMark({ platform, height }: PlatformMarkProps): React.ReactElement {
  const mark = MARK[platform]
  const drawn = height ?? mark.height

  const [, , width, tall] = mark.viewBox.split(' ').map(Number)

  return (
    <svg
      width={(drawn * width) / tall}
      height={drawn}
      viewBox={mark.viewBox}
      fill="currentColor"
      aria-hidden
      focusable="false"
      className="flex-none"
    >
      <path fillRule="evenodd" clipRule="evenodd" d={mark.path} />
    </svg>
  )
}
