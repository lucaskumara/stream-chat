import { useEffect, useState } from 'react'
import type { DeviceCodePrompt } from '@shared/types'
import { bridge } from '../bridge'
import { useStore } from '../store'

/**
 * Device Code Flow UI: one button, then a short code to type on twitch.tv.
 * There is no Client ID field — that is a build-time constant, not user setup.
 */
export function TwitchAuthPanel(): React.ReactElement {
  const auth = useStore((s) => s.twitchAuth)
  const [prompt, setPrompt] = useState<DeviceCodePrompt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Clear the device code once the poll succeeds.
  useEffect(() => {
    if (auth.status === 'signed-in') setPrompt(null)
  }, [auth.status])

  const startLogin = async (): Promise<void> => {
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

  const signOut = async (): Promise<void> => {
    setPrompt(null)
    setError(null)
    await bridge().api.twitchSignOut()
  }

  return (
    <div className="border-b border-[#232932] p-2">
      <div className="mb-[6px] flex items-center gap-[6px]">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#9146ff' }} />
        <span className="text-[13px] font-semibold text-slate-300">Twitch</span>
        {auth.status === 'signed-in' && (
          <span className="ml-auto truncate text-[12px] text-emerald-400">{auth.login}</span>
        )}
      </div>

      {auth.status === 'not-configured' && (
        <p className="text-[12px] leading-relaxed text-amber-500/80">
          This build has no Twitch Client ID compiled in.
        </p>
      )}

      {(auth.status === 'signed-out' || auth.status === 'error') && !prompt && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void startLogin()}
          className="w-full cursor-pointer rounded bg-[#9146ff] py-[6px] text-[13px] font-medium text-white hover:bg-[#a56bff] disabled:opacity-40"
        >
          Sign in with Twitch
        </button>
      )}

      {prompt && auth.status !== 'signed-in' && (
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
      )}

      {auth.status === 'signed-in' && (
        <button
          type="button"
          onClick={() => void signOut()}
          className="w-full cursor-pointer rounded bg-[#232932] py-1 text-[12px] text-slate-400 hover:bg-red-500/25 hover:text-red-300"
        >
          sign out
        </button>
      )}

      {(error ?? auth.error) && (
        <div className="mt-1 text-[12px] leading-relaxed text-red-400">{error ?? auth.error}</div>
      )}
    </div>
  )
}
