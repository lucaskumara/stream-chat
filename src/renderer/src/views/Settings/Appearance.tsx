import { ControlRow, Segmented } from '../../components/controls'
import type { ThemeChoice } from '../../store'
import { useStore } from '../../store'
import { Group } from './Group'

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' }
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
    </div>
  )
}
