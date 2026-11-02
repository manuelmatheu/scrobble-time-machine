# Play on (Spotify Connect) and session hand-off Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pick the speaker the radio plays on from the app (desktop and phone), keep every window truthful about what plays, and let a radio started on one device be shown and carried on by another.

**Architecture:** Part 1 adds `js/connect.js` (device list, picker, Playing on bar, Home row, phone strip) and tightens `js/player.js` polling so every window shows only what Spotify reports. Part 2 adds a Vercel function `api/session.js` backed by Upstash Redis over REST, and `js/handoff.js`, which writes the running radio as a "session note", decides which single window adds songs (the driver), shows the radio in other windows (followers), and lets a phone take over with 10-song top-ups.

**Tech Stack:** Vanilla JS globals, no build step, no npm. Spotify Web API and Web Playback SDK. Vercel serverless (CommonJS, global `fetch`). Upstash Redis REST. Tests are dependency-free node scripts in `tests/`, printing `<name>: ok`.

**Spec:** `docs/superpowers/specs/2026-10-27-play-on-connect-design.md` (read it with this plan; section numbers below refer to it).

## Global Constraints

- No npm dependencies, no modules, no build step. New browser files are plain globals with the `if (typeof module !== "undefined" && module.exports)` export block at the end (as `js/radio.js`), and no DOM access at load time outside an `if (typeof window !== "undefined" && window.addEventListener)` guard, so `vm` tests can load them.
- Script order in `index.html`: `config.js, spotify.js, lastfm.js, ui.js, player.js, connect.js, handoff.js (part 2), radio.js, app.js`. Each new file goes in the `SHELL` list of `sw.js`, and `CACHE` is bumped (`stm-shell-v2` in part 1, `stm-shell-v3` in part 2).
- Colors only as tokens on lines 1 and 2 of `css/style.css` (`tests/design-system.test.js`). No text under 12px, no `transition:all`, no overshoot easing, keyframes animate only `opacity`/`transform`, and the reduced-motion block covers new animations (`tests/motion.test.js`).
- Every tap target is at least 44px. HTML comments ASCII only (CLAUDE.md quirk 2).
- Never play on another STM window's player: a device with `name === STM_PLAYER_NAME` and `id !== sdkDeviceId`.
- Copy, verbatim from the spec:
  - Bar: `Playing on <device> · <type>`, button `Change`. Home row: `Plays on <device>`, button `Change`.
  - Restricted heading: `Can't play from here`. Restricted line: `<Brand>. Spotify doesn't let other apps control it.` (Sonos), otherwise `Spotify doesn't let other apps control it.`
  - Hint under the list: `Don't see a speaker? Play something on it once from the Spotify app, then Refresh.`
  - Empty list on a phone: `No devices found. Open Spotify on this phone or on a speaker, then Refresh.`
  - Phone's own app row: `This phone` with the line `Plays through your Spotify app`.
  - Pick failure toast (`"error"`): `Couldn't play on <device>. Play something on it from the Spotify app, then try again.`
  - No reading: `Checking what's playing…`
- Values: device list auto-refresh `4000` ms while open; re-read after a pick `1500` ms; `POLL_INTERVAL` stays 5000; phone breakpoint `max-width:720px`; `PHONE_TOPUP = 10`; heartbeat `60000` ms; follower note re-read `30000` ms; stale driver `180000` ms; note TTL `43200` s; note cap `65536` bytes; token -> user id cache `300000` ms; `radioSeen` kept in the note: last `300` keys.
- Hidden pages do not poll, with one exception the spec implies but does not state: a window that drives a radio whose music plays on another device keeps polling while hidden (it is the one that tops up and seams; stopping it would end the radio on a desktop in the background, which works today). Followers and the home poll stop when hidden.
- Delivery: part 1 is PR 1 from `claude/play-on`; after it is squash-merged, part 2 is PR 2 from `claude/play-on-handoff`, created from `origin/main`. Both ride as v2.12. Do not commit the owner's pre-existing uncommitted `CLAUDE.md` change unless asked.

## Review Focus

- Picking the device that is already current: nothing is sent, the list just closes (Task 2 test).
- A second tap on a row while a pick is in flight: one request, not two (Task 2 test).
- A phone top-up while the speaker is paused: it fills but sends no play, so it does not unpause the user's music; the songs go out on resume or at the seam (Task 9 test).
- A follower sees a song that is not in its copy of the note: it re-reads the note once; if the song is still missing it shows the paused-radio state, never a hero built from the note (Task 8 test).
- The store answers with garbage, a timeout or a 5xx: the hand-off turns itself off for the page, with no toast, and the radio runs as in part 1 (Task 7 test).

---

## Part 1: the Play on picker (PR 1, branch `claude/play-on`)

### Task 0: Commit the spec and the plan

- [ ] **Step 1: Commit the two documents only**

```bash
git add docs/superpowers/specs/2026-10-27-play-on-connect-design.md docs/superpowers/plans/2026-10-27-play-on-connect.md
git commit -m "Play on: design spec and implementation plan"
```

### Task 1: Device list model

The pure part of the picker: which rows, in what order, with what text. Also wires `js/connect.js` into the page so later tasks only add to it.

**Files:**
- Create: `js/connect.js`
- Create: `tests/connect.test.js`
- Modify: `index.html` (script tag after `js/player.js`), `sw.js` (`SHELL` + `CACHE = "stm-shell-v2"`)

