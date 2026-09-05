import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import type { BroadcastState, UpdateState } from '@shared/types'
import { bridge } from '../../bridge'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ControlRow } from '../../components/controls'
import { useStore } from '../../store'
import { Group } from './Group'

export function General(): React.ReactElement {
  return (
    <div>
      <Group label="Updates" first>
        <Updates />
      </Group>

      <Group label="Diagnostics">
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

function ActionButton({
  onClick,
  disabled,
  children
}: {
  onClick?: () => void
  disabled?: boolean
  children: React.ReactNode
}): React.ReactElement {
  return (
    <button
      type="button"
      className="ghost-button flex h-[26px] flex-none items-center px-[10px] text-[12px]"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** Installing closes the app to relaunch it, which ends every RTMP connection the relay
    is holding open — so this is the one place in Settings that needs to know whether the
    user is actually broadcasting right now. Fetched locally rather than promoted into the
    global store, the same way Broadcast.tsx is the only other place that needs it. */
function Updates(): React.ReactElement {
  const updateState = useStore((s) => s.updateState)
  const [broadcast, setBroadcast] = useState<BroadcastState | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    const { api } = bridge()

    void api.broadcast().then(setBroadcast)

    return api.onBroadcast(setBroadcast)
  }, [])

  const isBroadcasting = broadcast?.destinations.some((d) => d.state === 'sending') ?? false

  const install = (): void => {
    if (isBroadcasting) setConfirming(true)
    else void bridge().api.installUpdate()
  }

  return (
    <>
      <ControlRow label="Version">
        <span className="text-[13px]" style={{ color: 'var(--fg-3)' }}>
          {updateState.currentVersion}
        </span>
      </ControlRow>

      <ControlRow label="Updates">
        <UpdateControl state={updateState} onInstall={install} />
      </ControlRow>

      {updateState.status === 'error' && updateState.error && (
        <p className="mt-0 mb-0 text-[12px]" style={{ color: 'var(--error)' }}>
          {updateState.error}
        </p>
      )}

      {confirming && (
        <ConfirmDialog
          title="You're currently broadcasting"
          message="Installing this update closes the app to restart it, which will end your stream on every platform you're forwarding to. Install and restart anyway?"
          confirmLabel="Install & Restart"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            void bridge().api.installUpdate()
          }}
        />
      )}
    </>
  )
}

function checkForUpdates(): void {
  void bridge().api.checkForUpdates()
}

function UpdateControl({
  state,
  onInstall
}: {
  state: UpdateState
  onInstall: () => void
}): React.ReactElement {
  switch (state.status) {
    case 'unsupported':
      return (
        <span className="text-[12px]" style={{ color: 'var(--fg-4)' }}>
          Not available in this build
        </span>
      )

    case 'checking':
      return <ActionButton disabled>Checking…</ActionButton>

    case 'available':
      return <ActionButton disabled>Update found — downloading…</ActionButton>

    case 'downloading':
      return <ActionButton disabled>{`Downloading… ${state.progressPercent ?? 0}%`}</ActionButton>

    case 'downloaded':
      return <ActionButton onClick={onInstall}>Install & Relaunch</ActionButton>

    case 'not-available':
      return (
        <span className="flex items-center gap-[10px]">
          <span className="text-[12px]" style={{ color: 'var(--fg-4)' }}>
            You're up to date
          </span>
          <ActionButton onClick={checkForUpdates}>Check for Updates</ActionButton>
        </span>
      )

    case 'error':
      return <ActionButton onClick={checkForUpdates}>Try Again</ActionButton>

    default:
      return <ActionButton onClick={checkForUpdates}>Check for Updates</ActionButton>
  }
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
