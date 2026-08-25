import type { EmoteProvider } from '@shared/types'

export interface ThirdPartyEmote {
  name: string
  url: string
  srcSet: string
  animated: boolean
  provider: EmoteProvider
}
