import type { Platform } from "@shared/types";
import { KickChatWatcher } from "./platforms/kick";
import { TwitchChatWatcher, type TwitchServices } from "./platforms/twitch";
import { YouTubeChatWatcher } from "./platforms/youtube";
import type { ChatWatcher, ChatWatcherContext } from "./watcher";

export type {
  ChatWatcher,
  ChatWatcherContext,
  ChatWatcherEvents,
} from "./watcher";
export type { TwitchServices } from "./platforms/twitch";

export interface PlatformServices {
  twitch: TwitchServices;
}

type WatcherFactory = (
  context: ChatWatcherContext,
  services: PlatformServices,
) => ChatWatcher;

const FACTORIES: Record<Platform, WatcherFactory> = {
  twitch: (context, services) =>
    new TwitchChatWatcher(context, services.twitch),
  youtube: (context) => new YouTubeChatWatcher(context),
  kick: (context) => new KickChatWatcher(context),
};

export function createWatcher(
  platform: Platform,
  context: ChatWatcherContext,
  services: PlatformServices,
): ChatWatcher {
  return FACTORIES[platform](context, services);
}
