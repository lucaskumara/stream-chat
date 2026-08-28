import type { Platform } from "@shared/types";
import {
  BaseChatWatcher,
  type ChatFeed,
  type ChatWatcherContext,
  type FeedSink,
} from "../../watcher";
import type { ChannelLookup, RetryPolicy } from "../../channel";
import type { TwitchAuth } from "../../../twitch/auth";
import type { Helix } from "../../../twitch/helix";
import { resolveChannel, type TwitchChannel } from "./channel";
import { EventSubHub, TwitchEventSubFeed } from "./eventsub";
import { IrcHub, TwitchIrcFeed } from "./irc";

export { EventSubHub } from "./eventsub";
export { IrcHub } from "./irc";

export interface TwitchServices {
  auth: TwitchAuth;
  helix: Helix;
  eventsub: EventSubHub;
  irc: IrcHub;
}

export class TwitchChatWatcher extends BaseChatWatcher<TwitchChannel> {
  readonly platform: Platform = "twitch";

  protected readonly retry: RetryPolicy = {
    offlineMs: 30_000,
    errorMs: 30_000,
    jitterMs: 10_000,
  };

  constructor(
    context: ChatWatcherContext,
    private readonly services: TwitchServices,
  ) {
    super(context);
  }

  protected resolve(identifier: string): Promise<ChannelLookup<TwitchChannel>> {
    return resolveChannel(identifier, this.services.auth, this.services.helix);
  }

  protected createFeed(channel: TwitchChannel, sink: FeedSink): ChatFeed {
    const { auth, eventsub, irc } = this.services;

    return auth.isSignedIn()
      ? new TwitchEventSubFeed(this.sourceId, channel, sink, eventsub, auth)
      : new TwitchIrcFeed(this.sourceId, channel, sink, irc);
  }
}
