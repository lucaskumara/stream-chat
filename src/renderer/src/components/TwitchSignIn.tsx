import { useEffect, useState } from 'react'
import type { DeviceCodePrompt } from '@shared/types'
import { bridge } from '../bridge'
import { useStore } from '../store'

/**
 * The Device Code Flow widget, shared by the two places sign-in can start:
 * inline in the add-channel box when a Twitch channel is blocked on it, and in
 * the Connections panel. Keeping one component means the flow behaves
 * identically wherever the user meets it.
 */
export function TwitchSignIn({ reason }: { reason?: string }): React.ReactElement {
  const auth = useStore((s) => s.twitchAuth)
  const [prompt, setPrompt] = useState<DeviceCodePrompt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (auth.status === 'signed-in') setPrompt(null)
  }, [auth.status])

  const start = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const next = await bridge().api.twitchStartLogin()
      setPrompt(next)
      void bridge().api.openExternal(next.verificationUri)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (auth.status === 'not-configured') {
    return (
      <p className="text-[12px] leading-relaxed text-amber-500/80">
        This build has no Twitch Client ID compiled in.
      </p>
    )
  }

  if (prompt) {
    return (
      <div className="space-y-[6px] rounded border border-[#2b323d] bg-[#0b0d10] p-2">
        <p className="text-[12px] text-slate-500">
          Enter this code at{' '}
          <button
            type="button"
            onClick={() => void bridge().api.openExternal(prompt.verificationUri)}
            className="cursor-pointer text-sky-400 underline underline-offset-2"
          >
            {prompt.verificationUri.replace(/^https?:\/\//, '')}
          </button>
        </p>
        <div className="text-center font-mono text-[22px] font-bold tracking-[0.3em] text-slate-100 select-all">
          {prompt.userCode}
        </div>
        <p className="text-center text-[11px] text-slate-600">
          {auth.status === 'pending' ? 'waiting for authorisation…' : 'code ready'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-[6px]">
      {reason && <p className="text-[12px] leading-relaxed text-slate-500">{reason}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={() => void start()}
        className="w-full cursor-pointer rounded bg-[#9146ff] py-[6px] text-[13px] font-medium text-white hover:bg-[#a56bff] disabled:opacity-40"
      >
        Sign in with Twitch
      </button>
      {(error ?? auth.error) && (
        <div className="text-[12px] leading-relaxed text-red-400">{error ?? auth.error}</div>
      )}
    </div>
  )
}
