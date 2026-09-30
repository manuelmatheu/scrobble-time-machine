# Time Travel in the Radio View: Design Spec

Date: 2026-09-30
Status: design approved in conversation, pending written-spec review
Builds on: `2026-09-30-library-radio-redesign-design.md` (Library Radio, branch `feature/library-radio`, PR #2)

## 1. Intent

**Outcome.** Every Time Travel mode (Random, Date, Artist, On This Day, Mood, Decade, Album, First Listen, Streak) plays inside the same view as Library Radio: hero with the current song, controls, your play counts, the artist bio, and Save as Playlist. Time Travel stops being a second, older-looking experience.

**Success criteria.**
- Launching any mode opens the radio view titled "Time travel" instead of filling the home view with an era panel and a track list.
- The mode's context (date or label, top artist, listening pace, and for Random the time slider) sits above the hero.
- The full list of the page's tracks replaces "Up next": clickable, per-row like button, scrobble date, and dimmed rows for tracks without a Spotify match.
- The artist bio and "You've listened to ..." panel work for time-travel tracks exactly as in the radio.
- A new Again button repeats the last mode with the same inputs.
- No page number is shown anywhere: not the spinning page card in Random, not "Page X of Y" on the slider, not in status messages.
- Entering either view no longer shows the previous song's progress while it says "Tuning...".
- Nothing about matching, auto-loading more tracks, liking, or saving changes behavior.

**Constraints.** Same as the Library Radio spec: vanilla HTML/CSS/JS, no build step, no modules, script order matters, tokens and 8px shape lock, no em-dashes in visible text, 11px minimum functional text, reduced motion respected.

**Out of scope.** Changing how any mode finds its tracks, changing the mode input controls on the home view, a radio-style endless stream for time travel, new Last.fm or Spotify calls beyond the bio and play-count lookups already added.

## 2. Decisions made

| Decision | Choice |
|---|---|
| Direction | Same radio view for Time Travel (not just a repaint) |
| Mode inputs | Stay on the home view |
| Page numbers | Removed everywhere, including Random |
| Test approach | Local static server plus the user's Chrome, then merge |

## 3. Design

### 3.1 One chokepoint

Every mode ends in `renderEraPanel` / `renderEraPanelFromTracks` followed by `fetchAndPlay` or `fetchAndPlayDirect`, which both call `matchAndPlay(tracks, page, tp, label)`. `matchAndPlay` is where the view switches: it calls `showRadioView("travel")` before rendering rows. No mode handler is rewritten.

### 3.2 View modes

`showRadioView(mode)` takes `"radio"` (default) or `"travel"`.

| Element | Radio | Travel |
|---|---|---|
| Title (`#radioTitle`) | Library radio | Time travel |
| Era panel (`#eraPanel`) | hidden | shown above the hero when a mode rendered one |
| Up next (`#radioUpNext` and its heading) | shown | hidden |
| Track list (`#trackListWrapper`) | hidden | shown below the info panel |
| Again button (`#radioAgainBtn`) | hidden | shown next to Home |
| Save as Playlist | in controls | in controls |

State: a new global `travelActive` (true while the travel view is showing). `radioStop()` remains the single "leave the view" function: it clears `radioActive` and `travelActive`, bumps `radioSession`, and calls `hideRadioView()`.

### 3.3 DOM changes

- `#eraPanel` and `#trackListWrapper` (with `#trackList`, `#matchCount`) move from the home view's `#timeTravel` section into `#radioView`, keeping their ids, so every existing function that writes to them keeps working. Order inside the radio view: top bar, era panel, hero, progress, controls, info panel, then either Up next (radio) or the track list (travel).
- `#savePlaylistBtn` keeps its current relocation into `#saveSlotRadio`; `#saveSlotTrackList` is removed.
- `#pagePicker` (the spinning page card) is removed from the home view.

### 3.4 Hero, info panel, and player hooks

- The hooks in `player.js` that call `radioRenderNow` (SDK state and polling path) and feed the radio progress bar run when `radioActive || travelActive`. `radioMaybeRefill` stays radio-only; travel keeps using `continueMatching` for its auto-loading.
- The info panel needs Last.fm names for the playing index. A new `radioInfoSource(idx)` returns `{ artist, track }` from `trackMeta[idx].lfmArtist/lfmTrack` (radio) or, when absent, from `currentTracks[idx]` (travel: Last.fm track objects with `artist["#text"]` or `artist.name`, and `name`). `radioInfoFor(idx)` uses it; its caching and failure behavior are unchanged.
- The existing rows, statuses, album-art swap, highlighting (`highlightNowPlaying`), `playFromTrack`, per-row hearts and `checkLikedTracks` are reused as they are. Row styling is brought in line with the radio rows (same tokens and radii; the row keeps number, cover, title and artist line, scrobble date, like button, match status).
- The bottom player bar stays hidden in both modes via `body.radio-mode`.

### 3.5 Again and errors

- `travelAgain()` calls `handleGo()`; the mode's inputs are still in the home view's DOM, so it repeats the same mode with the same inputs (for Random, a new random moment). Available only in the travel view.
- If `matchAndPlay` fails before playback starts (no matches, no device, expired token), `fetchAndPlay` / `fetchAndPlayDirect` call `radioStop()` so the user lands on the home view with the error in the status bar, as today. Errors raised earlier, inside a mode handler, never left the home view.
- Home in the travel view behaves like Home in the radio: `leaveRadio()` invalidates the session, then pauses playback.
- The Random slider keeps working inside the view: releasing it calls `loadPageFromSlider`, which re-enters `matchAndPlay` and refreshes the view (switching is idempotent).

### 3.6 Page numbers removed

- Home: delete the page card markup, its CSS, `animatePagePick`, and the `pagePicker` lines in `handleGoRandom`, `beginSession`, and `handleReset`. The "Spinning the wheel..." status becomes "Picking a random moment...".
- Slider label (`renderEraPanel`, `updateEraInfo`, `onSliderInput`): "Page N of M · P%" becomes "P% back in time". The slider itself, the "Now" and "First scrobble" ends, and the drag hint stay.
- Status messages: wording that mentions a page number is reworded to describe the moment instead (for example "Playing 14 tracks from March 13, 2012", "Found 5 Dreamy tracks", "Loading that moment..."). The Random status uses the era date that the era panel already computes.
- `playlistLabel` for Random changes from "Page N" to the era date, so saved playlists are named "Time Machine: March 13, 2012".

### 3.7 Stale progress fix

`showRadioView` (both modes) resets the hero to its empty state (title "Tuning...", no artist line, no cover, progress bar at 0, elapsed and duration at 0:00) before showing the view, so nothing from the previous song is visible while the first tracks load.

## 4. Files touched

| File | Change |
|---|---|
| `index.html` | Move era panel and track list into the radio view; add title id, Again button; remove page card and `saveSlotTrackList` |
| `css/style.css` | Era panel and track-list placement inside the radio view; row restyle; remove page-card styles |
| `js/config.js` | `travelActive` |
| `js/radio.js` | `showRadioView(mode)`, `hideRadioView`, `radioInfoSource`, `radioInfoFor` update, `travelAgain`, hero reset |
| `js/player.js` | `matchAndPlay` switches view and sets playlist label; hooks run for travel; failure paths leave the view |
| `js/ui.js` | Slider labels, `handleReset`, `animatePagePick` removal |
| `js/modes.js` | `handleGoRandom` and `beginSession` page-card lines; status wording |
| `tests/radio-engine.test.js` | `radioInfoFor` travel fallback |
| `CLAUDE.md`, `changelog.html`, `ROADMAP.md` | Document the unified view |

## 5. Verification

Automated (node): `radioInfoFor` returns bio and play counts from `currentTracks` when `trackMeta` has no entry; an index with neither yields null; the radio path is unchanged. Existing scripts keep passing.

Live, through the local server (`http://127.0.0.1:3000/`) and the user's Chrome, with the user not touching the tab:
1. Each of Random, Date, Artist, On This Day, Mood, Decade, Album, First Listen, and Streak opens the travel view with its context panel, hero, bio panel, and full track list; playback starts.
2. Clicking a row plays from it; the row highlights and the hero follows.
3. Auto-loading more tracks still works (matched count grows while skipping).
4. Again repeats the mode; Home pauses and returns to the home view; a failing mode (for example an artist with no history) returns to the home view with the error visible.
5. Random: the slider moves, releasing it reloads the view; no page number appears anywhere; the saved playlist name (checked by the name the app would use, not by saving) shows the date.
6. Radio still works, and entering either view shows no stale progress.
7. Light and dark themes, phone width, and reduced motion.

## 6. Risks

- **Moving the era panel and track list** changes where working code writes. Mitigated by keeping every id and function, and by the live test of all nine modes.
- **View switching from `matchAndPlay`** also happens on slider releases and could flicker. Mitigated by making `showRadioView` idempotent and testing the slider live.
- **Removing page numbers from statuses** touches strings in every mode handler. Mitigated by changing wording only, not control flow, and exercising each mode.
