import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '@shared/types'

// The updater wraps electron-updater's own singleton, so both are stubbed the same way
// ipc.test.ts stubs `electron` itself — only the decision logic here is under test, not
// electron-updater's own network or install behaviour.
vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => '1.2.3' }
}))

type Handler = (...args: unknown[]) => void

const handlers: Record<string, Handler[]> = {}

const fakeUpdater = {
  autoDownload: false,
  autoInstallOnAppQuit: true,
  logger: null as unknown,
  isUpdaterActive: vi.fn(() => true),
  checkForUpdates: vi.fn(async () => null),
  quitAndInstall: vi.fn(),
  on: vi.fn((event: string, cb: Handler) => {
    ;(handlers[event] ??= []).push(cb)
  })
}

function emit(event: string, ...args: unknown[]): void {
  for (const cb of handlers[event] ?? []) cb(...args)
}

vi.mock('electron-updater', () => ({ autoUpdater: fakeUpdater }))

const {
  initUpdater,
  checkOnLaunch,
  checkNow,
  installUpdate,
  startPeriodicChecks,
  stopPeriodicChecks,
  currentUpdateState
} = await import('@main/updater')

function setup(broadcasting = false): { states: UpdateState[] } {
  const states: UpdateState[] = []
  initUpdater((state) => states.push(state), () => broadcasting)
  return { states }
}

beforeEach(() => {
  for (const key of Object.keys(handlers)) delete handlers[key]
  fakeUpdater.isUpdaterActive.mockReturnValue(true)
  fakeUpdater.checkForUpdates.mockClear()
  fakeUpdater.quitAndInstall.mockClear()
})

afterEach(() => {
  stopPeriodicChecks()
})

describe('initUpdater', () => {
  // Dev never has app-update.yml, and the portable build never gets one either — both
  // report through the same electron-updater check rather than an isDev special case.
  it('reports unsupported when the updater cannot run', () => {
    fakeUpdater.isUpdaterActive.mockReturnValue(false)

    const { states } = setup()

    expect(states.at(-1)?.status).toBe('unsupported')
  })

  it('reports idle when the updater is active', () => {
    const { states } = setup()

    expect(states.at(-1)?.status).toBe('idle')
  })
})

describe('event wiring', () => {
  it('maps checking-for-update to checking', () => {
    const { states } = setup()
    emit('checking-for-update')

    expect(states.at(-1)?.status).toBe('checking')
  })

  it('maps update-available to available, carrying the version', () => {
    const { states } = setup()
    emit('update-available', { version: '2.0.0' })

    expect(states.at(-1)).toMatchObject({ status: 'available', latestVersion: '2.0.0' })
  })

  it('maps download-progress to downloading, carrying a rounded percent', () => {
    const { states } = setup()
    emit('download-progress', { percent: 42.6 })

    expect(states.at(-1)).toMatchObject({ status: 'downloading', progressPercent: 43 })
  })

  it('maps update-not-available to not-available', () => {
    const { states } = setup()
    emit('update-not-available', { version: '1.2.3' })

    expect(states.at(-1)?.status).toBe('not-available')
  })

  it('maps error to error, carrying the message', () => {
    const { states } = setup()
    emit('error', new Error('network down'))

    expect(states.at(-1)).toMatchObject({ status: 'error', error: 'network down' })
  })
})

describe('checkOnLaunch', () => {
  it('asks electron-updater to check', async () => {
    setup()
    await checkOnLaunch()

    expect(fakeUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('installs automatically once the download finishes, if nothing is broadcasting', async () => {
    const { states } = setup(false)
    await checkOnLaunch()
    emit('update-downloaded', { version: '2.0.0' })

    expect(fakeUpdater.quitAndInstall).toHaveBeenCalledWith(true, true)
    expect(states.at(-1)?.status).toBe('downloaded')
  })

  // quitAndInstall closes the app, which would cut every RTMP connection the relay holds
  // open — a silent restart here would end the user's stream without warning them.
  it('does not install automatically while broadcasting, and leaves the update ready', async () => {
    const { states } = setup(true)
    await checkOnLaunch()
    emit('update-downloaded', { version: '2.0.0' })

    expect(fakeUpdater.quitAndInstall).not.toHaveBeenCalled()
    expect(states.at(-1)?.status).toBe('downloaded')
  })
})

describe('checkNow', () => {
  it('asks electron-updater to check', async () => {
    setup()
    await checkNow()

    expect(fakeUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  // The periodic timer and the manual "Check for Updates" button both go through this —
  // neither should ever restart the app out from under someone who didn't ask for it.
  it('never installs automatically, even when nothing is broadcasting', async () => {
    setup(false)
    await checkNow()
    emit('update-downloaded', { version: '2.0.0' })

    expect(fakeUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('clears an install eligibility left by an in-flight launch check', async () => {
    setup(false)
    await checkOnLaunch()
    await checkNow()
    emit('update-downloaded', { version: '2.0.0' })

    expect(fakeUpdater.quitAndInstall).not.toHaveBeenCalled()
  })
})

describe('installUpdate', () => {
  it('quits and installs silently, then relaunches', () => {
    setup()
    installUpdate()

    expect(fakeUpdater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('does nothing when the updater is not active', () => {
    fakeUpdater.isUpdaterActive.mockReturnValue(false)
    setup()
    installUpdate()

    expect(fakeUpdater.quitAndInstall).not.toHaveBeenCalled()
  })
})

describe('periodic checks', () => {
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('checks again once the interval elapses', () => {
    setup()
    startPeriodicChecks()

    vi.advanceTimersByTime(FOUR_HOURS_MS)

    expect(fakeUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('stops checking once stopped', () => {
    setup()
    startPeriodicChecks()
    stopPeriodicChecks()

    vi.advanceTimersByTime(FOUR_HOURS_MS * 6)

    expect(fakeUpdater.checkForUpdates).not.toHaveBeenCalled()
  })
})

describe('currentUpdateState', () => {
  it('reflects the last state reported', () => {
    setup()
    emit('update-available', { version: '2.0.0' })

    expect(currentUpdateState()).toMatchObject({ status: 'available', latestVersion: '2.0.0' })
  })
})
