# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A unified live chat client for Twitch, YouTube and Kick. Electron + React 19 + TypeScript.
Two companion docs:
- **`GOTCHAS.md`** — traps that a reasonable-looking change will silently re-break. Read it
  before touching the message pipeline, emotes, or either Twitch transport.
- **`HANDOFF.md`** — project background, phase plan, and API research findings.

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

Things that are not obvious from any single file. `GOTCHAS.md` has the full list with the
reasoning behind each:

**Fragments are built in the main process and never re-parsed in the renderer.**
`ChatMessage.fragments` arrives pre-split into text/emote/mention/link. Twitch hands over
emote positions; re-deriving them with a regex in the UI breaks on overlapping emote names
and unicode offsets. When adding a platform, do the splitting in `src/main/.../normalize.ts`
and keep the renderer dumb.

**The MessageBus batches; never send per message.** A busy channel does tens of messages a
second and one IPC call per message saturates the renderer with structured-clone work.

**Twitch has two transports, chosen at runtime.** `SourceManager.createProvider` picks
`TwitchIrcProvider` (anonymous, no account) when signed out and `TwitchProvider` (EventSub)
when a token exists. Anonymous is the default and the normal path; EventSub adds badge
images and a real live indicator. Both must produce identical `ChatMessage` shapes —
especially message ids, or moderation events won't bind to their messages.

**Emotes are always resolved in main, and filtered in the renderer.** `applyEmotes` runs on
every message regardless of a channel's toggles, tagging each emote fragment with its
`provider` (`native` / `7tv` / `bttv`). `MessageRow` decides at draw time whether to show the
image or the original word. This is what makes toggling reversible and apply to scrollback —
filtering at receipt is one-way and cannot be undone.

**`SourceState.live` is tri-state** (`true` / `false` / `null`). Anonymous IRC has no
liveness signal, and chat traffic is not one — offline channels have active chat. `null`
means unknown; do not collapse it to `false`.

**Panes freeze while scrolled up.** The store's ring buffer evicts from the front, which
shifts every virtual index. `ChatPane` renders a frozen snapshot when the reader scrolls up
rather than compensating scroll offsets.

## Layout

- `src/shared/` — types plus `channel.ts` (the "add a channel" parser, used by both processes)
- `src/main/providers/` — one `ChatProvider` per transport; each owns its own reconnect so a
  dropped Twitch socket cannot disturb another platform
- `src/main/twitch/` — auth (Device Code Flow), Helix, the EventSub and IRC sockets, normalizers
- `src/main/emotes/` — 7TV + BTTV caches behind a `ThirdPartyEmotes` aggregator
- `src/renderer/src/` — `App.tsx`, zustand `store.ts`, `components/`

The Twitch **Client ID is a build-time constant** in `src/main/twitch/clientId.ts`, overridable
by `TWITCH_CLIENT_ID`. It is not a secret and is deliberately not user input — a public OAuth
client has no secret, and asking a user to register an app is developer setup, not a feature.

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
belong in `GOTCHAS.md` rather than inline. When a change turns up something non-obvious,
add it there instead of leaving a comment. A `clean-code` skill is installed at user level
covering naming, function size, SOLID and error handling.

Windows line endings: `.gitattributes` normalises to LF in the repo, so `git` warns about
CRLF conversion on nearly every commit. That is expected.
