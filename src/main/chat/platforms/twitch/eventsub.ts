import WebSocket from "ws";
import type { Badge, ChatMessage, Fragment, MessageKind } from "@shared/types";
import { reconnectDelayMs } from "../../backoff";
import { messageId, type ChatFeed, type FeedSink } from "../../watcher";
import { splitLinks } from "../../links";
import { ignoreTeardownFailure } from "../../../lifecycle";
import type { TwitchAuth } from "../../../twitch/auth";
import type { Helix } from "../../../twitch/helix";
import { twitchBadges } from "./badges";
import type { TwitchChannel } from "./channel";

const DEFAULT_URL = "wss://eventsub.wss.twitch.tv/ws";

const KEEPALIVE_GRACE_MS = 15_000;

export interface SubscriptionRequest {
  type: string;
  version: string;
  condition: Record<string, string>;
}

export type EventHandler = (
  subscriptionType: string,
  event: Record<string, unknown>,
) => void;

interface Registration {
  id: string;
  requests: SubscriptionRequest[];
  handler: EventHandler;

  remoteIds: string[];
}

interface WelcomeMessage {
  metadata: { message_type: string; subscription_type?: string };
  payload: {
    session?: {
      id: string;
      keepalive_timeout_seconds: number;
      reconnect_url?: string;
    };
    subscription?: { type: string };
    event?: Record<string, unknown>;
  };
}

type HubStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error";

export class EventSubHub {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private registrations = new Map<string, Registration>();
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private status: HubStatus = "idle";
  private closing = false;
  private keepaliveSeconds = 10;

  constructor(
    private helix: Helix,
    private onStatus: (status: HubStatus, error?: string) => void,
  ) {}

  async register(
    id: string,
    requests: SubscriptionRequest[],
    handler: EventHandler,
  ): Promise<void> {
    this.registrations.set(id, { id, requests, handler, remoteIds: [] });

    if (!this.ws) {
      await this.connect();
      return;
    }
    if (this.sessionId)
      await this.subscribeFor(this.registrations.get(id) as Registration);
  }

  async unregister(id: string): Promise<void> {
    const reg = this.registrations.get(id);
    if (!reg) return;
    this.registrations.delete(id);

    await Promise.all(
      reg.remoteIds.map((rid) =>
        this.helix
          .deleteEventSubSubscription(rid)
          .catch(ignoreTeardownFailure(`eventsub subscription ${rid}`)),
      ),
    );

    if (this.registrations.size === 0) this.shutdown();
  }

  private setStatus(status: HubStatus, error?: string): void {
    this.status = status;
    this.onStatus(status, error);
  }

  private connect(url = DEFAULT_URL): Promise<void> {
    return new Promise((resolve) => {
      this.closing = false;
      this.setStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");

      const ws = new WebSocket(url);
      this.ws = ws;

      ws.on("message", (raw: WebSocket.RawData) => {
        if (this.ws !== ws) return;
        void this.onMessage(raw.toString(), resolve);
      });

      ws.on("error", (err: Error) => {
        if (this.ws !== ws) return;
        this.setStatus("error", err.message);
      });

      ws.on("close", () => {
        if (this.ws !== ws) return;
        this.clearKeepalive();
        if (this.closing) return;
        this.scheduleReconnect();
        resolve();
      });
    });
  }

  private async onMessage(
    raw: string,
    resolveConnect: () => void,
  ): Promise<void> {
    let message: WelcomeMessage;
    try {
      message = JSON.parse(raw) as WelcomeMessage;
    } catch {
      return;
    }

    const negotiated = message.payload?.session?.keepalive_timeout_seconds;
    if (typeof negotiated === "number" && negotiated > 0)
      this.keepaliveSeconds = negotiated;
    this.armKeepalive();

    switch (message.metadata?.message_type) {
      case "session_welcome":
        return this.onWelcome(message, resolveConnect);
      case "notification":
        return this.onNotification(message);
      case "session_reconnect":
        return this.onReconnectRequested(message);
      case "revocation":
        return this.setStatus(
          "error",
          "Twitch revoked a subscription (token or permission changed).",
        );
      case "session_keepalive":
      default:
        return;
    }
  }

  private async onWelcome(
    message: WelcomeMessage,
    resolveConnect: () => void,
  ): Promise<void> {
    const session = message.payload.session;
    if (!session) return;
    this.sessionId = session.id;
    this.reconnectAttempt = 0;
    this.setStatus("connected");
    await this.subscribeAll();
    resolveConnect();
  }

