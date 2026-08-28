# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A unified live chat client for Twitch, YouTube and Kick. Electron + React 19 + TypeScript.
Single-user desktop app: the user signs into their own accounts, so there is no backend,
no database, and no OAuth app verification workflow.

The code is deliberately comment-free. The "Invariants" section below is where the "why"
lives — read it before touching the message pipeline, emotes, or either Twitch transport.

## Commands

```bash
npm run dev        # electron-vite dev — launches the app and the renderer dev server
npm run typecheck  # both tsconfig projects; the fastest correctness gate
npm run build      # typecheck, then build main + preload + renderer
```

`npm run pack` / `npm run dist` exist but electron-builder has no config block yet, so they
are untested.

There is **no test runner configured**. See "Verifying changes" below for how work in this
repo actually gets checked.

## Two TypeScript projects

`tsconfig.node.json` (main + preload + shared) and `tsconfig.web.json` (renderer + shared).
`npm run typecheck` runs both and **both must pass** — a change to `src/shared` is checked
twice, under different `lib`/`types`. Shared code therefore cannot use Node or DOM APIs.

## Architecture

Chat flows one way:

```
ChatFeed -> BaseChatWatcher -> MessageBus (100ms batches) -> IPC 'chat:batch' -> zustand store -> ChatPane
```

Every platform lives in `src/main/chat/platforms/<site>/` and answers the same questions
under the **same filenames**. If you know one folder you know all three:

| File | Question it answers |
|---|---|
| `channel.ts` | *who?* `resolve(identifier)` -> `ChannelLookup`, plus the `Channel` subclass |
| `connection.ts` | the shared socket or session, if the platform has one |
| `index.ts` | *how does chat arrive, and in what shape?* the `BaseChatWatcher` subclass, the `ChatFeed`, and the raw-event -> `ChatMessage` mapping — and the only module anything outside the folder imports |

`channel.ts` and `index.ts` are mandatory; `connection.ts` exists only where a socket or
session is shared across channels (Kick's Pusher socket, YouTube's `Innertube`). Twitch
carries two transports, so each gets its own file — `irc.ts` and `eventsub.ts` — holding
that transport's hub, feed and mapping together, plus `badges.ts`, which both transports
share. Mapping is **not** a separate file: it
lives beside the feed that produces it, as module-level `toChatMessage` / `toFragments`
functions under the exported class.

```
src/shared/          types plus channel.ts (the "add a channel" parser, used by both processes)
src/main/chat/       the framework:
  watcher.ts           ChatWatcher, BaseChatWatcher, ChatFeed, FeedSink, PollingFeed,
                       and messageId() — the single id composer
  channel.ts           Channel (abstract base), ChannelLookup, RetryPolicy
  socket.ts            RoomSocket — join/leave/keepalive/reconnect for multiplexed sockets
  links.ts             splitLinks
  backoff.ts           reconnectDelayMs, shared by every socket
  recent-ids.ts        bounded replay guard (YouTube only, today)
  index.ts             createWatcher registry + PlatformServices
  platforms/twitch|youtube|kick/
src/main/             bus.ts (MessageBus), sources.ts (SourceManager), ipc.ts, config.ts,
                      lifecycle.ts, index.ts (app bootstrap + service construction)
src/main/twitch/      auth.ts, helix.ts, state.ts, clientId.ts — account only, no wire code
src/main/emotes/      7TV + BTTV — INTACT BUT UNWIRED, see below
src/renderer/src/     App.tsx, zustand store.ts, theme.ts (the antd ThemeConfig), components/
```

The rule that keeps this from drifting: **wire code lives in the platform folder, account
code does not.** Twitch auth is IPC-driven token management, not a chat transport.

**`RoomSocket` is the shared multiplexing socket.** `chat/socket.ts` owns the whole pattern:
`join(room, handler)` returns a leave function, the first join opens the socket, the last
leave closes it, and reconnect/backoff/keepalive are handled once. Subclasses fill in five
hooks — `onOpen`, `onFrame`, `sendJoin`, `sendLeave`, `sendKeepalive`. Both Kick's Pusher
socket and Twitch's `IrcHub` extend it, which is why the two "retain the negotiated silence
timeout" invariants below are really one code path (`negotiateSilence`). `EventSubHub` does
*not* extend it — EventSub subscriptions are bound to a session id and must be recreated on
reconnect, which does not fit the room model.

**`PlatformServices` is the injection seam.** `main/index.ts` constructs `TwitchAuth`,
`Helix`, `EventSubHub` and `IrcHub`, and hands them to `SourceManager` as
`{ twitch: { auth, helix, eventsub, irc } }`. `createWatcher` in `chat/index.ts` passes them
to the Twitch factory only; YouTube and Kick take nothing and reach their shared connection
through a module singleton. That asymmetry is why `TwitchChatWatcher` is the one watcher
with a second constructor argument.

## Invariants

Things that cost real time to discover, and that a reasonable-looking change will silently
re-break.

### Message pipeline

**Fragments are built in the main process. The renderer never parses message text.**
`ChatMessage.fragments` arrives pre-split into text/emote/mention/link. Twitch hands over
emote positions; re-deriving them with a regex in the UI breaks on overlapping emote names
and unicode offsets. New platforms do their splitting in their own `index.ts` (or transport
file) alongside the feed, and keep the renderer dumb.

