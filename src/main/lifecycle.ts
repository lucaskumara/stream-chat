import { app, powerMonitor, type BrowserWindow, type RenderProcessGoneDetails } from 'electron'

export function ignoreTeardownFailure(context: string): (error: unknown) => void {
  return (error: unknown) => {
    console.debug(`[teardown] ${context} failed (already gone?):`, error)
  }
}

const RELOAD_LIMIT = 3
const RELOAD_WINDOW_MS = 60_000
const RESUME_SETTLE_MS = 1_000

/** A dead renderer leaves the window open and painting `backgroundColor`, so the app does
    not close or error — it just goes blank until it is restarted. Windows reaps background
    processes across suspend/hibernate, which is why it shows up after sleep. Nothing here
    prevents the crash; it makes the window come back on its own. */
export function keepRendererAlive(window: BrowserWindow): void {
  const contents = window.webContents

  let reloads: number[] = []

  const reload = (why: string): void => {
    if (window.isDestroyed() || contents.isDestroyed()) return

    const now = Date.now()
    reloads = reloads.filter((at) => now - at < RELOAD_WINDOW_MS)

    // A renderer that dies on every load would otherwise reload forever
    if (reloads.length >= RELOAD_LIMIT) {
      console.error(`[window] ${why}, but ${reloads.length} reloads already — leaving it`)
      return
    }

    reloads.push(now)
    console.warn(`[window] ${why} — reloading the renderer`)
    contents.reload()
  }

  contents.on('render-process-gone', (_event, details: RenderProcessGoneDetails) => {
    if (details.reason === 'clean-exit') return

    reload(`renderer gone (${details.reason}, exit ${details.exitCode})`)
  })

  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    // -3 is ERR_ABORTED, which a superseded navigation reports normally
    if (!isMainFrame || code === -3) return

    reload(`load failed (${code} ${description}) for ${url}`)
  })

  contents.on('unresponsive', () => console.warn('[window] renderer unresponsive'))
  contents.on('responsive', () => console.warn('[window] renderer responsive again'))

  // GPU and utility processes are the app's, not this window's
  app.on('child-process-gone', (_event, details) => {
    console.warn(`[window] ${details.type} process gone (${details.reason})`)
  })

  // Losing the GPU across suspend can leave a live renderer with nothing on screen, which
  // no crash event reports. Repainting is cheap, so it is done unconditionally on resume.
  powerMonitor.on('resume', () => {
    setTimeout(() => {
      if (window.isDestroyed() || contents.isDestroyed()) return

      if (contents.isCrashed()) {
        reload('renderer was crashed on resume')
        return
      }

      console.debug('[window] resumed — repainting')
      contents.invalidate()
    }, RESUME_SETTLE_MS)
  })
}
