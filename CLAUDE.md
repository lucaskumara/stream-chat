# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A unified live chat client for Twitch, YouTube and Kick, which also relays one OBS stream to
all three. Electron + React 19 + TypeScript. Single-user desktop app: no backend, no
database, and **no accounts anywhere** — chat is read anonymously and restreaming needs only
a pasted stream key.

The code is deliberately comment-free. The "Invariants" section below is where the "why"
lives — read it before touching the message pipeline, emotes, or the relay.

## Commands

```bash
npm run dev        # electron-vite dev — launches the app and the renderer dev server
npm run typecheck  # all three tsconfig projects; the fastest correctness gate
npm run test       # vitest, the pure-logic suite — a few hundred cases in ~1.5s
npm run test:watch # the same suite, re-running as files change
npm run build      # typecheck, then build main + preload + renderer
```

Narrowing the suite while working on one thing — the whole run is ~1.5s, so this is for
focus rather than speed:

```bash
npx vitest run tests/main/chat/platforms/twitch/irc.test.ts   # one file
npx vitest run tests/main/chat/platforms                      # one directory
npx vitest run -t "code point"                                # one case, matched by name
npx vitest tests/renderer/store.test.ts                       # one file, watched
```

```bash
npm run pack       # electron-builder --dir — an unpacked app under release/, no installer
npm run dist       # the full installer for the host platform
```

Both run `npm run build` first, so `dist` is also a typecheck. Artifacts land in `release/`,
which is gitignored. Only the Windows target has been produced — see "Packaging" below.

**Vitest** runs the pure-logic suite; there is no DOM or component testing yet. See
"Verifying changes" below for what the suite does and does not cover, and for how the
rest of this repo gets checked.

## Three TypeScript projects

`tsconfig.node.json` (main + preload + shared) and `tsconfig.web.json` (renderer + shared).
`npm run typecheck` runs both and **both must pass** — a change to `src/shared` is checked
twice, under different `lib`/`types`. Shared code therefore cannot use Node or DOM APIs.

`tsconfig.test.json` is the third, covering `tests/` alone. It exists because the suite lives
outside `src` and would otherwise be typechecked by nothing. It is deliberately **not**
`composite` and **not** referenced from `tsconfig.json`: a composite project must list every
file in its program, and the tests pull half of `src` in through their imports, so composite
makes `tsc` demand `src` be added to the test project's `include` as well. It is a checking
pass, not a build input.

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
session is shared across channels (Kick's Pusher socket, YouTube's `Innertube`), and
`badges.ts` wherever the platform's badge art has to be resolved rather than read off the
message — which is now all three. Twitch
keeps its transport in `irc.ts` — hub, feed and mapping together — plus `badges.ts` and
`emotes.ts`. Mapping is **not** a separate file: it
lives beside the feed that produces it, as module-level `toChatMessage` / `toFragments`
functions under the exported class.

```
src/shared/          types plus channel.ts (the "add a channel" parser, used by both processes)
                     and obs.ts (the dock URL grammar, used by both processes)
src/main/chat/       the framework:
  watcher.ts           ChatWatcher, BaseChatWatcher, ChatFeed, FeedSink, PollingFeed,
                       and messageId() — the single id composer
  channel.ts           Channel (abstract base), ChannelLookup, RetryPolicy
  socket.ts            RoomSocket — join/leave/keepalive/reconnect for multiplexed sockets
  links.ts             splitLinks
  fragments.ts         plainTextOf + REPLY_EXCERPT_LIMIT, shared by every mapping
  backoff.ts           reconnectDelayMs, shared by every socket
  recent-ids.ts        bounded replay guard (YouTube only, today)
  index.ts             createWatcher registry + PlatformServices
  platforms/twitch|youtube|kick/
src/main/             bus.ts (MessageBus), backlog.ts, sources.ts (SourceManager), ipc.ts,
                      config.ts, lifecycle.ts, index.ts (app bootstrap + service construction)
src/main/obs/         server.ts — the loopback link server OBS docks connect to
src/main/broadcast/   relay.ts (ffmpeg arguments, TS inspection) + index.ts (the Relay)
src/main/emotes/      7TV + BTTV, reached through Channel.emotes — see "Emotes" below
src/renderer/src/     App.tsx, zustand store.ts, theme.ts (the platform colour, name and
                      event-accent tokens no CSS variable can carry), search.ts (the pane
                      filter grammar), connect.ts (the per-platform channel parse),
                      merge.ts + layout.ts (the merged column and the column model),
                      components/ and views/
src/renderer/src/obs/ the OBS dock page — a second renderer entry, no antd
```

The rule that keeps this from drifting: **wire code lives in the platform folder, and
nothing else does.** The relay, the OBS link server and the settings store are subsystems of
their own — they are about video, docks and configuration, not about a chat transport.

**`RoomSocket` is the shared multiplexing socket.** `chat/socket.ts` owns the whole pattern:
`join(room, handler)` returns a leave function, the first join opens the socket, the last
leave closes it, and reconnect/backoff/keepalive are handled once. Subclasses fill in five
hooks — `onOpen`, `onFrame`, `sendJoin`, `sendLeave`, `sendKeepalive`. Both Kick's Pusher
socket and Twitch's `IrcHub` extend it, which is why the two "retain the negotiated silence
timeout" invariants below are really one code path (`negotiateSilence`).

**`PlatformServices` is the injection seam.** `main/index.ts` constructs `IrcHub` and hands
it to `SourceManager` as `{ twitch: { irc } }`. `createWatcher` in `chat/index.ts` passes it
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

**Every feed composes message ids through the same function.** `messageId(platform,
sourceId, nativeId)` in `chat/watcher.ts`. This is convention, not construction — there is
no per-platform wrapper forcing it, so a new transport can drift. Never inline the template
literal.

**Links are split out of text fragments only, after the platform's own emotes are carved
out.** Running the URL regex over the whole message is exactly what the fragment design
exists to avoid.

**Badges are resolved to image URLs in the main process; the renderer only decides colour.**
Every platform emits `ChatMessage.badges` as `{ label, id?, url?, srcSet? }` — already looked
up against that channel's badge set. A badge with no `url` is not a bug: Kick's `moderator`,
`vip`, `og`, `sub_gifter` and `verified` have no image anywhere in its API (its own UI draws
inline SVG). `authorColor`, by contrast,
is set **only when the platform actually sends one** — Twitch's `color` tag is empty for
users who never picked one, and YouTube has no such concept at all. The renderer fills the
gap from `DEFAULT_NAME_COLORS` keyed on a hash of `authorId`, which is what Twitch's own
client does. Do not invent a colour in main; a message either carries the user's choice or
carries nothing.

**`Badge.id` is what a badge with no image falls back *through*, and it is the platform's own
set name — not the label.** `BADGE_GLYPH` in `MessageRow` maps a set name onto a coloured
lucide glyph; anything unmapped still gets the three-letter chip, which is the only `title`
left in a message row. The id has to come from main because the label does not identify
anything — Kick sends `text: "Broadcaster"`, Twitch's unresolved fallback carries the set id,
and a label match would break the moment a platform changed its wording.

**Kick and YouTube draw their own badge artwork, pulled off the site at runtime.** Neither
platform gives chat an image url for its role badges — both draw them as inline SVG in their
own UI — so `platforms/kick/badges.ts` and `platforms/youtube/badges.ts` fetch the site's icon
set, turn each icon into a `data:image/svg+xml` uri, and hand it back as `Badge.url`. Nothing
downstream changed: it flows through the same `<img>` that renders a Twitch badge, into the
dock backlog, into the OBS page. `img-src` already allows `data:` in all three CSPs. Both
modules are named and shaped like `platforms/twitch/badges.ts` — `load` / `ready` / `lookup`,
a module singleton, a bounded `ready()` deadline — so the three read the same.

**A checked-in copy of the art was the wrong answer, and the reason is staleness.** An earlier
version generated `renderer/components/badge-art.ts` once and committed it; it goes out of date
the day either site redraws a badge, silently and with nothing to notice it. Fetching costs one
sweep per session, only when that platform is actually open, and a failure degrades to the
`BADGE_GLYPH` lucide fallback — which is where the app was anyway.

**The wire type is not the icon name on either platform, and that is the trap.** Kick's
broadcaster icon is `HostBadge` — a **microphone**, not a camera — so a name match finds
nothing and a guess from Twitch's shapes gets it wrong. Kick's own
`{broadcaster:3, moderator:4, vip:5, og:6, subscriber:7, founder:8, sub_gifter:9, sidekick:10,
verified:11}` map, in the same bundle, is what joins the two. YouTube is the same shape:
`MODERATOR` resolves to `live-chat-badges:moderator` (a wrench, a 16px set) and `VERIFIED` to
`yt-sys-icons:check_circle_thick` (a 24px set) — two different sets with two different sizes,
so the viewBox has to come from the set rather than a constant.

**Three things make these fetches work, and each one fails quietly if missed.**

- **Kick's set is split across chunks.** The icons live in ~70 hashed Next chunks with no
  stable name, and *not all in one*: `HostBadge` and `VerifiedBadge` are in different files.
  Stopping at the first chunk that answers loses `verified` and `bot` without an error.
  `sweepChunks` runs 8 workers, merges, and stops once every wanted name is in hand — ~5MB in
  under a second.
