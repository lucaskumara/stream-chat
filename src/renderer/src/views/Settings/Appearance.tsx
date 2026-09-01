import { ControlRow, Picker, Segmented, Stepper, Toggle } from '../../components/controls'
import type { Density, ThemeChoice } from '../../store'
import { useStore } from '../../store'
import { Group } from './Group'

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'midnight', label: 'Midnight' },
  { value: 'system', label: 'System' }
]

const DENSITIES: { value: Density; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' }
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
        <ControlRow label="Default for new chats">
          <Stepper
            label="default chat text"
            size={s.defaultFontSize}
            onStep={s.stepDefaultFontSize}
          />
        </ControlRow>
      </Group>
    </div>
  )
}
