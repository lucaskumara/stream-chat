import { describe, expect, it } from 'vitest'
import { clampPoll } from '@main/chat/platforms/youtube'

const MIN_POLL_MS = 250
const MAX_POLL_MS = 500

describe('clampPoll', () => {
  // YouTube answers timeoutMs: 10000, and honouring it delivers chat in ten-second
  // bursts. The ceiling is the whole point of owning the cadence.
  it('ignores the ten seconds YouTube actually suggests', () => {
    expect(clampPoll(10_000)).toBe(MAX_POLL_MS)
  })

  it('never polls faster than the floor', () => {
    expect(clampPoll(50)).toBe(MIN_POLL_MS)
  })

  it('keeps a suggestion that already sits inside the range', () => {
    expect(clampPoll(300)).toBe(300)
  })

  it('falls back to the ceiling when no suggestion arrives', () => {
    expect(clampPoll(0)).toBe(MAX_POLL_MS)
  })

  it('stays inside the range for anything it is handed', () => {
    for (const suggestion of [-1000, 0, 1, 250, 499, 500, 501, 60_000]) {
      const polled = clampPoll(suggestion)

      expect(polled).toBeGreaterThanOrEqual(MIN_POLL_MS)
      expect(polled).toBeLessThanOrEqual(MAX_POLL_MS)
    }
  })
})
