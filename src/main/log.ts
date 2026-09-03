import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { secrets } from './redact'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

/** One rolled-over file is kept. The log exists to answer "what happened just now" —
    a packaged build has no console at all, so without it a failure that only shows up
    in the installed app leaves nothing behind. It is not an audit trail. */
const MAX_BYTES = 2 * 1024 * 1024
const LOG_FILE = 'main.log'
const ROLLED_FILE = 'main.1.log'

export const LOG_DIR_NAME = 'logs'

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`

  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/** Every line goes through `scrub`, not just the ones that obviously carry a key.
    ffmpeg prints the destination URL in its banner and in half its errors, so the
    lines that leak are the ones nobody thought to guard. */
export function formatLine(at: Date, level: LogLevel, scope: string, parts: unknown[]): string {
  const body = parts.map(stringify).join(' ')

  return `${at.toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${secrets.scrub(body)}`
}

export function shouldRotate(bytes: number, incoming: number): boolean {
  return bytes + incoming > MAX_BYTES
}

class Logger {
  private level: LogLevel = 'info'
  private dir: string | null = null
  private path: string | null = null

  /** A logger that cannot write must not take the app down with it, and must not
      re-report the same failure on every line. */
  private broken = false

  setLevel(level: LogLevel): void {
    this.level = level
  }

  /** Called once the app knows where userData is. Until then — and if this fails —
      lines still reach the console, which is all `npm run dev` ever had. */
  openIn(userDataDir: string): void {
    try {
      const dir = join(userDataDir, LOG_DIR_NAME)
      mkdirSync(dir, { recursive: true })

      this.dir = dir
      this.path = join(dir, LOG_FILE)
      this.broken = false
    } catch (error) {
      console.error('[log] could not open the log directory:', error)
      this.broken = true
    }
  }

  directory(): string | null {
    return this.dir
  }

  write(level: LogLevel, scope: string, parts: unknown[]): void {
    if (ORDER[level] < ORDER[this.level]) return

    const line = formatLine(new Date(), level, scope, parts)

    mirror(level, line)
    this.append(line)
  }

  private append(line: string): void {
    if (!this.path || this.broken) return

    try {
      this.rotateIfFull(line.length + 1)
      appendFileSync(this.path, `${line}\n`, 'utf8')
    } catch (error) {
      this.broken = true
      console.error('[log] file logging disabled:', error)
    }
  }

  private rotateIfFull(incoming: number): void {
    if (!this.path || !this.dir || !existsSync(this.path)) return
    if (!shouldRotate(statSync(this.path).size, incoming)) return

    renameSync(this.path, join(this.dir, ROLLED_FILE))
  }
}

function mirror(level: LogLevel, line: string): void {
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

const logger = new Logger()

export interface Log {
  debug(...parts: unknown[]): void
  info(...parts: unknown[]): void
  warn(...parts: unknown[]): void
  error(...parts: unknown[]): void
}

/** `log('relay:kick').warn(...)` — the scope is the bracketed prefix every call site
    was hand-writing, so it cannot drift from the module it came from. */
export function log(scope: string): Log {
  return {
    debug: (...parts) => logger.write('debug', scope, parts),
    info: (...parts) => logger.write('info', scope, parts),
    warn: (...parts) => logger.write('warn', scope, parts),
    error: (...parts) => logger.write('error', scope, parts)
  }
}

export function setLogLevel(level: LogLevel): void {
  logger.setLevel(level)
}

export function openLogFile(userDataDir: string): void {
  logger.openIn(userDataDir)
}

export function logDirectory(): string | null {
  return logger.directory()
}
