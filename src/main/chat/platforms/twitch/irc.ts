import type { Badge, ChatMessage, Fragment, MessageKind } from "@shared/types";
import { RoomSocket } from "../../socket";
import { messageId, withEmotes, type ChatFeed, type FeedSink } from "../../watcher";
import { splitLinks } from "../../links";
import { twitchBadges } from "./badges";
import type { TwitchChannel } from "./channel";

interface IrcMessage {
  tags: Record<string, string>;

  nick?: string;
  command: string;
  params: string[];

  trailing?: string;
}

function unescapeTag(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== "\\") {
      out += value[i];
      continue;
    }
    const next = value[++i];
    if (next === "s") out += " ";
    else if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === ":") out += ";";
    else if (next === "\\") out += "\\";
    else if (next === undefined) break;
    else out += next;
  }
  return out;
}

function parseIrcLine(line: string): IrcMessage | null {
  if (line === "") return null;
  let rest = line;

  const tags: Record<string, string> = {};
  if (rest.startsWith("@")) {
    const end = rest.indexOf(" ");
    if (end === -1) return null;
    for (const pair of rest.slice(1, end).split(";")) {
      if (pair === "") continue;
      const eq = pair.indexOf("=");
      if (eq === -1) tags[pair] = "";
      else tags[pair.slice(0, eq)] = unescapeTag(pair.slice(eq + 1));
    }
    rest = rest.slice(end + 1);
  }

  let nick: string | undefined;
  if (rest.startsWith(":")) {
    const end = rest.indexOf(" ");
    if (end === -1) return null;
    const prefix = rest.slice(1, end);
    const bang = prefix.indexOf("!");
    nick = bang === -1 ? prefix : prefix.slice(0, bang);
    rest = rest.slice(end + 1);
  }

  let trailing: string | undefined;
  const trailingAt = rest.indexOf(" :");
  if (rest.startsWith(":")) {
    trailing = rest.slice(1);
    rest = "";
  } else if (trailingAt !== -1) {
    trailing = rest.slice(trailingAt + 2);
    rest = rest.slice(0, trailingAt);
  }

  const parts = rest.split(" ").filter(Boolean);
  const command = parts.shift() ?? "";
  if (command === "") return null;

  const result: IrcMessage = { tags, command, params: parts };
  if (nick !== undefined) result.nick = nick;
  if (trailing !== undefined) result.trailing = trailing;
  return result;
}

interface EmoteSpan {
  id: string;

  start: number;
  end: number;
}

function parseEmoteTag(tag: string | undefined): EmoteSpan[] {
  if (!tag) return [];
  const spans: EmoteSpan[] = [];

  for (const group of tag.split("/")) {
    if (group === "") continue;
    const colon = group.indexOf(":");
    if (colon === -1) continue;
    const id = group.slice(0, colon);

    for (const range of group.slice(colon + 1).split(",")) {
      const dash = range.indexOf("-");
      if (dash === -1) continue;
      const start = Number(range.slice(0, dash));
      const end = Number(range.slice(dash + 1));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
        continue;
      spans.push({ id, start, end });
    }
  }

  return spans.sort((a, b) => a.start - b.start);
}

const IRC_URL = "wss://irc-ws.chat.twitch.tv:443";

const SILENCE_TIMEOUT_MS = 6 * 60 * 1000;
const PONG_DEADLINE_MS = 30_000;

export class IrcHub extends RoomSocket {
  constructor() {
    super(IRC_URL, SILENCE_TIMEOUT_MS, PONG_DEADLINE_MS);
  }

  protected onOpen(): void {
    const anonymousNick = `justinfan${Math.floor(Math.random() * 80000 + 1000)}`;

    this.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
    this.send(`NICK ${anonymousNick}`);

    for (const room of this.joinedRooms) this.sendJoin(room);
  }

  protected onFrame(raw: string): void {
    for (const line of raw.split("\r\n")) {
      if (line === "") continue;

      const message = parseIrcLine(line);
      if (!message) continue;

      if (message.command === "PING") {
        this.send(`PONG :${message.trailing ?? "tmi.twitch.tv"}`);
        continue;
      }

      const target = message.params[0];
      if (target?.startsWith("#"))
        this.deliver(target.slice(1), message.command, message);
    }
  }

