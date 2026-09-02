import { app, safeStorage } from 'electron'
import type { Platform } from '@shared/types'
import { PLATFORMS } from '@shared/types'
import { BUILT_IN_TWITCH_CLIENT_ID } from './twitch/clientId'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface StoredTokens {
  accessToken: string
  refreshToken: string

  expiresAt: number
  scopes: string[]
  userId: string
  login: string

  /** The identifier the chat watcher resolves — a Twitch login, a Kick slug, a YouTube
      channel id. Usually the same string as `login`, but not on every platform, and this
      is the one the app connects with. */
  channel?: string
}

interface PlatformSlot {
  tokensEnc?: string
}

/** Version 2 added the youtube and kick slots. The twitch slot is byte-identical to
    version 1's, so a config written by an older build is upgraded in place rather than
    discarded — signing in again after an update would be a rude way to ship this. */
interface PersistedShape {
  version: 2
  twitch?: PlatformSlot
  youtube?: PlatformSlot
  kick?: PlatformSlot
}

const EMPTY: PersistedShape = { version: 2 }

class Config {
  private path: string
  private data: PersistedShape

  /** Where tokens go when the OS has no encryption backend: this session only, never
      the disk. Writing them in the clear is not an option. */
  private memoryTokens = new Map<Platform, StoredTokens>()

  constructor() {
    this.path = join(app.getPath('userData'), 'config.json')
    this.data = this.read()
  }

  private read(): PersistedShape {
    try {
      if (!existsSync(this.path)) return { ...EMPTY }

      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as {
        version?: number
        twitch?: PlatformSlot
        youtube?: PlatformSlot
        kick?: PlatformSlot
      }

      if (parsed?.version !== 1 && parsed?.version !== 2) return { ...EMPTY }

      return {
        version: 2,
        twitch: parsed.twitch,
        youtube: parsed.youtube,
        kick: parsed.kick
      }
    } catch (err) {
      console.warn('[config] unreadable, starting fresh:', err)
      return { ...EMPTY }
    }
  }

  private write(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })

      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      renameSync(tmp, this.path)
    } catch (err) {
      console.error('[config] write failed:', err)
    }
  }

  getClientId(): string | undefined {
    return process.env['TWITCH_CLIENT_ID'] || BUILT_IN_TWITCH_CLIENT_ID || undefined
  }

  getTokens(platform: Platform): StoredTokens | null {
    const held = this.memoryTokens.get(platform)
    if (held) return held

    const enc = this.data[platform]?.tokensEnc
    if (!enc) return null

    try {
      const json = safeStorage.decryptString(Buffer.from(enc, 'base64'))
      return JSON.parse(json) as StoredTokens
    } catch (err) {
      console.warn(`[config] ${platform} token decrypt failed, treating as signed out:`, err)
      return null
    }
  }

  setTokens(platform: Platform, tokens: StoredTokens | null): void {
    if (tokens === null) {
      this.memoryTokens.delete(platform)

      if (this.data[platform]) delete this.data[platform]?.tokensEnc

      this.write()
      return
    }

    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[config] OS encryption unavailable — tokens kept in memory only')
      this.memoryTokens.set(platform, tokens)
      return
    }

    const enc = safeStorage.encryptString(JSON.stringify(tokens)).toString('base64')
    this.data[platform] = { ...this.data[platform], tokensEnc: enc }
    this.write()
  }

  clearAllTokens(): void {
    for (const platform of PLATFORMS) this.setTokens(platform, null)
  }
}

let instance: Config | null = null

export function config(): Config {
  return (instance ??= new Config())
}
