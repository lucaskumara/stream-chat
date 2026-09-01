import { memo, useCallback } from 'react'
import { Search, Settings, X } from 'lucide-react'
import type { SourceState } from '@shared/types'
import { PLATFORM_COLOR } from '../theme'
import { termLabel } from '../search'

const PLATFORM_NAME: Record<SourceState['platform'], string> = {
  twitch: 'Twitch',
  youtube: 'YouTube',
  kick: 'Kick'
}

export interface ChatPaneBarProps {
  source: SourceState
  filterOpen: boolean
  gearOpen: boolean
  terms: string[]
  draft: string
  matches: number
  total: number
  onToggleFilter: () => void
  onToggleGear: () => void
  onTerms: (terms: string[]) => void
  onDraft: (draft: string) => void
}

function ChatPaneBarImpl({
  source,
  filterOpen,
  gearOpen,
  terms,
  draft,
  matches,
  total,
  onToggleFilter,
  onToggleGear,
  onTerms,
  onDraft
}: ChatPaneBarProps): React.ReactElement {
  const offline = source.status === 'offline' || source.status === 'error'

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
        <span
          aria-hidden
          className="h-[6px] w-[6px] flex-none rounded-full"
          style={{ background: offline ? 'var(--offline-dot)' : PLATFORM_COLOR[source.platform] }}
        />

        <span className="truncate text-[14px] font-semibold" style={{ color: '#f0f0f0' }}>
          {source.label}
        </span>

        <span className="flex-none text-[14px]" style={{ color: 'var(--fg-4)' }}>
          {PLATFORM_NAME[source.platform]}
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
          aria-label={`Filter ${source.label}`}
          onClick={onToggleFilter}
        >
          <Search size={15} strokeWidth={1.8} />
        </button>

        <button
          type="button"
          className="icon-button chat-pane-settings"
          data-on={gearOpen}
          aria-label={`Settings for ${source.label}`}
          onClick={onToggleGear}
        >
          <Settings size={15} strokeWidth={1.8} />
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
                style={{ background: '#2f2f2f', borderRadius: 999, color: 'var(--fg)' }}
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
