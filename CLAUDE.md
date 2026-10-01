# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Scrobble Time Machine

## What is Scrobble Time Machine

Scrobble Time Machine is a client-side web app that connects a user's Last.fm scrobble history with Spotify playback. Users enter their Last.fm username, connect Spotify via PKCE OAuth, then "time travel" by choosing a discovery mode (random page, date, artist, mood, decade, etc.). The app fetches matching tracks from Last.fm, matches them against Spotify's catalog, plays them in-browser via the Spotify Web Playback SDK, and lets users save the session as a Spotify playlist or like individual tracks.

**Live URL:** https://stm-lastfm.vercel.app/
**Repo URL:** https://github.com/manuelmatheu/scrobble-time-machine

---

## Development

No build step, no package manager, no linter -- there is nothing to install or compile. A few dependency-free Node scripts in `tests/` cover the pure radio helpers, the radio engine (network stubbed), and CSS contrast; run one with e.g. `node tests/radio-helpers.test.js`, or all of them with `for t in tests/*.test.js; do node $t || exit 1; done` (each prints `<name>: ok` on success; the full set: `radio-helpers`, `node tests/radio-engine.test.js`, `node tests/contrast.test.js`, and `node tests/no-page-numbers.test.js` (no page numbers in status or error messages), and `node tests/no-era-panel.test.js` (the era panel and slider stay removed). Edit the `.html`/`.css`/`.js` files directly.

- **Run locally:** serve the folder with any static file server (e.g. `npx serve`, `python -m http.server`) and open it in a browser. Opening `index.html` directly via `file://` will break Spotify PKCE auth, since `SPOTIFY_REDIRECT_URI` (`js/config.js`) is derived from `window.location.origin + window.location.pathname` and must exactly match a redirect URI registered on the Spotify app.
- **Verify changes:** the node scripts above cover only the radio logic and contrast tokens; everything else is manual. Exercise the flow in a browser -- connect Spotify, run a mode, confirm playback/highlighting/save-playlist still work.
- API keys (`LASTFM_API_KEY`, `SPOTIFY_CLIENT_ID`) live in `js/config.js`, not `index.html` (README's self-hosting instructions are slightly out of date on this point).

---

## Architecture

### File Structure

```
index.html          -- Page shell, script load order
css/
  style.css         -- All styles; single file; CSS custom properties for theming
tests/              -- node test scripts (see Development)
js/
  config.js         -- API keys, SPOTIFY_SCOPES, all global state variables
  spotify.js        -- PKCE auth, Spotify API calls, SDK init, save playlist
  lastfm.js         -- Last.fm API calls (getLastFmPage, fetchEarliestYear, etc.)
  ui.js             -- DOM helpers, renderTrackRow(), track interactions, autocomplete
  player.js         -- pollNowPlaying(), smartMatch(), fetchAndPlay(), matchAndPlay(),
                       onSDKStateChange(), player controls, liked songs functions
  radio.js          -- Library Radio: pure helpers, engine (radioFill/startRadio/continueRadio),
                       radio view rendering, artist bio + play counts
  modes.js          -- Mode dispatch + all mode handlers (random, date, artist, mood,
                       onthisday, decade, album, discovery, streak)
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
<script src="js/radio.js"></script>      <!-- uses player.js + spotify.js; before modes.js -->
<script src="js/modes.js"></script>      <!-- uses player.js functions -->
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

## Spotify Integration

### Scopes

```
user-modify-playback-state user-read-playback-state user-read-currently-playing
playlist-modify-private playlist-modify-public
streaming user-library-modify user-library-read
```

`streaming` is required for the Web Playback SDK. `user-library-*` for liked songs.

### PKCE Auth

- `initiateSpotifyAuth()` -- generates code verifier + challenge, redirects to Spotify authorize; the verifier and the Last.fm username are stashed in `sessionStorage` for the round trip
- `exchangeCodeForToken(code)` -- exchanges auth code for tokens, stores `spotify_access_token` / `spotify_refresh_token` / `spotify_token_expires` in **localStorage**
- `refreshSpotifyToken()` -- refreshes using the stored refresh token, updates the same `localStorage` keys
- `getSpotifyToken()` -- returns cached token or refreshes if within 60s of expiry

**Important:** Spotify tokens are stored in `localStorage` (not `sessionStorage`), so the session survives browser/tab restarts -- see commit `bd8354c`. Only the transient PKCE code verifier and a redundant copy of the Last.fm username use `sessionStorage` for the auth redirect round trip.

### SDK Init

`initSDKPlayer()` in `spotify.js` creates a `Spotify.Player` instance. It is called from:
1. `window.onSpotifyWebPlaybackSDKReady` callback (if token already exists when SDK loads)
2. `app.js` auth success callbacks (if SDK already loaded when auth completes)

Both call sites check `if (window.Spotify && window.Spotify.Player)` to avoid race conditions. `initSDKPlayer()` itself guards on `if (window._stmPlayer) return;` since, with tokens persisted in `localStorage`, both call sites can fire on a normal page load.

The player instance is stored as `window._stmPlayer` for access from player controls. SDK-parity logic (`sdkNeedsRetransfer`, proactive token refresh, retry after auth errors) was ported from a sibling project ("SpotiMix") in commit `4976e4f` to fix skipped/random-order tracks -- see listener behavior below.

- `getOAuthToken` proactively calls `refreshSpotifyToken()` if the token expires within 5 minutes, rather than waiting for a 401.
- `ready` -- sets `sdkReady = true`, `sdkDeviceId`, calls `stopPolling()`. If this fire is a reconnect after an auth error (`sdkNeedsRetransfer`) and there's an active session (`sessionQueue.size > 0 && !sessionPaused`), it re-transfers playback to the new device via `transferPlayback()`.
- `not_ready` -- sets `sdkReady = false`, `sdkDeviceId = null`; resumes `startPolling()` if a session is active, so now-playing tracking doesn't go dark.
- `authentication_error` -- sets `sdkReady = false`, starts polling as a fallback, refreshes the token, then sets `sdkNeedsRetransfer = true` and calls `player.disconnect()` + `player.connect()` to force a fresh `ready` event (which performs the retransfer above).
- `initialization_error` -- sets `sdkReady = false` (SDK unsupported/blocked in this browser).

### `spotifyPlay()` Device Logic

Rewritten in commits `ca73300`/`4976e4f`/`4828bab` to match SpotiMix's device-transfer behavior and fix skipped/shuffled tracks. URIs are capped to 100 (`uris.slice(0, 100)`, the Spotify API limit).

1. **If `sdkReady && sdkDeviceId`:** transfer playback to the SDK device (`PUT /me/player`, `play:false`), wait 300ms, explicitly disable shuffle on that device (`PUT /me/player/shuffle?state=false&device_id=...`), then play with explicit `device_id`. If this play request fails, falls through to step 2 instead of giving up.
2. **Remote fallback:** fetch the device list via `getSpotifyDevices()`. Prefer an already-active device; if none is active, pick a non-restricted device (or the first) and call `transferPlayback()` (800ms delay) to activate it -- unless there are no devices at all, in which case it makes one last attempt at `PUT /me/player/play` with no `device_id`. Then disable shuffle on that device and play with explicit `device_id`.

**Why shuffle is explicitly disabled before every play:** Spotify shuffle state persists on the user's account across sessions/devices. If a user previously shuffled on their phone, a leftover `shuffle=true` state reorders STM's carefully-ordered queue the moment playback starts. STM resets it to `false` on both the SDK and remote paths every time (commit `4828bab`).

---

## Playback Architecture

### SDK Primary (v2.2+)

When `sdkReady = true`:
- Playback goes through the in-browser SDK device
- `player_state_changed` events update `onSDKStateChange()` directly
- `pollNowPlaying()` returns immediately (`if (sdkReady) return;`)

### Polling Fallback

When `sdkReady = false` (SDK not initialized, non-Premium, or SDK error):
- `pollNowPlaying()` runs every `POLL_INTERVAL` (5000ms)
- Calls `getCurrentlyPlaying()` and updates highlight via `uriToIndices` reverse map

`startPolling()`/`stopPolling()` aren't just called once at session start -- the SDK `ready`/`not_ready` listeners in `initSDKPlayer()` call `stopPolling()`/`startPolling()` directly, so polling automatically resumes if the SDK device drops (e.g. after an `authentication_error`) and stops again once it reconnects.

### `onSDKStateChange(state)`

Called by the SDK `player_state_changed` listener. Updates:
- Radio/travel hero, progress bar and Up next via `radioRenderNow()` (only for tracks of the current session)
- Now-playing highlight in track list via `uriToIndices`
- The radio view's heart button via `updateNowPlayingHeart()`

A 250ms interval (`_sdkProgressTimer`) advances `_sdkPositionMs` between state events.

### `spotifySearch()` Two-Tier Query

`spotifySearch(token, artist, track)` in `spotify.js` (commit `9d83b9c`) first tries a field-qualified query (`track:X artist:Y`) via `runSpotifySearch()`. Field-qualified search is precise but brittle against punctuation, "remaster" tags, or apostrophe differences between Last.fm and Spotify's metadata. If that returns no hit, it retries once with a plain unqualified query (`"artist track"`), which Spotify's relevance ranking handles more forgivingly. Only the final result (from whichever tier hit) is cached in `searchCache`; a `rateLimited` or `error` result from either tier returns `null` without caching, so a transient failure doesn't permanently poison the cache for that artist/track pair.

---

## Spotify API Helpers

`spotify.js` has three auto-refresh wrappers (call `getSpotifyToken()` internally, retry on 401):

- `spGet(path)` -- GET request; throws `{ status: 403, spotifyMsg }` on 403
- `spPut(path, body)` -- PUT request; pass `null` body for no-body requests (query-param-only endpoints)
- `spDelete(path, body)` -- DELETE request; same null-body support

---

## Liked Songs

**Current Spotify Library API (2025)** — the old `/me/tracks` endpoints return 403 on new tokens.

| Operation | Endpoint | Notes |
|-----------|----------|-------|
| Check | `GET /v1/me/library/contains?uris=spotify:track:id,...` | max 40 URIs, returns bool array |
| Save | `PUT /v1/me/library?uris=spotify:track:id` | no body, URIs in query string |
| Remove | `DELETE /v1/me/library?uris=spotify:track:id` | no body, URIs in query string |

- `checkLikedTracks()` -- called at end of `matchAndPlay()`. Batches up to 40 full URIs from `matchedUris[]`, calls `GET /me/library/contains`. Populates `likedSet` (Set of bare track IDs), then updates all heart buttons and the radio view heart.
- `toggleLikeTrack(idx)` -- optimistic UI update first, then `spPut`/`spDelete` on `/me/library?uris=`. Reverts on error.
- `toggleLikeCurrentTrack()` -- delegates to `toggleLikeTrack(nowPlayingIndex)`.
- `updateNowPlayingHeart()` -- syncs `#radioHeart` with `likedSet` for the track at `nowPlayingIndex`.

`likedSet` stores bare track IDs (not full URIs), e.g. `"4iV5W9uYEdYUVa79Axb7Rh"`.

---

## Save Playlist

`saveAsPlaylist()` in `spotify.js`:
1. Collects all `matchedUris[i]` for `i < allTrackCount`
2. Names playlist `"Time Machine: " + (playlistLabel || "Random")`
3. Creates via `POST /v1/me/playlists` (NOT `/v1/users/{id}/playlists` -- use the `/me/` endpoint to avoid 403)
4. Adds tracks in batches of 100
5. On success: button becomes "Saved! Open" with onclick to open playlist URL
6. On error: button resets, error shown via `showStatus()`

`playlistLabel` is set in `matchAndPlay()` as `label || radioEraLabel(tracks)` (the oldest scrobble date, falling back to "Random" when no track has one; the radio uses "Library Radio"). Each mode passes a descriptive label string (e.g., "January 15, 2014", "Radiohead - Jan 2015", "The 2010s").

---

## Library Radio

Start radio plays an endless stream of random scrobbles from the user's whole history.

- **Sampling:** `getLastFmScrobbleAt(user, page)` calls `user.getrecenttracks` with `limit=1`; with `limit=1`, `page` is an index into the scrobbles, so `radioPickPage(total)` is uniform over history. Songs played more often come up more often.
- **Engine (`radio.js`):** `radioFill(want)` fires `RADIO_CONCURRENCY` parallel single-scrobble requests per round, dedupes by `artist||track` (`radioSeen`) and by Spotify URI, matches with `spotifySearch()`, and appends to `matchedUris` / `allTrackCount` / `sessionQueue` / `trackMeta[index]`.
- **Top-up:** `radioMaybeRefill()` runs on every track change (SDK state handler and polling fallback). When `RADIO_LOW_WATER` tracks remain it calls `continueRadio()`, which re-issues `spotifyPlay()` from the current track with the new tracks appended (same approach as `continueMatching`, avoids the persistent user queue).
- **Stale work:** every start/stop bumps `radioSession`; in-flight fills compare against it and bail. `beginSession()` and `handleReset()` call `radioStop()`.
- **Views:** `#homeView` (a `.radio-card` with the headline, username and Start radio, then `#timeTravel`: a grid of nine `.mode-card` buttons that `setMode()` toggles, each revealing its `.mode-inputs` block) and `#radioView` (its `.radio-now` card wraps the hero, progress bar and controls), which serves both Library Radio and every Time Travel mode via `showRadioView("radio" | "travel")`. Travel shows the full clickable `#trackList` instead of Up next (there is no context panel and no time slider), plus an Again button (`travelAgain()` re-runs `handleGo()`). `matchAndPlay()` opens the travel view; failures in `fetchAndPlay*` call `radioStop()` to return home (errors raised earlier, inside a mode handler, never left home). There are no page numbers in the UI: moments are labelled by date (`radioEraLabel(tracks)`, which also names the saved playlist).
- **Session-only player events:** the hero, info panel and radio progress bar only follow tracks that belong to the current session (`uriToIndices[track.uri]`), and the progress bar is gated by `radioHeroLive`, so the previous session's song never shows while the next one loads.
- **Artist info:** on every track change `radioSyncInfo()` calls `radioInfoFor(idx)`, which fetches `artist.getinfo` (bio summary + `stats.userplaycount`) and `track.getinfo` (`userplaycount`) with `username`, using the scrobble's own names (`radioInfoSource(idx)`: `trackMeta[idx].lfmArtist` / `lfmTrack` in the radio, the Last.fm track objects in `currentTracks` in time travel) and the username from `radioUser` or the username field. Results are cached per artist and per track as promises (`radioArtistCache` / `radioTrackCache`); a failed lookup is not cached and never throws. `radioParseBio()` strips the HTML and the trailing "Read more on Last.fm" link (http(s) only); the panel (`#radioInfo`) hides itself when there is nothing to show.
- **Clickable Up next:** rows come from `radioQueueRowHtml()` (cover from `trackMeta.art`, https only, and the scrobble year) and each calls `radioPlayFrom(idx)`, which re-issues `spotifyPlay()` from that track onward (`radioUrisFrom`).
- **Home and Back to radio:** the Home button calls `radioMinimize()`, which only swaps views (`radioMinimized = true`); the session, the music and the refills keep running and the hero/queue keep updating while hidden. `radioSyncHome()` then turns the home card into "Playing now · track · artist" (`#radioPlaying`), a primary `#radioBackBtn` ("Back to radio", calls `radioReopen()`) and a secondary "Start a new radio" (`#radioBtn`). There is no bottom player bar any more: while the session runs behind the home view, play/pause and skipping live in the radio view. Starting any new session goes through `beginSession()` -> `radioStop()` -> `hideRadioView()`, which clears `radioMinimized` and restores the card.
- **Volume and Save as Playlist:** `#radioVolume` (a native range input in the controls row, desktop only) calls `setVolume(el)`, which sets the SDK player's own volume and the `--vol` fill; it is shown only while `sdkReady` (`radioSyncVolume()` toggles the `.sdk` class on `#radioVolumeWrap` from `radioRenderNow`, and reads the real volume once with `getVolume()`), and hidden below 720px by CSS (phones cannot use the SDK). `#savePlaylistBtn` is a single element that `showRadioView()` moves into the header of the list that is showing (`#saveSlotRadio` next to Up next, `#saveSlotTravel` next to the matched count).
- **Icons:** Phosphor web font from jsDelivr (regular and fill stylesheets in `index.html`).

---

## Key Quirks and Gotchas

1. **Use `/v1/me/playlists` not `/v1/users/{id}/playlists`** -- the user-id endpoint returns 403 in dev mode even with correct scopes. The `/me/` endpoint always works.

2. **Unicode box-drawing characters in HTML comments cause tool failures** -- use ASCII-only comments in HTML (e.g., use `===` separators, not `═══`).

3. **Spotify tokens live in `localStorage`, not `sessionStorage`** -- intentional (v2.3+), so a reconnect isn't needed every time a tab closes. Only the PKCE code verifier and a spare copy of the Last.fm username use `sessionStorage`. Don't revert the token storage to `sessionStorage` without checking why it was changed (commit `bd8354c`).

4. **`pollNowPlaying()` only runs when `!sdkReady`** -- first line is `if (sdkReady) return;`. When SDK is active, `player_state_changed` events handle all updates.

5. **`matchedUris` is index-keyed object, not an array** -- iterate with `for (let i = 0; i < allTrackCount; i++)`, not `Object.values()` or array methods. Sparse: some indices may be missing.

6. **`uriToIndices` reverse map supports duplicate URIs** -- maps `"spotify:track:xyz"` to an array of track indices. Used to find the correct row to highlight when the same track appears multiple times.

7. **`skippedPlan` + auto-continuation** -- tracks that exceed `BATCH_SIZE` (5) in the first search are pushed to `skippedPlan`. `continueMatching()` loads them in batches of 5 as `pollNowPlaying()` / `onSDKStateChange()` detects < 2 tracks remaining in the queue.

8. **SDK race condition** -- the Spotify SDK script may fire `onSpotifyWebPlaybackSDKReady` before or after PKCE auth completes. Both code paths check and call `initSDKPlayer()` if conditions are met.

9. **Spotify Library API migration (2025)** -- Spotify replaced the old track-specific library endpoints with a unified Library API. Old endpoints return 403 "Forbidden" on new tokens (not "Insufficient client scope"). If you see 403 on library calls, check the endpoint — do NOT use the old paths:
   - OLD (broken): `GET /me/tracks/contains?ids=bareId` / `PUT /me/tracks` body `{ids:[...]}`
   - NEW (correct): `GET /me/library/contains?uris=spotify:track:id` / `PUT /me/library?uris=spotify:track:id`
   Note: apps with old cached `localStorage` refresh tokens may still work temporarily with old endpoints.

10. **Disconnect button** -- `spotifyBadge` (in `index.html`) contains a `✕` button wired via inline `onclick="disconnectSpotify()"`, which clears the `localStorage` tokens and disconnects the SDK player, then calls `updateSpotifyUI(false)`. It does **not** auto re-trigger auth -- the user clicks "Connect Spotify" (`onclick="initiateSpotifyAuth()"`) again, which always passes `show_dialog: true` so Spotify shows the account picker instead of silently re-using the last session. Both buttons are wired via inline `onclick` in `index.html`, not `addEventListener` in `app.js`.

11. **Spotify 429 cooldown** -- `runSpotifySearch()` waits out a `Retry-After` of 5 seconds or less (up to 2 retries); a longer one sets `spotifyBlockedUntil` instead of sleeping. While `spotifyBlockedFor() > 0`, `spotifySearch()` returns `null` without calling Spotify, `smartMatch`, `continueMatching` and `radioFill` stop their batch, and the unsearched tracks go back to `skippedPlan` with status "skipped" (never "not_found"). The status bar shows `spotifyLimitMessage()` ("Spotify is limiting searches. Try again in about N ..."), and `continueRadio()` does not treat a cooldown as an exhausted library. Matching starts with `BATCH_SIZE` (5) searches and loads more as you listen, to stay well under the limit.

---

## Current Version: v2.5

Version bumps touch three places: the version-history comment at the top of `index.html`, the footer link text in `index.html`, and the changelog opened by `openChangelog()` (`js/ui.js`; content in `changelog.html`). `ROADMAP.md` holds planned work; `docs/superpowers/` holds design notes.

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
| `saveAsPlaylist()` | spotify.js | Create Spotify playlist from current session |
| `matchAndPlay(tracks, page, tp, label)` | player.js | Render rows, match to Spotify, start playback |
| `smartMatch(tracks, token)` | player.js | Batch search tracks against Spotify catalog |
| `continueMatching()` | player.js | Load next batch from skippedPlan |
| `pollNowPlaying()` | player.js | Poll Spotify for now-playing (fallback only) |
| `onSDKStateChange(state)` | player.js | Handle SDK player_state_changed events |
| `checkLikedTracks()` | player.js | Batch-check liked status for all matched tracks |
| `toggleLikeTrack(idx)` | player.js | Like or unlike a track by index |
| `highlightNowPlaying(index)` | ui.js | Update now-playing row highlight |
| `renderTrackRow(t, i)` | ui.js | Build HTML for a single track row |
| `showStatus(msg, type)` | ui.js | Show status bar message |
| `handleGo()` | modes.js | Dispatch to active mode handler |
| `handleReset()` | ui.js | Full reset of state and UI |
| `registerUri(uri, index)` | player.js | Populate uriToIndices reverse map |
| `startRadio()` | radio.js | Start Library Radio (random scrobbles, endless) |
| `radioFill(want)` | radio.js | Pick, dedupe, match, and append random tracks |
| `continueRadio()` | radio.js | Top up the queue and re-issue playback |
| `radioStop()` | radio.js | Stop radio and invalidate in-flight fills |
| `getLastFmScrobbleAt(user, page)` | lastfm.js | One scrobble at a 1-based history position |
