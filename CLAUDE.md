# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Scrobble Time Machine

## What is Scrobble Time Machine

Scrobble Time Machine is a client-side web app that connects a user's Last.fm scrobble history with Spotify playback. Users enter their Last.fm username, connect Spotify via PKCE OAuth, then start an endless radio from one of three stations: Library (their own scrobbles, as random songs or as whole moments played in order, from every year or one), Discover (new music) or Mix (both). The app fetches tracks from Last.fm, matches them against Spotify's catalog, plays them in-browser via the Spotify Web Playback SDK, and lets users save a moment as a Spotify playlist or like individual tracks. (The Time Travel modes were folded into Library in v2.11.)

**Live URL:** https://stm-lastfm.vercel.app/
**Repo URL:** https://github.com/manuelmatheu/scrobble-time-machine

---

## Development

No build step, no package manager, no linter -- there is nothing to install or compile. Edit the `.html`/`.css`/`.js` files directly. A few dependency-free Node scripts in `tests/` cover the radio logic and the stylesheet; each prints `<name>: ok` on success.

- **Run one test:** `node tests/radio-engine.test.js`. **Run all:** `for t in tests/*.test.js; do node $t || exit 1; done` (bash), or in PowerShell `Get-ChildItem tests\*.test.js | % { node $_; if ($LASTEXITCODE) { exit 1 } }`.
- `radio-helpers`: pure radio helpers (parsing, seam timing, Mix/Discover helpers, years and moments).
- `radio-engine`: the radio engine with the network stubbed (fills, top-ups, seams, stations, `spotifyPlay` request shapes).
- `contrast`: WCAG contrast of the text tokens on the surface tokens, both themes.
- `design-system`: colors only as tokens (no hex or `rgba()` outside the token lines of `style.css`), no text under 12px, no `transition:all`.
- `no-page-numbers`: no page numbers in status or error messages. `no-time-travel`: the Time Travel modes, track list and era panel stay removed.

- **Run locally:** serve the folder with any static file server (`/api/lfm-station` only exists on Vercel or `vercel dev`; without it Discover falls back to the similar-artist source) (e.g. `npx serve`, `python -m http.server`) and open it in a browser. Opening `index.html` directly via `file://` will break Spotify PKCE auth, since `SPOTIFY_REDIRECT_URI` (`js/config.js`) is derived from `window.location.origin + window.location.pathname` and must exactly match a redirect URI registered on the Spotify app.
- **Verify changes:** the node scripts cover only the radio logic and the stylesheet rules; everything else is manual. Exercise the flow in a browser -- connect Spotify, start each station (Library in Songs and Moments, with and without a year), confirm playback, Up next, Next moment and Save this moment still work. For layout work, a headless Chromium with the Spotify and Last.fm requests mocked (Playwright `route`) is enough to start a radio and measure; the Spotify SDK script does not load there, so the app runs in polling mode.
- API keys (`LASTFM_API_KEY`, `SPOTIFY_CLIENT_ID`) live in `js/config.js`, not `index.html`.

