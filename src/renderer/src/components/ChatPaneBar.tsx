import { memo, useCallback, useMemo } from 'react'
import { Button, Popconfirm, Select, Typography } from 'antd'
import { Search, Trash2 } from 'lucide-react'
import { INK } from '../theme'
import { termLabel } from '../search'

const SYNTAX_HINT =
  'Type a word to match message text, or author:name to match the sender. ' +
  'Separate with commas — every term has to match.'

export interface ChatPaneBarProps {
  terms: string[]
  draft: string
  matches: number
  total: number
  onTerms: (terms: string[]) => void
  onDraft: (draft: string) => void
  onClear: () => void
}

function ChatPaneBarImpl({
  terms,
  draft,
  matches,
  total,
  onTerms,
  onDraft,
  onClear
}: ChatPaneBarProps): React.ReactElement {
  const filtering = terms.length > 0 || draft.trim() !== ''

  const options = useMemo(
    () => terms.map((term) => ({ value: term, label: termLabel(term) })),
    [terms]
  )

  // Enter commits a tag through onChange but never fires onSearch, so a controlled
  // searchValue would keep the text that just became a pill — and keep filtering by it.
  const handleChange = useCallback(
    (next: string[]) => {
      onTerms(next)
      onDraft('')
    },
    [onTerms, onDraft]
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Escape') return

      if (draft !== '') onDraft('')
      else if (terms.length > 0) onTerms([])
    },
    [draft, terms, onDraft, onTerms]
  )

  return (
    <div
      className="flex items-center gap-2 p-2"
      style={{ background: INK.app, flex: 'none' }}
    >
      <Select
        mode="tags"
        open={false}
        allowClear
        value={terms}
        options={options}
        searchValue={draft}
        tokenSeparators={[',']}
        suffixIcon={<Search size={16} style={{ opacity: 0.45 }} />}
        placeholder="Search"
        title={SYNTAX_HINT}
        className="chat-pane-search"
        style={{ flex: 1, minWidth: 0 }}
        onChange={handleChange}
        onSearch={onDraft}
        onKeyDown={handleKeyDown}
      />

      <Typography.Text
        type="secondary"
        className="chat-pane-count"
        style={{ fontSize: '1rem', whiteSpace: 'nowrap', flex: 'none' }}
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
        styles={{ root: { minWidth: 200 } }}
      >
        <Button
          type="text"
          className="chat-pane-clear"
          icon={<Trash2 size={16} />}
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
