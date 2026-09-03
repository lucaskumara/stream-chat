import { useEffect, useState } from 'react'
import type { Platform, PlatformConfig } from '@shared/types'
import { PLATFORMS } from '@shared/types'
import { bridge } from '../../bridge'
import { PLATFORM_NAME } from '../../theme'
import { useStore } from '../../store'
import { dirtyPatch, draftFrom, type PlatformDraft } from './platformDraft'

const SAVED_FLASH_MS = 1500

function emptyDraft(): PlatformDraft {
  return { channel: '', ingestUrl: '', streamKey: '', emoteProviders: { sevenTv: true, bttv: true } }
}

function isDirty(configs: PlatformConfig[], drafts: Partial<Record<Platform, PlatformDraft>>): boolean {
  return PLATFORMS.some((platform) => {
    const config = configs.find((c) => c.platform === platform)
    const draft = drafts[platform]

    return config !== undefined && draft !== undefined && Object.keys(dirtyPatch(draft, config)).length > 0
  })
}

export interface PlatformDraftsApi {
  configs: PlatformConfig[]
  draftFor: (platform: Platform) => PlatformDraft
  errorFor: (platform: Platform) => string | undefined
  updateDraft: (platform: Platform, patch: Partial<PlatformDraft>) => void
  dirty: boolean
  saving: boolean
  savedFlash: boolean
  save: () => Promise<void>
}

/** Lifted out of the Platforms pane itself so Settings can render the Save bar as
    a layout sibling of the scrollable card list rather than an overlay pinned
    inside it — see the "hovering weirdly" fix. Always called, regardless of
    which pane is showing, so the footer can mount instantly the moment the user
    switches to Platforms without waiting on an effect. */
export function usePlatformDrafts(): PlatformDraftsApi {
  const configs = useStore((s) => s.platforms)

  const [drafts, setDrafts] = useState<Partial<Record<Platform, PlatformDraft>>>({})
  const [errors, setErrors] = useState<Partial<Record<Platform, string>>>({})
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)

  // Settings is a modal over the whole app, so this is the only screen that can be
  // showing while a platform's config changes underneath it — and the only source
  // of that change while it's open is this hook's own save. Filling in a draft
  // only when one doesn't exist yet, rather than resyncing on every config
  // change, is what keeps a save from clobbering whatever the user is mid-typing.
  useEffect(() => {
    setDrafts((held) => {
      const next = { ...held }
      let changed = false

      for (const config of configs) {
        if (next[config.platform]) continue

        next[config.platform] = draftFrom(config)
        changed = true
      }

      return changed ? next : held
    })
  }, [configs])

  const updateDraft = (platform: Platform, patch: Partial<PlatformDraft>): void => {
    setDrafts((held) => ({
      ...held,
      [platform]: { ...(held[platform] ?? emptyDraft()), ...patch }
    }))

    if (patch.channel !== undefined) {
      setErrors((held) => {
        if (!held[platform]) return held

        const next = { ...held }
        delete next[platform]
        return next
      })
    }
  }

  const save = async (): Promise<void> => {
    setSaving(true)

    const nextDrafts = { ...drafts }
    const nextErrors: Partial<Record<Platform, string>> = {}

    for (const platform of PLATFORMS) {
      const config = configs.find((c) => c.platform === platform)
      const draft = drafts[platform]
      if (!config || !draft) continue

      const patch = dirtyPatch(draft, config)
      if (Object.keys(patch).length === 0) continue

      if (patch.channel) {
        const result = await bridge()
          .api.verifyChannel(platform, patch.channel)
          .catch((error): { ok: true; canonicalIdentifier?: string } => {
            console.debug('[platforms]', platform, 'verifyChannel', error)
            return { ok: true }
          })

        if (!result.ok) {
          nextErrors[platform] = result.reason ?? `${PLATFORM_NAME[platform]} channel not found.`
          delete patch.channel
        } else if (result.canonicalIdentifier) {
          patch.channel = result.canonicalIdentifier
          nextDrafts[platform] = { ...draft, channel: result.canonicalIdentifier }
        }
      }

      if (Object.keys(patch).length > 0) {
        await bridge()
          .api.savePlatform(platform, patch)
          .catch((error) => console.debug('[platforms]', platform, 'savePlatform', error))

        nextDrafts[platform] = { ...(nextDrafts[platform] ?? draft), streamKey: '' }
      }
    }

    setDrafts(nextDrafts)
    setErrors(nextErrors)
    setSaving(false)

    if (Object.keys(nextErrors).length === 0) {
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), SAVED_FLASH_MS)
    }
  }

  return {
    configs,
    draftFor: (platform) => drafts[platform] ?? emptyDraft(),
    errorFor: (platform) => errors[platform],
    updateDraft,
    dirty: isDirty(configs, drafts),
    saving,
    savedFlash,
    save
  }
}
