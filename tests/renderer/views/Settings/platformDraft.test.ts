import { describe, expect, it } from 'vitest'
import type { PlatformConfig } from '@shared/types'
import {
  dirtyPatch,
  draftFrom,
  keyPlaceholder,
  type PlatformDraft
} from '@/views/Settings/platformDraft'

function config(overrides: Partial<PlatformConfig> = {}): PlatformConfig {
  return {
    platform: 'twitch',
    channel: 'xqc',
    ingestUrl: '',
    hasStreamKey: true,
    streamKeyLength: 16,
    forward: false,
    emoteProviders: { sevenTv: true, bttv: true },
    ...overrides
  }
}

function draft(overrides: Partial<PlatformDraft> = {}): PlatformDraft {
  return {
    channel: 'xqc',
    ingestUrl: '',
    streamKey: '',
    emoteProviders: { sevenTv: true, bttv: true },
    ...overrides
  }
}

describe('draftFrom', () => {
  it('starts a draft from the saved config, with an empty key', () => {
    expect(draftFrom(config({ channel: 'xqc', ingestUrl: 'rtmp://x' }))).toEqual({
      channel: 'xqc',
      ingestUrl: 'rtmp://x',
      streamKey: '',
      emoteProviders: { sevenTv: true, bttv: true }
    })
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

  // The stream key is write-only — main never sends it back — so the draft
  // always starts empty and "changed" just means something was typed.
  it('leaves the stream key out while the draft is still empty', () => {
    expect(dirtyPatch(draft({ streamKey: '' }), config())).toEqual({})
  })

  it('carries the stream key once something is typed', () => {
    expect(dirtyPatch(draft({ streamKey: 'live_123' }), config())).toEqual({
      streamKey: 'live_123'
    })
  })

  it('carries emoteProviders only when a flag differs', () => {
    expect(
      dirtyPatch(draft({ emoteProviders: { sevenTv: false, bttv: true } }), config())
    ).toEqual({ emoteProviders: { sevenTv: false, bttv: true } })
  })

  it('combines every changed field in one patch', () => {
    expect(
      dirtyPatch(draft({ channel: 'new', streamKey: 'k' }), config({ channel: 'xqc' }))
    ).toEqual({ channel: 'new', streamKey: 'k' })
  })
})

describe('keyPlaceholder', () => {
  // Main never sends the real key back, only its length — so the placeholder
  // is dots matching that length, not a fixed run that lies about it.
  it('masks a saved key at its real length', () => {
    expect(keyPlaceholder(config({ hasStreamKey: true, streamKeyLength: 24 }))).toBe(
      '•'.repeat(24)
    )
  })

  it('prompts for a key when none is set', () => {
    expect(keyPlaceholder(config({ hasStreamKey: false, streamKeyLength: 0 }))).toBe(
      'Paste your stream key'
    )
  })

  it('prompts for a key when the config has not loaded yet', () => {
    expect(keyPlaceholder(undefined)).toBe('Paste your stream key')
  })
})
