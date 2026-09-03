import { ControlRow, Picker, Segmented, Stepper, Toggle } from '../../components/controls'
import type { Density, ThemeChoice } from '../../store'
import { useStore } from '../../store'
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

export function Appearance(): React.ReactElement {
  const s = useStore()

  return (
    <div>
      <Group label="Theme" first>
        <ControlRow label="Appearance">
          <Segmented
            label="Appearance"
            value={s.themeChoice}
            options={THEMES}
            onSelect={s.setThemeChoice}
          />
        </ControlRow>
      </Group>

      <Group label="Messages">
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
      </Group>

      <Group label="Rows">
        <ControlRow label="Message density">
          <Picker
            label="Message density"
            value={s.density}
            options={DENSITIES}
            onSelect={s.setDensity}
          />
        </ControlRow>

        <ControlRow label="Colour usernames by platform">
          <Toggle
            label="Colour usernames by platform"
            on={s.colorByPlatform}
            onChange={s.setColorByPlatform}
          />
        </ControlRow>
      </Group>

      <Group label="Text size">
        <ControlRow label="Chat text">
          <Stepper label="chat text" size={s.fontSize} onStep={s.stepFontSize} />
        </ControlRow>
      </Group>
    </div>
  )
}
