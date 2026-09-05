import { describe, expect, it } from 'vitest'
import { reconnectDelayMs } from '@main/chat/backoff'

const JITTER_MS = 500

describe('reconnectDelayMs', () => {
  it('starts at a second plus jitter', () => {
    const delay = reconnectDelayMs(0)

    expect(delay).toBeGreaterThanOrEqual(1000)
    expect(delay).toBeLessThanOrEqual(1000 + JITTER_MS)
  })

  it('doubles with each attempt', () => {
    for (const [attempt, base] of [
      [1, 2000],
      [2, 4000],
      [3, 8000],
      [4, 16000],
    ] as const) {
      const delay = reconnectDelayMs(attempt)

      expect(delay).toBeGreaterThanOrEqual(base)
      expect(delay).toBeLessThanOrEqual(base + JITTER_MS)
    }
  })

  it('stops doubling at thirty seconds however many attempts have failed', () => {
    for (const attempt of [5, 6, 20, 500]) {
      const delay = reconnectDelayMs(attempt)

      expect(delay).toBeGreaterThanOrEqual(30_000)
      expect(delay).toBeLessThanOrEqual(30_000 + JITTER_MS)
    }
  })

  it('jitters, so several sockets do not retry in lockstep', () => {
    const delays = new Set(
      Array.from({ length: 50 }, () => reconnectDelayMs(0)),
    )

    expect(delays.size).toBeGreaterThan(1)
  })
})
