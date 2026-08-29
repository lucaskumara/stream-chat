import { cloneElement, memo, useCallback, useMemo, useRef, useState } from 'react'
import { Badge, Flex, Tabs, Tooltip } from 'antd'
import { Ellipsis, Pin, Plus, X } from 'lucide-react'
import type { BadgeProps, TabsProps } from 'antd'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type Modifier
} from '@dnd-kit/core'
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
  type SortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { SourceState, SourceStatus } from '@shared/types'
import { useStore } from '../store'
import { INK } from '../theme'
import { PlatformIcon } from './PlatformIcon'

const DRAG_THRESHOLD_PX = 5

const TAB_GUTTER_PX = 2

const NUDGE = 'transform 200ms cubic-bezier(0.2, 0, 0, 1)'

const GROUP_COLORS = ['#6ea8d8', '#78bb92', '#d0a45e', '#b48ad4', '#d3838f', '#5fb8b8']

const STATUS_BADGE: Record<SourceStatus, BadgeProps['status']> = {
  connected: 'success',
  connecting: 'processing',
  disconnected: 'default',
  offline: 'warning',
  error: 'error'
}

type TabNode = React.ReactElement<
  React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLElement> }
>

interface Span {
  left: number
  right: number
}

interface Run {
  start: number
  end: number
}

interface Unit {
  ids: string[]
  left: number
  width: number
}

interface Block {
  left: number
  width: number
  rest: Unit[]
}

interface Membership {
  members: string[]
  color: string
}

interface GroupMark {
  className: string
  color: string
  start: boolean
}

interface DraggableTabProps extends React.HTMLAttributes<HTMLDivElement> {
  'data-node-key': string
  shown: boolean
  carryX?: number
  nudgeX?: number
  settling: boolean
  mark?: GroupMark
}

function measureTabs(): Map<string, Span> {
  const spans = new Map<string, Span>()

  for (const node of document.querySelectorAll('.ant-tabs-tab[data-node-key]')) {
    const key = node.getAttribute('data-node-key')
    if (!key) continue

    const rect = node.getBoundingClientRect()
    spans.set(key, { left: rect.left, right: rect.right })
  }

  return spans
}