  protected sendJoin(room: string): void {
    this.send(`JOIN #${room}`);
  }

  protected sendLeave(room: string): void {
    this.send(`PART #${room}`);
  }

  protected sendKeepalive(): void {
    this.send("PING :tmi.twitch.tv");
  }
}

const EMOTE_CDN = "https://static-cdn.jtvnw.net/emoticons/v2";

function emoteUrls(id: string): { url: string; srcSet: string } {
  const at = (scale: string): string =>
    `${EMOTE_CDN}/${id}/default/dark/${scale}`;
  return {
    url: at("1.0"),
    srcSet: `${at("1.0")} 1x, ${at("2.0")} 2x, ${at("3.0")} 3x`,
  };
}

function buildIrcFragments(
  text: string,
  emoteTag: string | undefined,
): Fragment[] {
  const spans = parseEmoteTag(emoteTag);
  if (spans.length === 0) return splitLinks(text);

  const chars = [...text];
  const out: Fragment[] = [];
  let cursor = 0;

  for (const span of spans) {
    if (span.start < cursor || span.start >= chars.length) continue;
    const end = Math.min(span.end, chars.length - 1);

    if (span.start > cursor) {
      out.push(...splitLinks(chars.slice(cursor, span.start).join("")));
    }

    const name = chars.slice(span.start, end + 1).join("");
    const { url, srcSet } = emoteUrls(span.id);
    out.push({ kind: "emote", name, url, srcSet, provider: "native" });
    cursor = end + 1;
  }

  if (cursor < chars.length)
    out.push(...splitLinks(chars.slice(cursor).join("")));
  return out;
}

function noticeKind(msgId: string | undefined): MessageKind {
  switch (msgId) {
    case "sub":
    case "resub":
    case "subgift":
    case "submysterygift":
    case "giftpaidupgrade":
    case "anonsubgift":
      return "subscription";
    case "raid":
      return "raid";
    case "announcement":
      return "announcement";
    default:
      return "system";
  }
}

function badgesFor(channelLogin: string, tag: string | undefined): Badge[] {
  if (!tag) return [];

  const badges: Badge[] = [];

  for (const entry of tag.split(",")) {
    const slash = entry.lastIndexOf("/");
    if (slash === -1) continue;

    const setId = entry.slice(0, slash);
    const version = entry.slice(slash + 1);

    badges.push(
      twitchBadges.lookup(channelLogin, setId, version) ?? { label: setId },
    );
  }

  return badges;
}

function normalizeIrcPrivmsg(
  msg: IrcMessage,
  sourceId: string,
  channelLogin: string,
): ChatMessage | null {
  const text = msg.trailing ?? "";
  const login = msg.nick ?? msg.tags["login"] ?? "unknown";
  const nativeId =
    msg.tags["id"] ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const out: ChatMessage = {
    id: messageId("twitch", sourceId, nativeId),
    sourceId,
    platform: "twitch",
    kind: msg.tags["bits"] ? "donation" : "chat",
    authorId: msg.tags["user-id"] ?? login,
    authorName: login,
    fragments: buildIrcFragments(text, msg.tags["emotes"]),
    plainText: text,
    timestamp: Number(msg.tags["tmi-sent-ts"]) || Date.now(),
  };

  const display = msg.tags["display-name"];
  if (display) out.authorDisplayName = display;

  const color = msg.tags["color"];
  if (color) out.authorColor = color;

  const badges = badgesFor(channelLogin, msg.tags["badges"]);
  if (badges.length > 0) out.badges = badges;

  const bits = Number(msg.tags["bits"]);
  if (Number.isFinite(bits) && bits > 0)
    out.monetary = { amount: bits, currency: "bits" };

  const replyId = msg.tags["reply-parent-msg-id"];
  if (replyId) {
    out.replyTo = {
      messageId: messageId("twitch", sourceId, replyId),
      authorName:
        msg.tags["reply-parent-display-name"] ??
        msg.tags["reply-parent-user-login"] ??
        "",
      excerpt: (msg.tags["reply-parent-msg-body"] ?? "").slice(0, 60),
    };
  }

  return out;
}