- **YouTube's bundle is 8MB and must be streamed.** The sets sit ~1.4MB in, so the body is read
  and abandoned as soon as every wanted set has *closed*. Stopping on the first `name=\"`
  instead — the obvious mark — halts before the sets even begin and yields nothing.
- **YouTube's `live_chat` page needs a browser User-Agent.** Without one it answers a 1.4KB
  stub with no script tags, at `200 OK`, so it reads as "the icons moved" rather than "we were
  served the no-JS page". With one it is ~227KB.

**The founder badge's texture has to go.** Kick hangs a 240px base64 png off an SVG `pattern`
for a soft-light sheen: 66KB of its 67KB, invisible at 17.6px, and it would otherwise sit in
every message carrying that badge. `stripTexture` drops every `<image>`, `<pattern>` and
`mix-blend-mode` path. Everything else is kept verbatim, gradients included.

**`Badge.url` carrying a data uri is affordable because role badges are rare.** Measured on
eight live Kick chatrooms, 2461 messages: 1211 `subscriber`, 376 `sub_gifter`, 72 `moderator`,
48 `vip`, 36 `founder`, 15 `verified`, 5 `og`, 3 `bot`. Only ~7% of messages carry a badge whose
art is inlined, so at 50 msg/s the extra IPC is single-digit KB/s — far cheaper than the
out-of-band delivery it replaced the need for.

**Badge images keep a square box but must not be stretched into it.** The box is
`h-[1.1em] w-[1.1em]` so the row reserves space before the image loads and nothing shifts
when it does — but the default `object-fit: fill` then stretches art that is not square.
Measured across 48 live Kick badge images, 47 are square and one is not: level 52 is
258x283, and was being widened 10%. `object-contain` letterboxes it instead, which keeps
both the reserved box and the artwork's proportions. `w-auto` would also fix the stretch
and reintroduce the layout shift.

**`BADGE_GLYPH` is the fallback for all three platforms now, and it is Twitch-shaped.** It is
reached when a fetch has not landed or has failed, and by the badges no site ships art for:
Kick's `sub_gifter`, which Kick colours by *count* through its own `getGiftBadgeMainColor`
(1-4 green, 5-9 teal, 10-24 purple, 25-49 pink, and up), and YouTube's `OWNER`, which has no
icon at all — YouTube tints the owner's *name* instead, so it keeps the text chip.

**The legibility lift blends toward white — it must not scale channels.** Platform-chosen
names are picked against that site's own background, so half of them are illegible on ours.
`readable` in `renderer/contrast.ts` raises anything under `LUMINANCE_FLOOR`. Multiplying
each channel by a boost factor (the shape this code had originally) cannot lift a saturated
colour at all: `#0000FF` is already at 255 on its only lit channel, so it came out unchanged
and unreadable — and `#0000FF` is in the default palette, so it is not a rare case. Blending
toward white by `(floor - luminance) / (1 - luminance)` lands every hue exactly on the floor
and keeps the hue. Verified in the running app: `#0000FF` renders `rgb(90, 90, 255)`.

**On light, the same function scales down, and that direction *is* exact.** The luminance
here is linear in the channels, so multiplying all three by `ceiling / luminance` lands the
colour on `LUMINANCE_CEILING` and leaves the hue untouched — no blend needed. The two
directions are not symmetric: scaling can only darken, blending is the only way up. Both
`nameColor` and `readable` take the resolved `ThemeMode`, and `MessageRow` runs the badge
glyph colours, the event badge text and the monetary chip through `readable` too, so every
piece of chat-row art inverts with the palette. The mode is an optional prop defaulting to
`'dark'`: the OBS dock omits it, which is what it renders on.

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

**Adding a channel is checked twice, and the two checks fail differently.**
`parseChannelInput` in `src/shared/channel.ts` decides whether the text is *shaped* like a
channel — reached from the renderer through `parseForPlatform` in the "watch another channel"
field, which also refuses input resolving to a platform other than that pane's — `TWITCH_LOGIN`
is 3-25 of `[a-z0-9_]`, `KICK_SLUG` 2-25, a YouTube handle 3-30
after the `@` — and rejects in the renderer without an IPC call. Resolve then decides whether
the channel *exists*. A name that is too long and a name nobody owns therefore surface
different messages from different processes, which is worth knowing when a fix to one appears
to do nothing to the other.

**Only `missing` refuses the add; everything else keeps the tab.** `BaseChatWatcher.attach`
throws `MissingChannelError` on a terminal lookup, `SourceManager.add` catches exactly that
one, discards the entry it had already inserted and rethrows so the modal shows the reason
and no dead tab is left behind. `unreachable` and `offline` keep the tab and retry, which is
why the catch cannot simply reject on any connect failure — a network blip while adding
`@LofiGirl` must not read as "no such channel". `scheduleAttach` has to swallow the same
error, because a later re-resolve can go `missing` (a channel deleted mid-run) and the status
event has already reported it.

**The renderer has to strip Electron's IPC wrapper before showing an error.**
`ipcRenderer.invoke` rejects with `Error invoking remote method 'sources:add': Error: …`, so
`remoteMessage` in `bridge.ts` trims that prefix. It did not matter while `add` only threw on
malformed input nobody hit; it matters now that a typo'd channel name is the common path.

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

### Emotes

**Third-party emotes hang off `Channel.emotes`, and that is the whole seam.** A channel
returns an `EmoteBinding { platform, channelId }` or `null`; `BaseChatWatcher.open` fires
`thirdPartyEmotes.load(binding)` on connect, and each feed wraps its outgoing message in
`withEmotes(message, channel)` from `chat/watcher.ts`. `thirdPartyEmotes` is a module
singleton, the same shape Kick's socket and YouTube's `Innertube` use, so no watcher gained
a constructor argument. A platform that cannot supply an id returns `null` and simply gets
no third-party emotes.

**The binding id is not the channel id you already have, on any platform.** 7TV keys Twitch
by the numeric **user id** — which the anonymous path did not carry until `resolveChannel`
started asking GQL for `user(login:){id displayName}` in one query. YouTube is keyed by the
`UC…` id (`info.basic_info.channel_id`), Kick by `user_id` from the channel payload, not by
`channel.id` and not by `chatroom.id`. Each subclass owns that mapping in its `emotes`
getter.

**`applyEmotes` runs last, over text fragments only.** Native emotes and links are already
carved out by then, so it walks whitespace-separated tokens in the remaining text and cannot
disturb an emote or link fragment. Order matters: running it earlier would let a 7TV name
swallow part of a URL.

**A 404 from 7TV means the channel has no set, not that emotes are broken.** Measured:
`theburntpeanut` has none on Kick, Lofi Girl none on YouTube, while `xqc` has 966 on Kick and
`theburntpeanut` 259 on Twitch. `loadChannel` always loads the global set first, so a
channel with no set of its own still resolves the 45 global 7TV emotes. BTTV 404s the same
way for a channel with none.

**Native emotes are separate and always worked.** Each platform's own emotes (Twitch's emote
tags, Kick's `[emote:id:name]` tokens, YouTube's `is_custom_emoji` runs) are parsed in that
platform's `toFragments`. The third-party layer is additive.

**Matching is whole-token and case-sensitive.** Substring matching turns `GIGACHAD` inside a
longer word into an image; case folding collides distinct emote names.

**7TV calls YouTube `google`, not `youtube`.** Passing `youtube` returns `400 invalid platform`,
which reads like "YouTube unsupported" and is not. A missing user returns `404`; the two are
easy to confuse. Valid platform values: `TWITCH, DISCORD, GOOGLE, KICK`.

**7TV keys Kick by `user_id`, not by channel id.** `7tv.io/v3/users/kick/668` is a 404 for xQc;
`.../kick/676` is the emote set. Both numbers sit in the same payload and both look plausible,
so the wrong one reads as "this channel has no 7TV emotes". `KickChannel` carries `userId`
for exactly this.

**BTTV is Twitch-only** and keys channels by Twitch user id. It is still worth having — some
large channels have zero 7TV emotes and hundreds of BTTV ones.

**`ThirdPartyEmotes` takes a binding, not loose arguments.** `load(binding)` and
`lookup(binding, name)` replaced the old `loadChannel(platform, channelId)` /
`lookup(platform, channelId, name, enabled)` pair. The `enabled` filter and `counts()` were
dead on arrival — no caller ever used them, because filtering happened at draw time in
`MessageRow` — and went with the rewiring.

### Twitch

**Twitch chat is read anonymously, and GQL is what supplies the properly-cased display
name.** There is no token anywhere, so `resolveChannel` would otherwise build
`new TwitchChannel(login, login, '')` and the tab would read `theburntpeanut` instead of
`TheBurntPeanut`. `anonymousLookup` asks `gql.twitch.tv` for `user(login:){id displayName}`
over the same anonymous client id the badges use — hence `platforms/twitch/gql.ts`, which
owns the endpoint, the web client id and the `data` unwrapping for both callers.

**That same query is the anonymous existence check, and the two failure shapes are not the
same failure.** GQL answers `{ data: { user: null } }` for a login nobody owns, which is a
terminal `missing`; a request that never landed (`twitchGql` returning `null`, or throwing)
is *not* evidence about the channel, so it still falls back to the login and connects. That
split is the whole point: without it, IRC happily joins a channel that does not exist and
the tab sits at `connected` and silent forever, while treating an outage as `missing` would
tell a user their channel was deleted because gql.twitch.tv had a bad minute. A GQL outage
therefore still costs casing, not the connection.

