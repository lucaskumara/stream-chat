import type { Platform } from "@shared/types";
import { canonicalHandle, resolveChannel as resolveYouTube } from "./platforms/youtube/channel";
import { resolveChannel as resolveKick } from "./platforms/kick/channel";
import { resolveChannel as resolveTwitch } from "./platforms/twitch/channel";

export interface VerifyChannelResult {
  ok: boolean;
  reason?: string;
  canonicalIdentifier?: string;
}

/** A one-shot existence check for Settings → Platforms, reusing each platform's
    own resolveChannel — no watcher, no socket, no SourceManager entry. Each
    wrapper is typed against its own concrete Channel subclass rather than the
    Channel base, so picking a platform-specific field (Kick's slug) needs no
    cast. */
async function verifyTwitch(identifier: string): Promise<VerifyChannelResult> {
  const lookup = await resolveTwitch(identifier);

  if (lookup.state === "missing") return { ok: false, reason: lookup.reason };

  return {
    ok: true,
    canonicalIdentifier: lookup.state === "ok" ? lookup.channel.displayName : undefined
  };
}

async function verifyKick(identifier: string): Promise<VerifyChannelResult> {
  const lookup = await resolveKick(identifier);

  if (lookup.state === "missing") return { ok: false, reason: lookup.reason };

  return {
    ok: true,
    canonicalIdentifier: lookup.state === "ok" ? lookup.channel.slug : undefined
  };
}

/** 'missing' is the only state that withholds a correction — offline and
    unreachable still mean the identifier is worth normalizing, since the
    lowercase transform runs on the typed input rather than on resolve data. */
async function verifyYouTube(identifier: string): Promise<VerifyChannelResult> {
  const lookup = await resolveYouTube(identifier);

  if (lookup.state === "missing") return { ok: false, reason: lookup.reason };

  return { ok: true, canonicalIdentifier: canonicalHandle(identifier) };
}

const VERIFIERS: Record<Platform, (identifier: string) => Promise<VerifyChannelResult>> = {
  twitch: verifyTwitch,
  kick: verifyKick,
  youtube: verifyYouTube
};

export function verifyChannel(platform: Platform, identifier: string): Promise<VerifyChannelResult> {
  return VERIFIERS[platform](identifier);
}
