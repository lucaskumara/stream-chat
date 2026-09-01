import { type Platform, type SourceState } from '@shared/types'

export interface ChatColumn {
  key: string

  /** The platform whose connect form this column shows, or null for the merged
      column. A column with sources renders those; one without renders the form. */
  platform: Platform | null
  sources: SourceState[]
}

const MERGED_KEY = 'merged'

/** The one place the column model is derived, so the title bar's layout icon counts
    exactly what the view renders. Merging collapses the connected chats into a single
    column, but a visible platform with no channel keeps its own either way — its
    connect form would otherwise have nowhere to go. */
export function chatColumns(
  visiblePlatforms: Platform[],
  sources: SourceState[],
  merged: boolean
): ChatColumn[] {
  const held = (platform: Platform): SourceState | undefined =>
    sources.find((source) => source.platform === platform)

  if (!merged) {
    return visiblePlatforms.map((platform) => {
      const source = held(platform)

      return { key: platform, platform, sources: source ? [source] : [] }
    })
  }

  const connected: SourceState[] = []
  const waiting: ChatColumn[] = []

  for (const platform of visiblePlatforms) {
    const source = held(platform)

    if (source) connected.push(source)
    else waiting.push({ key: platform, platform, sources: [] })
  }

  if (connected.length === 0) return waiting

  return [{ key: MERGED_KEY, platform: null, sources: connected }, ...waiting]
}

export function columnLabel(column: ChatColumn): string {
  return column.sources.map((source) => source.label).join(' · ')
}

/** Split panes key their search, filter, font size and popover on the source id; the
    merged one keys on a literal, so its state is its own and survives toggling. */
export function columnPaneId(column: ChatColumn): string {
  return column.sources.length === 1 ? column.sources[0].id : MERGED_KEY
}
