import { useCallback, useEffect, useState } from 'react'
import { Button, Empty, Flex, Layout, Modal, Splitter } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import type { SourceState } from '@shared/types'
import { bridge } from './bridge'
import { useStore } from './store'
import { AddChannel } from './components/AddChannel'
import { ChannelTabs } from './components/ChannelTabs'
import { ChatPane } from './components/ChatPane'

export default function App(): React.ReactElement {
  const sources = useStore((s) => s.sources)
  const visibleIds = useStore((s) => s.visibleIds)
  const setSources = useStore((s) => s.setSources)
  const setTwitchAuth = useStore((s) => s.setTwitchAuth)
  const ingest = useStore((s) => s.ingest)
  const forgetSource = useStore((s) => s.forgetSource)
  const reorderSources = useStore((s) => s.reorderSources)
  const bySource = useStore((s) => s.bySource)
  const deleted = useStore((s) => s.deleted)
  const showDeleted = useStore((s) => s.showDeleted)
  const showTimestamps = useStore((s) => s.showTimestamps)
  const fontSize = useStore((s) => s.fontSize)

  const [adding, setAdding] = useState(false)

  useEffect(() => {
    document.documentElement.style.setProperty('--chat-font-size', `${fontSize}px`)
  }, [fontSize])

  useEffect(() => {
    const { api } = bridge()
    const offBatch = api.onBatch(ingest)
    const offSources = api.onSources(setSources)
    const offAuth = api.onTwitchAuth(setTwitchAuth)

    void api.listSources().then(setSources)
    void api
      .twitchAuthState()
      .then(setTwitchAuth)
      .catch((error) => console.debug('[auth] state unavailable:', error))

    return () => {
      offBatch()
      offSources()
      offAuth()
    }
  }, [ingest, setSources, setTwitchAuth])

  const remove = useCallback(
    (source: SourceState) => {
      void bridge().api.removeSource(source.id)
      forgetSource(source.id)
    },
    [forgetSource]
  )

  const reorder = useCallback(
    (orderedIds: string[]) => {
      reorderSources(orderedIds)
      void bridge().api.reorderSources(orderedIds)
    },
    [reorderSources]
  )

  const panes = sources.filter((source) => visibleIds.includes(source.id))

  return (
    <Layout style={{ height: '100%' }}>
      {sources.length === 0 ? (
        <Flex flex={1} align="center" justify="center">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No channels yet. Add one by name, or paste its link."
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
              Add a channel
            </Button>
          </Empty>
        </Flex>
      ) : (
        <Flex vertical style={{ height: '100%' }}>
          <ChannelTabs
            sources={sources}
            visibleIds={visibleIds}
            onAdd={() => setAdding(true)}
            onRemove={remove}
            onReorder={reorder}
          />

          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            {panes.length === 1 ? (
              <ChatPane
                deleted={deleted}
                showDeleted={showDeleted}
                showTimestamps={showTimestamps}
                search=""
                messages={bySource[panes[0].id] ?? []}
                showPlatform={false}
              />
            ) : (
              <Splitter style={{ height: '100%', width: '100%' }}>
                {panes.map((source) => (
                  <Splitter.Panel key={source.id} min={220}>
                    <ChatPane
                      deleted={deleted}
                      showDeleted={showDeleted}
                      showTimestamps={showTimestamps}
                      search=""
                      messages={bySource[source.id] ?? []}
                      showPlatform={false}
                    />
                  </Splitter.Panel>
                ))}
              </Splitter>
            )}
          </div>
        </Flex>
      )}

      <Modal
        title="Add a channel"
        open={adding}
        onCancel={() => setAdding(false)}
        footer={null}
        width={420}
        destroyOnHidden
      >
        <AddChannel onAdded={() => setAdding(false)} />
      </Modal>
    </Layout>
  )
}