**A rename after `connect()` returns has to be pushed, or nothing sees it.**
`SourceManager.add` copies `watcher.label` once, after connect. Anything that renames later
— a YouTube channel that only resolves when it goes live — was invisible until the status
handler in `eventsFor` started re-reading `watcher.label` on every status event.

**One transport: anonymous IRC.** `TwitchChatWatcher.createFeed` always builds
`TwitchIrcFeed`. There was a second, EventSub, reached when a token existed; it was deleted
with the accounts subsystem, along with `auth.ts`, `state.ts`, `helix.ts` and `eventsub.ts`.
Nothing was lost — the two produced identical output, badges and colours included, because
both resolved through the same `badges.ts` and IRC's `color` tag carries what EventSub's
`color` field did. Restoring it means writing a new feed, not rewiring an old one.

**`badges.twitch.tv` is dead — it does not even resolve (`ENOTFOUND`).** Every old chat
client used `badges.twitch.tv/v1/badges/global/display`; it is gone, so do not reach for it.
Helix `/chat/badges` still works but needs a token, which this app no longer has at all. `badges.ts` therefore goes to **`gql.twitch.tv/gql` with the public
web Client ID** `kimne78kx3ncx6brgo4mv6wki5h1ko` — anonymous, no token, and one raw query
returns global badges *and* `user(login:).broadcastBadges` together. Raw queries work there;
persisted-query hashes do not (`PersistedQueryNotFound`), so do not "optimise" it into one.

**Badges are keyed `setID/version`, and the channel set wins over the global set.** IRC sends
`badges=subscriber/12,moderator/1`, which composes that key. A channel's `broadcastBadges` only ever contains `subscriber` and `bits` — every other
set is global — but subscriber tiers and cheer tiers are exactly the ones that differ per
channel, so checking the channel map first is not optional.

**The Twitch feed `await`s `twitchBadges.ready()` before joining, and the deadline is the
whole point.** `lookup()` is synchronous and resolution happens once, at map time, into an
immutable `ChatMessage` — so a message mapped before the badge fetch lands keeps
`{ label: setId, id: setId }` **forever**. It does not fill in later; an earlier version of
this note claimed it did. That window is not theoretical: `IrcHub` is shared, so the second
Twitch channel added joins an already-open socket in ~50ms while the GQL badge query takes
200-400ms, and the first second of a busy chat rendered as chips. `ready()` races `load()`
against `READY_DEADLINE_MS` (1.5s), so a dead or slow gql.twitch.tv costs a bounded delay
before joining rather than a permanently unbadged first second. The feed also needs a
`stopped` guard, because `stop()` can land during that await. Verified live on a 50k-viewer
channel: 26 badge images including channel subscriber tiers, zero fallbacks in the first frame.

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

**We own youtube.js's parser error handler, and in a packaged build that is not cosmetic.**
`connection.ts` calls `Parser.setParserErrorHandler` before the session is created. The
library's default handler builds its message out of `packageInfo.bugs.url` — and
**electron-builder strips `bugs` from every dependency's `package.json` on the way into
`app.asar`** — so `packageInfo.bugs` is `undefined` and *the error handler itself throws*.
Live chat carries unknown renderers constantly (`GiftMessageView`,
`LiveChatReportModerationStateCommand`), so in the installed app every poll threw and every
YouTube tab sat at `error: Cannot read properties of undefined (reading 'url')`. `npm run dev`
cannot reproduce it: `node_modules` on disk still has the field. Our handler also replaces the
default's multi-page JIT-generated TypeScript class dump with one deduped line per fault —
those faults are still non-fatal and self-healing, just quiet now.

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

Providers self-stagger because each schedules its next poll after its own response returns.

**Jitter the offline recheck.** Without jitter, several offline channels added together
would re-resolve in lockstep every 120s, each pulling ~130KB. Resolve is ~130KB on the wire
gzipped (1.2MB raw), not free.

**Resolving the handle is also the existence check, and the name is learned on two
different paths — both of which have to carry it.** `resolveURL('/@handle/live')`
answers a browse endpoint carrying `browseId` when the channel exists and 404s when
it does not, which `classifyFailure` turns into the terminal `missing`. Which id
comes back is **not** a clean live-versus-dark split, and assuming it was is what
left tabs showing raw handles: a channel whose stream has recently *ended* still
resolves to that stream's `videoId` and carries no `browseId` at all — measured on
`@excorpse`, which answered `videoId` with `is_live: false`. So:

- **`browseId` only** — `channelName(browseId)` fetches the title through
  `getChannel`, cached in a module-level `Map` because an offline channel
  re-resolves every couple of minutes and its title is the one thing that does not
  change.
- **`videoId`** — `inspectStream` reads `info.basic_info.author`, which is present
  whether or not the video is live, and must put it on its two `offline` returns as
  well as the `ok` one. Dropping it there is exactly the bug above: the name was in
  hand and thrown away, so the tab read `@excorpse` instead of `Excorpse` until the
  channel happened to go live again.

`ChannelLookup`'s `offline` variant carries the optional `displayName` for exactly
this, and `BaseChatWatcher` renames on it before firing the status event.

**Never percent-encode the `@` in a handle URL.** `resolveURL` is given
`youtube.com/@handle/live`; running the whole handle through `encodeURIComponent` yields
`%40handle`, and YouTube resolves *some* of those and 404s others — `%40LofiGirl` works,
`%40TheBurntPeanut` does not. The bug therefore looks like "that channel is broken" rather
than "our URL is wrong", and it survives any test that only checks one handle. Encode the
handle body, keep the `@` literal.

**YouTube identifiers are case-sensitive.** `UCSJ4gkVC6NrvII8umztf0Ow` and an 11-char video id
both break when lowercased, so `SourceManager` lowercases identifiers for Twitch only.

**YouTube author badges are member badges, or art fetched off youtube.com.** `LiveChatAuthorBadge` carries
`custom_thumbnail` (a member badge, `tooltip: "Member (5 years)"`, thumbnails at 16px and
32px and **not sorted by width** — sort before building `srcSet`) or, for moderator, owner
and verified, only an `icon_type` with no image. Moderator and verified are filled in from
YouTube's own icon sets — see "Kick and YouTube draw their own badge artwork" above — and
`owner` stays a text chip because YouTube has no owner icon to fetch. YouTube has no
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

### OBS links

**Every chat is reachable at `http://localhost:4568/chat/<platform>/<channel>`, and one
URL is one chat.** `ObsServer` in `main/obs/server.ts` is an `http` server on loopback with
a `ws` upgrade at `/socket`. There is deliberately **no combined endpoint** — OBS already
docks, floats and snaps panels, so a multi-column layout inside one page would reimplement
its window manager, worse. Two chats side by side is two docks.

**The URL is a lookup key, not an identifier, and that is why it needs no `@`.**
`obsMatchKey` in `shared/obs.ts` strips a leading `@` and lowercases; both the path segment
and the stored identifier go through it, so `/chat/youtube/LofiGirl`,
`/chat/youtube/lofigirl` and `/chat/youtube/@LofiGirl` are one chat. Safe only because both
sides are *already resolved* — `normalizeIdentifier` in `sources.ts` still must not
lowercase YouTube, whose `UC…` ids and video ids are case-sensitive on the wire. Two
functions, two jobs; merging them gives either a dark dock or a broken resolve. The same
`@`-dropping rule already exists for `author:` in `search.ts`.

**A dock binds to platform + key and re-resolves, never to a `src-N`.** Source ids are
session-scoped, so a channel removed and re-added gets a new one while the pasted OBS URL
does not change. `broadcastSources` calls `obs.sourcesChanged()`, which rebinds every client
— which is also why a dock opened *before* its channel is added lights up when it appears,
and falls back to "waiting for …" when the tab is closed. Verified live in both directions.

**`findByKey` takes the first match, on purpose.** Nothing stops the same channel being
added twice, and the two entries produce distinct message ids for one message. Without the
first-match rule a dock double-prints everything the day that happens.

**A WebSocket handshake is not subject to CORS.** Any page the user has open could otherwise
read their chat off loopback, so `allowedOrigin` accepts only this server's own origin (and
the dev server's). A missing `Origin` is allowed — that is a local process, not a browser,
and browsers cannot forge the header. Verified: foreign origin 403, own origin 101.

**Main keeps a backlog now, and only for this.** `backlog.ts` holds the last 200 messages per
source; the renderer's 500-message ring is no help to a page with no store. It is replayed in
the `sync` frame on connect — measured at 57 rows within 1.2s of load, which no live chat
delivers. Moderation applies to it too, by *removing* the message rather than marking it, so
history replay carries no strikethroughs for deletions that predate the dock.

**`MessageBus.attach(window)` is now one sink among several, and sinks filter themselves.**
The window takes every batch; a dock takes one source. The 100ms flush interval and the 2,000
message overflow cap are unchanged — and matter more over a socket, not less. The timer runs
while any sink exists, so buffers are cleared on the last removal rather than on `detach()`.

