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
ChatProvider → MessageBus (100ms batches) → IPC 'chat:batch' → zustand store → ChatPane
```

Providers are isolated behind a `ChatProvider` interface and each owns its own reconnect
logic, so a dropped Twitch socket cannot tear down another platform. Every platform
normalises into one `ChatMessage` shape, so the UI never learns platform specifics.

- `src/shared/` — types plus `channel.ts` (the "add a channel" parser, used by both processes)
- `src/main/providers/` — one `ChatProvider` per transport
- `src/main/twitch/` — auth (Device Code Flow), Helix, the EventSub and IRC sockets, normalizers
- `src/main/emotes/` — 7TV + BTTV caches behind a `ThirdPartyEmotes` aggregator
- `src/renderer/src/` — `App.tsx`, zustand `store.ts`, `components/`

## Invariants

Things that cost real time to discover, and that a reasonable-looking change will silently
re-break.

### Message pipeline

**Fragments are built in the main process. The renderer never parses message text.**
`ChatMessage.fragments` arrives pre-split into text/emote/mention/link. Twitch hands over
emote positions; re-deriving them with a regex in the UI breaks on overlapping emote names
and unicode offsets. New platforms do their splitting in `src/main/.../normalize.ts` and
keep the renderer dumb.

**IRC emote offsets index code points, not UTF-16 units.** Split with `[...text]` before
slicing. Indexing with `.indexOf`/`.slice` cuts an astral emoji (e.g. a ZWJ family emoji)
mid-surrogate and corrupts both the emote and the surrounding text.

**Both Twitch transports must compose message ids identically** — `twitch:${sourceId}:${platformMessageId}`.
Moderation events bind to messages by that id. If the IRC and EventSub providers disagree,
deletions silently stop working.

**Links are split out of text fragments only, after the platform's own emotes are carved
out.** Running the URL regex over the whole message is exactly what the fragment design
exists to avoid.

**The MessageBus batches every 100ms. Never send one IPC message per chat message.** A busy
channel does tens per second and per-message IPC saturates the renderer with
structured-clone work.

**Panes freeze while the reader scrolls up.** The store's ring buffer evicts from the front,
which shifts every virtual index and would yank the viewport. `ChatPane` renders a frozen
snapshot instead of compensating scroll offsets. Measured at 0px drift under 100+ msg/s.

### Emotes

**Emotes are always resolved in main, regardless of a channel's toggles.** `applyEmotes` runs
on every message and tags each emote fragment with its `provider` (`native` / `7tv` / `bttv`);
`MessageRow` decides at draw time whether to draw the image or the original word. Filtering
at receipt is one-way — turning a provider back on cannot recover emotes that were never
resolved. This was a real bug: toggles changed state but not the view.

**Matching is whole-token and case-sensitive.** Substring matching turns `GIGACHAD` inside a
longer word into an image; case folding collides distinct emote names.

**7TV calls YouTube `google`, not `youtube`.** Passing `youtube` returns `400 invalid platform`,
which reads like "YouTube unsupported" and is not. A missing user returns `404`; the two are
easy to confuse. Valid platform values: `TWITCH, DISCORD, GOOGLE, KICK`.

**BTTV is Twitch-only** and keys channels by Twitch user id. It is still worth having — some
large channels have zero 7TV emotes and hundreds of BTTV ones, and without it their chat
renders as bare words.

**Anonymous mode has badge *names* but no badge *images*.** Helix badge endpoints need auth,
and the old public `badges.twitch.tv` host no longer resolves (DNS returns no address). Only
badges that say something about the speaker are shown; rendering every set as truncated text
produced noise like `SUBCRY` and `UMB`.

### Twitch

**Two transports, chosen at runtime.** `SourceManager.createProvider` picks `TwitchIrcProvider`
(anonymous, no account) when signed out and `TwitchProvider` (EventSub) when a token exists.
Anonymous is the default and the normal path; EventSub adds badge images and a real live
indicator. Both must produce identical `ChatMessage` shapes.

**`SourceState.live` is tri-state** (`true` / `false` / `null`). Anonymous IRC has no liveness
signal, and chat traffic is not one — offline channels have active chat. `null` means unknown;
do not collapse it to `false`. Inferring `live` from the first message was a real bug that
marked idle channels LIVE.

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
`POST /youtubei/v1/live_chat/get_live_chat` with a continuation token. No key, no quota, no
sign-in. The official `liveChatMessages.list` was not chosen because it needs a Google Cloud
key baked into the build, burns roughly 3 hours of streaming per day against the default
10,000-unit quota, and **is itself poll-based** — it would be no faster, only more limited.
Unofficial and liable to break, which is why it all sits behind `ChatProvider`.

**One fetch of `/@handle/live` answers "is this channel live right now?".** A live channel
returns a *watch* page (`ytInitialPlayerResponse` with `videoDetails.isLive`, plus
`conversationBar.liveChatRenderer`); an offline one returns a *browse* page with neither.
HTTP 404 means the handle does not exist — that is the only case worth reporting as an error,
since "not live" is normal and gets rechecked.

**Live does not imply chat.** Plenty of big channels stream 24/7 with chat disabled — Sky News,
DW News, NASA and CBS News all return `isLive: true` and no `liveChatRenderer`. That is a
separate outcome from "not streaming", and the provider reports it as such rather than as an
error.

**The unfiltered chat continuation only exists on the popout page.** The watch page's view
selector lists "Top chat" and "Live chat", but its tokens are ~30-char stubs that carry no
video id and answer `400 INVALID_ARGUMENT`. Only
`live_chat?is_popout=1&v=<id>` carries full tokens for both views. The watch page's own
top-level continuation works but is *Top chat* — YouTube's spam-filtered view. Hence two
fetches per resolve.

**`ytInitialData` is assigned differently per page, and the first match can be empty.** Watch
pages use `var ytInitialData = {`, the popout page uses `window["ytInitialData"] = {`, and at
least one page ships an empty `{}` initializer before the real payload. `extractInitialJson`
scans every assignment and returns the first non-empty object; anchoring on the first hit
silently yields `{}`.

**Poll at 500ms, not the `timeoutMs` the server suggests.** YouTube answers `timeoutMs: 10000`;
honoring it delivers in 10s bursts. **Almost all of the latency is our poll interval, not
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

**YouTube identifiers are case-sensitive.** `UCSJ4gkVC6NrvII8umztf0Ow` and an 11-char video id
both break when lowercased, so `SourceManager` lowercases identifiers for Twitch only. Saved
channels round-trip through `config.json` with their case intact.

**Only `isCustomEmoji` runs become emote fragments.** Unicode emoji also arrive as `emoji` runs
with `fonts.gstatic.com` thumbnails; rendering those as images would turn every 😂 into a
network fetch. Their `emojiId` *is* the character — emit it as text.

**Messages replay after a chat reload**, so the provider keeps a bounded set of recent ids.
Without it, every stream-ended/restarted cycle re-injects the backlog.

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

**Mock provider above ~50 msg/sec** hits `setInterval`'s floor, so it emits bursts on a fixed
tick rather than shrinking the interval.

### Build and tooling

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
| Twitch | **Optional** | Client ID | EventSub is never anonymous — every `channel.chat.message` subscription carries the reading user's `user_id`. Anonymous IRC is the signed-out fallback and loses badge images and liveness. |
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
with no public URL cannot use. The working route is the internal Pusher socket, channel
pattern `chatrooms.{chatroom_id}.v2`, event `App\Events\ChatMessageEvent`. Resolving a slug
to a numeric `chatroom_id` needs a Cloudflare-protected internal endpoint that rejects
non-browser TLS fingerprints. Unofficial and liable to break — keep it behind the provider
interface so breakage stays isolated.

Official references: <https://dev.twitch.tv/docs/api/> ·
<https://developers.google.com/youtube/v3/live/docs/liveChatMessages> · <https://docs.kick.com/>
(Kick's docs cover the public webhook API only — use them for auth and channel lookup, not
for chat transport.)

## Roadmap

Done: the scaffold and mock provider, the full chat UI (verified at 200 msg/sec with ~117
rows in the DOM while holding 2,000 messages), Twitch end-to-end over both transports,
7TV/BTTV emotes with per-channel toggles, and YouTube live chat by @handle over innertube.

Next: Kick via the unofficial socket; then polish — settings persistence, sending messages
back, auto-update.

Deliberately not done yet: no settings persistence beyond channels, no message sending,
`electron-builder` has no config block, and CSP keeps `script-src 'unsafe-inline'` because
the dev server injects the React Refresh preamble (tighten to a nonce when packaging).
YouTube super-chat and membership renderers are normalised but have not been seen live —
they are mapped from documented shapes, not from captured traffic.

## Verifying changes

`npm run typecheck` is the first gate, but it does not prove behaviour. Two techniques are
used throughout this repo's history:

**Pure logic** — bundle a throwaway script with the already-installed esbuild and run it:

```bash
npx esbuild ./.t.ts --bundle --platform=node --format=esm --outfile=./.t.mjs --external:electron
node ./.t.mjs
```

Good for parsers, normalizers and emote matching. Delete the scratch files afterwards.

**The running app** — launch with a debugging port and drive the real UI over CDP:

```bash
npx electron-vite dev --remoteDebuggingPort 9333
```

Then connect to `http://127.0.0.1:9333/json` and use `Runtime.evaluate` (the `ws` package is
already a dependency). Prefer clicking real buttons over calling `window.api` directly —
calling the IPC surface bypasses the components and has hidden real UI bugs before.

The renderer also runs in a plain browser: with no preload, `bridge.ts` stands up an in-page
simulator with the same `ChatApi` contract, so the UI can be profiled in browser devtools.
The mock provider under "mock traffic" in the sidebar generates synthetic load.

**Do not clear the user's channels in a test probe.** Add and remove your own test channel
instead; wiping `listSources()` deletes their saved channels from `config.json`.

## Conventions

Code is comment-free by preference — naming should carry the meaning, and durable gotchas
belong in the "Invariants" section above rather than inline. When a change turns up
something non-obvious, add it there instead of leaving a comment. A `clean-code` skill is
installed at user level covering naming, function size, SOLID and error handling.

Windows line endings: `.gitattributes` normalises to LF in the repo, so `git` warns about
CRLF conversion on nearly every commit. That is expected.
