# Library Radio + Radio-first Redesign: Design Spec

Date: 2026-09-30
Status: approved in conversation, pending written-spec review

## 1. Intent

**Outcome.** Scrobble Time Machine becomes radio-first. One action, "Start radio", plays an endless stream of tracks drawn at random from a user's entire Last.fm scrobble history (for example one from page 200, the next from page 5019, then page 1039), matched to Spotify and played in the browser. This replaces the role of Last.fm's library station, whose Spotify connection no longer works. The existing time-travel modes stay, but move to a secondary position.

**For whom.** The app owner and any Last.fm user who connects Spotify (Premium for SDK playback, as today).

**Success criteria.**
- From a connected home screen, one click starts playback within a few seconds.
- Every queued track comes from an independent uniformly random point in the user's history. No track repeats within a session.
- Playback never runs dry: the queue tops up before it empties.
- All existing modes, liking, and save-as-playlist keep working.
- The UI is cohesive across dark and light themes and meets WCAG AA contrast for text.

**Constraints (from CLAUDE.md).** Vanilla HTML/CSS/JS, no build step, no modules, script load order matters, no test suite (manual verification in a browser served over HTTP). Spotify tokens stay in `localStorage`. Use the `/v1/me/...` endpoints already in use.

**Out of scope.** Unique-track ("deep cuts") sampling via `user.gettoptracks`, a fixed-batch radio mode, changing Spotify auth or scopes, server-side components.

## 2. Decisions made

| Decision | Choice |
|---|---|
| Scope | Full visual redesign, radio-first |
| Radio behavior | Endless stream, top-up as you listen |
| Home direction | B: album-art mosaic, headline, one red CTA, time travel as secondary chips |
| Mosaic before Spotify connect | Colored placeholder tiles; real covers after connect |
| Sampling | One random scrobble per request (`limit=1`, random `page`) |

## 3. Engine: `js/radio.js`

New file, loaded after `player.js` and before `modes.js`. Single purpose: keep the playback queue supplied with random library tracks.

### 3.1 Data flow

1. **Start.** `startRadio()` calls `getLastFmTotalPages()` (existing) to get `totalScrobbles`. Sets radio mode state.
2. **Pick.** `pickRandomScrobble(user, total)` calls `user.getrecenttracks` with `limit=1` and `page` = random integer in `[1, total]`. Skips a result flagged `@attr.nowplaying`. Returns `{ artist, track, album, page, year }`. Requests run 4 to 5 concurrently to stay under Last.fm's rate limit.
3. **Dedupe.** Skip any pick whose normalized `artist|track` key is already in the session's `radioSeen` set.
4. **Match.** Picks go through `smartMatch()` and `registerUri()` (existing). A pick with no Spotify match is silently replaced by another pick, up to a bounded number of attempts per refill.
5. **Play.** The first ~15 matched tracks go to `spotifyPlay()` (existing; handles SDK device and disables shuffle).
6. **Top up.** The "fewer than 2 tracks left" check in `onSDKStateChange()` and `pollNowPlaying()` calls `continueRadio()` when radio mode is active (instead of `continueMatching()`). `continueRadio()` fetches and matches ~10 more picks and appends them to the Spotify queue and to `matchedUris` / `allTrackCount`.

### 3.2 Why `limit=1` with a random page

`page` is a 1-based index into the user's scrobbles when `limit=1`, so `[1, totalScrobbles]` is exactly uniform over history and each response is tiny. The current `getLastFmPage()` would download 50 tracks to use one.

### 3.3 State

New globals in `config.js`: `radioActive` (bool), `radioSeen` (Set), `radioTotal` (number), `radioRefilling` (bool, guards concurrent refills). Reset by `handleReset()` and when leaving radio.

Per-track metadata `page` and `year` is stored alongside each track (for example `trackMeta[index]`) so the UI can show "Page 5,019 of 48,213, 2017".

### 3.4 Failure handling

- Last.fm error or rate limit: short backoff and retry. After 3 consecutive failures, show a status message ("Last.fm is slow, retrying") and keep playing from the existing queue.
- Library under ~200 scrobbles: show a notice; dedupe may exhaust unique tracks, in which case the stream stops refilling and says so.
- Spotify search errors follow existing `spotifySearch()` behavior (rate-limited and error results are not cached).

### 3.5 Unchanged

Time-travel modes, `saveAsPlaylist()`, liked-songs logic, SDK init and listeners, auth. Save-as-playlist works on radio sessions because `matchedUris` and `allTrackCount` keep growing.

## 4. UI

### 4.1 Design read and dials

