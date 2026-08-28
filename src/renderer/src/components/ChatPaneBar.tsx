import { memo, useCallback } from 'react'
import { Button, Input, Popconfirm, Typography } from 'antd'
import { ClearOutlined, SearchOutlined } from '@ant-design/icons'
import { INK } from '../theme'

export interface ChatPaneBarProps {
  search: string
  matches: number
  total: number
  onSearch: (needle: string) => void
  onClear: () => void
}

function ChatPaneBarImpl({
  search,
  matches,
  total,
  onSearch,
  onClear
}: ChatPaneBarProps): React.ReactElement {
  const filtering = search.trim() !== ''

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') onSearch('')
    },
    [onSearch]
  )

  return (
    <div
      className="flex items-center gap-2 px-2 py-1"
      style={{ borderTop: `1px solid ${INK.line}`, background: INK.app, flex: 'none' }}
    >
      <Input
        size="small"
        allowClear
        value={search}
        spellCheck={false}
        prefix={<SearchOutlined style={{ opacity: 0.45 }} />}
        placeholder="search this chat"
        onChange={(e) => onSearch(e.target.value)}
        onKeyDown={handleKeyDown}
      />

      <Typography.Text
        type="secondary"
        className="chat-pane-count"
        style={{ fontSize: 11, whiteSpace: 'nowrap', flex: 'none' }}
      >
        {filtering ? `${matches} of ${total}` : `${total}`}
      </Typography.Text>

      <Popconfirm
        title="Are you sure?"
        placement="topRight"
        okText="Clear"
        cancelText="Cancel"
        okButtonProps={{ danger: true }}
        onConfirm={onClear}
        disabled={total === 0}
      >
        <Button
          size="small"
          type="text"
          className="chat-pane-clear"
          icon={<ClearOutlined />}
          disabled={total === 0}
          title={total === 0 ? 'Nothing to clear' : 'Clear this chat'}
          aria-label="Clear this chat"
          style={{ flex: 'none' }}
        />
      </Popconfirm>
    </div>
  )
}

export const ChatPaneBar = memo(ChatPaneBarImpl)
