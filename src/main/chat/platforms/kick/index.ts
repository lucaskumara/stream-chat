import type { Badge, ChatMessage, Fragment, Platform } from "@shared/types";
import {
  BaseChatWatcher,
  messageId,
  type ChatFeed,
  type FeedSink,
  withEmotes,
} from "../../watcher";
import type { ChannelLookup, RetryPolicy } from "../../channel";
import { splitLinks } from "../../links";
import { plainTextOf, REPLY_EXCERPT_LIMIT } from "../../fragments";
import { resolveChannel, type KickChannel } from "./channel";
import { kickSocket } from "./connection";

const EVENT = {
  chatMessage: "App\\Events\\ChatMessageEvent",
  messageDeleted: "App\\Events\\MessageDeletedEvent",
  userBanned: "App\\Events\\UserBannedEvent",
  chatroomCleared: "App\\Events\\ChatroomClearEvent",
} as const;

const EMOTE_TOKEN = /\[emote:(\d+):([^\]]*)\]/g;
const EMOTE_CDN = "https://files.kick.com/emotes";

interface KickBadge {
  type?: string;
  text?: string;
  count?: number;
}

interface KickBadgeV2 {
  name?: string;
  image_url?: string;
  selected?: boolean;
}

interface ChatMessageEvent {
  id?: string;
  content?: string;
  created_at?: string;
  sender?: {
    id?: number;
    username?: string;
    identity?: {
      color?: string;
      badges?: KickBadge[];
      badges_v2?: KickBadgeV2[];
    } | null;
  };
  metadata?: {
    original_sender?: { username?: string };
    original_message?: { id?: string; content?: string };
  } | null;
}

interface MessageDeletedEvent {
  message?: { id?: string };
}

interface UserBannedEvent {
  user?: { id?: number };
}

export class KickChatWatcher extends BaseChatWatcher<KickChannel> {
  readonly platform: Platform = "kick";

  protected readonly retry: RetryPolicy = {
    offlineMs: 30_000,
    errorMs: 30_000,
    jitterMs: 10_000,
  };

  protected resolve(identifier: string): Promise<ChannelLookup<KickChannel>> {
    return resolveChannel(identifier);
  }

  protected createFeed(channel: KickChannel, sink: FeedSink): ChatFeed {
    return new KickChatFeed(this.sourceId, channel, sink);
  }
}

class KickChatFeed implements ChatFeed {
  private leaveRoom: (() => void) | null = null;

  constructor(
    private readonly sourceId: string,
    private readonly channel: KickChannel,
    private readonly sink: FeedSink,
  ) {}

  start(): void {
    this.leaveRoom = kickSocket.join(this.channel.room, (event, payload) =>
      this.route(event, payload),
    );
  }

  stop(): void {
    this.leaveRoom?.();
    this.leaveRoom = null;
  }

  private route(event: string, payload: unknown): void {
    switch (event) {
      case EVENT.chatMessage:
        return this.publishMessage(payload as ChatMessageEvent);

      case EVENT.messageDeleted:
        return this.publishDeletion(payload as MessageDeletedEvent);

      case EVENT.userBanned:
        return this.publishBan(payload as UserBannedEvent);

      case EVENT.chatroomCleared:
        return this.sink.moderation({
          type: "clear-chat",
          sourceId: this.sourceId,
        });
    }
  }

  private publishMessage(event: ChatMessageEvent): void {
    const message = toChatMessage(event, this.sourceId, this.channel);
    if (message) this.sink.message(withEmotes(message, this.channel));
  }

  private publishDeletion(event: MessageDeletedEvent): void {
    const deletedId = event.message?.id;
    if (!deletedId) return;

    this.sink.moderation({
      type: "delete-message",
      sourceId: this.sourceId,
      messageId: messageId("kick", this.sourceId, deletedId),
    });
  }

  private publishBan(event: UserBannedEvent): void {
    const userId = event.user?.id;
    if (userId === undefined) return;

    this.sink.moderation({
      type: "clear-user",
      sourceId: this.sourceId,
      userId: String(userId),
    });
  }
}

function toChatMessage(
  event: ChatMessageEvent,
  sourceId: string,
  channel: KickChannel,
): ChatMessage | null {
  const eventId = event.id;
  const sender = event.sender;

  if (!eventId || !sender?.username) return null;

  const fragments = toFragments(event.content ?? "");

  const message: ChatMessage = {
    id: messageId("kick", sourceId, eventId),
    sourceId,
    platform: "kick",
    kind: "chat",
    authorId: sender.id === undefined ? sender.username : String(sender.id),
    authorName: sender.username,
    fragments,
    plainText: plainTextOf(fragments),
    timestamp: toTimestamp(event.created_at),
  };

  const identity = sender.identity;

  if (identity?.color) message.authorColor = identity.color;

  const badges = toBadges(identity, channel);
  if (badges.length > 0) message.badges = badges;

  const reply = toReply(event, sourceId);
  if (reply) message.replyTo = reply;

  return message;
}

function toBadges(
  identity: NonNullable<ChatMessageEvent["sender"]>["identity"],
  channel: KickChannel,
): Badge[] {
  const badges: Badge[] = [];

  for (const badge of identity?.badges ?? []) {
    if (!badge.type) continue;

    badges.push(
      badge.type === "subscriber"
        ? channel.subscriberBadge(badge.count ?? 1)
        : { label: badge.text ?? badge.type },
    );
  }

  for (const badge of identity?.badges_v2 ?? []) {
    if (!badge.selected || !badge.image_url) continue;

    badges.push({ label: badge.name ?? "", url: badge.image_url });
  }

  return badges;
}

export function toFragments(content: string): Fragment[] {
  const fragments: Fragment[] = [];
  let cursor = 0;

  for (const match of content.matchAll(EMOTE_TOKEN)) {
    const start = match.index ?? 0;

    if (start > cursor)
      fragments.push(...splitLinks(content.slice(cursor, start)));

    fragments.push({
      kind: "emote",
      name: match[2] ?? "",
      url: `${EMOTE_CDN}/${match[1]}/fullsize`,
      provider: "native",
    });

    cursor = start + match[0].length;
  }

  if (cursor < content.length)
    fragments.push(...splitLinks(content.slice(cursor)));

  return fragments.filter(
    (fragment) => fragment.kind !== "text" || fragment.text.length > 0,
  );
}

function toReply(
  event: ChatMessageEvent,
  sourceId: string,
): ChatMessage["replyTo"] {
  const original = event.metadata?.original_message;
  const author = event.metadata?.original_sender?.username;

  if (!original?.id || !author) return undefined;

  return {
    messageId: messageId("kick", sourceId, original.id),
    authorName: author,
    excerpt: (original.content ?? "").slice(0, REPLY_EXCERPT_LIMIT),
  };
}

function toTimestamp(createdAt: string | undefined): number {
  const parsed = createdAt ? Date.parse(createdAt) : Number.NaN;

  return Number.isNaN(parsed) ? Date.now() : parsed;
}
