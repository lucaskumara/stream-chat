import { describe, expect, it } from 'vitest'
import type { AccountState } from '@shared/types'
import { blockedReason, CAN_SEND } from '@/composer'

const READY: AccountState = {
  platform: 'twitch',
  status: 'signed-in',
  grants: ['read chat', 'send chat']
}

describe('CAN_SEND', () => {
  // YouTube sending is not built: its pane gets no composer at all rather than a box
  // that only ever refuses.
  it('covers the platforms this build can actually send on', () => {
    expect([...CAN_SEND].sort()).toEqual(['kick', 'twitch'])
  })
})

describe('blockedReason', () => {
  it('lets a signed-in, connected chat through', () => {
    expect(blockedReason(READY, 'twitch', 'connected')).toBeNull()
  })

  it('asks for a sign-in when there is no account', () => {
    expect(blockedReason(undefined, 'kick', 'connected')).toMatch(/Sign in to Kick/)
  })

  // The grant is read off the stored token, so a sign-in predating the write scope has
  // to say "again" rather than failing when the message is sent.
  it('asks for a fresh sign-in when the token predates the write scope', () => {
    const stale: AccountState = { ...READY, grants: ['read chat'] }

    expect(blockedReason(stale, 'twitch', 'connected')).toMatch(/again to allow sending/)
  })

  it('says so when the build carries no credentials for the platform', () => {
    const missing: AccountState = { platform: 'kick', status: 'not-configured' }

    expect(blockedReason(missing, 'kick', 'connected')).toMatch(/cannot sign in to Kick/)
  })

  // A YouTube live chat exists only while a broadcast runs, so offline is the normal
  // state rather than a fault — and YouTube's own reason is more use than ours.
  it('explains an offline chat using the platform’s own reason', () => {
    const youtube: AccountState = { ...READY, platform: 'youtube' }
    const reason = blockedReason(youtube, 'youtube', 'offline', 'not streaming right now')

    expect(reason).toBe('You are not live — not streaming right now')
  })

  it('still says you are not live when no reason came back', () => {
    expect(blockedReason(READY, 'youtube', 'offline')).toBe('You are not live')
  })

  it('reports a chat that is still connecting', () => {
    expect(blockedReason(READY, 'twitch', 'connecting')).toBe('Connecting…')
  })

  it('refuses a chat in error or disconnected', () => {
    expect(blockedReason(READY, 'twitch', 'error')).toMatch(/Not connected/)
    expect(blockedReason(READY, 'twitch', 'disconnected')).toMatch(/Not connected/)
  })

  // A missing scope is the user's to fix; a disconnected chat may fix itself, so the
  // account is the more actionable message when both apply.
  it('reports the account before the connection when both are wrong', () => {
    expect(blockedReason(undefined, 'twitch', 'offline')).toMatch(/Sign in to Twitch/)
  })
})
