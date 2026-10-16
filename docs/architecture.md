# Architecture notes

Detailed behavior of the Spotify integration, playback, radio and UI. `CLAUDE.md` has the summary; this file has the why and the edge cases. Code wins when they disagree.

## Spotify Integration

### Scopes

```
user-modify-playback-state user-read-playback-state user-read-currently-playing
playlist-modify-private playlist-modify-public
streaming user-library-modify user-library-read user-top-read
```

`streaming` is required for the Web Playback SDK. `user-library-*` for liked songs. `user-top-read` is for Discover (`/me/top/artists`): a token issued before it was added gets a 403 there, and Discover then plays the Last.fm station only and asks the user to reconnect.

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

**Spotify Connect picker:** the device button in the radio controls (`#radioDeviceBtn`) and the "Play on" row on the home card (`#homeDeviceBtn`) open `#devicePicker` (`toggleDevicePicker()` in `player.js`), which lists `GET /me/player/devices` plus "This browser" (the SDK device). Picking one calls `selectPlaybackDevice()`: it sets `playbackDeviceId` (null = automatic, i.e. this browser via the SDK, else the active device; remembered in `localStorage` `stm_device`) and, if a session is running, moves it with a transfer (`PUT /me/player`, keeps queue and position) -- or, when tracks were waiting for the SDK seam, a full `spotifyPlay()` from the current track. Every SDK-driven decision goes through `sdkPlaying()` (`sdkReady && !playbackDeviceId`), not `sdkReady`: with another device picked, `onSDKStateChange` ignores the SDK, polling follows the device, and top-ups re-issue immediately. In `spotifyPlay()` a picked device wins over the active one; if it is no longer listed, the pick is cleared with a warning and playback falls back. Android Auto plays through the phone's Spotify app, so the user picks the phone (Spotify must have been opened on it recently to be listed). `/me/player/devices` only returns devices registered with Spotify's cloud: speakers the Spotify app finds on the local network (many Sonos, some Cast devices) are missing until something has been played on them from the Spotify app; the app cannot discover them itself. The picker re-reads the list every 4s while it is open (`devicePickerTimer`, quiet refresh: it only redraws when the device list changed) and shows one short hint line (`deviceHintText()`; it names Nest, Chromecast and Sonos when only this browser is listed). Spotify does play on them once they are active, so STM follows the music there: `pollNowPlaying()` reads `/me/player` (`getCurrentlyPlaying()`, which includes the device) and `followPlaybackDevice()` adopts the device the session moved to; the SDK's null `player_state_changed` (playback left this browser) triggers `sdkLostPlayback()` for the same. `spotifyPlay()` never transfers away from an unlisted device: a picked device missing from the list gets a direct `play?device_id=` first (`spotifyPlayDirect()`), and in automatic mode with nothing listed as active it tries a play without `device_id` (which goes wherever Spotify is playing) before picking a device.

**Why shuffle is explicitly disabled before every play:** Spotify shuffle state persists on the user's account across sessions/devices. If a user previously shuffled on their phone, a leftover `shuffle=true` state reorders STM's carefully-ordered queue the moment playback starts. STM resets it to `false` on both the SDK and remote paths every time (commit `4828bab`). **Repeat is reset the same way** (`PUT /me/player/repeat?state=off`) on every full play: it also persists on the account, and with "repeat context" left on Spotify replays our list from the start instead of moving on. The quick play used at the seam skips both resets (the full play at the start of a session already did them).

---

## Playback Architecture

### SDK Primary (v2.2+)

When `sdkReady = true`:
- Playback goes through the in-browser SDK device
- `player_state_changed` events update `onSDKStateChange()` directly
- `pollNowPlaying()` returns immediately while the SDK is the player (`sdkPlaying()`: `sdkReady` and no other Connect device picked)

### Polling Fallback

When the SDK is not the player (`sdkReady = false`: not initialized, non-Premium or SDK error; or another Connect device is picked):
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

