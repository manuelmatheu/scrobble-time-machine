# Library Radio + Radio-first Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Scrobble Time Machine radio-first: one "Start radio" action plays an endless stream of tracks drawn uniformly at random from the user's whole Last.fm scrobble history, inside a redesigned UI.

**Architecture:** A new `js/radio.js` holds pure helpers (unit-tested with plain `node`) and the radio engine (random scrobble fetch, dedupe, Spotify match, top-up). The engine reuses `spotifySearch()`, `registerUri()`, `spotifyPlay()` and the existing `matchedUris` / `allTrackCount` index scheme, so save-as-playlist and likes keep working. The UI is a home view (mosaic, headline, Start radio, time-travel chips) and a radio view (hero, controls, Up next), styled through the existing CSS custom properties.

**Tech Stack:** Vanilla HTML/CSS/JS (no build step, no modules), Spotify Web Playback SDK, Last.fm API, Phosphor Icons web font from jsDelivr, Node (already installed, v25) for the small test scripts only.

**Spec:** `docs/superpowers/specs/2026-09-30-library-radio-redesign-design.md`

## Deviations from the spec (decided while reading the code)

1. **Top-up re-issues `spotifyPlay()`** from the current track with the new tracks appended, exactly like `continueMatching()` does, instead of POSTing to the Spotify queue. Reason: the existing code deliberately avoids the persistent user queue (see the comment in `continueMatching`). Observable behavior is the same.
2. **Initial batch is 8 tracks and each top-up adds 8** (spec says about 15 and about 10). Each Spotify search is spaced by `SEARCH_DELAY` (500ms), so 15 would delay the first song by 8+ seconds. The numbers are constants in `config.js` (`RADIO_INITIAL`, `RADIO_REFILL`).
3. **Node test scripts are added under `tests/`.** `CLAUDE.md` says there is no test suite, so these are dependency-free scripts run with `node tests/<file>.js`; `CLAUDE.md` is updated in Task 6.
4. **Keep the `.header` / `.header-brand` / `.header-icon` CSS rules.** `changelog.html` still uses them; the app gets a new `.app-header` instead.

## Global Constraints

- Vanilla HTML/CSS/JS, no build step, no modules, script load order matters.
- Script order becomes: SDK, `config.js`, `spotify.js`, `lastfm.js`, `ui.js`, `player.js`, `radio.js`, `modes.js`, `app.js`.
- Spotify tokens stay in `localStorage`. Use the `/v1/me/...` endpoints already in use.
- Colors go through the existing CSS custom properties; dark default, light via `[data-theme="light"]`; both themes must be checked.
- Raise `--text-tertiary` and `--text-muted` (they fail contrast today); add a lighter red text token for small red text; keep `#d51007` for fills and large text.
- Shape lock: 8px radius for buttons, inputs, tiles, cards, and cover art; mode chips fully round. No other radii (progress bars and slider thumbs are fully round).
- Minimum 11px for functional text, 14px or larger for body text.
- No em-dashes anywhere in visible text. One separator per line maximum.
- One icon family: Phosphor Icons from a CDN web font.
- All motion collapses to static under `prefers-reduced-motion`. No `window` scroll listeners.
- Radio page tag format: `Page 5,019 of 48,213, 2017`.
- HTML comments must be ASCII only (no box-drawing characters).
- Do not change the time-travel mode handlers in `modes.js` other than the one-line `beginSession()` edit in Task 2.

## Review Focus

Input classes the spec implies but does not spell out, most likely to bite first:

1. Last.fm page 1 includes a "now playing" entry on top of the requested scrobble, and `track` can be a single object instead of an array. Expected: the real scrobble is still picked. Pinned by a test in Task 1.
2. Two different scrobbles resolve to the same Spotify track URI. Expected: the track is queued once. Pinned by a test in Task 2.
3. The user presses Cancel, goes Back, or starts a time-travel mode while a top-up is in flight. Expected: the stale fill adds nothing and never calls `spotifyPlay()`. Pinned by a test in Task 2.
4. Last.fm errors repeatedly, then recovers. Expected: growing backoff capped at 8 seconds, streak reset on the first success, no exception. Pinned by tests in Task 2.
5. A library with very few unique tracks (or an all-duplicate stream). Expected: the fill terminates after a bounded number of fetches and returns what it found. Pinned by a test in Task 2.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `js/radio.js` | Pure helpers, radio engine, radio view rendering, home mosaic | Create (grows across Tasks 1 to 4) |
| `tests/radio-helpers.test.js` | Unit tests for the pure helpers | Create (Task 1) |
| `tests/radio-engine.test.js` | Engine tests with stubbed network, loaded via `vm` | Create (Task 2) |
| `tests/contrast.test.js` | WCAG contrast check of the CSS tokens | Create (Task 5) |
| `js/config.js` | Radio constants and state | Modify (Task 2) |
| `js/lastfm.js` | `getLastFmScrobbleAt()` | Modify (Task 2) |
| `js/player.js` | Refill and render hooks, seek, progress, heart | Modify (Tasks 2, 4) |
| `js/ui.js` | `handleReset`, `updateSpotifyUI`, `updateGoButton`, glyph swaps | Modify (Tasks 2, 3, 5) |
| `js/modes.js` | `beginSession()` stops radio | Modify (Task 2) |
| `js/app.js` | Wire meta/mosaic refresh and Enter key | Modify (Task 3) |
| `index.html` | New home and radio markup, script tag, icon CSS | Modify (Tasks 2, 3, 4, 5, 6) |
| `css/style.css` | Tokens and new component styles | Modify (Tasks 3, 4, 5) |
| `CLAUDE.md`, `ROADMAP.md`, `changelog.html` | Docs and version | Modify (Task 6) |

Manual verification needs the app served over HTTP on an origin registered as a Spotify redirect URI. Example: `npx serve -l 3000`, then add `http://127.0.0.1:3000/` in the Spotify dashboard (Spotify accepts the loopback IP form for http redirect URIs, not `localhost`) and browse to `http://127.0.0.1:3000/`. A Spotify Premium account is needed for playback.

---

### Task 1: Pure helpers with unit tests

**Files:**
- Create: `js/radio.js`
- Test: `tests/radio-helpers.test.js`

**Interfaces:**
- Produces (all pure, no globals, no DOM):
  - `radioPickPage(total: number, rand?: () => number): number` returns an integer in `[1, total]`.
  - `radioTrackKey(artist: string, track: string): string` returns `"artist||track"` lowercased.
  - `radioScrobbleFromTracks(list: object|object[]|undefined, page: number): {artist, track, album, page, year}|null`.
  - `radioFormatPage(page: number, total: number, year: number|null): string`.
  - `radioRemaining(matched: object, count: number, currentUri: string): number` (number of matched tracks after `currentUri`; `Infinity` if `currentUri` is not found).
  - `radioUrisFrom(matched: object, count: number, currentUri: string|null): string[]` (matched URIs from `currentUri` onward; all of them when `currentUri` is null; `[]` if not found).
  - `radioShouldRefill(state: {active, refilling, exhausted, remaining}, lowWater: number): boolean`.
  - `radioCoverUrl(hit: object, size?: "small"|"medium"): string`.
- The file ends with the anchor comment `// ===== node test exports (no-op in browsers) =====` followed by the export block. Later tasks insert code above that anchor.

- [ ] **Step 1: Write the failing test**

Create `tests/radio-helpers.test.js`:

```js
const assert = require("node:assert/strict");
const r = require("../js/radio.js");

// radioPickPage: uniform over 1..total, both ends reachable
assert.equal(r.radioPickPage(10, () => 0), 1);
assert.equal(r.radioPickPage(10, () => 0.5), 6);
assert.equal(r.radioPickPage(10, () => 0.999999), 10);
assert.equal(r.radioPickPage(1, () => 0.7), 1);

// radioTrackKey
assert.equal(r.radioTrackKey("Radiohead", "Airbag"), "radiohead||airbag");

// radioScrobbleFromTracks
const base = { name: "Airbag", artist: { "#text": "Radiohead" }, album: { "#text": "OK Computer" }, date: { uts: "1500000000" } };
assert.deepEqual(r.radioScrobbleFromTracks([base], 5019), { artist: "Radiohead", track: "Airbag", album: "OK Computer", page: 5019, year: 2017 });
// page 1 carries a now-playing entry first: it must be skipped
const nowPlaying = { name: "Live", artist: { "#text": "X" }, "@attr": { nowplaying: "true" } };
assert.equal(r.radioScrobbleFromTracks([nowPlaying, base], 1).track, "Airbag");
assert.equal(r.radioScrobbleFromTracks([nowPlaying], 1), null);
// a single object instead of an array
assert.equal(r.radioScrobbleFromTracks(base, 7).track, "Airbag");
// empty / missing
assert.equal(r.radioScrobbleFromTracks([], 3), null);
assert.equal(r.radioScrobbleFromTracks(undefined, 3), null);
// artist under .name, no album, no date
assert.deepEqual(r.radioScrobbleFromTracks([{ name: "N", artist: { name: "A" } }], 1), { artist: "A", track: "N", album: "", page: 1, year: null });
// missing artist or name
assert.equal(r.radioScrobbleFromTracks([{ name: "N", artist: {} }], 1), null);
assert.equal(r.radioScrobbleFromTracks([{ artist: { "#text": "A" } }], 1), null);

// radioFormatPage
assert.equal(r.radioFormatPage(5019, 48213, 2017), "Page 5,019 of 48,213, 2017");
assert.equal(r.radioFormatPage(5019, 48213, null), "Page 5,019 of 48,213");

// radioRemaining / radioUrisFrom (matched is sparse and index-keyed)
const matched = { 0: "a", 1: "b", 3: "c" };
assert.equal(r.radioRemaining(matched, 4, "a"), 2);
assert.equal(r.radioRemaining(matched, 4, "b"), 1);
assert.equal(r.radioRemaining(matched, 4, "c"), 0);
assert.equal(r.radioRemaining(matched, 4, "zzz"), Infinity);
assert.deepEqual(r.radioUrisFrom(matched, 4, "b"), ["b", "c"]);
assert.deepEqual(r.radioUrisFrom(matched, 4, null), ["a", "b", "c"]);
assert.deepEqual(r.radioUrisFrom(matched, 4, "zzz"), []);

// radioShouldRefill
const s = { active: true, refilling: false, exhausted: false, remaining: 2 };
assert.equal(r.radioShouldRefill(s, 2), true);
assert.equal(r.radioShouldRefill({ ...s, remaining: 3 }, 2), false);
assert.equal(r.radioShouldRefill({ ...s, refilling: true }, 2), false);
assert.equal(r.radioShouldRefill({ ...s, exhausted: true }, 2), false);
assert.equal(r.radioShouldRefill({ ...s, active: false }, 2), false);
assert.equal(r.radioShouldRefill({ ...s, remaining: Infinity }, 2), false);

// radioCoverUrl (Spotify lists images largest first)
const hit = { album: { images: [{ url: "big" }, { url: "mid" }, { url: "small" }] } };
assert.equal(r.radioCoverUrl(hit), "small");
assert.equal(r.radioCoverUrl(hit, "medium"), "mid");
assert.equal(r.radioCoverUrl({ album: { images: [{ url: "only" }] } }, "medium"), "only");
assert.equal(r.radioCoverUrl({ album: { images: [] } }), "");
assert.equal(r.radioCoverUrl(null), "");

console.log("radio helpers: ok");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/radio-helpers.test.js`
Expected: FAIL with `Cannot find module '../js/radio.js'`.

