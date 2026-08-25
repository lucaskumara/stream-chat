# Gotchas

Things that cost real time to discover, and that a reasonable-looking change will
silently re-break. The code is deliberately comment-free; this file is where the
"why" lives.

---

## Message pipeline invariants

**Fragments are built in the main process. The renderer never parses message text.**
Twitch hands over emote positions; re-deriving them with a regex in the UI breaks on
overlapping emote names and unicode offsets. New platforms do their splitting in
`src/main/.../normalize.ts`.

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
snapshot instead of compensating scroll offsets.

---

## Emotes

**Emotes are always resolved in main, regardless of a channel's toggles.** Each emote
fragment is tagged with its `provider` (`native` / `7tv` / `bttv`) and `MessageRow` decides
at draw time whether to draw the image or the original word. Filtering at receipt is
one-way — turning a provider back on cannot recover emotes that were never resolved. This
was a real bug: toggles changed state but not the view.

**Matching is whole-token and case-sensitive.** Substring matching turns `GIGACHAD` inside a
longer word into an image; case folding collides distinct emote names.

**7TV calls YouTube `google`, not `youtube`.** Passing `youtube` returns
`400 invalid platform`, which reads like "YouTube unsupported" and is not. A missing user
returns `404`; the two are easy to confuse. Valid platforms: `TWITCH, DISCORD, GOOGLE, KICK`.

**BTTV is Twitch-only** and keys channels by Twitch user id. It is still worth having —
some large channels have zero 7TV emotes and hundreds of BTTV ones, and without it their
chat renders as bare words.

**Anonymous mode has badge *names* but no badge *images*.** Helix badge endpoints need auth,
and the old public `badges.twitch.tv` host no longer resolves (DNS returns no address).
Only badges that say something about the speaker are shown; rendering every set as
truncated text produced noise like `SUBCRY` and `UMB`.

---

## Twitch specifics

**`user:read:chat` alone is enough to read *any* channel's chat.** Moderator status is only
required for app access tokens. This is what makes "add a channel by name" work after a
single sign-in.

**Anonymous IRC has no liveness signal, and chat traffic is not one.** Offline channels have
active chat. `SourceState.live` is tri-state — `null` means unknown. Inferring `live` from
the first message was a real bug that marked idle channels LIVE.

**EventSub subscriptions are bound to a session id.** A reconnect invalidates all of them and
they must be recreated; that is why one hub owns the socket for every channel.

**`keepalive_timeout_seconds` only appears in `session_welcome`.** Re-arming the watchdog from
later messages reverts to the default and can terminate a healthy socket. Retain the
negotiated value.

**A superseded socket must not drive reconnect logic.** After `session_reconnect`, closing the
old socket fires its close handler; without an identity check (`this.ws !== socket`) it
schedules a duplicate connection.

**Concurrent token refreshes must share one in-flight promise.** Several subscriptions
starting at once would each spend the refresh token and invalidate each other.

**The Client ID is a build constant, not user input.** A public OAuth client has no secret;
the id identifies the application and authorises nothing. It lives in
`src/main/twitch/clientId.ts`, overridable by `TWITCH_CLIENT_ID`. Asking a user to register
an app is developer setup masquerading as a feature. If this repo ever goes public, move the
value to an untracked `.env`.

---

## Main process

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

---

## Build and tooling

**Dependency versions are load-bearing.** `electron-vite@5` peer-caps at Vite 7, while
`@vitejs/plugin-react@6` requires Vite 8. Pinned: `vite@^7`, `@vitejs/plugin-react@^5`.
Bumping either blindly reintroduces the ERESOLVE conflict.

**`"type": "module"` is deliberately absent** so main and preload emit CJS. That keeps
`__dirname` working and lets the preload stay `sandbox: true`.

**`npm install` can exit 0 without downloading the Electron binary.** Symptom:
`Error: Electron uninstall`. Check `node_modules/electron/path.txt` exists; fix with
`node node_modules/electron/install.js`.

**Bash heredocs eat one level of backslash.** `\\s` becomes `\s` (which JS collapses to `s`),
and `'\r\n'` becomes a literal CRLF that breaks the file. Use the Write tool, or build
escapes with `chr(92)`. This has caused both fake test failures and real syntax errors.

**Testing the IPC surface is not testing the app.** Calling `window.api.addSource(...)` over
CDP bypasses the components entirely and once hid a bug where the add button silently did
nothing. Drive real inputs and real buttons.