**The dock page is a second vite renderer entry, and it shares almost nothing.** `obs.html` plus
`src/renderer/src/obs/` reuse `MessageRow` and `index.css` and nothing else from the chrome.
Measured on the built output: the dock chunk is 7.4KB and shares only the React chunk, while
antd's 1.49MB chunk stayed behind in the app's entry. That measurement predates v2 removing
antd from the chrome, so the saving is now much smaller — but the rule still holds for
whatever the app entry grows next, and the dock has no reason to carry it. Rendering is a
plain bottom-pinned list
capped at 200 — no virtualizer, which a dock does not need and which is a dependency the entry
would otherwise carry.

**Renderer assets are emitted with a relative base**, because the main window loads over
`file://`. So the page served at `/chat/twitch/xqc` asks for `/chat/twitch/assets/x.js`.
`assetName()` takes everything from the last `/assets/` segment, which is why the packaged
build works at all — and it is a path the dev server never exercises, since dev proxies
everything to vite. Test it packaged or not at all.

**The link server serves the page itself in dev too, by proxying to the vite dev server.** One
URL shape in both, so the link copied out of the app is the link that works in OBS either way.
Everything vite emits is absolute in dev and relative in the build; both land on the same
handler.

**Main builds the link, not the renderer.** `obs:link` returns a finished URL or `null`, so the
port and the host spelling live in exactly one place. The port scans 4568..4577 on collision and
is *not* persisted — a shifted port means re-copying links, which has never happened because
the previous instance is gone by the time the next one binds. 4568 itself is arbitrary: a quiet
high port, deliberately clear of OBS WebSocket's own 4455 (and the older 4444).

**Both loopback families are bound, and that is what makes `localhost` cheap.** Windows resolves
`localhost` to `::1` first, so an IPv4-only listener costs every connection a failed attempt
before it falls back — measured at 219ms against 13ms. `start()` binds `127.0.0.1` first (that
scan settles the port), then joins `::1` on the same port best-effort, so a machine with IPv6
off simply keeps the fallback it already had. Never widen this to `0.0.0.0` or a bare
`listen(port)` to solve a routing problem: that publishes the user's chat to the whole LAN.
`allowedOrigin` accordingly accepts all three spellings of this server's own origin.

**Query parameters dress the dock; the path is the whole contract.** `size`, `timestamps` and
`transparent` are optional, and a link carrying none is a working dock. `transparent=1` is what
makes the same URL usable as an on-stream browser *source* rather than a dock. Watch the
default: `Number(null)` is `0` and `Number.isFinite(0)` is true, so guarding only on finiteness
silently snapped every dock to the smallest font in `CHAT_FONT_SIZES`.

### Broadcast (the relay)

**Ingest and fan-out are separate processes, and that separation is the whole design.** One
ffmpeg holds OBS's RTMP connection and hands the stream to us as MPEG-TS on stdout; one more
ffmpeg per platform takes those bytes on stdin and pushes them onward. Switching a platform
on or off starts or kills only its own process, so **OBS never sees a disconnect**. A single
`tee` cannot do this — its outputs are fixed at spawn, so changing the set meant killing the
process OBS was connected to, dropping every platform and forcing OBS to reconnect. Measured
before and after: with the tee a toggle ended the stream everywhere; now the producer stays
connected across on, on-again and off.

**The ingest listens from launch, not from a switch.** That is what lets the Broadcast page
report "Receiving from OBS" before any platform is chosen, which is the question a user
actually has when setting an encoder up. `listening` and `receiving` are separate fields for
the same reason.

**MPEG-TS between the two, not FLV.** A platform switched on mid-stream has to join a stream
already in progress, and TS repeats its PAT/PMT so a late reader can find the streams without
having seen a header. Still `-c copy` throughout — no transcode anywhere in the chain.

**A destination is started at a video keyframe, never mid-GOP, and the relay parses the
transport stream to know where that is.** Starting anywhere else hands ffmpeg an incomplete
access unit with no SPS/PPS: it reports "non-existing PPS 0 referenced" forever and either
forwards corrupt frames or refuses with "dimensions not set" and sends nothing. Measured on
a 30s keyframe interval: 122 PPS errors and 0 MB delivered before, 0 errors and 22 MB after.

**The keyframe must be found on the *video* PID, which is why the PAT and PMT are parsed.**
`random_access_indicator` is set on audio packets too, so matching it on any PID starts the
destination at an audio access point — which fails exactly as badly as not aligning at all,
and cost a full debugging round to notice. `programMapPid` reads the PAT for the PMT's PID,
`videoPidFrom` reads the PMT for the stream typed 0x1b (H.264) or 0x24 (HEVC).

**A joining destination is primed with the tables *only*, then the stream from the keyframe
packet itself.** The tables have to reach it first or it has a complete access unit and no
idea what format it is in — but handing over every packet since the last PAT also hands over
partial PES fragments of the other streams, and ffmpeg rejects those: "Packet corrupt", then
"Packet is missing PTS", then "Error submitting a packet to the muxer: Invalid argument" and
nothing is delivered. The old version passed a test by luck and failed on a different frame
rate. `lastPat` and `lastPmt` are kept, and the media starts at `keyframeAt`, not after it.

**Waiting for a keyframe is why the probe settings are now small.** They were briefly
`-analyzeduration 30000000 -probesize 50000000` to let a mid-GOP destination wait for a
keyframe, and that *worked* while being actively harmful: ffmpeg sat reading while the pipe
filled behind it, then drained at **1.23x** — permanently behind by however long it had
waited, which is what a huge stream delay looks like to a viewer. Starting on a keyframe
removes the wait, so the probe is small and the destination stays live.

**One slow platform must not stall the others.** The ingest's bytes are written to every
active destination's stdin, so a destination that stops draining would back-pressure onto the
ingest and hold up everyone. Past `MAX_PENDING_BYTES` — *and* still over it after
`BACKLOG_GRACE_MS` — that one is dropped. Both numbers matter: an earlier 8 MB cap with no
grace was about ten seconds of video, which a brief stall on the platform's side crossed, so
a healthy stream was dropped and retried and the viewer saw a disconnect that healed itself
seconds later. Its stdin also needs an `error` listener — an unhandled EPIPE on a killed
child takes the whole main process down.

**Stopping a destination means ending its stdin, not killing it.** EOF lets ffmpeg write the
FLV trailer and close the RTMP session, so the platform ends the broadcast; killing it leaves
the platform staring at a dead socket, which is the disconnect screen on Twitch and a long
spinner on Kick. `endProcess` ends stdin and only kills after `CLOSE_GRACE_MS` for one that
will not leave. App shutdown is the exception — it kills immediately, because waiting there
would orphan the process.

**`-map 0` is not optional in either process.** Without it ffmpeg's default stream selection
hands the muxer nothing and it dies with "Output file does not contain any stream", which
reads like a broken pipeline rather than a missing flag.

**"Is it receiving?" is the ingest's first stdout bytes.** The process starting says nothing,
since it starts in order to wait. Per destination, `frame=`/`size=` on stderr is the
equivalent signal that it is actually sending.

**Kick runs on Amazon IVS, which *requires* a 2s keyframe interval — and fails silently
without one.** IVS accepts the push, reads the bytes, and never goes live, because it cannot
cut HLS segments without regular keyframes. From the outside this is indistinguishable from
the relay being broken: measured on a real stream, Kick's destination reported
`size=30088kB time=00:01:07 bitrate=3675kbits/s speed=1.05x` with no errors at all while the
channel stayed dark. Twitch tolerates a long interval, which is what makes it look like Kick
is at fault rather than the encoder. `Relay` measures the interval from the transport stream
it is already parsing and the Broadcast page says so outright, because nobody would guess it.

**Kick's ingest URL needs `/app` appended and their dashboard does not include it.** The
value they hand out is a bare host, and the encoder is expected to add the path — OBS users
hit the same thing. Without it ffmpeg reports `error opening: I/O error`, which names
neither the cause nor the platform. `normalizeIngest` appends `/app` to any ingest with no
path of its own, so it fires on Kick and never on Twitch (`/app`) or YouTube (`/live2`).

**A clean teardown looks exactly like a fault on ffmpeg's stderr.** "Error retrieving a
packet from demuxer: I/O error" is what a *finished* stream prints when the encoder
disconnects. Matching on the word error therefore reports a failure every time a stream ends
— `REAL_FAILURE` narrows it to a destination actually refusing us.

**OBS disconnecting ends the ingest process, so it is rebuilt.** `-listen 1` serves exactly
one session and exits, which would otherwise mean one stream per app launch. Respawn carries
a doubling backoff for a process that dies inside `MIN_HEALTHY_MS`, so a busy 1935 cannot
spin.

**The relay key is a path segment, and that is what protects the port.** RTMP matches the
whole application path, so a push carrying the wrong key never reaches us. It is **persisted**
for exactly that reason: the value lives in OBS's settings, and a key regenerated each launch
meant every restart silently refused the encoder with `Unexpected stream <old>, expecting
<new>` — which reads as the relay being broken rather than as a stale paste. ffmpeg listens
on `127.0.0.1` while OBS is told `localhost`, so nothing on the network can push in.

**ffmpeg cannot be run from inside `app.asar`.** `asarUnpack` puts `ffmpeg-static` beside
the archive and `ffmpegPath()` swaps `app.asar` for `app.asar.unpacked`. It adds ~79MB, so
the installer goes from 113MB to roughly 190MB.

**`node-media-server` was the obvious alternative and was rejected on weight.** v4 pulls in
express, cors, jsonwebtoken and express-rate-limit — a whole HTTP stack shipping in a desktop
app to accept one loopback connection. The pipe fan-out needs nothing ffmpeg does not already
provide.