- [ ] **Step 3: Write the implementation**

Create `js/radio.js`:

```js
// =============================================================================
// LIBRARY RADIO - pure helpers (no globals, no DOM; unit-tested with node)
// =============================================================================

// Random 1-based position in the user's scrobble history. With limit=1, Last.fm's
// "page" parameter is an index into the scrobbles, so this is uniform over history.
function radioPickPage(total, rand) {
  return Math.floor((rand || Math.random)() * total) + 1;
}

function radioTrackKey(artist, track) {
  return (artist + "||" + track).toLowerCase();
}

// Turn Last.fm's track list (array, single object, or missing) into one scrobble
function radioScrobbleFromTracks(list, page) {
  const arr = Array.isArray(list) ? list : (list ? [list] : []);
  const t = arr.find(x => x && !(x["@attr"] && x["@attr"].nowplaying));
  if (!t || !t.name) return null;
  const artist = (t.artist && (t.artist["#text"] || t.artist.name)) || "";
  if (!artist) return null;
  const uts = t.date && parseInt(t.date.uts, 10);
  return { artist, track: t.name, album: (t.album && t.album["#text"]) || "", page, year: uts ? new Date(uts * 1000).getFullYear() : null };
}

function radioFormatPage(page, total, year) {
  return "Page " + page.toLocaleString("en-US") + " of " + total.toLocaleString("en-US") + (year ? ", " + year : "");
}

// How many matched tracks come after currentUri (Infinity when it is not ours)
function radioRemaining(matched, count, currentUri) {
  let found = false, after = 0;
  for (let i = 0; i < count; i++) {
    const u = matched[i];
    if (!u) continue;
    if (found) after++; else if (u === currentUri) found = true;
  }
  return found ? after : Infinity;
}

// Matched URIs from currentUri onward (everything when currentUri is null)
function radioUrisFrom(matched, count, currentUri) {
  const uris = [];
  let started = !currentUri;
  for (let i = 0; i < count; i++) {
    const u = matched[i];
    if (!u) continue;
    if (!started && u === currentUri) started = true;
    if (started) uris.push(u);
  }
  return uris;
}

function radioShouldRefill(s, lowWater) {
  return !!s.active && !s.refilling && !s.exhausted && s.remaining <= lowWater;
}

function radioCoverUrl(hit, size) {
  const im = hit && hit.album && hit.album.images;
  if (!im || !im.length) return "";
  const pick = size === "medium" ? (im[1] || im[0]) : (im[im.length - 1] || im[0]);
  return pick.url || "";
}

// ===== node test exports (no-op in browsers) =====
if (typeof module !== "undefined" && module.exports) {
  module.exports = { radioPickPage, radioTrackKey, radioScrobbleFromTracks, radioFormatPage, radioRemaining, radioUrisFrom, radioShouldRefill, radioCoverUrl };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/radio-helpers.test.js`
Expected: prints `radio helpers: ok`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add js/radio.js tests/radio-helpers.test.js
git commit -m "$(cat <<'EOF'
Add radio pure helpers with node unit tests

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Radio engine, player hooks, and a working Start radio button

**Files:**
- Modify: `js/config.js` (append after `let likedSet = new Set();`)
- Modify: `js/lastfm.js` (insert before `async function getMoodArtists`)
- Modify: `js/radio.js` (insert engine above the export anchor)
- Modify: `js/player.js` (two hook insertions)
- Modify: `js/modes.js` (`beginSession`)
- Modify: `js/ui.js` (`handleReset`, `updateGoButton`)
- Modify: `index.html` (script tag, `radioBtn`)
- Test: `tests/radio-engine.test.js`

**Interfaces:**
- Consumes (Task 1): `radioPickPage`, `radioTrackKey`, `radioScrobbleFromTracks`, `radioRemaining`, `radioUrisFrom`, `radioShouldRefill`, `radioCoverUrl`.
- Consumes (existing): `getLastFmTotalPages(user)`, `spotifySearch(token, artist, track)`, `registerUri(uri, index)`, `spotifyPlay(token, uris, positionMs)`, `getSpotifyDevices(token)`, `getSpotifyToken()`, `beginSession()`, `endSessionUI()`, `startPolling()`, `checkLikedTracks()`, `saveAsPlaylist()`, `showStatus(msg, type)`, globals `matchedUris`, `allTrackCount`, `uriToIndices`, `totalMatched`, `sessionQueue`, `skippedPlan`, `isContinuing`, `sdkReady`, `_sdkCurrentUri`, `_sdkPositionMs`, `lastSearchError`, `SEARCH_DELAY`.
- Produces:
  - `config.js`: constants `RADIO_INITIAL`, `RADIO_REFILL`, `RADIO_LOW_WATER`, `RADIO_CONCURRENCY`, `RADIO_MAX_ATTEMPTS`, `RADIO_UPNEXT_ROWS`; state `radioActive`, `radioUser`, `radioTotal`, `radioSession`, `radioSeen`, `radioRefilling`, `radioExhausted`, `radioFailures`, `radioCurrentUri`, `radioLastPos`, `trackMeta`.
  - `lastfm.js`: `getLastFmScrobbleAt(user: string, page: number): Promise<object[]|object>` (raw `recenttracks.track`).
  - `radio.js`: `radioSleep(ms)`, `radioCollectBatch(user)`, `radioFill(want): Promise<number>`, `startRadio()`, `continueRadio()`, `radioMaybeRefill(currentUri, positionMs)`, `radioStop()`.
  - `trackMeta[index] = { name, artist, album, page, year, art }` (used by Tasks 3 and 4).

- [ ] **Step 1: Write the failing engine test**

Create `tests/radio-engine.test.js`. It loads the real `config.js` and `radio.js` into one `vm` context so the engine sees the real globals, and stubs only the network and DOM-free collaborators:

```js
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

global.window = { location: { origin: "http://localhost", pathname: "/" } };
global.document = { getElementById: () => null };
const load = f => vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), { filename: f });
const run = code => vm.runInThisContext(code);
load("config.js");
load("radio.js");

function reset() {
  run("matchedUris = {}; allTrackCount = 0; uriToIndices = {}; totalMatched = 0; trackMeta = {}; sessionQueue = new Set(); radioSeen = new Set(); radioTotal = 1000; radioFailures = 0; radioUser = 'tester'; radioActive = true; radioExhausted = false; radioRefilling = false;");
}
const song = n => [{ name: "Song " + n, artist: { "#text": "Artist" }, date: { uts: "1500000000" } }];
const uriFor = name => "spotify:track:" + name.replace(/ /g, "_");

(async () => {
  global.showStatus = () => {};
  global.getSpotifyToken = async () => "token";
  let sleeps = [];
  global.radioSleep = async ms => { sleeps.push(ms); };
  run("function registerUri(u, i) { (uriToIndices[u] = uriToIndices[u] || []).push(i); }");
  global.spotifySearch = async (token, artist, track) => ({ uri: uriFor(track), name: track, album: { images: [] } });

  // 1. fills unique tracks and records bookkeeping
  reset(); let n = 0;
  global.getLastFmScrobbleAt = async () => song(n++);
  assert.equal(await run("radioFill(5)"), 5);
  assert.equal(run("allTrackCount"), 5);
  assert.equal(run("matchedUris[0]"), "spotify:track:Song_0");
  assert.equal(run("sessionQueue.size"), 5);
  const meta0 = run("trackMeta[0]");
  assert.equal(meta0.name, "Song 0");
  assert.ok(meta0.page >= 1 && meta0.page <= 1000);
  assert.equal(meta0.year, 2017);

  // 2. the same scrobble picked twice is queued once
  reset(); const seq = [0, 0, 1, 2]; let c = 0;
  global.getLastFmScrobbleAt = async () => song(seq[c++]);
  assert.equal(await run("radioFill(3)"), 3);
  assert.deepEqual([0, 1, 2].map(i => run("trackMeta[" + i + "].name")), ["Song 0", "Song 1", "Song 2"]);

  // 3. two different scrobbles that resolve to one Spotify URI are queued once
  reset(); c = 0;
  const seq3 = [0, 1, 2, 3];
  global.getLastFmScrobbleAt = async () => song(seq3[c++]);
  global.spotifySearch = async (token, artist, track) => ({ uri: track === "Song 1" ? uriFor("Song 0") : uriFor(track), name: track, album: { images: [] } });
  assert.equal(await run("radioFill(3)"), 3);
  assert.equal(new Set(Object.values(run("matchedUris"))).size, 3);
  global.spotifySearch = async (token, artist, track) => ({ uri: uriFor(track), name: track, album: { images: [] } });

  // 4. a fill that goes stale (Cancel, Back, or a new mode) adds nothing
  reset(); n = 0;
  global.getLastFmScrobbleAt = async () => { run("radioSession++"); return song(n++); };
  assert.equal(await run("radioFill(3)"), 0);
  assert.equal(run("allTrackCount"), 0);

  // 5. Last.fm fails, then recovers: backoff, then the streak resets
  reset(); n = 0; sleeps = []; let fails = 6;
  global.getLastFmScrobbleAt = async () => { if (fails-- > 0) throw new Error("boom"); return song(n++); };
  assert.equal(await run("radioFill(2)"), 2);
  assert.equal(sleeps[0], 1000);
  assert.equal(run("radioFailures"), 0);

  // 6. Last.fm keeps failing: terminates, backoff is capped at 8 seconds
  reset(); sleeps = [];
  global.getLastFmScrobbleAt = async () => { throw new Error("down"); };
  assert.equal(await run("radioFill(3)"), 0);
  assert.ok(run("radioFailures") >= 3);
  assert.equal(Math.max(...sleeps), 8000);

  // 7. a library with one unique track: terminates and returns what it found
  reset(); sleeps = [];
  global.getLastFmScrobbleAt = async () => song(0);
  assert.equal(await run("radioFill(3)"), 1);
  assert.equal(run("radioFailures"), 0);

  // 8. radioMaybeRefill records the now-playing uri and position
  reset();
  run("matchedUris = { 0: 'a', 1: 'b' }; allTrackCount = 2; radioRefilling = true;");
  run("radioMaybeRefill('a', 4200)");
  assert.equal(run("radioCurrentUri"), "a");
  assert.equal(run("radioLastPos"), 4200);

  console.log("radio engine: ok");
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/radio-engine.test.js`
Expected: FAIL. `config.js` has no radio state yet, so the first `reset()` throws `ReferenceError: trackMeta is not defined` (or a similar missing-binding error).

