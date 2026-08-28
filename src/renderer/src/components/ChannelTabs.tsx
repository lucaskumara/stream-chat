import { cloneElement, useRef, useState } from 'react'
import { Badge, Flex, Tabs, Tooltip } from 'antd'
import { SplitCellsOutlined } from '@ant-design/icons'
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

function tabsExtent(): { left: number; right: number } | null {
  const tabs = [...document.querySelectorAll('.ant-tabs-tab')]
  if (tabs.length === 0) return null

  return {
    left: tabs[0].getBoundingClientRect().left,
    right: tabs[tabs.length - 1].getBoundingClientRect().right
  }
}

function blockExtent(members: string[]): { left: number; right: number } | null {
  const rects = members
    .map((id) => document.querySelector(`.ant-tabs-tab[data-node-key="${id}"]`))
    .filter((node): node is Element => node !== null)
    .map((node) => node.getBoundingClientRect())

  if (rects.length === 0) return null

  return {
    left: Math.min(...rects.map((rect) => rect.left)),
    right: Math.max(...rects.map((rect) => rect.right))
  }
}

function travelBounds(
  span: { left: number; right: number },
  limit: { left: number; right: number }
): { min: number; max: number } {
  return { min: limit.left - span.left, max: limit.right - span.right }
}

function contiguousOrder(ids: string[], groups: string[][]): string[] {
  const owner = new Map<string, string[]>()

  for (const group of groups) {
    for (const id of group) owner.set(id, group)
  }

  const placed = new Set<string>()
  const ordered: string[] = []

  for (const id of ids) {
    if (placed.has(id)) continue

    const group = owner.get(id)
    if (!group) {
      ordered.push(id)
      placed.add(id)
      continue
    }

    for (const member of ids.filter((candidate) => group.includes(candidate))) {
      ordered.push(member)
      placed.add(member)
    }
  }

  return ordered
}

