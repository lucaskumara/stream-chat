const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 30_000
const MAX_DOUBLINGS = 5
const MAX_JITTER_MS = 500

/**
 * Exponential backoff with jitter, capped so a long outage still retries at a
 * sane interval. Jitter keeps several sockets from reconnecting in lockstep
 * after a shared network blip.
 */
export function reconnectDelayMs(attempt: number): number {
  const doublings = Math.min(attempt, MAX_DOUBLINGS)
  const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** doublings)
  return delay + Math.round(Math.random() * MAX_JITTER_MS)
}
