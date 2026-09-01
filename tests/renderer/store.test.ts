import { beforeEach, describe, expect, it } from 'vitest'
import type { ChatMessage, SourceState } from '@shared/types'
import { CHAT_FONT_DEFAULT, CHAT_FONT_SIZES, useStore } from '@/store'

const pristine = useStore.getState()

function source(id: string, label = id, platform: SourceState['platform'] = 'twitch'): SourceState {
  return { id, platform, label, status: 'connected' }
}

function message(id: string, sourceId = 'src-1', authorId = 'author-1'): ChatMessage {
  return {
    id,
    sourceId,
    platform: 'twitch',
    kind: 'chat',
    authorId,
    authorName: 'someone',
    fragments: [{ kind: 'text', text: id }],
    plainText: id,
    timestamp: 0
  }
}

const state = (): ReturnType<typeof useStore.getState> => useStore.getState()

beforeEach(() => useStore.setState(pristine, true))

describe('setSources', () => {
  // The connect form would otherwise sit over a live chat after a renderer crash,
  // since the store comes back empty while main still holds the source.
  it('adopts every platform main already has on a cold start', () => {
    state().setSources([source('src-1', 'lofi', 'youtube'), source('src-2', 'xqc', 'kick')])

    expect(state().visiblePlatforms).toEqual(['youtube', 'kick'])
  })

  // A status event on one platform must not pull the user off the form they are
  // typing into on another.
  it('leaves the tabs alone once the list is known', () => {
    state().setSources([source('src-1')])
    state().togglePlatform('kick')

    state().setSources([source('src-1'), source('src-2', 'someone', 'youtube')])

    expect(state().visiblePlatforms).toEqual(['twitch', 'kick'])
  })

  it('keeps the tabs when main has nothing yet', () => {
    state().setSources([])

    expect(state().visiblePlatforms).toEqual(['twitch'])
  })
})

describe('togglePlatform', () => {
  it('puts a platform on screen alongside the others', () => {
    state().togglePlatform('kick')

    expect(state().visiblePlatforms).toEqual(['twitch', 'kick'])
  })

  // Panes run in tab order, not the order they were switched on, so a split reads
  // left to right the same as the strip above it.
  it('orders panes by the tab strip rather than by click order', () => {
    state().togglePlatform('kick')
    state().togglePlatform('youtube')

    expect(state().visiblePlatforms).toEqual(['twitch', 'youtube', 'kick'])
  })

  it('takes a platform back off screen', () => {
    state().togglePlatform('kick')

    state().togglePlatform('kick')

    expect(state().visiblePlatforms).toEqual(['twitch'])
  })

  it('refuses to empty the view', () => {
    state().togglePlatform('twitch')

    expect(state().visiblePlatforms).toEqual(['twitch'])
  })

  // A tab with no channel shows its connect form, which is the only route to one.
  it('switches on a platform that has no channel', () => {
    state().setSources([source('src-1')])

    state().togglePlatform('youtube')

    expect(state().visiblePlatforms).toEqual(['twitch', 'youtube'])
  })

  // Picking a platform implies the Chat view, from Broadcast or Settings alike.
  it('returns to the chat view', () => {
    state().setView('settings')

    state().togglePlatform('youtube')

    expect(state().view).toBe('chats')
  })

  it('returns to the chat view even when the toggle is refused', () => {
    state().setView('settings')

    state().togglePlatform('twitch')

    expect(state().view).toBe('chats')
    expect(state().visiblePlatforms).toEqual(['twitch'])
  })
})

describe('setConnectDraft', () => {
  it('keeps a half-typed name per platform', () => {
    state().setConnectDraft('twitch', 'theburntpea')
    state().setConnectDraft('kick', 'xqc')

    expect(state().connectDraft.twitch).toBe('theburntpea')
    expect(state().connectDraft.kick).toBe('xqc')
  })

  it('does not churn the state when nothing changed', () => {
    state().setConnectDraft('twitch', 'xqc')
    const before = state().connectDraft

    state().setConnectDraft('twitch', 'xqc')

    expect(state().connectDraft).toBe(before)
  })
})