function splitHint(shown: boolean, onlyOne: boolean): string {
  if (!shown) return 'Show this chat alongside the open one'
  if (onlyOne) return 'The only chat open — open another to split'

  return 'Close this column'
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

function TabLabel({
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

      <Tooltip title={splitHint(shown, onlyOne)} mouseEnterDelay={0.3}>
        <span
          role="button"
          className={['tab-split', shown ? 'tab-split-on' : '', inert ? 'tab-split-inert' : '']
            .filter(Boolean)
            .join(' ')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            if (!inert) onSplit(source.id)
          }}
        >
          <SplitCellsOutlined />
        </span>
      </Tooltip>
    </Flex>
  )
}

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
  const layout = useRef<{
    left: number
    width: number
    rest: { id: string; left: number; width: number }[]
  } | null>(null)
  const shift = useRef(0)
  const resting = useRef<Map<string, { left: number; right: number }> | null>(null)

  const clampToStrip: Modifier = ({ transform }) => {
    const held = bounds.current
    if (!held) return transform

    return { ...transform, x: Math.min(Math.max(transform.x, held.min), held.max) }
  }
  const [carry, setCarry] = useState<{ active: string; members: string[]; dx: number } | null>(null)
  const [settling, setSettling] = useState(false)

  const landInstantly = (): void => {
    setSettling(true)
    requestAnimationFrame(() => requestAnimationFrame(() => setSettling(false)))
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_THRESHOLD_PX } })
  )

  const ids = sources.map((source) => source.id)

  const marks = new Map<string, GroupMark>()

  sources.forEach((source, index) => {
    const owner = groups.findIndex((members) => members.includes(source.id))
    if (owner === -1) return

    const group = groups[owner]

    const joins = (other: SourceState | undefined): boolean =>
      other !== undefined && group.includes(other.id)

    const start = !joins(sources[index - 1])
    const classes = ['tab-group']
    if (start) classes.push('tab-group-start')
    if (!joins(sources[index + 1])) classes.push('tab-group-end')

    marks.set(source.id, {
      className: classes.join(' '),
      color: GROUP_COLORS[owner % GROUP_COLORS.length],
      start
    })
  })

  const settle = (): void => {
    const state = useStore.getState()
    const current = state.sources.map((source) => source.id)
    const ordered = contiguousOrder(current, state.groups)

    if (ordered.some((id, at) => id !== current[at])) onReorder(ordered)
  }

  const split = (sourceId: string): void => {
    toggleSplit(sourceId)
    settle()
  }

  const items: TabsProps['items'] = sources.map((source) => ({
    key: source.id,
    label: (
      <TabLabel
        source={source}
        shown={visibleIds.includes(source.id)}
        onlyOne={visibleIds.length === 1}
        groupStart={marks.get(source.id)?.start ?? false}
        onGrip={(sourceId) => {
          grip.current = sourceId
        }}
        onSplit={split}
      />
    )
  }))

  const edit: TabsProps['onEdit'] = (target, action) => {
    if (action === 'add') {
      onAdd()
      return
    }

    const doomed = sources.find((source) => source.id === target)
    if (doomed) onRemove(doomed)
  }

  const runAt = (index: number): { start: number; end: number } | null => {
    const group = groups.find((members) => members.includes(ids[index]))
    if (!group) return null

    const positions = group.map((id) => ids.indexOf(id)).filter((at) => at !== -1)

    return { start: Math.min(...positions), end: Math.max(...positions) }
  }

  // A group shifts aside as one block: if any member would move to make room for
  // a foreign tab, every member moves by the same amount. Shifting them
  // individually tears the group's band open around the hovering tab.
  const blockStrategy: SortingStrategy = (args) => {
    const own = horizontalListSortingStrategy(args)

    const run = runAt(args.index)
    if (!run) return own
    if (args.activeIndex >= run.start && args.activeIndex <= run.end) return own

    for (let member = run.start; member <= run.end; member++) {
      const shifted = horizontalListSortingStrategy({ ...args, index: member })
      if (shifted && shifted.x !== 0) return shifted
    }

    return own
  }

  const snapOutOfRun = (from: number, to: number, dx: number): number => {
    const run = runAt(to)
    if (!run) return to
    if (from >= run.start && from <= run.end) return to

    const rects = resting.current
    const dragged = rects?.get(ids[from])
    const head = rects?.get(ids[run.start])
    const tail = rects?.get(ids[run.end])

    if (!dragged || !head || !tail) return from > to ? run.start : run.end

    const lands = (dragged.left + dragged.right) / 2 + dx < (head.left + tail.right) / 2
    if (lands === from < run.start) return from

    return lands ? run.start : run.end
  }

  const soloBounds = (sourceId: string): { min: number; max: number } | null => {
    const span = blockExtent([sourceId])
    if (!span) return null

    const group = groups.find((members) => members.includes(sourceId))
    const limit = group ? blockExtent(ids.filter((id) => group.includes(id))) : tabsExtent()

    return limit ? travelBounds(span, limit) : null
  }

  const sweptPast = (tabs: { width: number }[], distance: number): number => {
    let travelled = 0
    let passed = 0

    for (const tab of tabs) {
      if (distance < travelled + tab.width / 2 + TAB_GUTTER_PX) break

      travelled += tab.width + TAB_GUTTER_PX
      passed++
    }

    return passed
  }

  const passedNeighbours = (dx: number): { id: string; width: number }[] => {
    const placed = layout.current
    if (!placed || dx === 0) return []

    const lane =
      dx > 0
        ? placed.rest.filter((tab) => tab.left > placed.left)
        : [...placed.rest.filter((tab) => tab.left < placed.left)].reverse()

    return lane.slice(0, sweptPast(lane, Math.abs(dx)))
  }

  const nudges = new Map<string, number>()

  if (carry && layout.current) {
    const aside = carry.dx > 0 ? -layout.current.width : layout.current.width

    for (const tab of passedNeighbours(carry.dx)) nudges.set(tab.id, aside)
  }

  const dropWholeGroup = (group: string[]): void => {
    const placed = layout.current
    if (!placed) return

    const dx = shift.current
    const behind = placed.rest.filter((tab) => tab.left < placed.left)

    const at = behind.length + passedNeighbours(dx).length * (dx > 0 ? 1 : -1)
    const rest = placed.rest.map((tab) => tab.id)
    const members = ids.filter((id) => group.includes(id))

    const next = [...rest.slice(0, at), ...members, ...rest.slice(at)]
    if (next.every((id, index) => id === ids[index])) return

    onReorder(contiguousOrder(next, groups))
  }

  const dragStart = ({ active }: DragStartEvent): void => {
    const dragged = String(active.id)
    const handle = grip.current
    const held = handle ? groups.find((members) => members.includes(handle)) : undefined

    if (!held || !held.includes(dragged)) {
      bounds.current = soloBounds(dragged)

      resting.current = new Map(
        ids.flatMap((id) => {
          const rect = blockExtent([id])

          return rect ? [[id, rect] as const] : []
        })
      )

      return
    }

    const members = ids.filter((id) => held.includes(id))

    const extent = tabsExtent()
    const block = blockExtent(members)

    bounds.current = extent && block ? travelBounds(block, extent) : null

    layout.current = block
      ? {
          left: block.left,
          width: block.right - block.left + TAB_GUTTER_PX,
          rest: ids
            .filter((id) => !held.includes(id))
            .map((id) => {
              const rect = document
                .querySelector(`.ant-tabs-tab[data-node-key="${id}"]`)
                ?.getBoundingClientRect()

              return { id, left: rect?.left ?? 0, width: rect?.width ?? 0 }
            })
        }
      : null

    shift.current = 0
    setCarry({ active: String(active.id), members, dx: 0 })
  }

  const dragMove = ({ delta }: DragMoveEvent): void => {
    setCarry((held) => {
      if (!held) return held

      const limit = bounds.current
      const dx = limit ? Math.min(Math.max(delta.x, limit.min), limit.max) : delta.x

      shift.current = dx

      return dx === held.dx ? held : { ...held, dx }
    })
  }

  const dragEnd = ({ active, over, delta }: DragEndEvent): void => {
    const handle = grip.current
    grip.current = null
    bounds.current = null
    setCarry(null)
    landInstantly()

    const held = handle ? groups.find((members) => members.includes(handle)) : undefined
    if (held) {
      dropWholeGroup(held)
      layout.current = null

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
      modifiers={[restrictToHorizontalAxis, clampToStrip]}
      onDragStart={dragStart}
      onDragMove={dragMove}
      onDragEnd={dragEnd}
      onDragCancel={() => {
        grip.current = null
        bounds.current = null
        setCarry(null)
        landInstantly()
      }}
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
    <div style={{ background: INK.chrome, borderBottom: `1px solid ${INK.line}`, paddingTop: 6 }}>
      <Tabs
        type="editable-card"
        size="small"
        activeKey={visibleIds[0]}
        onChange={showSource}
        onEdit={edit}
        items={items}
        renderTabBar={renderTabBar}
      />
    </div>
  )
}
