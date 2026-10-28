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

- `initiateSpotifyAuth()` -- generates code verifier + challenge, redirects to Spotify authorize; the verifier and the Last.fm username are stashed in `sessionStorage` for the round trip, and also in `localStorage` (an installed PWA can return from Spotify in a fresh browsing context where `sessionStorage` is empty; `exchangeCodeForToken()` reads either and deletes the verifier afterwards)
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

**Play on picker (v2.12, `js/connect.js`):** the "Play on" picker is back, rebuilt. `connectReadDevices()` reads `/me/player/devices`; `connectDeviceRows()` turns the list into rows (this browser first, then the others; restricted devices such as Sonos come back separately and are shown greyed out with the reason). `connectPick(id)` reads where the music is (the song and its position: the SDK's while this browser plays, else a fresh `/me/player` reading of that song, never an old or another song's) before it sets `playbackDeviceId` to the target (this browser's own SDK id clears it), then moves the music. With a running radio: when another window or app has the music (`sdkInactive` or `sessionPaused`) a full `spotifyPlay()` of this window's own queue from where it stopped (`radioResumePoint()`, as Play), so their music is never moved; with unsent songs a full `spotifyPlay()` from the current song at its position; otherwise a transfer (`connectTransfer()`). A pick of this browser passes `{sdkOnly:true}`, so `spotifyPlay()` cannot fall through to another device and report success. A failure puts the previous device back. With no radio, or before a radio's first play (`radioContextLastUri` null), it only sets the device (the Home row) and starts no poll: an idle speaker reads empty. `followPlaybackDevice()` still follows a session moved from the Spotify app; `playbackDeviceId` stays in memory only.

**Truth rules:** the Playing on bar under the player (`#connectBar`) shows the device Spotify reports, never the one STM hopes for. While a radio runs, two empty readings in a row show "Checking what's playing…" (hero, Home's line and bar; the now-playing index, source chip, info and moment panels go too) instead of a stale song. If a device was followed it is let go (`releaseDeadDevice(false)`); with this browser's player ready the music comes back here instead: the last song paused (the `radioPausedElsewhere()` look), the bar on This browser, and Play resumes it here. Without a radio empty readings change nothing (a speaker picked on Home is kept). A window whose music another window or app took (`sdkLostPlayback()`) shows the device Spotify reports there (this browser when none), since it does not poll while inactive. A new radio clears the bar until its first reading. Hidden pages do not poll, unless the window runs a radio whose music plays on another device (so it keeps following and swapping seams). Every window follows what Spotify reports within a few seconds, so a second window or the Spotify app moving the music shows up in all of them.

**The list:** a dropdown under the Change button that opened it (wide) or a bottom sheet over `--scrim` (below 720px). It re-reads every 4s only while open and the page is visible, has a Refresh button, and a failed read keeps the rows already shown. Home has a "Plays on" row (the picked or followed device; else this browser when its player is ready; else the default of the last device list read, which on a phone is the active device or the phone's own Spotify app; else "Spotify on this phone" on a phone and this browser on a desktop) and, on phones, a strip while something plays on another device, with Pause/Play and Next that act on the reading it shows.

**What Spotify allows:** only devices signed in to the account and cloud-registered are listed; the app cannot wake a sleeping speaker (play something on it once from the Spotify app, then Refresh); Sonos is restricted (listed, not selectable); there is no casting from STM.

**Why shuffle is explicitly disabled before every play:** Spotify shuffle state persists on the user's account across sessions/devices. If a user previously shuffled on their phone, a leftover `shuffle=true` state reorders STM's carefully-ordered queue the moment playback starts. STM resets it to `false` on both the SDK and remote paths every time (commit `4828bab`). **Repeat is reset the same way** (`PUT /me/player/repeat?state=off`) on every full play: it also persists on the account, and with "repeat context" left on Spotify replays our list from the start instead of moving on. The quick play used at the seam skips both resets (the full play at the start of a session already did them).

---

## Playback Architecture

### SDK Primary (v2.2+)

When `sdkReady = true`:
- Playback goes through the in-browser SDK device
- `player_state_changed` events update `onSDKStateChange()` directly
- `pollNowPlaying()` returns immediately while the SDK is the player (`sdkPlaying()`: `sdkReady` and the session was not moved to another device)

### Polling Fallback

When the SDK is not the player (`sdkReady = false`: not initialized, non-Premium or SDK error; or the session was moved to another Connect device):
- `pollNowPlaying()` runs every `POLL_INTERVAL` (5000ms)
- Calls `getCurrentlyPlaying()` and updates highlight via `uriToIndices` reverse map

`startPolling()`/`stopPolling()` aren't just called once at session start -- the SDK `ready`/`not_ready` listeners in `initSDKPlayer()` call `stopPolling()`/`startPolling()` directly, so polling automatically resumes if the SDK device drops (e.g. after an `authentication_error`) and stops again once it reconnects.

### `onSDKStateChange(state)`

Called by the SDK `player_state_changed` listener. Updates:
- Radio hero, progress bar and Up next via `radioRenderNow()` (only for tracks of the current session)
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

- `checkLikedTracks()` -- called after each play the radio issues. Batches up to 40 full URIs from `matchedUris[]`, calls `GET /me/library/contains`. Populates `likedSet` (Set of bare track IDs), then updates the radio view hearts.
- `toggleLikeTrack(idx)` -- optimistic UI update first, then `spPut`/`spDelete` on `/me/library?uris=`. Reverts on error.
- `toggleLikeCurrentTrack()` -- delegates to `toggleLikeTrack(nowPlayingIndex)`.
- `updateNowPlayingHeart()` -- syncs `#radioHeart` with `likedSet` for the track at `nowPlayingIndex`.

`likedSet` stores bare track IDs (not full URIs), e.g. `"4iV5W9uYEdYUVa79Axb7Rh"`.

---

## Save Playlist

`saveAsPlaylist(btn, uris, label, stillCurrent)` in `spotify.js`, used by **Save this moment** (`saveMomentPlaylist()` in `radio.js`, Library in Moments only):
1. `saveMomentPlaylist()` collects the queued tracks of the playing moment (`radioMomentIndices(id)`, in order)
2. Names the playlist `"Time Machine: " + label`, the moment's label ("Tuesday, March 11, 2014 · evening")
3. Creates it via `POST /v1/me/playlists` (NOT `/v1/users/{id}/playlists` -- use the `/me/` endpoint to avoid 403)
4. Adds tracks in batches of 100
5. On success: the button becomes "Saved! Open" with onclick to open the playlist URL; `stillCurrent()` false (the panel moved on to another moment meanwhile) leaves the button alone
6. On error: the button resets, the error shows as a toast

The radio's other modes have no save button: an endless random stream makes a poor playlist, a moment does not.

---

## Radio

Start radio plays an endless stream, from one of three stations (Library, Discover, Mix). Library plays your own scrobbles: random ones (Songs) or stretches of consecutive ones (Moments), from the whole history or from one year. Library in Moments replaced the Time Travel modes (v2.11).

### Engine and top-ups

- **Sampling:** `getLastFmScrobbleAt(user, page, range)` calls `user.getrecenttracks` with `limit=1`; with `limit=1`, `page` is an index into the scrobbles, so `radioPickPage(total)` is uniform over history. Songs played more often come up more often. With One year, `range` (`radioYearRange(year)`: local-time bounds in unix seconds, kept in `radioRange` for the session) adds `from`/`to`, and `radioTotal` is that year's count (`getLastFmCountIn()`), so every position stays inside the year.
- **Moments:** with How it plays = Moments, `momentCollectBatch()` picks one random position, fetches the `MOMENT_FETCH` (30) scrobbles around it (`getLastFmScrobbles(user, page, 30, range)`, `page = ceil(pos / 30)`) and `radioMomentFromTracks()` keeps the run around that point with no silence longer than `MOMENT_GAP_S` (2 hours), oldest first, at most `MOMENT_MAX` (15) tracks. Every pick carries the same `moment` object (`id` from `radioMomentSeq`, `label`, `chip`, `start`, `end`, `size`), which lands in `trackMeta[idx].moment`. The picks go through `radioFill()` like any batch, so a fill that stops mid-moment keeps the rest in `radioCarry`, in order. A failed page counts as a failure (backoff); a run of moments that adds nothing marks the library (or the year) exhausted.
- **Engine (`radio.js`):** `radioFill(want)` (Library; Discover swaps the candidate source, see Stations) fires `RADIO_CONCURRENCY` parallel single-scrobble requests per round, dedupes by `artist||track` (`radioSeen`) and by Spotify URI, matches with `spotifySearch()`, and appends to `matchedUris` / `allTrackCount` / `sessionQueue` / `trackMeta[index]`.
- **Fast start:** playback must not wait for a full queue. `startRadio()` (1) gets the device ready while the first song is picked (`spotifyPrewarm()`: only for this browser, it transfers playback and turns shuffle and repeat off in parallel with the first fill; `spotifyPlay()` awaits it and skips that prep, a remote device keeps the full logic), (2) reuses the scrobble count the home card already fetched (`homeTotalCache`, fresh for 10 minutes) instead of asking Last.fm again, (3) plays as soon as `RADIO_START_TRACKS` (1) track is matched, with no pause after the last search of a fill, and (4) calls `continueRadio()` right after, so the rest of the queue is fetched behind the first song and joins at the seam (`radioCanSeam()` is true for the first `REMOTE_FRESH_MS` after the start, `radioStartedAt`, while there is no position reading yet). A fill that is done early keeps what it already collected in `radioCarry` (Discover and Mix vet every pick, so throwing them away is expensive); the next fill uses it first. The queue renders as each track arrives. Measured with mocked latencies (Last.fm 350ms, search 280ms): Library 8.0s -> 1.5s to the first play, Discover 9.0s -> 2.4s, Mix 9.0s -> 2.8s.
- **Top-up:** `radioMaybeRefill()` runs on every track change (SDK state handler and polling fallback). When fewer than a full Up next list remains after the current track (`radioUpNextRows() - 1`: `RADIO_UPNEXT_ROWS` = 6, or `RADIO_UPNEXT_ROWS_WIDE` = 8 at 1100px and up, where the list panel is taller and its rows are 50px) it calls `continueRadio()`, which re-issues `spotifyPlay()` from the current track with the new tracks appended (avoids the persistent user queue).
- **Seam (SDK):** with the SDK the re-issue is deferred to the seam: a re-issue restarts the stream (device transfer + play), which stuttered a few seconds into a song, so `continueRadio()` only sets `radioPendingReissue`; the 250ms progress timer calls `radioMaybeSeam()`, and when the playing track is the last one we sent to Spotify (`radioContextLastUri`, set by every successful `spotifyPlay()`; the SDK's `next_tracks` is deliberately not trusted, because Spotify can append its own autoplay tracks after our list) and it is within `RADIO_SEAM_MS` of its end (`radioSeamDue`) and we hold tracks Spotify was not sent (`radioUnsentUris()`: everything after `radioContextLastUri` in `matchedUris`, derived from the data so a lost `radioPendingReissue` flag cannot strand them; `radioSeaming` stops the 250ms timer from firing twice), `radioSeamReissue()` plays the new tracks from the first new one with `spotifyPlay(..., {quick:true})` (no transfer or shuffle reset).
- **Seam (another Connect device, polling):** the swap is deferred the same way: `pollNowPlaying()` keeps the last `/me/player` reading in `remoteNow` (`uri`, `pos`, `dur`, `playing`, `at`), a 250ms tick (`radioRemoteTick()`, started in `player.js`) extrapolates the position from it (`radioRemoteLeft()`), and when the last track we sent is within `RADIO_REMOTE_SEAM_MS` (2500ms: the position is only as exact as the last poll) of its end it calls `radioSeamReissue()`, whose play goes straight to the picked device (`spotifyPlay(..., {quick:true})` on a remote: one `play` request, no device list, transfer or shuffle/repeat resets, falling back to the full logic if refused). Within 12s of the end the tick re-reads `/me/player` every second. If the swap is missed and Spotify moves on to a track that is not ours, `radioRecoverRunOff()` re-issues late (a short gap, no loss). `radioCanSeam()` is true with the SDK or when `remoteNow` is under 20s old; with no recent reading (first seconds of a session, failing polls) the re-issue is still immediate.
- Playing from a row clears the pending flag, since that play already carries every queued track.

### Stations

- **Tabs:** the home card has station tabs (`#stationPicker`, a `tablist`; `radioSetStation()` moves the `#stationInd` indicator through `--i`, cross-fades `#stationPanelIn` and shows the station's block: `#libraryOptions`, `#mixBalance` or `#discoverNote`; `fitStationPanel()` sets the panel height from a `ResizeObserver` set up in `app.js`, only while the card is visible; the first call at load skips the cross-fade) ( remembered in `localStorage` `stm_station`); `radioStation` is the one picked, `radioActiveStation` the one the running session plays (set in `startRadio()`), so changing the tabs never alters a running radio.
- **Library** is everything above. Its two options live in the station panel on the home card (`#libraryOptions`, shown only while Library is picked): How it plays (`radioSetHow()`, `stm_library_how`: `songs` | `moments`) and When (`radioSetYear()`, `stm_library_year`: 0 for every year, else the year; the `#libraryYear` list runs from the year of the first scrobble, `fetchEarliestYear()` once per username in `refreshLibraryYears()`, to today). `startRadio()` captures them as `radioActiveHow` / `radioActiveYear`; Discover and Mix ignore them (Mix's past half always samples the whole history). The headline (`radioHomeHeadline()`) and the radio title (`radioSessionTitle()`, "Library radio · Moments · 2014") name them.
- **Mix** alternates the two: `mixCollectBatch()` collects both sources in parallel (leftovers wait in `radioBuf`) and hands the picks out in the pattern of the chosen balance (`MIX_PATTERNS` / `mixKindAt()`: "Mostly past" 3:1, "Balanced" 1:1, "Mostly new" 1:3; picked on the home card with `radioSetBalance()`, remembered in `stm_mix_balance`, captured at start as `radioActiveBalance`). When the source whose turn it is runs empty the batch ends and the next round fetches more of it; when it has nothing at all (down or dry) the other source keeps playing, and a round only counts as a failure when every source asked failed. Past picks (every Library pick too, not only the history half of a Mix) get `trackMeta.fromPast` and show a neutral "From YEAR" chip in the hero and the Up next rows, new picks the red sparkle chip (Mix needs `radioTotal` like Library, and the same vetting as Discover).
- **Discover** plays new music: `discoverCollectBatch()` pops candidates from `discoverPool`, which `discoverRefillPool()` fills from two sources interleaved two to one: Last.fm's personalized station (`getLastFmStation()` -> `/api/lfm-station`, ~24 tracks, a different set on every call, so the function sends `no-store`) and artists similar to your top 5 artists of the last month (`/me/top/artists?time_range=short_term` seeds, `artist.getsimilar`, one random top-10 song per similar artist, rotating through the seeds). `track.getsimilar` is not used: it returned nothing for every track we tried. Each candidate is vetted before it costs a Spotify search (`discoverVet()`, in parallel, through the same caches as the info panel): `discoverVerdict()` drops songs you have played (Last.fm `userplaycount` > 0) and labels the rest `new-artist` (never played the artist) or `new-song`; after the search `discoverIsSaved()` (`/me/library/contains`) drops saved songs. `trackMeta` gets `source` ("Last.fm pick" / "Similar to X"), `kind` and `artistPlays`; the hero chip (`#radioSource`), the Up next chips and the artist panel text (`discoverStatsHtml()`) show them. `radioFill()` runs at most `DISCOVER_MAX_ROUNDS` rounds per call. An empty but healthy Discover round never sets `radioExhausted` (the station changes on every call): it warns once and retries at the next track change. The station endpoint is undocumented and may change; if it fails, the similar-artist source still plays. Spotify's own `/recommendations` and related-artists are unavailable to this app (development mode: 404/403), which is why Last.fm supplies the music.
- **Stale work (all stations):** every start/stop bumps `radioSession`; in-flight fills compare against it and bail. `beginSession()` and `handleReset()` call `radioStop()`.

### Views and layout

- **Views:** `#homeView` shows `#landing` until Spotify is connected (a short card with two numbered steps, username then Connect Spotify, which says up front that Premium is needed; `showLanding()` / `landingSync()` in `ui.js`, its field mirrors `#usernameInput`, and a stored refresh token skips it at load) and `#homeCard` afterwards (a `.radio-card` with the headline, the station picker, the Library options or the Mix balance, the username and Start radio; centered at 680px, also on wide desktop) and `#radioView` (its `.radio-now` card, a fixed 224px grid on desktop, wraps the hero, progress bar and controls: cover on the left, text/progress/controls on the right, `.radio-hero` uses `display:contents`; on phones it stacks with a full-width cover and auto height, the like heart moves next to the title (`#radioHeartTitle`, while `#radioHeart` in the controls row is hidden) so prev / play / next stay centered; `updateNowPlayingHeart()` updates both). `showRadioView()` opens it. On screens of 1100px and wider the container grows to 1120px (the header and every view) and `.radio-cols` becomes two columns: `.radio-col-main` (the now-playing card, the moment panel `#radioMoment` and the artist panel `#radioInfo`, 640px) and `.radio-col-list` (Up next as a panel pinned to the same height as the left column, `min 468px`). Below 1100px it stays one column. In the wide layout every Up next row is exactly 1/`radioUpNextRows()` of its panel (`--upnext-rows`, set by `radioRenderQueue()`), so rows keep the same height even while fewer tracks are queued; the Tuning row only takes a free slot. That is why a new moment is marked by a stronger line on its first row (`.moment-start`), not by a header row. There are no page numbers in the UI: moments are labelled by date.
- **This moment (`#radioMoment`):** `radioSyncMoment()` (from `radioRenderNow()`) shows the playing track's moment: its label, `radioMomentMeta()` ("11 songs you played between 21:04 and 21:52, in that order.") and two buttons. **Save this moment** saves its queued songs (see Save Playlist). **Next moment** plays from the first queued track of another moment (`radioNextMomentIndex()`); when none is queued yet it drops the rest of this moment from `radioCarry`, sets `radioJumpFrom` and tops up, and `radioFill()` plays the next moment's first song as soon as it is matched. It is disabled only while that jump is pending or when the library is exhausted.
- **Session-only player events:** the hero, info panel and radio progress bar only follow tracks that belong to the current session (`uriToIndices[track.uri]`), and the progress bar is gated by `radioHeroLive`, so the previous session's song never shows while the next one loads.

### Artist info and photo

- **Artist info:** on every track change `radioSyncInfo()` calls `radioInfoFor(idx)`, which fetches `artist.getinfo` (bio summary + `stats.userplaycount`) and `track.getinfo` (`userplaycount`) with `username`, using the scrobble's own names (`radioInfoSource(idx)`: `trackMeta[idx].lfmArtist` / `lfmTrack`, only while the radio runs) and the username from `radioUser`. Results are cached per artist and per track as promises (`radioArtistCache` / `radioTrackCache`); a failed lookup is not cached and never throws. `radioParseBio()` strips the HTML and the trailing "Read more on Last.fm" link (http(s) only); the panel (`#radioInfo`) hides itself when there is nothing to show.
- **Artist photo (wide desktop only):** Last.fm no longer serves artist images through its API (only a generic placeholder, and its terms forbid third-party use), so the photo in the artist panel comes from Spotify: `radioRenderNow()` calls `radioSyncArtistPhoto(track)`, which takes the first artist's id (`radioArtistId`: SDK `artists[].uri`, Web API `artists[].id`) and fetches `GET /artists/{id}` through `spGet` (no extra scope), once per artist (`radioPhotoCache`, a failed lookup is not cached). `radioArtistPhotoFromSpotify()` picks the smallest https image that is at least 296px wide (retina for the 148px slot) and the artist's open.spotify.com page, which the photo links to. The slot (`#radioArtistPhoto`) is `display:none` below 1100px and nothing is requested there; with no photo it keeps a microphone placeholder. A stale answer for a previous artist is ignored (`radioPhotoId`).

### Up next, Home and volume

- **Clickable Up next:** rows come from `radioQueueRowHtml()` (cover from `trackMeta.art`, https only, and the chip from `radioChipText()`: the Discover reason, the moment's date, or "From YEAR") and each calls `radioPlayFrom(idx)`, which re-issues `spotifyPlay()` from that track onward (`radioUrisFrom`).
- **Home and Back to radio:** the Home button calls `radioMinimize()`, which only swaps views (`radioMinimized = true`); the session, the music and the refills keep running and the hero/queue keep updating while hidden. `radioSyncHome()` then turns the home card into "Playing now · track · artist" (`#radioPlaying`), a primary `#radioBackBtn` ("Back to radio", calls `radioReopen()`) and a secondary "Start a new radio" (`#radioBtn`). There is no bottom player bar any more: while the session runs behind the home view, play/pause and skipping live in the radio view. Starting any new session goes through `beginSession()` -> `radioStop()` -> `hideRadioView()`, which clears `radioMinimized` and restores the card.
- **Volume:** `#radioVolume` (a native range input in the controls row, desktop only) calls `setVolume(el)`, which sets the SDK player's own volume and the `--vol` fill; it is shown only while `sdkReady` (`radioSyncVolume()` toggles the `.sdk` class on `#radioVolumeWrap` from `radioRenderNow`, and reads the real volume once with `getVolume()`), and hidden below 720px by CSS (phones cannot use the SDK).
- **Icons:** Phosphor web font from jsDelivr (regular and fill stylesheets in `index.html`).

---

## Status messages (toasts)

`showStatus(msg, type)` (ui.js) shows `"error"` and `"warn"` messages as a toast (`#toastHost`, a persistent `role="status"` live region at the bottom of the page; the toast is built with `textContent`, never parsed as HTML). One toast at a time: a new message replaces the current one, the same message again only re-arms its timer. Warnings go away after 6s, errors after 9s (`TOAST_MS`), hovering or focusing holds it, and the close button (`hideStatus()`) dismisses it. `"success"` dismisses the current toast (the problem it reported is over: e.g. playback resumed); plain progress text (`""`) is ignored. The interface itself (hero "Tuning...", Cancel button, now-playing row) shows loading and success state, so keep `showStatus` for failures, rate-limit notices (`spotifyLimitMessage()`, type `"error"`) and things the user must act on (type `"warn"`).

## PWA

`manifest.webmanifest` (standalone, `start_url` and `scope` `./`, theme and background `#0b0b0f`), the icons in `icons/` (a red record on the dark background; the maskable one keeps the disc inside the 80% safe zone) and `sw.js`, registered from `app.js` on https or localhost. The service worker is network first for every same-origin GET: a deploy is never hidden behind a stale copy, and the cache (`stm-shell-v1`) is only the fallback when the network fails (the shell opens offline, but nothing plays: Spotify and Last.fm are live). The manifest link uses `crossorigin="use-credentials"` and the shell files are cached one by one (a failure does not fail the install), because a Vercel preview behind Deployment Protection redirects unauthenticated requests to a login that has no CORS headers. It never touches `/api/` or other origins, and does not cache a page load that carries `?code=` (the Spotify redirect). Add new js/css files to its `SHELL` list. The theme-color meta follows the in-app theme. The Spotify redirect URI is the page's own origin and path, so an installed app needs no new registration, but the first sign-in inside the installed app should be tried on a real phone.
