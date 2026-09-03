import { useState } from 'react'
import { ExternalLink, Eye, EyeOff } from 'lucide-react'
import type { EmoteProviderSettings, Platform, PlatformConfig } from '@shared/types'
import { DEFAULT_INGEST, PLATFORMS } from '@shared/types'
import { bridge } from '../../bridge'
import { ChatLink } from '../../components/ChatLink'
import { PlatformMark } from '../../components/PlatformMark'
import { ControlRow, Toggle } from '../../components/controls'
import { PLATFORM_COLOR, PLATFORM_NAME } from '../../theme'
import type { PlatformDraft } from './platformDraft'
import type { PlatformDraftsApi } from './usePlatformDrafts'

/** Where each platform actually shows these values, and which of them it shows. Twitch
    publishes no stream URL anywhere — the encoder picks an ingest server — so its button
    only promises the key. Opened in the real browser, where the user is already signed in. */
const HELP: Record<Platform, { label: string; url: string }> = {
  twitch: { label: 'Get your stream key', url: 'https://dashboard.twitch.tv/settings/stream' },
  youtube: {
    label: 'Get your stream key',
    url: 'https://studio.youtube.com/channel/UC/livestreaming'
  },
  kick: { label: 'Get your stream URL and key', url: 'https://dashboard.kick.com/channel/stream' }
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

/** Settings/index.tsx computes this same id to scroll a specific card into view
    when Settings is opened from a platform-specific prompt — see the coordinated
    scroll effect there for why that lives at the pane level rather than here. */
export function platformCardId(platform: Platform): string {
  return `platform-card-${platform}`
}

export function Platforms(props: PlatformDraftsApi): React.ReactElement {
  return (
    <div>
      {PLATFORMS.map((platform, at) => (
        <PlatformCard
          key={platform}
          platform={platform}
          config={props.configs.find((c) => c.platform === platform)}
          draft={props.draftFor(platform)}
          onDraftChange={(patch) => props.updateDraft(platform, patch)}
          error={props.errorFor(platform)}
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
    <section id={platformCardId(platform)} className={first ? '' : 'mt-[18px]'}>
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
          placeholder={config?.hasStreamKey ? '••••••••••••••••' : 'Paste your stream key'}
          value={draft.streamKey}
          onChange={(value) => onDraftChange({ streamKey: value })}
          secret
          revealable
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

/** Fully controlled — the draft lives in the hook, so this is presentation only.
    The stream key is always a live input, never a separate masked-then-Replace
    step: main never sends the real value back, so there is nothing to reveal by
    unmasking, and the placeholder alone (dots once one is set) is what signals a
    key already exists. Typing simply overwrites the placeholder, the same as any
    other input — nothing is "wiped" first. */
function Field({
  platform,
  label,
  placeholder,
  value,
  onChange,
  secret,
  revealable,
  error
}: {
  platform: Platform
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  secret?: boolean
  revealable?: boolean
  error?: string
}): React.ReactElement {
  const [revealed, setRevealed] = useState(false)

  const inputType = revealable ? (revealed ? 'text' : 'password') : secret ? 'password' : 'text'

  return (
    <div className="mt-[10px] first:mt-0">
      <label className="flex items-center gap-[10px]">
        <span className="w-[92px] flex-none text-[13px]" style={{ color: 'var(--fg-3)' }}>
          {label}
        </span>

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