**Interfaces:**
- Produces (all pure, exported for node):
  - `connectDeviceRows(devices, ctx) -> { rows: Row[], restricted: Row[] }` where `ctx = { sdkDeviceId: string|null, sdkReady: boolean, onPhone: boolean, currentId: string|null }` and `Row = { id, name, type, kind, line, icon, current: boolean, active: boolean, disabled: boolean }`.
  - `connectDeviceIcon(type) -> string` (a Phosphor class: Computer `ph-desktop`, Smartphone `ph-device-mobile`, Speaker `ph-speaker-hifi`, CastAudio / group `ph-speaker-simple-high`, TV `ph-television`, Automobile `ph-car`, other `ph-speaker-high`).
  - `connectRestrictedLine(device) -> string`.
  - `connectSameRows(a, b) -> boolean` (same ids, names, current, active and disabled, in order: the quiet refresh skips the re-render when true).
  - `connectDefaultDevice(devices, ctx) -> Row|null` (spec 4.3 default).
  - `connectOnPhone() -> boolean` (`matchMedia("(max-width:720px)")`, false in node).

- [ ] **Step 1: Write the failing test** `tests/connect.test.js`, loading `config.js, radio.js, spotify.js, ui.js, player.js, connect.js` with `vm.runInThisContext` exactly as `tests/radio-engine.test.js` does, then:

```js
const dev = (id, name, type, extra) => Object.assign({ id, name, type, is_active: false, is_restricted: false }, extra);
const ctx = { sdkDeviceId: "me", sdkReady: true, onPhone: false, currentId: "me" };
// this browser first even when Spotify has not listed it yet; other STM players left out
let r = connectDeviceRows([dev("k", "Kitchen", "Speaker"), dev("o", STM_PLAYER_NAME, "Computer")], ctx);
assert.deepEqual(r.rows.map(x => x.id), ["me", "k"]);
assert.equal(r.rows[0].name, "This browser"); assert.equal(r.rows[0].current, true);
// our own SDK device listed by Spotify appears once
r = connectDeviceRows([dev("me", STM_PLAYER_NAME, "Computer", { is_active: true }), dev("k", "Kitchen", "Speaker")], ctx);
assert.deepEqual(r.rows.map(x => x.id), ["me", "k"]);
assert.match(r.rows[0].line, /playing/);
// restricted devices go to their own group, disabled, with the brand line
r = connectDeviceRows([dev("s", "Living Room", "Speaker", { is_restricted: true, name: "Sonos Living Room" })], ctx);
assert.equal(r.rows.length, 1); assert.equal(r.restricted[0].disabled, true);
assert.equal(r.restricted[0].line, "Sonos. Spotify doesn't let other apps control it.");
assert.equal(connectRestrictedLine(dev("x", "Den", "TV", { is_restricted: true })), "Spotify doesn't let other apps control it.");
// on a phone its own Spotify app is "This phone"
r = connectDeviceRows([dev("p", "Pixel 9", "Smartphone")], { sdkDeviceId: null, sdkReady: false, onPhone: true, currentId: null });
assert.equal(r.rows[0].name, "This phone"); assert.equal(r.rows[0].line, "Plays through your Spotify app");
// defaults: this browser; on a phone the active device, else its own app
assert.equal(connectDefaultDevice([], ctx).id, "me");
assert.equal(connectDefaultDevice([dev("p", "Pixel", "Smartphone"), dev("k", "Kitchen", "Speaker", { is_active: true })], { sdkReady: false, onPhone: true }).id, "k");
assert.equal(connectDefaultDevice([dev("p", "Pixel", "Smartphone")], { sdkReady: false, onPhone: true }).id, "p");
assert.equal(connectDefaultDevice([], { sdkReady: false, onPhone: true }), null);
// quiet refresh: unchanged lists compare equal, a new active device does not
const a = connectDeviceRows([dev("k", "Kitchen", "Speaker")], ctx).rows;
assert.equal(connectSameRows(a, connectDeviceRows([dev("k", "Kitchen", "Speaker")], ctx).rows), true);
assert.equal(connectSameRows(a, connectDeviceRows([dev("k", "Kitchen", "Speaker", { is_active: true })], ctx).rows), false);
console.log("connect: ok");
```

The brand is the first word of a restricted device's name when it is `Sonos` (case-insensitive); other brands are not guessed.

- [ ] **Step 2: Run it to make sure it fails**

Run: `node tests/connect.test.js` - Expected: FAIL (`connect.js` not found).

- [ ] **Step 3: Implement the functions above in `js/connect.js`; add the script tag and the `sw.js` entries**

`kind` is a human label from the type (`Computer`, `Phone`, `Speaker`, `Speaker group`, `TV`, `Car`); `line` is `kind` plus ` · playing` for the active device. A device with `id === null` is skipped (it cannot be picked).

- [ ] **Step 4: Run all tests**

Run: `for t in tests/*.test.js; do node $t || exit 1; done` - Expected: every file prints `<name>: ok`.

- [ ] **Step 5: Commit** - `git add js/connect.js tests/connect.test.js index.html sw.js && git commit -m "Play on: device list model"`

### Task 2: Picking a device

**Files:**
- Modify: `js/connect.js`, `tests/connect.test.js`

**Interfaces:**
- Consumes: `connectDeviceRows`, `connectDefaultDevice` (Task 1); `spotifyPlay(token, uris, positionMs)`, `getSpotifyDevices(token)`, `spotifyResetPlayMode(token, id)`, `setPlaybackDevice(dev|null)`, `radioUnsentUris()`, `radioUrisFrom(matched, count, uri)`, `startPolling()`.
- Produces:
  - `connectPick(id) -> Promise<boolean>`: the picker rows call it.
  - `connectTransfer(token, id, play) -> Promise<number>`: `PUT /me/player` with `{ device_ids: [id], play }`; resolves to the HTTP status (0 on a network error).
  - `connectCurrentPosition() -> number`: `_sdkPositionMs` while the SDK plays, else `remoteNow.pos` extrapolated by `Date.now() - remoteNow.at` when `remoteNow.playing`.
  - `pollSoon(ms)` (in `js/player.js`): one `pollNowPlaying()` after `ms`, replacing any pending one.
  - State: `connectBusy` (a pick in flight).

