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
