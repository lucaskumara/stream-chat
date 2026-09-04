import type { EmoteProvider, EmoteProviderSettings } from '@shared/types'

/** Whether an already-rendered emote fragment should still draw as an image. Settings
    are per platform and can change after the message was received — main only ever
    substitutes at the moment a message arrives, so this is what lets turning a
    provider off hide it from history immediately rather than only from new messages,
    without the renderer re-parsing anything: the fragment is already classified by
    provider, this just decides how to draw it. Turning a provider back on cannot
    retroactively image-ify old messages the same way, since a fragment that never
    matched carries no record that it could have. */
export function emoteProviderEnabled(
  provider: EmoteProvider | undefined,
  providers: EmoteProviderSettings | undefined
): boolean {
  if (provider === '7tv') return providers?.sevenTv !== false
  if (provider === 'bttv') return providers?.bttv !== false

  return true
}
