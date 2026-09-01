import type { ChatMessage } from '@shared/types'

/** Each source's list is already in arrival order, so the merged view is a k-way
    merge rather than a sort of the concatenation — linear in the total, and stable:
    messages sharing a timestamp keep the order their sources are listed in, which is
    tab order. A `sort` would be re-run over every held message on each 100ms batch. */
export function mergeMessages(lists: ChatMessage[][]): ChatMessage[] {
  const feeding = lists.filter((list) => list.length > 0)
  if (feeding.length === 0) return []
  if (feeding.length === 1) return feeding[0]

  const total = feeding.reduce((count, list) => count + list.length, 0)
  const merged: ChatMessage[] = new Array(total)
  const at = new Array(feeding.length).fill(0)

  for (let out = 0; out < total; out++) {
    let from = -1
    let earliest = Infinity

    for (let each = 0; each < feeding.length; each++) {
      const held = feeding[each][at[each]]
      if (!held || held.timestamp >= earliest) continue

      from = each
      earliest = held.timestamp
    }

    merged[out] = feeding[from][at[from]++]
  }

  return merged
}