- **Workflow:** one contributor. Production (https://stm-lastfm.vercel.app/) deploys from `main`; a Vercel preview (stm-preview.vercel.app) is pointed at the branch being tested. Work happens on a `claude/...` branch, is tried on the preview, and goes to `main` through a pull request that is squash-merged. After a merge, restart the working branch from `origin/main` (never stack new commits on merged history).

---

## Architecture

### File Structure

```
index.html          -- Page shell, script load order
changelog.html      -- Release notes shown in the in-app overlay (openChangelog() in ui.js)
ROADMAP.md          -- Shipped and planned work, newest first
docs/architecture.md -- Detailed behavior behind the summaries below (auth, SDK, spotifyPlay, radio, seams, views)
docs/superpowers/   -- Design notes and plans
DESIGN.md           -- Design reference: tokens, components, screens, breakpoints (code wins over the canvas mockups)
css/
  style.css         -- All styles; single file; CSS custom properties for theming
tests/              -- node test scripts (see Development)
api/
  lfm-station.js    -- Vercel serverless proxy for Last.fm's "recommended" station (CORS); the only backend piece
js/
  config.js         -- API keys, SPOTIFY_SCOPES, all global state variables
  spotify.js        -- PKCE auth, Spotify API calls, SDK init, save playlist
  lastfm.js         -- Last.fm API calls (getLastFmScrobbles / getLastFmScrobbleAt with an optional year range, fetchEarliestYear, getInfo, station)
  ui.js             -- toasts (showStatus), escHtml, Start radio button state, handleReset(), changelog overlay
  player.js         -- pollNowPlaying(), onSDKStateChange(), player controls, liked songs,
                       following a session moved to another device
  radio.js          -- Radio (Library / Discover / Mix): pure helpers, engine (radioFill/startRadio/
                       continueRadio), moments, seams, home card options, radio view rendering,
                       artist bio + play counts
  app.js            -- DOMContentLoaded init, event listener wiring
```

### Script Load Order (order matters -- no modules)

```html
<script src="https://sdk.scdn.co/spotify-player.js"></script>  <!-- must be first -->
<script src="js/config.js"></script>     <!-- globals defined here -->
<script src="js/spotify.js"></script>    <!-- uses globals from config -->
<script src="js/lastfm.js"></script>
<script src="js/ui.js"></script>         <!-- uses showStatus, $ from config -->
<script src="js/player.js"></script>     <!-- uses spotify.js + ui.js functions -->
<script src="js/radio.js"></script>      <!-- uses player.js + spotify.js -->
<script src="js/app.js"></script>        <!-- wires up all event listeners -->
```

The SDK script must load first so `window.onSpotifyWebPlaybackSDKReady` can be set by `spotify.js` before the SDK calls it.

### Theme System

- Dark theme is default (no attribute on `<html>`)
- Light theme: `<html data-theme="light">`
- All colors use CSS custom properties defined in `:root` (dark) and `[data-theme="light"]` (overrides)
- Key variables: `--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--bg-elevated`, `--border`, `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-muted`, `--lastfm-red`, `--spotify-green`
- An inline IIFE in `<head>` sets the theme before CSS renders to prevent flash

---

## Spotify and playback (summary)

Full detail, with the reasons behind each rule: `docs/architecture.md`. Read the relevant section there before changing auth, `spotifyPlay()`, the SDK listeners, the radio engine or the seams.

- **Scopes** (`SPOTIFY_SCOPES`, `js/config.js`): `streaming` for the SDK, `user-library-*` for likes, `user-top-read` for Discover (an older token gets a 403 there; Discover then plays the Last.fm station only and asks the user to reconnect).
- **Auth:** PKCE (`initiateSpotifyAuth()` / `exchangeCodeForToken()` / `refreshSpotifyToken()` / `getSpotifyToken()`). Tokens live in `localStorage`; only the code verifier and a spare copy of the username go through `sessionStorage`.
- **SDK:** `initSDKPlayer()` can be called from the SDK-ready callback and from the auth callbacks in `app.js`; it guards on `window._stmPlayer`. Its `ready` / `not_ready` / `authentication_error` listeners stop and start polling and re-transfer playback after a reconnect (`sdkNeedsRetransfer`).
- **Who is playing:** every SDK-driven decision goes through `sdkPlaying()` (`sdkReady && !playbackDeviceId`), not `sdkReady`. When it is true, `player_state_changed` -> `onSDKStateChange()` drives the UI; otherwise `pollNowPlaying()` reads `/me/player` every `POLL_INTERVAL` (5s) and follows the device the music moved to (`followPlaybackDevice()`).
- **`spotifyPlay(token, uris, opts)`:** caps at 100 URIs. With the SDK: transfer, then turn shuffle and repeat off, then play with `device_id`. Otherwise it picks a device (the followed one, then the active one, then any). Shuffle and repeat persist on the user's account and would reorder or loop the queue, so every full play resets them. `{quick:true}` (used at seams) sends a single `play` request.
- **Connect:** there is no device picker (removed in v2.10); the music plays in this browser. `followPlaybackDevice()` (`player.js`) still follows a session moved to another device from the Spotify app, keeping `playbackDeviceId` in memory only. `/me/player/devices` lists only cloud-registered devices.
- **Search:** `spotifySearch()` tries `track:X artist:Y` first, then a plain query whose hit must pass `spotifyLooseMatch` (otherwise an unrelated song plays). Only final results are cached in `searchCache`; rate-limited or failed lookups are not.
- **API wrappers:** `spGet` / `spPut` / `spDelete` refresh the token and retry on 401; pass a `null` body for query-string-only endpoints.
- **Liked songs:** `/me/library/contains|PUT|DELETE ?uris=` (see Quirk 8); `likedSet` holds bare track IDs. **Save playlist:** `POST /me/playlists`, named `"Time Machine: " + label`; only Save this moment (Library in Moments) uses it.

## Radio (summary)

- **Stations:** Library (your scrobbles: `getLastFmScrobbleAt()` with `limit=1` makes `page` an index into the history; options How it plays = Songs | Moments and When = every year | one year, see below), Discover (Last.fm station via `/api/lfm-station` plus artists similar to the user's top artists, each candidate checked first (`discoverVet()`) to drop songs already played or saved), and Mix (both, in the `MIX_PATTERNS` balance). `radioStation` is what the picker shows; `radioActiveStation` is what the running session plays (likewise `radioHow` / `radioActiveHow` and `radioYear` / `radioActiveYear`).
- **Library options:** One year passes `radioRange` (`radioYearRange()`) as `from`/`to`, and `radioTotal` becomes that year's count, so positions stay inside it. Moments: `momentCollectBatch()` fetches 30 scrobbles around a random position and `radioMomentFromTracks()` keeps the run around it (no silence over 2 hours, oldest first, at most 15); each pick carries `trackMeta.moment`. The moment panel (`#radioMoment`) has Save this moment and Next moment (`radioNextMoment()`, which fetches the next moment when none is queued: `radioJumpFrom`).
- **Engine:** `radioFill()` -> `startRadio()` (plays after the first match; the rest of the queue fills in behind it) -> `radioMaybeRefill()` on every track change -> `continueRadio()`. Every start or stop bumps `radioSession`, and in-flight fills bail when it changes.
- **Seams:** a re-issue restarts the stream, so new tracks are swapped in near the end of the last track sent (`radioContextLastUri`): `radioMaybeSeam()` (SDK, 250ms timer) or `radioRemoteTick()` (another device, extrapolated from `remoteNow`). `radioUnsentUris()` is derived from the data, so a lost flag cannot strand tracks; `radioRecoverRunOff()` catches a missed swap.
- **Views:** `#homeView` shows either `#landing` (no Spotify session: username, then Connect Spotify; `showLanding()` / `landingSync()` in `ui.js`, its field mirrors `#usernameInput`) or `#homeCard` (connected: every option); `updateSpotifyUI()` switches them, and a stored refresh token skips the landing at load. `#radioView` (`showRadioView()`). At 1100px and up the radio view has two columns and at least 8 Up next rows, as many as fit the panel at a fixed 51px each (6 below); the home card stays centered at 680px. Home (`radioMinimize()`) only hides the view; the session keeps running. The hero and info panel only follow tracks of the current session (`uriToIndices`).
- **Toasts:** `showStatus(msg, "error" | "warn")` is only for failures and things the user must act on; `"success"` dismisses the current toast, and plain progress text is ignored. The UI itself shows loading state.

---

## Key Quirks and Gotchas

1. **Use `/v1/me/playlists` not `/v1/users/{id}/playlists`** -- the user-id endpoint returns 403 in dev mode even with correct scopes. The `/me/` endpoint always works.

2. **Unicode box-drawing characters in HTML comments cause tool failures** -- use ASCII-only comments in HTML (e.g., use `===` separators, not `═══`).

3. **Spotify tokens live in `localStorage`, not `sessionStorage`** -- intentional (v2.3+), so a reconnect isn't needed every time a tab closes. Only the PKCE code verifier and a spare copy of the Last.fm username use `sessionStorage`. Don't revert the token storage to `sessionStorage` without checking why it was changed (commit `bd8354c`).

4. **`pollNowPlaying()` only runs when `!sdkPlaying()`** -- first line is `if (sdkPlaying() || _pollBusy) return;`. When the SDK is the player, `player_state_changed` events handle all updates; with another device picked, polling does, even though `sdkReady` is true.

5. **`matchedUris` is index-keyed object, not an array** -- iterate with `for (let i = 0; i < allTrackCount; i++)`, not `Object.values()` or array methods. Sparse: some indices may be missing.

6. **`uriToIndices` reverse map supports duplicate URIs** -- maps `"spotify:track:xyz"` to an array of track indices. Used to find the correct row to highlight when the same track appears multiple times.

7. **SDK race condition** -- the Spotify SDK script may fire `onSpotifyWebPlaybackSDKReady` before or after PKCE auth completes. Both code paths check and call `initSDKPlayer()` if conditions are met.

8. **Spotify Library API migration (2025)** -- Spotify replaced the old track-specific library endpoints with a unified Library API. Old endpoints return 403 "Forbidden" on new tokens (not "Insufficient client scope"). If you see 403 on library calls, check the endpoint — do NOT use the old paths:
   - OLD (broken): `GET /me/tracks/contains?ids=bareId` / `PUT /me/tracks` body `{ids:[...]}`
   - NEW (correct): `GET /me/library/contains?uris=spotify:track:id` / `PUT /me/library?uris=spotify:track:id`
   Note: apps with old cached `localStorage` refresh tokens may still work temporarily with old endpoints.

9. **Disconnect button** -- `spotifyBadge` (in `index.html`) contains a `✕` button wired via inline `onclick="disconnectSpotify()"`, which clears the `localStorage` tokens and disconnects the SDK player, then calls `updateSpotifyUI(false)`. It does **not** auto re-trigger auth -- the user clicks "Connect Spotify" (`onclick="initiateSpotifyAuth()"`) again, which always passes `show_dialog: true` so Spotify shows the account picker instead of silently re-using the last session. Both buttons are wired via inline `onclick` in `index.html`, not `addEventListener` in `app.js`.

10. **Spotify 429 cooldown** -- `runSpotifySearch()` waits out a `Retry-After` of 5 seconds or less (up to 2 retries); a longer one sets `spotifyBlockedUntil` instead of sleeping. While `spotifyBlockedFor() > 0`, `spotifySearch()` returns `null` without calling Spotify and `radioFill` stops its batch. An error toast shows `spotifyLimitMessage()` ("Spotify is limiting searches. Try again in about N ..."), and `continueRadio()` does not treat a cooldown as an exhausted library.

---

## Current Version: v2.11

Bump the version only for a release (a new feature set or a user-visible change worth a changelog headline), not for every fix; small changes ride in the current version's changelog and `ROADMAP.md` entry. A bump touches three places: the version-history comment at the top of `index.html`, the footer link text in `index.html`, and the changelog opened by `openChangelog()` (`js/ui.js`; content in `changelog.html`). `ROADMAP.md` holds planned work; `docs/superpowers/` holds design notes.

---

## Quick Reference

| Function | File | Purpose |
|---|---|---|
| `initiateSpotifyAuth()` | spotify.js | Start PKCE OAuth flow (includes `show_dialog:true`) |
| `disconnectSpotify()` | spotify.js | Clear tokens, disconnect SDK (does not re-initiate auth) |
| `getSpotifyToken()` | spotify.js | Get valid access token (refresh if needed) |
| `spGet(path)` | spotify.js | GET with auto-401-retry |
| `spPut(path, body)` | spotify.js | PUT with auto-401-retry; `null` body = no body sent |
| `spDelete(path, body)` | spotify.js | DELETE with auto-401-retry; `null` body = no body sent |
| `initSDKPlayer()` | spotify.js | Create and connect Spotify Web Playback SDK player |
| `spotifyPlay(token, uris)` | spotify.js | Start playback (prefers SDK device) |
| `saveAsPlaylist(btn, uris, label)` | spotify.js | Create a Spotify playlist (Save this moment) |
| `pollNowPlaying()` | player.js | Poll Spotify for now-playing (fallback only) |
| `onSDKStateChange(state)` | player.js | Handle SDK player_state_changed events |
| `checkLikedTracks()` | player.js | Batch-check liked status for all matched tracks |
| `toggleLikeTrack(idx)` | player.js | Like or unlike a track by index |
| `highlightNowPlaying(index)` | ui.js | Record the playing track's index (`nowPlayingIndex`) |
| `showStatus(msg, type)` | ui.js | Show an error/warn toast; success dismisses it |
| `handleReset()` | ui.js | Full reset of state and UI |
| `registerUri(uri, index)` | player.js | Populate uriToIndices reverse map |
| `startRadio()` | radio.js | Start the picked station (with the Library options) |
| `radioFill(want)` | radio.js | Pick, dedupe, match, and append random tracks |
| `continueRadio()` | radio.js | Top up the queue and re-issue playback |
| `radioStop()` | radio.js | Stop radio and invalidate in-flight fills |
| `radioMaybeSeam()` / `radioRemoteTick()` | radio.js | Swap new tracks in at the end of the last queued song (SDK / another Connect device) |
| `radioSetStation(name)` | radio.js | Pick Library, Discover or Mix on the home card |
| `discoverCollectBatch(user, sid)` | radio.js | Pop, vet and return Discover candidates (refills the pool) |
| `mixCollectBatch(user, sid)` | radio.js | Collect both sources and hand out picks in the Mix pattern |
| `radioSetBalance(name)` | radio.js | Pick how much of a Mix is new |
| `getLastFmStation(user)` | lastfm.js | Last.fm's recommended station through `/api/lfm-station` |
| `getLastFmScrobbleAt(user, page, range)` | lastfm.js | One scrobble at a 1-based history position (inside `range` when given) |
| `radioSetHow(name)` / `radioSetYear(year)` | radio.js | Library options on the home card: Songs or Moments, every year or one |
| `momentCollectBatch(user)` | radio.js | One moment: the scrobbles around a random point, in the order played |
| `radioNextMoment()` / `saveMomentPlaylist()` | radio.js | The moment panel's buttons |
