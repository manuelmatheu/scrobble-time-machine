# DESIGN.md

The design of Scrobble Time Machine (STM): principles, tokens, components, screens and responsive rules.

**Source of truth.** `css/style.css` and `index.html` are what ships; this file describes them. The mockups live in the Design canvases ("Radio Home Redesign", https://claude.ai/artifact/RGMxpKGBicDSnLjYzvETMv, and "Time Travel into Radio" for the Library options and Moments, https://claude.ai/artifact/FxeAUu2yox3QMPWRoxfPbh). Where the two disagree, the code wins, unless this file says a mockup change is still pending (see "Not applied yet").

---

## 1. Principles

1. **Music first, chrome second.** One focused player card; everything else (artist info, queue) supports it.
2. **Dark by default, light as a full theme.** Both ship with the same structure; only tokens change.
3. **One column on phones, two columns when there is room.** Same components, rearranged. No separate "mobile app".
4. **Honest states.** Loading shows "Tuning..."; errors and warnings appear as a toast in plain words; no page numbers or technical jargon in the UI.
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
| Section heading ("Up next") | 22px / 700 | |
| Moment label ("Tuesday, March 11, 2014 · evening") | 20px / 700, letter-spacing -0.3px | |
| Station name | 16px / 700 | |
| Body | 14-16px / 400-500 | secondary copy uses `--text-secondary` |
| Row title | 14px / 600 | artist line 12px |
| Eyebrow / small caps label | 12px / 700, uppercase, letter-spacing 1.5px, `--lastfm-red-text` | "NOW PLAYING", "LIBRARY RADIO" |
| Option label | 12px / 700, uppercase, letter-spacing 1.5px, `--text-tertiary` | "HOW IT PLAYS", "WHEN", "THIS MOMENT" |
| Chip, helper text | 12px / 600 | |
| Controls (segmented options, Save this moment, toasts) | 13px / 600-700 | |

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
| `--spotify-green-subtle` / `--spotify-green-border` | `rgba(29,185,84,.08)` / `.25` | same | Spotify badge fill and border, Save this moment hover |
| `--shadow-float` | `0 12px 32px rgba(0,0,0,.35)` | `.12` alpha | floating lists only (toasts) |

The token lines are the first two lines of `style.css` (the contrast test reads them by line number). No hex or `rgba()` appears below them; `tests/design-system.test.js` fails if one does.

Rules: red is the accent for the app's own actions and highlights; green is reserved for Spotify. Red as text always uses `--lastfm-red-text`, never `--lastfm-red`. Selected = red border + `--lastfm-red-subtle` fill, never color alone (the radio dot / check also changes).

The dark theme adds a faint noise overlay (`body::before`, 3% opacity); it is removed in light.

### Shape, spacing, elevation

- **Radii:** cards and panels 16px; list panels (Up next), station options, the Library options box, segmented control, the year list, floating lists 12px; buttons, inputs, small controls 8px; album art in the player 12px, in rows 6px (both row families); chips and the play button 999px.
- **Spacing:** 4px base. Common gaps 6, 8, 10, 12, 14, 16, 20, 28. Card padding 28px (20px on phones). Page container 680px, 20px side padding.
- **Elevation:** flat. Depth comes from the surface ladder (`primary` < `secondary` < `tertiary`) and 1px borders. Shadows only on floating things (`--shadow-float`): the toasts.
- **Tap targets:** minimum 44px (`.btn-radio` 56px, play button 56px). A control that must look smaller (the disconnect x in the Spotify badge) keeps a 44px hit area with an invisible `::before`.

### Icons

Phosphor web font, regular and fill, from jsDelivr (`@phosphor-icons/web@2.1.1`). Icons are decorative and carry `aria-hidden="true"`; icon-only buttons have an `aria-label`. Key icons: vinyl-record (brand, Library), compass (Discover), shuffle (Mix), sparkle (new-music chip), clock (past chip), equalizer ("Playing now"), heart, microphone (artist photo placeholder).

### Motion

Tokens: `--dur-fast` (0.15s, hover and color/border/background changes), `--dur-base` (0.2s, input borders and exits), `--dur-slow` (0.35s, entrances and the track-change moment), and the curves `--ease-out-quart` / `--ease-out-expo` (no bounce or overshoot). Motion only carries state, with opacity and transform only:
- the hero art scales in and the title and artist rise in a short stagger (`art-in`, `hero-in`, ease-out-expo) when the track changes, and only a track that was not in Up next before slides in (`row-in`), never the first fill;
- the radio view, home view, Library options, moment panel and artist panel fade in when they appear (CSS animations that restart on `display`); the changelog overlay also has a 0.15s exit;
- the cover placeholder pulses while the image loads (`.loading`, or no `src` yet) and the home card's equalizer (`.eq`) dances while playing and freezes when paused; the volume speaker swaps between off, minimum, normal and loud (`radioVolumeIcon()`), without animation;
- the like heart pops (`heart-pop`), buttons scale to 0.98 on press, the Tuning row pulses as a skeleton, toasts use `--ease-out-quart`.
The progress fill width stays 0.25s linear. Transitions name their properties, never `transition:all`. All animation and transitions are disabled by `prefers-reduced-motion: reduce`, and JS-timed exits (`closeChangelog()`, `removeToast()`) skip their wait then. `tests/motion.test.js` checks the curves, the keyframe properties and the reduced-motion block.

---

## 3. Components

**Naming.** `radio-*` classes belong to the player view (`#radioView`), which serves Library / Discover / Mix radio: the prefix means "player view", not "Library Radio". Style with classes, not ids (ids are JS hooks): the progress bar is `.progress-track` / `.progress-fill`, the volume slider `.volume-range`.

### Buttons
- **Primary** (`.btn-primary`): red fill, white text; hover lightens and lifts 1px.
- **Spotify** (`.btn-spotify`): green fill, dark text.
- **Ghost** (`.btn-ghost`): transparent, 1px border, secondary text.
- **Radio button** (`.btn-radio`): the large call to action, 56px tall, 12px radius, 18px/700. "Start Library radio" / "Start Discover radio" / "Start Mix radio"; when a radio is already running the same slot is a primary **Back to radio** plus a ghost **Start a new radio**.
- **Text button** (`.btn-text`): Home, Again; 44px tall, no chrome.
- **Disabled:** 40% opacity, `not-allowed` cursor.
- Every `.btn` is at least 44px tall.

### Text input (`.input-username`)
44px min height, 10px/14px padding, 14px text, `--bg-secondary` fill, 1px border, 8px radius. Focus: red border plus a 3px `--lastfm-red-glow` ring (instead of the global outline).

### Theme toggle (`.theme-toggle`)
44px square in the header, 1.5px border, icon at 70% opacity (full on hover).

### Station picker (`.station-picker`)
Three full-width options stacked: Library, Discover, Mix. Each is a 64px-min card with an icon, a name, a one-line description and a radio dot on the right. Active: red border, subtle red fill, red icon and dot. It stays visible while a radio runs (it chooses the *next* radio; the running one is unaffected). The headline above it follows the picked station. Remembered in `localStorage` (`stm_station`).

### Library options (`.library-options`)
Only visible when Library is picked, in a `--bg-tertiary` box (12px radius, 16px padding) under the station picker. Two blocks, each an option label (12px caps, tertiary), a segmented control (`.seg` on `--bg-secondary`) and a line of help (13px, tertiary) that changes with the choice:
- **How it plays:** **Songs** ("One song at a time, each from a different day of your history.") or **Moments** ("A stretch of what you played back then, in the order you played it. When it ends, the radio jumps to another moment."). Remembered (`stm_library_how`).
- **When:** **Every year** or **One year**; One year shows the year list (`.lib-year`, a native select, 50px tall, red border, mono 15px) from the year of the first scrobble to today. Remembered (`stm_library_year`).
The headline follows them: "Your library, shuffled across every year.", "Your 2014, shuffled.", "Your past, one moment at a time.", "Back in 2014, as you played it."

### Mix balance (`.mix-balance` / `.seg`)
Only visible when Mix is picked. Label "How much is new" above a 3-option segmented control: **Mostly past** (3 past : 1 new), **Balanced** (1:1), **Mostly new** (1:3). Active segment: red border and subtle fill. Remembered (`stm_mix_balance`).

### Source chip (`.radio-chip`)
A small pill that says why a track is playing. Red tint with a sparkle icon for new music ("Last.fm pick", "Similar to X"); neutral with a clock icon for tracks from your past ("From 2014" for Library songs and the past half of a Mix; the moment's date, "Mar 11, 2014", in Moments). Max width 170px in the hero, 160px in rows; text truncates with an ellipsis. It appears in the now-playing eyebrow row (right-aligned) and at the end of Up next rows (Library, Discover and Mix).

### Now-playing card (`.radio-now`)
- **Desktop / tablet:** a 224px-tall card. Cover 192px on the left; on the right the eyebrow row (NOW PLAYING + chip), title, artist/album, progress bar with elapsed and total time, and a controls row (heart, previous, play/pause, next, then the device button and volume; volume only while the Web Playback SDK plays here).
- **Phones (<=520px):** stacks. Full-width square cover, then the text block, progress, and centered controls (previous / play / next). The like heart moves beside the title, centered on its first line (the eyebrow row keeps a 24px minimum height so it sits at the same place with or without a chip); the controls row hides its own heart. The eyebrow row extends over the heart's reserved space so the chip's right edge lines up with the cover's right edge.
- **Play button:** 56px circle, `--text-primary` fill with `--bg-primary` glyph.
- **Progress:** 6px pill, red fill; clickable to seek.

### Artist panel (`.radio-info`)
Your play counts ("You have played X n times, and this track n times") and a four-line Last.fm bio with a "Read more on Last.fm" link. In Discover the stats line becomes the reason ("New to you. You have never played X. Picked because you listen to Y and Z."). On wide desktop (>=1100px) it becomes a card with a 148px artist photo from Spotify on the left (microphone placeholder when there is none). The panel hides when there is nothing to show.

### Moment panel (`.radio-moment`)
Library in Moments only, between the now-playing card and the artist panel: a 16px-radius card with THIS MOMENT, the moment label ("Tuesday, March 11, 2014 · evening"), a line with the songs and times ("11 songs you played between 21:04 and 21:52, in that order.") and two buttons: **Save this moment** (green outline, `.btn-save-playlist`, becomes "Saved! Open") and **Next moment** (ghost; disabled only while it is fetching the next moment or when there is nothing left). Full-width stacked buttons on phones.

### List rows (`.radio-row`)
44px minimum, 10px/16px padding (5px/16px in the wide list panel, where a row is 51px with its divider and the list shows as many as fit), 40px cover (6px radius), title 14px/600 and artist 12px/tertiary, hairline divider between rows. Up next rows are clickable (play from here, hover fills `--bg-tertiary`). In Moments the first song of the next moment has a stronger line above it (`.moment-start`, an inset 1px `--text-muted` line) and every row's chip shows its moment's date. The canvas showed a "Next moment" header row instead; it was not used because the wide list gives every row the same height.

### Home "playing" strip (`.radio-playing`)
Equalizer icon + "**Playing now** · title · artist" (or "Paused") in a `--bg-tertiary` pill, shown when a radio is running behind the home view.

### Toast (`.toast`, `showStatus()`)
Errors and warnings float at the bottom center of the screen (16px from the edge, above everything, max 520px, full width minus 16px gutters on phones), one at a time; a new message replaces the current one and the same message again only keeps it up longer. Neutral warnings invert the page (`--text-primary` fill, `--bg-primary` text, like the play button); errors take the accent (`--lastfm-red` fill, `--on-accent` text, checked in `tests/contrast.test.js`). Each has an icon (info or warning circle), the text (wraps, never truncated), and a 44px close button. It slides up on a short spring (`toast-in`, 0.28s) and slides away; warnings stay 6s and errors 9s, hovering or focusing it holds it, leaving re-arms 2.5s. It lives in a persistent polite live region (`#toastHost`, `role="status"`), so screen readers announce it when it appears. Progress text is not shown, and a success message dismisses the current toast (the problem it reported is over).

### Spotify badge
Green-tinted pill (`--spotify-green-subtle` / `--spotify-green-border`) "Spotify connected" with a small dot and an x to disconnect (20px visible, 44px hit area), in the header.

---

## 4. Screens

### Home (`#homeView`)
- **Not connected (first run):** a landing card (max 560px): eyebrow, headline "Your listening history, played back as a radio.", a line of copy and two numbered steps. 1: **Your Last.fm username** (field, "public scrobbles only"). 2: **Connect Spotify** (disabled until there is a username; says Premium is needed and that the options come next). Step badges: red = current, green check = done, outline = locked. No station picker or options yet.
- **Connected, idle:** headline, `username · N scrobbles`, station picker (+ Library options when Library, Mix balance when Mix), username field, **Start <Station> radio**.
- **Radio running (minimized):** same card, plus the "Playing now" strip; the button pair becomes **Back to radio** / **Start a new radio**.
- **Wide desktop (>=1100px):** the same card, centered at 680px.

### Radio view (`#radioView`, Library / Discover / Mix)
Top bar: **Home** on the left, the station label (LIBRARY / DISCOVER / MIX RADIO) in small red caps on the right. Then the now-playing card, the moment panel (Moments only), the artist panel and **Up next**. With Library options the label names them (LIBRARY RADIO · MOMENTS · 2014). The first row after the current track can show a "Tuning..." placeholder while more tracks load. Returning home does not stop the music.

### Changelog overlay
Full-screen overlay (title and close button in its own header) with an iframe of `changelog.html`. Inside the overlay the page hides its own title block and back link (a `framed` class set before first paint), so the title appears once; standalone, the title, subtitle, back link and entries share one 680px column and one left edge.

---

## 5. Responsive behavior

| Width | Behavior |
|---|---|
| **<= 520px** | Radio card padding 20px; now-playing card stacks (see above); buttons full width in `.controls` and in the moment panel; header brand 16px |
| **<= 720px** | Volume slider hidden (phones cannot use the SDK anyway) |
| **521-1099px** | One column, 680px container, now-playing card horizontal at 224px |
| **>= 1100px** | 1120px container. Home: the card centered at 680px. Radio two columns: player, moment panel and artist panel (640px) on the left, Up next as a panel of equal height on the right (min 476px). Up next shows 8 rows (6 below 1100px) that share the panel height equally (`--upnext-rows`, 50px each at the 468px minimum). Artist photo shown |

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
- Focus: one global ring, `2px solid var(--lastfm-red-text)` at 2px offset, on every button, link, range input and `[tabindex]` under `:focus-visible`. Exceptions: text inputs (their red border and glow).
- Toggle buttons expose their state with `aria-pressed` (station picker, Mix balance, hearts).
- Reduced motion respected.

---

## 8. Not applied yet / open decisions

- **Chip position on phones.** Right-aligned with the cover's right edge (applied, PR #8). Alternatives tried and rejected: chip directly after "NOW PLAYING"; chip on the artist line; no "NOW PLAYING" label; a compact player without the large cover.
- **Mix legend.** The Mix mockup shows a small "New / From your past" legend in the Up next header; the app does not have it yet.
- **Long names.** Chips truncate at 160-170px; very long artist names make the phone title wrap onto several lines (intended). Check with real data when changing these widths.
- **Mockup-only copy.** Placeholders in the canvas (`[Track title]`, `[ARTIST]`, `[N]`) stand for real data.
