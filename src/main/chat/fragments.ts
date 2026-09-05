import type { Fragment } from '@shared/types'

export const REPLY_EXCERPT_LIMIT = 60

export function plainTextOf(fragments: Fragment[]): string {
  return fragments
    .map((fragment) =>
      fragment.kind === 'emote' ? fragment.name : fragment.text,
    )
    .join('')
}
