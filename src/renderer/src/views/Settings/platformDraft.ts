import type { EmoteProviderSettings, PlatformConfig, PlatformPatch } from '@shared/types'

/** The page's own working copy of one platform's card, held until Save changes is
    clicked. The stream key is write-only from main, so the draft always starts
    empty — "changed" is simply whether the field holds anything at all, never a
    comparison to a value the draft was never given. */
export interface PlatformDraft {
  channel: string
  ingestUrl: string
  streamKey: string
  emoteProviders: EmoteProviderSettings
}

export function draftFrom(config: PlatformConfig): PlatformDraft {
  return {
    channel: config.channel,
    ingestUrl: config.ingestUrl,
    streamKey: '',
    emoteProviders: { ...config.emoteProviders }
  }
}

function emoteProvidersChanged(draft: EmoteProviderSettings, saved: EmoteProviderSettings): boolean {
  return draft.sevenTv !== saved.sevenTv || draft.bttv !== saved.bttv
}

/** Only the fields that actually differ from what's saved — an empty object
    means this platform has nothing to save. Save changes calls this per
    platform rather than sending the whole draft, so an untouched field is never
    overwritten with a value that merely wasn't edited. */
export function dirtyPatch(draft: PlatformDraft, saved: PlatformConfig): PlatformPatch {
  const patch: PlatformPatch = {}

  if (draft.channel !== saved.channel) patch.channel = draft.channel
  if (draft.ingestUrl !== saved.ingestUrl) patch.ingestUrl = draft.ingestUrl
  if (draft.streamKey !== '') patch.streamKey = draft.streamKey
  if (emoteProvidersChanged(draft.emoteProviders, saved.emoteProviders)) {
    patch.emoteProviders = draft.emoteProviders
  }

  return patch
}
