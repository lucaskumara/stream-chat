import type { PlatformDraftsApi } from './usePlatformDrafts'

/** A layout sibling of the scrollable card list, not an overlay pinned inside it —
    spanning the full content column so it reads as a docked toolbar rather than a
    box floating over whatever's scrolled behind it. Padded to match the scroll
    area's own side padding so the button still lines up with everything above it. */
export function PlatformsSaveBar({ dirty, saving, savedFlash, save }: PlatformDraftsApi): React.ReactElement {
  return (
    <div
      className="flex flex-none items-center justify-end gap-[12px] px-[28px] py-[14px]"
      style={{ background: 'var(--ink-900)', borderTop: '1px solid var(--line)' }}
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
