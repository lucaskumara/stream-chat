# stream-chat

A unified live chat client for **Twitch**, **YouTube** and **Kick**, in one window — with
per-chat links you can dock inside OBS.

It is a single-user desktop app. There is no backend, no database and no account to create:
you point it at channels and it reads their chat directly.

---

## What it does

- **All three platforms in one place.** Add a channel by name or paste its link. Each chat
  gets a tab.
- **Read side by side.** Open several chats at once as columns, and save the arrangement as
  a group — clicking any member restores the whole layout.
- **Emotes and badges resolved properly.** Native platform emotes plus 7TV and BTTV, with
  subscriber and channel badges and each chatter's own name colour.
- **Dock any chat in OBS.** Every chat is also served at a local URL you can add as an OBS
  browser dock or an on-stream browser source.
- **Filter as you read.** Per-pane search by message text or author, per-pane text size.

---

## Platform support

Only Twitch has any notion of an account, and even there it is optional.

| Platform | Sign-in | How chat is read |
|---|---|---|
| Twitch | Not required | Anonymous IRC. Badges and colours resolve over Twitch's public GraphQL endpoint. |
| YouTube | Not required | The same innertube endpoint the web player uses — no API key, no quota. |
| Kick | Not required | Kick's realtime socket. |

**Add a channel as:**

| Platform | Accepted |
|---|---|
| Twitch | `xqc`, or a `twitch.tv/…` link |
| YouTube | `@handle`, a `UC…` channel id, an 11-character video id, or a `youtube.com/…` link |
| Kick | `channel-name`, or a `kick.com/…` link |

YouTube channels are only readable while they are live **and** have chat enabled; the app
reports which of those is missing and keeps re-checking. Twitch and Kick chat is readable
whether or not the channel is streaming.

---

## OBS links

Open a chat, click the **gear** in its bar, and copy the link:

```
http://localhost:4568/chat/twitch/xqc
http://localhost:4568/chat/youtube/LofiGirl
http://localhost:4568/chat/kick/adinross
```

In OBS: **Docks → Custom Browser Docks**, paste, name it. The same URL also works as a
**Browser Source** for putting chat on stream.

One URL is one chat — OBS already docks, floats and snaps panels, so two chats side by side
is two docks.

Optional query parameters, none of them required:

| Parameter | Default | Effect |
|---|---|---|
| `size` | `16` | Message text size in px, snapped to the nearest step between 10 and 24 |
| `timestamps` | `1` | `0` hides the timestamp column |
| `transparent` | `0` | `1` drops the background — use this for a browser *source* |

```
http://localhost:4568/chat/twitch/xqc?size=20&timestamps=0&transparent=1
```

The link is a **mirror**: a dock shows a channel only while the app is running and that
channel is open in it. Close the app and the dock says so, then reconnects on its own when
you reopen it. Opening a dock URL never adds a channel by itself.

The link server listens on loopback only, and rejects WebSocket connections from any origin
but its own, so pages you have open elsewhere cannot read your chat.

---

## Using it

**Tabs are the whole navigation.** `+` adds a channel, `×` removes one.

**Split view.** The pin on each tab opens that chat alongside the others. Two or more chats
on screen are remembered as a group, marked by a coloured band across their tabs; clicking
any member later restores the whole arrangement. Tabs drag to reorder, and a group drags as
one block by the coloured grip on its leftmost tab.

**Filtering.** The bar at the top of each pane takes a comma-separated list of terms, ANDed
together:

| Term | Matches |
|---|---|
| `hello` | messages containing "hello" |
| `author:name` or `from:name` | messages from that chatter |
| `def, author:abc` | messages containing "def" **and** sent by abc |

Clicking a chatter's name adds them as a filter. A leading `@` is ignored, so `author:name`
and `author:@name` are the same search.

**Text size** is per pane, adjusted with the `A` buttons, and is independent of the size a
dock uses.

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
| `npm run build` | Type-checks, then builds main, preload and renderer |
| `npm run pack` | An unpacked app under `release/`, no installer |
| `npm run dist` | The installer and portable exe for the host platform |

There is no test runner and no linter configured.

If `npm install` finishes but the app fails with `Error: Electron uninstall`, the Electron
binary did not download — fix it with `node node_modules/electron/install.js`.

---

## What it stores

Almost nothing. The app opens empty every launch, and the channels you add live only for
that session — they are never written to disk.

The one exception is a Twitch access token, if you ever obtain one, encrypted with the OS
keystore (DPAPI on Windows) under your user data directory. If no encryption backend is
available it is kept in memory for the session rather than written in the clear.

---

## Status and caveats

Working: all three platforms end to end, emotes, badges, name colours, tabs and split
groups, per-pane filtering, and OBS links.

Not done yet:

- **No message sending.** It is a reader.
- **No settings persistence**, including the channel list.
- **No auto-update.**
- **YouTube super-chats, memberships and stickers are not shown** — only ordinary chat
  messages are mapped.
- **Twitch account sign-in has no UI.** The device-code flow exists in the app's main
  process but nothing in the interface triggers it, so Twitch is read anonymously in
  practice. Nothing is lost by this: badges and colours are identical on both paths.

**These are unofficial APIs.** YouTube live chat and Kick chat are read through the same
endpoints their own web clients use, not through published APIs — YouTube's official chat
API is poll-based and quota-limited, and Kick's public API is webhook-based and unusable
from a desktop app. They work well, and they can break without warning when a platform
changes something.

---

## License

MIT.
