import type { YtContinuation, YtLiveChatResponse } from './types'

const ORIGIN = 'https://www.youtube.com'

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const FALLBACK_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'
const FALLBACK_CLIENT_VERSION = '2.20240101.00.00'

const ASSIGNMENT = String.raw`(?:"\])?\s*=\s*\{`

export interface InnertubeClient {
  apiKey: string
  clientVersion: string
}

export interface PageResult {
  status: number
  html: string
}

export async function fetchPage(url: string): Promise<PageResult> {
  const response = await fetch(url, {
    headers: {
      'user-agent': BROWSER_USER_AGENT,
      'accept-language': 'en-US,en;q=0.9'
    }
  })
  return { status: response.status, html: response.status === 200 ? await response.text() : '' }
}

export function extractInitialJson<T>(html: string, variable: string): T | null {
  const assignments = new RegExp(variable + ASSIGNMENT, 'g')

  for (let match = assignments.exec(html); match; match = assignments.exec(html)) {
    const start = html.indexOf('{', match.index)
    const end = findObjectEnd(html, start)
    if (end < 0) continue

    const parsed = parseOrNull<T>(html.slice(start, end + 1))
    if (parsed && Object.keys(parsed).length > 0) return parsed
  }

  return null
}

function parseOrNull<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

function findObjectEnd(html: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < html.length; i++) {
    const char = html[i]

    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }

    if (char === '"') inString = true
    else if (char === '{') depth++
    else if (char === '}' && --depth === 0) return i
  }

  return -1
}

export function readClient(html: string): InnertubeClient {
  return {
    apiKey: matchConfig(html, 'INNERTUBE_API_KEY') ?? FALLBACK_API_KEY,
    clientVersion: matchConfig(html, 'INNERTUBE_CLIENT_VERSION') ?? FALLBACK_CLIENT_VERSION
  }
}

function matchConfig(html: string, key: string): string | null {
  return new RegExp(`"${key}":"([^"]+)"`).exec(html)?.[1] ?? null
}

export async function fetchLiveChat(
  client: InnertubeClient,
  continuation: string
): Promise<YtLiveChatResponse> {
  const response = await fetch(
    `${ORIGIN}/youtubei/v1/live_chat/get_live_chat?key=${client.apiKey}&prettyPrint=false`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': BROWSER_USER_AGENT,
        'accept-language': 'en-US,en;q=0.9',
        'x-youtube-client-name': '1',
        'x-youtube-client-version': client.clientVersion
      },
      body: JSON.stringify({
        context: {
          client: { clientName: 'WEB', clientVersion: client.clientVersion, hl: 'en', gl: 'US' }
        },
        continuation
      })
    }
  )

  if (!response.ok) throw new Error(`live chat request failed: ${response.status}`)
  return (await response.json()) as YtLiveChatResponse
}

export function readContinuation(
  continuations: YtContinuation[] | undefined
): { token: string; timeoutMs: number } | null {
  const first = continuations?.[0]
  const data =
    first?.invalidationContinuationData ??
    first?.timedContinuationData ??
    first?.reloadContinuationData
  if (!data?.continuation) return null
  return { token: data.continuation, timeoutMs: data.timeoutMs ?? 0 }
}

export const YOUTUBE_ORIGIN = ORIGIN
