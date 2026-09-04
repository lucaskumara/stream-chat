import type { Platform } from "@shared/types";
import type { EmoteBinding } from "../emotes";

export abstract class Channel {
  abstract readonly platform: Platform;

  constructor(readonly displayName: string) {}

  get emotes(): EmoteBinding | null {
    return null;
  }

  /** The page a click on the pane bar's name opens, in the user's browser. Undefined
      for a channel with nowhere to send it — none of the three platforms hit that
      today, but the base stays permissive rather than forcing every subclass to
      implement one. */
  get url(): string | undefined {
    return undefined;
  }
}

export type ChannelLookup<TChannel extends Channel> =
  | { state: "ok"; channel: TChannel }
  | { state: "offline"; reason: string; displayName?: string }
  | { state: "missing"; reason: string }
  | { state: "unreachable"; reason: string };

export class MissingChannelError extends Error {}

export interface RetryPolicy {
  offlineMs: number;
  errorMs: number;
  jitterMs: number;
}
