import { useEffect, useState } from 'react'
import type { DeviceCodePrompt } from '@shared/types'
import { bridge } from '../bridge'
import { useStore } from '../store'

const CONSOLE_URL = 'https://dev.twitch.tv/console/apps/create'

function Row({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="flex items-center gap-1">{children}</div>
}

/**
 * Device Code Flow UI. Twitch shows a short code the user types on their own
 * device, so there is no redirect URI to host and no client secret to hide.
 */
export function TwitchAuthPanel(): React.ReactElement {
  const auth = useStore((s) => s.twitchAuth)
  const [clientId, setClientId] = useState('')
  const [prompt, setPrompt] = useState<DeviceCodePrompt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const saveClientId = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const next = await bridge().api.twitchSetClientId(clientId)
      useStore.getState().setTwitchAuth(next)
      setClientId('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const startLogin = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const next = await bridge().api.twitchStartLogin()
      setPrompt(next)
      // Open Twitch's activation page for them; the code still has to be typed.
      void bridge().api.openExternal(next.verificationUri)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const signOut = async (): Promise<void> => {
    setPrompt(null)
    await bridge().api.twitchSignOut()
  }

  // Clear the device code once the poll succeeds.
  useEffect(() => {
    if (auth.status === 'signed-in') setPrompt(null)
  }, [auth.status])

  return (
    <div className="border-b border-[#232932] p-2">
      <div className="mb-[6px] flex items-center gap-[6px]">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#9146ff' }} />
        <span className="text-[13px] font-semibold text-slate-300">Twitch</span>
        {auth.status === 'signed-in' && (
          <span className="ml-auto truncate text-[12px] text-emerald-400">{auth.login}</span>
        )}
      </div>

      {auth.status === 'no-client-id' && (
        <div className="space-y-[6px]">
          <p className="text-[12px] leading-relaxed text-slate-500">
            One-time setup: register a Twitch application to get a Client ID.
          </p>
          <ol className="ml-3 list-decimal space-y-[2px] text-[11px] leading-relaxed text-slate-600">
            <li>
              <button
                type="button"
                onClick={() => void bridge().api.openExternal(CONSOLE_URL)}
                className="cursor-pointer text-sky-400 underline underline-offset-2 hover:text-sky-300"
              >
                Open the Twitch dev console
              </button>
            </li>
            <li>
              OAuth Redirect URL: <code className="text-slate-400">http://localhost</code>
            </li>
            <li>
              Client Type: <code className="text-slate-400">Public</code>
            </li>
            <li>Copy the Client ID and paste it below</li>
          </ol>
          <Row>
            <input
              type="text"
              value={clientId}
              placeholder="Client ID"
              spellCheck={false}
              onChange={(e) => setClientId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveClientId()
              }}
              className="min-w-0 flex-1 rounded border border-[#2b323d] bg-[#0b0d10] px-[6px] py-1 text-[12px] text-slate-200 outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              disabled={busy || clientId.trim() === ''}
              onClick={() => void saveClientId()}
              className="cursor-pointer rounded bg-indigo-600 px-2 py-1 text-[12px] font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              save
            </button>
          </Row>
        </div>
      )}

      {(auth.status === 'signed-out' || auth.status === 'error') && !prompt && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void startLogin()}
          className="w-full cursor-pointer rounded bg-[#9146ff] py-1 text-[12px] font-medium text-white hover:bg-[#a56bff] disabled:opacity-40"
        >
          Sign in with Twitch
        </button>
      )}

      {prompt && auth.status !== 'signed-in' && (
        <div className="space-y-[6px] rounded border border-[#2b323d] bg-[#0b0d10] p-2">
          <p className="text-[11px] text-slate-500">
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
          className="w-full cursor-pointer rounded bg-[#232932] py-1 text-[11px] text-slate-400 hover:bg-red-500/25 hover:text-red-300"
        >
          sign out
        </button>
      )}

      {(error || auth.error) && (
        <div className="mt-1 text-[11px] leading-relaxed text-red-400">{error ?? auth.error}</div>
      )}
    </div>
  )
}