- [ ] **Step 3: Add radio constants and state to `config.js`**

Append after the last line (`let likedSet = new Set();`):

```js

// Library Radio
const RADIO_INITIAL = 8;        // tracks matched before playback starts
const RADIO_REFILL = 8;         // tracks added per top-up
const RADIO_LOW_WATER = 2;      // top up when this many tracks remain after the current one
const RADIO_CONCURRENCY = 4;    // parallel Last.fm requests per round
const RADIO_MAX_ATTEMPTS = 40;  // Last.fm fetches per fill before giving up
const RADIO_UPNEXT_ROWS = 6;    // rows shown in the Up next list
let radioActive = false, radioUser = "", radioTotal = 0;
let radioSession = 0;           // bumped on every start/stop; stale fills compare against it
let radioSeen = new Set();      // artist||track keys already picked this session
let radioRefilling = false, radioExhausted = false, radioFailures = 0;
let radioCurrentUri = null, radioLastPos = 0;  // now-playing fallback when the SDK is not driving state
let trackMeta = {};             // index -> { name, artist, album, page, year, art }
```

- [ ] **Step 4: Add `getLastFmScrobbleAt` to `lastfm.js`**

Use Edit with `old_string` = `async function getMoodArtists(mood) {` and `new_string`:

```js
// One scrobble at a 1-based position in the user's history (limit=1 makes "page" an index)
async function getLastFmScrobbleAt(user, page) {
  const r = await fetch("https://ws.audioscrobbler.com/2.0/?" + new URLSearchParams({ method:"user.getrecenttracks", user, api_key:LASTFM_API_KEY, format:"json", limit:"1", page:String(page) }));
  if (r.status === 429) throw new Error("Last.fm rate limit");
  if (!r.ok) throw new Error("Last.fm API error");
  const d = await r.json(); if (d.error) throw new Error(d.message);
  return d.recenttracks.track || [];
}

async function getMoodArtists(mood) {
```

- [ ] **Step 5: Add the engine to `radio.js`**

Use Edit with `old_string` = `// ===== node test exports (no-op in browsers) =====` and `new_string` = the block below followed by that same anchor line:

```js
// =============================================================================
// LIBRARY RADIO - engine (uses globals from config.js, spotify.js, player.js)
// =============================================================================
function radioSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Fire RADIO_CONCURRENCY single-scrobble requests in parallel
async function radioCollectBatch(user) {
  const pages = [];
  for (let k = 0; k < RADIO_CONCURRENCY; k++) pages.push(radioPickPage(radioTotal));
  const settled = await Promise.allSettled(pages.map(p => getLastFmScrobbleAt(user, p).then(list => radioScrobbleFromTracks(list, p))));
  const picks = []; let failed = 0;
  for (const s of settled) {
    if (s.status === "rejected") failed++;
    else if (s.value) picks.push(s.value);
  }
  return { picks, failed, total: settled.length };
}

// Pick random scrobbles, match them on Spotify, append matches to the session. Returns
// the number of tracks added. Bails out quietly if the session changes mid-flight.
async function radioFill(want) {
  const sid = radioSession, user = radioUser;
  const token = await getSpotifyToken();
  if (!token || sid !== radioSession) return 0;
  lastSearchError = null;
  let added = 0, attempts = 0;
  while (added < want && attempts < RADIO_MAX_ATTEMPTS) {
    const batch = await radioCollectBatch(user);
    if (sid !== radioSession) return added;
    attempts += batch.total;
    if (batch.failed === batch.total) {
      radioFailures++;
      if (radioFailures >= 3) showStatus("Last.fm is slow, retrying...", "");
      await radioSleep(Math.min(1000 * radioFailures, 8000));
      if (sid !== radioSession) return added;
      continue;
    }
    radioFailures = 0;
    for (const p of batch.picks) {
      if (added >= want) break;
      const key = radioTrackKey(p.artist, p.track);
      if (radioSeen.has(key)) continue;
      radioSeen.add(key);
      const hit = await spotifySearch(token, p.artist, p.track);
      if (sid !== radioSession) return added;
      if (hit && !uriToIndices[hit.uri]) {
        const idx = allTrackCount++;
        matchedUris[idx] = hit.uri; registerUri(hit.uri, idx); sessionQueue.add(hit.uri); totalMatched++;
        trackMeta[idx] = {
          name: hit.name || p.track,
          artist: (hit.artists && hit.artists.length ? hit.artists.map(a => a.name).join(", ") : p.artist),
          album: p.album, page: p.page, year: p.year, art: radioCoverUrl(hit)
        };
        added++;
      }
      await radioSleep(SEARCH_DELAY);
      if (sid !== radioSession) return added;
    }
  }
  return added;
}

async function startRadio() {
  const user = $("usernameInput").value.trim();
  if (!user || !spotifyToken) return;
  beginSession();
  matchedUris = {}; allTrackCount = 0; uriToIndices = {}; totalMatched = 0; skippedPlan = []; isContinuing = false;
  trackMeta = {}; radioSeen = new Set(); radioFailures = 0; radioRefilling = false; radioExhausted = false;
  radioCurrentUri = null; radioLastPos = 0; radioUser = user; radioActive = true;
  const sid = ++radioSession;
  try {
    showStatus("Reading your Last.fm library...");
    const { totalScrobbles } = await getLastFmTotalPages(user);
    if (sid !== radioSession) return;
    if (!totalScrobbles) throw new Error("No scrobbles found");
    radioTotal = totalScrobbles;
    showStatus("Tuning your library...");
    const added = await radioFill(RADIO_INITIAL);
    if (sid !== radioSession) return;
    if (!added) throw new Error("No tracks matched" + (lastSearchError ? " (" + lastSearchError + ")" : ""));
    const token = await getSpotifyToken();
    if (!token) throw new Error("Spotify expired. Reconnect.");
    showStatus("Starting playback...");
    const ok = await spotifyPlay(token, radioUrisFrom(matchedUris, allTrackCount, null));
    if (sid !== radioSession) return;
    if (!ok) {
      const devs = await getSpotifyDevices(token);
      throw new Error(devs.length === 0 ? "No active Spotify device. Open Spotify and try again." : "Playback failed. Make sure Spotify is active.");
    }
    currentPhase = "done"; playlistLabel = "Library Radio";
    showStatus("▶ Library radio" + (totalScrobbles < 200 ? " · small library, new tracks may run out" : ""), "success");
    startPolling();
    checkLikedTracks();
    const btn = $("savePlaylistBtn");
    btn.style.display = ""; btn.disabled = false; btn.textContent = "Save as Playlist"; btn.className = "btn-save-playlist"; btn.onclick = saveAsPlaylist;
    endSessionUI();
  } catch (err) {
    if (sid !== radioSession) return;
    radioStop(); currentPhase = "error"; showStatus(err.message, "error"); endSessionUI();
  }
}

// Top up the queue, then re-issue playback from the current track so the new tracks join
// the Spotify context (same approach as continueMatching; avoids the persistent user queue)
async function continueRadio() {
  if (!radioActive || radioRefilling || radioExhausted) return;
  const sid = radioSession;
  radioRefilling = true;
  try {
    const added = await radioFill(RADIO_REFILL);
    if (sid !== radioSession) return;
    if (!added) { if (radioFailures === 0) radioExhausted = true; return; }
    const currentUri = sdkReady ? _sdkCurrentUri : radioCurrentUri;
    if (!currentUri) return;
    const uris = radioUrisFrom(matchedUris, allTrackCount, currentUri);
    if (!uris.length) return;
    const token = await getSpotifyToken();
    if (!token || sid !== radioSession) return;
    await spotifyPlay(token, uris, sdkReady ? _sdkPositionMs : radioLastPos);
    checkLikedTracks();
  } finally {
    if (sid === radioSession) radioRefilling = false;
  }
}

// Called from the SDK state handler and the polling fallback on every track change
function radioMaybeRefill(currentUri, positionMs) {
  radioCurrentUri = currentUri; radioLastPos = positionMs || 0;
  const remaining = radioRemaining(matchedUris, allTrackCount, currentUri);
  if (radioShouldRefill({ active: radioActive, refilling: radioRefilling, exhausted: radioExhausted, remaining }, RADIO_LOW_WATER)) continueRadio();
}

function radioStop() {
  radioActive = false; radioSession++; radioRefilling = false;
  radioCurrentUri = null; radioLastPos = 0;
}

// ===== node test exports (no-op in browsers) =====
```

- [ ] **Step 6: Run the engine and helper tests**

Run: `node tests/radio-engine.test.js && node tests/radio-helpers.test.js`
Expected: prints `radio engine: ok` then `radio helpers: ok`, exit code 0.

- [ ] **Step 7: Hook the refill into `player.js`**

Edit 1 (SDK path). `old_string`:

```
      if (matchedAfter.length <= 2) continueMatching();
    }
  } else {
```

`new_string`:

```
      if (matchedAfter.length <= 2) continueMatching();
    }
    radioMaybeRefill(track.uri, state.position);
  } else {
```

Edit 2 (polling fallback). `old_string`:

```
    highlightNowPlaying(best);
  }

  // Auto-continue: check if we're near the end of matched tracks and have skipped ones
```

`new_string`:

```
    highlightNowPlaying(best);
  }
  radioMaybeRefill(playingUri, data.progress_ms);

  // Auto-continue: check if we're near the end of matched tracks and have skipped ones
```

- [ ] **Step 8: Stop radio on new sessions and resets**

In `js/modes.js`, edit `beginSession()`: `old_string` = `function beginSession() {\n  abortController = new AbortController();` and `new_string` = `function beginSession() {\n  radioStop();\n  abortController = new AbortController();`.

In `js/ui.js`, edit `handleReset()`: `old_string` = `function handleReset() {\n  if (abortController) abortController.abort();` and `new_string` = `function handleReset() {\n  radioStop(); trackMeta = {};\n  if (abortController) abortController.abort();`.