Behavior (spec 4.3): picking the current device closes the list and sends nothing. No radio: the pick only sets the device (`setPlaybackDevice(null)` for this browser, else `setPlaybackDevice({ id, name, type })`), so the next `startRadio()` -> `spotifyPlay()` plays there. Radio running: with unsent songs (`radioUnsentUris().length || radioPendingReissue`), set the device and `spotifyPlay(token, radioUrisFrom(matchedUris, allTrackCount, current), connectCurrentPosition())`; otherwise `connectTransfer(token, id, !radioPaused)` then `spotifyResetPlayMode(token, id)`. On success, `if (!pollTimer) startPolling()`. On failure (play false, or status not 2xx), restore the previous device, show the failure toast, and refresh the list. Either way, `pollSoon(1500)`.

- [ ] **Step 1: Write the failing tests** (in `tests/connect.test.js`, with `global.fetch`, `global.spotifyPlay`, `global.getSpotifyToken`, `global.showStatus` and `global.pollSoon` stubbed to record calls):

```js
// no radio: the pick only sets the device
run("radioActive = false; playbackDeviceId = null;");
assert.equal(await connectPick("k"), true);
assert.equal(run("playbackDeviceId"), "k"); assert.equal(fetches.length, 0); assert.equal(plays.length, 0);
// radio with unsent songs: a full play from the current song at the current position
setupRadio({ unsent: true, current: "spotify:track:b", pos: 42000 });
await connectPick("k");
assert.deepEqual(plays[0].uris[0], "spotify:track:b"); assert.equal(plays[0].pos, 42000);
// radio with nothing unsent: a transfer that keeps the play state
setupRadio({ unsent: false, paused: true });
await connectPick("k");
assert.deepEqual(JSON.parse(fetches[0].body), { device_ids: ["k"], play: false });
// failure: previous device back, the exact toast, a refresh
setupRadio({ unsent: false }); fetchStatus = 404; run("playbackDeviceId = null;");
assert.equal(await connectPick("k"), false);
assert.equal(run("playbackDeviceId"), null);
assert.deepEqual(toasts.at(-1), ["Couldn't play on Kitchen. Play something on it from the Spotify app, then try again.", "error"]);
// Review Focus: the current device sends nothing
setupRadio({ unsent: false }); run("playbackDeviceId = 'k';");
await connectPick("k"); assert.equal(fetches.length + plays.length, 0);
// Review Focus: a second tap while the first is in flight sends one request
setupRadio({ unsent: false }); slowFetch = true;
await Promise.all([connectPick("k"), connectPick("k")]); assert.equal(fetches.length, 1);
// every pick re-reads soon
assert.ok(soon.every(ms => ms === 1500));
```

`setupRadio` is a local helper that resets the radio globals (as `reset()` in `tests/radio-engine.test.js`), fills three matched songs, sets `radioContextLastUri` (unsent or not), `remoteNow`, `radioPaused`, and the device list the stubbed `getSpotifyDevices` returns (`Kitchen`, id `k`).

- [ ] **Step 2: Run it to make sure it fails** - `node tests/connect.test.js`: FAIL (`connectPick` is not defined).
- [ ] **Step 3: Implement `connectPick`, `connectTransfer`, `connectCurrentPosition` in `js/connect.js` and `pollSoon` in `js/player.js`**
- [ ] **Step 4: Run all tests** - every file prints `ok`.
- [ ] **Step 5: Commit** - `git commit -am "Play on: pick a device, move a running radio"` (add `tests/connect.test.js` if untracked).

### Task 3: What's playing is always true

**Files:**
- Modify: `js/player.js` (`pollNowPlaying`, `pollNowPlayingOnce`, `onSDKStateChange`), `js/radio.js` (`radioShowChecking`), `js/connect.js` (`connectSetCurrent`), `tests/connect.test.js`

**Interfaces:**
- Produces:
  - `connectSetCurrent(device|null)`: records the device Spotify reports (`connectCurrent = { id, name, type }`, or `null` for "Checking…") and re-renders the bar (a no-op in node while the DOM is absent). The SDK path passes `{ id: sdkDeviceId, name: "This browser", type: "Computer" }`.
  - `radioShowChecking()`: the neutral hero: track text `Checking what's playing…`, empty artist, the cover placeholder, `radioHeroLive = false`, progress reset.
  - `pollVisible() -> boolean`: `document.visibilityState !== "hidden"` (true when undefined, as in node).

Behavior (spec 4.4): `pollNowPlayingOnce` calls `connectSetCurrent(data.device)` on every reading with a device, before the session check, so the bar shows the reported device even for outside music. After two empty readings in a row (`_emptyPolls >= 2`) with a radio running it calls `radioShowChecking()` and `connectSetCurrent(null)`, then the existing `releaseDeadDevice(false)` rule. `pollNowPlaying` returns early when `!pollVisible() && !radioActive` (the constraint above). A `visibilitychange` listener (in the load-time guard of `connect.js`) calls `pollNowPlaying()` when the page becomes visible and a radio runs on another device.

- [ ] **Step 1: Write the failing tests:**

