import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { destinationRetryMs } from '@main/broadcast/relay'

// The Relay itself spawns ffmpeg, so only the pieces that decide *when* and *whether*
// are reachable here. Both were bugs: the backoff never grew, and a dead child was
// handed a kill timer nothing could clear.

vi.mock('electron', () => ({
  app: { getPath: () => '.', isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => false }
}))

vi.mock('ffmpeg-static', () => ({ default: 'ffmpeg' }))

const { endProcess } = await import('@main/broadcast')

describe('destinationRetryMs', () => {
  // A platform that refuses the key would otherwise reconnect every two seconds for the
  // length of the stream — which is what happened while the attempt count was reset on
  // every re-queue.
  it('doubles with each attempt', () => {
    expect(destinationRetryMs(0)).toBe(2_000)
    expect(destinationRetryMs(1)).toBe(4_000)
    expect(destinationRetryMs(2)).toBe(8_000)
    expect(destinationRetryMs(3)).toBe(16_000)
  })

  it('stops climbing at the ceiling', () => {
    expect(destinationRetryMs(4)).toBe(20_000)
    expect(destinationRetryMs(40)).toBe(20_000)
  })

  it('treats a negative count as the first attempt', () => {
    expect(destinationRetryMs(-1)).toBe(2_000)
  })
})

interface Stub {
  child: ChildProcess
  ended: boolean
  killed: number
  exitHandlers: (() => void)[]
}

function stubChild(exited: boolean): Stub {
  const stub: Stub = { child: null as never, ended: false, killed: 0, exitHandlers: [] }

  stub.child = {
    exitCode: exited ? 0 : null,
    signalCode: null,
    stdin: {
      end: () => {
        stub.ended = true
      }
    },
    kill: () => {
      stub.killed++
      return true
    },
    once: (event: string, handler: () => void) => {
      if (event === 'exit') stub.exitHandlers.push(handler)
      return stub.child
    }
  } as unknown as ChildProcess

  return stub
}

describe('endProcess', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // EOF on stdin is what makes ffmpeg write the FLV trailer and close the RTMP session,
  // so the platform sees the stream end rather than the connection disappear.
  it('ends stdin and waits rather than killing a live process', () => {
    const stub = stubChild(false)

    endProcess(stub.child, false)

    expect(stub.ended).toBe(true)
    expect(stub.killed).toBe(0)
  })

  it('kills a live process that will not leave within the grace period', () => {
    const stub = stubChild(false)

    endProcess(stub.child, false)
    vi.advanceTimersByTime(5_000)

    expect(stub.killed).toBe(1)
  })

  it('cancels the kill once the process exits on its own', () => {
    const stub = stubChild(false)

    endProcess(stub.child, false)
    for (const handler of stub.exitHandlers) handler()
    vi.advanceTimersByTime(30_000)

    expect(stub.killed).toBe(0)
  })

  // App shutdown is the exception: waiting there would orphan the process.
  it('kills immediately when asked to', () => {
    const stub = stubChild(false)

    endProcess(stub.child, true)

    expect(stub.ended).toBe(true)
    expect(stub.killed).toBe(1)
  })

  // The retry path holds a dead child until its timer fires, and `exit` does not fire a
  // second time — so a kill timer armed here could never be cleared.
  it('does nothing at all to a process that already exited', () => {
    const stub = stubChild(true)

    endProcess(stub.child, false)
    vi.advanceTimersByTime(30_000)

    expect(stub.ended).toBe(false)
    expect(stub.killed).toBe(0)
    expect(stub.exitHandlers).toHaveLength(0)
  })
})