**IRC emote offsets index code points, not UTF-16 units.** Split with `[...text]` before
slicing. Indexing with `.indexOf`/`.slice` cuts an astral emoji (e.g. a ZWJ family emoji)
mid-surrogate and corrupts both the emote and the surrounding text.

**Both Twitch transports must compose message ids identically.** `irc.ts` and `eventsub.ts`
each call the shared `messageId('twitch', sourceId, nativeId)` from `chat/watcher.ts`. This
is convention, not construction — there is no `twitchMessageId` wrapper forcing it, so a new
transport can drift. Never inline the template literal.

**Links are split out of text fragments only, after the platform's own emotes are carved
out.** Running the URL regex over the whole message is exactly what the fragment design
exists to avoid.

**Badges are resolved to image URLs in the main process; the renderer only decides colour.**
Every platform emits `ChatMessage.badges` as `{ label, url?, srcSet? }` — already looked up
against that channel's badge set. A badge with no `url` is not a bug: Kick's `moderator`,
`vip`, `og`, `sub_gifter` and `verified` have no image anywhere in its API (its own UI draws
inline SVG), so `MessageRow` falls back to a three-letter chip. `authorColor`, by contrast,
is set **only when the platform actually sends one** — Twitch's `color` tag is empty for
users who never picked one, and YouTube has no such concept at all. The renderer fills the
gap from `DEFAULT_NAME_COLORS` keyed on a hash of `authorId`, which is what Twitch's own
client does. Do not invent a colour in main; a message either carries the user's choice or
carries nothing.

**The legibility lift blends toward white — it must not scale channels.** Chat runs on
`#12151a`, and platform-chosen names are picked against lighter backgrounds. `readableColor`
raises anything under `LUMINANCE_FLOOR`. Multiplying each channel by a boost factor (the
shape this code had originally) cannot lift a saturated colour at all: `#0000FF` is already
at 255 on its only lit channel, so it came out unchanged and unreadable — and `#0000FF` is
in the default palette, so it is not a rare case. Blending toward white by
`(floor - luminance) / (1 - luminance)` lands every hue exactly on the floor and keeps the
hue. Verified in the running app: `#0000FF` renders `rgb(90, 90, 255)`.

**The MessageBus batches every 100ms. Never send one IPC message per chat message.** A busy
channel does tens per second and per-message IPC saturates the renderer with
structured-clone work.

**Panes freeze while the reader scrolls up.** The store's ring buffer evicts from the front,
which shifts every virtual index and would yank the viewport. `ChatPane` renders a frozen
snapshot instead of compensating scroll offsets. Measured at 0px drift under 100+ msg/s.

### The framework

**`BaseChatWatcher` owns the entire lifecycle.** A platform supplies three things and nothing
else: `resolve(identifier)`, `createFeed(channel, sink)`, and a `RetryPolicy`. Resolve ->
open feed -> retry -> teardown, plus the running-guard and timer cancellation, all live in
the base. Kick's watcher is 24 lines because of this. Do not reintroduce a per-platform
resolve/recheck loop; three of them existed before and one platform was silently missing it.

**`ChannelLookup` has four states and they are not interchangeable.** `ok` connects;
`offline` and `unreachable` are *retryable* and schedule a jittered re-resolve; `missing` is
terminal and stops. YouTube is the only platform that returns `offline` in practice — Twitch
and Kick chat are readable while the channel is dark.

**`FeedSink.ended` is not `failed`, and neither is a status.** `ended` means this feed is
finished and the watcher should go back and re-resolve (a YouTube stream ended). `failed`
means the transport broke and should be retried. This pair is what lets one `ChatFeed`
interface cover both push sockets and polling.

**Timer ownership is split.** The watcher owns resolve/retry timers via `schedule()`, which
`disconnect()` cancels wholesale. A feed owns its own poll timers and must clear them in
`stop()`. Mixing the two leaks pollers past teardown.

**Message ids are composed in exactly one place** — `messageId(platform, sourceId, nativeId)`
at the bottom of `chat/watcher.ts`. Every feed and every moderation event routes through it.
Moderation events bind to messages by that id; hand-building the string is how deletions
silently stop working.

### Emotes (currently unwired)

**`src/main/emotes/` is intact but has zero importers.** 7TV, BTTV, `ThirdPartyEmotes` and
`applyEmotes` are all still there and still correct; nothing calls them. This was deliberate
— emotes are coming back, and the module survives so restoring them is a wiring job rather
than a rewrite.

**Native emotes still work.** Each platform's own emotes (Twitch's emote tags, Kick's
`[emote:id:name]` tokens, YouTube's `is_custom_emoji` runs) are parsed in that platform's
`toFragments` and render as images. Only the *third-party* layer is disconnected.

To reconnect: add an `onChannelResolved(channel)` hook to `BaseChatWatcher` for the
`loadChannel` call, put an `EmoteBinding { platform, channelId }` on each platform's
`Channel` subclass, and call `applyEmotes` in each feed's publish path. The invariants below
are the instructions for doing it.

**Matching is whole-token and case-sensitive.** Substring matching turns `GIGACHAD` inside a
longer word into an image; case folding collides distinct emote names.

**7TV calls YouTube `google`, not `youtube`.** Passing `youtube` returns `400 invalid platform`,
which reads like "YouTube unsupported" and is not. A missing user returns `404`; the two are
easy to confuse. Valid platform values: `TWITCH, DISCORD, GOOGLE, KICK`.