```js
// the bar shows the device Spotify reports, even for music that is not the radio
setupRadio({}); readings = [{ item: { uri: "spotify:track:zzz", duration_ms: 1 }, device: { id: "k", name: "Kitchen", type: "Speaker" }, is_playing: true }];
await run("pollNowPlayingOnce()");
assert.equal(run("connectCurrent.id"), "k");
// two empty readings: the neutral hero, never the old song
setupRadio({}); readings = [null, null];
await run("pollNowPlayingOnce()"); assert.notEqual(heroText(), "Checking what's playing…");
await run("pollNowPlayingOnce()"); assert.equal(heroText(), "Checking what's playing…");
assert.equal(run("connectCurrent"), null);
// a hidden page with no radio does not poll; a hidden radio window does
run("radioActive = false;"); global.document.visibilityState = "hidden"; fetches = [];
await run("pollNowPlaying()"); assert.equal(fetches.length, 0);
setupRadio({}); await run("pollNowPlaying()"); assert.equal(fetches.length, 1);
global.document.visibilityState = "visible";
```

`heroText()` reads the `textContent` of a stub `radioTrack` element: for this test, `document.getElementById` returns small stub objects for `radioTrack`, `radioArtist`, `radioArt`, `radioPlay`, `radioElapsed`, `radioDuration`, `radioFill`, and null for anything else; DOM-touching helpers must tolerate null elements.

- [ ] **Step 2: Run it to make sure it fails.**
- [ ] **Step 3: Implement `connectSetCurrent`, `radioShowChecking`, `pollVisible` and the poll changes.**
- [ ] **Step 4: Run all tests** - all `ok`, including `radio-engine` (its two-window cases must not change).
- [ ] **Step 5: Commit** - `"Play on: every window shows what Spotify reports"`

### Task 4: The bar, the list, the Home row and the phone strip

**Files:**
- Modify: `index.html`, `css/style.css`, `js/connect.js`, `js/app.js` (Escape closes the list), `tests/contrast.test.js`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces (DOM ids later tasks use): `#connectBar` (under `.radio-now`, inside `.radio-col-main`), `#connectList` (the dropdown / sheet; `role="dialog"`, `aria-label="Play on"`), `#connectScrim`, `#connectHomeRow` (in `#homeCard`, directly above `#radioBtn`), `#connectNowOn` (the phone strip, in `#homeCard` above `.controls`, hidden above 720px by CSS).
- Produces functions: `connectOpen(fromEl)`, `connectClose()`, `connectRefresh(quiet) -> Promise<void>`, `connectRender()`, `connectRowHtml(row, esc) -> string` (pure, exported), `connectHomeTick()`.
- New token: `--spotify-green-text:#1DB954` on line 1 of `css/style.css`, `--spotify-green-text:#0f6b2f` on line 2 (light). Green text (Change, the current-device check) uses it; fills and borders keep `--spotify-green`.

Behavior: follow the canvas boards `Connect-B-wide`, `Connect-home-wide`, `Connect-B-mobile`, `Connect-sheet-mobile`, `Connect-pickup-mobile` and their light twins (spec 4.1, 4.2). Markup and class names are the builder's, within the ids above. Change opens the list (a dropdown anchored under the bar or the Home row; a bottom sheet with a grabber and `#connectScrim` below 720px), focuses its first row, and sets `aria-expanded`. While open it runs `connectRefresh(true)` every 4000 ms; Refresh runs `connectRefresh(false)`. A quiet refresh re-renders only when `!connectSameRows(...)`. Escape, a scrim tap and a pick close it and return focus to Change. `connectHomeTick` runs every `POLL_INTERVAL` from the load-time guard and reads `/me/player` only when `!radioActive`, the home card shows, `pollVisible()`, `spotifyToken` is set and `connectOnPhone()`; it shows `#connectNowOn` with `Playing on <device>`, `<track> · <artist>`, Pause and Next (44px, `playerRest("toggle")` / `playerRest("next")`) when Spotify reports playback on a device that is not this browser, and hides it otherwise.

- [ ] **Step 1: Write the failing tests:** in `tests/contrast.test.js` add `"spotify-green-text"` to `texts`. In `tests/connect.test.js`:

```js
const html = connectRowHtml(connectDeviceRows([dev("k", "Kitchen", "Speaker", { is_active: true })], ctx).rows[1], s => s);
assert.match(html, /Kitchen/); assert.match(html, /aria-pressed="false"/); assert.match(html, /min-height|connect-row/);
const off = connectRowHtml(connectDeviceRows([dev("s", "Sonos Den", "Speaker", { is_restricted: true })], ctx).restricted[0], s => s);
assert.match(off, /disabled/);
```

- [ ] **Step 2: Run them to make sure they fail** - `node tests/contrast.test.js` fails (token missing); `node tests/connect.test.js` fails (`connectRowHtml` not defined).
- [ ] **Step 3: Implement the markup, the CSS and the rendering functions.**
- [ ] **Step 4: Run all tests** - all `ok` (`design-system` and `motion` cover the new CSS).
- [ ] **Step 5: Check it in a browser:** serve the folder (`npx serve`) and, in headless Chromium with Spotify and Last.fm mocked (CLAUDE.md, "Verify changes") or by hand, check at 1280x900 and 390x844, dark and light: the bar sits under the player and the controls row is unchanged; the list opens as a dropdown (wide) and a sheet (phone); rows are 44px or taller; the hint and the restricted group show; no horizontal scroll at 390px; the Home row sits above Start.
- [ ] **Step 6: Commit** - `"Play on: bar, device list, Home row, phone strip"`

