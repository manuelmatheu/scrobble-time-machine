# CLAUDE.md — Scrobble Time Machine

## What is Scrobble Time Machine

Scrobble Time Machine is a client-side web app that connects a user's Last.fm scrobble history with Spotify playback. Users enter their Last.fm username, connect Spotify via PKCE OAuth, then "time travel" by choosing a discovery mode (random page, date, artist, mood, decade, etc.). The app fetches matching tracks from Last.fm, matches them against Spotify's catalog, plays them in-browser via the Spotify Web Playback SDK, and lets users save the session as a Spotify playlist or like individual tracks.

**Live URL:** https://scrobble-time-machine.vercel.app/
**Repo URL:** https://github.com/manuelmatheu/scrobble-time-machine

---

## Architecture

### File Structure

```
index.html          -- Page shell, player bar HTML, script load order
css/
  style.css         -- All styles; single file; CSS custom properties for theming
js/
  config.js         -- API keys, SPOTIFY_SCOPES, all global state variables
  spotify.js        -- PKCE auth, Spotify API calls, SDK init, save playlist
  lastfm.js         -- Last.fm API calls (getLastFmPage, fetchEarliestYear, etc.)
  ui.js             -- DOM helpers, renderTrackRow(), track interactions, era panel, autocomplete
  player.js         -- pollNowPlaying(), smartMatch(), fetchAndPlay(), matchAndPlay(),
                       onSDKStateChange(), player controls, liked songs functions
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
<script src="js/modes.js"></script>      -- uses player.js functions -->
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

- `initiateSpotifyAuth()` -- generates code verifier + challenge, redirects to Spotify authorize
- `exchangeCodeForToken(code)` -- exchanges auth code for tokens, stores in **sessionStorage**
- `refreshSpotifyToken()` -- refreshes using stored refresh token
- `getSpotifyToken()` -- returns cached token or refreshes if within 60s of expiry

**Important:** STM uses `sessionStorage` (not `localStorage`) for Spotify tokens. Tokens are lost on tab close. This is intentional for security.

### SDK Init

`initSDKPlayer()` in `spotify.js` creates a `Spotify.Player` instance. It is called from:
1. `window.onSpotifyWebPlaybackSDKReady` callback (if token already exists when SDK loads)
2. `app.js` auth success callbacks (if SDK already loaded when auth completes)

Both call sites check `if (window.Spotify && window.Spotify.Player)` to avoid race conditions.

The player instance is stored as `window._stmPlayer` for access from player controls.

### `spotifyPlay()` Device Logic

1. If `sdkReady && sdkDeviceId`: transfer playback to SDK device (`PUT /me/player`), wait 300ms, then play with explicit `device_id`
2. Else: try `PUT /me/player/play` without device_id (works if device already active)
3. Fallback: fetch device list, prefer active device, retry with explicit device_id

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

### `onSDKStateChange(state)`

Called by the SDK `player_state_changed` listener. Updates:
- Player bar visibility + `body.has-player` class
- Album art, track name, artist name
- Play/pause button icon
- Progress bar (position + duration)
- Now-playing highlight in track list via `uriToIndices`
- Player bar heart button via `updatePlayerBarHeart()`

A 250ms interval (`_sdkProgressTimer`) advances `_sdkPositionMs` between state events.

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

- `checkLikedTracks()` -- called at end of `matchAndPlay()`. Batches up to 40 full URIs from `matchedUris[]`, calls `GET /me/library/contains`. Populates `likedSet` (Set of bare track IDs), then updates all heart buttons and the player bar heart.
- `toggleLikeTrack(idx)` -- optimistic UI update first, then `spPut`/`spDelete` on `/me/library?uris=`. Reverts on error.
- `toggleLikeCurrentTrack()` -- delegates to `toggleLikeTrack(nowPlayingIndex)`.
- `updatePlayerBarHeart()` -- syncs `#pb-heart` with `likedSet` for the track at `nowPlayingIndex`.

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

`playlistLabel` is set in `matchAndPlay()` as `label || ("Page " + page)`. Each mode passes a descriptive label string (e.g., "January 15, 2014", "Radiohead - Jan 2015", "The 2010s").

---

## Key Quirks and Gotchas

1. **Use `/v1/me/playlists` not `/v1/users/{id}/playlists`** -- the user-id endpoint returns 403 in dev mode even with correct scopes. The `/me/` endpoint always works.

2. **Unicode box-drawing characters in HTML comments cause tool failures** -- use ASCII-only comments in HTML (e.g., use `===` separators, not `═══`).

3. **`sessionStorage` not `localStorage` for Spotify tokens** -- tokens are session-scoped intentionally. Don't change this to localStorage.

4. **`pollNowPlaying()` only runs when `!sdkReady`** -- first line is `if (sdkReady) return;`. When SDK is active, `player_state_changed` events handle all updates.

5. **`matchedUris` is index-keyed object, not an array** -- iterate with `for (let i = 0; i < allTrackCount; i++)`, not `Object.values()` or array methods. Sparse: some indices may be missing.

6. **`uriToIndices` reverse map supports duplicate URIs** -- maps `"spotify:track:xyz"` to an array of track indices. Used to find the correct row to highlight when the same track appears multiple times.

7. **`skippedPlan` + auto-continuation** -- tracks that exceed `BATCH_SIZE` (15) in the first search are pushed to `skippedPlan`. `continueMatching()` loads them in batches of 15 as `pollNowPlaying()` / `onSDKStateChange()` detects < 2 tracks remaining in the queue.

8. **SDK race condition** -- the Spotify SDK script may fire `onSpotifyWebPlaybackSDKReady` before or after PKCE auth completes. Both code paths check and call `initSDKPlayer()` if conditions are met.

9. **Spotify Library API migration (2025)** -- Spotify replaced the old track-specific library endpoints with a unified Library API. Old endpoints return 403 "Forbidden" on new tokens (not "Insufficient client scope"). If you see 403 on library calls, check the endpoint — do NOT use the old paths:
   - OLD (broken): `GET /me/tracks/contains?ids=bareId` / `PUT /me/tracks` body `{ids:[...]}`
   - NEW (correct): `GET /me/library/contains?uris=spotify:track:id` / `PUT /me/library?uris=spotify:track:id`
   Note: apps with old cached `localStorage` refresh tokens may still work temporarily with old endpoints.

10. **Disconnect button** -- `spotifyBadge` contains a `✕` button that calls `disconnectSpotify()`, which clears all sessionStorage tokens, disconnects the SDK player, and immediately re-initiates PKCE auth with `show_dialog: true`. Without this, there was no way to force a fresh auth within the app.

---

## Current Version: v2.3

---

## Quick Reference

| Function | File | Purpose |
|---|---|---|
| `initiateSpotifyAuth()` | spotify.js | Start PKCE OAuth flow (includes `show_dialog:true`) |
| `disconnectSpotify()` | spotify.js | Clear tokens, disconnect SDK, re-initiate auth |
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
