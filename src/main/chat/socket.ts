import WebSocket from "ws";
import { reconnectDelayMs } from "./backoff";

export type RoomHandler = (event: string, payload: unknown) => void;

export abstract class RoomSocket {
  private ws: WebSocket | null = null;
  private readonly rooms = new Map<string, Set<RoomHandler>>();

  private attempt = 0;
  private silenceMs: number;

  private silenceTimer: NodeJS.Timeout | null = null;
  private replyTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly url: string,
    private readonly defaultSilenceMs: number,
    private readonly replyDeadlineMs: number,
  ) {
    this.silenceMs = defaultSilenceMs;
  }

  protected abstract onOpen(): void;
  protected abstract onFrame(raw: string): void;

  protected abstract sendJoin(room: string): void;
  protected abstract sendLeave(room: string): void;
  protected abstract sendKeepalive(): void;

  join(room: string, handler: RoomHandler): () => void {
    const existing = this.rooms.get(room);

    if (existing) {
      existing.add(handler);
    } else {
      this.rooms.set(room, new Set([handler]));
      this.sendJoin(room);
    }

    if (!this.ws) this.connect();

    return () => this.leave(room, handler);
  }

  shutdown(): void {
    this.stopTimers();

    const socket = this.ws;
    this.ws = null;
    this.attempt = 0;

    socket?.close();
  }

  protected get joinedRooms(): IterableIterator<string> {
    return this.rooms.keys();
  }

  protected send(raw: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(raw);
  }

  protected deliver(room: string, event: string, payload: unknown): void {
    const handlers = this.rooms.get(room);
    if (!handlers) return;

    for (const handler of handlers) handler(event, payload);
  }

  protected negotiateSilence(ms: number | undefined): void {
    this.silenceMs = ms && ms > 0 ? ms : this.defaultSilenceMs;
    this.attempt = 0;
  }

  private leave(room: string, handler: RoomHandler): void {
    const handlers = this.rooms.get(room);
    if (!handlers?.delete(handler) || handlers.size > 0) return;

    this.rooms.delete(room);
    this.sendLeave(room);

    if (this.rooms.size === 0) this.shutdown();
  }

  private connect(): void {
    this.clearReconnect();

    const socket = new WebSocket(this.url);
    this.ws = socket;

    socket.on("open", () => {
      if (this.ws !== socket) return;

      this.onOpen();
      this.armSilence();
    });

    socket.on("message", (raw: WebSocket.RawData) => {
      if (this.ws !== socket) return;

      this.noteActivity();
      this.onFrame(raw.toString());
    });

    socket.on("close", () => {
      if (this.ws === socket) this.scheduleReconnect();
    });

    socket.on("error", () => socket.close());
  }

  private noteActivity(): void {
    if (this.replyTimer) {
      clearTimeout(this.replyTimer);
      this.replyTimer = null;
    }

    this.armSilence();
  }

  private armSilence(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);

    this.silenceTimer = setTimeout(() => this.probe(), this.silenceMs);
  }

  private probe(): void {
    this.sendKeepalive();

    this.replyTimer = setTimeout(() => this.ws?.close(), this.replyDeadlineMs);
  }

  private scheduleReconnect(): void {
    this.stopTimers();
    this.ws = null;

    if (this.rooms.size === 0) return;

    this.reconnectTimer = setTimeout(
      () => this.connect(),
      reconnectDelayMs(this.attempt++),
    );
  }

  private stopTimers(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.replyTimer) clearTimeout(this.replyTimer);

    this.silenceTimer = null;
    this.replyTimer = null;

    this.clearReconnect();
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}