describe('setCapacity', () => {
  it('trims what is already held down to the new capacity', () => {
    state().ingest({
      messages: [message('a'), message('b'), message('c')],
      moderation: []
    })

    state().setCapacity(2)

    expect(state().bySource['src-1'].map((held) => held.id)).toEqual(['b', 'c'])
  })

  it('caps every later batch at the new capacity', () => {
    state().setCapacity(2)

    state().ingest({
      messages: [message('a'), message('b'), message('c')],
      moderation: []
    })

    expect(state().bySource['src-1'].map((held) => held.id)).toEqual(['b', 'c'])
  })

  it('leaves a source shorter than the capacity alone', () => {
    state().ingest({ messages: [message('a')], moderation: [] })

    state().setCapacity(200)

    expect(state().bySource['src-1'].map((held) => held.id)).toEqual(['a'])
  })
})

describe('ingest', () => {
  it('files messages under their own source', () => {
    state().ingest({
      messages: [message('a', 'src-1'), message('b', 'src-2')],
      moderation: []
    })

    expect(state().bySource['src-1']?.map((held) => held.id)).toEqual(['a'])
    expect(state().bySource['src-2']?.map((held) => held.id)).toEqual(['b'])
  })

  it('appends to what a source already holds', () => {
    state().ingest({ messages: [message('a')], moderation: [] })
    state().ingest({ messages: [message('b')], moderation: [] })

    expect(state().bySource['src-1']?.map((held) => held.id)).toEqual(['a', 'b'])
  })

  it('changes nothing for an empty batch', () => {
    const before = state().bySource

    state().ingest({ messages: [], moderation: [] })

    expect(state().bySource).toBe(before)
  })

  it('keeps five hundred messages per source, evicting from the front', () => {
    state().ingest({
      messages: Array.from({ length: 600 }, (_, at) => message(`m${at}`)),
      moderation: []
    })

    const held = state().bySource['src-1']

    expect(held).toHaveLength(500)
    expect(held?.[0]?.id).toBe('m100')
  })

  it('marks a deleted message rather than removing it', () => {
    state().ingest({ messages: [message('a')], moderation: [] })
    state().ingest({
      messages: [],
      moderation: [{ type: 'delete-message', sourceId: 'src-1', messageId: 'a' }]
    })

    expect(state().bySource['src-1']).toHaveLength(1)
    expect(state().deleted['a']).toBe(true)
  })

  it('marks every message a cleared user sent', () => {
    state().ingest({
      messages: [message('a', 'src-1', 'troll'), message('b', 'src-1', 'regular')],
      moderation: []
    })
    state().ingest({
      messages: [],
      moderation: [{ type: 'clear-user', sourceId: 'src-1', userId: 'troll' }]
    })

    expect(state().deleted['a']).toBe(true)
    expect(state().deleted['b']).toBeUndefined()
  })

  it('empties the source on a chat clear', () => {
    state().ingest({ messages: [message('a')], moderation: [] })
    state().ingest({
      messages: [],
      moderation: [{ type: 'clear-chat', sourceId: 'src-1' }]
    })

    expect(state().bySource['src-1']).toEqual([])
  })

  it('applies a clear-user against messages that arrived in the same batch', () => {
    state().ingest({
      messages: [message('a', 'src-1', 'troll')],
      moderation: [{ type: 'clear-user', sourceId: 'src-1', userId: 'troll' }]
    })

    expect(state().deleted['a']).toBe(true)
  })

  it('leaves the strike set untouched when a batch carries no moderation', () => {
    state().ingest({
      messages: [],
      moderation: [{ type: 'delete-message', sourceId: 'src-1', messageId: 'a' }]
    })
    const before = state().deleted

    state().ingest({ messages: [message('b')], moderation: [] })

    expect(state().deleted).toBe(before)
  })
})

describe('search', () => {
  it('holds terms per source', () => {
    state().setSearch('src-1', ['a'])
    state().setSearch('src-2', ['b'])

    expect(state().search).toEqual({ 'src-1': ['a'], 'src-2': ['b'] })
  })

  it('holds a half-typed draft per source', () => {
    state().setSearchDraft('src-1', 'part')

    expect(state().searchDraft['src-1']).toBe('part')
  })

  it('changes nothing when the draft is already what it is being set to', () => {
    state().setSearchDraft('src-1', 'part')
    const before = state().searchDraft

    state().setSearchDraft('src-1', 'part')

    expect(state().searchDraft).toBe(before)
  })

  it('appends a clicked author name', () => {
    state().addSearchTerm('src-1', 'author:xqc')

    expect(state().search['src-1']).toEqual(['author:xqc'])
  })

  it('does not stack the same name twice, whatever its case', () => {
    state().addSearchTerm('src-1', 'author:xqc')
    state().addSearchTerm('src-1', 'author:XQC')

    expect(state().search['src-1']).toEqual(['author:xqc'])
  })
})

