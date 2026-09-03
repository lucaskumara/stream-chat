import { log } from '../log'

export async function fetchOptionalJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      log('fetch').debug(`${response.status} from ${url}`)
      return null
    }
    return (await response.json()) as T
  } catch (error) {
    log('fetch').warn(`failed ${url}:`, error)
    return null
  }
}