**7TV keys Kick by `user_id`, not by channel id.** `7tv.io/v3/users/kick/668` is a 404 for xQc;
`.../kick/676` is the emote set. Both numbers sit in the same payload and both look plausible,
so the wrong one reads as "this channel has no 7TV emotes". Kick's `channel.ts` no longer
carries `userId` — it will need adding back.

**BTTV is Twitch-only** and keys channels by Twitch user id. It is still worth having — some
large channels have zero 7TV emotes and hundreds of BTTV ones.

**`ThirdPartyEmotes.lookup`'s `enabled` parameter is dead** — no caller ever passed it, because
filtering happened at draw time in `MessageRow`. Drop it on the way back in.

### Twitch

**The anonymous path still needs the properly-cased display name, and GQL is where it comes
from.** Signed out there is no Helix token, so `resolveChannel` used to build
`new TwitchChannel(login, login, '')` and the tab read `theburntpeanut` instead of
`TheBurntPeanut`. `anonymousDisplayName` asks `gql.twitch.tv` for `user(login:){displayName}`
over the same anonymous client id the badges use — hence `platforms/twitch/gql.ts`, which
owns the endpoint, the web client id and the `data` unwrapping for both callers. It falls
back to the login on any failure, so a GQL outage costs casing, not the connection.

**A rename after `connect()` returns has to be pushed, or nothing sees it.**
`SourceManager.add` copies `watcher.label` once, after connect. Anything that renames later
— a YouTube channel that only resolves when it goes live — was invisible until the status
handler in `eventsFor` started re-reading `watcher.label` on every status event.

**Two transports, chosen at runtime.** `TwitchChatWatcher.createFeed` picks `TwitchIrcFeed`
(anonymous, no account) when signed out and `TwitchEventSubFeed` when a token exists. One
watcher, two feeds in two files (`irc.ts`, `eventsub.ts`), each with its own mapping.
Anonymous is the default and the normal path. **The two produce identical output** — badges
and colours included, since both resolve through the same `badges.ts` and IRC's `color` tag
carries the same value as EventSub's `color` field. If nothing ever needs EventSub again,
the whole auth subsystem is deletable.

**`badges.twitch.tv` is dead — it does not even resolve (`ENOTFOUND`).** Every old chat
client used `badges.twitch.tv/v1/badges/global/display`; it is gone, so do not reach for it.
Helix `/chat/badges` still works but needs a token, which the anonymous IRC path (the
default) does not have. `badges.ts` therefore goes to **`gql.twitch.tv/gql` with the public
web Client ID** `kimne78kx3ncx6brgo4mv6wki5h1ko` — anonymous, no token, and one raw query
returns global badges *and* `user(login:).broadcastBadges` together. Raw queries work there;
persisted-query hashes do not (`PersistedQueryNotFound`), so do not "optimise" it into one.

**Badges are keyed `setID/version`, and the channel set wins over the global set.** IRC sends
`badges=subscriber/12,moderator/1`; EventSub sends `[{ set_id, id }]`. Both compose the same
key. A channel's `broadcastBadges` only ever contains `subscriber` and `bits` — every other
set is global — but subscriber tiers and cheer tiers are exactly the ones that differ per
channel, so checking the channel map first is not optional.

**`TwitchBadges.load()` is fire-and-forget, called from each feed's `start()`.** Nothing
awaits it, so the first second of a channel renders unbadged and then fills in. That is
deliberate: `ChatFeed.start()` is synchronous for IRC, and blocking a chat connection on a
cosmetic fetch is the wrong trade. `lookup()` is synchronous and returns `{ label: setId }`
when the fetch has not landed yet.

**`user:read:chat` alone is enough to read *any* channel's chat.** Moderator status is only
required for app access tokens. This is what makes "add a channel by name" work after a
single sign-in.

**EventSub subscriptions are bound to a session id.** A reconnect invalidates all of them and
they must be recreated; that is why one hub owns the socket for every channel.

**`keepalive_timeout_seconds` only appears in `session_welcome`.** Re-arming the watchdog from
later messages reverts to the default and can terminate a healthy socket. Retain the
negotiated value.

**A superseded socket must not drive reconnect logic.** After `session_reconnect`, closing the
old socket fires its close handler; without an identity check (`this.ws !== socket`) it
schedules a duplicate connection.

**Concurrent token refreshes must share one in-flight promise.** Several subscriptions starting
at once would each spend the refresh token and invalidate each other.

**The Client ID is a build constant, not user input.** A public OAuth client has no secret; the
id identifies the application and authorises nothing. It lives in `src/main/twitch/clientId.ts`,
overridable by `TWITCH_CLIENT_ID`. Asking a user to register an app is developer setup
masquerading as a feature. If this repo ever goes public, move the value to an untracked `.env`.

### YouTube

**Chat comes from the innertube endpoint the web player itself uses, not the Data API.**
`POST /youtubei/v1/live_chat/get_live_chat` with a continuation token, reached through
**youtube.js (`youtubei.js`)** rather than our own HTTP and HTML scraping. No key, no quota,
no sign-in. The library owns session setup, request signing and renderer parsing — the part
that silently rots when YouTube changes shapes — while `YouTubeChatFeed` owns the poll
cadence. The official `liveChatMessages.list` was not chosen because it needs a Google Cloud
key baked into the build, burns roughly 3 hours of streaming per day against the default
10,000-unit quota, and **is itself poll-based** — it would be no faster, only more limited.
Unofficial and liable to break, which is why it all sits behind `ChatFeed`.

