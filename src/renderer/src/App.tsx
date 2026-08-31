import { useCallback, useEffect, useState } from 'react'
import { Button, Empty, Flex, Layout, Modal, Splitter } from 'antd'
import { Plus } from 'lucide-react'
import type { SourceState } from '@shared/types'
import { bridge } from './bridge'
import { CHAT_FONT_DEFAULT, useStore } from './store'
import { AddChannel } from './components/AddChannel'
import { ChannelTabs } from './components/ChannelTabs'
import { ChatPane } from './components/ChatPane'
import { TitleBar } from './components/TitleBar'

const EMPTY_TERMS: string[] = []

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
  const search = useStore((s) => s.search)
  const searchDraft = useStore((s) => s.searchDraft)
  const setSearch = useStore((s) => s.setSearch)
  const setSearchDraft = useStore((s) => s.setSearchDraft)
  const addSearchTerm = useStore((s) => s.addSearchTerm)
  const stepFontSize = useStore((s) => s.stepFontSize)
  const resetFontSize = useStore((s) => s.resetFontSize)
  const clearSource = useStore((s) => s.clearSource)
  const showDeleted = useStore((s) => s.showDeleted)
  const showTimestamps = useStore((s) => s.showTimestamps)
  const fontSize = useStore((s) => s.fontSize)

  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const { api } = bridge()
    const offBatch = api.onBatch(ingest)
    const offSources = api.onSources(setSources)
    const offAuth = api.onTwitchAuth(setTwitchAuth)

    // A renderer reload — after a crash, or the watchdog recovering a blank window —
    // starts with an empty store, so the replay main already keeps for OBS docks is
    // pulled back in rather than leaving the pane blank until the next message.
    void api.listSources().then((states) => {
      setSources(states)

      for (const state of states) {
        void api
          .sourceBacklog(state.id)
          .then((messages) => {
            if (messages.length > 0) ingest({ messages, moderation: [] })
          })
          .catch(() => {})
      }
    })
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

  const renderPane = (source: SourceState): React.ReactElement => (
    <ChatPane
      sourceId={source.id}
      messages={bySource[source.id] ?? []}
      deleted={deleted}
      showDeleted={showDeleted}
      showTimestamps={showTimestamps}
      showPlatform={false}
      searchTerms={search[source.id] ?? EMPTY_TERMS}
      searchDraft={searchDraft[source.id] ?? ''}
      onSearchTerms={(terms) => setSearch(source.id, terms)}
      onSearchDraft={(draft) => setSearchDraft(source.id, draft)}
      onAddSearchTerm={(term) => addSearchTerm(source.id, term)}
      fontSize={fontSize[source.id] ?? CHAT_FONT_DEFAULT}
      onFontStep={(steps) => stepFontSize(source.id, steps)}
      onFontReset={() => resetFontSize(source.id)}
      onClear={() => clearSource(source.id)}
    />
  )

  return (
    <Layout style={{ height: '100%' }}>
      <TitleBar />

      {sources.length === 0 ? (
        <Flex flex={1} align="center" justify="center">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No channels yet. Add one by name, or paste its link."
          >
            <Button type="primary" icon={<Plus size={16} />} onClick={() => setAdding(true)}>
              Add a channel
            </Button>
          </Empty>
        </Flex>
      ) : (
        <Flex vertical style={{ flex: 1, minHeight: 0 }}>
          <ChannelTabs
            sources={sources}
            visibleIds={visibleIds}
            onAdd={() => setAdding(true)}
            onRemove={remove}
            onReorder={reorder}
          />

          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            {panes.length === 1 ? (
              renderPane(panes[0])
            ) : (
              <Splitter style={{ height: '100%', width: '100%' }}>
                {panes.map((source) => (
                  <Splitter.Panel key={source.id} min={220}>
                    {renderPane(source)}
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
        centered
        styles={{ wrapper: { paddingBottom: '20vh' } }}
        destroyOnHidden
      >
        <AddChannel onAdded={() => setAdding(false)} />
      </Modal>
    </Layout>
  )
}