- [ ] **Step 9: Add the button and script tag**

In `index.html`, add after the `goBtn` line (`<button class="btn btn-primary" id="goBtn" ...>`):

```html
    <button class="btn btn-primary btn-radio" id="radioBtn" onclick="startRadio()" disabled>Start radio</button>
```

and add `<script src="js/radio.js"></script>` between the `player.js` and `modes.js` script tags.

In `js/ui.js`, edit `updateGoButton()`: `old_string` = `  let ok = base;` and `new_string` = `  $("radioBtn").disabled = !base;\n  let ok = base;`.

- [ ] **Step 10: Manual verification**

Serve the app (see the note under File Structure), connect Spotify, enter a Last.fm username, click **Start radio**.
Expected:
1. Status shows "Reading your Last.fm library...", then "Tuning your library...", then "Starting playback...", then "▶ Library radio".
2. Music starts within about 10 seconds; the bottom player bar shows the track.
3. In the browser console, run `matchedUris` and `trackMeta`: 8 entries, every `trackMeta[i].page` different, no duplicate names.
4. Skip forward 5 times with the player bar. After the queue is down to 2 tracks, `allTrackCount` grows by 8 and playback continues without a gap.
5. Click Cancel during "Tuning": status clears, nothing plays, `allTrackCount` stays 0.
6. Click **Save as Playlist** after 10 or more tracks: a playlist named "Time Machine: Library Radio" appears in Spotify.
7. Run a time-travel mode (Random): it works as before and `radioActive` is `false` in the console.

- [ ] **Step 11: Commit**

```bash
git add js/config.js js/lastfm.js js/radio.js js/player.js js/modes.js js/ui.js index.html tests/radio-engine.test.js
git commit -m "$(cat <<'EOF'
Add Library Radio engine with endless random-scrobble stream

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Home redesign (markup, mosaic, meta, time-travel section)

**Files:**
- Modify: `index.html` (icon CSS links in `<head>`; replace the `<div class="container">` block)
- Modify: `css/style.css` (tokens line 1 to 2; new home rules appended)
- Modify: `js/radio.js` (mosaic and meta functions above the export anchor)
- Modify: `js/ui.js` (`updateSpotifyUI`)
- Modify: `js/app.js` (meta/mosaic refresh, Enter key)

**Interfaces:**
- Consumes (Task 2): `startRadio()`, `getLastFmScrobbleAt`, `radioPickPage`, `radioScrobbleFromTracks`, `radioTrackKey`, `radioCoverUrl`, `radioSleep`, `radioActive`.
- Consumes (existing): `getLastFmTotalPages`, `spotifySearch`, `getSpotifyToken`, `spotifyToken`, `currentPhase`, `SEARCH_DELAY`.
- Produces: DOM ids `homeView`, `timeTravel`, `mosaic`, `homeMeta`, `saveSlotTrackList` (Task 4 relies on `homeView` and `saveSlotTrackList`); JS `refreshHomeMeta()`, `loadMosaic()`, `renderMosaic(urls)`; CSS token `--lastfm-red-text`.

- [ ] **Step 1: Add the Phosphor icon stylesheets**

In `index.html`, add after the `css/style.css` link:

```html
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.1/src/regular/style.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.1/src/fill/style.css">
```

(The icon names used in this plan were checked against the regular stylesheet: shuffle, calendar-blank, microphone-stage, calendar-star, smiley, clock-counter-clockwise, vinyl-record, magnifying-glass, flame, coffee, cloud-rain, lightning, guitar, moon-stars, heart, confetti, x, play, pause, skip-back, skip-forward, arrow-left, music-note, warning.)

- [ ] **Step 2: Add the red text token**

In `css/style.css` line 1, add `--lastfm-red-text:#ff5a50;` inside `:root {...}`. In line 2, add `--lastfm-red-text:#d51007;` inside `[data-theme="light"] {...}`. (Use Edit: for line 1 replace `--lastfm-red-hover:#e6130a;` with `--lastfm-red-hover:#e6130a; --lastfm-red-text:#ff5a50;`; for line 2 replace `[data-theme="light"] { --bg-primary:#f5f5f7;` with `[data-theme="light"] { --lastfm-red-text:#d51007; --bg-primary:#f5f5f7;`.)

- [ ] **Step 3: Replace the container markup**

In `index.html`, replace everything from `<div class="container">` through its closing `</div>` (the one just before `<div class="footer">`) with:

```html
<div class="container">
  <header class="app-header">
    <div class="app-brand"><i class="ph-fill ph-vinyl-record app-brand-icon" aria-hidden="true"></i><h1>Scrobble Time Machine</h1></div>
    <div class="app-header-right">
      <span class="spotify-badge" id="spotifyBadge" style="display:none"><span class="status-dot" aria-hidden="true"></span>Spotify <button class="btn-disconnect" onclick="disconnectSpotify()" title="Disconnect Spotify" aria-label="Disconnect Spotify"><i class="ph ph-x"></i></button></span>
      <button class="theme-toggle" onclick="toggleTheme()" title="Toggle dark/light mode" aria-label="Toggle theme">
        <span class="theme-icon">&#9728;</span>
      </button>
    </div>
  </header>
  <div class="setup-banner" id="setupBanner"><strong><i class="ph ph-warning" aria-hidden="true"></i> Setup required</strong>
    Open <code>js/config.js</code> and replace the API keys:<br>
    <code>LASTFM_API_KEY</code> &rarr; <a href="https://www.last.fm/api/account/create" target="_blank">last.fm/api</a><br>
    <code>SPOTIFY_CLIENT_ID</code> &rarr; <a href="https://developer.spotify.com/dashboard" target="_blank">Spotify Dashboard</a>
    (set redirect URI to <code id="currentUrl"></code>)</div>
  <div class="status-bar" id="statusBar" style="display:none"></div>

  <div id="homeView">
    <div class="mosaic" id="mosaic" aria-hidden="true">
      <div class="mosaic-tile" style="--h:5"></div><div class="mosaic-tile" style="--h:215"></div>
      <div class="mosaic-tile" style="--h:95"></div><div class="mosaic-tile" style="--h:35"></div>
      <div class="mosaic-tile" style="--h:275"></div><div class="mosaic-tile" style="--h:165"></div>
      <div class="mosaic-tile" style="--h:330"></div><div class="mosaic-tile" style="--h:235"></div>
    </div>
    <h2 class="home-headline">Your library, shuffled across every year.</h2>
    <p class="home-meta" id="homeMeta">Enter your Last.fm username to start.</p>
    <div class="controls">
      <input type="text" class="input-username" id="usernameInput" placeholder="Last.fm username" autocomplete="off" spellcheck="false" aria-label="Last.fm username">
      <button class="btn btn-spotify btn-radio" id="spotifyConnectBtn" onclick="initiateSpotifyAuth()">Connect Spotify</button>
      <button class="btn btn-primary btn-radio" id="radioBtn" onclick="startRadio()" style="display:none" disabled><i class="ph-fill ph-play" aria-hidden="true"></i> Start radio</button>
      <button class="btn btn-ghost" id="cancelBtn" onclick="handleReset()" style="display:none">Cancel</button>
    </div>

    <section class="time-travel" id="timeTravel" style="display:none">
      <h3 class="section-heading">Time travel</h3>
      <div class="mode-selector" id="modeSelector">
        <button class="mode-pill active" data-mode="random" onclick="setMode('random')"><i class="ph ph-shuffle" aria-hidden="true"></i> Random</button>
        <button class="mode-pill" data-mode="date" onclick="setMode('date')"><i class="ph ph-calendar-blank" aria-hidden="true"></i> Date</button>
        <button class="mode-pill" data-mode="artist" onclick="setMode('artist')"><i class="ph ph-microphone-stage" aria-hidden="true"></i> Artist</button>
        <button class="mode-pill" data-mode="onthisday" onclick="setMode('onthisday')"><i class="ph ph-calendar-star" aria-hidden="true"></i> On This Day</button>
        <button class="mode-pill mode-more-toggle" id="modeMoreToggle" onclick="toggleMoreModes()">More &#9662;</button>
      </div>
      <div class="mode-selector mode-secondary" id="modeSecondary" style="display:none">
        <button class="mode-pill" data-mode="mood" onclick="setMode('mood')"><i class="ph ph-smiley" aria-hidden="true"></i> Mood</button>
        <button class="mode-pill" data-mode="decade" onclick="setMode('decade')"><i class="ph ph-clock-counter-clockwise" aria-hidden="true"></i> Decade</button>
        <button class="mode-pill" data-mode="album" onclick="setMode('album')"><i class="ph ph-vinyl-record" aria-hidden="true"></i> Album</button>
        <button class="mode-pill" data-mode="discovery" onclick="setMode('discovery')"><i class="ph ph-magnifying-glass" aria-hidden="true"></i> First Listen</button>
        <button class="mode-pill" data-mode="streak" onclick="setMode('streak')"><i class="ph ph-flame" aria-hidden="true"></i> Streak</button>
      </div>
      <div class="mode-inputs" id="modeInputDate" style="display:none">
        <select id="dateYear" class="mode-input-field" aria-label="Year"></select>
        <select id="dateMonth" class="mode-input-field" aria-label="Month"><option value="">Month (any)</option><option value="1">January</option><option value="2">February</option><option value="3">March</option><option value="4">April</option><option value="5">May</option><option value="6">June</option><option value="7">July</option><option value="8">August</option><option value="9">September</option><option value="10">October</option><option value="11">November</option><option value="12">December</option></select>
        <select id="dateDay" class="mode-input-field" aria-label="Day"><option value="">Day (any)</option></select>
      </div>
      <div class="mode-inputs" id="modeInputArtist" style="display:none">
        <input type="text" class="mode-input-field artist-input" id="artistInput" placeholder="Artist name" autocomplete="off" spellcheck="false" aria-label="Artist name">
      </div>
      <div class="mode-inputs mood-grid" id="modeInputMood" style="display:none">
        <button class="mood-btn active" data-mood="chill" onclick="selectMood(this)"><i class="ph ph-coffee" aria-hidden="true"></i> Chill</button>
        <button class="mood-btn" data-mood="melancholy" onclick="selectMood(this)"><i class="ph ph-cloud-rain" aria-hidden="true"></i> Melancholy</button>
        <button class="mood-btn" data-mood="energetic" onclick="selectMood(this)"><i class="ph ph-lightning" aria-hidden="true"></i> Energetic</button>
        <button class="mood-btn" data-mood="raw" onclick="selectMood(this)"><i class="ph ph-guitar" aria-hidden="true"></i> Raw</button>
        <button class="mood-btn" data-mood="dreamy" onclick="selectMood(this)"><i class="ph ph-moon-stars" aria-hidden="true"></i> Dreamy</button>
        <button class="mood-btn" data-mood="soul" onclick="selectMood(this)"><i class="ph ph-heart" aria-hidden="true"></i> Soul</button>
        <button class="mood-btn" data-mood="indie" onclick="selectMood(this)"><i class="ph ph-confetti" aria-hidden="true"></i> Indie</button>
      </div>
      <div class="mode-inputs mood-grid" id="modeInputDecade" style="display:none"></div>
      <div class="mode-inputs" id="modeInputAlbum" style="display:none">
        <input type="text" class="mode-input-field artist-input" id="albumArtistInput" placeholder="Artist name" autocomplete="off" spellcheck="false" aria-label="Artist name">
        <input type="text" class="mode-input-field artist-input" id="albumInput" placeholder="Album name" autocomplete="off" spellcheck="false" aria-label="Album name">
      </div>
      <div class="mode-inputs" id="modeInputDiscovery" style="display:none">
        <input type="text" class="mode-input-field artist-input" id="discoveryInput" placeholder="Artist name" autocomplete="off" spellcheck="false" aria-label="Artist name">
      </div>
      <div class="mode-inputs" id="modeInputStreak" style="display:none">
        <input type="text" class="mode-input-field artist-input" id="streakInput" placeholder="Artist name" autocomplete="off" spellcheck="false" aria-label="Artist name">
      </div>
      <div class="go-row"><button class="btn btn-primary" id="goBtn" onclick="handleGo()" disabled>Time Travel</button></div>
      <div class="page-picker" id="pagePicker" style="display:none"><div class="page-picker-card">
        <span class="page-picker-label">Page</span><span class="page-picker-number" id="pageNumber">-</span>
        <span class="page-picker-total" id="pageTotal">of ...</span></div></div>
      <div class="era-panel" id="eraPanel" style="display:none"></div>
      <div class="track-list-wrapper" id="trackListWrapper" style="display:none">
        <div class="track-list-header"><h3>Tracks from this page</h3><span class="match-count" id="matchCount"></span><span id="saveSlotTrackList"><button class="btn-save-playlist" id="savePlaylistBtn" onclick="saveAsPlaylist()" style="display:none">Save as Playlist</button></span></div>
        <div class="track-list" id="trackList"></div></div>
    </section>
  </div>
  <!-- RADIO VIEW -->
</div>
```

