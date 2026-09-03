const MASK = '••••'

/** Below this a "secret" is more likely to be a substring of ordinary text than the
    value itself, and blanking it everywhere would corrupt every line it appears in.
    Every real secret here — a stream key, the relay key — is far longer. */
const MIN_SECRET_LENGTH = 6

/** The last path segment of an RTMP push URL is the stream key on all three platforms.
    ffmpeg prints the whole URL — in its banner, in "error opening", in the muxer line —
    so this catches a key that was never registered as a secret, which is the case that
    matters: a key typed into the wrong field still reaches a destination process. */
const RTMP_URL = /\b(rtmps?:\/\/[^\s'"]*\/)([^/\s'"]{6,})/gi

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Stream keys reach places nothing else does: ffmpeg writes them to stderr, and that
    text is logged, stored on the destination and rendered in the Broadcast view. The app
    is a streamer's, so its own window can end up on stream — a key visible in a log line
    or an error row is a key handed to the audience. Everything outbound goes through
    `scrub`, and the values to look for are registered here as they are used. */
export class Secrets {
  private values = new Set<string>()

  remember(value: string | undefined | null): void {
    const trimmed = value?.trim()
    if (!trimmed || trimmed.length < MIN_SECRET_LENGTH) return

    this.values.add(trimmed)
  }

  forget(): void {
    this.values.clear()
  }

  scrub(text: string): string {
    let out = text.replace(RTMP_URL, (_all, prefix: string) => `${prefix}${MASK}`)

    for (const value of this.values) {
      out = out.replace(new RegExp(escapeForRegExp(value), 'g'), MASK)
    }

    return out
  }

  /** For a value shown in the UI rather than embedded in a sentence: enough to tell two
      keys apart when reading it back, and useless to anyone reading it off a stream. */
  static preview(value: string): string {
    if (value.length <= 4) return MASK

    return `${MASK}${value.slice(-4)}`
  }
}

export const secrets = new Secrets()
