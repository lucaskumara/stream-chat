import { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { bridge } from '../../bridge'
import { ControlRow } from '../../components/controls'
import { Group } from './Group'

export function General(): React.ReactElement {
  return (
    <div>
      <Group label="Diagnostics" first>
        <ControlRow label="Open the log folder">
          <OpenLogs />
        </ControlRow>

        <p className="mt-[8px] mb-0 text-[12px]" style={{ color: 'var(--fg-4)' }}>
          Connection and relay activity is written to a file, so a problem can be read back
          after the fact. Stream keys are masked before anything is written.
        </p>
      </Group>
    </div>
  )
}

function OpenLogs(): React.ReactElement {
  const [failed, setFailed] = useState(false)

  return (
    <button
      type="button"
      className="ghost-button flex h-[26px] flex-none items-center gap-[6px] px-[10px] text-[12px]"
      onClick={() => {
        void bridge()
          .api.openLogs()
          .then((opened) => setFailed(!opened))
          .catch(() => setFailed(true))
      }}
    >
      <FolderOpen size={12} strokeWidth={1.8} />
      {failed ? 'No log file' : 'Open'}
    </button>
  )
}
