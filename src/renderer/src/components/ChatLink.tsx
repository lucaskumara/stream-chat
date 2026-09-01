import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { bridge } from '../bridge'

const COPIED_FOR_MS = 1600

export function ChatLink({ sourceId }: { sourceId: string }): React.ReactElement {
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let live = true

    void bridge()
      .api.obsLink(sourceId)
      .then((url) => {
        if (live) setLink(url)
      })
      .catch(() => {
        if (live) setLink(null)
      })

    return () => {
      live = false
    }
  }, [sourceId])

  useEffect(() => {
    if (!copied) return

    const timer = window.setTimeout(() => setCopied(false), COPIED_FOR_MS)

    return () => window.clearTimeout(timer)
  }, [copied])

  const copy = (): void => {
    if (!link) return

    void bridge().api.copyText(link)
    setCopied(true)
  }

  return (
    <div className="flex items-center gap-[8px]">
      <div className="inset-field h-[30px] min-w-0 flex-1">
        <span
          className="min-w-0 flex-1 truncate text-[13px] whitespace-nowrap"
          style={{ color: link ? 'var(--fg-2)' : 'var(--fg-4)' }}
        >
          {link ?? 'unavailable'}
        </span>
      </div>

      <button
        type="button"
        className="icon-button chat-link-copy"
        disabled={!link}
        aria-label="Copy this chat's link"
        onClick={copy}
      >
        {copied ? <Check size={15} strokeWidth={1.8} /> : <Copy size={15} strokeWidth={1.8} />}
      </button>
    </div>
  )
}