**A local relay saves no upload bandwidth.** Three destinations is 3x upstream whether the
fan-out happens here or in an OBS multi-output plugin — only a cloud relay changes that,
which is what Restream sells. What this buys is one place to configure and switches that work
mid-stream.

**No account is needed for any of it.** Stream keys are paste-once values; Twitch and Kick
go live on RTMP connect, and YouTube does too as long as Auto-start is on in Studio.

### Renderer UI

**There is no component library any more — the chrome is hand-built.** v1 built the tab
strip, modal and controls on Ant Design v6. The v2 handoff specifies exact pixels, radii and
tones for every control, which meant fighting antd's own vocabulary on every one of them, so
`Tabs`, `Splitter`, `Modal`, `Select`, `Switch`, `Popover`, `Button` and `Empty` were all
replaced by plain elements styled with Tailwind and the token variables. That deleted the
whole antd/Tailwind layering problem with it: `index.css` no longer declares
`@layer theme, base, antd, components, utilities`, and `main.tsx` no longer wraps the tree in
`StyleProvider`/`ConfigProvider`. **`antd`, `@ant-design/cssinjs` and the four `@dnd-kit`
packages are gone from `package.json`** — nothing had imported any of them since v2, and they
were devDependencies, so the installer never carried them either way.

**Tokens live in `index.css` as custom properties, and nowhere else.** Everything in the
chrome is one of `--ink-900/800/700/600`, `--line`, `--line-2`, `--hover-row`,
`--segment-on`, `--fg`/`--fg-2`/`--fg-3`/`--fg-4`, `--heading`, plus the ones the light
theme forced out of the components: `--button-solid`/`-hover`/`-fg`, `--toggle-on`/`-off`/
`-knob`, `--pill`, `--ghost-icon`, `--scroll-thumb`, `--shadow`, `--error`, `--mention-bg`,
`--link`, `--chip-bg`/`--chip-fg`. Nothing computes a shade of its own. `theme.ts` briefly carried an `INK` object mirroring all of them for TS; twelve of
its fourteen keys were never read, because an inline `style` takes `var(--fg-4)` perfectly
well, so the mirror is gone. What is left there genuinely cannot be a CSS variable:
`PLATFORM_COLOR`, which is indexed by a message's platform, and `EVENT_ACCENT`, whose hexes
are composed with `ROW_WASH`/`BADGE_WASH` at render time. `PLATFORM_COLOR` was also
duplicated by a Tailwind `@theme` block declaring `--color-twitch/-youtube/-kick`; no
utility ever referenced those, and they are gone too. The four `--text-*` variables v1 used are gone: the chrome is
14px with 17px screen titles and 14px section labels, and chat text is the per-pane
`--chat-font-size`.

**There is a light theme, and it is one inverted block — not a media query.** `App` resolves
`themeChoice` ('dark' | 'system' | 'light') against `store.systemDark` through
`resolvedTheme` in `theme.ts`, then stamps `document.documentElement.dataset.theme` with the
answer, so `:root[data-theme='light']` in `index.css` is the only light palette and 'system'
is decided in exactly one place. Two things follow. The OBS dock is a second renderer entry
that never stamps, so it keeps the `:root` dark palette whatever the app is set to — which is
right, it renders over a stream. And every colour in the chrome had to become a token first:
a hardcoded `#f2f2f2` or `bg-white` does not invert, so the light theme is what the token
list above is *for*. `color-scheme` is set in both blocks so native scrollbars follow.

**The shared controls are in `components/controls.tsx`** — `Toggle`, `ControlRow`,
`Segmented`, `Stepper`, `Picker`, `EmptyBlock` — so the pane popover and the settings screen
render the same switch and the same stepper rather than two lookalikes.

**The pane bar is a 44px header, and the pane's own controls moved into its popover.** The
header carries the channel name, an optional `offline` pill, and exactly two icon buttons:
filter and settings. Text size, reset, clear chat and the OBS dock
link all live in the settings popover now. Both buttons keep their hover styling while their
panel is open, via `data-on`.

**Only one pane's settings popover is open at a time**, which is why `store.gearOpenFor` is a
single id rather than a record — opening one closes any other. `filterOpen` *is* a record:
filters are independent per pane.

**A message kind is drawn as an accent, not just a chip.****A message kind is drawn as an accent, not just a chip.** `EVENT_ACCENT` in `theme.ts`
gives `subscription`, `donation`, `raid` and `announcement` a colour, painted as a 2px left
border, a 7% background wash, a lucide glyph and a badge on the 15% tint. The border is
always in the layout — `chat` rows carry it transparent — so a notice arriving mid-scroll
cannot shift the text of every other row sideways. Both maps are keyed on the same five kinds;
a kind in one and not the other renders a chip with `undefined` colours. Twitch is still the
only platform that emits any of them, so this whole path is dark on Kick and YouTube.

**The chrome does not explain itself on hover.** The pane bar's icon buttons, the search
field, the platform tabs, and emote and badge *images* all carry `aria-label` but no `title`, so nothing
pops a caption while you read chat. The one `title` left in a message row is on the
three-letter badge chip that stands in for a badge with no image — there the title is the only
place the full label exists. Do not reintroduce tooltips on the bar; they were removed on
purpose.

**Pane state lives in the store, not the pane.** `store.search[sourceId]` (committed terms),
`store.searchDraft[sourceId]` (what is half-typed), `filterOpen[sourceId]` and
`fontSize[sourceId]` are all keyed by source, because `App` renders a different tree as tabs
are toggled, so a pane *remounts* and local `useState` would silently drop the search.
`forgetSource` deletes every one of those entries alongside the messages.

**Two things in that popover are *not* per source, and it says so.** `ChatSettings` puts the
`showTimestamps` and `showDeleted` switches above the OBS link, under an "Every chat" caption,
because both are single flags on the store rather than records keyed by `sourceId` — flipping
one in any pane flips it in all of them, and the caption is the only thing that makes that
predictable. They read the store directly rather than arriving as props, so `ChatPaneBar`'s
prop list (and its `memo`) is untouched by them.

**The filter is a comma-separated term list, parsed in `search.ts`.** A bare term matches
message text; `author:` (or `from:`) matches the sender; terms are ANDed, so
`def, author:abc` is "messages containing def, sent by abc". Three rules that are easy to
break: a prefix only counts if it is a *known* field, so `https://youtube.com` stays a
content search rather than becoming a `https:` field; the author needle drops a leading `@`
so `author:name` and `author:@name` are the same search on YouTube (whose names carry one)
and on Twitch and Kick (whose names do not); and everything is lowercased on both sides.
Terms render as pills inside the filter bar's inset field; Enter and `,` commit the draft,
Backspace on an empty draft removes the last pill, and Escape clears the draft then the
terms. The **draft is filtered live** — `parseSearch([...terms, draft])` — so typing narrows
the list before you commit anything, and the `n of m` readout counts the same derived list
the pane renders.

**Clicking an author name filters by them, and it is delegated on purpose.** The name span in
`MessageRow` carries `data-author` and nothing else; the click is caught by an `onClick` on
the pane's scroll container, which walks `closest('[data-author]')`. `MessageRow` is `memo`'d
and the pane re-renders on every 100ms batch, so handing it a callback prop — necessarily a
fresh closure per source — would break that memo for every row on screen. An attribute costs
nothing. `addSearchTerm` dedupes case-insensitively, so clicking the same name twice does not
stack pills.

Filtering happens in `ChatPane`, not the store: `visible` is derived from the message list
each render, so clearing the search restores everything instantly and the ring buffer keeps
filling behind the filter. Clearing history is the destructive one — it empties
`bySource[sourceId]`, exactly what the `clear-chat` moderation event already does — so it is
the one control in the app behind a confirm. That is a deliberate exception to the "no
confirmation" rule the tab `×` follows: re-adding a channel costs nothing, but discarded
messages are gone.

**The pane settings popover is anchored, not floating.** It is absolutely positioned at
`top: 48px; right: 10px` inside the pane's own relatively-positioned box, so it cannot open
past the window edge the way v1's antd `Popconfirm` did — that one opened clipped *and
unclickable*, its confirm button landing outside the viewport (measured x 1172-1692 in a
1440px window). Clearing a pane is no longer behind a confirm: it is a plain button in that
popover, and the popover closes on clear.

### Navigation (v2)

The title bar owns navigation. There is no sidebar and no tab strip below it.

**The title bar carries no bottom rule**, though the handoff specifies one. It was removed
by request — the bar and the view below it are both `--ink-900`, so the line read as a seam
rather than a division. Do not restore it from the spec.

**Three views, one switcher.** `store.view` is `'chats' | 'broadcast' | 'settings'`, driven
by a segmented control at the far left of the title bar. `Broadcast` is a named placeholder
reserved for the next slice of work — it is deliberately empty, not unfinished.

**Three platform tabs live in the title bar, centred, and only in the Chat view.** Twitch,
YouTube and Kick are the whole strip — one chat per platform, no channel tabs, no dragging.
`store.visiblePlatforms` says which are on screen, and each pane is whichever source carries
a visible platform. Each tab is the site's own mark plus its name; the mark takes
`PLATFORM_COLOR` while that platform holds a connected channel and the tab's own text tone
otherwise, so the strip reads as "these are live" without a second indicator.

