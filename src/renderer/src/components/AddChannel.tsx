import { useMemo, useState } from 'react'
import { Alert, Button, Flex, Input, Select, Space, Typography } from 'antd'
import type { Platform } from '@shared/types'
import { parseChannelInput } from '@shared/channel'
import { bridge } from '../bridge'
import { PlatformIcon } from './PlatformIcon'

const PLATFORM_OPTIONS: { value: Platform; label: React.ReactNode }[] = (
  ['twitch', 'youtube', 'kick'] as Platform[]
).map((platform) => ({
  value: platform,
  label: (
    <Flex align="center" gap={6}>
      <PlatformIcon platform={platform} />
      {platform}
    </Flex>
  )
}))

export interface AddChannelProps {
  onAdded?: () => void
}

export function AddChannel({ onAdded }: AddChannelProps): React.ReactElement {
  const [input, setInput] = useState('')
  const [platform, setPlatform] = useState<Platform>('twitch')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const preview = useMemo(() => {
    if (input.trim() === '') return null
    const parsed = parseChannelInput(input, platform)
    return parsed.ok && parsed.ref ? parsed.ref : null
  }, [input, platform])

  const submit = async (): Promise<void> => {
    setError(null)
    const parsed = parseChannelInput(input, platform)

    if (!parsed.ok || !parsed.ref) {
      setError(parsed.error ?? 'Could not understand that channel.')
      return
    }

    const ref = parsed.ref
    setBusy(true)
    try {
      await bridge().api.addSource({
        platform: ref.platform,
        label: ref.label,
        identifier: ref.value
      })
      setInput('')
      onAdded?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Flex vertical gap={10}>
      <Space.Compact style={{ width: '100%' }}>
        <Select<Platform>
          value={platform}
          onChange={setPlatform}
          options={PLATFORM_OPTIONS}
          style={{ width: 116, flexShrink: 0 }}
          title="platform for bare names — pasted links detect their own"
        />

        <Input
          autoFocus
          value={input}
          spellCheck={false}
          placeholder="channel name, or paste a link"
          onChange={(e) => {
            setInput(e.target.value)
            setError(null)
          }}
          onPressEnter={() => void submit()}
        />
      </Space.Compact>

      {preview ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          <Typography.Text style={{ fontSize: 12 }}>{preview.platform}</Typography.Text> ·{' '}
          {preview.value}
        </Typography.Text>
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Paste a twitch.tv / youtube.com / kick.com link, or pick a platform and type a name.
        </Typography.Text>
      )}

      {preview?.kind === 'youtube-video-id' && (
        <Alert
          type="warning"
          showIcon
          message="That link names one broadcast. Add the @handle instead to follow the channel across streams."
        />
      )}

      {error && <Alert type="error" showIcon message={error} />}

      <Button
        type="primary"
        block
        loading={busy}
        disabled={input.trim() === ''}
        onClick={() => void submit()}
      >
        Add channel
      </Button>
    </Flex>
  )
}
