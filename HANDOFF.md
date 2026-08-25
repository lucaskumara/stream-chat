# stream-chat — Handoff Notes

Context transfer from a previous Claude Code session (2026-08-25). That session ran
under WSL; development has moved to native Windows. Read this before doing anything.

## What we're building

A Chatterino-style desktop app: a unified live-chat client for **Twitch, YouTube and
Kick**. The user logs into each platform; when a channel goes live the app auto-connects
and starts feeding chat in. Viewing options: side-by-side panes, a single combined
merged chat, plus message highlighting, hiding, and filtering.

Single-user desktop app — the user logs into their own accounts and customises their own
layout. Not a multi-tenant hosted product, so no backend/database and no OAuth app
verification workflow is needed.

## Decisions already made (don't relitigate these)

**Electron, not Tauri.** The user does not know Rust and is directing development via AI
rather than writing code. Reasoning: everything stays in TypeScript so there's no Rust
compile-error debugging; Twitch EventSub WebSocket, YouTube polling and Kick's socket all
run in Electron's Node process with no CORS or plugin shims; OAuth loopback is a small
Node http server; `safeStorage` gives OS-keychain token encryption for free. Accepted cost
is memory (~250MB vs ~90MB) which is fine for a chat client.

**Develop on native Windows, not WSL.** WSLg is present and Electron would run, but the
user runs Windows and `node_modules` can't be shared across WSL/Windows (Electron ships a
platform-specific binary). Developing where the app actually runs avoids cross-building.
Project was copied from `/home/lucaskumara/stream-chat` to `C:\Users\Lucas\Documents\GitHub\stream-chat`.
The WSL copy still exists and can be deleted once Windows is confirmed working.

**Build order: Twitch first, end-to-end.** But Phase 0 is a mock chat provider so the
entire UI can be built and load-tested before any OAuth flow exists.

## Research findings (these shape the architecture)

**Twitch — use EventSub WebSocket, NOT IRC.** Twitch now recommends EventSub over IRC and
is adding concurrent-join limits to IRC. EventSub also delivers message deletion, timeouts
and chat-clear events cleanly, which the "hide messages" feature depends on. Subscribe to
`channel.chat.message` (needs `user:read:chat` scope). Twitch supports Device Code Flow,
which suits a desktop public client — no client secret, and you still get refresh tokens.

**YouTube — a hard quota ceiling is the single biggest constraint in the project.**
Default is 10,000 units/day per Google Cloud project. `liveChatMessages.list` costs ~5
units per poll (widely reported; not confirmed on the official cost table, so measure it
empirically). At a 5-second poll interval that's ~3,600 units/hour — roughly **3 hours of
streaming per day before the quota is exhausted**. Mitigations to weigh when Phase 3
arrives: respect the `pollingIntervalMillis` the API returns (it backs off on slow chats);
apply for a quota increase (requires a Google audit); or fall back to the unofficial
innertube endpoint that `masterchat`/`chat-downloader` use, which has no quota but is
ToS-grey and fragile. Default to the official API. To find the active broadcast cheaply,
use `liveBroadcasts.list?broadcastStatus=active&mine=true` rather than `search.list`
(search costs 100 units per call).

**Kick — no official realtime chat, so it goes last.** Kick's public API is
webhook/event-subscription based, which is useless for a desktop app with no public URL.
Every working Kick client instead uses their internal Pusher socket, channel pattern
`chatrooms.{chatroom_id}.v2`, event `App\Events\ChatMessageEvent`. Resolving a channel slug
to a numeric `chatroom_id` requires hitting a Cloudflare-protected internal v2 endpoint,
which rejects non-browser TLS fingerprints. This is unofficial and can break without
notice — keep it behind the provider interface so breakage stays isolated.

## Architecture

Providers are isolated behind a `ChatProvider` interface; each owns its own reconnect logic
so a dropped Twitch socket can't tear down YouTube. Every platform normalises into one
`ChatMessage` shape, so the UI never learns platform specifics.

