import { Radio } from 'lucide-react'
import { EmptyBlock } from '../components/controls'

export function Broadcast(): React.ReactElement {
  return (
    <div
      className="flex flex-1 items-center justify-center"
      style={{ background: 'var(--ink-900)' }}
    >
      <EmptyBlock
        icon={Radio}
        size={34}
        title="Broadcast"
        detail="Go live to every platform at once from one window."
      />
    </div>
  )
}
