import { useEffect, useState } from 'react'
import { ExternalLink, Eye, EyeOff } from 'lucide-react'
import type { EmoteProviderSettings, Platform, PlatformConfig } from '@shared/types'
import { DEFAULT_INGEST, PLATFORMS } from '@shared/types'
import { bridge } from '../../bridge'
import { ChatLink } from '../../components/ChatLink'
import { PlatformMark } from '../../components/PlatformMark'
import { ControlRow, Toggle } from '../../components/controls'
import { PLATFORM_COLOR, PLATFORM_NAME } from '../../theme'
import { useStore } from '../../store'
import { dirtyPatch, draftFrom, type PlatformDraft } from './platformDraft'

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
  twitch: 'Channel name',
  youtube: '@handle, channel id, or video id',
  kick: 'Channel name'
}

/** Only where there is something the user must actually do. Twitch needs no note: its
    ingest is a constant main already holds, so the card is just a channel and a key. */
const EXTRA: Partial<Record<Platform, string>> = {
  /** YouTube will not start a broadcast just because video arrives unless this is on. */
  youtube: 'Turn on Auto-start in Studio, or pushing video will not go live.',

  kick: 'Kick gives every channel its own stream URL, so it needs both.'
}

const SAVED_FLASH_MS = 1500

function emptyDraft(): PlatformDraft {
  return {
    channel: '',
    ingestUrl: '',
    streamKey: '',
    replacingKey: false,
    emoteProviders: { sevenTv: true, bttv: true }
  }
}

function isDirty(configs: PlatformConfig[], drafts: Partial<Record<Platform, PlatformDraft>>): boolean {
  return PLATFORMS.some((platform) => {
    const config = configs.find((c) => c.platform === platform)
    const draft = drafts[platform]

    return config !== undefined && draft !== undefined && Object.keys(dirtyPatch(draft, config)).length > 0
  })
}

export function Platforms(): React.ReactElement {
  const configs = useStore((s) => s.platforms)

  const [drafts, setDrafts] = useState<Partial<Record<Platform, PlatformDraft>>>({})
  const [errors, setErrors] = useState<Partial<Record<Platform, string>>>({})
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)

  // Settings is a modal over the whole app, so this is the only screen that can be
  // showing while a platform's config changes underneath it — and the only source
  // of that change while it's open is this component's own save. Filling in a
  // draft only when one doesn't exist yet, rather than resyncing on every config
  // change, is what keeps a save from clobbering whatever the user is mid-typing.
  useEffect(() => {
    setDrafts((held) => {
      const next = { ...held }
      let changed = false

      for (const config of configs) {
        if (next[config.platform]) continue

        next[config.platform] = draftFrom(config)
        changed = true
      }

      return changed ? next : held
    })
  }, [configs])

  const updateDraft = (platform: Platform, patch: Partial<PlatformDraft>): void => {
    setDrafts((held) => ({
      ...held,
      [platform]: { ...(held[platform] ?? emptyDraft()), ...patch }
    }))

    if (patch.channel !== undefined) {
      setErrors((held) => {
        if (!held[platform]) return held

        const next = { ...held }
        delete next[platform]
        return next
      })
    }
  }

  const dirty = isDirty(configs, drafts)

  const handleSave = async (): Promise<void> => {
    setSaving(true)

    const nextDrafts = { ...drafts }
    const nextErrors: Partial<Record<Platform, string>> = {}

    for (const platform of PLATFORMS) {
      const config = configs.find((c) => c.platform === platform)
      const draft = drafts[platform]
      if (!config || !draft) continue

      const patch = dirtyPatch(draft, config)
      if (Object.keys(patch).length === 0) continue

      if (patch.channel) {
        const result = await bridge()
          .api.verifyChannel(platform, patch.channel)
          .catch((error): { ok: true; canonicalIdentifier?: string } => {
            console.debug('[platforms]', platform, 'verifyChannel', error)
            return { ok: true }
          })

        if (!result.ok) {
          nextErrors[platform] = result.reason ?? `${PLATFORM_NAME[platform]} channel not found.`
          delete patch.channel
        } else if (result.canonicalIdentifier) {
          patch.channel = result.canonicalIdentifier
          nextDrafts[platform] = { ...draft, channel: result.canonicalIdentifier }
        }
      }

      if (Object.keys(patch).length > 0) {
        await bridge()
          .api.savePlatform(platform, patch)
          .catch((error) => console.debug('[platforms]', platform, 'savePlatform', error))

        nextDrafts[platform] = { ...(nextDrafts[platform] ?? draft), streamKey: '', replacingKey: false }
      }
    }

    setDrafts(nextDrafts)
    setErrors(nextErrors)
    setSaving(false)

    if (Object.keys(nextErrors).length === 0) {
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), SAVED_FLASH_MS)
    }
  }

  return (
    <div>
      {PLATFORMS.map((platform, at) => (
        <PlatformCard
          key={platform}
          platform={platform}
          config={configs.find((c) => c.platform === platform)}
          draft={drafts[platform] ?? emptyDraft()}
          onDraftChange={(patch) => updateDraft(platform, patch)}
          error={errors[platform]}
          first={at === 0}
        />
      ))}

      <p className="mt-[16px] text-[13px]" style={{ color: 'var(--fg-4)' }}>
        Chat is read anonymously — the channel is all it needs. The stream URL and key are
        only used to forward your OBS stream to that platform.
      </p>

      <div
        className="sticky bottom-0 mt-[20px] flex items-center justify-end gap-[12px] py-[14px]"
        style={{ background: 'var(--ink-900)', borderTop: '1px solid var(--line)' }}
      >
        <span className="text-[12px]" style={{ color: 'var(--fg-4)', opacity: savedFlash ? 1 : 0 }}>
          All changes saved
        </span>

        <button
          type="button"
          className="primary-button h-[30px] px-[16px] text-[13px]"
          disabled={!dirty || saving}
          onClick={() => void handleSave()}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}

