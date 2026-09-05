import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '@shared/types'
import { log } from './log'

/** Not too chatty, not too stale — a long-running stream session should still see an
    update land within a normal day without polling GitHub every few minutes. */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

const updaterLog = log('updater')

let state: UpdateState = { status: 'idle', currentVersion: '' }
let onState: (state: UpdateState) => void = () => {}
let isBroadcasting: () => boolean = () => false

/** Whether electron-updater actually has somewhere to check — false in dev and in the
    portable build, neither of which carries the `app-update.yml` electron-builder only
    writes into the NSIS output. Every other export becomes a no-op once this is false. */
let active = false

/** Set only by `checkOnLaunch`, and only good for the very next `update-downloaded` — a
    manual or periodic check in between (`checkNow`) clears it, so a user who explicitly
    asked "is there an update?" is never surprised by the app restarting under them. */
let installEligible = false

let interval: NodeJS.Timeout | null = null

function setState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  onState(state)
}

/** Registers the electron-updater listeners once. Safe to call exactly once per app
    launch — `main/index.ts` does so during `app.whenReady()`. */
export function initUpdater(
  onUpdateState: (state: UpdateState) => void,
  broadcasting: () => boolean
): void {
  onState = onUpdateState
  isBroadcasting = broadcasting
  state = { status: 'idle', currentVersion: app.getVersion() }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.logger = updaterLog

  active = autoUpdater.isUpdaterActive()

  if (!active) {
    setState({ status: 'unsupported' })
    return
  }

  autoUpdater.on('checking-for-update', () => setState({ status: 'checking' }))

  autoUpdater.on('update-available', (info) =>
    setState({ status: 'available', latestVersion: info.version })
  )

  autoUpdater.on('update-not-available', () => setState({ status: 'not-available' }))

  autoUpdater.on('download-progress', (progress) =>
    setState({ status: 'downloading', progressPercent: Math.round(progress.percent) })
  )

  /** The one place an automatic restart can happen — everywhere else `downloaded` is
      where the state machine stops, and Settings offers "Install & Relaunch" instead. */
  autoUpdater.on('update-downloaded', (info) => {
    setState({ status: 'downloaded', latestVersion: info.version })

    const shouldAutoInstall = installEligible && !isBroadcasting()
    installEligible = false

    if (shouldAutoInstall) installUpdate()
  })

  autoUpdater.on('error', (error) => setState({ status: 'error', error: error.message }))

  setState({ status: 'idle' })
}

async function runCheck(): Promise<void> {
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    updaterLog.warn('check failed:', error)
  }
}

/** The launch path: whatever this check finds is eligible to install itself the moment
    it finishes downloading, since nothing has had a chance to start broadcasting yet. */
export function checkOnLaunch(): Promise<void> {
  if (!active) return Promise.resolve()

  installEligible = true

  return runCheck()
}

/** The periodic timer and the manual "Check for Updates" button in Settings both call
    this — never eligible to auto-install, so the result always waits for the user. */
export function checkNow(): Promise<void> {
  if (!active) return Promise.resolve()

  installEligible = false

  return runCheck()
}

/** Always performs the install when asked — the "are you sure, this will end your
    stream" gate is a renderer-side decision made against the live `BroadcastState` it
    already holds, not something main re-derives here. Silent and relaunches after,
    matching the launch path's own automatic install. */
export function installUpdate(): void {
  if (!active) return

  autoUpdater.quitAndInstall(true, true)
}

export function startPeriodicChecks(): void {
  if (!active || interval) return

  interval = setInterval(() => void checkNow(), CHECK_INTERVAL_MS)
}

export function stopPeriodicChecks(): void {
  if (interval) clearInterval(interval)
  interval = null
}

export function currentUpdateState(): UpdateState {
  return state
}