### Task 5: Part 1 docs, version, PR

**Files:**
- Modify: `CLAUDE.md` (the Connect bullet and "Current Version"), `docs/architecture.md` (replace "No device picker" with the picker and the truth rules), `DESIGN.md` (bar, list, sheet, row, strip, the new token), `ROADMAP.md`, `changelog.html`, `index.html` (version comment and footer: v2.12)

- [ ] **Step 1: Update the docs and bump to v2.12.** The changelog headline names what the owner sees: pick a speaker from the app; every window follows what plays.
- [ ] **Step 2: Run all tests** - all `ok`.
- [ ] **Step 3: Commit and push**, then point the Vercel preview at `claude/play-on`.
- [ ] **Step 4: Manual checks on the preview** (spec 7, part 1 items): pick a speaker before starting and mid-session, on desktop and phone; move the music from the Spotify app and check both windows follow within a few seconds; pause and skip from the Spotify app and a speaker; a Sonos shows greyed out. Report anything that fails before opening the PR.
- [ ] **Step 5: Open PR 1** (`gh pr create`, body ending with the Claude Code line). The owner squash-merges it.

---

## Part 2: the session hand-off (PR 2, branch `claude/play-on-handoff` from `origin/main` after PR 1 is merged)

Owner setup, once, before the manual checks of Task 10: add Upstash Redis to the Vercel project from the Marketplace, for production and the `stm-preview` preview, which sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.

### Task 6: The server piece

**Files:**
- Create: `api/session.js`
- Create: `tests/session-api.test.js`

**Interfaces:**
- Produces: `module.exports = async function handler(req, res)`, plus `handler.canWrite(stored, note, claim, now) -> boolean` and `handler._reset()` (clears the id cache, for tests).
- HTTP contract (the client in Task 7 relies on it):
  - Auth: `Authorization: Bearer <token>`, or for `POST ?release` a text body `{"token":..., "driverId":...}` (sendBeacon cannot set headers). The user id comes from `GET https://api.spotify.com/v1/me`, cached per token for 300000 ms. No token, or `/me` not 200: `401`.
  - `GET /api/session` -> `200 { note: Note|null, now: <server ms> }`.
  - `PUT /api/session` body `{ claim: "keep"|"new"|"takeover", note: Note }` -> `200 { note: <as stored>, now }` or `409 { note: <stored>, now }`. The server sets `note.beatAt = now` and `note.released = false` before storing.
  - `POST /api/session?release` -> `204`; sets `released: true` when the stored `driverId` matches, otherwise changes nothing.
  - No env vars, or the store unreachable / not 2xx: `503 { error: "no store" }`. Body over 65536 bytes: `413`. Other methods: `405`. Every answer has `Cache-Control: no-store`. Tokens are never stored or logged.
  - Store: `POST ${KV_REST_API_URL}` with `Authorization: Bearer ${KV_REST_API_TOKEN}` and a JSON command array: `["GET", key]`, `["SET", key, json, "EX", 43200]`. Key `stm:session:<user id>`.
- `canWrite`: true when there is no stored note, or `claim === "new"`, or `stored.driverId === note.driverId`, or (`claim === "takeover"` and (`stored.released` or `now - stored.beatAt > 180000`)). Everything else is a 409.

- [ ] **Step 1: Write the failing test** `tests/session-api.test.js`: `require("../api/session.js")`, a fake `res` (`status()`, `json()`, `send()`, `end()`, `setHeader()` recording what was sent), and `global.fetch` stubbed for `api.spotify.com/v1/me` (`{ id: "u1" }` for token `good`, 401 otherwise) and an in-memory store at `https://kv.test` that answers `{ result }`. Cases:

```js
delete process.env.KV_REST_API_URL; assert.equal((await call("GET", {}, "good")).status, 503);
Object.assign(process.env, { KV_REST_API_URL: "https://kv.test", KV_REST_API_TOKEN: "kv" });
assert.equal((await call("GET", {}, "bad")).status, 401);
assert.deepEqual((await call("GET", {}, "good")).body.note, null);
const n = { v: 1, sessionId: "s1", driverId: "d1" };
let r = await call("PUT", { claim: "new", note: n }, "good");
assert.equal(r.status, 200); assert.equal(r.body.note.beatAt, r.body.now);
assert.deepEqual(lastSet.slice(0, 2), ["SET", "stm:session:u1"]); assert.deepEqual(lastSet.slice(3), ["EX", 43200]);
assert.equal((await call("PUT", { claim: "keep", note: { ...n, driverId: "d2" } }, "good")).status, 409);   // not the driver
assert.equal((await call("PUT", { claim: "takeover", note: { ...n, driverId: "d2" } }, "good")).status, 409); // fresh driver
clock += 180001;
assert.equal((await call("PUT", { claim: "takeover", note: { ...n, driverId: "d2" } }, "good")).status, 200); // stale
assert.equal((await call("PUT", { claim: "keep", note: n }, "good")).status, 409);   // the old driver is now refused
assert.equal((await call("PUT", { claim: "new", note: { ...n, sessionId: "s2" } }, "good")).status, 200); // a new radio wins
await call("POST", JSON.stringify({ token: "good", driverId: "d1" }), null, "release");
assert.equal(storeNote().released, true);
assert.equal((await call("PUT", { claim: "keep", note: { ...n, pad: "x".repeat(70000) } }, "good")).status, 413);
meCalls = 0; await call("GET", {}, "good"); await call("GET", {}, "good"); assert.equal(meCalls, 0); // cached id
console.log("session-api: ok");
```

