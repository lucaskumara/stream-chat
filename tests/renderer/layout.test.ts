import { describe, expect, it } from 'vitest'
import type { Platform, SourceState } from '@shared/types'
import { chatColumns, columnLabel, columnPaneId } from '@/layout'

function source(id: string, platform: Platform, label = id): SourceState {
  return { id, platform, label, status: 'connected' }
}

const keys = (columns: ReturnType<typeof chatColumns>): string[] =>
  columns.map((column) => column.key)

describe('chatColumns split', () => {
  it('gives every visible platform a column of its own', () => {
    const columns = chatColumns(
      ['twitch', 'kick'],
      [source('src-1', 'twitch'), source('src-2', 'kick')],
      false
    )

    expect(keys(columns)).toEqual(['twitch', 'kick'])
    expect(columns[0].sources).toHaveLength(1)
  })

  // A column with no sources is the connect form, which is the only route to a channel.
  it('leaves a platform with no channel an empty column', () => {
    const columns = chatColumns(['twitch', 'youtube'], [source('src-1', 'twitch')], false)

    expect(columns[1]).toEqual({ key: 'youtube', platform: 'youtube', sources: [] })
  })
})

describe('chatColumns merged', () => {
  it('collapses the connected chats into one column', () => {
    const columns = chatColumns(
      ['twitch', 'youtube', 'kick'],
      [source('src-1', 'twitch'), source('src-2', 'youtube'), source('src-3', 'kick')],
      true
    )

    expect(keys(columns)).toEqual(['merged'])
    expect(columns[0].sources).toHaveLength(3)
    expect(columns[0].platform).toBeNull()
  })

  // Merging is a viewing mode over connected chats; a form has nowhere else to go.
  it('keeps a column for each platform still waiting to connect', () => {
    const columns = chatColumns(
      ['twitch', 'youtube', 'kick'],
      [source('src-1', 'twitch'), source('src-3', 'kick')],
      true
    )

    expect(keys(columns)).toEqual(['merged', 'youtube'])
  })

  it('is only the forms when nothing is connected', () => {
    const columns = chatColumns(['twitch', 'kick'], [], true)

    expect(keys(columns)).toEqual(['twitch', 'kick'])
  })

  // The merged column keeps the chats in tab order, not the order they connected.
  it('merges in tab order', () => {
    const columns = chatColumns(
      ['twitch', 'youtube'],
      [source('src-2', 'youtube', 'Lofi Girl'), source('src-1', 'twitch', 'xQc')],
      true
    )

    expect(columnLabel(columns[0])).toBe('xQc · Lofi Girl')
  })
})

describe('columnPaneId', () => {
  it('keys a single chat on its source id', () => {
    const [column] = chatColumns(['twitch'], [source('src-1', 'twitch')], false)

    expect(columnPaneId(column)).toBe('src-1')
  })

  it('keys the merged column on a literal, so its state survives toggling', () => {
    const [column] = chatColumns(
      ['twitch', 'kick'],
      [source('src-1', 'twitch'), source('src-2', 'kick')],
      true
    )

    expect(columnPaneId(column)).toBe('merged')
  })
})