Note: the `&#9728;` entity is the same sun glyph the theme script swaps; the inline theme script in `<head>` still finds `.theme-icon`.

- [ ] **Step 4: Update `updateSpotifyUI` in `ui.js`**

Replace the one-line function:

```js
function updateSpotifyUI(c) { $("spotifyConnectBtn").style.display = c ? "none" : ""; $("spotifyBadge").style.display = c ? "" : "none"; if (c) $("modeSelector").style.display = ""; updateGoButton(); }
```

with:

```js
function updateSpotifyUI(c) {
  $("spotifyConnectBtn").style.display = c ? "none" : "";
  $("spotifyBadge").style.display = c ? "" : "none";
  $("radioBtn").style.display = c ? "" : "none";
  $("timeTravel").style.display = c ? "" : "none";
  updateGoButton();
  if (c) loadMosaic();
}
```

- [ ] **Step 5: Add meta and mosaic code to `radio.js`**

Insert above the export anchor:

```js
// =============================================================================
// HOME: library meta line and cover mosaic
// =============================================================================
let mosaicUser = "";

async function refreshHomeMeta() {
  const user = $("usernameInput").value.trim();
  const el = $("homeMeta");
  if (!user) { el.textContent = "Enter your Last.fm username to start."; return; }
  try {
    const { totalScrobbles } = await getLastFmTotalPages(user);
    if ($("usernameInput").value.trim() !== user) return;
    el.textContent = user + " · " + totalScrobbles.toLocaleString("en-US") + " scrobbles";
  } catch (e) {
    if ($("usernameInput").value.trim() === user) el.textContent = "Could not load a library for " + user;
  }
}

function renderMosaic(urls) {
  document.querySelectorAll("#mosaic .mosaic-tile").forEach((tile, i) => {
    const old = tile.querySelector("img");
    if (old) old.remove();
    if (!urls[i]) return;
    const img = new Image();
    img.className = "mosaic-img"; img.alt = "";
    img.onload = () => { tile.appendChild(img); requestAnimationFrame(() => img.classList.add("loaded")); };
    img.src = urls[i];
  });
}

// Fill the mosaic with Spotify covers of random scrobbles. Purely decorative: any failure
// leaves the placeholder tiles, and it yields to a radio or time-travel session.
async function loadMosaic() {
  const user = $("usernameInput").value.trim();
  if (!user || !spotifyToken || mosaicUser === user) return;
  mosaicUser = user;
  const cacheKey = "stm_mosaic:" + user.toLowerCase();
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
    if (cached && cached.length) { renderMosaic(cached); return; }
  } catch (e) {}
  try {
    const { totalScrobbles } = await getLastFmTotalPages(user);
    if (!totalScrobbles) { mosaicUser = ""; return; }
    const token = await getSpotifyToken();
    if (!token) { mosaicUser = ""; return; }
    const urls = [], seen = new Set();
    let tries = 0;
    while (urls.length < 8 && tries < 16) {
      const batch = await Promise.allSettled(Array.from({ length: 4 }, () => {
        const p = radioPickPage(totalScrobbles);
        return getLastFmScrobbleAt(user, p).then(list => radioScrobbleFromTracks(list, p));
      }));
      tries += 4;
      for (const s of batch) {
        if (urls.length >= 8) break;
        if (s.status !== "fulfilled" || !s.value) continue;
        const key = radioTrackKey(s.value.artist, s.value.track);
        if (seen.has(key)) continue;
        seen.add(key);
        if (radioActive || currentPhase === "working" || $("usernameInput").value.trim() !== user) { mosaicUser = ""; return; }
        const hit = await spotifySearch(token, s.value.artist, s.value.track);
        const url = hit ? radioCoverUrl(hit, "medium") : "";
        if (url && !urls.includes(url)) urls.push(url);
        await radioSleep(SEARCH_DELAY);
      }
    }
    if (urls.length) {
      renderMosaic(urls);
      try { sessionStorage.setItem(cacheKey, JSON.stringify(urls)); } catch (e) {}
    } else { mosaicUser = ""; }
  } catch (e) { mosaicUser = ""; }
}

```

- [ ] **Step 6: Wire `app.js`**

In `js/app.js`:
1. After the saved-username restore line (`if (savedUser) { $("usernameInput").value = savedUser; refreshYearsForUser(); }`), add `refreshHomeMeta();` on the same line: `if (savedUser) { $("usernameInput").value = savedUser; refreshYearsForUser(); }\n  refreshHomeMeta();`.
2. In the username `change` listener, after `refreshYearsForUser();` add `refreshHomeMeta(); loadMosaic();`.
3. Replace the Enter handler `$("usernameInput").addEventListener("keydown", e => { if (e.key === "Enter" && !$("goBtn").disabled) handleGo(); });` with `$("usernameInput").addEventListener("keydown", e => { if (e.key === "Enter" && !$("radioBtn").disabled) startRadio(); });`.

- [ ] **Step 7: Add the home CSS**

Append to `css/style.css`:

```css

/* Home view */
:root { --tile-l:22%; }
[data-theme="light"] { --tile-l:82%; }
.app-header { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:24px 0 20px; }
.app-brand { display:flex; align-items:center; gap:10px; min-width:0; }
.app-brand-icon { font-size:26px; color:var(--lastfm-red-text); flex-shrink:0; }
.app-brand h1 { font-size:18px; font-weight:800; letter-spacing:-0.3px; }
.app-header-right { display:flex; align-items:center; gap:10px; }
.app-header .theme-toggle { position:static; }
.spotify-badge { display:inline-flex; align-items:center; gap:8px; padding:6px 10px; font-size:13px; }
.status-dot { width:8px; height:8px; border-radius:50%; background:var(--spotify-green); display:inline-block; }
.mosaic { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin-bottom:24px; }
.mosaic-tile { position:relative; aspect-ratio:1; border-radius:8px; overflow:hidden; background:hsl(var(--h) 22% var(--tile-l)); }
.mosaic-img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; opacity:0; transition:opacity 0.4s ease; }
.mosaic-img.loaded { opacity:1; }
.home-headline { font-size:clamp(24px,5vw,32px); font-weight:800; letter-spacing:-0.6px; line-height:1.15; margin-bottom:8px; }
.home-meta { color:var(--text-secondary); font-size:14px; margin-bottom:20px; }
.btn-radio { flex:1 1 100%; padding:14px 20px; font-size:15px; display:inline-flex; align-items:center; justify-content:center; gap:8px; }
.section-heading { font-size:13px; font-weight:600; color:var(--text-secondary); margin-bottom:12px; }
.time-travel { margin-top:32px; border-top:1px solid var(--border-subtle); padding-top:24px; }
.go-row { display:flex; justify-content:flex-start; margin-bottom:20px; }
.mode-pill i, .mood-btn i { margin-right:2px; vertical-align:-1px; }
@media (max-width:520px) { .app-brand h1 { font-size:16px; } .mosaic { gap:4px; } }
```

- [ ] **Step 8: Manual verification**

Reload the served app.
Expected:
1. Not connected: mosaic of 8 colored tiles, the headline, "Enter your Last.fm username to start." (or "<user> · N scrobbles" once a username is saved), the username field, and a green "Connect Spotify" button. No time-travel section.
2. After connecting: the badge shows in the header with a green dot and an icon-only disconnect button; a red "Start radio" button replaces Connect; the "Time travel" heading and pills appear; within about 10 seconds the mosaic tiles fade in real covers (reload within the same tab: they appear instantly from `sessionStorage`).
3. Pressing Enter in the username field starts radio (once Spotify is connected).
4. Time travel still works: pick Random, then Go; the page picker, era panel, and track list appear inside the time-travel section; the Save as Playlist button shows in the track list header.
5. Toggle the theme: tiles, text, and icons are all readable in both themes. Narrow the window to phone width: no horizontal scroll.
6. Open `changelog.html` (footer version link): it still renders its header correctly.

- [ ] **Step 9: Commit**

