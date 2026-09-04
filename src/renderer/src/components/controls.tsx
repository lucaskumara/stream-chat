import { Minus, Plus, type LucideIcon } from 'lucide-react'
import { CHAT_FONT_SIZES } from '../store'

export function Toggle({
  label,
  on,
  onChange
}: {
  label: string
  on: boolean
  onChange: (on: boolean) => void
}): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="relative h-[18px] w-[30px] flex-none cursor-pointer border-0 p-0"
      style={{
        borderRadius: 999,
        background: on ? 'var(--toggle-on)' : 'var(--toggle-off)'
      }}
    >
      <span
        aria-hidden
        className="absolute h-[12px] w-[12px] rounded-full"
        style={{
          top: 3,
          left: on ? 15 : 3,
          background: 'var(--toggle-knob)',
          transition: 'left .18s'
        }}
      />
    </button>
  )
}

export function ControlRow({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex h-[28px] items-center justify-between gap-[20px]">
      <span className="truncate text-[14px]" style={{ color: 'var(--fg-2)' }}>
        {label}
      </span>
      {children}
    </div>
  )
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onSelect
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onSelect: (value: T) => void
}): React.ReactElement {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-none gap-[2px] rounded-[7px] p-[2px]"
      style={{ background: 'var(--ink-800)', border: '1px solid var(--line-2)' }}
    >
      {options.map((option) => {
        const on = option.value === value

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onSelect(option.value)}
            className="h-[24px] cursor-pointer rounded-[5px] border-0 px-[11px] text-[13px]"
            style={{
              background: on ? 'var(--segment-on)' : 'transparent',
              color: on ? 'var(--heading)' : 'var(--fg-3)'
            }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function Stepper({
  label,
  size,
  onStep
}: {
  label: string
  size: number
  onStep: (steps: number) => void
}): React.ReactElement {
  const first = CHAT_FONT_SIZES[0]
  const last = CHAT_FONT_SIZES[CHAT_FONT_SIZES.length - 1]

  return (
    <div
      className="flex flex-none items-center p-[2px]"
      style={{ background: 'var(--ink-800)', border: '1px solid var(--line-2)', borderRadius: 6 }}
    >
      <button
        type="button"
        aria-label={`Smaller ${label}`}
        disabled={size <= first}
        onClick={() => onStep(-1)}
        className="icon-button rounded-[4px]"
        style={{ width: 22, height: 20 }}
      >
        <Minus size={13} strokeWidth={1.8} />
      </button>

      <span
        className="w-[34px] text-center text-[13px] tabular-nums"
        style={{ color: 'var(--fg)' }}
      >
        {size}px
      </span>

      <button
        type="button"
        aria-label={`Larger ${label}`}
        disabled={size >= last}
        onClick={() => onStep(1)}
        className="icon-button rounded-[4px]"
        style={{ width: 22, height: 20 }}
      >
        <Plus size={13} strokeWidth={1.8} />
      </button>
    </div>
  )
}

export function Picker<T extends string>({
  label,
  value,
  options,
  onSelect
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onSelect: (value: T) => void
}): React.ReactElement {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onSelect(event.target.value as T)}
      className="h-[28px] w-[132px] flex-none cursor-pointer px-[9px] text-[13px]"
      style={{
        background: 'var(--ink-800)',
        border: '1px solid var(--line-2)',
        borderRadius: 6,
        color: 'var(--fg)'
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

/** The icon is the view's own tab glyph, so an empty Chat page shows the Chat icon and an
    empty Broadcast page the Broadcast one. The handoff drew an outlined square here; naming
    the view reads better than a placeholder shape. */
export function EmptyBlock({
  icon: Icon,
  size = 26,
  title,
  detail,
  children
}: {
  icon: LucideIcon
  size?: number
  title?: string
  detail?: string
  children?: React.ReactNode
}): React.ReactElement {
  return (
    <div
      className="flex flex-col items-center justify-center text-center"
      style={{ gap: title ? 14 : 10, color: 'var(--fg-4)' }}
    >
      <Icon size={size} strokeWidth={1.5} aria-hidden className="flex-none" style={{ color: 'var(--ghost-icon)' }} />

      {title && (
        <span className="text-[14px]" style={{ color: 'var(--fg)' }}>
          {title}
        </span>
      )}

      {detail && <span className="text-[13px]">{detail}</span>}

      {children}
    </div>
  )
}