`clock` drives a stubbed `Date.now`; `call(method, body, token, query)` builds `req = { method, query: query ? { [query]: "" } : {}, headers: token ? { authorization: "Bearer " + token } : {}, body }`.

- [ ] **Step 2: Run it to make sure it fails** - `node tests/session-api.test.js`: FAIL (module not found).
- [ ] **Step 3: Implement `api/session.js`** (CommonJS like `api/lfm-station.js`; `req.body` may be an object or a string: parse strings).
- [ ] **Step 4: Run all tests** - all `ok`.
- [ ] **Step 5: Commit** - `"Hand-off: session note store (api/session.js)"`

### Task 7: The note: build, parse, apply, and talking to the server

**Files:**
- Create: `js/handoff.js`
- Create: `tests/handoff.test.js`
- Modify: `index.html` (script after `js/connect.js`), `sw.js` (`SHELL`, `CACHE = "stm-shell-v3"`), `js/config.js` (`PHONE_TOPUP = 10`, `HANDOFF_BEAT_MS = 60000`, `HANDOFF_FOLLOW_MS = 30000`, `HANDOFF_STALE_MS = 180000`, `HANDOFF_SEEN_MAX = 300`, `HANDOFF_BEFORE = 3`)

**Interfaces:**
- Produces:
  - Note shape (spec 5.1; `v: 1`):
    ```
    { v, sessionId, driverId, beatAt, released,
      radio: { username, station, how, year, range, balance, total, momentSeq, contextLastUri },
      songs: [{ uri, name, artist, album, art, page, year, fromPast, source, kind, artistPlays, lfmArtist, lfmTrack, momentId }],
      moments: [{ id, label, chip, start, end, size }],
      carry: [<radioCarry picks, moment as momentId>], seen: [<last 300 radioSeen keys>] }
    ```
  - `handoffBuildNote() -> Note`: from the globals; songs from `HANDOFF_BEFORE` before `nowPlayingIndex` to `allTrackCount - 1`.
  - `handoffParseNote(x) -> Note|null`: null unless an object with `v === 1`, a string `sessionId` and an array `songs`.
  - `handoffApplyNote(note)`: rebuilds `matchedUris`, `trackMeta` (one shared moment object per id), `uriToIndices`, `sessionQueue`, `allTrackCount`, `radioSeen`, `radioCarry`, `radioContextLastUri`, `radioMomentSeq`, and the active settings (`radioActiveStation`, `radioActiveHow`, `radioActiveYear`, `radioRange`, `radioActiveBalance`, `radioTotal`, `radioUser`), indices from 0.
  - `handoffRole(note, me, now) -> "none" | "driver" | "follower" | "free"`: `none` without a note, `driver` when `note.driverId === me`, `free` when released or `now - beatAt > HANDOFF_STALE_MS`, else `follower`.
  - `handoffGet() -> Promise<{ note, now }|null>` and `handoffPut(claim) -> Promise<{ status, note, now }|null>`: `fetch("/api/session")` with the Spotify token; on 503, a network error, a timeout (8 s, `AbortController`) or a body that is not JSON they set `handoffOff = true` and return null, with no toast. Nothing is sent while `handoffOff`.
  - State: `handoffMe` (random per page load, `rndStr(16)`), `handoffSessionId`, `handoffOff`, `handoffNote` (last note seen), `handoffFollowing` (boolean).

- [ ] **Step 1: Write the failing test** `tests/handoff.test.js` (vm-loads the browser files like `tests/connect.test.js`, plus `handoff.js`):

```js
// round trip: build, JSON, parse, apply in a clean session gives the same songs and meta
fillSession(20, { momentEvery: 5, current: 10 });
const note = handoffParseNote(JSON.parse(JSON.stringify(handoffBuildNote())));
assert.equal(note.songs.length, 13);                     // 3 before the current one, to the end
clearSession(); handoffApplyNote(note);
assert.equal(run("allTrackCount"), 13); assert.equal(run("matchedUris[3]"), uriOf(10));
assert.equal(run("trackMeta[3].moment === trackMeta[4].moment"), true);   // shared moment object
assert.equal(run("uriToIndices['" + uriOf(10) + "'][0]"), 3);
// radioSeen is capped at the last 300 keys
fillSession(5, { seen: 2000 }); assert.equal(handoffBuildNote().seen.length, 300);
// parse rejects what it does not know
assert.equal(handoffParseNote({ v: 2, sessionId: "s", songs: [] }), null);
assert.equal(handoffParseNote("nope"), null);
// roles
const t = 1e12, base = { driverId: "d1", beatAt: t, released: false };
assert.equal(handoffRole(null, "me", t), "none");
assert.equal(handoffRole(base, "d1", t), "driver");
assert.equal(handoffRole(base, "me", t + 60000), "follower");
assert.equal(handoffRole(base, "me", t + 180001), "free");
assert.equal(handoffRole({ ...base, released: true }, "me", t), "free");
// Review Focus: a store that answers garbage, 5xx or never turns the hand-off off, silently
for (const bad of [{ status: 200, text: "<html>" }, { status: 500 }, { hang: true }]) {
  resetHandoff(); serverAnswer = bad;
  assert.equal(await handoffGet(), null); assert.equal(run("handoffOff"), true); assert.equal(toasts.length, 0);
}
console.log("handoff: ok");
```

- [ ] **Step 2: Run it to make sure it fails.**
- [ ] **Step 3: Implement `js/handoff.js` and the `config.js` constants; wire the script tag and `sw.js`.**
- [ ] **Step 4: Run all tests** - all `ok`.
- [ ] **Step 5: Commit** - `"Hand-off: the session note"`

