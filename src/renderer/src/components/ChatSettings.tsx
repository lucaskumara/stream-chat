import { Divider, Flex, Switch, Typography } from 'antd'
import { useStore } from '../store'
import { ChatLink } from './ChatLink'

function DisplayToggle({
  label,
  className,
  on,
  onChange
}: {
  label: string
  className: string
  on: boolean
  onChange: (on: boolean) => void
}): React.ReactElement {
  return (
    <Flex align="center" justify="space-between" gap={16}>
      <Typography.Text>{label}</Typography.Text>

      <Switch size="small" className={className} checked={on} onChange={onChange} />
    </Flex>
  )
}

export function ChatSettings({ sourceId }: { sourceId: string }): React.ReactElement {
  const showTimestamps = useStore((s) => s.showTimestamps)
  const showDeleted = useStore((s) => s.showDeleted)
  const setShowTimestamps = useStore((s) => s.setShowTimestamps)
  const setShowDeleted = useStore((s) => s.setShowDeleted)

  return (
    <div style={{ width: 380 }}>
      <Typography.Text type="secondary">Every chat</Typography.Text>

      <Flex vertical gap={8} style={{ marginTop: 8 }}>
        <DisplayToggle
          label="Timestamps"
          className="chat-settings-timestamps"
          on={showTimestamps}
          onChange={setShowTimestamps}
        />

        <DisplayToggle
          label="Deleted messages"
          className="chat-settings-deleted"
          on={showDeleted}
          onChange={setShowDeleted}
        />
      </Flex>

      <Divider style={{ margin: '12px 0' }} />

      <ChatLink sourceId={sourceId} />
    </div>
  )
}
