import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface StoredTwitchTokens {
  accessToken: string
  refreshToken: string
  /** Epoch ms. Refreshed a little early; see TwitchAuth.getAccessToken. */
  expiresAt: number
  scopes: string[]
  userId: string
  login: string
}

export interface StoredChannel {
  platform: 'twitch'
  /** Lowercased login name, the stable identifier. */
  login: string
}

interface PersistedShape {
  version: 1
  twitch?: {
    clientId?: string
    /** base64 of safeStorage-encrypted JSON. Never plaintext on disk. */
    tokensEnc?: string
  }
  channels?: StoredChannel[]
}

const EMPTY: PersistedShape = { version: 1 }

/**
 * Small hand-rolled settings file rather than electron-store: v11 of that
 * package is ESM-only, and this build emits CJS for the main process. Tokens
 * are encrypted with the OS keychain (DPAPI on Windows) and the plaintext never
 * touches disk.
 */
class Config {
  private path: string
  private data: PersistedShape
  /** Used when the OS has no encryption backend — session-only, never written. */
  private memoryTokens: StoredTwitchTokens | null = null

  constructor() {
    this.path = join(app.getPath('userData'), 'config.json')
    this.data = this.read()
  }

  private read(): PersistedShape {
    try {
      if (!existsSync(this.path)) return { ...EMPTY }
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as PersistedShape
      if (parsed?.version !== 1) return { ...EMPTY }
      return parsed
    } catch (err) {
      console.warn('[config] unreadable, starting fresh:', err)
      return { ...EMPTY }
    }
  }

  private write(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      // Write-then-rename so a crash mid-write can't truncate the real file.
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      renameSync(tmp, this.path)
    } catch (err) {
      console.error('[config] write failed:', err)
    }
  }

  getClientId(): string | undefined {
    // An env var wins, which keeps a dev client id out of the settings file.
    return process.env['TWITCH_CLIENT_ID'] || this.data.twitch?.clientId
  }

  setClientId(clientId: string): void {
    this.data.twitch = { ...this.data.twitch, clientId: clientId.trim() }
    this.write()
  }

  getTokens(): StoredTwitchTokens | null {
    if (this.memoryTokens) return this.memoryTokens

    const enc = this.data.twitch?.tokensEnc
    if (!enc) return null
    try {
      const json = safeStorage.decryptString(Buffer.from(enc, 'base64'))
      return JSON.parse(json) as StoredTwitchTokens
    } catch (err) {
      // Usually means a different OS user or machine wrote them.
      console.warn('[config] token decrypt failed, treating as signed out:', err)
      return null
    }
  }

  setTokens(tokens: StoredTwitchTokens | null): void {
    if (tokens === null) {
      this.memoryTokens = null
      if (this.data.twitch) delete this.data.twitch.tokensEnc
      this.write()
      return
    }

    if (!safeStorage.isEncryptionAvailable()) {
      // Refuse to write credentials in the clear. The session still works; the
      // user just signs in again next launch.
      console.warn('[config] OS encryption unavailable — tokens kept in memory only')
      this.memoryTokens = tokens
      return
    }

    const enc = safeStorage.encryptString(JSON.stringify(tokens)).toString('base64')
    this.data.twitch = { ...this.data.twitch, tokensEnc: enc }
    this.write()
  }

  getChannels(): StoredChannel[] {
    return this.data.channels ?? []
  }

  addChannel(channel: StoredChannel): void {
    const existing = this.getChannels()
    if (existing.some((c) => c.platform === channel.platform && c.login === channel.login)) return
    this.data.channels = [...existing, channel]
    this.write()
  }

  removeChannel(platform: 'twitch', login: string): void {
    this.data.channels = this.getChannels().filter(
      (c) => !(c.platform === platform && c.login === login)
    )
    this.write()
  }
}

let instance: Config | null = null

/** Lazy so it is never constructed before app.getPath('userData') is valid. */
export function config(): Config {
  return (instance ??= new Config())
}
