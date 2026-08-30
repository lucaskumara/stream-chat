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
import {
  TAB_GUTTER_PX,
  clamp,
  contiguousOrder,
  marksFor,
  measureTabs,
  neighbourUnits,
  ownership,
  passedNeighbours,
  runsFor,
  spanOver,
  travelBounds,
  type Block,
  type GroupMark,
  type Span
} from './tab-strip'

const DRAG_THRESHOLD_PX = 5

const NUDGE = 'transform 200ms cubic-bezier(0.2, 0, 0, 1)'

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

interface DraggableTabProps extends React.HTMLAttributes<HTMLDivElement> {
  'data-node-key': string
  shown: boolean
  carryX?: number
  nudgeX?: number
  settling: boolean
  mark?: GroupMark
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

      <span
        role="button"
        className={['tab-split', shown ? 'tab-split-on' : ''].filter(Boolean).join(' ')}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          if (!inert) onSplit(source.id)
        }}
      >
        <Pin size={16} fill={shown ? 'currentColor' : 'none'} />
      </span>
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
