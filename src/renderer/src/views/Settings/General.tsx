import { ControlRow, Picker, Toggle } from '../../components/controls'
import { useStore } from '../../store'
import { Group } from './Group'

const CAPACITIES = [
  { value: '200', label: '200 messages' },
  { value: '500', label: '500 messages' },
  { value: '1000', label: '1000 messages' }
]

export function General(): React.ReactElement {
  const s = useStore()

  return (
    <div>
      <Group label="Startup" first>
        <ControlRow label="Launch when the computer starts">
          <Toggle
            label="Launch when the computer starts"
            on={s.launchAtStartup}
            onChange={(on) => s.setFlag('launchAtStartup', on)}
          />
        </ControlRow>

        <ControlRow label="Reopen the channels I had open">
          <Toggle
            label="Reopen the channels I had open"
            on={s.reopenChannels}
            onChange={(on) => s.setFlag('reopenChannels', on)}
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

      <Group label="Window">
        <ControlRow label="Keep on top of other windows">
          <Toggle
            label="Keep on top of other windows"
            on={s.keepOnTop}
            onChange={(on) => s.setFlag('keepOnTop', on)}
          />
        </ControlRow>

        <ControlRow label="Close to the tray instead of quitting">
          <Toggle
            label="Close to the tray instead of quitting"
            on={s.closeToTray}
            onChange={(on) => s.setFlag('closeToTray', on)}
          />
        </ControlRow>
      </Group>
    </div>
  )
}
