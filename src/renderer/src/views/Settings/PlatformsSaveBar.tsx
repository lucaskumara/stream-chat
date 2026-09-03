import type { PlatformDraftsApi } from './usePlatformDrafts'

/** Ordinary flowing content at the end of the card list, not pinned — a fixed
    footer reserved height on every pane even when there was nothing to save,
    which read as wasted space more than it read as a toolbar. The nav dot (see
    Settings/index.tsx) is what reminds a scrolled-away user there's something
    to save; this is just where the action itself lives. */
export function PlatformsSaveBar({ dirty, saving, savedFlash, save }: PlatformDraftsApi): React.ReactElement {
  return (
    <div
      className="mt-[20px] flex items-center justify-end gap-[12px] pt-[14px]"
      style={{ borderTop: '1px solid var(--line)' }}
    >
      <span className="text-[12px]" style={{ color: 'var(--fg-4)', opacity: savedFlash ? 1 : 0 }}>
        All changes saved
      </span>

      <button
        type="button"
        className="primary-button h-[30px] px-[16px] text-[13px]"
        disabled={!dirty || saving}
        onClick={() => void save()}
      >
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  )
}
