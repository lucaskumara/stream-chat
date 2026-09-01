import { createHash, randomBytes } from 'node:crypto'

/** base64url, which is what RFC 7636 asks for and what Node's 'base64url' encoding
    already produces — no padding, no + or /. */
function random(bytes: number): string {
  return randomBytes(bytes).toString('base64url')
}

export function createVerifier(): string {
  return random(64)
}

export function createState(): string {
  return random(16)
}

export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

/** The redirect carries the authorization code back, and the state has to match the one
    that went out — a mismatch means the response belongs to some other request, which is
    the whole point of sending it. Loopback is a shared surface: anything on the machine
    can hit our port. */
export interface AuthorizationResponse {
  code?: string
  error?: string
}

export function readRedirect(url: URL, expectedState: string): AuthorizationResponse {
  const error = url.searchParams.get('error')
  if (error) return { error }

  if (url.searchParams.get('state') !== expectedState) {
    return { error: 'state mismatch — ignoring a redirect this app did not start' }
  }

  const code = url.searchParams.get('code')
  if (!code) return { error: 'no authorization code in the redirect' }

  return { code }
}