describe('font size', () => {
  it('starts unset, which reads as the default', () => {
    expect(state().fontSize['src-1']).toBeUndefined()
  })

  it('steps up and down the scale by index', () => {
    const at = CHAT_FONT_SIZES.indexOf(CHAT_FONT_DEFAULT)

    state().stepFontSize('src-1', 1)
    expect(state().fontSize['src-1']).toBe(CHAT_FONT_SIZES[at + 1])

    state().stepFontSize('src-1', -1)
    expect(state().fontSize['src-1']).toBe(CHAT_FONT_DEFAULT)
  })

  it('stops at each end of the scale', () => {
    state().stepFontSize('src-1', 100)
    expect(state().fontSize['src-1']).toBe(CHAT_FONT_SIZES[CHAT_FONT_SIZES.length - 1])

    state().stepFontSize('src-1', -100)
    expect(state().fontSize['src-1']).toBe(CHAT_FONT_SIZES[0])
  })

  it('sizes each pane on its own', () => {
    state().stepFontSize('src-1', 1)

    expect(state().fontSize['src-2']).toBeUndefined()
  })

  // Unset and explicitly-default have to stay the same state, so reset deletes the
  // entry rather than writing the default back.
  it('forgets the entry on reset rather than storing the default', () => {
    state().stepFontSize('src-1', 1)
    state().resetFontSize('src-1')

    expect('src-1' in state().fontSize).toBe(false)
  })
})

describe('clearSource', () => {
  it('empties one pane and leaves the rest', () => {
    state().ingest({
      messages: [message('a', 'src-1'), message('b', 'src-2')],
      moderation: []
    })

    state().clearSource('src-1')

    expect(state().bySource['src-1']).toEqual([])
    expect(state().bySource['src-2']).toHaveLength(1)
  })

  it('changes nothing for a pane that is already empty', () => {
    const before = state().bySource

    state().clearSource('src-1')

    expect(state().bySource).toBe(before)
  })
})

describe('forgetSource', () => {
  it('drops the messages, the search, the draft and the font size together', () => {
    state().ingest({ messages: [message('a')], moderation: [] })
    state().setSearch('src-1', ['a'])
    state().setSearchDraft('src-1', 'part')
    state().stepFontSize('src-1', 1)

    state().forgetSource('src-1')

    expect('src-1' in state().bySource).toBe(false)
    expect('src-1' in state().search).toBe(false)
    expect('src-1' in state().searchDraft).toBe(false)
    expect('src-1' in state().fontSize).toBe(false)
  })

  it('closes the filter and settings for that pane', () => {
    state().setSources([source('src-1'), source('src-2')])
    state().toggleFilter('src-2')
    state().toggleGear('src-2')

    state().forgetSource('src-2')

    expect('src-2' in state().filterOpen).toBe(false)
    expect(state().gearOpenFor).toBeNull()
  })

  it('leaves other sources alone', () => {
    state().ingest({ messages: [message('b', 'src-2')], moderation: [] })

    state().forgetSource('src-1')

    expect(state().bySource['src-2']).toHaveLength(1)
  })
})

describe('display options', () => {
  it('starts with both on', () => {
    expect(state().showTimestamps).toBe(true)
    expect(state().showDeleted).toBe(true)
  })

  // Both are app-wide, not per source: the pane bar's popover offers them to every chat.
  it('toggles timestamps and deleted messages independently', () => {
    state().setShowTimestamps(false)

    expect(state().showTimestamps).toBe(false)
    expect(state().showDeleted).toBe(true)

    state().setShowDeleted(false)
    state().setShowTimestamps(true)

    expect(state().showTimestamps).toBe(true)
    expect(state().showDeleted).toBe(false)
  })
})
