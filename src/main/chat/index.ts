import type { Platform } from "@shared/types";
import { KickChatWatcher, type KickServices } from "./platforms/kick";
import { TwitchChatWatcher, type TwitchServices } from "./platforms/twitch";
import { YouTubeChatWatcher } from "./platforms/youtube";
import type { ChatWatcher, ChatWatcherContext } from "./watcher";

export type {
  ChatWatcher,
  ChatWatcherContext,
  ChatWatcherEvents,
} from "./watcher";
export type { TwitchServices } from "./platforms/twitch";
export type { KickServices } from "./platforms/kick";

export interface PlatformServices {
  twitch: TwitchServices;
  kick: KickServices;
}

type WatcherFactory = (
  context: ChatWatcherContext,
  services: PlatformServices,
) => ChatWatcher;

const FACTORIES: Record<Platform, WatcherFactory> = {
  twitch: (context, services) =>
    new TwitchChatWatcher(context, services.twitch),
  youtube: (context) => new YouTubeChatWatcher(context),
  kick: (context, services) => new KickChatWatcher(context, services.kick),
};

export function createWatcher(
  platform: Platform,
  context: ChatWatcherContext,
  services: PlatformServices,
): ChatWatcher {
  return FACTORIES[platform](context, services);
}
