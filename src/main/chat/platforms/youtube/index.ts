import type { Helpers } from "youtubei.js";
import { YTNodes } from "youtubei.js";
import type {
  Badge,
  ChatMessage,
  Fragment,
  ModerationEvent,
  Platform,
} from "@shared/types";
import {
  BaseChatWatcher,
  PollingFeed,
  messageId,
  type ChatFeed,
  type FeedSink,
  type PollResult,
  withEmotes,
} from "../../watcher";
import type { ChannelLookup, RetryPolicy } from "../../channel";
import { splitLinks } from "../../links";
import { plainTextOf } from "../../fragments";
import { RecentIds } from "../../recent-ids";
import { resolveChannel, type YouTubeChannel } from "./channel";
import { innertube } from "./connection";

const UNFILTERED_VIEW = "Live chat";

const MIN_POLL_MS = 250;
const MAX_POLL_MS = 500;

const SEEN_LIMIT = 1000;

interface ChatContinuation {
  actions?: Helpers.YTNode[];
  header?: Helpers.YTNode;
  continuation?: { token?: string; timeout_ms?: number };
}

interface Thumbnail {
  url: string;
  width?: number;
}

interface EmojiRun {
  emoji?: {
    emoji_id?: string;
    shortcuts?: string[];
    is_custom?: boolean;
    image?: Thumbnail[];
  };
}

interface TextRun {
  text?: string;
}

interface AuthorBadge {
  tooltip?: string;
  label?: string;
  icon_type?: string;
  custom_thumbnail?: Thumbnail[];
}

export class YouTubeChatWatcher extends BaseChatWatcher<YouTubeChannel> {
  readonly platform: Platform = "youtube";

  protected readonly retry: RetryPolicy = {
    offlineMs: 120_000,
    errorMs: 120_000,
    jitterMs: 30_000,
  };

  protected resolve(
    identifier: string,
  ): Promise<ChannelLookup<YouTubeChannel>> {
    return resolveChannel(identifier);
  }

  protected createFeed(channel: YouTubeChannel, sink: FeedSink): ChatFeed {
    return new YouTubeChatFeed(this.sourceId, channel, sink);
  }
}

class YouTubeChatFeed extends PollingFeed {
  private continuation: string;
  private primed = false;

  private readonly seen = new RecentIds(SEEN_LIMIT);

  constructor(
    private readonly sourceId: string,
    private readonly channel: YouTubeChannel,
    sink: FeedSink,
  ) {
    super(sink);
    this.continuation = channel.continuation;
  }

  protected async poll(): Promise<PollResult> {
    const contents = await this.request();

    if (!contents?.continuation?.token) {
      return {
        messages: [],
        moderation: [],
        nextPollMs: MAX_POLL_MS,
        ended: true,
      };
    }

    this.continuation = contents.continuation.token;

    return this.primed ? this.collect(contents) : this.prime(contents);
  }

  private async request(): Promise<ChatContinuation | null> {
    const youtube = await innertube();

    const response = await youtube.actions.execute("live_chat/get_live_chat", {
      continuation: this.continuation,
      parse: true,
    });

    return (
      (response.continuation_contents as ChatContinuation | undefined) ?? null
    );
  }

  private prime(contents: ChatContinuation): PollResult {
    this.primed = true;

    const unfiltered = unfilteredToken(contents.header);
    if (unfiltered) this.continuation = unfiltered;

    for (const action of contents.actions ?? []) {
      const item = chatItem(action);
      if (item?.id) this.seen.add(item.id);
    }

    return {
      messages: [],
      moderation: [],
      nextPollMs: MIN_POLL_MS,
      ended: false,
    };
  }

  private collect(contents: ChatContinuation): PollResult {
    const messages: ChatMessage[] = [];
    const moderation: ModerationEvent[] = [];

    for (const action of contents.actions ?? []) {
      const removed = removedId(action);
      if (removed) {
        moderation.push({
          type: "delete-message",
          sourceId: this.sourceId,
          messageId: messageId("youtube", this.sourceId, removed),
        });
        continue;
      }

      const item = chatItem(action);
      if (!item?.id || this.seen.has(item.id)) continue;

      this.seen.add(item.id);

      const message = toChatMessage(item, this.sourceId);
      if (message) messages.push(withEmotes(message, this.channel));
    }

    return {
      messages,
      moderation,
      nextPollMs: clampPoll(contents.continuation?.timeout_ms ?? 0),
      ended: false,
    };
  }
}