**Resolve goes through youtube.js, not an HTML fetch.** `resolveChannel` builds a
`Reference` — a bare 11-char video id is used directly; anything else becomes a
`/@handle/live` or `/channel/UC…/live` URL, which `youtube.resolveURL()` turns into a
`videoId` — then `getInfo(videoId)` answers both remaining questions: `basic_info.is_live`
and `livechat?.continuation`. The earlier hand-rolled `ytInitialPlayerResponse` /
`conversationBar.liveChatRenderer` scrape is gone; do not reintroduce it.

**The three resolve outcomes map onto `ChannelLookup` deliberately.** No live video, not
live, or live with chat disabled are all retryable `offline`. Only a 404-shaped error is
terminal `missing` — matched by regex on the error message (`/404|not found|does not
exist/i`), since youtube.js does not surface a status code. Everything else is
`unreachable`.

**YouTube resolve accepts three identifier shapes**, not just handles: `@handle`, a `UC…`
channel id, and a bare 11-char video id. The video-id path skips `resolveURL` entirely, so
pasting a live watch link is the fastest way to connect.

**Live does not imply chat.** Plenty of big channels stream 24/7 with chat disabled — Sky News,
DW News, NASA and CBS News all return `is_live: true` and no `livechat`. That is a separate
outcome from "not streaming", and `resolveChannel` reports it with its own `offline` reason
("live chat is turned off for this stream") rather than as an error.

**`info.livechat.continuation` is Top chat, not Live chat.** `getInfo()` hands back the
watch page's continuation, which is YouTube's spam-filtered *Top chat* view — it both delays
and drops messages. The unfiltered token is on the first chat response:
`header.view_selector.sub_menu_items[1].continuation` (index 0 is Top chat and is `selected`
by default). `YouTubeChatFeed.prime()` switches to it on the first poll and seeds `RecentIds`
with that response's backlog instead of emitting it. Both titles are plain strings, so the
`=== 'Live chat'` match is safe.

**Never use youtube.js's `YT.LiveChat` class.** It reproduces youtube.com's UI pacing on
purpose: an empty response sleeps 2000ms, and `#emitSmoothedActions` withholds each already-
received message for up to 1000ms *before* emitting it, blocking the next request while it
drains. Measured on one stream, same method both ways: `LiveChat` p50 **7075ms** / p90 11313ms,
versus **1396ms** / 1946ms for our own loop over the same parser. Use
`yt.actions.execute('live_chat/get_live_chat', { continuation, parse: true })` and own the
cadence. Smoothing, if ever wanted, belongs in the renderer where it cannot stall fetching.

**Those latency figures are uncorrected for clock skew** and are not comparable to the
~780ms p50 recorded for the old hand-rolled transport, which was measured with the
`generate_204` skew pinning described below. Only compare numbers gathered the same way.

**youtube.js is ESM-only, and that is fine here.** Electron 44 ships Node 24.18.1, where
`require()` of ESM works natively, so it stays in `externalizeDepsPlugin` and never enters
the bundle — main stays ~79KB rather than absorbing 16MB. Do not "fix" this by bundling it.

**`retrieve_player: false`** on `Innertube.create` skips the signature-cipher work (and the
`meriyah` parse) that only video playback needs. Chat does not.

**youtube.js JIT-generates classes for renderers it does not know** and logs a multi-line
stack for each one. Noisy, non-fatal, self-healing — do not mistake it for a crash.

**Poll at 500ms, not the `timeoutMs` the server suggests.** YouTube answers `timeoutMs: 10000`;
honoring it delivers in 10s bursts. `clampPoll` pins the server's suggestion into
`[MIN_POLL_MS 250, MAX_POLL_MS 500]`, so in practice every poll lands on the 500ms ceiling —
the 250ms floor only applies if YouTube ever suggests something shorter. **Almost all of the
latency is our poll interval, not
YouTube's buffer** — measured with the clock pinned to the server's second-tick (+/-40ms), one
run, one chat:

| poll interval | p50 age | p90 | polls returning nothing |
|---|---|---|---|
| 200ms | 552ms | 784ms | 68% |
| 500ms | 782ms | 1185ms | 55% |
| 1000ms | 1091ms | 1777ms | 21% |

p50 tracks `interval/2 + ~250ms`, and the *minimum* observed age was **61ms** — a message posted
just before a poll arrives essentially instantly. So YouTube barely buffers; the delay is ours to
spend. 500ms is the chosen trade: sub-second, 2 req/s per channel. Dropping to 200ms buys only
~230ms for 2.5x the traffic.

**Clock skew will wreck this measurement if you let it.** `timestampUsec` is YouTube's clock, and
the `Date` header has 1-second resolution, so naive skew sampling is +/-500ms — enough to invert
the ranking of two poll intervals. Sample `generate_204` every 40ms until the header *ticks over*;
that pins the server's second boundary to the sampling interval. Two runs with naive correction
disagreed by 434ms and made 500ms look slower than 1s.

**Several YouTube channels at once is fine, up to at least 12.** Measured two ways: 3 real
live chats at 1s for 40s (114 requests, zero failures), and 12 concurrent pollers at 1s for
45s (503 requests, **11.2 req/s, zero failures**, p50 latency 60ms, p95 104ms). No throttling
observed at either level, and latency does not degrade with concurrency. Above 12 is untested
— assume nothing.