function normalizeIrcUsernotice(
  msg: IrcMessage,
  sourceId: string,
  channelLogin: string,
): ChatMessage | null {
  const systemMsg = msg.tags["system-msg"];
  if (!systemMsg) return null;

  const login = msg.tags["login"] ?? "twitch";
  const nativeId =
    msg.tags["id"] ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userText = msg.trailing ?? "";

  const fragments: Fragment[] = [{ kind: "text", text: systemMsg }];
  if (userText !== "") {
    fragments.push(...buildIrcFragments(userText, msg.tags["emotes"]));
  }

  const out: ChatMessage = {
    id: messageId("twitch", sourceId, nativeId),
    sourceId,
    platform: "twitch",
    kind: noticeKind(msg.tags["msg-id"]),
    authorId: msg.tags["user-id"] ?? login,
    authorName: login,
    fragments,
    plainText: userText === "" ? systemMsg : `${systemMsg} ${userText}`,
    timestamp: Number(msg.tags["tmi-sent-ts"]) || Date.now(),
  };

  const display = msg.tags["display-name"];
  if (display) out.authorDisplayName = display;

  const color = msg.tags["color"];
  if (color) out.authorColor = color;

  const badges = badgesFor(channelLogin, msg.tags["badges"]);
  if (badges.length > 0) out.badges = badges;

  return out;
}

const FATAL_NOTICE_IDS = ["msg_channel_suspended", "msg_banned"];

export class TwitchIrcFeed implements ChatFeed {
  private leaveRoom: (() => void) | null = null;

  constructor(
    private readonly sourceId: string,
    private readonly channel: TwitchChannel,
    private readonly sink: FeedSink,
    private readonly hub: IrcHub,
  ) {}

  start(): void {
    twitchBadges.load(this.channel.login);

    this.leaveRoom = this.hub.join(this.channel.login, (_event, payload) =>
      this.route(payload as IrcMessage),
    );
  }

  stop(): void {
    this.leaveRoom?.();
    this.leaveRoom = null;
  }

  private route(message: IrcMessage): void {
    switch (message.command) {
      case "PRIVMSG":
        return this.publishMessage(message);

      case "USERNOTICE":
        return this.publishNotice(message);

      case "CLEARMSG":
        return this.publishDeletion(message);

      case "CLEARCHAT":
        return this.publishClear(message);

      case "NOTICE":
        return this.reportFatalNotice(message);
    }
  }

  private publishMessage(message: IrcMessage): void {
    const chat = normalizeIrcPrivmsg(
      message,
      this.sourceId,
      this.channel.login,
    );
    if (chat) this.sink.message(withEmotes(chat, this.channel));
  }

  private publishNotice(message: IrcMessage): void {
    const notice = normalizeIrcUsernotice(
      message,
      this.sourceId,
      this.channel.login,
    );
    if (notice) this.sink.message(withEmotes(notice, this.channel));
  }

  private publishDeletion(message: IrcMessage): void {
    const targetMessageId = message.tags["target-msg-id"];
    if (!targetMessageId) return;

    this.sink.moderation({
      type: "delete-message",
      sourceId: this.sourceId,
      messageId: messageId("twitch", this.sourceId, targetMessageId),
    });
  }

  private publishClear(message: IrcMessage): void {
    const timedOutLogin = message.trailing;

    if (!timedOutLogin) {
      this.sink.moderation({ type: "clear-chat", sourceId: this.sourceId });
      return;
    }

    this.sink.moderation({
      type: "clear-user",
      sourceId: this.sourceId,
      userId: message.tags["target-user-id"] ?? timedOutLogin,
    });
  }

  private reportFatalNotice(message: IrcMessage): void {
    const noticeId = message.tags["msg-id"] ?? "";
    if (!FATAL_NOTICE_IDS.some((id) => noticeId.includes(id))) return;

    this.sink.failed(message.trailing ?? "channel unavailable");
  }
}
