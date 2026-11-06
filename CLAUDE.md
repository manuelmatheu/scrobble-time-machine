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
- `motion`: no overshoot in `cubic-bezier` easings, `@keyframes` animate only `opacity` and `transform`, and the `prefers-reduced-motion` block turns every animation and transition off.
- `session-api`: `api/session.js` (store stubbed). `handoff`: `js/handoff.js` (note, roles, driver, follower, takeover, phone top-up).
- `auth`: the setup banner rule (`stmSetupNeeded`), the login `state` check and cancel, and the message for an account the owner has not added.
- `no-page-numbers`: no page numbers in status or error messages. `no-time-travel`: the Time Travel modes, track list and era panel stay removed.

- **Run locally:** serve the folder with any static file server (`/api/lfm-station` only exists on Vercel or `vercel dev`; without it Discover falls back to the similar-artist source) (e.g. `npx serve -l 3000`) and open `http://127.0.0.1:3000/` (Spotify does not accept `localhost` redirect URIs). Opening `index.html` directly via `file://` will break Spotify PKCE auth, since `SPOTIFY_REDIRECT_URI` (`js/config.js`) is derived from `window.location.origin + window.location.pathname` and must exactly match a redirect URI registered on the Spotify app.
- **Verify changes:** the node scripts cover only the radio logic and the stylesheet rules; everything else is manual. Exercise the flow in a browser -- connect Spotify, start each station (Library in Songs and Moments, with and without a year), confirm playback, Up next, Next moment and Save this moment still work. For layout work, a headless Chromium with the Spotify and Last.fm requests mocked (Playwright `route`) is enough to start a radio and measure; the Spotify SDK script does not load there, so the app runs in polling mode.
- API keys (`LASTFM_API_KEY`, `SPOTIFY_CLIENT_ID`) live in `js/config.js`, not `index.html`, with `KEYS_HOSTS` (the domains they are registered for): anywhere else the page shows "Setup required" (`stmSetupNeeded()`). Others self-host their own copy (Spotify Development Mode: 5 users); the README's Setup section is their guide, so keep it in step with config, env vars and functions.
- `vercel.json` only sets security headers (no framing, nosniff, referrer policy).

