# stream-chat

A unified live chat client for **Twitch**, **YouTube** and **Kick**, in one window — with
per-chat links you can dock inside OBS, and a relay that forwards your OBS stream to all
three platforms at once.

It is a single-user desktop app. There is no backend, no database and no account to create:
you point it at channels and it reads their chat directly.

---

## What it does

- **All three platforms in one window.** A fixed tab per platform, each showing that
  platform's chat once you've set a channel for it.
- **Merge or split.** View two or more connected chats as separate columns or one combined,
  interleaved feed.
- **Emotes and badges resolved properly.** Native platform emotes plus 7TV and BTTV
  (togglable per platform), with subscriber and channel badges and each chatter's own name
  colour.
- **Dock any chat in OBS.** Every chat is also served at a local URL you can add as an OBS
  browser dock or an on-stream browser source.
- **Restream to all three at once.** Point OBS at the app's own RTMP ingest, and it forwards
  the stream to whichever of Twitch, YouTube and Kick you've given a stream key — switching
  a platform on or off never disconnects OBS.
- **Filter as you read.** Per-pane search by message text or author — click a name to filter
  by them — and one app-wide chat text size.

---

## Platform support

There is no sign-in for reading chat on any platform.

| Platform | Sign-in | How chat is read |
|---|---|---|
| Twitch | Not required | Anonymous IRC. Badges and colours resolve over Twitch's public GraphQL endpoint. |
| YouTube | Not required | The same innertube endpoint the web player uses — no API key, no quota. |
| Kick | Not required | Kick's realtime socket. |

**Set a channel as:**

| Platform | Accepted |
|---|---|
| Twitch | a channel name, or a `twitch.tv/…` link |
| YouTube | `@handle`, a `UC…` channel id, an 11-character video id, or a `youtube.com/…` link |
| Kick | a channel name, or a `kick.com/…` link |

YouTube channels are only readable while they are live **and** have chat enabled; the app
reports which of those is missing and keeps re-checking. Twitch and Kick chat is readable
whether or not the channel is streaming.

---

## OBS links

Open Settings → Platforms, set a channel, and copy the link next to it:

```
http://localhost:4568/chat/twitch/<channel>
http://localhost:4568/chat/youtube/<handle>
http://localhost:4568/chat/kick/<channel>
```

In OBS: **Docks → Custom Browser Docks**, paste, name it. The same URL also works as a
**Browser Source** for putting chat on stream.

One URL is one chat — OBS already docks, floats and snaps panels, so two chats side by side
is two docks.

Optional query parameters, none of them required:

| Parameter | Default | Effect |
|---|---|---|
| `size` | `16` | Message text size in px, snapped to the nearest step between 12 and 24 |
| `timestamps` | `1` | `0` hides the timestamp column |
| `transparent` | `0` | `1` drops the background — use this for a browser *source* |

```
http://localhost:4568/chat/twitch/<channel>?size=20&timestamps=0&transparent=1
```

The link is a **mirror**: a dock shows a channel only while the app is running and that
channel is set in Settings → Platforms. Close the app and the dock says so, then reconnects
on its own when you reopen it. Opening a dock URL never sets a channel by itself.

The link server listens on loopback only, and rejects WebSocket connections from any origin
but its own, so pages you have open elsewhere cannot read your chat.

---

## Using it

**The title bar is the whole navigation.** Chat / Broadcast / Settings on the left, a tab per
platform in the centre, window controls on the right.

**A platform tab toggles that chat on or off**, showing either its live messages or a prompt
to set a channel for it in Settings. With two or more connected chats on screen, a button
next to the tabs switches between separate columns and one merged, interleaved feed.

**Settings** is a modal over whichever screen is underneath, with three panes:

- **General** — open the log folder for diagnostics.
- **Appearance** — theme (dark/system/light), timestamps, deleted-message visibility, how
  much history to keep, message density, name colouring, and chat text size (12–24px, reset
  to 16px in one click).
- **Platforms** — one card per platform: the channel to read chat from, the stream key to
  forward video with (plus a stream URL, only where the platform doesn't publish a fixed
  one — Kick), its OBS dock link, and its 7TV/BTTV toggles.

**Filtering.** Each pane's search bar takes a comma-separated list of terms, ANDed together:

| Term | Matches |
|---|---|
| `hello` | messages containing "hello" |
| `author:name` or `from:name` | messages from that chatter |
| `def, author:abc` | messages containing "def" **and** sent by abc |

Clicking a chatter's name adds them as a filter and opens the panel. A leading `@` is
ignored, so `author:name` and `author:@name` are the same search.

**A pane's own name is a link** to that channel's page, in your browser.

---

## Broadcasting

Point OBS at the app's own ingest once — Server and Stream Key are shown, and copyable, on
the Broadcast screen (`Settings → Stream → Custom` in OBS).

Turn on whichever of Twitch, YouTube and Kick have a stream key set in Settings → Platforms,
and the app forwards your stream to each of them — no re-encoding, and switching a platform
on or off mid-stream never disconnects OBS. Twitch and YouTube publish one ingest for every
channel; Kick provisions a URL per channel, so Settings asks for it alongside the key.

Kick requires a keyframe interval of 2 seconds or less in your encoder, or it will accept the
stream without ever going live. The app measures your actual interval and says so if it's too
long.

---

## Install

There are no published releases yet — build it yourself with `npm run dist` (see below),
which produces two Windows artifacts in `release/`:

- `stream-chat-<version>-setup.exe` — installer, lets you pick a directory
- `stream-chat-<version>-portable.exe` — single self-extracting file

Builds are **unsigned**, so Windows SmartScreen warns on first run
(*More info → Run anyway*).

macOS and Linux targets are configured but have never been built or tested.

---

## Build from source

Requires Node.js and npm.

```bash
npm install
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Launches the app with the renderer dev server |
| `npm run typecheck` | Type-checks both TypeScript projects — the fastest correctness gate |
| `npm run test` | Runs the pure-logic test suite (a few hundred cases, under 2s) |
| `npm run build` | Type-checks, then builds main, preload and renderer |
| `npm run pack` | An unpacked app under `release/`, no installer |
| `npm run dist` | The installer and portable exe for the host platform |

There is a test suite (`vitest`) but no linter configured.

If `npm install` finishes but the app fails with `Error: Electron uninstall`, the Electron
binary did not download — fix it with `node node_modules/electron/install.js`.

---

## What it stores

Your platform setup — the channel, stream URL and stream key for each platform — encrypted
with the OS keystore (DPAPI on Windows) under your user data directory. If no encryption
backend is available, values are kept in memory for the session rather than written in the
clear.

Chat itself is not stored: the app opens with empty panes every launch and refills from live
chat.

---

## Status and caveats

Working: all three platforms end to end, emotes, badges, name colours, merged/split panes,
per-pane filtering, OBS links, and restreaming to all three platforms at once.

Not done yet:

- **No message sending.** It is a reader.
- **No auto-update.**
- **YouTube super-chats, memberships and stickers are not shown** — only ordinary chat
  messages are mapped.
- **No moderation.**

**These are unofficial APIs.** YouTube live chat and Kick chat are read through the same
endpoints their own web clients use, not through published APIs — YouTube's official chat
API is poll-based and quota-limited, and Kick's public API is webhook-based and unusable
from a desktop app. They work well, and they can break without warning when a platform
changes something.

---

## License

[MIT](LICENSE).
