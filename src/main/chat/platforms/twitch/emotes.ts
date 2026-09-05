import type { Fragment } from '@shared/types'

const EMOTE_CDN = 'https://static-cdn.jtvnw.net/emoticons/v2'

type EmoteFormat = 'default' | 'static' | 'animated'

export function twitchEmote(
  id: string,
  name: string,
  formats?: string[],
): Fragment {
  const format: EmoteFormat = formats
    ? formats.includes('animated')
      ? 'animated'
      : 'static'
    : 'default'

  const at = (scale: string): string =>
    `${EMOTE_CDN}/${id}/${format}/dark/${scale}`

  return {
    kind: 'emote',
    name,
    url: at('1.0'),
    srcSet: `${at('1.0')} 1x, ${at('2.0')} 2x, ${at('3.0')} 3x`,
    provider: 'native',
  }
}