### Task 8: Driver and follower

**Files:**
- Modify: `js/handoff.js`, `js/radio.js`, `js/player.js`, `tests/handoff.test.js`

**Interfaces:**
- Consumes: Task 7.
- Produces:
  - `handoffStarted()`: called at the end of a successful `startRadio()`: new `handoffSessionId`, `handoffFollowing = false`, `handoffPut("new")`.
  - `handoffChanged()`: called after a fill adds songs (end of `continueRadio` when `added > 0`) and on every track change (`radioMaybeRefill`); writes with `handoffPut("keep")`, at most one write in flight and one queued.
  - Heartbeat: every `HANDOFF_BEAT_MS` while `radioActive && !handoffFollowing && !handoffOff`.
  - `pagehide` (load-time guard): `navigator.sendBeacon("/api/session?release", JSON.stringify({ token, driverId: handoffMe }))` when driving. The token is the cached `localStorage` access token (no refresh is possible during `pagehide`).
  - `handoffFollow(note)`: `handoffApplyNote(note)`, `handoffFollowing = true`, `radioActive = true`, `showRadioView()`, `startPolling()`. A 409 on any write calls it with the returned note: no toast (spec 5.2).
  - `handoffFollowerTick()`: every `HANDOFF_FOLLOW_MS` while following and `pollVisible()`, and right away when the reported song is not in `sessionQueue`: `handoffGet()`, then re-apply the note (keeping the current highlight), or switch to the new radio when `sessionId` changed.
  - `handoffSongKnown(uri) -> Promise<boolean>`: for a follower, re-reads the note once when `uri` is missing and answers whether it is there now.