```bash
git add index.html css/style.css js/radio.js js/ui.js js/app.js
git commit -m "$(cat <<'EOF'
Redesign home: mosaic, headline, Start radio, time-travel section

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Radio view (hero, controls, Up next)

**Files:**
- Modify: `index.html` (insert the radio view at the `<!-- RADIO VIEW -->` comment)
- Modify: `css/style.css` (append radio rules)
- Modify: `js/radio.js` (view functions above the export anchor; extend `startRadio`, `continueRadio`, `radioStop`)
- Modify: `js/player.js` (render hooks, progress bar, heart, seek)

**Interfaces:**
- Consumes (Task 2): `trackMeta`, `radioActive`, `radioRefilling`, `radioTotal`, `RADIO_UPNEXT_ROWS`, `radioStop`, `startRadio`, `continueRadio`.
- Consumes (Task 3): DOM ids `homeView`, `saveSlotTrackList`.
- Consumes (Task 1): `radioFormatPage`, `radioPickPage`.
- Consumes (existing): `escHtml`, `toggleLikeCurrentTrack`, `playerPrev`, `playerPlayPause`, `playerNext`, `likedSet`, `nowPlayingIndex`, `spPut`, `handleReset`.
- Produces: `showRadioView()`, `hideRadioView()`, `radioRenderNow(track, paused)`, `radioRenderQueue()`, `startTuningRoll()`, `stopTuningRoll()`, `leaveRadio()`; DOM ids `radioView`, `saveSlotRadio`, `radioArt`, `radioTrack`, `radioArtist`, `radioPage`, `radioPlay`, `radioHeart`, `radioBar`, `radioFill`, `radioElapsed`, `radioDuration`, `radioUpNext`, `radioTuningPage`.

- [ ] **Step 1: Insert the radio view markup**

In `index.html`, replace the comment `<!-- RADIO VIEW -->` with:

```html
  <section id="radioView" class="radio-view" style="display:none" aria-label="Library radio">
    <div class="radio-top">
      <button class="btn-text" onclick="leaveRadio()"><i class="ph ph-arrow-left" aria-hidden="true"></i> Home</button>
      <h2 class="radio-title">Library radio</h2>
    </div>
    <div class="radio-hero">
      <img id="radioArt" class="radio-art" src="" alt="">
      <div class="radio-hero-text">
        <div class="radio-page" id="radioPage"></div>
        <div class="radio-track" id="radioTrack">Tuning...</div>
        <div class="radio-artist" id="radioArtist"></div>
      </div>
    </div>
    <div class="radio-progress">
      <span id="radioElapsed">0:00</span>
      <div id="radioBar" onclick="seekTo(event)"><div id="radioFill"></div></div>
      <span id="radioDuration">0:00</span>
    </div>
    <div class="radio-controls">
      <button class="radio-btn" id="radioHeart" onclick="toggleLikeCurrentTrack()" aria-label="Save to Liked Songs"><i class="ph ph-heart"></i></button>
      <button class="radio-btn" onclick="playerPrev()" aria-label="Previous"><i class="ph-fill ph-skip-back"></i></button>
      <button class="radio-btn radio-play" id="radioPlay" onclick="playerPlayPause()" aria-label="Play or pause"><i class="ph-fill ph-play"></i></button>
      <button class="radio-btn" onclick="playerNext()" aria-label="Next"><i class="ph-fill ph-skip-forward"></i></button>
      <span id="saveSlotRadio"></span>
    </div>
    <h3 class="radio-upnext-title">Up next</h3>
    <div class="radio-upnext" id="radioUpNext"></div>
  </section>
```

- [ ] **Step 2: Add the radio CSS**

Append to `css/style.css`:

```css

