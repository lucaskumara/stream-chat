export interface YtThumbnail {
  url: string
  width?: number
  height?: number
}

export interface YtEmoji {
  emojiId?: string
  shortcuts?: string[]
  isCustomEmoji?: boolean
  image?: { thumbnails?: YtThumbnail[] }
}

export interface YtRun {
  text?: string
  emoji?: YtEmoji
  navigationEndpoint?: {
    urlEndpoint?: { url?: string }
    browseEndpoint?: { browseId?: string }
    commandMetadata?: { webCommandMetadata?: { url?: string } }
  }
}

export interface YtText {
  simpleText?: string
  runs?: YtRun[]
}

export interface YtAuthorBadge {
  liveChatAuthorBadgeRenderer?: {
    customThumbnail?: { thumbnails?: YtThumbnail[] }
    icon?: { iconType?: string }
    tooltip?: string
  }
}

export interface YtChatRenderer {
  id?: string
  timestampUsec?: string
  authorName?: YtText
  authorExternalChannelId?: string
  authorBadges?: YtAuthorBadge[]
  message?: YtText
  purchaseAmountText?: YtText
  headerPrimaryText?: YtText
  headerSubtext?: YtText
  primaryText?: YtText
  text?: YtText
  header?: { liveChatSponsorshipsHeaderRenderer?: YtChatRenderer }
}

export type YtChatItem = Record<string, YtChatRenderer | undefined>

export interface YtAction {
  addChatItemAction?: { item?: YtChatItem }
  markChatItemAsDeletedAction?: { targetItemId?: string }
  removeChatItemAction?: { targetItemId?: string }
  markChatItemsByAuthorAsDeletedAction?: { externalChannelId?: string }
  removeChatItemByAuthorAction?: { externalChannelId?: string }
}

export interface YtContinuationData {
  continuation?: string
  timeoutMs?: number
}

export interface YtContinuation {
  invalidationContinuationData?: YtContinuationData
  timedContinuationData?: YtContinuationData
  reloadContinuationData?: YtContinuationData
}

export interface YtLiveChatResponse {
  continuationContents?: {
    liveChatContinuation?: {
      actions?: YtAction[]
      continuations?: YtContinuation[]
    }
  }
}

export interface YtLiveChatRenderer {
  continuations?: YtContinuation[]
  header?: {
    liveChatHeaderRenderer?: {
      viewSelector?: {
        sortFilterSubMenuRenderer?: {
          subMenuItems?: { title?: string; continuation?: YtContinuation }[]
        }
      }
    }
  }
}

export interface YtInitialData {
  contents?: {
    liveChatRenderer?: YtLiveChatRenderer
    twoColumnWatchNextResults?: {
      conversationBar?: { liveChatRenderer?: YtLiveChatRenderer }
    }
  }
}

export interface YtPlayerResponse {
  playabilityStatus?: { status?: string; reason?: string }
  videoDetails?: {
    videoId?: string
    title?: string
    author?: string
    channelId?: string
    isLive?: boolean
    isLiveContent?: boolean
  }
}
