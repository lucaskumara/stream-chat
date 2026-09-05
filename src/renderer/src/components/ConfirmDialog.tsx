/** A small destructive-confirmation overlay — `fixed` rather than `absolute` so it can
    stack above the Settings modal it is normally opened from, dimming the whole window
    again the same way `SettingsModal` already does. The one control in the app that asks
    "are you sure" before a genuinely disruptive action, so it stays a dedicated primitive
    rather than a one-off inline in whichever screen needed it first. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel
}: {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}): React.ReactElement {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'var(--overlay)', zIndex: 10 }}
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="flex flex-col gap-[14px] px-[20px] py-[18px]"
        style={{
          width: 'min(360px, 90vw)',
          background: 'var(--ink-900)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          boxShadow: '0 24px 60px var(--shadow)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="m-0 text-[15px] font-semibold" style={{ color: 'var(--heading)' }}>
            {title}
          </h2>
          <p className="mt-[6px] mb-0 text-[13px]" style={{ color: 'var(--fg-3)' }}>
            {message}
          </p>
        </div>

        <div className="flex justify-end gap-[8px]">
          <button
            type="button"
            className="ghost-button h-[28px] px-[12px] text-[13px]"
            onClick={onCancel}
          >
            Cancel
          </button>

          <button
            type="button"
            className="primary-button h-[28px] px-[12px] text-[13px]"
            style={{ background: 'var(--error)' }}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
