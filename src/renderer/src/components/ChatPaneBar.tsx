import { memo, useCallback } from 'react'
import { Search, X } from 'lucide-react'
import { termLabel } from '../search'

export interface ChatPaneBarProps {
  label: string
  offline: boolean
  filterOpen: boolean
  terms: string[]
  draft: string
  matches: number
  total: number
  onToggleFilter: () => void
  onTerms: (terms: string[]) => void
  onDraft: (draft: string) => void
}

function ChatPaneBarImpl({
  label,
  offline,
  filterOpen,
  terms,
  draft,
  matches,
  total,
  onToggleFilter,
  onTerms,
  onDraft
}: ChatPaneBarProps): React.ReactElement {
  const commit = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        if (draft !== '') onDraft('')
        else if (terms.length > 0) onTerms([])
        return
      }

      if (event.key === 'Backspace' && draft === '' && terms.length > 0) {
        onTerms(terms.slice(0, -1))
        return
      }

      if (event.key !== 'Enter' && event.key !== ',') return

      event.preventDefault()
      const value = draft.trim()
      if (value === '') return

      onTerms([...terms, value])
      onDraft('')
    },
    [draft, terms, onDraft, onTerms]
  )

  return (
    <div className="flex-none">
      <div
        className="flex h-[44px] items-center gap-[10px] pr-[8px] pl-[12px]"
        style={{ borderBottom: '1px solid var(--line)' }}
      >
        <span className="truncate text-[14px] font-semibold" style={{ color: 'var(--heading)' }}>
          {label}
        </span>

        {offline && (
          <span
            className="flex h-[18px] flex-none items-center px-[7px] text-[12px]"
            style={{
              border: '1px solid var(--line-2)',
              borderRadius: 999,
              color: 'var(--fg-3)'
            }}
          >
            offline
          </span>
        )}

        <div className="flex-1" />

        <button
          type="button"
          className="icon-button chat-pane-filter"
          data-on={filterOpen}
          aria-label={`Filter ${label}`}
          onClick={onToggleFilter}
        >
          <Search size={15} strokeWidth={1.8} />
        </button>
      </div>

      {filterOpen && (
        <div className="px-[12px] py-[8px]" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="inset-field h-[30px]">
            <Search size={14} strokeWidth={1.8} style={{ flexShrink: 0, color: 'var(--fg-3)' }} />

            {terms.map((term) => (
              <span
                key={term}
                className="flex h-[20px] flex-none items-center gap-[5px] pr-[5px] pl-[8px] text-[13px]"
                style={{ background: 'var(--pill)', borderRadius: 999, color: 'var(--fg)' }}
              >
                {termLabel(term)}
                <button
                  type="button"
                  aria-label={`Remove ${termLabel(term)}`}
                  onClick={() => onTerms(terms.filter((held) => held !== term))}
                  className="flex cursor-pointer items-center border-0 bg-transparent p-0"
                  style={{ color: 'var(--fg-3)' }}
                >
                  <X size={11} strokeWidth={2} />
                </button>
              </span>
            ))}

            <input
              value={draft}
              spellCheck={false}
              placeholder={terms.length === 0 ? 'Filter messages' : ''}
              onChange={(event) => onDraft(event.target.value)}
              onKeyDown={commit}
              className="min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none"
              style={{ color: 'var(--fg)' }}
            />

            {(terms.length > 0 || draft !== '') && (
              <span className="flex-none text-[13px] tabular-nums" style={{ color: 'var(--fg-4)' }}>
                {matches} of {total}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export const ChatPaneBar = memo(ChatPaneBarImpl)
