import type {
  ChatMessage,
  ModerationEvent,
  Platform,
  SourceStatus,
} from "@shared/types";
import {
  MissingChannelError,
  type Channel,
  type ChannelLookup,
  type RetryPolicy,
} from "./channel";
import { applyEmotes, thirdPartyEmotes } from "../emotes";

export abstract class BaseChatWatcher<
  TChannel extends Channel,
> implements ChatWatcher {
  abstract readonly platform: Platform;

  readonly sourceId: string;

  protected abstract readonly retry: RetryPolicy;

  protected readonly identifier: string;
  protected readonly events: ChatWatcherEvents;

  private readonly timers = new Set<NodeJS.Timeout>();
  private feed: ChatFeed | null = null;
  private running = false;
  private currentLabel: string;
  private connected: TChannel | null = null;

  constructor({ sourceId, identifier, events }: ChatWatcherContext) {
    this.sourceId = sourceId;
    this.identifier = identifier;
    this.events = events;
    this.currentLabel = identifier;
  }

  protected abstract resolve(
    identifier: string,
  ): Promise<ChannelLookup<TChannel>>;

  protected abstract createFeed(channel: TChannel, sink: FeedSink): ChatFeed;

  get label(): string {
    return this.currentLabel;
  }

  async connect(): Promise<void> {
    if (this.running) return;

    this.running = true;
    await this.attach();
  }

  async disconnect(): Promise<void> {
    if (!this.running) return;

    this.running = false;
    this.cancelScheduled();
    this.detach();

    this.events.status("disconnected");
  }

  protected get isRunning(): boolean {
    return this.running;
  }

  protected rename(label: string): void {
    if (label) this.currentLabel = label;
  }

  protected schedule(run: () => void, delayMs: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.running) run();
    }, delayMs);

    this.timers.add(timer);
  }

  private async attach(): Promise<void> {
    this.events.status("connecting");

    const lookup = await this.resolve(this.identifier);
    if (!this.running) return;

    switch (lookup.state) {
      case "ok":
        return this.open(lookup.channel);

      case "offline":
        if (lookup.displayName) this.rename(lookup.displayName);
        this.events.status("offline", lookup.reason);
        return this.scheduleAttach(this.retry.offlineMs);

      case "unreachable":
        this.events.status("error", lookup.reason);
        return this.scheduleAttach(this.retry.errorMs);

      case "missing":
        this.events.status("error", lookup.reason);
        throw new MissingChannelError(lookup.reason);
    }
  }

  /** The resolved channel, or null while disconnected or between re-resolves. Sending
      needs the channel's own id, and every platform's id lives here rather than being
      re-resolved per message. */
  protected get channel(): TChannel | null {
    return this.connected;
  }

  private open(channel: TChannel): void {
    this.connected = channel;
    this.rename(channel.displayName);

    const binding = channel.emotes;
    if (binding) void thirdPartyEmotes.load(binding);

    this.feed = this.createFeed(channel, this.sink);
    void this.feed.start();

    this.events.status("connected");
  }

  private detach(): void {
    this.feed?.stop();
    this.feed = null;
    this.connected = null;
  }

  private readonly sink: FeedSink = {
    message: (message) => {
      if (this.running) this.events.message(message);
    },
    moderation: (event) => {
      if (this.running) this.events.moderation(event);
    },
    ended: (reason) => this.reattach("offline", reason, this.retry.offlineMs),
    failed: (reason) => this.reattach("error", reason, this.retry.errorMs),
  };

  private reattach(
    status: SourceStatus,
    reason: string,
    delayMs: number,
  ): void {
    if (!this.running) return;

    this.detach();
    this.events.status(status, reason);
    this.scheduleAttach(delayMs);
  }

  private scheduleAttach(delayMs: number): void {
    this.schedule(
      () => void this.attach().catch(alreadyReported),
      delayMs + Math.random() * this.retry.jitterMs,
    );
  }

  private cancelScheduled(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}

function alreadyReported(): void {}

const DEFAULT_MAX_FAILURES = 3;
const DEFAULT_RETRY_MS = 2_000;

export interface FeedSink {
  message(message: ChatMessage): void;
  moderation(event: ModerationEvent): void;

  ended(reason: string): void;
  failed(reason: string): void;
}

export interface ChatFeed {
  start(): void | Promise<void>;
  stop(): void;
}

export interface PollResult {
  messages: ChatMessage[];
  moderation: ModerationEvent[];

  nextPollMs: number;
  ended: boolean;
}

export interface ChatWatcherEvents {
  message(message: ChatMessage): void;
  moderation(event: ModerationEvent): void;
  status(status: SourceStatus, error?: string): void;
}

export interface ChatWatcherContext {
  sourceId: string;
  identifier: string;
  events: ChatWatcherEvents;
}

export interface ChatWatcher {
  readonly sourceId: string;
  readonly platform: Platform;
  readonly label: string;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export abstract class PollingFeed implements ChatFeed {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private failures = 0;

  constructor(
    protected readonly sink: FeedSink,
    private readonly maxFailures = DEFAULT_MAX_FAILURES,
    private readonly retryMs = DEFAULT_RETRY_MS,
  ) {}

  protected abstract poll(): Promise<PollResult>;

  start(): void {
    if (this.running) return;

    this.running = true;
    void this.pump();
  }

  stop(): void {
    this.running = false;

    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async pump(): Promise<void> {
    if (!this.running) return;

    try {
      const result = await this.poll();
      if (!this.running) return;

      this.deliver(result);
    } catch (error) {
      if (this.running) this.recover(error);
    }
  }

  private deliver(result: PollResult): void {
    if (result.ended) {
      this.sink.ended("stream ended");
      return;
    }

    for (const message of result.messages) this.sink.message(message);
    for (const event of result.moderation) this.sink.moderation(event);

    this.failures = 0;
    this.sleep(result.nextPollMs);
  }

  private recover(error: unknown): void {
    this.failures++;

    if (this.failures >= this.maxFailures) {
      this.sink.failed(error instanceof Error ? error.message : String(error));
      return;
    }

    this.sleep(this.retryMs);
  }

  private sleep(delayMs: number): void {
    this.timer = setTimeout(() => void this.pump(), delayMs);
  }
}

export function messageId(
  platform: Platform,
  sourceId: string,
  nativeId: string,
): string {
  return `${platform}:${sourceId}:${nativeId}`;
}

export function withEmotes(message: ChatMessage, channel: Channel): ChatMessage {
  const binding = channel.emotes;
  if (!binding) return message;

  return {
    ...message,
    fragments: applyEmotes(message.fragments, (name) =>
      thirdPartyEmotes.lookup(binding, name),
    ),
  };
}
