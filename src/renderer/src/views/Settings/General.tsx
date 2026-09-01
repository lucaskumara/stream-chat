import { ControlRow, Toggle } from '../../components/controls'
import { useStore } from '../../store'
import { Group } from './Group'

export function General(): React.ReactElement {
  const s = useStore()

  return (
    <div>
      <Group label="Startup" first>
        <ControlRow label="Reopen the channels I had open">
          <Toggle
            label="Reopen the channels I had open"
            on={s.reopenChannels}
            onChange={s.setReopenChannels}
          />
        </ControlRow>
      </Group>
    </div>
  )
}