**A tab click toggles a pane on or off — it does not select one.** `togglePlatform` rebuilds
`visiblePlatforms` by filtering `PLATFORMS`, not by appending, so panes always read left to
right in the same order as the strip above them regardless of the order they were switched
on. The last pane cannot be switched off — the view must never empty — but the refusal still
returns to the Chat view, since the click came from Broadcast or Settings just as often.

**One button to the right of the strip switches columns for one merged list.**
`store.merged` is the whole state, and the button only ever toggles that. Its icon shows the
layout you are *in* rather than the one a click would give: `Square` while merged, and
`Columns2`/`Columns3` while split — the count only chooses between the two split icons, and
in split mode it is exactly `visible.length`, which is why the tab bar needs nothing else to
draw it. It is **absent** below two *connected* chats rather than disabled — merging only
ever collapses connected chats, so with one or none the button could do nothing, and a dead
control is not worth the space it holds on the window's centre line. Merging is
a viewing mode over connected chats only — a visible platform with no channel keeps its own
column either way, because its "not configured" prompt has nowhere else to go, so
[merged chat][prompt] is a normal state rather than a glitch.

**`layout.ts` derives the column model once, and both the view and the icon read it.**
`chatColumns(visiblePlatforms, sources, merged)` is the only place split-versus-merged is
decided; `App` renders what it returns and never re-derives it. Keeping a second copy in the
title bar to count columns is exactly the drift this avoids.

**A pane is a list of sources, not a source, and `columnPaneId` is what keys its state.**
Split panes key on `source.id`; the merged pane keys on the literal `'merged'`, so its
search, filter, font size and popover are its own and survive toggling back and forth. Two
controls in the popover need a single channel and are hidden without one — the OBS dock link,
which addresses one channel, and Disconnect, which would have to guess which. `ChatPaneBar`
takes a `label` and an `offline` flag rather than a `SourceState` for the same reason.

**The merged list is a k-way merge, not a sort.** Each source's list is already in arrival
order, so `mergeMessages` walks them — linear in the total rather than re-sorting every held
message on each 100ms batch. It is stable by *list order*, which is tab order, so messages
sharing a timestamp do not shuffle between batches.

**A mark's box has to land on whole pixels, or the whole thing smears.** Deriving the
width from the height and the viewBox ratio is the obvious way to keep the aspect and it
is what made these look blurry: it gave Twitch `11.656 x 14` and Kick `11.109 x 13`, and
an *odd* height centred in the 26px tab put Kick at `y=12.5`. At `devicePixelRatio: 1`
every edge then falls between device pixels. `PlatformMark` rounds the derived width and
leans on `preserveAspectRatio` for the sub-pixel of aspect that costs, and every tab
height is even so flex centring stays whole. Measured after: `12 x 14`, `17 x 12`,
`12 x 14`, all at integer `y`. The x is still fractional — it comes from the text beside
it — but the box and the vertical alignment are what read as blur.

**A merged row carries its platform's mark, and only a merged row.** `MessageRow`'s
`showPlatform` predates this and drew a coloured dot with a `title`; it now draws the tab's
own `PlatformMark` at `1em` — sized in em so it tracks the pane's font size like the emote
and badge images, and `1em` rather than a fraction of one because `CHAT_FONT_SIZES` are all
integers, so the height stays whole at every step. No `title`, per the no-tooltips rule. The merged pane passes it
only when more than one chat is actually in the column.

**Toggling is uniform, and a tab with no channel is not a special case.** Switching one on
puts its pane on screen whatever it holds: a chat if that platform is connected, the connect
form if it is not. That is the only route to the form, so it cannot be reserved for connected
platforms — and it means a split of a live chat beside a "not configured" prompt is normal, not
a glitch. `NotConfigured` is `max-w-[380px]` inside its column for that reason.

**The greyed-out tab click was dead, and the cause was the drag region, not the styling.**
`.titlebar-drag` fills the bar with `-webkit-app-region: drag`; Electron collects draggable
rects in *document order* and a later one re-covers an earlier `no-drag` hole, so while the
absolutely-positioned `.titlebar-centre` was declared **before** the filler, every tab click
was swallowed by the OS. The tabs must stay declared after it. This survives any test driven
by `element.click()` or `Runtime.evaluate` — both bypass hit-testing entirely — so it takes a
real `Input.dispatchMouseEvent` with the window raised to catch, which is exactly the trap
"Testing the IPC surface is not testing the app" warns about one level up.

**The three marks are the sites' own logo geometry, inlined once.** `PlatformMark` carries
Twitch's header glitch, YouTube's `yt-ringo2` badge and the K from `kick.com/img/kick-logo.svg`,
each as a single `currentColor` path — YouTube's play triangle is knocked out of the body by
`fill-rule: evenodd` rather than painted in the page colour, which would smear the moment the
tab gained a hover background. This is deliberately *not* the runtime fetch that badge art
uses: that rule exists because sites redraw badges, and a brand mark is the one piece of a
site's art that does not move.

**Centring is absolute, not `flex-1` on both sides.** `.titlebar-centre` is out of the flow at
`left: 50%`, so the tabs sit on the *window's* centre line rather than midway between the mode
switcher and the window controls — those two are different widths, and on Windows they change
width again when the window maximises. Verified in the running app: tab group centre 720 in a
1440px window.

**The settings screen picks the channel — there is no channel field in the pane.** A platform
with no channel set shows `NotConfigured`, whose only control opens Settings -> Platforms.
`SignInPrompt`, `ConnectChannel`, the `AddChannel` dialog before it, and `store.connectDraft`
are all gone.

**`syncChannels` in `main/index.ts` is the only route by which a source is created.** It runs
on every settings save and walks `PLATFORMS`, calling `SourceManager.ensureOnly` for a
platform that has a channel and `removeByPlatform` for one that does not. `ensureOnly` is a
no-op when the wanted channel is already the one open, so a save does not churn a live
connection. The sync is single-flighted, because saves arrive in bursts as fields are edited.

**Chat reading is anonymous on all three platforms and needs no account at all.** The channel
name is the only thing a chat needs; the stream URL and key on the same settings card are for
the relay and are never used by chat.

**The pane bar carries the channel name and nothing about the platform.** The dot and the
platform name were both there and both were removed: the tab above the pane already names the
platform and colours its mark, and panes run in tab order, so repeating it in every bar was
the same fact three times. The `offline` pill stays — that is state, not identity.

**Disconnecting is in the pane's settings popover, and there is no confirm.** It removes the
source; the pane stays on screen showing the "not configured" prompt. Clearing the channel in
Settings -> Platforms is the durable version of the same thing.

**One chat per platform is a renderer rule, not a main-process one.** `SourceManager` still
holds any number of sources and `removeByPlatform` exists for the settings swap, so the OBS
link server and the backlog are untouched by this. Nothing in the UI can create a second
source for a platform, because a platform has one account and an account has one channel.

**Split groups, tab dragging and per-channel tabs are all gone.** v1 remembered arrangements
(`store.groups`) and reordered tabs with dnd-kit; v2 kept per-channel tabs with a separate
split control and `visibleIds`. Both are removed — with `showSource`, `toggleSplit`,
`visibleIds`, `components/ChannelTabs.tsx` and `components/AddChannel.tsx`. Splitting survives
as the tab toggle itself: there is no second control for it, because with three fixed tabs the
tab *is* the control. `SourceManager.reorder` and the `sources:reorder` IPC survive on the main
side with no caller in the UI; restoring dragging means writing a new interaction, not rewiring
an old one.

### Platform setup

**There are no accounts any more.** OAuth for all three platforms, the Twitch device flow,
EventSub, Helix and the message composer were all deleted when messaging was dropped. Chat
is read anonymously on every platform, which is what it always did on Kick and YouTube and
what `TwitchIrcFeed` still does on Twitch. `TwitchChatWatcher` therefore has one feed, not
two, and `resolveChannel` has one path.

**Settings -> Platforms is the only place a platform is configured**, and it holds three
fields each: the channel whose chat to open, and the stream URL and key to forward video
to. `syncChannels` in `main/index.ts` reacts to every save, so setting a channel opens its
chat and clearing it closes it. That is the only route by which a source is created.

**The stream key never leaves main.** `platformConfigs()` reports `hasStreamKey: boolean`
rather than the value, so the renderer cannot read a key back even though it can set one —
which is also what lets the field show dots and a Replace button rather than a real value.
A save is a *patch*: an absent field means "leave it", so the renderer can save a channel
without having to send back a key it was never given.

**The whole setup record is encrypted, not just the key.** A channel name is the one thing
this app deliberately never used to keep — see the persistence invariant below — so now
that it must be stored, it is stored the way the secret is.

**The stream URL appears only where it varies per user, which is Kick alone.** Twitch and
YouTube publish one ingest for every channel, so theirs is not shown at all — the card is a
channel and a key — and `fixIngest` in `config.ts` overwrites whatever is stored — it is a constant, not user data,
and a value saved by an older build must not outrank it. Twitch's dashboard shows no URL at
all (the encoder picks an ingest server), so offering a box invited a hunt for something
that does not exist.

**Twitch and YouTube ingest URLs are prefilled; Kick's cannot be.** Twitch publishes one
global endpoint for everybody (`ingest.global-contribute.live-video.net`) and YouTube's is
fixed. Kick runs on Amazon IVS, which provisions an ingest host *per channel* — that hashed
subdomain is the broadcaster's own — so there is nothing to prefill and no API to ask.
`DEFAULT_INGEST` in `shared/types.ts` carries the two that are knowable.