Messages are pre-split into **fragments** (text / emote / mention / link) in the main
process. This is deliberate: Twitch and YouTube both hand over emote positions, and
re-deriving them with a regex in the renderer breaks on overlapping emote names and
unicode offsets.

The `MessageBus` batches messages and flushes to the renderer every 100ms. A busy channel
produces tens of messages per second, and one IPC call per message saturates the renderer
with structured-clone work.

```
src/
  shared/types.ts            # ChatMessage, Fragment, ModerationEvent, SourceState
  main/
    index.ts                 # NOT YET WRITTEN - app lifecycle, BrowserWindow
    ipc.ts                   # NOT YET WRITTEN
    bus.ts                   # MessageBus: 100ms batching, fanout to renderer
    sources.ts               # SourceManager: add/remove/track connected channels
    providers/
      types.ts               # ChatProvider interface + ProviderEvents
      mock.ts                # synthetic traffic generator, tunable msgs/sec
  preload/index.ts           # NOT YET WRITTEN - contextBridge API
  renderer/                  # NOT YET WRITTEN - React 19 + TS
```

## Files

All of `src/` is now written: `shared/{types,mockdata}.ts`,
`main/{index,ipc,bus,sources}.ts`, `main/providers/{types,mock}.ts`,
`preload/{index.ts,index.d.ts}`, and the full renderer (`App.tsx`, `store.ts`, `rules.ts`,
`bridge.ts`, `components/{ChatPane,MessageRow,RulesPanel,Sidebar}.tsx`).
Plus `tsconfig.json` / `tsconfig.node.json` / `tsconfig.web.json`, which did not exist even
though `npm run typecheck` referenced them.

## Dependency resolution — RESOLVED

`npm install` now completes cleanly (386 packages, 0 vulnerabilities). The original
ERESOLVE was real: `electron-vite@2.3` peer-required Vite 4/5 while `@tailwindcss/vite@4`
wanted Vite 6+. The PostCSS workaround was not needed — `electron-vite@5` accepts
Vite 5/6/7, so the Tailwind **Vite plugin** is back and `postcss.config.js` was deleted.

A second conflict was waiting behind the first: `@vitejs/plugin-react@6` now peer-requires
Vite **8**, which electron-vite 5 does not accept. Pinned `@vitejs/plugin-react@^5.2.0`
(accepts Vite 4–8) and `vite@^7.3.6`. The working set, all verified against the registry
rather than from memory:

| package | pinned | note |
|---|---|---|
| electron | ^44.0.0 | was ^33, stale |
| electron-builder | ^26.15.3 | was ^25, stale |
| electron-vite | ^5.0.0 | was ^2.3, the source of the conflict |
| vite | ^7.3.6 | 8.x exists but electron-vite 5 caps at 7 |
| @vitejs/plugin-react | ^5.2.0 | v6 requires Vite 8 — do not bump blindly |
| @tailwindcss/vite + tailwindcss | ^4.3.3 | plugin, not PostCSS |
| typescript | ^5.9.3 | 7.0.2 is `latest` (the native port); deliberately not adopted mid-scaffold |

**Trap that cost real time:** `npm install` exited 0 but Electron's postinstall never
downloaded the binary — no `node_modules/electron/dist`, no `path.txt`, and
`electron-vite dev` failed with `Error: Electron uninstall`. Fix:
`node node_modules/electron/install.js`. Check `path.txt` exists before assuming a clean
install.

**Module format:** `"type": "module"` was removed from package.json. electron-vite 5 then
emits CJS for main and preload (verified in `out/`), so `__dirname` works and the preload
can keep `sandbox: true`. Do not re-add `"type": "module"` without re-checking both.

## Running it

From `C:\Users\Lucas\Documents\GitHub\stream-chat`:

