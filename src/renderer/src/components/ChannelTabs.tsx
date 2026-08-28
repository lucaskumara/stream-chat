import { cloneElement } from 'react'
import { Badge, Flex, Tabs, Tooltip } from 'antd'
import { SplitCellsOutlined } from '@ant-design/icons'
import type { BadgeProps, TabsProps } from 'antd'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers'
import type { Modifier } from '@dnd-kit/core'
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
import { PLATFORM_COLOR } from './MessageRow'

const DRAG_THRESHOLD_PX = 5

const clampToTabStrip: Modifier = ({ transform, draggingNodeRect }) => {
  const strip = document.querySelector('.ant-tabs-nav-list')?.getBoundingClientRect()
  if (!draggingNodeRect || !strip) return transform

  const min = strip.left - draggingNodeRect.left
  const max = strip.right - draggingNodeRect.right

  return { ...transform, x: Math.min(Math.max(transform.x, min), max) }
}

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
}

function splitHint(shown: boolean, onlyOne: boolean): string {
  if (!shown) return 'Show this chat alongside the open one'
  if (onlyOne) return 'The only chat open — open another to split'

  return 'Close this column'
}

function DraggableTab({ shown, children, ...props }: DraggableTabProps): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props['data-node-key']
  })

  const style: React.CSSProperties = {
    ...props.style,
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? 'none' : transition,
    zIndex: isDragging ? 2 : undefined,
    cursor: isDragging ? 'grabbing' : 'pointer'
  }

  return cloneElement(children as TabNode, {
    ref: setNodeRef,
    style,
    className: [props.className, shown ? 'tab-shown' : ''].filter(Boolean).join(' '),
    ...attributes,
    ...listeners
  })
}

function TabLabel({
  source,
  shown,
  onlyOne,
  onSplit
}: {
  source: SourceState
  shown: boolean
  onlyOne: boolean
  onSplit: (sourceId: string) => void
}): React.ReactElement {
  const inert = shown && onlyOne

  return (
    <Flex align="center" gap={7}>
      <Badge color={PLATFORM_COLOR[source.platform]} />

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_THRESHOLD_PX } })
  )

  const ids = sources.map((source) => source.id)

  const items: TabsProps['items'] = sources.map((source) => ({
    key: source.id,
    label: (
      <TabLabel
        source={source}
        shown={visibleIds.includes(source.id)}
        onlyOne={visibleIds.length === 1}
        onSplit={toggleSplit}
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

  const dragEnd = ({ active, over }: DragEndEvent): void => {
    if (!over || active.id === over.id) return

    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from === -1 || to === -1) return

    onReorder(arrayMove(ids, from, to))
  }

  const renderTabBar: TabsProps['renderTabBar'] = (barProps, DefaultTabBar) => (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToHorizontalAxis, clampToTabStrip]}
      onDragEnd={dragEnd}
    >
      <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
        <DefaultTabBar {...barProps}>
          {(node: React.ReactElement) => {
            const props = node.props as { 'data-node-key': string }
            const key = props['data-node-key']

            return (
              <DraggableTab {...props} shown={visibleIds.includes(key)} key={key}>
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