/* Library radio view */
.radio-view { width:100%; padding-bottom:48px; }
.radio-top { display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; }
.radio-title { font-size:18px; font-weight:800; letter-spacing:-0.3px; }
.btn-text { background:none; border:none; color:var(--text-secondary); font-family:inherit; font-size:14px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; padding:8px 0; }
.btn-text:hover { color:var(--text-primary); }
.radio-hero { display:flex; gap:16px; align-items:center; margin-bottom:16px; }
.radio-art { width:110px; height:110px; border-radius:8px; object-fit:cover; background:var(--bg-tertiary); flex-shrink:0; }
.radio-hero-text { min-width:0; }
.radio-page { font-family:'JetBrains Mono',monospace; font-size:12px; color:var(--lastfm-red-text); min-height:16px; }
.radio-track { font-size:22px; font-weight:800; line-height:1.15; margin-top:6px; overflow-wrap:anywhere; }
.radio-artist { font-size:14px; color:var(--text-secondary); margin-top:4px; }
.radio-progress { display:flex; align-items:center; gap:10px; margin-bottom:12px; }
.radio-progress span { font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--text-tertiary); flex-shrink:0; }
#radioBar { flex:1; height:4px; background:var(--bg-tertiary); border-radius:999px; cursor:pointer; }
#radioFill { height:100%; width:0; background:var(--lastfm-red); border-radius:999px; transition:width 0.25s linear; }
.radio-controls { display:flex; align-items:center; justify-content:center; gap:18px; margin-bottom:28px; flex-wrap:wrap; }
.radio-btn { background:none; border:none; color:var(--text-primary); font-size:22px; cursor:pointer; width:44px; height:44px; border-radius:8px; display:inline-flex; align-items:center; justify-content:center; transition:background 0.15s, transform 0.1s; }
.radio-btn:hover { background:var(--bg-tertiary); }
.radio-btn:active { transform:scale(0.96); }
.radio-play { background:var(--text-primary); color:var(--bg-primary); border-radius:999px; }
.radio-play:hover { background:var(--text-secondary); }
.radio-btn.liked { color:var(--lastfm-red-text); }
.radio-upnext-title { font-size:13px; font-weight:600; color:var(--text-secondary); margin-bottom:8px; }
.radio-upnext { background:var(--bg-secondary); border:1px solid var(--border-subtle); border-radius:8px; overflow:hidden; }
.radio-row { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 16px; }
.radio-row:not(:last-child) { border-bottom:1px solid var(--border-subtle); }
.radio-row-text { min-width:0; }
.radio-row-title { font-size:14px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.radio-row-artist { font-size:12px; color:var(--text-tertiary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.radio-row-page { font-family:'JetBrains Mono',monospace; font-size:12px; color:var(--lastfm-red-text); flex-shrink:0; }
.radio-row-tuning .radio-row-title { color:var(--text-secondary); font-weight:500; }
body.radio-mode #player-bar { display:none !important; }
body.radio-mode.has-player { padding-bottom:0; }
@media (max-width:520px) { .radio-art { width:88px; height:88px; } .radio-track { font-size:18px; } }
```

- [ ] **Step 2b: Keep the radio view full width**

`body` is a centered flex column, so `.radio-view { width:100% }` already fills `.container`; no extra rule is needed. (Checked against `body { display:flex; flex-direction:column; align-items:center }` and `.container { width:100%; max-width:680px }`.)

- [ ] **Step 3: Add the view functions to `radio.js`**

Insert above the export anchor:

```js
// =============================================================================
// RADIO VIEW
// =============================================================================
let radioTuneTimer = null;

function radioReducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function startTuningRoll() {
  stopTuningRoll();
  if (radioReducedMotion()) return;
  radioTuneTimer = setInterval(() => {
    const el = $("radioTuningPage");
    if (el && radioTotal) el.textContent = "p." + radioPickPage(radioTotal).toLocaleString("en-US");
  }, 70);
}
function stopTuningRoll() {
  if (radioTuneTimer) { clearInterval(radioTuneTimer); radioTuneTimer = null; }
}

function showRadioView() {
  $("homeView").style.display = "none";
  $("radioView").style.display = "";
  document.body.classList.add("radio-mode");
  $("saveSlotRadio").appendChild($("savePlaylistBtn"));
  radioRenderQueue();
}

function hideRadioView() {
  stopTuningRoll();
  $("radioView").style.display = "none";
  $("homeView").style.display = "";
  document.body.classList.remove("radio-mode");
  $("saveSlotTrackList").appendChild($("savePlaylistBtn"));
  $("radioTrack").textContent = "Tuning...";
  $("radioArtist").textContent = ""; $("radioPage").textContent = "";
  $("radioArt").removeAttribute("src");
  $("radioFill").style.width = "0"; $("radioElapsed").textContent = "0:00"; $("radioDuration").textContent = "0:00";
  $("radioUpNext").innerHTML = "";
}

// Hero: the playing track (SDK track object or Spotify currently-playing item)
function radioRenderNow(track, paused) {
  const meta = trackMeta[nowPlayingIndex];
  const img = track.album && track.album.images && track.album.images[0];
  $("radioArt").src = img ? img.url : (meta && meta.art) || "";
  $("radioTrack").textContent = track.name || (meta && meta.name) || "";
  const artists = (track.artists || []).map(a => a.name).join(", ");
  const album = track.album && track.album.name;
  $("radioArtist").textContent = artists + (album ? " · " + album : "");
  $("radioPage").textContent = meta ? radioFormatPage(meta.page, radioTotal, meta.year) : "";
  $("radioPlay").innerHTML = '<i class="ph-fill ph-' + (paused ? "play" : "pause") + '"></i>';
  radioRenderQueue();
}

// Up next: the matched tracks after the current one, plus a Tuning row while a top-up runs
function radioRenderQueue() {
  const box = $("radioUpNext");
  if (!box) return;
  let html = "", shown = 0;
  for (let i = Math.max(nowPlayingIndex + 1, 0); i < allTrackCount && shown < RADIO_UPNEXT_ROWS; i++) {
    const m = trackMeta[i];
    if (!m) continue;
    html += '<div class="radio-row"><div class="radio-row-text"><div class="radio-row-title">' + escHtml(m.name) + '</div><div class="radio-row-artist">' + escHtml(m.artist) + '</div></div><span class="radio-row-page">p.' + m.page.toLocaleString("en-US") + '</span></div>';
    shown++;
  }
  if (radioRefilling) {
    html += '<div class="radio-row radio-row-tuning"><div class="radio-row-text"><div class="radio-row-title">Tuning...</div></div><span class="radio-row-page" id="radioTuningPage">p.???</span></div>';
    if (!radioTuneTimer) startTuningRoll();
  } else {
    stopTuningRoll();
  }
  box.innerHTML = html;
}

// Back: pause playback and return to the home view
async function leaveRadio() {
  try { await spPut("/me/player/pause", null); } catch (e) {}
  handleReset();
}

```

- [ ] **Step 4: Extend the engine to drive the view**

Edit `startRadio()` in `js/radio.js`:
- After `radioTotal = totalScrobbles;` add `showRadioView();`.
- After `const added = await radioFill(RADIO_INITIAL);` and the stale/empty checks (right before `const token = await getSpotifyToken();`), add `radioRenderQueue();`.

Edit `continueRadio()`:
- Replace `  radioRefilling = true;\n  try {\n    const added = await radioFill(RADIO_REFILL);` with `  radioRefilling = true; radioRenderQueue();\n  try {\n    const added = await radioFill(RADIO_REFILL);`.
- Replace `  } finally {\n    if (sid === radioSession) radioRefilling = false;\n  }` with `  } finally {\n    if (sid === radioSession) { radioRefilling = false; radioRenderQueue(); }\n  }`.

Edit `radioStop()`: replace its body with:

```js
function radioStop() {
  radioActive = false; radioSession++; radioRefilling = false;
  radioCurrentUri = null; radioLastPos = 0;
  hideRadioView();
}
```

(`radioStop()` is called from `beginSession()` and `handleReset()`, both of which run after the DOM exists. `tests/radio-engine.test.js` never calls `radioStop()`; it bumps `radioSession` directly.)

- [ ] **Step 5: Hook the renderers into `player.js`**

Edit 1 (SDK path): `old_string`:

```
    highlightNowPlaying(best);
  }

  // Check liked status and auto-continue whenever the track changes
```

`new_string`:

```
    highlightNowPlaying(best);
  }
  if (radioActive) radioRenderNow(track, state.paused);

  // Check liked status and auto-continue whenever the track changes
```

Edit 2 (polling path): `old_string` = `  radioMaybeRefill(playingUri, data.progress_ms);` and `new_string`:

```
  if (radioActive) radioRenderNow(data.item, !data.is_playing);
  radioMaybeRefill(playingUri, data.progress_ms);
```

Edit 3: replace the whole `updateProgressBar` function with:

```js
function updateProgressBar(position, duration) {
  const pct = duration > 0 ? (position / duration * 100) + "%" : null;
  const fill = $("pb-fill"), elapsed = $("pb-elapsed"), dur = $("pb-duration");
  if (fill && pct) fill.style.width = pct;
  if (elapsed) elapsed.textContent = fmtMs(position);
  if (dur) dur.textContent = fmtMs(duration);
  const rf = $("radioFill"), re = $("radioElapsed"), rd = $("radioDuration");
  if (rf && pct) rf.style.width = pct;
  if (re) re.textContent = fmtMs(position);
  if (rd) rd.textContent = fmtMs(duration);
}
```

Edit 4: replace the whole `seekTo` function with (works for both progress bars):

```js
function seekTo(e) {
  const bar = e.currentTarget;
  if (!bar || !window._stmPlayer || !_sdkDurationMs) return;
  const rect = bar.getBoundingClientRect();
  const pct = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
  const posMs = Math.floor(pct * _sdkDurationMs);
  _sdkPositionMs = posMs;
  window._stmPlayer.seek(posMs);
}
```

Edit 5: replace the whole `updatePlayerBarHeart` function with:

```js
function updatePlayerBarHeart() {
  const btn = $("pb-heart");
  if (!btn || nowPlayingIndex < 0 || !matchedUris[nowPlayingIndex]) return;
  const id = matchedUris[nowPlayingIndex].split(":").pop();
  const liked = likedSet.has(id);
  btn.classList.toggle("liked", liked);
  const rh = $("radioHeart");
  if (rh) { rh.classList.toggle("liked", liked); rh.innerHTML = '<i class="' + (liked ? "ph-fill" : "ph") + ' ph-heart"></i>'; }
}
```

- [ ] **Step 6: Run the automated tests**

Run: `node tests/radio-helpers.test.js && node tests/radio-engine.test.js`
Expected: both print `ok`.

- [ ] **Step 7: Manual verification**

Serve the app, connect Spotify, click **Start radio**.
Expected:
1. The home view is replaced by the radio view; the bottom player bar is hidden.
2. The hero shows the cover, title, "Artist · Album", and a red line like "Page 5,019 of 48,213, 2017". The progress bar advances and time labels update. Clicking the bar seeks.
3. "Up next" lists up to 6 tracks, each with a `p.N` tag. When the queue drops to 2 tracks, a "Tuning..." row appears with a rolling page number (static under reduced motion), then new tracks replace it.
4. The heart fills for a liked track and toggles on click; the pause button swaps to a play icon when paused.
5. "Save as Playlist" sits in the controls row and creates "Time Machine: Library Radio".
6. **Home** pauses playback and returns to the home view; the time-travel track-list header has its Save button again (run Random to check).
7. Click **Home** during the initial "Tuning" (before the first song): you return to the home view, nothing starts playing afterwards, and `allTrackCount` stays 0 in the console.
8. Start radio, then run a time-travel mode from home after pressing Home: the radio view does not reappear.

- [ ] **Step 8: Commit**

```bash
git add index.html css/style.css js/radio.js js/player.js
git commit -m "$(cat <<'EOF'
Add radio view with hero, controls, and Up next queue

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Visual system pass (tokens, shape lock, motion, icons)

**Files:**
- Create: `tests/contrast.test.js`
- Modify: `css/style.css`
- Modify: `js/ui.js` (`animatePagePick`, glyph swaps)
- Modify: `js/player.js` (play button icon)
- Modify: `index.html` (player bar glyphs)

**Interfaces:**
- Consumes (Task 3): `--lastfm-red-text` token in `css/style.css` lines 1 and 2.
- Produces: tokens that pass WCAG AA; no other task depends on this one.

- [ ] **Step 1: Write the failing contrast test**

Create `tests/contrast.test.js`. It reads the two token lines at the top of `css/style.css` and checks the text colors against the surfaces they sit on:

```js
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const css = fs.readFileSync(path.join(__dirname, "..", "css", "style.css"), "utf8").split("\n");
function tokens(line) {
  const out = {};
  for (const m of line.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}
const dark = tokens(css[0]);
const light = { ...dark, ...tokens(css[1]) };

function lum(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const texts = ["text-primary", "text-secondary", "text-tertiary", "text-muted", "lastfm-red-text"];
const surfaces = ["bg-primary", "bg-secondary", "bg-tertiary"];
const failures = [];
for (const [theme, t] of [["dark", dark], ["light", light]]) {
  for (const tx of texts) for (const sf of surfaces) {
    const r = ratio(t[tx], t[sf]);
    if (r < 4.5) failures.push(theme + ": " + tx + " on " + sf + " = " + r.toFixed(2));
  }
}
assert.deepEqual(failures, [], "Contrast below 4.5:1:\n" + failures.join("\n"));
console.log("contrast: ok");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/contrast.test.js`
Expected: FAIL listing pairs such as `dark: text-tertiary on bg-primary` and `light: text-tertiary on bg-primary` below 4.5.

- [ ] **Step 3: Fix the tokens**

In `css/style.css` line 1 (dark), replace `--text-secondary:#a0a0a8; --text-tertiary:#606068; --text-muted:#404048;` with `--text-secondary:#b4b4bc; --text-tertiary:#92929c; --text-muted:#80808a;`.

In line 2 (light), replace `--text-tertiary:#a1a1aa; --text-muted:#d4d4d8;` with `--text-tertiary:#5f5f68; --text-muted:#6b6b74;`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/contrast.test.js`
Expected: prints `contrast: ok`. If a pair still fails, darken (light theme) or lighten (dark theme) that one token by a few points and rerun.

- [ ] **Step 5: Sweep small red text, radii, and tiny type in `style.css`**

Run (Git Bash, from the repo root):

```bash
sed -i -E 's/([^-a-z])color:var\(--lastfm-red\)/\1color:var(--lastfm-red-text)/g' css/style.css
sed -i -E 's/border-radius: ?(4|6|10|12|14)px/border-radius:8px/g; s/border-radius: ?20px/border-radius:999px/g' css/style.css
sed -i -E 's/font-size: ?10px/font-size:11px/g' css/style.css
grep -n "border-radius" css/style.css | grep -v "8px\|999px\|50%\|2px\|3px"
grep -n "font-size:10px\|font-size: 10px" css/style.css
```

Expected: the two `grep` commands print nothing (every radius is 8px, 999px, 50%, or a 2 to 3px bar; no 10px font sizes remain). Note: the `changelog.html` page shares this stylesheet and picks up the same radii and colors.

- [ ] **Step 6: Remove glows and decoration**

In `css/style.css`:
1. Delete the `body::after { ... }` rule (the red radial glow) and change the next line `[data-theme="light"] body::before, [data-theme="light"] body::after { display:none; }` to `[data-theme="light"] body::before { display:none; }`.
2. In `.btn-primary:hover:not(:disabled)` remove `box-shadow:0 4px 20px var(--lastfm-red-glow);`.
3. Delete the `@keyframes pulse-glow { ... }` line and the `.btn-primary.ready { animation:pulse-glow 2.5s ease-in-out infinite; }` line.
4. In both `.era-timeline-slider::-webkit-slider-thumb` and `.era-timeline-slider::-moz-range-thumb` remove `box-shadow:0 0 8px var(--lastfm-red-glow);`.
5. In `.header-icon` remove `box-shadow:0 4px 16px rgba(213,16,7,0.3);` (still used by `changelog.html`).

Then run `grep -n "glow" css/style.css`. Expected: only the `--lastfm-red-glow` token definitions and the `:focus` ring rules (`box-shadow:0 0 0 3px var(--lastfm-red-glow)`) remain. Focus rings are kept on purpose.

- [ ] **Step 7: Left-align modes and add the reduced-motion block**

In `css/style.css`:
1. In `.mode-selector { ...justify-content:center...}` change `justify-content:center` to `justify-content:flex-start`; do the same in `.mode-inputs`. In `.mood-grid` remove `margin-left:auto; margin-right:auto;`.
2. Append:

```css

/* Reduced motion: everything collapses to static */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation:none !important; transition:none !important; scroll-behavior:auto !important; }
}
```

- [ ] **Step 8: Reduced motion in JS and the last glyphs**

In `js/ui.js`, replace `animatePagePick` with:

```js
function animatePagePick(final, total) {
  return new Promise(res => {
    const el = $("pageNumber");
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = final.toLocaleString(); res(); return; }
    let i = 0; el.classList.add("spinning");
    const iv = setInterval(() => {
      i++; el.textContent = (Math.floor(Math.random() * total) + 1).toLocaleString();
      if (i >= 22) { clearInterval(iv); el.textContent = final.toLocaleString(); el.classList.remove("spinning"); res(); }
    }, 70);
  });
}
```

In `js/ui.js` `renderTrackRow`, replace `'<div class="track-art-placeholder">♪</div>'` with `'<div class="track-art-placeholder"><i class="ph ph-music-note" aria-hidden="true"></i></div>'` and `<span class="play-icon">▶</span>` with `<span class="play-icon"><i class="ph-fill ph-play" aria-hidden="true"></i></span>`.

In `js/player.js` `onSDKStateChange`, replace `if (playBtn) playBtn.textContent = state.paused ? "▶" : "⏸";` with `if (playBtn) playBtn.innerHTML = '<i class="ph-fill ph-' + (state.paused ? "play" : "pause") + '"></i>';`.

In `index.html`, in the player bar replace the three control buttons' glyphs: `&#9198;` with `<i class="ph-fill ph-skip-back"></i>`, `&#9654;` (inside `pb-play`) with `<i class="ph-fill ph-play"></i>`, and `&#9197;` with `<i class="ph-fill ph-skip-forward"></i>`.

