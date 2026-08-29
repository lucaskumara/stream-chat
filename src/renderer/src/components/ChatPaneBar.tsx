import { memo, useCallback, useMemo } from 'react'
import { Button, Popconfirm, Select } from 'antd'
import { AArrowDown, AArrowUp, RotateCcw, Search, Trash2 } from 'lucide-react'
import { INK } from '../theme'
import { termLabel } from '../search'
import { CHAT_FONT_DEFAULT, CHAT_FONT_SIZES } from '../store'

export interface ChatPaneBarProps {
  terms: string[]
  draft: string
  total: number
  fontSize: number
  onTerms: (terms: string[]) => void
  onDraft: (draft: string) => void
  onFontStep: (steps: number) => void
  onFontReset: () => void
  onClear: () => void
}

function ChatPaneBarImpl({
  terms,
  draft,
  total,
  fontSize,
  onTerms,
  onDraft,
  onFontStep,
  onFontReset,
  onClear
}: ChatPaneBarProps): React.ReactElement {

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
        placeholder="Filter"
        className="chat-pane-search"
        style={{ flex: 1, minWidth: 0 }}
        onChange={handleChange}
        onSearch={onDraft}
        onKeyDown={handleKeyDown}
      />

      <Button
        type="text"
        className="chat-pane-bigger"
        icon={<AArrowUp size={16} />}
        disabled={fontSize >= CHAT_FONT_SIZES[CHAT_FONT_SIZES.length - 1]}
        onClick={() => onFontStep(1)}
        aria-label="Larger text in this chat"
        style={{ flex: 'none' }}
      />

      <Button
        type="text"
        className="chat-pane-smaller"
        icon={<AArrowDown size={16} />}
        disabled={fontSize <= CHAT_FONT_SIZES[0]}
        onClick={() => onFontStep(-1)}
        aria-label="Smaller text in this chat"
        style={{ flex: 'none' }}
      />

      <Button
        type="text"
        className="chat-pane-font-reset"
        icon={<RotateCcw size={16} />}
        disabled={fontSize === CHAT_FONT_DEFAULT}
        onClick={onFontReset}
        aria-label="Reset text size in this chat"
        style={{ flex: 'none' }}
      />

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
          aria-label="Clear this chat"
          style={{ flex: 'none' }}
        />
      </Popconfirm>
    </div>
  )
}

export const ChatPaneBar = memo(ChatPaneBarImpl)