function chatItem(action: Helpers.YTNode): YTNodes.LiveChatTextMessage | null {
  if (!action.is(YTNodes.AddChatItemAction)) return null;

  const item = action.as(YTNodes.AddChatItemAction).item;

  return item?.is(YTNodes.LiveChatTextMessage)
    ? item.as(YTNodes.LiveChatTextMessage)
    : null;
}

function removedId(action: Helpers.YTNode): string | null {
  if (!action.is(YTNodes.MarkChatItemAsDeletedAction)) return null;

  return action.as(YTNodes.MarkChatItemAsDeletedAction).target_item_id ?? null;
}

function unfilteredToken(header: Helpers.YTNode | undefined): string | null {
  if (!header?.is(YTNodes.LiveChatHeader)) return null;

  const items =
    header.as(YTNodes.LiveChatHeader).view_selector?.sub_menu_items ?? [];
  const view = items.find(
    (item: { title?: string }) => item.title === UNFILTERED_VIEW,
  );

  return view?.continuation ?? null;
}

export function clampPoll(timeoutMs: number): number {
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, timeoutMs || MAX_POLL_MS));
}

function toChatMessage(
  item: YTNodes.LiveChatTextMessage,
  sourceId: string,
): ChatMessage | null {
  const itemId = item.id;
  if (!itemId) return null;

  const fragments = toFragments(item);

  const message: ChatMessage = {
    id: messageId("youtube", sourceId, itemId),
    sourceId,
    platform: "youtube",
    kind: "chat",
    authorId: item.author?.id ?? "",
    authorName: item.author?.name?.toString() ?? "unknown",
    fragments,
    plainText: plainTextOf(fragments),
    timestamp: toTimestamp(item.timestamp),
  };

  const badges = toBadges(
    (item.author?.badges ?? []) as unknown as AuthorBadge[],
  );
  if (badges.length > 0) message.badges = badges;

  return message;
}

function scaledImage(
  thumbnails: Thumbnail[] | undefined,
): { url: string; srcSet: string } | null {
  const scales = [...(thumbnails ?? [])].sort(
    (a, b) => (a.width ?? 0) - (b.width ?? 0),
  );
  if (scales.length === 0) return null;

  return {
    url: scales[0]?.url ?? "",
    srcSet: scales
      .map((scale, index) => `${scale.url} ${index + 1}x`)
      .join(", "),
  };
}

function toBadges(authorBadges: AuthorBadge[]): Badge[] {
  return authorBadges.map((badge) => {
    const label = badge.tooltip ?? badge.label ?? badge.icon_type ?? "";
    const image = scaledImage(badge.custom_thumbnail);

    return image ? { label, ...image } : { label };
  });
}

function toFragments(item: YTNodes.LiveChatTextMessage): Fragment[] {
  const runs = (item.message?.runs ?? []) as unknown as (TextRun & EmojiRun)[];
  const fragments: Fragment[] = [];

  for (const run of runs) {
    if (run.emoji) {
      fragments.push(toEmojiFragment(run.emoji));
      continue;
    }

    fragments.push(...splitLinks(run.text ?? ""));
  }

  return mergeAdjacentText(fragments);
}

function toEmojiFragment(emoji: NonNullable<EmojiRun["emoji"]>): Fragment {
  const name = emoji.shortcuts?.[0] ?? emoji.emoji_id ?? "";
  const image = emoji.is_custom ? scaledImage(emoji.image) : null;

  if (!image) return { kind: "text", text: emoji.emoji_id ?? name };

  return { kind: "emote", name, ...image, provider: "native" };
}

function mergeAdjacentText(fragments: Fragment[]): Fragment[] {
  const merged: Fragment[] = [];

  for (const fragment of fragments) {
    const previous = merged[merged.length - 1];

    if (fragment.kind === "text" && previous?.kind === "text") {
      previous.text += fragment.text;
      continue;
    }

    merged.push(fragment);
  }

  return merged.filter(
    (fragment) => fragment.kind !== "text" || fragment.text.length > 0,
  );
}

function toTimestamp(timestamp: number | undefined): number {
  return Number.isFinite(timestamp) && (timestamp ?? 0) > 0
    ? (timestamp as number)
    : Date.now();
}