  private onNotification(message: WelcomeMessage): void {
    const subscriptionType = message.payload.subscription?.type;
    const event = message.payload.event;
    if (!subscriptionType || !event) return;

    for (const registration of this.registrations.values()) {
      const request = registration.requests.find(
        (r) => r.type === subscriptionType,
      );
      if (!request) continue;

      const wanted = request.condition["broadcaster_user_id"];
      if (!wanted || wanted === event["broadcaster_user_id"]) {
        registration.handler(subscriptionType, event);
      }
    }
  }

  private async onReconnectRequested(message: WelcomeMessage): Promise<void> {
    const nextUrl = message.payload.session?.reconnect_url;
    if (!nextUrl) return;
    const previous = this.ws;
    await this.connect(nextUrl);
    previous?.close();
  }

  private armKeepalive(): void {
    this.clearKeepalive();
    const ms = this.keepaliveSeconds * 1000 + KEEPALIVE_GRACE_MS;
    this.keepaliveTimer = setTimeout(() => {
      this.ws?.terminate();
    }, ms);
  }

  private clearKeepalive(): void {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    this.keepaliveTimer = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.registrations.size === 0) return;

    this.reconnectAttempt++;
    this.setStatus("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.sessionId = null;
      void this.connect();
    }, reconnectDelayMs(this.reconnectAttempt));
  }

  private async subscribeAll(): Promise<void> {
    for (const reg of this.registrations.values()) {
      await this.subscribeFor(reg);
    }
  }

  private async subscribeFor(reg: Registration): Promise<void> {
    const sessionId = this.sessionId;
    if (!sessionId) return;

    reg.remoteIds = [];

    for (const req of reg.requests) {
      try {
        const id = await this.helix.createEventSubSubscription(
          req.type,
          req.version,
          req.condition,
          sessionId,
        );
        reg.remoteIds.push(id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        console.warn(`[eventsub] ${req.type} failed:`, message);
        this.setStatus("error", `${req.type}: ${message}`);
      }
    }
  }

  shutdown(): void {
    this.closing = true;
    this.clearKeepalive();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close();
    this.ws = null;
    this.sessionId = null;
    this.setStatus("idle");
  }

  getStatus(): HubStatus {
    return this.status;
  }
}

const EMOTE_CDN = "https://static-cdn.jtvnw.net/emoticons/v2";

interface TwitchFragment {
  type: "text" | "cheermote" | "emote" | "mention";
  text: string;
  emote?: {
    id: string;
    emote_set_id?: string;
    owner_id?: string;
    format?: string[];
  } | null;
  mention?: { user_id: string; user_login: string; user_name: string } | null;
  cheermote?: { prefix: string; bits: number; tier: number } | null;
}

interface TwitchBadge {
  set_id: string;
  id: string;
}

interface TwitchChatEvent {
  broadcaster_user_id: string;
  chatter_user_id: string;
  chatter_user_login: string;
  chatter_user_name: string;
  message_id: string;
  message: { text: string; fragments: TwitchFragment[] };
  message_type?: string;
  color?: string | null;
  badges?: TwitchBadge[] | null;
  cheer?: { bits: number } | null;
  reply?: {
    parent_message_id: string;
    parent_message_body: string;
    parent_user_name: string;
  } | null;
}

function emoteUrls(
  id: string,
  formats: string[] | undefined,
): { url: string; srcSet: string } {
  const format = formats?.includes("animated") ? "animated" : "static";
  const at = (scale: string): string =>
    `${EMOTE_CDN}/${id}/${format}/dark/${scale}`;
  return {
    url: at("1.0"),
    srcSet: `${at("1.0")} 1x, ${at("2.0")} 2x, ${at("3.0")} 3x`,
  };
}

function toFragments(fragments: TwitchFragment[]): Fragment[] {
  const out: Fragment[] = [];

  for (const frag of fragments) {
    switch (frag.type) {
      case "emote": {
        if (!frag.emote) break;
        const { url, srcSet } = emoteUrls(frag.emote.id, frag.emote.format);
        out.push({
          kind: "emote",
          name: frag.text,
          url,
          srcSet,
          provider: "native",
        });
        continue;
      }
      case "mention": {
        out.push({
          kind: "mention",
          text: frag.text,
          ...(frag.mention ? { userId: frag.mention.user_id } : {}),
        });
        continue;
      }
      case "cheermote": {
        out.push({ kind: "text", text: frag.text });
        continue;
      }
    }
    out.push(...splitLinks(frag.text));
  }

  return out;
}

