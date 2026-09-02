import type { Platform } from "@shared/types";
import {
  BaseChatWatcher,
  type ChatFeed,
  type ChatWatcherContext,
  type FeedSink,
} from "../../watcher";
import type { ChannelLookup, RetryPolicy } from "../../channel";
import { resolveChannel, type TwitchChannel } from "./channel";
import { IrcHub, TwitchIrcFeed } from "./irc";

export { IrcHub } from "./irc";

export interface TwitchServices {
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
    return resolveChannel(identifier);
  }

  protected createFeed(channel: TwitchChannel, sink: FeedSink): ChatFeed {
    return new TwitchIrcFeed(this.sourceId, channel, sink, this.services.irc);
  }
}