**YouTube needs Auto-start switched on in Studio**, or pushing video to the key does not
start a broadcast. That is the whole reason restreaming does not need the Data API: with
auto-start, YouTube behaves like Twitch and Kick — connect RTMP and you are live — and the
`liveBroadcasts.insert`/`bind`/`transition` dance disappears.

**`config.json` is version 3 and nothing carries forward from version 2.** The tokens it
held authorised features that no longer exist, so an older file is read for its shape and
its contents discarded.

### Main process

**What is persisted is the platform setup — channel, ingest URL and stream key, encrypted,
one slot per platform.** Channel names *are* now saved, which reverses the earlier privacy
decision: they are configuration rather than session state once a channel is chosen in
settings rather than typed per session. They are inside the encrypted blob for that reason.
`config.json` holds `version` and the
encrypted `twitch.tokensEnc`, and that is the whole file. Channels are deliberately *not*
saved: the app opens empty every launch and every channel on screen was added this session.
An earlier build restored saved channels at startup, which meant `config.json` accumulated a
plaintext list of the user's channel names — and a name that stopped resolving was pinned
there forever, because refusing to delete on a `missing` lookup was the only way to stop a
Twitch outage from eating a real channel. Removing persistence removed that whole class of
problem rather than tuning it. `Config.read()` therefore projects onto the fields it knows
(`{ version: 1, twitch }`), so a `channels` array left by an older build is dropped on load
instead of being written back out. Do not reintroduce channel persistence without asking —
it is a privacy decision, not an oversight.

**`config.ts` is hand-rolled because `electron-store` v11 is ESM-only** and this build emits
CJS for main. The package itself is gone from `package.json` — it was a dependency that
nothing imported. Tokens are encrypted with `safeStorage` (DPAPI on Windows). If no encryption
backend exists, tokens are kept in memory for the session rather than written in the clear.

**The config file is written then renamed**, so a crash mid-write cannot truncate it.

**A dead renderer does not close the window — it goes blank, and nothing used to bring it
back.** The `BrowserWindow` keeps painting its `backgroundColor` (`#141414`), so a crashed
renderer looks like a dark empty app rather than an error, and it stays that way until the
app is restarted. Windows reaps background processes across suspend/hibernate, which is why
it showed up after sleep. `keepRendererAlive` in `lifecycle.ts` handles `render-process-gone`
and `did-fail-load` by reloading, capped at 3 reloads a minute so a renderer that dies on
every load cannot spin. `clean-exit` and `ERR_ABORTED` (-3, a superseded navigation) are
both normal and ignored.

**A lost GPU reports nothing, so `resume` repaints unconditionally.** Suspend can leave a
live renderer with no surface — no crash event fires and `isCrashed()` is false — so the
`powerMonitor` `resume` handler reloads if the renderer is actually crashed and otherwise
just calls `webContents.invalidate()`. `child-process-gone` is an **`app`** event, not a
`webContents` one; registering it on the window silently typechecks against a different
overload and never fires.

**The reload is only half a fix without the backlog.** The renderer store is in memory, so
a recovered window came back with the tab list (main owns that) and an empty pane. `App`
therefore pulls `sources:backlog` for each source on mount and ingests it — the same 200
message replay `obs/server.ts` already sends a dock on connect. Verified by crashing the
renderer under load: 184 rows back rather than 0.

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

**Path aliases are declared in five places now.** `@shared` (and `@` for the renderer) live
in `electron.vite.config.ts`, the three tsconfigs, and `vitest.config.ts`. Adding or renaming
one means editing all of them, or the build, the typecheck and the tests disagree about
whether the import resolves. `@main` is the exception: it exists only in `vitest.config.ts`
and `tsconfig.test.json`, because nothing under `src` uses it and the build has no reason to
know it. In both configs the longer keys must stay ahead of `'@'` — Vite matches a string
alias by prefix, so the shorter key would otherwise swallow them.

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

### Packaging

**`electron-builder.yml` is the config and `npm run dist` is the command.** Windows is the
only target actually produced, and it produces two: `release/stream-chat-<version>-setup.exe`,
an NSIS installer that lets the user pick a directory, and
`release/stream-chat-<version>-portable.exe`, a self-extracting single file. `unpackDirName`
pins the portable build's extraction folder so it unpacks once rather than on every launch —
left unset, electron-builder uses a fresh temp directory each run and a 113MB app pays for it
every time. The mac (dmg) and linux (AppImage) blocks are declared but have never been run,
the same status as the `frameOptions()` branches they would ship.

**`files:` in that config is an exclusion list, so anything new at the repo root ships unless
it is named.** `tests/`, `vitest.config.ts` and `tsconfig.test.json` are excluded there for
that reason. Verified by unpacking `app.asar` after `npm run pack`: zero test files, zero
configs. Add a root-level directory and it goes in the installer until you say otherwise.

**The portable build is portable in delivery, not in state.** It still writes the Twitch token
to `%APPDATA%/stream-chat` like every other build; nothing lands beside the exe. That only
stays true while the Twitch token is the one persisted thing — see "Nothing is persisted but
the Twitch token". Making it self-contained means reading electron-builder's
`PORTABLE_EXECUTABLE_DIR` env var in `config.ts`, which is a code change, not a config one.

**A packaged build is a different program from `npm run dev`, and one dependency proved it.**
electron-builder rewrites every dependency's `package.json` as it packs them, which is what
broke YouTube in the installed app only — see the youtube.js parser-handler invariant. Run the
packaged exe before believing a release works. It accepts `--remote-debugging-port`, so the
same CDP driving used in dev works against `release/win-unpacked/stream-chat.exe`.

**Dev and the installed app share one userData directory, so they cannot run at once.**
`app.getName()` falls back to package.json's `name` — electron-builder's `productName` names
the installer and the Start-menu entry, but never reaches the packed manifest — so both
resolve to `%APPDATA%/stream-chat` and the single-instance lock in `main/index.ts` makes the
second one exit silently with status 0. That is indistinguishable from a packaged app that
crashes on launch. Kill `npm run dev` first.

**The renderer's CSP is rewritten at build time.** `src/renderer/index.html` carries the *dev*
policy; `packagedCsp()` in `electron.vite.config.ts` swaps in `PACKAGED_CSP` under
`apply: 'build'`. That drops `script-src 'unsafe-inline'`, which only the dev server's React
Refresh preamble ever needed, and the localhost/ws allowances in `connect-src`, which nothing
needed — the renderer makes no network calls at all, main does. `style-src 'unsafe-inline'`
has to stay, though no longer for antd's cssinjs — the chrome sets colours and sizes through
inline `style` attributes, which `style-src` governs too. Verified against the built
`out/renderer/index.html`, which contains no inline script. There are now **two** policies:
`packagedCsp()` branches on the filename, because `obs.html` is served over http and talks
to the link server, so it keeps a `connect-src` of `ws://127.0.0.1:*` that the app's
`connect-src 'none'` must not gain.

**`ffmpeg-static` is a dependency, not a devDependency**, and is `asarUnpack`ed — a binary
inside the archive cannot be executed. It is by far the largest thing in the build.

**Only `ws`, `youtubei.js` and `ffmpeg-static` reach the installer.** electron-builder ships `dependencies` and
prunes `devDependencies`, so the packed `node_modules` is `ws`, `youtubei.js` and its three
transitive packages — nothing else. A package in the wrong list is a shipping bug.

**The build is unsigned and has no icon of its own.** electron-builder reports `default
Electron icon is used`; a `build/icon.png` of 256px or more is all it needs. Unsigned means
Windows SmartScreen warns on first run.

## Platform notes

Only Twitch needs the user to connect an account. The others need a *developer* credential
baked into the build, or nothing at all.

| Platform | User sign-in? | Build credential | Why |
|---|---|---|---|
| Twitch | **No** | none | Anonymous IRC reads any channel, and badges resolve over anonymous GQL rather than Helix. |
| YouTube | **Optional**, site session | none | Sign-in is a login window, not OAuth — a Cloud project's sensitive scopes expire refresh tokens weekly until the app leaves Testing. Reading chat goes through the innertube endpoint the web player uses — no key, no quota. A Google API key would only be needed for account-scoped calls, or to *send* messages (`liveChatMessages.insert` is OAuth-only). |
| Kick | **Optional**, site session | none | Sign-in is a login window: the public API's token exchange needs a `client_secret` a desktop build cannot hold. The internal socket is anonymous. Kick's *official* API is OAuth + webhook, useless to a desktop app with no public URL. |

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
store cap; it exercised the DOM, not the 500-message ring. The store's ring is settable from
Settings -> Chat (200/500/1000) — `setCapacity` re-caps what is already held rather than
waiting for eviction, or lowering the number would leave the longer history on screen.

Badges and author colours are **back** on all three platforms, resolved in main and verified
against live chat in the running app (70 badge images, zero broken; 27 distinct name
colours). Deliberately removed, in that order: live-state reporting; then
the mock platform and the in-browser simulator; then the third-party emote wiring, which is
now **back** — 7TV and BTTV resolve through `Channel.emotes`, verified live at 17 emote
images in one screen of a busy Twitch chat, none broken.

