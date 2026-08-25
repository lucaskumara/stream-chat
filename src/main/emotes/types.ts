/** A third-party emote, already resolved to displayable image URLs. */
import type { EmoteProvider } from '@shared/types'

export interface ThirdPartyEmote {
  name: string
  url: string
  srcSet: string
  animated: boolean
  provider: EmoteProvider
}
