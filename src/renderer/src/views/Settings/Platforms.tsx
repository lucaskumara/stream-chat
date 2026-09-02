import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { Platform, PlatformConfig, PlatformPatch } from '@shared/types'
import { DEFAULT_INGEST, PLATFORMS } from '@shared/types'
import { bridge } from '../../bridge'
import { PlatformMark } from '../../components/PlatformMark'
import { PLATFORM_COLOR } from '../../theme'
import { useStore } from '../../store'

const NAME: Record<Platform, string> = {
  twitch: 'Twitch',
  youtube: 'YouTube',
  kick: 'Kick'
}

/** Where each platform actually shows these values, and which of them it shows. Twitch
    publishes no stream URL anywhere — the encoder picks an ingest server — so its button
    only promises the key. Opened in the real browser, where the user is already signed in. */
const HELP: Record<Platform, { label: string; url: string }> = {
  twitch: { label: 'Get your stream key', url: 'https://dashboard.twitch.tv/settings/stream' },
  youtube: {
    label: 'Get your stream key',
    url: 'https://studio.youtube.com/channel/UC/livestreaming'
  },
  kick: { label: 'Get your URL and key', url: 'https://kick.com/dashboard/settings/stream' }
}

const CHANNEL_HINT: Record<Platform, string> = {
  twitch: 'twitch.tv/<name>',
  youtube: '@handle, channel id, or video id',
  kick: 'kick.com/<name>'
}

const EXTRA: Record<Platform, string> = {
  twitch: 'Twitch has no URL to copy — every channel uses the one above.',

  /** YouTube will not start a broadcast just because video arrives unless this is on. */
  youtube:
    'Every channel uses the URL above. Turn on Auto-start in Studio, or pushing video will not go live.',

  kick: 'Kick gives every channel its own stream URL, so both come from your dashboard.'
}

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

  return (
    <section className={first ? '' : 'mt-[18px]'}>
      <div className="mb-[10px] flex items-center gap-[8px]">
        <span style={{ color: PLATFORM_COLOR[platform] }}>
          <PlatformMark platform={platform} height={14} />
        </span>

        <h2 className="m-0 flex-1 text-[15px] font-semibold" style={{ color: 'var(--heading)' }}>
          {NAME[platform]}
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

        {DEFAULT_INGEST[platform] ? (
          <Fixed label="Stream URL" value={DEFAULT_INGEST[platform]} />
        ) : (
          <Field
            platform={platform}
            field="ingestUrl"
            label="Stream URL"
            placeholder="rtmps://…from your Kick dashboard"
            value={config?.ingestUrl ?? ''}
          />
        )}

        <Field
          platform={platform}
          field="streamKey"
          label="Stream key"
          placeholder="Paste your stream key"
          value=""
          secret
          alreadySet={config?.hasStreamKey === true}
        />

        <p className="mt-[10px] mb-0 text-[12px]" style={{ color: 'var(--fg-4)' }}>
          {EXTRA[platform]}
        </p>
      </div>
    </section>
  )
}

/** The same ingest for every user of the platform, so it is shown rather than asked for.
    Only Kick's varies per channel. */
function Fixed({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="mt-[10px] flex items-center gap-[10px] first:mt-0">
      <span className="w-[92px] flex-none text-[13px]" style={{ color: 'var(--fg-3)' }}>
        {label}
      </span>

      <span
        className="min-w-0 flex-1 truncate text-[13px]"
        style={{ color: 'var(--fg-4)', height: 30, lineHeight: '30px' }}
        title={value}
      >
        {value}
      </span>

      <span className="w-[42px] flex-none" />
    </div>
  )
}

/** A secret field never receives its value from main — it is told only that one exists,
    and shows dots until the user chooses to replace it. */
function Field({
  platform,
  field,
  label,
  placeholder,
  value,
  secret,
  alreadySet
}: {
  platform: Platform
  field: keyof PlatformPatch
  label: string
  placeholder: string
  value: string
  secret?: boolean
  alreadySet?: boolean
}): React.ReactElement {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  const commit = (): void => {
    setEditing(false)

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
              setEditing(true)
            }}
          >
            Replace
          </button>
        </>
      ) : (
        <input
          type={secret ? 'password' : 'text'}
          value={draft}
          placeholder={placeholder}
          aria-label={`${NAME[platform]} ${label}`}
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
          className="inset-field min-w-0 flex-1 px-[10px] text-[13px]"
          style={{ height: 30 }}
        />
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
