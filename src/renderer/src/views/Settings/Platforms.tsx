import { useEffect, useState } from 'react'
import { ExternalLink, Eye, EyeOff } from 'lucide-react'
import type {
  EmoteProviderSettings,
  Platform,
  PlatformConfig,
  PlatformPatch
} from '@shared/types'
import { DEFAULT_INGEST, PLATFORMS } from '@shared/types'
import { bridge } from '../../bridge'
import { PlatformMark } from '../../components/PlatformMark'
import { ControlRow, Toggle } from '../../components/controls'
import { PLATFORM_COLOR, PLATFORM_NAME } from '../../theme'
import { useStore } from '../../store'

/** Where each platform actually shows these values, and which of them it shows. Twitch
    publishes no stream URL anywhere — the encoder picks an ingest server — so its button
    only promises the key. Opened in the real browser, where the user is already signed in. */
const HELP: Record<Platform, { label: string; url: string }> = {
  twitch: { label: 'Get your stream key', url: 'https://dashboard.twitch.tv/settings/stream' },
  youtube: {
    label: 'Get your stream key',
    url: 'https://studio.youtube.com/channel/UC/livestreaming'
  },
  kick: { label: 'Get your URL and key', url: 'https://dashboard.kick.com/channel/stream' }
}

const CHANNEL_HINT: Record<Platform, string> = {
  twitch: 'twitch.tv/<name>',
  youtube: '@handle, channel id, or video id',
  kick: 'kick.com/<name>'
}

/** Only where there is something the user must actually do. Twitch needs no note: its
    ingest is a constant main already holds, so the card is just a channel and a key. */
const EXTRA: Partial<Record<Platform, string>> = {
  /** YouTube will not start a broadcast just because video arrives unless this is on. */
  youtube: 'Turn on Auto-start in Studio, or pushing video will not go live.',

  kick: 'Kick gives every channel its own stream URL, so it needs both.'
}

const DEFAULT_EMOTE_PROVIDERS: EmoteProviderSettings = { sevenTv: true, bttv: true }

export function Platforms(): React.ReactElement {
  const configs = useStore((s) => s.platforms)

  return (
    <div>
      {PLATFORMS.map((platform, at) => (
        <PlatformCard
          key={platform}
          platform={platform}
          config={configs.find((c) => c.platform === platform)}
          first={at === 0}
        />
      ))}

      <p className="mt-[16px] text-[13px]" style={{ color: 'var(--fg-4)' }}>
        Chat is read anonymously — the channel is all it needs. The stream URL and key are
        only used to forward your OBS stream to that platform.
      </p>
    </div>
  )
}

function PlatformCard({
  platform,
  config,
  first
}: {
  platform: Platform
  config: PlatformConfig | undefined
  first: boolean
}): React.ReactElement {
  const help = HELP[platform]
  const providers = config?.emoteProviders ?? DEFAULT_EMOTE_PROVIDERS

  const setProvider = (key: keyof EmoteProviderSettings, value: boolean): void => {
    void bridge()
      .api.savePlatform(platform, { emoteProviders: { ...providers, [key]: value } })
      .catch((error) => console.debug('[platforms]', platform, 'emoteProviders', error))
  }

  return (
    <section className={first ? '' : 'mt-[18px]'}>
      <div className="mb-[10px] flex items-center gap-[8px]">
        <span style={{ color: PLATFORM_COLOR[platform] }}>
          <PlatformMark platform={platform} height={14} />
        </span>

        <h2 className="m-0 flex-1 text-[15px] font-semibold" style={{ color: 'var(--heading)' }}>
          {PLATFORM_NAME[platform]}
        </h2>

        <button
          type="button"
          className="ghost-button flex h-[24px] flex-none items-center gap-[6px] px-[10px] text-[12px]"
          onClick={() => void bridge().api.openExternal(help.url)}
        >
          <ExternalLink size={12} strokeWidth={1.8} />
          {help.label}
        </button>
      </div>

      <div
        className="px-[14px] py-[12px]"
        style={{ border: '1px solid var(--line)', borderRadius: 9 }}
      >
        <Field
          platform={platform}
          field="channel"
          label="Channel"
          placeholder={CHANNEL_HINT[platform]}
          value={config?.channel ?? ''}
        />

        {!DEFAULT_INGEST[platform] && (
          <Field
            platform={platform}
            field="ingestUrl"
            label="Stream URL"
            placeholder="rtmps://…from your Kick dashboard"
            value={config?.ingestUrl ?? ''}
            revealable
          />
        )}

        <Field
          platform={platform}
          field="streamKey"
          label="Stream key"
          placeholder="Paste your stream key"
          value=""
          secret
          revealable
          alreadySet={config?.hasStreamKey === true}
        />

        {EXTRA[platform] && (
          <p className="mt-[10px] mb-0 text-[12px]" style={{ color: 'var(--fg-4)' }}>
            {EXTRA[platform]}
          </p>
        )}

        <div className="mt-[14px] mb-[10px] h-px" style={{ background: 'var(--line)' }} />

        <div className="section-label mb-[8px]">Emotes</div>

        <ControlRow label="7TV emotes">
          <Toggle
            label="7TV emotes"
            on={providers.sevenTv}
            onChange={(on) => setProvider('sevenTv', on)}
          />
        </ControlRow>

        {platform === 'twitch' && (
          <ControlRow label="BTTV emotes">
            <Toggle
              label="BTTV emotes"
              on={providers.bttv}
              onChange={(on) => setProvider('bttv', on)}
            />
          </ControlRow>
        )}
      </div>
    </section>
  )
}

