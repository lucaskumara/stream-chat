import { ControlRow, Picker, Stepper, Toggle } from '../../components/controls'
import type { Density } from '../../store'
import { useStore } from '../../store'
import { Group } from './Group'

const DENSITIES: { value: Density; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' }
]

const CAPACITIES = [
  { value: '200', label: '200 messages' },
  { value: '500', label: '500 messages' },
  { value: '1000', label: '1000 messages' }
]

export function Chat(): React.ReactElement {
  const s = useStore()

  return (
    <div>
      <Group label="Messages" first>
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