What bites first is **bandwidth, not the API**: ~5KB of JSON per poll per channel *even when
no messages arrive*, because the continuation token and tracking params dominate the response.
That is ~78KB/s decompressed at 12 channels. Cost scales with poll rate × channel count, not
with chat volume, so halving the poll rate halves the bill.

Two existing limits matter at scale: `restoreSaved()` caps at 20 sources, and it resolves
channels **sequentially** (`await this.add(...)` in a loop), so each saved YouTube channel adds
~1.3s to startup before the next one connects.

Providers self-stagger because each schedules its next poll after its own response returns.

**Jitter the offline recheck.** `restoreSaved()` adds every saved channel at startup, so
without jitter all offline channels would re-resolve in lockstep every 120s, each pulling
~130KB. Resolve is ~130KB on the wire gzipped (1.2MB raw), not free.

**Never percent-encode the `@` in a handle URL.** `resolveURL` is given
`youtube.com/@handle/live`; running the whole handle through `encodeURIComponent` yields
`%40handle`, and YouTube resolves *some* of those and 404s others — `%40LofiGirl` works,
`%40TheBurntPeanut` does not. The bug therefore looks like "that channel is broken" rather
than "our URL is wrong", and it survives any test that only checks one handle. Encode the
handle body, keep the `@` literal.

**YouTube identifiers are case-sensitive.** `UCSJ4gkVC6NrvII8umztf0Ow` and an 11-char video id
both break when lowercased, so `SourceManager` lowercases identifiers for Twitch only. Saved
channels round-trip through `config.json` with their case intact.

**YouTube author badges are member badges or nothing.** `LiveChatAuthorBadge` carries
`custom_thumbnail` (a member badge, `tooltip: "Member (5 years)"`, thumbnails at 16px and
32px and **not sorted by width** — sort before building `srcSet`) or, for moderator, owner
and verified, only an `icon_type` with no image. Those become text chips. YouTube has no
per-author colour of any kind, so every YouTube name is coloured from the renderer's default
palette.

**Only `is_custom_emoji` runs become emote fragments.** Unicode emoji also arrive as `emoji`
runs with `fonts.gstatic.com` thumbnails; rendering those as images would turn every 😂 into a
network fetch. Their `emoji_id` *is* the character — emit it as text.

**Only `LiveChatTextMessage` items are mapped.** `chatItem()` returns `null` for every other
renderer, so paid messages, memberships, stickers and gift purchases are silently dropped —
they are not partially supported, they are absent. `MarkChatItemAsDeletedAction` is the one
other action handled, and it becomes a `delete-message` moderation event. Adding super-chats
means adding cases to `chatItem` and a `monetary` mapping, not fixing something broken.

**Messages replay after a chat reload**, so `YouTubeChatFeed` keeps a bounded `RecentIds`
set. Without it, every stream-ended/restarted cycle re-injects the backlog.

### Kick

**One anonymous JSON call resolves a channel, and it is not Cloudflare-gated.**
`GET kick.com/api/v2/channels/{slug}` answers 200 to a plain Node `fetch` with no browser
User-Agent and no TLS-fingerprint tricks. An earlier note in this file claimed otherwise; it
was wrong when measured. `404` means the slug does not exist and is the only failure worth
reporting as an error.

**`chatroom.id` is not `channel.id`.** They match on old channels (xQc is 668/668) and diverge
on newer ones (adinross is chatroom 875062, channel 875396). Chat lives on
`chatrooms.{chatroom.id}.v2`. Only the chatroom is subscribed now that liveness is gone, but
the trap returns the moment anything reads `channel.id` again.

**7TV keys Kick by `user_id`, not by channel id.** `7tv.io/v3/users/kick/668` is a 404 for xQc;
`.../kick/676` is the emote set. Both numbers sit in the same payload and both look plausible,
so the wrong one reads as "this channel has no 7TV emotes".

**Kick sends the author's colour, and two badge arrays that mean different things.**
`sender.identity.color` is a hex string and is always present. `identity.badges` is
`{ type, text, count? }` with **no image url at all** — `moderator`, `vip`, `og`,
`sub_gifter` and `verified` are drawn by Kick's own UI as inline SVG, so there is nothing to
fetch and the text-chip fallback is the answer, not a missing feature. The one exception is
`subscriber`, whose image comes from the channel payload's `subscriber_badges` — match the
highest tier whose `months` is `<= count`, which is why `KickChannel` now carries those
tiers. `identity.badges_v2` is the newer array and *does* carry `image_url` (viewer levels);
render only entries with `selected: true`, which is Kick's own display rule — otherwise a
user's whole level history stacks up next to their name.

**Emotes are inline `[emote:id:name]` tokens in `content`**, carved out before links exactly
like every other platform. The image is `files.kick.com/emotes/{id}/fullsize`; the `/default`
variant returns 403.

**One Pusher socket carries every Kick channel.** `kickSocket` in `platforms/kick/connection.ts`
opens on the first room and closes when the last one leaves, so nothing upstream gains a
constructor argument. Verified: two channels multiplexed, dropping one left the other receiving.

**`activity_timeout` arrives only in `pusher:connection_established`** — same trap as Twitch's
`keepalive_timeout_seconds`. Retain it, ping when the socket goes quiet for that long, and
reconnect if no frame answers within the pong deadline.