- [ ] **Step 9: Remove visible em-dashes**

Run: `grep -n "—" index.html js/*.js`.
Expected before the fix: the page-picker default text was already replaced in Task 3 with `-`, so any remaining hits are in code comments or historical strings. For each hit that is visible text in the UI (status messages, labels, placeholders), replace `—` with a hyphen, comma, or period. Leave `changelog.html` history entries and code comments as they are. Then rerun the grep and confirm no visible-text hits remain.

- [ ] **Step 10: Run all automated tests**

Run: `node tests/radio-helpers.test.js && node tests/radio-engine.test.js && node tests/contrast.test.js`
Expected: all three print `ok`.

- [ ] **Step 11: Manual verification**

Reload the served app and check both themes and phone width.
Expected:
1. No glows; buttons, inputs, panels, tiles, and covers share one 8px radius; chips are pill-shaped.
2. All secondary and muted text is readable in dark and light.
3. With OS "reduce motion" enabled: no fades, no page-number roll (Random mode shows the final page immediately), no tuning roll.
4. Player bar icons, track-row play icons, and the time-travel pills all use Phosphor icons; no emoji remain in the app UI.
5. Time-travel modes, era panel slider, and autocomplete still work.

- [ ] **Step 12: Commit**

```bash
git add css/style.css js/ui.js js/player.js index.html tests/contrast.test.js
git commit -m "$(cat <<'EOF'
Apply visual system: contrast tokens, shape lock, reduced motion, icons

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Docs, version, and final verification

**Files:**
- Modify: `CLAUDE.md`
- Modify: `ROADMAP.md`
- Modify: `changelog.html`
- Modify: `index.html` (version comment and footer)

**Interfaces:**
- Consumes: everything above. Produces: documentation only.

- [ ] **Step 1: Update `CLAUDE.md`**

1. In the **Development** section, replace the first sentence `No build step, no package manager, no test suite, no linter -- there is nothing to install or compile.` with `No build step, no package manager, no linter -- there is nothing to install or compile. A few dependency-free Node scripts in \`tests/\` cover the pure radio helpers, the radio engine (network stubbed), and CSS contrast; run them with \`node tests/radio-helpers.test.js\`, \`node tests/radio-engine.test.js\`, and \`node tests/contrast.test.js\`.`
2. In the **File Structure** block, add `  radio.js          -- Library Radio: pure helpers, engine (radioFill/startRadio/continueRadio),\n                       radio view rendering, home mosaic` after the `player.js` entry, and add `tests/               -- node test scripts (see Development)` after the `css/` entry.
3. In **Script Load Order**, insert `<script src="js/radio.js"></script>     <!-- uses player.js + spotify.js; before modes.js -->` between `player.js` and `modes.js`.
4. Add a new section before **Key Quirks and Gotchas**:

```markdown
## Library Radio

Start radio plays an endless stream of random scrobbles from the user's whole history.

- **Sampling:** `getLastFmScrobbleAt(user, page)` calls `user.getrecenttracks` with `limit=1`; with `limit=1`, `page` is an index into the scrobbles, so `radioPickPage(total)` is uniform over history. Songs played more often come up more often.
- **Engine (`radio.js`):** `radioFill(want)` fires `RADIO_CONCURRENCY` parallel single-scrobble requests per round, dedupes by `artist||track` (`radioSeen`) and by Spotify URI, matches with `spotifySearch()`, and appends to `matchedUris` / `allTrackCount` / `sessionQueue` / `trackMeta[index]`.
- **Top-up:** `radioMaybeRefill()` runs on every track change (SDK state handler and polling fallback). When `RADIO_LOW_WATER` tracks remain it calls `continueRadio()`, which re-issues `spotifyPlay()` from the current track with the new tracks appended (same approach as `continueMatching`, avoids the persistent user queue).
- **Stale work:** every start/stop bumps `radioSession`; in-flight fills compare against it and bail. `beginSession()` and `handleReset()` call `radioStop()`.
- **Views:** `#homeView` (mosaic, Start radio, `#timeTravel` section) and `#radioView` (hero, controls, Up next). `showRadioView()` moves the shared `#savePlaylistBtn` into `#saveSlotRadio`; `hideRadioView()` moves it back to `#saveSlotTrackList`. `body.radio-mode` hides the bottom player bar.
- **Back:** `leaveRadio()` pauses Spotify and calls `handleReset()`.
- **Icons:** Phosphor web font from jsDelivr (regular and fill stylesheets in `index.html`).
```

5. Change `## Current Version: v2.3` to `## Current Version: v2.4`.
6. In the **Quick Reference** table add rows:

```markdown
| `startRadio()` | radio.js | Start Library Radio (random scrobbles, endless) |
| `radioFill(want)` | radio.js | Pick, dedupe, match, and append random tracks |
| `continueRadio()` | radio.js | Top up the queue and re-issue playback |
| `radioStop()` | radio.js | Stop radio and invalidate in-flight fills |
| `getLastFmScrobbleAt(user, page)` | lastfm.js | One scrobble at a 1-based history position |
```

- [ ] **Step 2: Update `ROADMAP.md`**

Add above `## v2.2 (current) ✅` and change that heading to `## v2.2 ✅`:

```markdown
## v2.4 (current) ✅

- [x] Library Radio: endless stream of random scrobbles from the whole Last.fm history
- [x] Radio-first redesign: cover mosaic home, radio view with Up next, time travel as secondary
- [x] Contrast, shape, and reduced-motion pass; Phosphor icons

---

```

- [ ] **Step 3: Add the changelog entry**

In `changelog.html`, insert before the v2.2 `<div class="changelog-entry">` (the one whose `<h2>` is `v2.2`):

```html
    <div class="changelog-entry">
      <div class="changelog-version">
        <h2>v2.4</h2>
        <span class="date">2026-09-30</span>
        <span class="tag tag-major">Major</span>
      </div>
      <ul class="changelog-list">
        <li><strong>Library Radio</strong>: one click plays an endless stream of tracks picked at random from your entire Last.fm history, each from a different point in time</li>
        <li><strong>New home</strong>: a mosaic of covers from your library, your scrobble count, and time travel tucked under its own heading</li>
        <li><strong>Radio view</strong>: now playing with the page each song came from, controls, an Up next list, and Save as Playlist</li>
        <li><strong>Polish</strong>: higher-contrast text in both themes, one consistent corner radius, icons instead of emoji, and reduced-motion support</li>
      </ul>
    </div>

```

- [ ] **Step 4: Bump the version strings in `index.html`**

1. In the top comment, after the `v2.2  2026-03-26  ...` line, add `  v2.4  2026-09-30  Library Radio + radio-first redesign`.
2. In the footer, change `>v2.2</a>` to `>v2.4</a>`.

- [ ] **Step 5: Final verification**

Run: `node tests/radio-helpers.test.js && node tests/radio-engine.test.js && node tests/contrast.test.js`
Expected: all print `ok`.

Then walk the spec's verification list in a browser (served over HTTP, Spotify Premium):
1. Connect, enter a username, Start radio: playback starts and the hero updates.
2. Let 30+ tracks play (skip quickly): every track shows a different page tag and none repeats.
3. Let the queue run low: it tops up without a gap; skip quickly several times with no stall and no duplicate refill.
4. Like a track, then Save as Playlist: the playlist contains the radio tracks.
5. Run each time-travel mode: behavior matches the pre-redesign app.
6. Block `ws.audioscrobbler.com` in dev tools while radio runs: the "Last.fm is slow, retrying..." message appears and playback continues from the queue; unblock and confirm it recovers.
7. Toggle light/dark and phone width: contrast and layout hold, no horizontal scroll.
8. Enable reduced motion: animations stop.
9. Use a Last.fm account with fewer than 200 scrobbles if available: the small-library note shows and the stream ends gracefully.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md ROADMAP.md changelog.html index.html
git commit -m "$(cat <<'EOF'
Document Library Radio and bump version to v2.4

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage.**
- Section 1 (intent, success criteria): Tasks 2 and 6 verify one-click start, uniform random, no repeats, never dry, existing features intact.
- Section 3 (engine): Task 1 (helpers), Task 2 (pick, dedupe, match, play, top-up, state, failure handling, notice for small libraries). Section 3.3's `page`/`year` metadata lives in `trackMeta`. Section 3.5 (unchanged items) respected.
- Section 4.2 (home): Task 3. Section 4.3 (radio view): Task 4. Section 4.4 (visual system: tokens, theme lock, shape lock, type, copy, icons, motion, layout): Tasks 3 to 5. Mosaic behavior (placeholders then real covers) is in Task 3.
- Section 5 (files touched): all listed files are touched; `modes.js` only for the one-line `beginSession()` edit, as the spec's "handlers reused as-is" requires.
- Section 6 (verification): Task 6 step 5 repeats the nine checks.
- Section 7 (risks): rate limits (concurrency cap and backoff in Task 2), match rate (silent replacement), large change (isolated `radio.js`).

**Placeholder scan.** No TBD/TODO. Every code step shows the code; edits give exact anchors. Task 5 step 9 depends on what `grep` finds, which cannot be known in advance, so it states the rule (replace visible-text em-dashes, leave history and comments) and the expected final state.

**Type and name consistency.** `radioFill`, `radioCollectBatch`, `radioSleep`, `radioStop`, `radioMaybeRefill`, `continueRadio`, `startRadio`, `trackMeta` fields (`name`, `artist`, `album`, `page`, `year`, `art`), and the DOM ids match across Tasks 2 to 4. `radioCoverUrl(hit, size)` is called with `"medium"` in Task 3 and with no size in Task 2, matching its Task 1 signature.

**Review Focus coverage.** Items 1 (Task 1 tests), 2 to 5 (Task 2 tests 3, 4, 5/6, 7).