- **Workflow:** one contributor. Production (https://stm-lastfm.vercel.app/) deploys from `main`; a Vercel preview (stm-preview.vercel.app) is pointed at the branch being tested. Work happens on a `claude/...` branch, is tried on the preview, and goes to `main` through a pull request that is squash-merged. After a merge, restart the working branch from `origin/main` (never stack new commits on merged history).

---

## Architecture

- Scripts load as plain globals in the `index.html` order (no modules; `js/handoff.js` loads after `connect.js`, before `radio.js`). The Spotify SDK script must load first so `spotify.js` can set `window.onSpotifyWebPlaybackSDKReady` before the SDK calls it.
- `sw.js` is network first (never hides a deploy) and caches only the same-origin shell. Add a new js/css file to its SHELL list, or the offline fallback lacks it (a file that cannot be fetched is skipped, not fatal, so a typo there fails silently); bump `CACHE` to drop an old shell.
- Two backend pieces, both Vercel functions: `api/lfm-station.js` (proxy for Last.fm's "recommended" station, for CORS) and `api/session.js` (the hand-off note store: Upstash Redis over REST, env vars `KV_REST_API_URL` / `KV_REST_API_TOKEN`; 503 without them).
- `docs/architecture.md`: detailed behavior behind the summaries below (auth, SDK, spotifyPlay, radio, seams, views). `docs/superpowers/`: design notes and plans. `ROADMAP.md`: shipped and planned work, newest first. `changelog.html`: release notes for the in-app overlay.
- `DESIGN.md` is the design reference (tokens, components, screens, breakpoints); code wins over the canvas mockups.

---

## Spotify and playback (summary)

Full detail, with the reasons behind each rule: `docs/architecture.md`. Read the relevant section there before changing auth, `spotifyPlay()`, the SDK listeners, the radio engine or the seams.

- **Scopes** (`SPOTIFY_SCOPES`, `js/config.js`): `streaming` for the SDK, `user-library-*` for likes, `user-top-read` for Discover (an older token gets a 403 there; Discover then plays the Last.fm station only and asks the user to reconnect).
- **Auth:** PKCE (`initiateSpotifyAuth()` / `exchangeCodeForToken()` / `refreshSpotifyToken()` / `getSpotifyToken()`). Tokens live in `localStorage`; the code verifier and a spare copy of the username go through `sessionStorage` for the round trip, with a copy in `localStorage` too because an installed app (PWA) can come back from Spotify in a fresh browsing context (the verifier is deleted after the exchange).
- **SDK:** `initSDKPlayer()` can be called from the SDK-ready callback and from the auth callbacks in `app.js`; it guards on `window._stmPlayer`. Its `ready` / `not_ready` / `authentication_error` listeners stop and start polling and re-transfer playback after a reconnect (`sdkNeedsRetransfer`).
- **Who is playing:** every SDK-driven decision goes through `sdkPlaying()` (`sdkReady && !playbackDeviceId`), not `sdkReady`. When it is true, `player_state_changed` -> `onSDKStateChange()` drives the UI; otherwise `pollNowPlaying()` reads `/me/player` every `POLL_INTERVAL` (5s) and follows the device the music moved to (`followPlaybackDevice()`).
- **Two windows (or another app takes the music):** the SDK sends this window a null state; `sdkLostPlayback()` follows the music only if it is this session's own tracks (moved to a speaker). Anything else (another STM window, another app, nothing playing) calls `radioPausedElsewhere()`: `sdkInactive`, a paused look, no seam re-issues, and a warn toast when something else plays. It never mirrors what plays there. Play, Next and Previous then call `radioResumeHere()`, which plays this window's own queue on this browser from where it stopped (the SDK's `togglePlay` does nothing on a device that is not the active one). The window that takes over makes the other one inactive in turn. A phone has no player of its own, so `spotifyPlay()` never plays on another STM window's player (a device named `STM_PLAYER_NAME` that is not ours): it uses the phone's Spotify app (device type Smartphone) or asks the user to open Spotify; and `onSDKStateChange()` treats a song that is not in this window's queue, arriving after one of ours that was not the last we sent, as someone else's music on this player (autoplay after our last song is not that).
- **`spotifyPlay(token, uris, opts)`:** caps at 100 URIs. With the SDK: transfer, then turn shuffle and repeat off, then play with `device_id`. Otherwise it picks a device (the followed one, then the active one, then any). Shuffle and repeat persist on the user's account and would reorder or loop the queue, so every full play resets them. `{quick:true}` (used at seams) sends a single `play` request.
- **Connect:** the "Play on" picker is back (v2.12, `js/connect.js`): the Playing on bar under the player, a device list (dropdown, or bottom sheet below 720px), a Home "Plays on" row and a phone strip. The bar shows the device Spotify reports (while a radio runs, two empty readings show "Checking what's playing…", or with a followed device gone and the SDK ready, the last song paused here). `followPlaybackDevice()` (`player.js`) still follows a session moved to another device from the Spotify app, keeping `playbackDeviceId` in memory only. `/me/player/devices` lists only cloud-registered devices; Sonos is restricted (listed greyed out). Detail: `docs/architecture.md`.
- **Hand-off** (`js/handoff.js`, `api/session.js`; detail in `docs/architecture.md`): the window that drives a radio writes a session note (songs, moments, state) keyed by Spotify user id; other windows and the phone follow it (`radioFollower()`: shows the radio, never fills or seams, controls are a remote). A driver silent for 3 minutes, or one that released on `pagehide`, is taken over. A phone driver (no browser player) keeps `PHONE_TOPUP` (10) songs queued after the current one. The hand-off turns off for the page, silently, only when the store is absent (a 503, or the page's first call fails); after the store has answered once, a failed call is skipped and retried (off after 3 in a row), and a 401 is skipped.
- **Search:** `spotifySearch()` tries `track:X artist:Y` first, then a plain query whose hit must pass `spotifyLooseMatch` (otherwise an unrelated song plays). Only final results are cached in `searchCache`; rate-limited or failed lookups are not.
- **API wrappers:** `spGet` / `spPut` / `spDelete` refresh the token and retry on 401; pass a `null` body for query-string-only endpoints.
- **Liked songs:** `/me/library/contains|PUT|DELETE ?uris=` (see Quirk 8); `likedSet` holds bare track IDs. **Save playlist:** `POST /me/playlists`, named `"Time Machine: " + label`; only Save this moment (Library in Moments) uses it.

## Radio (summary)

- **Stations:** Library (your scrobbles: `getLastFmScrobbleAt()` with `limit=1` makes `page` an index into the history; options How it plays = Songs | Moments and When = every year | one year, see below), Discover (Last.fm station via `/api/lfm-station` plus artists similar to the user's top artists, each candidate checked first (`discoverVet()`) to drop songs already played or saved), and Mix (both, in the `MIX_PATTERNS` balance). `radioStation` is what the station tabs show; `radioActiveStation` is what the running session plays (likewise `radioHow` / `radioActiveHow` and `radioYear` / `radioActiveYear`).
- **Library options:** One year passes `radioRange` (`radioYearRange()`) as `from`/`to`, and `radioTotal` becomes that year's count, so positions stay inside it. Moments: `momentCollectBatch()` fetches 30 scrobbles around a random position and `radioMomentFromTracks()` keeps the run around it (no silence over 2 hours, oldest first, at most 15); each pick carries `trackMeta.moment`. The moment panel (`#radioMoment`) has Save this moment and Next moment (`radioNextMoment()`, which fetches the next moment when none is queued: `radioJumpFrom`).
- **Engine:** `radioFill()` -> `startRadio()` (plays after the first match; the rest of the queue fills in behind it) -> `radioMaybeRefill()` on every track change -> `continueRadio()`. Every start or stop bumps `radioSession`, and in-flight fills bail when it changes.
- **Seams:** a re-issue restarts the stream, so new tracks are swapped in near the end of the last track sent (`radioContextLastUri`): `radioMaybeSeam()` (SDK, 250ms timer) or `radioRemoteTick()` (another device, extrapolated from `remoteNow`). `radioUnsentUris()` is derived from the data, so a lost flag cannot strand tracks; `radioRecoverRunOff()` catches a missed swap.
- **Views:** `#homeView` shows either `#landing` (no Spotify session: username, then Connect Spotify; `showLanding()` / `landingSync()` in `ui.js`, its field mirrors `#usernameInput`) or `#homeCard` (connected: every option); `updateSpotifyUI()` switches them, and a stored refresh token skips the landing at load. `#radioView` (`showRadioView()`). At 1100px and up the radio view has two columns and at least 8 Up next rows, as many as fit the panel at a fixed 51px each (6 below); the home card stays centered at 680px. Home (`radioMinimize()`) only hides the view; the session keeps running. The hero and info panel only follow tracks of the current session (`uriToIndices`).
- **Toasts:** `showStatus(msg, "error" | "warn")` is only for failures and things the user must act on; `"success"` dismisses the current toast, and plain progress text is ignored. The UI itself shows loading state.

---

## Key Quirks and Gotchas

1. **Use `/v1/me/playlists` not `/v1/users/{id}/playlists`** -- the user-id endpoint returns 403 in dev mode even with correct scopes. The `/me/` endpoint always works.

2. **Unicode box-drawing characters in HTML comments cause tool failures** -- use ASCII-only comments in HTML (e.g., use `===` separators, not `═══`).

3. **Spotify tokens live in `localStorage`, not `sessionStorage`** -- intentional (v2.3+), so a reconnect isn't needed every time a tab closes. Only the PKCE code verifier and a spare copy of the Last.fm username use `sessionStorage` (each also has a short-lived copy in `localStorage` for an installed PWA, see Auth). Don't revert the token storage to `sessionStorage` without checking why it was changed (commit `bd8354c`).

4. **`pollNowPlaying()` only runs when `!sdkPlaying()` or this window is a hand-off follower** -- first line is `if ((sdkPlaying() && !radioFollower()) || _pollBusy) return;`. When the SDK is the player, `player_state_changed` events handle all updates; when the session was moved to another device (`playbackDeviceId` set by `followPlaybackDevice()`), polling does, even though `sdkReady` is true.

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

## Current Version: v2.12

Bump the version only for a release (a new feature set or a user-visible change worth a changelog headline), not for every fix; small changes ride in the current version's changelog and `ROADMAP.md` entry. A bump touches three places: the version-history comment at the top of `index.html`, the footer link text in `index.html`, and the changelog opened by `openChangelog()` (`js/ui.js`; content in `changelog.html`). `ROADMAP.md` holds planned work; `docs/superpowers/` holds design notes.