**Kick chat is readable whether or not the channel is live.** The chatroom exists
independently of the stream, so `resolveChannel` never returns `offline` — a channel that
exists is `ok` and reports `connected`. `KickChannel` carries only `displayName` and
`chatroomId`; liveness is not modelled anywhere.

**`App\Events\MessageDeletedEvent` binds to `kick:${sourceId}:${event.message.id}`** and was
confirmed live — deleted messages struck through in the running app.

### Renderer UI

**The chrome is Ant Design v6; the chat rows are not.** `Tabs`, `Splitter`, `Modal`,
`Badge`, `Select`, `Input`, `Alert` and `Empty` build the tab strip, the add-channel modal
and the pane frames. `MessageRow` is deliberately left as hand-written
markup with Tailwind classes: it renders inside a virtualizer at 200 msg/s with up to five
badges a row, and every antd component reads `ConfigProvider` context and carries cssinjs
bookkeeping. Putting a `Tag` or a `Tooltip` in a message row multiplies that by the row
count. The pane *chrome* is cheap; the pane *contents* are not.

**Tailwind's preflight and antd fight, and `@layer` is what settles it.** Preflight resets
`button { background-color: transparent }`, which strips antd's buttons. `index.css`
declares `@layer theme, base, antd, components, utilities;` *before* `@import 'tailwindcss'`
(CSS allows `@layer` statements ahead of `@import`), and `main.tsx` wraps the tree in
`<StyleProvider layer>` so antd's runtime styles land in that `antd` layer — after `base`,
so antd beats preflight, and before `utilities`, so Tailwind classes still win over antd.
Verified in the running app: the primary button computes `rgb(87, 90, 208)`, not
`rgba(0, 0, 0, 0)`, and `document.styleSheets` reports the layer statement in that order.

**There is no sidebar. Tabs are the whole navigation, and `visibleIds` is the model.**
`store.visibleIds` is the set of chats on screen, in `sources` order. **A visible chat is
already "open" — clicking its tab must do nothing.** `showSource` returns the state
unchanged when the id is already visible; only a hidden tab replaces the set. The split
control calls `toggleSplit`, which adds or removes that chat alongside the others and
refuses to empty the set. An earlier version treated click as "focus" and wiped the split,
so clicking the second of two open chats hid both — that is the bug the no-op guard exists
to prevent. `setSources` reconciles: drops dead ids, jumps to a genuinely new channel, seeds
the first source on cold start. One pane renders bare; two or more render inside a
`Splitter` **with** per-pane headers, since the tab strip cannot name them all.

**antd marks one tab active; the app has several open.** `activeKey` is `visibleIds[0]`
purely to satisfy antd. Every open tab additionally gets a `tab-shown` class (applied in
`renderTabBar`) whose CSS mimics the active look, so the strip reflects what is on screen
rather than what was clicked last.

**Tab drag-and-drop is dnd-kit, not HTML5 drag.** Native `draggable` gives a floating ghost
image and drops outside a tab do nothing. `renderTabBar` wraps the bar in `DndContext` +
`SortableContext` (`horizontalListSortingStrategy`, `restrictToHorizontalAxis`) and clones
each tab node with `useSortable`'s ref/listeners — tabs slide and push their neighbours
aside, and `closestCenter` resolves a release past the last tab to the end rather than
nowhere. `PointerSensor` needs an `activationConstraint` distance (5px) or the sensor
swallows plain clicks and tabs stop selecting.

**Reordering must only ever permute what is already saved.** `SourceManager.reorder`
rewrites `config.channels` through `reorderedChannels()`, which sorts the *existing* saved
list into entry order and appends anything unmatched. An earlier version rebuilt the list
from live entries filtered by `PERSISTABLE_STATUSES`, which **silently deleted a saved
channel** that happened to still be `connecting` when the user dragged a tab — and the
anonymous display-name lookup below made Twitch slow enough to resolve that this was easy to
hit. A reorder is not the place to decide what is worth persisting.

**antd v6 renamed DOM internals, which breaks CDP driver scripts.**
`.ant-select-selector` is now `.ant-select-content` and `.ant-select-selection-item` is
gone; `.ant-modal-content` does not match either, though `.ant-modal` does. Opening the
platform dropdown needs a `mousedown` dispatched on `.ant-select-content` — a plain
`.click()` does not open it. Selectors copied from antd v5 answers return `null` silently.

**antd is a devDependency, not a dependency.** The renderer is bundled (no
`externalizeDepsPlugin` on that target), so it belongs beside `react` and `zustand`. Only
main-process packages that stay external — `electron-store`, `ws`, `youtubei.js` — are real
dependencies.

**The theme is one object, not scattered inline styles.** `theme.ts` maps the ink palette
onto antd tokens and exports `INK` for the few places that still need a raw hex (pane header
chrome, chat background, the sidebar divider). Reach for a token before a hex.

### Main process

**`electron-store` v11 is ESM-only** and this build emits CJS for main, hence the hand-rolled
`config.ts`. Tokens are encrypted with `safeStorage` (DPAPI on Windows). If no encryption
backend exists, tokens are kept in memory for the session rather than written in the clear.

**The config file is written then renamed**, so a crash mid-write cannot truncate it.

**Single-instance lock matters here** — a second instance would race the first for the same
window and the same token store.

**The renderer is untrusted by construction** (it renders remote chat content). Every IPC
handler validates its own arguments rather than trusting the preload. `openExternal` accepts
only `http:`/`https:` — never `file:`, never a custom protocol handler.