function PlatformCard({
  platform,
  config,
  draft,
  onDraftChange,
  error,
  first
}: {
  platform: Platform
  config: PlatformConfig | undefined
  draft: PlatformDraft
  onDraftChange: (patch: Partial<PlatformDraft>) => void
  error: string | undefined
  first: boolean
}): React.ReactElement {
  const help = HELP[platform]

  const setProvider = (key: keyof EmoteProviderSettings, value: boolean): void => {
    onDraftChange({ emoteProviders: { ...draft.emoteProviders, [key]: value } })
  }

  return (
    <section className={first ? '' : 'mt-[18px]'}>
      <div
        className="px-[14px] py-[12px]"
        style={{ border: '1px solid var(--line)', borderRadius: 9 }}
      >
        <div className="flex items-center gap-[8px]">
          <span style={{ color: PLATFORM_COLOR[platform] }}>
            <PlatformMark platform={platform} height={14} />
          </span>

          <h2 className="m-0 text-[15px] font-semibold" style={{ color: 'var(--heading)' }}>
            {PLATFORM_NAME[platform]}
          </h2>
        </div>

        <div className="mt-[14px] mb-[12px] h-px" style={{ background: 'var(--line)' }} />

        <div className="section-label mb-[8px]">Chat</div>

        <Field
          platform={platform}
          label="Channel"
          placeholder={CHANNEL_HINT[platform]}
          value={draft.channel}
          onChange={(value) => onDraftChange({ channel: value })}
          error={error}
        />

        {config?.channel && (
          <div className="mt-[10px] flex items-center gap-[10px]">
            <span className="w-[92px] flex-none text-[13px]" style={{ color: 'var(--fg-3)' }}>
              OBS dock
            </span>
            <ChatLink platform={platform} channel={config.channel} />
          </div>
        )}

        <div className="mt-[14px] mb-[10px] h-px" style={{ background: 'var(--line)' }} />

        <div className="mb-[8px] flex items-center gap-[10px]">
          <div className="section-label flex-1">Broadcast</div>

          <button
            type="button"
            className="ghost-button flex h-[24px] flex-none items-center gap-[6px] px-[10px] text-[12px]"
            onClick={() => void bridge().api.openExternal(help.url)}
          >
            <ExternalLink size={12} strokeWidth={1.8} />
            {help.label}
          </button>
        </div>

        {!DEFAULT_INGEST[platform] && (
          <Field
            platform={platform}
            label="Stream URL"
            placeholder="rtmps://…from your Kick dashboard"
            value={draft.ingestUrl}
            onChange={(value) => onDraftChange({ ingestUrl: value })}
            revealable
          />
        )}

        <Field
          platform={platform}
          label="Stream key"
          placeholder="Paste your stream key"
          value={draft.streamKey}
          onChange={(value) => onDraftChange({ streamKey: value })}
          secret
          revealable
          alreadySet={config?.hasStreamKey === true}
          replacing={draft.replacingKey}
          onStartReplace={() => onDraftChange({ streamKey: '', replacingKey: true })}
        />

        {EXTRA[platform] && (
          <p className="mt-[10px] mb-0 text-[12px]" style={{ color: 'var(--fg-4)' }}>
            {EXTRA[platform]}
          </p>
        )}

        <div className="mt-[14px] mb-[10px] h-px" style={{ background: 'var(--line)' }} />

        <div className="section-label mb-[8px]">Emotes</div>

        <div className="flex flex-col gap-[10px]">
          <ControlRow label="7TV emotes">
            <Toggle
              label="7TV emotes"
              on={draft.emoteProviders.sevenTv}
              onChange={(on) => setProvider('sevenTv', on)}
            />
          </ControlRow>

          {platform === 'twitch' && (
            <ControlRow label="BTTV emotes">
              <Toggle
                label="BTTV emotes"
                on={draft.emoteProviders.bttv}
                onChange={(on) => setProvider('bttv', on)}
              />
            </ControlRow>
          )}
        </div>
      </div>
    </section>
  )
}

