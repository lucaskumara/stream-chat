import type { Platform } from '@shared/types'
import { bridge } from '../bridge'
import { useStore } from '../store'
import { PLATFORM_COLOR } from './MessageRow'
import { TwitchSignIn } from './TwitchSignIn'

interface PlatformInfo {
  platform: Platform
  name: string
  /** What the user has to do, if anything. */
  requirement: string
  /** How a channel is named for this platform. */
  addBy: string
  ready: boolean
  note?: string
}

/**
 * The three platforms genuinely differ in what they need, and pretending
 * otherwise would mislead. This panel is the one place that difference is
 * spelled out; everywhere else the user just adds a channel.
 */
const PLATFORMS: PlatformInfo[] = [
  {
    platform: 'twitch',
    name: 'Twitch',
    requirement: 'One-time sign-in',
    addBy: 'channel name, or a twitch.tv link',
    ready: true,
    note: 'EventSub is never anonymous — every chat subscription carries the reading account. Scope is user:read:chat only: it cannot post, follow, or read anything else.'
  },
  {
    platform: 'youtube',
    name: 'YouTube',
    requirement: 'No sign-in needed',
    addBy: '@handle (a video link follows that one broadcast only)',
    ready: false,
    note: 'Reads public live chat with a project API key. Chat lives on a video, not a channel, so the app re-resolves the current broadcast — which costs a little quota each check.'
  },
  {
    platform: 'kick',
    name: 'Kick',
    requirement: 'No sign-in needed',
    addBy: 'channel name, or a kick.com link',
    ready: false,
    note: 'Uses the unofficial realtime socket. Kick has no official realtime chat for desktop apps, so this can break without notice.'
  }
]

function StatusLine({ text, tone }: { text: string; tone: 'good' | 'muted' | 'warn' }): React.ReactElement {
  const color =
    tone === 'good' ? 'text-emerald-400' : tone === 'warn' ? 'text-amber-500/80' : 'text-slate-500'
  return <span className={`text-[12px] ${color}`}>{text}</span>
}

function TwitchRow(): React.ReactElement {
  const auth = useStore((s) => s.twitchAuth)
  const info = PLATFORMS[0] as PlatformInfo

  return (
    <div className="space-y-[6px] rounded border border-[#232932] bg-[#171b22] p-2">
      <div className="flex items-center gap-[6px]">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: PLATFORM_COLOR.twitch }}
        />
        <span className="text-[13px] font-semibold text-slate-300">{info.name}</span>
        <span className="ml-auto">
          {auth.status === 'signed-in' ? (
            <StatusLine text={auth.login ?? 'signed in'} tone="good" />
          ) : (
            <StatusLine text={info.requirement} tone="muted" />
          )}
        </span>
      </div>

      <p className="text-[11px] leading-relaxed text-slate-600">Add by {info.addBy}</p>

      {auth.status === 'signed-in' ? (
        <button
          type="button"
          onClick={() => void bridge().api.twitchSignOut()}
          className="w-full cursor-pointer rounded bg-[#232932] py-1 text-[12px] text-slate-400 hover:bg-red-500/25 hover:text-red-300"
        >
          sign out
        </button>
      ) : (
        <TwitchSignIn />
      )}

      <p className="text-[11px] leading-relaxed text-slate-600">{info.note}</p>
    </div>
  )
}

function PendingRow({ info }: { info: PlatformInfo }): React.ReactElement {
  return (
    <div className="space-y-[6px] rounded border border-[#232932] bg-[#171b22] p-2 opacity-70">
      <div className="flex items-center gap-[6px]">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: PLATFORM_COLOR[info.platform] }}
        />
        <span className="text-[13px] font-semibold text-slate-300">{info.name}</span>
        <span className="ml-auto">
          <StatusLine text={info.requirement} tone="good" />
        </span>
      </div>

      <p className="text-[11px] leading-relaxed text-slate-600">Add by {info.addBy}</p>
      <p className="text-[11px] leading-relaxed text-slate-600">{info.note}</p>
      <div className="rounded bg-[#0b0d10] px-2 py-1 text-[11px] text-amber-500/70">
        Provider not built yet.
      </div>
    </div>
  )
}

export function ConnectionsPanel(): React.ReactElement {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-[#232932] bg-[#0f1216]">
      <div className="border-b border-[#232932] px-2 py-[6px] text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
        Connections
      </div>

      <div className="chat-scroll flex-1 space-y-2 overflow-y-auto p-2">
        <p className="text-[11px] leading-relaxed text-slate-600">
          You always add a <span className="text-slate-400">channel</span> — the app finds
          whatever they are broadcasting now. Only Twitch needs an account.
        </p>

        <TwitchRow />
        {PLATFORMS.filter((p) => !p.ready).map((info) => (
          <PendingRow key={info.platform} info={info} />
        ))}
      </div>
    </aside>
  )
}
