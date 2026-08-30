import { useEffect, useState } from 'react'
import { Button, Input, Typography } from 'antd'
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
    <div>
      <Typography.Text type="secondary">
        Add this in OBS as a custom browser dock, or a browser source.
      </Typography.Text>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Input readOnly value={link ?? 'unavailable'} style={{ flex: 1, minWidth: 0 }} />

        <Button
          className="chat-link-copy"
          icon={copied ? <Check size={16} /> : <Copy size={16} />}
          disabled={!link}
          onClick={copy}
          aria-label="Copy this chat's link"
        />
      </div>

      {!link && (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
          The link server could not bind a port this session.
        </Typography.Text>
      )}
    </div>
  )
}
