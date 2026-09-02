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

/** Where each platform actually shows these values. Opened in the real browser, since
    that is where the user is already signed in. */
const HELP: Record<Platform, { label: string; url: string }> = {
  twitch: {
    label: 'Twitch dashboard → Settings → Stream',
    url: 'https://dashboard.twitch.tv/settings/stream'
  },
  youtube: {
    label: 'YouTube Studio → Go live → Stream',
    url: 'https://studio.youtube.com/channel/UC/livestreaming'
  },
  kick: {
    label: 'Kick dashboard → Settings → Stream',
    url: 'https://kick.com/dashboard/settings/stream'
  }
}

const CHANNEL_HINT: Record<Platform, string> = {
  twitch: 'twitch.tv/<name>',
  youtube: '@handle, channel id, or video id',
  kick: 'kick.com/<name>'
}

/** YouTube will not start a broadcast just because video arrives unless this is on. */
const EXTRA: Partial<Record<Platform, string>> = {
  youtube: 'Turn on Auto-start in YouTube Studio, or pushing video will not go live.',
  kick: 'Kick gives every channel its own stream URL, so both fields must be pasted.'
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
          Where to find these
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

        <Field
          platform={platform}
          field="ingestUrl"
          label="Stream URL"
          placeholder={DEFAULT_INGEST[platform] || 'rtmps://…'}
          value={config?.ingestUrl ?? ''}
        />

        <Field
          platform={platform}
          field="streamKey"
          label="Stream key"
          placeholder="Paste your stream key"
          value=""
          secret
          alreadySet={config?.hasStreamKey === true}
        />

        {EXTRA[platform] && (
          <p className="mt-[10px] mb-0 text-[12px]" style={{ color: 'var(--fg-4)' }}>
            {EXTRA[platform]}
          </p>
        )}
      </div>
    </section>
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
