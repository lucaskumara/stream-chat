import { app, safeStorage } from 'electron'
import type { Platform, PlatformPatch, PlatformSetup } from '@shared/types'
import { DEFAULT_INGEST, PLATFORMS } from '@shared/types'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

interface PlatformSlot {
  setupEnc?: string
}

/** Version 3 replaced the OAuth token slots with the streaming setup. Nothing carries
    forward: the tokens it dropped authorised features that no longer exist, so an older
    config is read for its shape and its contents discarded. */
interface PersistedShape {
  version: 3
  twitch?: PlatformSlot
  youtube?: PlatformSlot
  kick?: PlatformSlot
}

const EMPTY: PersistedShape = { version: 3 }

function blank(platform: Platform): PlatformSetup {
  return { channel: '', ingestUrl: DEFAULT_INGEST[platform], streamKey: '', forward: false }
}

class Config {
  private path: string
  private data: PersistedShape

  /** Where the setup goes when the OS has no encryption backend: this session only,
      never the disk. A stream key in the clear is not an option. */
  private memory = new Map<Platform, PlatformSetup>()

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

      if (parsed?.version !== 3) return { ...EMPTY }

      return {
        version: 3,
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

  /** The whole record is encrypted, not just the key: a channel name is the one thing
      this app deliberately never used to keep, so if it must be stored now it is stored
      the same way the secret is. */
  setup(platform: Platform): PlatformSetup {
    const held = this.memory.get(platform)
    if (held) return held

    const enc = this.data[platform]?.setupEnc
    if (!enc) return blank(platform)

    try {
      const json = safeStorage.decryptString(Buffer.from(enc, 'base64'))
      return fixIngest(platform, {
        ...blank(platform),
        ...(JSON.parse(json) as Partial<PlatformSetup>)
      })
    } catch (err) {
      console.warn(`[config] ${platform} setup decrypt failed, treating as unset:`, err)
      return blank(platform)
    }
  }

  all(): Record<Platform, PlatformSetup> {
    return Object.fromEntries(PLATFORMS.map((p) => [p, this.setup(p)])) as Record<
      Platform,
      PlatformSetup
    >
  }

  /** A patch, so the renderer can save a channel without having to send back a stream
      key it was never given. An empty string clears a field; undefined leaves it. */
  update(platform: Platform, patch: PlatformPatch): PlatformSetup {
    const next = fixIngest(platform, {
      ...this.setup(platform),
      ...definedOnly(patch)
    })

    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[config] OS encryption unavailable — setup kept in memory only')
      this.memory.set(platform, next)
      return next
    }

    const enc = safeStorage.encryptString(JSON.stringify(next)).toString('base64')
    this.data[platform] = { ...this.data[platform], setupEnc: enc }
    this.write()

    return next
  }
}

/** Twitch and YouTube publish one ingest for everybody, so theirs is not user data — it
    is a constant, and a stale value saved by an earlier build must not outrank it. Kick's
    is per-channel, so whatever is stored is the only thing that can be right. */
function fixIngest(platform: Platform, setup: PlatformSetup): PlatformSetup {
  const fixed = DEFAULT_INGEST[platform]

  return fixed ? { ...setup, ingestUrl: fixed } : setup
}

function definedOnly(patch: PlatformPatch): Partial<PlatformSetup> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  ) as Partial<PlatformSetup>
}

let instance: Config | null = null

export function config(): Config {
  return (instance ??= new Config())
}
