/**
 * Fetches JSON, returning null instead of throwing.
 *
 * Only for genuinely optional data — emote sets and badge images — where a
 * third-party outage must never disturb chat. Anything whose failure the user
 * needs to know about should use fetch directly and handle its own errors.
 */
export async function fetchOptionalJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      console.warn(`[fetch] ${response.status} from ${url}`)
      return null
    }
    return (await response.json()) as T
  } catch (error) {
    console.warn(`[fetch] failed ${url}:`, error)
    return null
  }
}
