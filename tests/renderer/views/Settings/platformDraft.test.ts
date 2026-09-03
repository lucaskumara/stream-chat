import { describe, expect, it } from 'vitest'
import type { PlatformConfig } from '@shared/types'
import { dirtyPatch, draftFrom, type PlatformDraft } from '@/views/Settings/platformDraft'

function config(overrides: Partial<PlatformConfig> = {}): PlatformConfig {
  return {
    platform: 'twitch',
    channel: 'xqc',
    ingestUrl: '',
    hasStreamKey: true,
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
    replacingKey: false,
    emoteProviders: { sevenTv: true, bttv: true },
    ...overrides
  }
}

describe('draftFrom', () => {
  it('starts a draft from the saved config, with an empty and non-replacing key', () => {
    expect(draftFrom(config({ channel: 'xqc', ingestUrl: 'rtmp://x' }))).toEqual({
      channel: 'xqc',
      ingestUrl: 'rtmp://x',
      streamKey: '',
      replacingKey: false,
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

  // The stream key is write-only — main never sends it back — so "unchanged" is
  // judged by whether Replace was ever clicked, not by comparing to a value the
  // draft was never given.
  it('leaves the stream key out while not replacing it, whatever the draft holds', () => {
    expect(dirtyPatch(draft({ streamKey: 'leftover', replacingKey: false }), config())).toEqual({})
  })

  it('leaves the stream key out while replacing but still empty', () => {
    expect(dirtyPatch(draft({ streamKey: '', replacingKey: true }), config())).toEqual({})
  })

  it('carries the stream key once replacing with a real value', () => {
    expect(dirtyPatch(draft({ streamKey: 'live_123', replacingKey: true }), config())).toEqual({
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
      dirtyPatch(
        draft({ channel: 'new', streamKey: 'k', replacingKey: true }),
        config({ channel: 'xqc' })
      )
    ).toEqual({ channel: 'new', streamKey: 'k' })
  })
})