/** A secret field never receives its value from main — it is told only that one exists,
    and shows dots until the user chooses to replace it. A revealable field (the stream URL
    too, not only the key) starts hidden behind an eye toggle regardless — no critical value
    shown by default. */
function Field({
  platform,
  field,
  label,
  placeholder,
  value,
  secret,
  revealable,
  alreadySet
}: {
  platform: Platform
  field: keyof PlatformPatch
  label: string
  placeholder: string
  value: string
  secret?: boolean
  revealable?: boolean
  alreadySet?: boolean
}): React.ReactElement {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  const commit = (): void => {
    setEditing(false)
    setRevealed(false)

    if (secret && !draft) return
    if (!secret && draft === value) return

    void bridge()
      .api.savePlatform(platform, { [field]: draft })
      .then(() => {
        setSaved(true)
        if (secret) setDraft('')
        setTimeout(() => setSaved(false), 1500)
      })
      .catch((error) => console.debug('[platforms]', platform, field, error))
  }

  const masked = secret && alreadySet && !editing
  const inputType = revealable ? (revealed ? 'text' : 'password') : secret ? 'password' : 'text'

  return (
    <label className="mt-[10px] flex items-center gap-[10px] first:mt-0">
      <span className="w-[92px] flex-none text-[13px]" style={{ color: 'var(--fg-3)' }}>
        {label}
      </span>

      {masked ? (
        <>
          <span
            className="inset-field flex min-w-0 flex-1 items-center px-[10px] text-[13px]"
            style={{ height: 30, color: 'var(--fg-4)', letterSpacing: '0.15em' }}
          >
            ••••••••••••••••
          </span>

          <button
            type="button"
            className="ghost-button h-[30px] flex-none px-[10px] text-[12px]"
            onClick={() => {
              setDraft('')
              setRevealed(false)
              setEditing(true)
            }}
          >
            Replace
          </button>
        </>
      ) : (
        <div className="relative min-w-0 flex-1">
          <input
            type={inputType}
            value={draft}
            placeholder={placeholder}
            aria-label={`${PLATFORM_NAME[platform]} ${label}`}
            spellCheck={false}
            autoComplete="off"
            onFocus={() => setEditing(true)}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setDraft(value)
                setEditing(false)
                e.currentTarget.blur()
              }
            }}
            className="inset-field w-full px-[10px] text-[13px]"
            style={{ height: 30, paddingRight: revealable ? 30 : undefined }}
          />

          {revealable && (
            <button
              type="button"
              aria-label={`${revealed ? 'Hide' : 'Show'} ${PLATFORM_NAME[platform]} ${label}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setRevealed((r) => !r)}
              className="absolute top-1/2 right-[8px] flex -translate-y-1/2 cursor-pointer items-center border-0 bg-transparent p-0"
              style={{ color: 'var(--fg-4)' }}
            >
              {revealed ? (
                <EyeOff size={14} strokeWidth={1.8} />
              ) : (
                <Eye size={14} strokeWidth={1.8} />
              )}
            </button>
          )}
        </div>
      )}

      <span
        className="w-[42px] flex-none text-[12px]"
        style={{ color: 'var(--fg-4)', opacity: saved ? 1 : 0 }}
      >
        Saved
      </span>
    </label>
  )
}