function toKind(event: TwitchChatEvent): MessageKind {
  if (event.cheer && event.cheer.bits > 0) return "donation";
  switch (event.message_type) {
    case "channel_points_highlighted":
    case "power_ups_message_effect":
    case "power_ups_gigantified_emote":
      return "announcement";
    case "user_intro":
      return "announcement";
    default:
      return "chat";
  }
}

function badgesFor(channelLogin: string, badges: TwitchBadge[]): Badge[] {
  return badges.map(
    (badge) =>
      twitchBadges.lookup(channelLogin, badge.set_id, badge.id) ?? {
        label: badge.set_id,
      },
  );
}

function normalizeChatMessage(
  event: TwitchChatEvent,
  sourceId: string,
  channelLogin: string,
): ChatMessage {
  const msg: ChatMessage = {
    id: messageId("twitch", sourceId, event.message_id),
    sourceId,
    platform: "twitch",
    kind: toKind(event),
    authorId: event.chatter_user_id,
    authorName: event.chatter_user_login,
    authorDisplayName: event.chatter_user_name,
    fragments: toFragments(event.message.fragments ?? []),
    plainText: event.message.text ?? "",

    timestamp: Date.now(),
  };

  if (event.color) msg.authorColor = event.color;

  const badges = badgesFor(channelLogin, event.badges ?? []);
  if (badges.length > 0) msg.badges = badges;

  if (event.reply) {
    msg.replyTo = {
      messageId: messageId("twitch", sourceId, event.reply.parent_message_id),
      authorName: event.reply.parent_user_name,
      excerpt: event.reply.parent_message_body.slice(0, 60),
    };
  }

  if (event.cheer && event.cheer.bits > 0) {
    msg.monetary = { amount: event.cheer.bits, currency: "bits" };
  }

  return msg;
}

function buildSubscriptions(
  broadcasterId: string,
  viewerId: string,
): SubscriptionRequest[] {
  const condition = { broadcaster_user_id: broadcasterId, user_id: viewerId };

  return [
    { type: "channel.chat.message", version: "1", condition },
    { type: "channel.chat.message_delete", version: "1", condition },
    { type: "channel.chat.clear_user_messages", version: "1", condition },
    { type: "channel.chat.clear", version: "1", condition },
  ];
}

export class TwitchEventSubFeed implements ChatFeed {
  private registered = false;

  constructor(
    private readonly sourceId: string,
    private readonly channel: TwitchChannel,
    private readonly sink: FeedSink,
    private readonly hub: EventSubHub,
    private readonly auth: TwitchAuth,
  ) {}

  async start(): Promise<void> {
    twitchBadges.load(this.channel.login);

    const viewerId = this.auth.getTokens()?.userId;

    if (!viewerId) {
      this.sink.failed("Twitch session is missing a user id. Sign in again.");
      return;
    }

    try {
      await this.hub.register(
        this.sourceId,
        buildSubscriptions(this.channel.broadcasterId, viewerId),
        (type, event) => this.route(type, event),
      );
      this.registered = true;
    } catch (error) {
      this.sink.failed(error instanceof Error ? error.message : String(error));
    }
  }

  stop(): void {
    if (!this.registered) return;

    this.registered = false;
    void this.hub
      .unregister(this.sourceId)
      .catch(ignoreTeardownFailure(`eventsub registration ${this.sourceId}`));
  }

  private route(type: string, event: Record<string, unknown>): void {
    switch (type) {
      case "channel.chat.message":
        return this.publishMessage(event);

      case "channel.chat.message_delete":
        return this.publishDeletion(event);

      case "channel.chat.clear_user_messages":
        return this.publishUserCleared(event);

      case "channel.chat.clear":
        return this.sink.moderation({
          type: "clear-chat",
          sourceId: this.sourceId,
        });
    }
  }

  private publishMessage(event: Record<string, unknown>): void {
    this.sink.message(
      normalizeChatMessage(
        event as unknown as TwitchChatEvent,
        this.sourceId,
        this.channel.login,
      ),
    );
  }

  private publishDeletion(event: Record<string, unknown>): void {
    const deletedId = event["message_id"];
    if (typeof deletedId !== "string") return;

    this.sink.moderation({
      type: "delete-message",
      sourceId: this.sourceId,
      messageId: messageId("twitch", this.sourceId, deletedId),
    });
  }

  private publishUserCleared(event: Record<string, unknown>): void {
    const userId = event["target_user_id"];
    if (typeof userId !== "string") return;

    this.sink.moderation({
      type: "clear-user",
      sourceId: this.sourceId,
      userId,
    });
  }
}
