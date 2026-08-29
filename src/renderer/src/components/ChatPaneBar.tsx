import { memo, useCallback, useMemo } from 'react'
import { Button, Popconfirm, Select } from 'antd'
import { AArrowDown, AArrowUp, RotateCcw, Search, Trash2 } from 'lucide-react'
import { INK } from '../theme'
import { termLabel } from '../search'
import { CHAT_FONT_DEFAULT, CHAT_FONT_MAX, CHAT_FONT_MIN, CHAT_FONT_STEP } from '../store'

const SYNTAX_HINT =
  'Type a word to match message text, or author:name to match the sender. ' +
  'Separate with commas — every term has to match.'

export interface ChatPaneBarProps {
  terms: string[]
  draft: string
  total: number
  fontSize: number
  onTerms: (terms: string[]) => void
  onDraft: (draft: string) => void
  onFontStep: (delta: number) => void
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
        placeholder="Search"
        title={SYNTAX_HINT}
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
        disabled={fontSize >= CHAT_FONT_MAX}
        onClick={() => onFontStep(CHAT_FONT_STEP)}
        title="Larger text in this chat"
        aria-label="Larger text in this chat"
        style={{ flex: 'none' }}
      />

      <Button
        type="text"
        className="chat-pane-smaller"
        icon={<AArrowDown size={16} />}
        disabled={fontSize <= CHAT_FONT_MIN}
        onClick={() => onFontStep(-CHAT_FONT_STEP)}
        title="Smaller text in this chat"
        aria-label="Smaller text in this chat"
        style={{ flex: 'none' }}
      />

      <Button
        type="text"
        className="chat-pane-font-reset"
        icon={<RotateCcw size={16} />}
        disabled={fontSize === CHAT_FONT_DEFAULT}
        onClick={onFontReset}
        title="Reset text size in this chat"
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
          title={total === 0 ? 'Nothing to clear' : 'Clear this chat'}
          aria-label="Clear this chat"
          style={{ flex: 'none' }}
        />
      </Popconfirm>
    </div>
  )
}

export const ChatPaneBar = memo(ChatPaneBarImpl)