- `npm run dev` — Electron app + renderer dev server
- `npm run typecheck` — both tsconfig projects
- `npm run build` — typecheck then build all three targets
- `npx electron-vite dev --rendererOnly` then <http://localhost:5173> — UI only, in a
  browser, using the in-page simulator (better devtools for profiling the list)

Node v24.13.1 / npm 11.8.0 on native Windows.

## Phase 0 — COMPLETE and verified under load

Everything below was measured against the running app, not assumed.

- **200 msg/sec sustained** (4 mock sources x 50/s) — 4x the Phase 0 target. Zero long
  tasks (>50ms) in a 5s window; JS heap flat at 30–34MB.
- **Virtualization confirmed:** ~117 rows in the DOM while 2,000 messages are held.
- Verified in the real Electron app over IPC (mode badge reads `electron`): 13,113 ->
  13,893 messages in 4s.
- **Scroll freeze:** scrolling up snapshots the list, so ring-buffer eviction cannot yank
  the viewport. Measured **0px drift** while 100+ msg/s arrived; unread counter climbs and
  resume snaps to the bottom.
- Verified working: panes, combined view (mixed platforms), text filter, highlight rules,
  hide rules, invalid-regex isolation, deleted/timeout/clear-chat rendering, the
  show-deleted toggle, and the live font-size control.
- `openExternal` refuses non-http(s) URLs — verified end-to-end that `file://` is rejected
  by the main process.

### Notable design decisions made during Phase 0

- **Scroll freeze over index compensation.** The ring buffer evicts from the front, which
  shifts every virtual index. Rather than compensating scrollTop, the pane renders a frozen
  snapshot while the reader is scrolled up. Simpler, and it matches Chatterino behaviour.
- **Rules evaluated at render, memoised by message id.** Editing a rule restyles scrollback
  instead of only affecting new messages. The cache is invalidated by rebuilding the engine
  when the rules array identity changes.
- **`src/shared/mockdata.ts`** holds the pure generator so the main-process provider and the
  browser dev harness produce identical messages.
- **Browser dev harness** (`renderer/src/bridge.ts`): with no preload, the renderer stands up
  an in-page simulator with the same contract and the same 100ms cadence. The top-right
  badge shows `electron` or `browser`.
- Font sizing runs through one CSS variable (`--chat-font-size`); every message-row size is
  in `em`, so one control scales timestamps, badges and emotes together.

### Not yet done (deliberately deferred)

- No settings persistence — rules, layout and font size reset on restart (Phase 5).
- No message sending (Phase 5).
- `electron-builder` has no config block yet, so `npm run pack`/`dist` are untested.
- CSP keeps `script-src 'unsafe-inline'` because the dev server injects the React Refresh
  preamble; tighten to a nonce when packaging.

## Phase plan

- **Phase 0: DONE.** Scaffold + mock provider + full UI, verified at 200 msg/sec.
- **Phase 1:** Twitch end-to-end. Device Code Flow auth, EventSub WebSocket,
  `stream.online`/`stream.offline` for auto-connect, badges and emotes.
- **Phase 2:** UI features hardened against real data — multi-pane layout, combined view,
  filter/highlight rule engine, hide rules.
- **Phase 3:** YouTube, with the quota strategy decided at that point.
- **Phase 4:** Kick via the unofficial Pusher socket.
- **Phase 5:** polish — 7TV/BTTV/FFZ emotes, settings persistence, sending messages back,
  auto-update.

## Official API references

- Twitch (Helix + EventSub): https://dev.twitch.tv/docs/api/
- YouTube liveChatMessages: https://developers.google.com/youtube/v3/live/docs/liveChatMessages
- Kick: https://docs.kick.com/

Note the Kick docs cover the *public* webhook/event-subscription API only. It has no
realtime socket for a desktop client with no public URL, which is why Phase 4 uses the
internal Pusher socket instead. Keep the official docs as the reference for auth and
channel lookup, not for chat transport.