Follower rules (spec 5.2): with `handoffFollowing` true, `continueRadio`, `radioReissue`, `radioSeamReissue`, `radioMaybeSeam`, `radioRemoteTick`, `radioRecoverRunOff`, `radioSkipHandled` and the pending re-issue in `radioSetPaused` do nothing. Controls go through `playerRest` (the music plays on the driver's device, so `sdkPlaying()` is false via `followPlaybackDevice`). `radioPlayFrom(idx)` plays `matchedUris[idx]` through the index of the note's `contextLastUri` on the current device, and does nothing while the music plays on another STM window's player (the reported device has `name === STM_PLAYER_NAME`). `pollNowPlaying` skips hidden pages for followers too (`!pollVisible() && (!radioActive || handoffFollowing)`). When the reported song is not in the follower's queue, `pollNowPlayingOnce` awaits `handoffSongKnown(uri)` before the existing paused-radio path.

- [ ] **Step 1: Write the failing tests:**

```js
// a new radio claims the note
resetHandoff(); fillSession(3, {}); handoffStarted(); await flush();
assert.equal(puts.at(-1).claim, "new"); assert.equal(puts.at(-1).note.driverId, run("handoffMe"));
// a 409 turns the window into a follower of the returned note, without a toast
serverAnswer = { status: 409, json: { note: otherNote, now: 1 } };
handoffChanged(); await flush();
assert.equal(run("handoffFollowing"), true); assert.equal(run("matchedUris[0]"), otherNote.songs[0].uri); assert.equal(toasts.length, 0);
// a follower never fills, seams or re-issues
fills = 0; await run("continueRadio()"); run("radioMaybeSeam()"); await run("radioSeamReissue()");
assert.equal(fills, 0); assert.equal(plays.length, 0);
// a row tap plays the note's songs up to the driver's last sent song
run("radioContextLastUri = matchedUris[4]"); await run("radioPlayFrom(2)");
assert.deepEqual(plays.at(-1).uris, [2, 3, 4].map(i => run("matchedUris[" + i + "]")));
// ...and is off while the music plays on another STM window's player
playingDevice = { id: "other", name: STM_PLAYER_NAME, type: "Computer" }; plays = [];
await run("radioPlayFrom(2)"); assert.equal(plays.length, 0);
// pagehide sends the release beacon with this window's id
resetHandoff(); fillSession(3, {}); handoffStarted(); await flush(); firePagehide();
assert.equal(beacons[0].url, "/api/session?release"); assert.equal(JSON.parse(beacons[0].body).driverId, run("handoffMe"));
// Review Focus: an unknown song makes the follower re-read once; still unknown -> paused-radio state, no note hero
followWith(otherNote); readings = [{ item: { uri: "spotify:track:new" }, device: dev("k", "Kitchen", "Speaker"), is_playing: true }];
serverAnswer = { status: 200, json: { note: otherNote, now: 1 } };
await run("pollNowPlayingOnce()");
assert.equal(gets, 1); assert.equal(run("sessionPaused"), true);
```

`flush()` awaits pending promises; `fills` counts calls to a stubbed `radioFill`; `firePagehide()` calls the listener the guard registered (the test's `window.addEventListener` stub records listeners; `navigator.sendBeacon` records calls).

- [ ] **Step 2: Run it to make sure it fails.**
- [ ] **Step 3: Implement.** Hook calls in `radio.js` and `player.js` are one-liners guarded with `typeof handoffChanged === "function"`, so `tests/radio-engine.test.js`, which does not load `handoff.js`, keeps passing unchanged.
- [ ] **Step 4: Run all tests** - all `ok`.
- [ ] **Step 5: Commit** - `"Hand-off: one driver, followers show the radio"`

### Task 9: Taking over, and the phone's 10-song top-up

**Files:**
- Modify: `js/handoff.js`, `js/radio.js` (factor `radioResetPools()` out of `startRadio()`), `js/connect.js` (the strip's `Open radio` button), `index.html`, `tests/handoff.test.js`

**Interfaces:**
- Consumes: Tasks 7-8; `#connectNowOn` (Task 4).
- Produces:
  - `radioResetPools()`: the Discover/Mix reset lines of `startRadio()` (`radioBuf`, `radioMixCursor`, `discoverPool`, `discoverSeeds`, `discoverSeedRound`, the caches, `discoverUsedArtists`, `discoverNeedsReconnect`, `discoverWarnedEmpty`); `startRadio()` calls it.
  - `handoffPhoneDriver() -> boolean`: `!handoffOff && !handoffFollowing && radioActive && !sdkReady`.
  - `handoffTopUpWant(remaining) -> number`: `Math.max(0, PHONE_TOPUP - remaining)` (pure, exported).
  - `handoffPhoneTopUp() -> Promise<void>`: `radioFill(handoffTopUpWant(radioRemaining(matchedUris, allTrackCount, current)))`; when it added songs and the music plays (`remoteNow.playing`), `spotifyPlay(token, radioUrisFrom(matchedUris, allTrackCount, current), connectCurrentPosition())`; when paused, `radioPendingReissue = true` instead. Then `handoffChanged()`.
  - `handoffTakeOver(note) -> Promise<boolean>`: refuses (false) when the reported device is another STM window's player; `handoffApplyNote(note)`, `radioResetPools()`, `handoffPut("takeover")`; on 200: `handoffFollowing = false`, `handoffSessionId = note.sessionId`, then `handoffPhoneTopUp()` on a window without a browser player, or the normal `radioMaybeRefill` on a desktop. On 409, follow the returned note.
  - `handoffOpen()`: the strip's `Open radio`: `handoffGet()`, then by role `free` -> `handoffTakeOver`, `follower` -> `handoffFollow`. The button shows only when the reported song is in `handoffNote`; while the strip shows, `connectHomeTick()` refreshes `handoffNote` with `handoffGet()` at most every `HANDOFF_FOLLOW_MS` (and at once when the reported song changes).
  - Becoming visible (`visibilitychange`) as phone driver runs `handoffPhoneTopUp()`; as follower it runs `handoffFollowerTick()`, which takes over when the role is `free`.
- Rule: while `handoffPhoneDriver()`, `radioMaybeRefill` does not call `continueRadio()` and `startRadio()` ends with `handoffPhoneTopUp()` instead of `continueRadio()`: a phone adds at most 10 songs per opening (spec 5.3). With `handoffOff` the phone keeps today's behavior.

- [ ] **Step 1: Write the failing tests:**

```js
assert.equal(handoffTopUpWant(0), 10); assert.equal(handoffTopUpWant(4), 6); assert.equal(handoffTopUpWant(12), 0);
// a free note on a phone: take over, fill to 10 after the current song, send them at the current position
resetHandoff(); run("sdkReady = false;"); remote({ uri: otherNote.songs[1].uri, pos: 30000, playing: true });
assert.equal(await handoffTakeOver({ ...otherNote, released: true }), true);
assert.equal(puts.at(-1).claim, "takeover"); assert.equal(fillWants.at(-1), 10 - remainingAfter(1));
assert.equal(plays.at(-1).uris[0], otherNote.songs[1].uri); assert.ok(plays.at(-1).pos >= 30000);
// no more than that per opening: track changes do not fill on a phone driver
fills = 0; run("radioMaybeRefill(matchedUris[2], 0)"); assert.equal(fills, 0);
// never over another STM window's player
playingDevice = { id: "other", name: STM_PLAYER_NAME, type: "Computer" };
assert.equal(await handoffTakeOver({ ...otherNote, released: true }), false);
// Discover and Mix rebuild their pools on the new driver
assert.deepEqual(run("discoverPool"), []); assert.equal(run("discoverSeeds"), null);
// Review Focus: a paused speaker is not unpaused by the top-up
resetHandoff(); remote({ uri: otherNote.songs[1].uri, pos: 0, playing: false }); plays = [];
await handoffTakeOver({ ...otherNote, released: true });
assert.equal(plays.length, 0); assert.equal(run("radioPendingReissue"), true);
```

`remote()` sets `remoteNow` and the device the stubbed `/me/player` reports; `fillWants` records the `want` passed to the stubbed `radioFill` (which adds that many songs).

- [ ] **Step 2: Run it to make sure it fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all tests** - all `ok`.
- [ ] **Step 5: Commit** - `"Hand-off: take over a radio, phone top-ups of 10"`

### Task 10: Part 2 docs, PR, manual checks

**Files:**
- Modify: `CLAUDE.md` (Architecture: `api/session.js` is a second backend piece; a hand-off summary bullet), `docs/architecture.md` (a hand-off section: note, driver, follower, phone top-up, 503 fallback), `ROADMAP.md`, `changelog.html` (the v2.12 entry gains the hand-off)

- [ ] **Step 1: Update the docs.**
- [ ] **Step 2: Run all tests** - all `ok`.
- [ ] **Step 3: Commit, push, point the preview at `claude/play-on-handoff`.** The owner has connected Upstash (setup above).
- [ ] **Step 4: Manual checks on the preview** (spec 7, part 2 items): start on desktop, open the phone, tap Open radio and check the full radio view (Up next, moment panel, dates); close the desktop tab and check the phone takes over and adds 10 songs; put the computer to sleep and check the takeover after 3 minutes; start a new radio on the phone while the desktop runs and check the desktop follows it quietly; run once on a preview without the env vars and check the app behaves as after part 1, with no toast.
- [ ] **Step 5: Open PR 2.** The owner squash-merges it; then restart the working branch from `origin/main`.