### Build and tooling

**There is no formatter or linter configured** — no Prettier, no ESLint, no `.editorconfig`.
The tree is consequently split between two styles: double quotes with semicolons
(`chat/watcher.ts`, `platforms/twitch/index.ts`, `platforms/kick/index.ts`) and single quotes
without them (`main/index.ts`, `shared/types.ts`, `platforms/twitch/channel.ts`) — sometimes
in the same folder. **Match the file you are editing**, and do not reformat a file wholesale
as a side effect of another change; `npm run typecheck` will not catch it and the diff buries
the real work.

**Path aliases are declared twice.** `@shared` (and `@` for the renderer) live in both
`electron.vite.config.ts` and the two tsconfigs. Adding or renaming one means editing both,
or the build and the typecheck disagree about whether the import resolves.

**Dependency versions are load-bearing.** `electron-vite@5` peer-caps at Vite 7, while
`@vitejs/plugin-react@6` requires Vite 8. Pinned: `vite@^7`, `@vitejs/plugin-react@^5`.
Bumping either blindly reintroduces the ERESOLVE conflict.

**`"type": "module"` is deliberately absent** so main and preload emit CJS. That keeps
`__dirname` working and lets the preload stay `sandbox: true`. Do not re-add it without
re-checking both.

**`npm install` can exit 0 without downloading the Electron binary.** Symptom:
`Error: Electron uninstall`. Check `node_modules/electron/path.txt` exists; fix with
`node node_modules/electron/install.js`.

**Bash heredocs eat one level of backslash.** `\\s` becomes `\s` (which JS collapses to `s`),
and `'\r\n'` becomes a literal CRLF that breaks the file. Use the Write tool, or build escapes
with `chr(92)`. This has caused both fake test failures and real syntax errors.

**Testing the IPC surface is not testing the app.** Calling `window.api.addSource(...)` over
CDP bypasses the components entirely and once hid a bug where the add button silently did
nothing. Drive real inputs and real buttons.

## Platform notes

Only Twitch needs the user to connect an account. The others need a *developer* credential
baked into the build, or nothing at all.

| Platform | User sign-in? | Build credential | Why |
|---|---|---|---|
| Twitch | **Optional** | Client ID | EventSub is never anonymous — every `channel.chat.message` subscription carries the reading user's `user_id`. Anonymous IRC is the signed-out fallback and loses nothing — badges resolve over anonymous GQL, not Helix. |
| YouTube | **No** | none | Reading chat goes through the innertube endpoint the web player uses — no key, no quota. A Google API key would only be needed for account-scoped calls, or to *send* messages (`liveChatMessages.insert` is OAuth-only). |
| Kick | **No** | none | The internal socket is anonymous. Kick's *official* API is OAuth + webhook, useless to a desktop app with no public URL. |

**The Data API stays unused for reading chat — but `streamList` is the one option that could
beat innertube.** Two different methods, and the distinction matters:

- `liveChatMessages.list` is polling. It returns a `pollingIntervalMillis` you honor, so it is
  no faster than the 2s innertube cadence, and it burns quota per call. Not worth it.
- `liveChatMessages.streamList` is **real server push over gRPC** — "push live chat messages to
  your client over a long-lived connection". It sends recent history on connect, then streams
  new messages. A dropped connection resumes by passing the last `nextPageToken` as `pageToken`.
  This would be lower-latency than anything polling can do.

`streamList` needs only an **API key** — the guide's sample offers "Using an API key" *or* an
OAuth token, so no Google sign-in is required. It takes a `liveChatId`, which means resolving
video → `videos.list?part=liveStreamingDetails` (1 unit) on top of the existing page fetch.

**Do not try to budget the daily quota into low latency — the arithmetic forbids it.** Quota is
10,000 units/day for all endpoints combined, resetting at **midnight Pacific Time** (a wall-clock
cliff, not a rolling window, so a late-evening PT stream straddles it). Even assuming the
*optimistic* 1 unit per `list` call, spreading 10,000 calls across a 24h day is one poll every
8.6s; across an 8-hour stream, one every 2.9s. At the widely repeated (but unverified) 5 units,
it is one poll every 43s / 14.4s. Every one of those is **worse than the ~780ms innertube gives
away for free**. Pacing the budget is sound bookkeeping and a losing strategy — a fixed daily call
budget cannot buy low latency. `streamList` escapes this only because it is one long-lived
connection rather than N calls.

**The blocker is that the quota cost is undocumented.** Verified against the cost table: the
`liveChatMessages` resource does not appear on it *at all* — not `list`, not `streamList`. The
widely repeated "5 units per list call" is community folklore, not Google's published figure.
Until someone opens a stream against a real Cloud project and watches the quota dashboard, the
cost of `streamList` is unknown, and a 10,000 unit/day ceiling makes that unknown decisive.
**Measure before adopting.** Keep innertube as the fallback either way.

The Data API also becomes unavoidable for *sending* messages, which innertube cannot do without
account credentials.

Hosted chat services (Botrix, StreamElements, Nightbot) can afford the official API because
they are server-side products: one OAuth app, a quota increase requested from Google, and the
cost amortised across many streamers who each sign in. A single-user desktop app has no server
and no raised quota, which is what makes innertube the right trade here.

