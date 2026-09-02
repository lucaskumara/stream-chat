import type { Platform } from "@shared/types";
import {
  BaseChatWatcher,
  SendUnavailableError,
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

  /** Sending is a Helix call, not a transport concern, so it does not care which of the
      two feeds is running — only that a token exists. The sent message comes back through
      the normal read path like anyone else's, so nothing is echoed locally. */
  async send(text: string): Promise<void> {
    const { auth, helix } = this.services;

    const tokens = auth.getTokens();
    if (!tokens) {
      throw new SendUnavailableError("Sign in to Twitch to send messages.");
    }

    if (!tokens.scopes.includes("user:write:chat")) {
      throw new SendUnavailableError(
        "This Twitch sign-in predates message sending. Sign in again to allow it.",
      );
    }

    const channel = this.channel;
    if (!channel?.broadcasterId) {
      throw new SendUnavailableError("This channel is not connected.");
    }

    await helix.sendChatMessage(channel.broadcasterId, tokens.userId, text);
  }
}
