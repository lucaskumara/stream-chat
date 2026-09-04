import { describe, expect, it } from 'vitest'
import type { PlatformConfig } from '@shared/types'
import { dirtyPatch, draftFrom, type PlatformDraft } from '@/views/Settings/platformDraft'

function config(overrides: Partial<PlatformConfig> = {}): PlatformConfig {
  return {
    platform: 'twitch',
    channel: 'xqc',
    ingestUrl: '',
    streamKey: 'saved_key',
    forward: false,
    emoteProviders: { sevenTv: true, bttv: true },
    ...overrides
  }
}

// Matches config()'s own defaults, field for field — a draft freshly seeded
// from that config and never touched, which is what "nothing changed" means
// now that the comparison is against the saved value rather than "holds
// anything at all".
function draft(overrides: Partial<PlatformDraft> = {}): PlatformDraft {
  return {
    channel: 'xqc',
    ingestUrl: '',
    streamKey: 'saved_key',
    emoteProviders: { sevenTv: true, bttv: true },
    ...overrides
  }
}

describe('draftFrom', () => {
  it('starts a draft from the saved config, key included', () => {
    expect(
      draftFrom(config({ channel: 'xqc', ingestUrl: 'rtmp://x', streamKey: 'live_abc' }))
    ).toEqual({
      channel: 'xqc',
      ingestUrl: 'rtmp://x',
      streamKey: 'live_abc',
      emoteProviders: { sevenTv: true, bttv: true }
    })
  })

  it('starts with an empty key when none is saved', () => {
    expect(draftFrom(config({ streamKey: '' })).streamKey).toBe('')
  })
})

describe('dirtyPatch', () => {
  it('is empty when nothing changed', () => {
    expect(dirtyPatch(draft(), config())).toEqual({})
  })

  it('carries the channel only when it changed', () => {
    expect(dirtyPatch(draft({ channel: 'theburntpeanut' }), config())).toEqual({
      channel: 'theburntpeanut'
    })
  })

  it('carries the ingest url only when it changed', () => {
    expect(dirtyPatch(draft({ ingestUrl: 'rtmps://new' }), config())).toEqual({
      ingestUrl: 'rtmps://new'
    })
  })

  it('treats a still-empty key, on a platform with none saved, as unchanged', () => {
    expect(dirtyPatch(draft({ streamKey: '' }), config({ streamKey: '' }))).toEqual({})
  })

  it('carries the key once it differs from what is saved', () => {
    expect(dirtyPatch(draft({ streamKey: 'live_123' }), config({ streamKey: 'saved_key' }))).toEqual({
      streamKey: 'live_123'
    })
  })

  // Clearing the field and saving is a real, explicit "remove this key" now
  // that the comparison is against the saved value.
  it('carries an emptied key as an explicit clear', () => {
    expect(dirtyPatch(draft({ streamKey: '' }), config({ streamKey: 'saved_key' }))).toEqual({
      streamKey: ''
    })
  })

  it('carries emoteProviders only when a flag differs', () => {
    expect(
      dirtyPatch(draft({ emoteProviders: { sevenTv: false, bttv: true } }), config())
    ).toEqual({ emoteProviders: { sevenTv: false, bttv: true } })
  })

  it('combines every changed field in one patch', () => {
    expect(
      dirtyPatch(
        draft({ channel: 'new', streamKey: 'k' }),
        config({ channel: 'xqc', streamKey: 'saved_key' })
      )
    ).toEqual({ channel: 'new', streamKey: 'k' })
  })
})