/** A secret field never receives its value from main — it is told only that one exists,
    and shows dots until the user chooses to replace it. A revealable field (the stream URL
    too, not only the key) starts hidden behind an eye toggle regardless — no critical value
    shown by default. Fully controlled: the draft lives in the parent, so this is presentation
    and the masked/replace state machine alone. */
function Field({
  platform,
  label,
  placeholder,
  value,
  onChange,
  secret,
  revealable,
  alreadySet,
  replacing,
  onStartReplace,
  error
}: {
  platform: Platform
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  secret?: boolean
  revealable?: boolean
  alreadySet?: boolean
  replacing?: boolean
  onStartReplace?: () => void
  error?: string
}): React.ReactElement {
  const [revealed, setRevealed] = useState(false)

  const masked = secret && alreadySet && !replacing
  const inputType = revealable ? (revealed ? 'text' : 'password') : secret ? 'password' : 'text'

  return (
    <div className="mt-[10px] first:mt-0">
      <label className="flex items-center gap-[10px]">
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
              onClick={onStartReplace}
            >
              Replace
            </button>
          </>
        ) : (
          <div className="relative min-w-0 flex-1">
            <input
              type={inputType}
              value={value}
              placeholder={placeholder}
              aria-label={`${PLATFORM_NAME[platform]} ${label}`}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => onChange(e.currentTarget.value)}
              className="inset-field w-full px-[10px] text-[13px]"
              style={{
                height: 30,
                paddingRight: revealable ? 30 : undefined,
                borderColor: error ? 'var(--error)' : undefined
              }}
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
      </label>

      {error && (
        <p
          className="mt-[4px] mb-0 text-[12px]"
          style={{ color: 'var(--error)', marginLeft: 102 }}
        >
          {error}
        </p>
      )}
    </div>
  )
}
