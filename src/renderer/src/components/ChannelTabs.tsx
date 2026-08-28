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
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { SourceState, SourceStatus } from '@shared/types'
import { useStore } from '../store'
import { INK } from '../theme'
import { PlatformIcon } from './PlatformIcon'

const DRAG_THRESHOLD_PX = 5

const TAB_GUTTER_PX = 2

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
  mark,
  children,
  ...props
}: DraggableTabProps): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props['data-node-key']
  })

  const carried = carryX !== undefined

  const style = {
    ...props.style,
    transform: carried ? `translate3d(${carryX}px, 0, 0)` : CSS.Translate.toString(transform),
    transition: isDragging || carried ? 'none' : transition,
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
    rest: { id: string; left: number; width: number }[]
  } | null>(null)
  const shift = useRef(0)

  const clampToStrip: Modifier = ({ transform, draggingNodeRect }) => {
    const held = bounds.current
    if (held) return { ...transform, x: Math.min(Math.max(transform.x, held.min), held.max) }

    const extent = tabsExtent()
    if (!draggingNodeRect || !extent) return transform

    const min = extent.left - draggingNodeRect.left
    const max = extent.right - draggingNodeRect.right

    return { ...transform, x: Math.min(Math.max(transform.x, min), max) }
  }
  const [carry, setCarry] = useState<{ active: string; members: string[]; dx: number } | null>(null)

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

  const dropWholeGroup = (group: string[]): void => {
    const placed = layout.current
    if (!placed) return

    const dx = shift.current
    const ahead = placed.rest.filter((tab) => tab.left > placed.left)
    const behind = placed.rest.filter((tab) => tab.left < placed.left)

    const moved =
      dx > 0 ? sweptPast(ahead, dx) : dx < 0 ? -sweptPast([...behind].reverse(), -dx) : 0

    const at = behind.length + moved
    const rest = placed.rest.map((tab) => tab.id)
    const members = ids.filter((id) => group.includes(id))

    const next = [...rest.slice(0, at), ...members, ...rest.slice(at)]
    if (next.every((id, index) => id === ids[index])) return

    onReorder(contiguousOrder(next, groups))
  }

  const dragStart = ({ active }: DragStartEvent): void => {
    const handle = grip.current
    const held = handle ? groups.find((members) => members.includes(handle)) : undefined
    if (!held || !held.includes(String(active.id))) return

    const members = ids.filter((id) => held.includes(id))

    const extent = tabsExtent()
    const block = blockExtent(members)

    bounds.current =
      extent && block
        ? { min: extent.left - block.left, max: extent.right - block.right }
        : null

    layout.current = block
      ? {
          left: block.left,
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

  const dragEnd = ({ active, over }: DragEndEvent): void => {
    const handle = grip.current
    grip.current = null
    bounds.current = null
    setCarry(null)

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

    onReorder(contiguousOrder(arrayMove(ids, from, to), groups))
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
      }}
    >
      <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
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
