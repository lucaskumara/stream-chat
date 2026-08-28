import type { Platform } from "@shared/types";

export abstract class Channel {
  abstract readonly platform: Platform;

  constructor(readonly displayName: string) {}
}

export type ChannelLookup<TChannel extends Channel> =
  | { state: "ok"; channel: TChannel }
  | { state: "offline"; reason: string; displayName?: string }
  | { state: "missing"; reason: string }
  | { state: "unreachable"; reason: string };

export interface RetryPolicy {
  offlineMs: number;
  errorMs: number;
  jitterMs: number;
}