`spotifySearch(token, artist, track)` in `spotify.js` (commit `9d83b9c`) first tries a field-qualified query (`track:X artist:Y`) via `runSpotifySearch()`. Field-qualified search is precise but brittle against punctuation, "remaster" tags, or apostrophe differences between Last.fm and Spotify's metadata. If that returns no hit, it retries once with a plain unqualified query (`"artist track"`), which Spotify's relevance ranking handles more forgivingly. That tier asks for 5 results and keeps one only if `spotifyPickMatch()` finds a hit whose artist and title loosely match the scrobble (`spotifyLooseMatch`: normalized, whole-word containment); the plain query always returns something, so without that check a song missing from Spotify was replaced by an unrelated one (Delta Spirit "Yamaha" played Kanye West's "School Spirit"), and a miss is cached as not found. Only the final result (from whichever tier hit) is cached in `searchCache`; a `rateLimited` or `error` result from either tier returns `null` without caching, so a transient failure doesn't permanently poison the cache for that artist/track pair.

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

`playlistLabel` is set in `matchAndPlay()` as `label || radioEraLabel(tracks)` (the oldest scrobble date, falling back to "Random" when no track has one). Each mode passes a descriptive label string (e.g., "January 15, 2014", "Radiohead - Jan 2015", "The 2010s").

---

## Radio

Start radio plays an endless stream, from one of three stations (Library, Discover, Mix). Library plays random scrobbles from the user's whole history.

### Engine and top-ups

- **Sampling:** `getLastFmScrobbleAt(user, page)` calls `user.getrecenttracks` with `limit=1`; with `limit=1`, `page` is an index into the scrobbles, so `radioPickPage(total)` is uniform over history. Songs played more often come up more often.
- **Engine (`radio.js`):** `radioFill(want)` (Library; Discover swaps the candidate source, see Stations) fires `RADIO_CONCURRENCY` parallel single-scrobble requests per round, dedupes by `artist||track` (`radioSeen`) and by Spotify URI, matches with `spotifySearch()`, and appends to `matchedUris` / `allTrackCount` / `sessionQueue` / `trackMeta[index]`.
- **Fast start:** playback must not wait for a full queue. `startRadio()` (1) gets the device ready while the first song is picked (`spotifyPrewarm()`: only for this browser, it transfers playback and turns shuffle and repeat off in parallel with the first fill; `spotifyPlay()` awaits it and skips that prep, a remote device keeps the full logic), (2) reuses the scrobble count the home card already fetched (`homeTotalCache`, fresh for 10 minutes) instead of asking Last.fm again, (3) plays as soon as `RADIO_START_TRACKS` (1) track is matched, with no pause after the last search of a fill, and (4) calls `continueRadio()` right after, so the rest of the queue is fetched behind the first song and joins at the seam (`radioCanSeam()` is true for the first `REMOTE_FRESH_MS` after the start, `radioStartedAt`, while there is no position reading yet). A fill that is done early keeps what it already collected in `radioCarry` (Discover and Mix vet every pick, so throwing them away is expensive); the next fill uses it first. The queue renders as each track arrives. Measured with mocked latencies (Last.fm 350ms, search 280ms): Library 8.0s -> 1.5s to the first play, Discover 9.0s -> 2.4s, Mix 9.0s -> 2.8s.
- **Top-up:** `radioMaybeRefill()` runs on every track change (SDK state handler and polling fallback). When fewer than a full Up next list remains after the current track (`radioUpNextRows() - 1`: `RADIO_UPNEXT_ROWS` = 6, or `RADIO_UPNEXT_ROWS_WIDE` = 8 at 1100px and up, where the list panel is taller and its rows are 50px) it calls `continueRadio()`, which re-issues `spotifyPlay()` from the current track with the new tracks appended (same approach as `continueMatching`, avoids the persistent user queue).
- **Seam (SDK):** with the SDK the re-issue is deferred to the seam: a re-issue restarts the stream (device transfer + play), which stuttered a few seconds into a song, so `continueRadio()` / `continueMatching()` only set `radioPendingReissue`; the 250ms progress timer calls `radioMaybeSeam()`, and when the playing track is the last one we sent to Spotify (`radioContextLastUri`, set by every successful `spotifyPlay()`; the SDK's `next_tracks` is deliberately not trusted, because Spotify can append its own autoplay tracks after our list) and it is within `RADIO_SEAM_MS` of its end (`radioSeamDue`) and we hold tracks Spotify was not sent (`radioUnsentUris()`: everything after `radioContextLastUri` in `matchedUris`, derived from the data so a lost `radioPendingReissue` flag cannot strand them; `radioSeaming` stops the 250ms timer from firing twice), `radioSeamReissue()` plays the new tracks from the first new one with `spotifyPlay(..., {quick:true})` (no transfer or shuffle reset).
- **Seam (another Connect device, polling):** the swap is deferred the same way: `pollNowPlaying()` keeps the last `/me/player` reading in `remoteNow` (`uri`, `pos`, `dur`, `playing`, `at`), a 250ms tick (`radioRemoteTick()`, started in `player.js`) extrapolates the position from it (`radioRemoteLeft()`), and when the last track we sent is within `RADIO_REMOTE_SEAM_MS` (2500ms: the position is only as exact as the last poll) of its end it calls `radioSeamReissue()`, whose play goes straight to the picked device (`spotifyPlay(..., {quick:true})` on a remote: one `play` request, no device list, transfer or shuffle/repeat resets, falling back to the full logic if refused). Within 12s of the end the tick re-reads `/me/player` every second. If the swap is missed and Spotify moves on to a track that is not ours, `radioRecoverRunOff()` re-issues late (a short gap, no loss). `radioCanSeam()` is true with the SDK or when `remoteNow` is under 20s old; with no recent reading (first seconds of a session, failing polls) the re-issue is still immediate.
- Playing from a row clears the pending flag, since that play already carries every queued track.

### Stations

- **Picker:** the home card has a picker (`#stationPicker`, `radioSetStation()`, remembered in `localStorage` `stm_station`); `radioStation` is the one picked, `radioActiveStation` the one the running session plays (set in `startRadio()`), so changing the picker never alters a running radio.
- **Library** is everything above (random scrobbles).
- **Mix** alternates the two: `mixCollectBatch()` collects both sources in parallel (leftovers wait in `radioBuf`) and hands the picks out in the pattern of the chosen balance (`MIX_PATTERNS` / `mixKindAt()`: "Mostly past" 3:1, "Balanced" 1:1, "Mostly new" 1:3; picked on the home card with `radioSetBalance()`, remembered in `stm_mix_balance`, captured at start as `radioActiveBalance`). When the source whose turn it is runs empty the batch ends and the next round fetches more of it; when it has nothing at all (down or dry) the other source keeps playing, and a round only counts as a failure when every source asked failed. Past picks (every Library pick too, not only the history half of a Mix) get `trackMeta.fromPast` and show a neutral "From YEAR" chip in the hero and the Up next rows, new picks the red sparkle chip (Mix needs `radioTotal` like Library, and the same vetting as Discover).
- **Discover** plays new music: `discoverCollectBatch()` pops candidates from `discoverPool`, which `discoverRefillPool()` fills from two sources interleaved two to one: Last.fm's personalized station (`getLastFmStation()` -> `/api/lfm-station`, ~24 tracks, a different set on every call, so the function sends `no-store`) and artists similar to your top 5 artists of the last month (`/me/top/artists?time_range=short_term` seeds, `artist.getsimilar`, one random top-10 song per similar artist, rotating through the seeds). `track.getsimilar` is not used: it returned nothing for every track we tried. Each candidate is vetted before it costs a Spotify search (`discoverVet()`, in parallel, through the same caches as the info panel): `discoverVerdict()` drops songs you have played (Last.fm `userplaycount` > 0) and labels the rest `new-artist` (never played the artist) or `new-song`; after the search `discoverIsSaved()` (`/me/library/contains`) drops saved songs. `trackMeta` gets `source` ("Last.fm pick" / "Similar to X"), `kind` and `artistPlays`; the hero chip (`#radioSource`), the Up next chips and the artist panel text (`discoverStatsHtml()`) show them. `radioFill()` runs at most `DISCOVER_MAX_ROUNDS` rounds per call. An empty but healthy Discover round never sets `radioExhausted` (the station changes on every call): it warns once and retries at the next track change. The station endpoint is undocumented and may change; if it fails, the similar-artist source still plays. Spotify's own `/recommendations` and related-artists are unavailable to this app (development mode: 404/403), which is why Last.fm supplies the music.
- **Stale work (all stations):** every start/stop bumps `radioSession`; in-flight fills compare against it and bail. `beginSession()` and `handleReset()` call `radioStop()`.

### Views and layout

- **Views:** `#homeView` (a `.radio-card` with the headline, username and Start radio, then `#timeTravel`: a grid of nine `.mode-card` buttons that `setMode()` toggles, each revealing its `.mode-inputs` block; at 1100px and up, once Spotify is connected (`updateSpotifyUI` adds `.connected`), it is two columns: the card on the left at 420px and the modes on the right; before connecting, the card is centered at 680px) and `#radioView` (its `.radio-now` card, a fixed 224px grid on desktop, wraps the hero, progress bar and controls: cover on the left, text/progress/controls on the right, `.radio-hero` uses `display:contents`; on phones it stacks with a full-width cover and auto height, the like heart moves next to the title (`#radioHeartTitle`, while `#radioHeart` in the controls row is hidden) so prev / play / next stay centered; `updateNowPlayingHeart()` updates both), which serves both Library Radio and every Time Travel mode via `showRadioView("radio" | "travel")`. On screens of 1100px and wider the container grows to 1120px (the header and every view) and `.radio-cols` becomes two columns: `.radio-col-main` (the now-playing card + the artist panel `#radioInfo`, 640px) and `.radio-col-list` (Up next or the Tracks list as a panel pinned to the same height as the left column, `min 468px`; Up next rows grow to fill, the Tracks list scrolls inside it and `scrollTrackListTo()` keeps the playing row visible without moving the page). Below 1100px it stays one column. In the wide layout every Up next row is exactly 1/`radioUpNextRows()` of its panel (`--upnext-rows`, set by `radioRenderQueue()`), so rows keep the same height even while fewer tracks are queued; the Tuning row only takes a free slot. Travel shows the full clickable `#trackList` instead of Up next (there is no context panel and no time slider), plus an Again button (`travelAgain()` re-runs `handleGo()`). `matchAndPlay()` opens the travel view; failures in `fetchAndPlay*` call `radioStop()` to return home (errors raised earlier, inside a mode handler, never left home). There are no page numbers in the UI: moments are labelled by date (`radioEraLabel(tracks)`, which also names the saved playlist).
- **Session-only player events:** the hero, info panel and radio progress bar only follow tracks that belong to the current session (`uriToIndices[track.uri]`), and the progress bar is gated by `radioHeroLive`, so the previous session's song never shows while the next one loads.

### Artist info and photo

- **Artist info:** on every track change `radioSyncInfo()` calls `radioInfoFor(idx)`, which fetches `artist.getinfo` (bio summary + `stats.userplaycount`) and `track.getinfo` (`userplaycount`) with `username`, using the scrobble's own names (`radioInfoSource(idx)`: `trackMeta[idx].lfmArtist` / `lfmTrack` in the radio, the Last.fm track objects in `currentTracks` in time travel) and the username from `radioUser` or the username field. Results are cached per artist and per track as promises (`radioArtistCache` / `radioTrackCache`); a failed lookup is not cached and never throws. `radioParseBio()` strips the HTML and the trailing "Read more on Last.fm" link (http(s) only); the panel (`#radioInfo`) hides itself when there is nothing to show.
- **Artist photo (wide desktop only):** Last.fm no longer serves artist images through its API (only a generic placeholder, and its terms forbid third-party use), so the photo in the artist panel comes from Spotify: `radioRenderNow()` calls `radioSyncArtistPhoto(track)`, which takes the first artist's id (`radioArtistId`: SDK `artists[].uri`, Web API `artists[].id`) and fetches `GET /artists/{id}` through `spGet` (no extra scope), once per artist (`radioPhotoCache`, a failed lookup is not cached). `radioArtistPhotoFromSpotify()` picks the smallest https image that is at least 296px wide (retina for the 148px slot) and the artist's open.spotify.com page, which the photo links to. The slot (`#radioArtistPhoto`) is `display:none` below 1100px and nothing is requested there; with no photo it keeps a microphone placeholder. A stale answer for a previous artist is ignored (`radioPhotoId`).

### Up next, Home and volume

- **Clickable Up next:** rows come from `radioQueueRowHtml()` (cover from `trackMeta.art`, https only, and the scrobble year) and each calls `radioPlayFrom(idx)`, which re-issues `spotifyPlay()` from that track onward (`radioUrisFrom`).
- **Home and Back to radio:** the Home button calls `radioMinimize()`, which only swaps views (`radioMinimized = true`); the session, the music and the refills keep running and the hero/queue keep updating while hidden. `radioSyncHome()` then turns the home card into "Playing now · track · artist" (`#radioPlaying`), a primary `#radioBackBtn` ("Back to radio", calls `radioReopen()`) and a secondary "Start a new radio" (`#radioBtn`). There is no bottom player bar any more: while the session runs behind the home view, play/pause and skipping live in the radio view. Starting any new session goes through `beginSession()` -> `radioStop()` -> `hideRadioView()`, which clears `radioMinimized` and restores the card.
- **Volume:** `#radioVolume` (a native range input in the controls row, desktop only) calls `setVolume(el)`, which sets the SDK player's own volume and the `--vol` fill; it is shown only while `sdkReady` (`radioSyncVolume()` toggles the `.sdk` class on `#radioVolumeWrap` from `radioRenderNow`, and reads the real volume once with `getVolume()`), and hidden below 720px by CSS (phones cannot use the SDK). **Save as Playlist exists only in Time Travel:** `#savePlaylistBtn` lives in `#saveSlotTravel`, inside the Tracks header, so it is never visible in the Library Radio view (an endless random stream makes a poor playlist).
- **Icons:** Phosphor web font from jsDelivr (regular and fill stylesheets in `index.html`).

---

## Status messages (toasts)

`showStatus(msg, type)` (ui.js) shows `"error"` and `"warn"` messages as a toast (`#toastHost`, a persistent `role="status"` live region at the bottom of the page; the toast is built with `textContent`, never parsed as HTML). One toast at a time: a new message replaces the current one, the same message again only re-arms its timer. Warnings go away after 6s, errors after 9s (`TOAST_MS`), hovering or focusing holds it, and the close button (`hideStatus()`) dismisses it. `"success"` dismisses the current toast (the problem it reported is over: e.g. playback resumed); plain progress text (`""`) is ignored. The interface itself (hero "Tuning...", Cancel button, now-playing row) shows loading and success state, so keep `showStatus` for failures, rate-limit notices (`spotifyLimitMessage()`, type `"error"`) and things the user must act on (type `"warn"`).
