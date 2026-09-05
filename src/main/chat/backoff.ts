const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 30_000
const MAX_DOUBLINGS = 5
const MAX_JITTER_MS = 500

export function reconnectDelayMs(attempt: number): number {
  const doublings = Math.min(attempt, MAX_DOUBLINGS)
  const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** doublings)
  return delay + Math.round(Math.random() * MAX_JITTER_MS)
}
