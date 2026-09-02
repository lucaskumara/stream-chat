import type { AccountState, Platform, SourceStatus } from '@shared/types'

/** Which platforms this build can send on at all. YouTube comes next; until it does, its
    pane gets no composer rather than a box that only ever refuses. */
export const CAN_SEND: readonly Platform[] = ['twitch', 'kick']

const NAME: Record<Platform, string> = {
  twitch: 'Twitch',
  youtube: 'YouTube',
  kick: 'Kick'
}

/** Null means the box is usable. Everything else is a reason phrased as the placeholder,
    so the input itself explains why it will not take a message. The `send chat` grant is
    read off the token the account actually holds, so a sign-in predating the write scope
    reads as "sign in again" rather than failing at the moment of sending.

    The account is checked before the connection: a missing scope is the user's to fix,
    while a disconnected chat may fix itself. */
export function blockedReason(
  account: AccountState | undefined,
  platform: Platform,
  status: SourceStatus,
  statusReason?: string
): string | null {
  const name = NAME[platform]

  if (account?.status === 'not-configured') {
    return `This build cannot sign in to ${name}`
  }

  if (!account || account.status !== 'signed-in') return `Sign in to ${name} to chat`

  if (!account.grants?.includes('send chat')) {
    return `Sign in to ${name} again to allow sending`
  }

  if (status === 'connected') return null

  if (status === 'connecting') return 'Connecting…'

  /** YouTube reports its own reason — "not streaming right now", "live chat is turned off
      for this stream" — and it is more use than anything phrased here. */
  if (status === 'offline') {
    return statusReason ? `You are not live — ${statusReason}` : 'You are not live'
  }

  return `Not connected to ${name}`
}
