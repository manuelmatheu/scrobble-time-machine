# DESIGN.md

The design of Scrobble Time Machine (STM): principles, tokens, components, screens and responsive rules.

**Source of truth.** `css/style.css` and `index.html` are what ships; this file describes them. The mockups live in the Design canvas ("Radio Home Redesign", https://claude.ai/artifact/RGMxpKGBicDSnLjYzvETMv). Where the two disagree, the code wins, unless this file says a mockup change is still pending (see "Not applied yet").

---

## 1. Principles

1. **Music first, chrome second.** One focused player card; everything else (artist info, queue) supports it.
2. **Dark by default, light as a full theme.** Both ship with the same structure; only tokens change.
3. **One column on phones, two columns when there is room.** Same components, rearranged. No separate "mobile app".
4. **Honest states.** Loading shows "Tuning..."; errors go to the status bar in plain words; no page numbers or technical jargon in the UI.
5. **Touch-safe.** Every interactive target is at least 44px tall; text meets WCAG AA contrast (checked by `tests/contrast.test.js`).
6. **Quiet motion.** Short transitions only; everything is switched off under `prefers-reduced-motion`.

---

## 2. Foundations

### Typeface

| Use | Font | Weights |
|---|---|---|
| UI text | **Barlow** (fallback Open Sans, Helvetica Neue, Arial) | 400 500 600 700 800 |
| Numbers (time, counts, row numbers) | **JetBrains Mono** | 400 600 700 |

Both load from Google Fonts in `index.html`.

| Role | Size / weight | Notes |
|---|---|---|
| Home headline | `clamp(28px, 6vw, 44px)` / 800, letter-spacing -1px, line-height 1.05 | 40px on wide desktop when connected |
| Now-playing title | 28px / 800, letter-spacing -0.6px | 26px on phones, wraps instead of truncating |
| Section heading ("Or time travel", "Up next") | 22px / 700 | |
| Station name | 16px / 700 | |
| Body | 14-16px / 400-500 | secondary copy uses `--text-secondary` |
| Mode card name | 15px / 700 | |
| Row title | 14px / 600 | artist line 12px |
| Eyebrow / small caps label | 12px / 700, uppercase, letter-spacing 1.5px, `--lastfm-red-text` | "NOW PLAYING", "LIBRARY RADIO" |
| Chip, helper text | 12px / 600 | |
| Controls (mood buttons, device button, Save as Playlist, status bar) | 13px / 600-700 | |

Nothing is smaller than **12px** (row numbers, dates and the footer included); `tests/design-system.test.js` checks it.

### Color tokens

Defined on `:root` (dark) and overridden under `[data-theme="light"]`. Never hardcode colors; use the variables.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg-primary` | `#0b0b0f` | `#f5f5f7` | page |
| `--bg-secondary` | `#111116` | `#ffffff` | cards, panels |
| `--bg-tertiary` | `#18181f` | `#eaeaed` | inputs, art placeholders, segmented control |
| `--bg-elevated` | `#1e1e27` | `#ffffff` | raised surfaces |
| `--border` | `#222230` | `#d4d4d8` | card and control borders |
| `--border-subtle` | `#1a1a25` | `#e4e4e7` | row dividers |
| `--text-primary` | `#e8e6e3` | `#18181b` | titles, active text |
| `--text-secondary` | `#b4b4bc` | `#52525b` | body |
| `--text-tertiary` | `#92929c` | `#5f5f68` | helper text, row artist |
| `--text-muted` | `#80808a` | `#65656e` | numbers, placeholders |
| `--lastfm-red` | `#d51007` | same | brand accent, primary button, progress |
| `--lastfm-red-text` | `#ff5a50` | `#c60f06` | accent as text (passes contrast on each theme) |
| `--lastfm-red-subtle` | `rgba(213,16,7,.08)` | `.06` | selected fills |
| `--spotify-green` | `#1DB954` | same | Spotify-only things (connect, badge, save playlist) |
| `--success` / `--error` / `--warning` | `#22c55e` / `#ef4444` / `#eab308` | same | match status marks |
| `--on-accent` | `#ffffff` | same | text on a red fill (primary button) |
| `--on-spotify` | `#0b0b0f` | same | text on a green fill (Connect Spotify) |
| `--spotify-green-subtle` / `--spotify-green-border` | `rgba(29,185,84,.08)` / `.25` | same | Spotify badge fill and border, Save as Playlist hover |
| `--shadow-float` | `0 12px 32px rgba(0,0,0,.35)` | `.12` alpha | floating lists only (autocomplete, device picker) |

The token lines are the first two lines of `style.css` (the contrast test reads them by line number). No hex or `rgba()` appears below them; `tests/design-system.test.js` fails if one does.

Rules: red is the accent for the app's own actions and highlights; green is reserved for Spotify. Red as text always uses `--lastfm-red-text`, never `--lastfm-red`. Selected = red border + `--lastfm-red-subtle` fill, never color alone (the radio dot / check also changes).

The dark theme adds a faint noise overlay (`body::before`, 3% opacity); it is removed in light.

### Shape, spacing, elevation

- **Radii:** cards and panels 16px; list panels (Up next, Tracks), station options, mode cards, segmented control, floating lists 12px; buttons, inputs, small controls 8px; album art in the player 12px, in rows 6px (both row families); chips and the play button 999px.
- **Spacing:** 4px base. Common gaps 6, 8, 10, 12, 14, 16, 20, 28. Card padding 28px (20px on phones). Page container 680px, 20px side padding.
- **Elevation:** flat. Depth comes from the surface ladder (`primary` < `secondary` < `tertiary`) and 1px borders. Shadows only on floating lists (`--shadow-float`, on `--bg-elevated`): the autocomplete box and the device picker.
- **Tap targets:** minimum 44px (`.btn-radio` 56px, play button 56px). A control that must look smaller (the disconnect x in the Spotify badge) keeps a 44px hit area with an invisible `::before`.

### Icons

Phosphor web font, regular and fill, from jsDelivr (`@phosphor-icons/web@2.1.1`). Icons are decorative and carry `aria-hidden="true"`; icon-only buttons have an `aria-label`. Key icons: vinyl-record (brand, Library), compass (Discover), shuffle (Mix), sparkle (new-music chip), clock (past chip), equalizer ("Playing now"), heart, microphone (artist photo placeholder).

### Motion

Tokens: `--dur-fast` (0.15s, hover and color/border/background changes) and `--dur-base` (0.2s, input borders). `fade-up` 0.3s for status messages, `overlayIn` 0.2s for the changelog, the progress fill width 0.25s linear, a 0.1s press scale on player buttons. Transitions name their properties, never `transition:all`. All animation and transitions are disabled by `prefers-reduced-motion: reduce`.

---

## 3. Components

**Naming.** `radio-*` classes belong to the player view (`#radioView`), which serves Library / Discover / Mix radio *and* Time Travel: the prefix means "player view", not "Library Radio". Style with classes, not ids (ids are JS hooks): the progress bar is `.progress-track` / `.progress-fill`, the volume slider `.volume-range`.

### Buttons
- **Primary** (`.btn-primary`): red fill, white text; hover lightens and lifts 1px.
- **Spotify** (`.btn-spotify`): green fill, dark text.
- **Ghost** (`.btn-ghost`): transparent, 1px border, secondary text.
- **Radio button** (`.btn-radio`): the large call to action, 56px tall, 12px radius, 18px/700. "Start Library radio" / "Start Discover radio" / "Start Mix radio"; when a radio is already running the same slot is a primary **Back to radio** plus a ghost **Start a new radio**.
- **Text button** (`.btn-text`): Home, Again; 44px tall, no chrome.
- **Disabled:** 40% opacity, `not-allowed` cursor.
- Every `.btn` is at least 44px tall.

### Text inputs (`.input-username`, `.mode-input-field`)
One spec: 44px min height, 10px/14px padding, 14px text, `--bg-secondary` fill, 1px border, 8px radius. Focus: red border plus a 3px `--lastfm-red-glow` ring (instead of the global outline). Selects use the same class with a caret.

### Mood / decade buttons (`.mood-btn`)
Choice chips inside a mode's inputs (Mood, Decade): 44px tall, 13px (12px on phones), bordered. Active: red border, red text, subtle red fill.

### Autocomplete (`.autocomplete-box`)
Artist suggestions under the artist field: a floating list on `--bg-elevated` with `--shadow-float`, 12px radius, 44px rows (name, scrobble count in mono). Hover and the keyboard-highlighted row (`.ac-active`) fill `--bg-tertiary`.

### Heart in list rows (`.heart-btn`)
44px button, muted outline heart; liked = filled heart in `--lastfm-red-text`. `aria-label="Like <track>"` and `aria-pressed` carry the state (`setHeartBtn()` in `player.js`); the player hearts (`#radioHeart`, `#radioHeartTitle`) set `aria-pressed` too.

### Theme toggle (`.theme-toggle`)
44px square in the header, 1.5px border, icon at 70% opacity (full on hover).

### Station picker (`.station-picker`)
Three full-width options stacked: Library, Discover, Mix. Each is a 64px-min card with an icon, a name, a one-line description and a radio dot on the right. Active: red border, subtle red fill, red icon and dot. It stays visible while a radio runs (it chooses the *next* radio; the running one is unaffected). The headline above it follows the picked station. Remembered in `localStorage` (`stm_station`).

### Mix balance (`.mix-balance` / `.seg`)
Only visible when Mix is picked. Label "How much is new" above a 3-option segmented control: **Mostly past** (3 past : 1 new), **Balanced** (1:1), **Mostly new** (1:3). Active segment: red border and subtle fill. Remembered (`stm_mix_balance`).

### Mode card (`.mode-card`)
Time Travel entry points: icon, name, one-line description; 3 columns (2 on phones). Selecting one reveals its input block below the grid. Active uses the same red-border treatment as station options.

### Source chip (`.radio-chip`)
A small pill that says why a track is playing. Red tint with a sparkle icon for new music ("Last.fm pick", "Similar to X"); neutral with a clock icon for tracks from your past ("From 2014"). Max width 170px in the hero, 160px in rows; text truncates with an ellipsis. It appears in the now-playing eyebrow row (right-aligned) and at the end of Up next rows (Discover and Mix only; Library shows no chip).

### Now-playing card (`.radio-now`)
- **Desktop / tablet:** a 224px-tall card. Cover 192px on the left; on the right the eyebrow row (NOW PLAYING + chip), title, artist/album, progress bar with elapsed and total time, and a controls row (heart, previous, play/pause, next, then the device button and volume; volume only while the Web Playback SDK plays here).
- **Phones (<=520px):** stacks. Full-width square cover, then the text block, progress, and centered controls (previous / play / next). The like heart moves beside the title; the controls row hides its own heart. The eyebrow row extends over the heart's reserved space so the chip's right edge lines up with the cover's right edge.
- **Play button:** 56px circle, `--text-primary` fill with `--bg-primary` glyph.
- **Progress:** 6px pill, red fill; clickable to seek.

### Artist panel (`.radio-info`)
Your play counts ("You have played X n times, and this track n times") and a four-line Last.fm bio with a "Read more on Last.fm" link. In Discover the stats line becomes the reason ("New to you. You have never played X. Picked because you listen to Y and Z."). On wide desktop (>=1100px) it becomes a card with a 148px artist photo from Spotify on the left (microphone placeholder when there is none). The panel hides when there is nothing to show.

### List rows (`.radio-row`, `.track-row`)
44px minimum, 10px/16px padding, 40px cover (6px radius), title 14px/600 and artist 12px/tertiary, hairline divider between rows. Up next rows are clickable (play from here, hover fills `--bg-tertiary`). The playing row in Time Travel has a subtle red fill and red title; unmatched rows are 40% opacity with a red cross, matched ones a green check (status classes `found` / `not_found` / `searching` / `skipped`, the names `setTrackStatus()` uses). In Time Travel the list ("Tracks") also holds the **Save as Playlist** button (green outline), which never appears in the radio.

### Home "playing" strip (`.radio-playing`)
Equalizer icon + "**Playing now** · title · artist" (or "Paused") in a `--bg-tertiary` pill, shown when a radio is running behind the home view.

### Status bar
Only errors (red) and warnings (primary text) are shown, above the content. Progress and success messages are not displayed; they clear what was there.

### Device picker (`.device-btn`, `.device-picker`)
Chooses the Spotify Connect device the music plays on. Two entry points open the same popover: a **Play on** row under the home card's buttons (icon, device name, caret) and a device button in the now-playing controls row (icon only while it plays in this browser, icon + name in red when another device is picked; on phones it is a full-width row under previous / play / next). The popover (`--bg-elevated`, 12px radius, 1px border, shadow like the autocomplete box) has a "PLAY ON" eyebrow with a labelled **Refresh** text button (the open list also looks again by itself every 4 seconds, and only redraws when something changed), one 48px row per device (type icon, name; the current one gets a subtle red fill, red text and a speaker icon; restricted devices are disabled), and one short line of helper text under the list (with other devices listed: "Missing a speaker? Play something on it from the Spotify app first."; with only this browser: it names Nest, Chromecast and Sonos and turns into a filled `--bg-tertiary` note). It opens below the button, or above when there is no room, and closes on outside click, Escape, scroll or resize. The pick is remembered (`stm_device`).

### Spotify badge
Green-tinted pill (`--spotify-green-subtle` / `--spotify-green-border`) "Spotify connected" with a small dot and an x to disconnect (20px visible, 44px hit area), in the header.

---

## 4. Screens

### Home (`#homeView`)
- **Not connected:** centered radio card (max 680px on desktop) with the headline, a short prompt, the station picker, the username field and **Connect Spotify**.
- **Connected, idle:** headline, `username · N scrobbles`, station picker (+ Mix balance when Mix), username field, **Start <Station> radio**. Below, "Or time travel": nine mode cards and the active mode's inputs.
- **Radio running (minimized):** same card, plus the "Playing now" strip; the button pair becomes **Back to radio** / **Start a new radio**.
- **Wide desktop (>=1100px) and connected:** two columns, the radio card at 420px on the left and the Time Travel grid on the right.

### Radio view (`#radioView`, Library / Discover / Mix)
Top bar: **Home** on the left, the station label (LIBRARY / DISCOVER / MIX RADIO) in small red caps on the right. Then the now-playing card, the artist panel and **Up next**. The first row after the current track can show a "Tuning..." placeholder while more tracks load. Returning home does not stop the music.

### Time Travel view
Same view with the label "TIME TRAVEL · <moment>", an **Again** button next to Home, and a full **Tracks** list (with match count and Save as Playlist) instead of Up next; no volume or context panel changes beyond that.

### Changelog overlay
Full-screen overlay with an iframe of `changelog.html`.

---

## 5. Responsive behavior

| Width | Behavior |
|---|---|
| **<= 520px** | Mode grid 2 columns; radio card padding 20px; now-playing card stacks (see above); buttons full width in `.controls`; header brand 16px; date column hidden in lists |
| **<= 720px** | Volume slider hidden (phones cannot use the SDK anyway) |
| **521-1099px** | One column, 680px container, now-playing card horizontal at 224px |
| **>= 1100px** | 1120px container. Home two columns (420px + rest). Radio / Time Travel two columns: player + artist panel (640px) on the left, the list as a panel of equal height on the right (min 468px). Up next rows share the panel height equally (`--upnext-rows`); the Tracks list scrolls inside and keeps the playing row visible. Artist photo shown |

---

## 6. Theming

- Default dark; toggle in the header sets `<html data-theme="light">` and is remembered (`localStorage` `stm_theme`). An inline script in `<head>` applies the stored theme before first paint.
- All component colors read tokens, so a new component works in both themes without extra CSS. Check new text/surface pairs against `tests/contrast.test.js`.

---

## 7. Accessibility

- Contrast: all text tokens meet AA on the three background tokens, in both themes (automated).
- Targets: at least 44px; the heart in the player is 44px.
- Semantics: real `<button>` elements; the station picker and Mix balance are `role="group"` with `aria-pressed` on options; icon-only buttons have `aria-label`; the radio view has `aria-label="Radio"`.
- Selection never relies on color alone (dot, border and fill change together).
- Focus: one global ring, `2px solid var(--lastfm-red-text)` at 2px offset, on every button, link, range input and `[tabindex]` under `:focus-visible`. Exceptions: text inputs (their red border and glow) and device picker rows (offset -2px so the scrolling list does not clip it).
- Toggle buttons expose their state with `aria-pressed` (station picker, Mix balance, hearts).
- Reduced motion respected.

---

## 8. Not applied yet / open decisions

- **Heart alignment on phones.** The mockups for Discover and Mix now put the like heart at the top, aligned with the song title. The app still centers it vertically on the text block. Pending.
- **Chip position on phones.** Right-aligned with the cover's right edge (applied, PR #8). Alternatives tried and rejected: chip directly after "NOW PLAYING"; chip on the artist line; no "NOW PLAYING" label; a compact player without the large cover.
- **Mix legend.** The Mix mockup shows a small "New / From your past" legend in the Up next header; the app does not have it yet.
- **Library radio chip.** Library shows no source chip; adding one ("From YEAR") would need a decision on the eyebrow row.
- **Long names.** Chips truncate at 160-170px; very long artist names make the phone title wrap onto several lines (intended). Check with real data when changing these widths.
- **Mockup-only copy.** Placeholders in the canvas (`[Track title]`, `[ARTIST]`, `[N]`) stand for real data.
