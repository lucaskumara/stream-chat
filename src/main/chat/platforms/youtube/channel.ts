import type { Platform } from "@shared/types";
import { Channel, type ChannelLookup } from "../../channel";
import type { EmoteBinding } from "../../../emotes";
import { innertube } from "./connection";

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const ORIGIN = "https://www.youtube.com";

export class YouTubeChannel extends Channel {
  readonly platform: Platform = "youtube";

  constructor(
    displayName: string,
    readonly continuation: string,
    readonly channelId: string,
  ) {
    super(displayName);
  }

  get emotes(): EmoteBinding | null {
    if (!this.channelId) return null;

    return { platform: "google", channelId: this.channelId };
  }
}

type Reference =
  | { kind: "video"; videoId: string }
  | { kind: "page"; url: string; label: string };

function referenceFor(identifier: string): Reference {
  const value = identifier.trim();

  if (VIDEO_ID.test(value) && !value.startsWith("@")) {
    return { kind: "video", videoId: value };
  }

  if (CHANNEL_ID.test(value)) {
    return {
      kind: "page",
      url: `${ORIGIN}/channel/${value}/live`,
      label: value,
    };
  }

  const handle = value.replace(/^@/, "");
  return {
    kind: "page",
    url: `${ORIGIN}/@${encodeURIComponent(handle)}/live`,
    label: `@${handle}`,
  };
}

export async function resolveChannel(
  identifier: string,
): Promise<ChannelLookup<YouTubeChannel>> {
  const reference = referenceFor(identifier);

  try {
    if (reference.kind === "video") return await inspectStream(reference.videoId);

    const { videoId, browseId } = await liveEndpoint(reference.url);
    const displayName = browseId ? await channelName(browseId) : undefined;

    if (!videoId) {
      return { state: "offline", reason: "not streaming right now", displayName };
    }

    return await inspectStream(videoId);
  } catch (error) {
    return classifyFailure(error, reference);
  }
}

async function liveEndpoint(
  url: string,
): Promise<{ videoId?: string; browseId?: string }> {
  const youtube = await innertube();
  const endpoint = await youtube.resolveURL(url);

  return {
    videoId: endpoint.payload?.videoId,
    browseId: endpoint.payload?.browseId,
  };
}

const channelNames = new Map<string, string>();

async function channelName(browseId: string): Promise<string | undefined> {
  const known = channelNames.get(browseId);
  if (known) return known;

  try {
    const youtube = await innertube();
    const title = (await youtube.getChannel(browseId)).metadata?.title;

    if (typeof title === "string" && title) channelNames.set(browseId, title);

    return channelNames.get(browseId);
  } catch {
    return undefined;
  }
}

async function inspectStream(
  videoId: string,
): Promise<ChannelLookup<YouTubeChannel>> {
  const youtube = await innertube();
  const info = await youtube.getInfo(videoId);

  if (!info.basic_info.is_live) {
    return { state: "offline", reason: "not streaming right now" };
  }

  const continuation = info.livechat?.continuation;
  if (!continuation) {
    return {
      state: "offline",
      reason: "live chat is turned off for this stream",
    };
  }

  return {
    state: "ok",
    channel: new YouTubeChannel(
      info.basic_info.author ?? "",
      continuation,
      info.basic_info.channel_id ?? "",
    ),
  };
}

function classifyFailure(
  error: unknown,
  reference: Reference,
): ChannelLookup<YouTubeChannel> {
  const reason = error instanceof Error ? error.message : String(error);

  if (/404|not found|does not exist/i.test(reason)) {
    const label =
      reference.kind === "video" ? reference.videoId : reference.label;
    return {
      state: "missing",
      reason: `YouTube has no channel or video for "${label}".`,
    };
  }

  return { state: "unreachable", reason };
}