The renderer chrome was rebuilt on **Ant Design v6**, then the sidebar was replaced by a
browser-style tab strip, then antd went and the OS frame was replaced by `TitleBar`. The
strip is now **three fixed platform tabs** rather than one tab per channel — the rules live
in "Navigation", read them there rather than here, since this paragraph has drifted from the
code twice already. `MessageRow` stays hand-written for the reasons in "Renderer UI", and
Tailwind is still in the tree for the chat rows. Each pane has a top bar that searches it,
clears it, hands out its OBS link and disconnects the channel.

Every chat is also readable outside the app, at a loopback URL OBS can dock — see "OBS
links".

Restreaming works: OBS pushes to the relay and it forwards to Twitch and Kick, verified on a
real 30-minute stream. See "Broadcast (the relay)" for the traps, of which the two that cost
most were Kick's missing `/app` path and IVS's 2s keyframe requirement.

The platform setup — channel, ingest URL, stream key — persists, encrypted. Chat scrollback
does not: the app opens with empty panes every launch and refills from live chat.

Deliberately not done: **no message sending on any platform** (the composer, and every
account that authorised it, were removed — a chat client that only reads is the decision, not
an omission), no moderation, and no auto-update. YouTube is configured like the others but is
the least exercised of the three. OBS links are read-only mirrors: a dock shows a channel only
while that channel is open in the app, and hitting a URL never adds one. Packaging now works — see "Packaging" — but the build
is unsigned and has no icon of its own.
YouTube super-chats and memberships are **not** mapped at all — see the YouTube invariant on
`LiveChatTextMessage`. **Twitch is the only platform that emits a `MessageKind` other than
`chat`** — `subscription`, `raid`, `announcement` and `system` come from IRC `USERNOTICE`
`donation` from the `bits` tag. Kick and YouTube hard-code
`kind: 'chat'`, so any UI keyed on message kind is Twitch-only in practice.

## Verifying changes

`npm run typecheck` is the first gate — all three tsconfig projects must pass — and
`npm run test` is the second. Neither proves the app works; that still takes the running
app, below.

**The suite is `vitest run`, and it covers pure logic only.** `tests/` sits outside `src` and
mirrors it — `tests/main/chat/links.test.ts` covers `src/main/chat/links.ts` — and reaches the
app through `@main`, `@shared` and `@` rather than a stack of `../../..`. Nothing imports the
tests, so nothing bundles them. What is covered:

| Area | File under test |
|---|---|
| the "add a channel" parser | `shared/channel.ts` |
| the dock URL grammar | `shared/obs.ts` |
| link splitting, plain text, backoff, replay guard, id composition | `chat/links.ts`, `chat/fragments.ts`, `chat/backoff.ts`, `chat/recent-ids.ts`, `chat/watcher.ts` |
| IRC parsing and its message mapping | `platforms/twitch/irc.ts` |
| the Twitch emote URL builder | `platforms/twitch/emotes.ts` |
| Kick's inline emote tokens, badge ids and reply excerpts | `platforms/kick/index.ts` |
| YouTube's poll clamp | `platforms/youtube/index.ts` |
| third-party emote substitution | `emotes/index.ts` |
| the dock backlog and the batching bus | `backlog.ts`, `bus.ts` |
| every IPC argument validator, including the platform patch | `ipc.ts` |
| resolve and naming on all three platforms | `platforms/*/channel.ts` |
| the pane filter grammar | `renderer/search.ts` |
| the author and badge colour lift, both directions | `renderer/contrast.ts` |
| resolving 'system' onto a palette | `renderer/theme.ts` |
| the per-platform channel parse | `renderer/connect.ts` |
| the merged-column k-way merge | `renderer/merge.ts` |
| the split/merged column model | `renderer/layout.ts` |
| ingest and per-destination ffmpeg arguments, and the transport-stream inspection | `broadcast/relay.ts` |
| the whole zustand store | `renderer/store.ts` |
| the dock's query-parameter options | `renderer/obs/options.ts` |
| the two badge-art scrapers | `platforms/kick/badges.ts`, `platforms/youtube/badges.ts` |

**Keep the tests out of `src/renderer`, and not only for tidiness.** Tailwind v4 scans the
renderer root for class candidates and takes them from prose, not just from JSX. Four test
files briefly lived under `src/renderer/src`; the words *filter* and *hidden* — one in a test
name, one in a comment — were enough to emit `.filter`, `.hidden` and the whole `--tw-blur` /
`--tw-drop-shadow` `@property` block into the bundle: **1.5KB of CSS no element ever used**
(20.10KB against 18.57KB, measured both ways). Moving `tests/` to the repo root put the built
CSS back to byte-identical with the build from before the suite existed.

**Tests are written against the invariants in this file, not against the implementation.**
Where a rule above cost real time to discover — IRC's code-point emote offsets, a pasted link
connecting on the tab next door, `Number(null)` snapping every dock to the smallest font,
whole-token case-sensitive emote matching — there is a case for it carrying a comment that
says which invariant it pins. That is what makes the suite worth keeping.

**A concise-arrow `beforeEach` that returns a mock silently becomes a teardown.**
Vitest treats a function returned from a hook as an after-test cleanup, and
`mockReset()` / `mockClear()` return the mock itself for chaining — so
`beforeEach(() => fn.mockReset())` makes Vitest *call the mock* after every test in
that block. Harmless while the mock resolves; the moment one test sets
`mockRejectedValue`, that call rejects with nobody awaiting it and the run fails
with the bare error, blamed on the test that queued it rather than on the hook.
It reads exactly like "my rejection escaped a try/catch it plainly cannot escape."
Give these hooks braces. `vi.useFakeTimers()` and `vi.unstubAllGlobals()` are safe
either way — they return the `vi` object, which is not callable.

**Some functions are exported only so a test can reach them.** `parseIrcLine`,
`buildIrcFragments`, the two IRC normalizers, Kick's `toFragments` and `toChatMessage`,
YouTube's `clampPoll` and the five `ipc.ts` validators are not imported anywhere else. Removing an export because
"nothing uses it" will break the suite.

**What the suite does not cover**, and what therefore still needs the running app: every
React component, all three transports end to end, resolve against the live platforms,
`config.ts` (needs `safeStorage`), `obs/server.ts`, and anything about how the chrome looks.

**Anything that is not pure logic** — bundle a throwaway script with the already-installed
esbuild and run it:

```bash
npx esbuild ./.t.ts --bundle --platform=node --format=esm --outfile=./.t.mjs --external:electron
node ./.t.mjs
```

Delete the scratch files afterwards. Prefer a real test to a scratch script whenever the
thing under test is pure.

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

**Click through CDP only with the app window focused.** Learned the hard way: while the
Electron window is occluded, `Input.dispatchMouseEvent` stops being acknowledged part-way
through a sequence — the driver hangs while a *second* CDP client's `Runtime.evaluate` still
answers instantly, so it reads as "the app ignores clicks". Raise the window with Win32
`SetForegroundWindow` on the Electron process (`Page.bringToFront` is not enough), and run
**one scenario per node process** — a long-lived driver accumulates the stall. A driver
killed mid-click also leaves the pointer button logically held, so start each run with a
stray `mouseReleased`.

**`element.click()` is not a click, and it will pass on a control the user cannot press.**
Dispatching it from `Runtime.evaluate` sidesteps every hassle above, which is exactly why it
is tempting — but it invokes the handler directly and never hit-tests, so anything covering
the element is invisible to it. That shipped a dead tab strip here: an Electron drag region
was swallowing the OS-level clicks while a probe driving `element.click()` reported the tabs
working, twice. Any control inside the title bar, under an overlay, or near a drag region
has to be verified with a real `Input.dispatchMouseEvent` at its measured centre. Keep
`element.click()` for driving a control you have *already* proven is reachable.

**To judge how something rasterises, magnify the real screenshot — do not re-render it.**
`Page.captureScreenshot` with a `scale` above 1 re-runs the vector paint at that scale and
comes back crisp no matter how blurry the app looks, so it cannot show a sub-pixel problem.
Capture the clip at `scale: 1`, then draw it into an off-DOM `<canvas>` at 8x with
`imageSmoothingEnabled = false` and export that — a canvas created in JS and never appended
does not disturb the app. This is what confirmed the platform marks were landing on
fractional boxes.

**React ignores a plain `el.value = x` from a driver.** It tracks the last value on the node,
so the assignment looks like no change and `onChange` never fires. Go through the prototype
setter and dispatch the event yourself:
`Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, text)`
then `el.dispatchEvent(new Event('input', { bubbles: true }))`. The same applies to
`HTMLSelectElement` with a `change` event.

The three YouTube resolve outcomes are all worth exercising, and each has a stable probe: a
live channel with chat (`@LofiGirl`), a real channel that is not streaming (`@Google` -> the
retryable `offline`), and a handle that does not exist (-> the terminal `error`).

**Do not clear the user's channels in a test probe.** Add and remove your own test channel
instead — the app starts empty, so anything on screen is something the user just added.

## Conventions

Code is comment-free by preference — naming should carry the meaning, and durable gotchas
belong in the "Invariants" section above rather than inline. When a change turns up
something non-obvious, add it there instead of leaving a comment. A `clean-code` skill is
installed at user level covering naming, function size, SOLID and error handling.

Windows line endings: `.gitattributes` normalises to LF in the repo, so `git` warns about
CRLF conversion on nearly every commit. That is expected.