function spanOver(spans: Map<string, Span>, members: Iterable<string>): Span | null {
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

function travelBounds(span: Span, limit: Span): { min: number; max: number } {
  return { min: limit.left - span.left, max: limit.right - span.right }
}

function clamp(value: number, limit: { min: number; max: number } | null): number {
  return limit ? Math.min(Math.max(value, limit.min), limit.max) : value
}

function ownership(groups: string[][]): Map<string, Membership> {
  const owner = new Map<string, Membership>()

  groups.forEach((members, index) => {
    const membership = { members, color: GROUP_COLORS[index % GROUP_COLORS.length] }

    for (const id of members) owner.set(id, membership)
  })

  return owner
}

function contiguousOrder(ids: string[], groups: string[][]): string[] {
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

function runsFor(ids: string[], owner: Map<string, Membership>): (Run | null)[] {
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

function marksFor(ids: string[], owner: Map<string, Membership>): Map<string, GroupMark> {
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

function neighbourUnits(
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

function passedNeighbours(block: Block | null, dx: number): Unit[] {
  if (!block || dx === 0) return []

  const lane =
    dx > 0
      ? block.rest.filter((unit) => unit.left > block.left)
      : [...block.rest.filter((unit) => unit.left < block.left)].reverse()

  return lane.slice(0, sweptPast(lane, Math.abs(dx)))
}

function DraggableTab({
  shown,
  carryX,
  nudgeX,
  settling,
  mark,
  children,
  ...props
}: DraggableTabProps): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props['data-node-key']
  })

  const carried = carryX !== undefined
  const shifted = carried ? carryX : nudgeX

  const style = {
    ...props.style,
    transform:
      shifted !== undefined
        ? `translate3d(${shifted}px, 0, 0)`
        : CSS.Translate.toString(transform),
    transition:
      isDragging || carried || settling
        ? 'none'
        : nudgeX !== undefined
          ? NUDGE
          : transition,
    zIndex: isDragging || carried ? 2 : undefined,
    cursor: isDragging || carried ? 'grabbing' : 'pointer',
    ...(mark ? { '--group-color': mark.color } : {})
  } as React.CSSProperties

  return cloneElement(children as TabNode, {
    ref: setNodeRef,
    style,
    className: [props.className, shown ? 'tab-shown' : '', mark?.className]
      .filter(Boolean)
      .join(' '),
    ...attributes,
    ...listeners
  })
}

const TabLabel = memo(function TabLabel({
  source,
  shown,
  onlyOne,
  groupStart,
  onGrip,
  onSplit
}: {
  source: SourceState
  shown: boolean
  onlyOne: boolean
  groupStart: boolean
  onGrip: (sourceId: string) => void
  onSplit: (sourceId: string) => void
}): React.ReactElement {
  const inert = shown && onlyOne

  return (
    <Flex align="center" gap={7}>
      {groupStart && (
        <Tooltip title="Drag the whole group" mouseEnterDelay={0.3}>
          <span className="tab-grip" onPointerDown={() => onGrip(source.id)} />
        </Tooltip>
      )}

      <PlatformIcon platform={source.platform} />

      <span>{source.label}</span>

      {source.status !== 'connected' && (
        <Tooltip title={source.error ?? source.status}>
          <Badge status={STATUS_BADGE[source.status]} />
        </Tooltip>
      )}

      {!inert && (
        <span
          role="button"
          className={['tab-split', shown ? 'tab-split-on' : ''].filter(Boolean).join(' ')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onSplit(source.id)
          }}
        >
          <Pin size={16} />
        </span>
      )}
    </Flex>
  )
})

export interface ChannelTabsProps {
  sources: SourceState[]
  visibleIds: string[]
  onAdd: () => void
  onRemove: (source: SourceState) => void
  onReorder: (orderedIds: string[]) => void
}

export function ChannelTabs({
  sources,
  visibleIds,
  onAdd,
  onRemove,
  onReorder
}: ChannelTabsProps): React.ReactElement {
  const showSource = useStore((s) => s.showSource)
  const toggleSplit = useStore((s) => s.toggleSplit)
  const groups = useStore((s) => s.groups)

  const grip = useRef<string | null>(null)
  const bounds = useRef<{ min: number; max: number } | null>(null)
  const block = useRef<Block | null>(null)
  const shift = useRef(0)
  const resting = useRef<Map<string, Span> | null>(null)

  const [carry, setCarry] = useState<{ active: string; members: string[]; dx: number } | null>(null)
  const [settling, setSettling] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_THRESHOLD_PX } })
  )

  const ids = useMemo(() => sources.map((source) => source.id), [sources])
  const owner = useMemo(() => ownership(groups), [groups])
  const runs = useMemo(() => runsFor(ids, owner), [ids, owner])
  const marks = useMemo(() => marksFor(ids, owner), [ids, owner])

  const landInstantly = useCallback((): void => {
    setSettling(true)
    requestAnimationFrame(() => requestAnimationFrame(() => setSettling(false)))
  }, [])

  const settle = useCallback((): void => {
    const state = useStore.getState()
    const current = state.sources.map((source) => source.id)
    const ordered = contiguousOrder(current, state.groups)

    if (ordered.some((id, at) => id !== current[at])) onReorder(ordered)
  }, [onReorder])

  const split = useCallback(
    (sourceId: string): void => {
      toggleSplit(sourceId)
      settle()
    },
    [toggleSplit, settle]
  )

  const takeGrip = useCallback((sourceId: string): void => {
    grip.current = sourceId
  }, [])

  const items: TabsProps['items'] = useMemo(
    () =>
      sources.map((source) => ({
        key: source.id,
        label: (
          <TabLabel
            source={source}
            shown={visibleIds.includes(source.id)}
            onlyOne={visibleIds.length === 1}
            groupStart={marks.get(source.id)?.start ?? false}
            onGrip={takeGrip}
            onSplit={split}
          />
        )
      })),
    [sources, visibleIds, marks, takeGrip, split]
  )

  const edit: TabsProps['onEdit'] = (target, action) => {
    if (action === 'add') {
      onAdd()
      return
    }

    const doomed = sources.find((source) => source.id === target)
    if (doomed) onRemove(doomed)
  }

  const modifiers = useMemo(() => {
    const clampToStrip: Modifier = ({ transform }) => ({
      ...transform,
      x: clamp(transform.x, bounds.current)
    })

    return [restrictToHorizontalAxis, clampToStrip]
  }, [])

  const blockStrategy = useCallback<SortingStrategy>(
    (args) => {
      const own = horizontalListSortingStrategy(args)

      const run = runs[args.index]
      if (!run) return own
      if (args.activeIndex >= run.start && args.activeIndex <= run.end) return own

      for (let member = run.start; member <= run.end; member++) {
        const shifted = horizontalListSortingStrategy({ ...args, index: member })
        if (shifted && shifted.x !== 0) return shifted
      }

      return own
    },
    [runs]
  )

  const snapOutOfRun = (from: number, to: number, dx: number): number => {
    const run = runs[to]
    if (!run) return to
    if (from >= run.start && from <= run.end) return to

    const spans = resting.current
    const dragged = spans?.get(ids[from])
    const head = spans?.get(ids[run.start])
    const tail = spans?.get(ids[run.end])

    if (!dragged || !head || !tail) return from > to ? run.start : run.end

    const lands = (dragged.left + dragged.right) / 2 + dx < (head.left + tail.right) / 2
    if (lands === from < run.start) return from

    return lands ? run.start : run.end
  }

  const nudges = new Map<string, number>()

  if (carry && block.current) {
    const aside = carry.dx > 0 ? -block.current.width : block.current.width
    const passed = new Set(
      passedNeighbours(block.current, carry.dx).flatMap((unit) => unit.ids)
    )

    for (const unit of block.current.rest) {
      for (const id of unit.ids) nudges.set(id, passed.has(id) ? aside : 0)
    }
  }

  const dropWholeGroup = (members: string[]): void => {
    const placed = block.current
    if (!placed) return

    const dx = shift.current
    const behind = placed.rest.filter((unit) => unit.left < placed.left)

    const index = behind.length + passedNeighbours(placed, dx).length * (dx > 0 ? 1 : -1)
    const at = placed.rest
      .slice(0, index)
      .reduce((count, unit) => count + unit.ids.length, 0)

    const rest = placed.rest.flatMap((unit) => unit.ids)

    const next = [...rest.slice(0, at), ...members, ...rest.slice(at)]
    if (next.every((id, index) => id === ids[index])) return

    onReorder(contiguousOrder(next, groups))
  }

  const heldGroup = (): string[] | null => {
    const handle = grip.current

    return handle ? (owner.get(handle)?.members ?? null) : null
  }

  const release = (): void => {
    grip.current = null
    bounds.current = null
    setCarry(null)
    landInstantly()
  }

  const dragStart = ({ active }: DragStartEvent): void => {
    const dragged = String(active.id)
    const spans = measureTabs()
    const strip = spanOver(spans, spans.keys())

    const held = heldGroup()

    if (!held || !held.includes(dragged)) {
      const span = spans.get(dragged)
      const inside = owner.get(dragged)
      const limit = inside ? spanOver(spans, inside.members) : strip

      bounds.current = span && limit ? travelBounds(span, limit) : null
      resting.current = spans
      block.current = null

      return
    }

    const members = ids.filter((id) => held.includes(id))
    const span = spanOver(spans, members)

    bounds.current = span && strip ? travelBounds(span, strip) : null

    block.current = span
      ? {
          left: span.left,
          width: span.right - span.left + TAB_GUTTER_PX,
          rest: neighbourUnits(ids, spans, owner, held)
        }
      : null

    shift.current = 0
    setCarry({ active: dragged, members, dx: 0 })
  }

  const dragMove = ({ delta }: DragMoveEvent): void => {
    setCarry((held) => {
      if (!held) return held

      const dx = clamp(delta.x, bounds.current)
      shift.current = dx

      return dx === held.dx ? held : { ...held, dx }
    })
  }

  const dragEnd = ({ active, over, delta }: DragEndEvent): void => {
    const held = heldGroup()
    release()

    if (held) {
      dropWholeGroup(ids.filter((id) => held.includes(id)))
      block.current = null

      return
    }

    if (!over || active.id === over.id) return

    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from === -1 || to === -1) return

    const landing = snapOutOfRun(from, to, delta.x)
    if (landing === from) return

    onReorder(contiguousOrder(arrayMove(ids, from, landing), groups))
  }

  const renderTabBar: TabsProps['renderTabBar'] = (barProps, DefaultTabBar) => (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={modifiers}
      onDragStart={dragStart}
      onDragMove={dragMove}
      onDragEnd={dragEnd}
      onDragCancel={release}
    >
      <SortableContext items={ids} strategy={blockStrategy}>
        <DefaultTabBar {...barProps}>
          {(node: React.ReactElement) => {
            const props = node.props as { 'data-node-key': string }
            const key = props['data-node-key']

            return (
              <DraggableTab
                {...props}
                shown={visibleIds.includes(key)}
                carryX={
                  carry && key !== carry.active && carry.members.includes(key)
                    ? carry.dx
                    : undefined
                }
                nudgeX={nudges.get(key)}
                settling={settling}
                mark={marks.get(key)}
                key={key}
              >
                {node}
              </DraggableTab>
            )
          }}
        </DefaultTabBar>
      </SortableContext>
    </DndContext>
  )

  return (
    <div style={{ background: INK.app, borderBottom: `1px solid ${INK.line}`, paddingTop: 6 }}>
      <Tabs
        type="editable-card"
        size="small"
        activeKey={visibleIds[0]}
        onChange={showSource}
        onEdit={edit}
        items={items}
        addIcon={<Plus size={16} />}
        removeIcon={<X size={16} />}
        moreIcon={<Ellipsis size={16} />}
        renderTabBar={renderTabBar}
      />
    </div>
  )
}
