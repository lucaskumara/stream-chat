import { ControlRow, Picker, Segmented, Stepper, Toggle } from '../../components/controls'
import type { Density, NameColorMode, ThemeChoice } from '../../store'
import { CHAT_FONT_DEFAULT, useStore } from '../../store'
import { Group } from './Group'

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' }
]

const DENSITIES: { value: Density; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' }
]

const CAPACITIES = [
  { value: '200', label: '200 messages' },
  { value: '500', label: '500 messages' },
  { value: '1000', label: '1000 messages' }
]

const NAME_COLORS: { value: NameColorMode; label: string }[] = [
  { value: 'author', label: 'Normal colours' },
  { value: 'platform', label: 'Platform colour' },
  { value: 'none', label: 'No colour' }
]

export function Appearance(): React.ReactElement {
  const s = useStore()

  return (
    <div>
      <Group label="Application" first>
        <ControlRow label="Theme">
          <Segmented
            label="Theme"
            value={s.themeChoice}
            options={THEMES}
            onSelect={s.setThemeChoice}
          />
        </ControlRow>
      </Group>

      <Group label="Chat">
        <ControlRow label="Timestamps">
          <Toggle label="Timestamps" on={s.showTimestamps} onChange={s.setShowTimestamps} />
        </ControlRow>

        <ControlRow label="Deleted messages">
          <Toggle label="Deleted messages" on={s.showDeleted} onChange={s.setShowDeleted} />
        </ControlRow>

        <ControlRow label="Keep the last">
          <Picker
            label="Keep the last"
            value={String(s.capacity)}
            options={CAPACITIES}
            onSelect={(value) => s.setCapacity(Number(value))}
          />
        </ControlRow>

        <ControlRow label="Message density">
          <Picker
            label="Message density"
            value={s.density}
            options={DENSITIES}
            onSelect={s.setDensity}
          />
        </ControlRow>

        <ControlRow label="Split chat colours">
          <Picker
            label="Split chat colours"
            value={s.nameColorSplit}
            options={NAME_COLORS}
            onSelect={s.setNameColorSplit}
          />
        </ControlRow>

        <ControlRow label="Combined chat colours">
          <Picker
            label="Combined chat colours"
            value={s.nameColorMerged}
            options={NAME_COLORS}
            onSelect={s.setNameColorMerged}
          />
        </ControlRow>

        <ControlRow label="Chat text size">
          <div className="flex items-center gap-[8px]">
            {s.fontSize !== CHAT_FONT_DEFAULT && (
              <button
                type="button"
                className="ghost-button h-[24px] flex-none px-[10px] text-[12px]"
                onClick={s.resetFontSize}
              >
                Reset
              </button>
            )}

            <Stepper label="chat text" size={s.fontSize} onStep={s.stepFontSize} />
          </div>
        </ControlRow>
      </Group>
    </div>
  )
}