Personal music app for a single listener, dark radio-dial language, native CSS tokens, keep Barlow and the existing red/green palette. `DESIGN_VARIANCE 5`, `MOTION_INTENSITY 5`, `VISUAL_DENSITY 4`.

### 4.2 Home (Spotify connected)

- Mosaic of 8 tiles at the top (4 by 2). Placeholder colored tiles before connect; after connect, filled with Spotify covers for random library tracks.
- Headline: "Your library, shuffled across every year."
- Username and scrobble count on one line.
- One red primary button: "Start radio". When Spotify is not connected, "Connect Spotify" takes its place.
- "Time travel" heading (sentence case, 13px or larger) above chips for the existing modes (Random page, Date, On this day, Artist, Mood, Decade, and overflow). A chip reveals that mode's inputs inline and uses the existing handlers.
- Header: app name left; Spotify connection state right (the only status dot, since it carries real state) with the existing disconnect control.

### 4.3 Radio running

- "Library radio" title and a back-to-home control.
- Now-playing hero: cover (110px), title, then artist and album on the next line, and a red monospace line "Page 5,019 of 48,213, 2017".
- Progress bar and controls: like (heart), previous, play/pause, next, Save (existing `saveAsPlaylist()`).
- "Up next" list: each row shows title, artist on the next line, and a `p.N` page tag; the last row reads "Tuning..." while a pick is in flight. The "Tuning" page number rolls like the existing page-picker animation (motivated: shows a fetch in progress).
- The existing bottom player bar is folded into this screen in radio mode. In time-travel mode the existing track list and player bar are unchanged.

### 4.4 Visual system

- **Tokens.** Keep the existing CSS custom properties. Raise `--text-tertiary` and `--text-muted`, which fail contrast today. Add a lighter red token (about `#ff5a50` on dark) for small red text; keep `#d51007` for fills and large text.
- **Theme lock.** Dark default, light via `[data-theme="light"]`, both tested. Sections do not invert.
- **Shape lock.** 8px radius for buttons, inputs, tiles, and cover art; mode chips fully round. No other radii.
- **Type.** Barlow; minimum 11px for functional text, 14px or larger for body; red page numbers in JetBrains Mono.
- **Copy.** No em-dashes anywhere in visible text. One separator per line maximum.
- **Icons.** Replace Unicode glyphs with Phosphor Icons loaded from a CDN as a web font (`@phosphor-icons/web` via jsDelivr). One icon family.
- **Motion.** Fade/slide on track change, page-number roll for "Tuning", press feedback on buttons. Everything collapses to static under `prefers-reduced-motion`. No `window` scroll listeners.
- **Layout.** Single column, `min-height: 100dvh`, `max-width` about 680px, 16px side gutters on mobile. Explicit narrow-screen rules: the mosaic becomes 4 by 2 with smaller gaps and the chips wrap.

## 5. Files touched

| File | Change |
|---|---|
| `js/radio.js` | New: engine (section 3) |
| `js/config.js` | Add radio state globals |
| `js/player.js` | Route top-up to `continueRadio()` in radio mode; store page/year metadata |
| `js/ui.js` | Render home mosaic, radio hero, up-next list, mode chips |
| `js/app.js` | Wire Start radio, chips, back-to-home |
| `js/modes.js` | Mode handlers reused as-is; entry moves to chips |
| `index.html` | New home and radio markup, `radio.js` script tag, Phosphor CDN link |
| `css/style.css` | Token updates and new component styles |
| `CLAUDE.md` | Document Library Radio, new files and state |

Script order becomes: SDK, `config.js`, `spotify.js`, `lastfm.js`, `ui.js`, `player.js`, `radio.js`, `modes.js`, `app.js`.

## 6. Verification (manual, in a browser over HTTP)

1. Connect Spotify, enter a username, press Start radio: playback starts and the hero updates.
2. Confirm every queued track shows a different page number and none repeats over a long session (let 30+ tracks play).
3. Let the queue run low: confirm it tops up without a gap.
4. Skip quickly several times: confirm no stall and no duplicate refill (`radioRefilling` guard).
5. Like a track, then Save as playlist: confirm the playlist contains the radio tracks.
6. Run each time-travel mode from the chips: behavior matches the current app.
7. Throttle or block Last.fm: confirm the retry message and that playback continues from the queue.
8. Toggle light and dark themes and view at phone width; check contrast and no horizontal scroll.
9. Enable reduced motion: confirm animations stop.

## 7. Risks

- Last.fm rate limits under concurrent picks: mitigated by 4 to 5 concurrent requests and backoff.
- Lower Spotify match rate for obscure tracks: mitigated by silent replacement picks.
- Large visual change touching most of the UI files: mitigated by reusing existing handlers and keeping the engine isolated in `radio.js`.
