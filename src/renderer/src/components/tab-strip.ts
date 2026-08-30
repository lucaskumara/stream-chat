export const TAB_GUTTER_PX = 2

const GROUP_COLORS = ['#6ea8d8', '#78bb92', '#d0a45e', '#b48ad4', '#d3838f', '#5fb8b8']

export interface Span {
  left: number
  right: number
}

export interface Run {
  start: number
  end: number
}

export interface Unit {
  ids: string[]
  left: number
  width: number
}

export interface Block {
  left: number
  width: number
  rest: Unit[]
}

export interface Membership {
  members: string[]
  color: string
}

export interface GroupMark {
  className: string
  color: string
  start: boolean
}

export function measureTabs(): Map<string, Span> {
  const spans = new Map<string, Span>()

  for (const node of document.querySelectorAll('.ant-tabs-tab[data-node-key]')) {
    const key = node.getAttribute('data-node-key')
    if (!key) continue

    const rect = node.getBoundingClientRect()
    spans.set(key, { left: rect.left, right: rect.right })
  }

  return spans
}

export function spanOver(spans: Map<string, Span>, members: Iterable<string>): Span | null {
  let left = Infinity
  let right = -Infinity

  for (const id of members) {
    const span = spans.get(id)
    if (!span) continue

    left = Math.min(left, span.left)
    right = Math.max(right, span.right)
  }

  return right === -Infinity ? null : { left, right }
}

export function travelBounds(span: Span, limit: Span): { min: number; max: number } {
  return { min: limit.left - span.left, max: limit.right - span.right }
}

export function clamp(value: number, limit: { min: number; max: number } | null): number {
  return limit ? Math.min(Math.max(value, limit.min), limit.max) : value
}

export function ownership(groups: string[][]): Map<string, Membership> {
  const owner = new Map<string, Membership>()

  groups.forEach((members, index) => {
    const membership = { members, color: GROUP_COLORS[index % GROUP_COLORS.length] }

    for (const id of members) owner.set(id, membership)
  })

  return owner
}

export function contiguousOrder(ids: string[], groups: string[][]): string[] {
  const owner = ownership(groups)

  const runs = new Map<string[], string[]>()

  for (const id of ids) {
    const held = owner.get(id)
    if (!held) continue

    const run = runs.get(held.members)

    if (run) run.push(id)
    else runs.set(held.members, [id])
  }

  const ordered: string[] = []
  const placed = new Set<string[]>()

  for (const id of ids) {
    const held = owner.get(id)

    if (!held) {
      ordered.push(id)
      continue
    }

    if (placed.has(held.members)) continue

    placed.add(held.members)
    ordered.push(...(runs.get(held.members) ?? []))
  }

  return ordered
}

export function runsFor(ids: string[], owner: Map<string, Membership>): (Run | null)[] {
  const spans = new Map<string[], Run>()

  ids.forEach((id, at) => {
    const held = owner.get(id)
    if (!held) return

    const run = spans.get(held.members)

    if (run) run.end = at
    else spans.set(held.members, { start: at, end: at })
  })

  return ids.map((id) => {
    const held = owner.get(id)

    return held ? (spans.get(held.members) ?? null) : null
  })
}

export function marksFor(ids: string[], owner: Map<string, Membership>): Map<string, GroupMark> {
  const marks = new Map<string, GroupMark>()

  ids.forEach((id, at) => {
    const held = owner.get(id)
    if (!held) return

    const joins = (other: string | undefined): boolean =>
      other !== undefined && owner.get(other)?.members === held.members

    const start = !joins(ids[at - 1])
    const classes = ['tab-group']

    if (start) classes.push('tab-group-start')
    if (!joins(ids[at + 1])) classes.push('tab-group-end')

    marks.set(id, { className: classes.join(' '), color: held.color, start })
  })

  return marks
}

export function neighbourUnits(
  ids: string[],
  spans: Map<string, Span>,
  owner: Map<string, Membership>,
  carried: string[]
): Unit[] {
  const units: Unit[] = []

  for (const id of ids) {
    if (carried.includes(id)) continue

    const span = spans.get(id)
    if (!span) continue

    const held = owner.get(id)
    const open = units[units.length - 1]
    const last = open?.ids[open.ids.length - 1]

    if (held && open && last !== undefined && owner.get(last)?.members === held.members) {
      open.ids.push(id)
      open.width = span.right - open.left
      continue
    }

    units.push({ ids: [id], left: span.left, width: span.right - span.left })
  }

  return units
}

function sweptPast(units: { width: number }[], distance: number): number {
  let travelled = 0
  let passed = 0

  for (const unit of units) {
    if (distance < travelled + unit.width / 2 + TAB_GUTTER_PX) break

    travelled += unit.width + TAB_GUTTER_PX
    passed++
  }

  return passed
}

export function passedNeighbours(block: Block | null, dx: number): Unit[] {
  if (!block || dx === 0) return []

  const lane =
    dx > 0
      ? block.rest.filter((unit) => unit.left > block.left)
      : [...block.rest.filter((unit) => unit.left < block.left)].reverse()

  return lane.slice(0, sweptPast(lane, Math.abs(dx)))
}
