import { app, safeStorage } from 'electron'
import { BUILT_IN_TWITCH_CLIENT_ID } from './twitch/clientId'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface StoredTwitchTokens {
  accessToken: string
  refreshToken: string

  expiresAt: number
  scopes: string[]
  userId: string
  login: string
}

export type StoredPlatform = 'twitch' | 'youtube' | 'kick'

export interface StoredChannel {
  platform: StoredPlatform

  login: string
}

interface PersistedShape {
  version: 1
  twitch?: {
    tokensEnc?: string
  }
  channels?: StoredChannel[]
}

const EMPTY: PersistedShape = { version: 1 }

class Config {
  private path: string
  private data: PersistedShape

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

  getTokens(): StoredTwitchTokens | null {
    if (this.memoryTokens) return this.memoryTokens

    const enc = this.data.twitch?.tokensEnc
    if (!enc) return null
    try {
      const json = safeStorage.decryptString(Buffer.from(enc, 'base64'))
      return JSON.parse(json) as StoredTwitchTokens
    } catch (err) {
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

  setChannels(channels: StoredChannel[]): void {
    this.data.channels = channels
    this.write()
  }

  removeChannel(platform: StoredPlatform, login: string): void {
    this.data.channels = this.getChannels().filter(
      (c) => !(c.platform === platform && c.login === login)
    )
    this.write()
  }
}

let instance: Config | null = null

export function config(): Config {
  return (instance ??= new Config())
}