**Kick has no official realtime chat.** Its public API is webhook-based, which a desktop app
with no public URL cannot use. The working route is the internal Pusher socket — see the Kick
invariants above. Unofficial and liable to break, which is why it sits behind `ChatFeed`.

Official references: <https://dev.twitch.tv/docs/api/> ·
<https://developers.google.com/youtube/v3/live/docs/liveChatMessages> · <https://docs.kick.com/>
(Kick's docs cover the public webhook API only — use them for auth and channel lookup, not
for chat transport.)

## Roadmap

Done: the full chat UI (verified at 200 msg/sec with ~117 rows in the DOM), Twitch end-to-end
over both transports, YouTube live chat by @handle / channel id / video id over innertube,
Kick over its Pusher socket, and the `chat/` framework that puts all three behind one
lifecycle with identical per-platform filenames.

Two separate caps, easy to confuse: `MessageBus` buffers **2,000** messages between 100ms
flushes (overflow is dropped with a warning), while the renderer store keeps **500** per
source (`DEFAULT_CAPACITY`) and evicts from the front. The load test above predates the
store cap; it exercised the DOM, not the 500-message ring.

Badges and author colours are **back** on all three platforms, resolved in main and verified
against live chat in the running app (70 badge images, zero broken; 27 distinct name
colours). Deliberately removed, in that order: live-state reporting; then
the mock platform and the in-browser simulator; then the third-party emote wiring (the
module itself is kept — see "Emotes (currently unwired)").

The renderer chrome was rebuilt on **Ant Design v6**, then the sidebar was replaced by a
browser-style tab strip: one tab per channel, `+` opens the add-channel `Modal`, `×`
removes after a confirm, and a pin on each tab drops that channel into a `Splitter`
alongside the active one. Status, held count and "clear this pane" live in the tab bar's
right extra slot. `MessageRow` stays hand-written for the reasons in "Renderer UI", and
Tailwind is still in the tree for the chat rows.

Next: reconnect emotes, then polish — settings persistence, sending messages back,
auto-update. The store already carries `showDeleted`, `showTimestamps` and `fontSize` with
**no UI bound to them** — an antd `Popover` of `Switch`es and a `Slider` in the tab bar's
right extra slot is the obvious home when settings persistence lands.

Deliberately not done yet: no settings persistence beyond channels, no message sending,
`electron-builder` has no config block, and CSP keeps `script-src 'unsafe-inline'` because
the dev server injects the React Refresh preamble (tighten to a nonce when packaging).
YouTube super-chats and memberships are **not** mapped at all — see the YouTube invariant on
`LiveChatTextMessage`. **Twitch is the only platform that emits a `MessageKind` other than
`chat`** — `subscription`, `raid`, `announcement` and `system` come from IRC `USERNOTICE`
(and the EventSub equivalent), `donation` from the `bits` tag. Kick and YouTube hard-code
`kind: 'chat'`, so any UI keyed on message kind is Twitch-only in practice.

Known rough edge: Kick reply excerpts are the raw `content` sliced at 60 chars, so a reply to
an emote-only message shows a bare `[emote:12345:name]` token. Pre-existing; fix by running
the excerpt through `toFragments` in `platforms/kick/index.ts`.

## Verifying changes

`npm run typecheck` is the first gate — both tsconfig projects must pass — but it does not
prove behaviour. Two techniques are used throughout this repo's history:

**Pure logic** — bundle a throwaway script with the already-installed esbuild and run it:

```bash
npx esbuild ./.t.ts --bundle --platform=node --format=esm --outfile=./.t.mjs --external:electron
node ./.t.mjs
```

Good for parsers and mappers. Delete the scratch files afterwards.

**The running app** — launch with a debugging port and drive the real UI over CDP:

```bash
npx electron-vite dev --remoteDebuggingPort 9333
```

**A running dev app does not pick up main or preload changes.** The renderer hot-reloads, so
a UI edit appears immediately — but `sources.ts`, `ipc.ts`, `config.ts`, the preload and
anything under `chat/platforms/` need the app killed and relaunched. Verifying a main-process
fix against a still-running instance reports the *old* behaviour and reads like the fix
failed; check `typeof window.api.<newMethod>` first if a new IPC method is involved.

Then connect to `http://127.0.0.1:9333/json` and use `Runtime.evaluate` (the `ws` package is
already a dependency). Prefer clicking real buttons over calling `window.api` directly —
calling the IPC surface bypasses the components and has hidden real UI bugs before. A driver
script must live inside the repo, not the scratchpad, or `import 'ws'` will not resolve.

There is **no browser-only mode any more.** `bridge.ts` is a thin `window.api` accessor that
throws outside Electron; the in-page simulator went with the mock platform.

The three YouTube resolve outcomes are all worth exercising, and each has a stable probe: a
live channel with chat (`@LofiGirl`), a real channel that is not streaming (`@Google` -> the
retryable `offline`), and a handle that does not exist (-> the terminal `error`).

**Do not clear the user's channels in a test probe.** Add and remove your own test channel
instead; wiping `listSources()` deletes their saved channels from `config.json`.

## Conventions

Code is comment-free by preference — naming should carry the meaning, and durable gotchas
belong in the "Invariants" section above rather than inline. When a change turns up
something non-obvious, add it there instead of leaving a comment. A `clean-code` skill is
installed at user level covering naming, function size, SOLID and error handling.

Windows line endings: `.gitattributes` normalises to LF in the repo, so `git` warns about
CRLF conversion on nearly every commit. That is expected.
