const URL = 'https://gql.twitch.tv/gql'

const WEB_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'

export async function twitchGql<TData>(
  query: string,
  variables: Record<string, unknown>,
): Promise<TData | null> {
  const response = await fetch(URL, {
    method: 'POST',
    headers: {
      'Client-Id': WEB_CLIENT_ID,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) return null

  const payload = (await response.json()) as { data?: TData }

  return payload.data ?? null
}
