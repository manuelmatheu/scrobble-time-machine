# Time Travel in the Radio View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Time Travel mode plays inside the Library Radio view (hero, controls, play counts, artist bio, Save as Playlist, full clickable track list), with no page numbers anywhere.

**Architecture:** All nine modes already end in `matchAndPlay()`, so that function opens the radio view in "travel" mode. The era panel and track list move into the radio view keeping their ids, so the existing matching, auto-loading, highlighting, hearts and playlist code keep working untouched. The artist info lookup gets a fallback to Last.fm track objects. Page-number UI and wording are removed.

**Tech Stack:** Vanilla HTML/CSS/JS, node scripts for the pure logic, live checks through the local static server and Chrome.

**Spec:** `docs/superpowers/specs/2026-09-30-time-travel-radio-view-design.md`

## Global Constraints

- Vanilla HTML/CSS/JS, no build step, no modules, script order matters (`radio.js` stays after `player.js`, before `modes.js`).
- Colors through existing CSS custom properties; 8px shape lock; no em-dashes in visible text; 11px minimum functional text; reduced motion respected.
- Keep every existing element id and function name used by the modes (`eraPanel`, `trackListWrapper`, `trackList`, `matchCount`, `savePlaylistBtn`, `setTrackStatus`, `updateTrackArt`, `highlightNowPlaying`, `playFromTrack`, `checkLikedTracks`, `continueMatching`).
- Do not change how any mode finds its tracks.
- Regexes and other backslashes in JS must be written with the Edit/Write tools, not shell heredocs (the shell layer drops backslashes).
- HTML comments ASCII only.
- No commit skips hooks; commits end with the Co-Authored-By and Claude-Session lines.

## Review Focus

1. Songs from the previous session keep playing while a new mode loads. Expected: their player events never drive the new hero or progress bar (this was the stale-progress bug).
2. A mode fails after the view opened (no matches, no device). Expected: back on the home view with the error in the status bar.
3. The Random slider is released. Expected: the view refreshes in place (one hero, one list, no duplicates).
4. Tracks without scrobble dates (for example a mode that returns none). Expected: the playlist label falls back to "Random" instead of "undefined".
5. Radio started right after a travel session. Expected: no leftover era panel, track list, or Again button.

---

## File Structure

| File | Change |
|---|---|
| `js/radio.js` | `radioEraLabel` helper, `radioInfoSource`, `radioInfoFor` fallback, `showRadioView(mode)`, `hideRadioView`, `radioResetHero`, `travelAgain`, exports |
| `js/config.js` | `travelActive`, `radioHeroLive` |
| `js/player.js` | `matchAndPlay` opens the travel view and labels with the era; hooks for travel; failure paths leave the view; progress gated by `radioHeroLive` |
| `js/ui.js` | slider labels, `handleReset`, remove `animatePagePick` |
| `js/modes.js` | `handleGoRandom`, `beginSession`, mood status |
| `index.html` | move era panel and track list into the radio view; title id, Again button; remove page card |
| `css/style.css` | remove page card rules; top-bar layout |
| `tests/radio-helpers.test.js`, `tests/radio-engine.test.js` | new cases |
| `CLAUDE.md`, `ROADMAP.md`, `changelog.html` | docs |

---

### Task 1: Pure logic with tests (era label, info source)

**Files:**
- Modify: `js/radio.js`, `js/config.js` (no change here), `tests/radio-helpers.test.js`, `tests/radio-engine.test.js`

**Interfaces:**
- Produces: `radioEraLabel(tracks: object[]): string` (oldest track's date as "March 13, 2012" when all tracks share a day, else "March 2012"; `"Random"` when no track has a date); `radioInfoSource(idx: number): {artist: string, track: string}|null` (from `trackMeta[idx].lfmArtist/lfmTrack`, else from `currentTracks[idx]`); `radioInfoFor(idx)` now uses `radioInfoSource`.

- [ ] **Step 1: Write the failing tests**

In `tests/radio-helpers.test.js`, before `console.log("radio helpers: ok");`, add:

```js
// radioEraLabel: playlist/status label for a set of Last.fm tracks
const dayLabel = uts => new Date(uts * 1000).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
const monthLabel = uts => new Date(uts * 1000).toLocaleDateString("en-US", { year: "numeric", month: "long" });
const sameDay = [{ date: { uts: "1331640000" } }, { date: { uts: "1331639000" } }];
assert.equal(r.radioEraLabel(sameDay), dayLabel(1331639000));
const spread = [{ date: { uts: "1331640000" } }, { date: { uts: "1321640000" } }];
assert.equal(r.radioEraLabel(spread), monthLabel(1321640000));
assert.equal(r.radioEraLabel([{ name: "no date" }]), "Random");
assert.equal(r.radioEraLabel([]), "Random");
```

In `tests/radio-engine.test.js`, before `console.log("radio engine: ok");`, add:

```js
  // 18. radioInfoSource / radioInfoFor fall back to Last.fm track objects (time travel has no trackMeta)
  reset(); artistCalls = 0; trackCalls = 0; failArtist = false;
  run("currentTracks = [{ name: 'Ready To Start', artist: { '#text': 'Arcade Fire' } }, { name: 'Wake Up', artist: { name: 'Arcade Fire' } }];");
  assert.deepEqual(run("radioInfoSource(0)"), { artist: "Arcade Fire", track: "Ready To Start" });
  assert.deepEqual(run("radioInfoSource(1)"), { artist: "Arcade Fire", track: "Wake Up" });
  assert.equal(run("radioInfoSource(5)"), null);
  const travelInfo = await run("radioInfoFor(0)");
  assert.equal(travelInfo.artist, "Arcade Fire");
  assert.equal(travelInfo.plays, 62);
  assert.equal(travelInfo.trackPlays, 1);
  // trackMeta still wins when present (radio)
  run("trackMeta = { 0: { lfmArtist: 'Radio Artist', lfmTrack: 'Radio Song' } };");
  assert.deepEqual(run("radioInfoSource(0)"), { artist: "Radio Artist", track: "Radio Song" });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/radio-helpers.test.js 2>&1 | grep -m1 Error; node tests/radio-engine.test.js 2>&1 | grep -m1 Error`
Expected: `TypeError: r.radioEraLabel is not a function` and `ReferenceError: radioInfoSource is not defined`.

- [ ] **Step 3: Implement**

In `js/radio.js`, add above `// How many matched tracks come after currentUri` (pure section):

```js
// Label for a set of Last.fm tracks: the oldest date, to the day when all tracks share one
function radioEraLabel(tracks) {
  const uts = (tracks || []).filter(t => t && t.date && t.date.uts).map(t => parseInt(t.date.uts, 10));
  if (!uts.length) return "Random";
  const oldest = new Date(Math.min(...uts) * 1000), newest = new Date(Math.max(...uts) * 1000);
  const sameDay = oldest.toDateString() === newest.toDateString();
  return oldest.toLocaleDateString("en-US", sameDay ? { year: "numeric", month: "long", day: "numeric" } : { year: "numeric", month: "long" });
}

```

Replace the top of `radioInfoFor` (from `async function radioInfoFor(idx) {` through the `const aKey ... tKey ...` line) with:

```js
// Last.fm names for the track at idx: the radio's scrobble names, or the time-travel track objects
function radioInfoSource(idx) {
  const m = trackMeta[idx];
  if (m && m.lfmArtist) return { artist: m.lfmArtist, track: m.lfmTrack };
  const t = currentTracks[idx];
  if (!t) return null;
  const artist = (t.artist && (t.artist["#text"] || t.artist.name)) || "";
  return artist && t.name ? { artist, track: t.name } : null;
}

async function radioInfoFor(idx) {
  const src = radioInfoSource(idx);
  if (!src) return null;
  const user = radioUser;
  const aKey = src.artist.toLowerCase(), tKey = radioTrackKey(src.artist, src.track);
```

and in the same function replace every `m.lfmArtist` with `src.artist` and `m.lfmTrack` with `src.track` (four places: the two `getLastFm*Info` calls and the returned object). Add `radioEraLabel` to the `module.exports` list.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/radio-helpers.test.js && node tests/radio-engine.test.js && node tests/contrast.test.js`
Expected: three `ok` lines.

- [ ] **Step 5: Commit**

```bash
git add js/radio.js tests/radio-helpers.test.js tests/radio-engine.test.js
git commit -m "$(cat <<'EOF'
Add era label and track-object fallback for artist info

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018j2ofAvBqL7MngZnPvpSWW
EOF
)"
```

---

### Task 2: Remove page numbers

**Files:**
- Modify: `index.html`, `css/style.css`, `js/modes.js`, `js/ui.js`, `js/player.js`

**Interfaces:**
- Consumes (Task 1): `radioEraLabel(tracks)`.
- Produces: no page card; slider label `"<pct>% back in time"`; `matchAndPlay` always labels with `label || radioEraLabel(tracks)`.

- [ ] **Step 1: Remove the page card markup and CSS**

In `index.html` delete these three lines (the `pagePicker` block):

```html
      <div class="page-picker" id="pagePicker" style="display:none"><div class="page-picker-card">
        <span class="page-picker-label">Page</span><span class="page-picker-number" id="pageNumber">-</span>
        <span class="page-picker-total" id="pageTotal">of ...</span></div></div>
```

Run:

```bash
sed -i '/^    \.page-picker/d; /@keyframes spin-num/d' css/style.css
sed -i 's/ \.page-picker-number { font-size:40px; min-width:140px; } \.page-picker-card { padding:20px 36px; }//' css/style.css
grep -n "page-picker\|spin-num" css/style.css
```

Expected: the final `grep` prints nothing.

- [ ] **Step 2: Remove the page card JS and reword statuses**

In `js/modes.js`, `handleGoRandom`: delete the line starting `$("pagePicker").style.display = "";`, change `showStatus("Spinning the wheel…");` to `showStatus("Picking a random moment…");`, delete the line `await animatePagePick(page, totalPages);`, change `showStatus("Loading page " + page.toLocaleString() + "…");` to `showStatus("Loading that moment…");`, and change `throw new Error("No tracks on this page");` to `throw new Error("No tracks found for that moment");`. In `beginSession`, change `$("pagePicker").style.display = "none"; $("eraPanel").style.display = "none";` to `$("eraPanel").style.display = "none";`. In the mood handler change `showStatus("Found " + bestCount + " " + moodLabel + " tracks on page " + bestPage.toLocaleString());` to `showStatus("Found " + bestCount + " " + moodLabel + " tracks");`.

In `js/ui.js`: delete the whole `animatePagePick` function; in `handleReset` change `$("pagePicker").style.display = "none"; $("eraPanel").style.display = "none";` to `$("eraPanel").style.display = "none";`; replace the three slider labels:
- in `renderEraPanel`: `'<div class="era-timeline-pct" id="timelinePct">Page '+page.toLocaleString()+' of '+totalPages.toLocaleString()+' · '+pct+'%</div>'` becomes `'<div class="era-timeline-pct" id="timelinePct">'+pct+'% back in time</div>'`;
- in `updateEraInfo`: `s("timelinePct","Page "+page.toLocaleString()+" of "+tp.toLocaleString()+" · "+pct+"%");` becomes `s("timelinePct",pct+"% back in time");`;
- in `onSliderInput`: `p.textContent="Page "+pg.toLocaleString()+" of "+cachedTotalPages.toLocaleString()+" · "+pct+"%";` becomes `p.textContent=pct+"% back in time";`.

In `js/player.js`: in `fetchAndPlay` change `showStatus("Loading page "+page.toLocaleString()+"…");` to `showStatus("Loading that moment…");` and `throw new Error("No tracks on this page");` to `throw new Error("No tracks found for that moment");`; in `matchAndPlay` replace the two lines

```js
  playlistLabel = label || (page ? "Page " + page.toLocaleString() : "Random");
```
with
```js
  const eraLabel = label || radioEraLabel(tracks);
  playlistLabel = eraLabel;
```
and
```js
  const where = label || (page ? "page " + page.toLocaleString() : "");
```
with
```js
  const where = eraLabel === "Random" ? "" : eraLabel;
```

- [ ] **Step 3: Verify statically**

Run:

```bash
for f in js/*.js; do node --check "$f" || echo FAIL $f; done
grep -n "pagePicker\|pageNumber\|pageTotal\|animatePagePick\|Spinning the wheel\|on page\|from page" js/*.js index.html css/style.css
node tests/radio-helpers.test.js && node tests/radio-engine.test.js && node tests/contrast.test.js
```

Expected: no `FAIL`, the `grep` prints nothing, and three `ok` lines.

- [ ] **Step 4: Commit**

```bash
git add index.html css/style.css js/modes.js js/ui.js js/player.js
git commit -m "$(cat <<'EOF'
Remove page numbers from Time Travel

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018j2ofAvBqL7MngZnPvpSWW
EOF
)"
```

---

### Task 3: Travel view

**Files:**
- Modify: `index.html`, `css/style.css`, `js/config.js`, `js/radio.js`, `js/player.js`

**Interfaces:**
- Consumes: `radioEraLabel`, `radioInfoSource` (Task 1); `matchAndPlay` label from Task 2.
- Produces: `showRadioView(mode)` with `mode` `"radio"` (default) or `"travel"`; globals `travelActive`, `radioHeroLive`; `travelAgain()`; `radioResetHero()`; DOM ids `radioTitle`, `radioAgainBtn`, `radioUpNextBlock`.

- [ ] **Step 1: Restructure the markup**

In `index.html`:
1. Delete the `eraPanel` line and the whole `trackListWrapper` block from inside `#timeTravel` (from `<div class="era-panel" id="eraPanel" ...></div>` through the closing `</div></div>` after `<div class="track-list" id="trackList"></div>`).
2. In `#radioView`, replace the `radio-top` block with:

```html
    <div class="radio-top">
      <div class="radio-top-left">
        <button class="btn-text" onclick="leaveRadio()"><i class="ph ph-arrow-left" aria-hidden="true"></i> Home</button>
        <button class="btn-text" id="radioAgainBtn" onclick="travelAgain()" style="display:none"><i class="ph ph-arrow-clockwise" aria-hidden="true"></i> Again</button>
      </div>
      <h2 class="radio-title" id="radioTitle">Library radio</h2>
    </div>
    <div class="era-panel" id="eraPanel" style="display:none"></div>
```

3. Replace the `saveSlotRadio` span with `<span id="saveSlotRadio"><button class="btn-save-playlist" id="savePlaylistBtn" onclick="saveAsPlaylist()" style="display:none">Save as Playlist</button></span>`.
4. Replace the Up next heading and list with:

```html
    <div id="radioUpNextBlock">
      <h3 class="radio-upnext-title">Up next</h3>
      <div class="radio-upnext" id="radioUpNext"></div>
    </div>
    <div class="track-list-wrapper" id="trackListWrapper" style="display:none">
      <div class="track-list-header"><h3>Tracks</h3><span class="match-count" id="matchCount"></span></div>
      <div class="track-list" id="trackList"></div>
    </div>
```

(`ph-arrow-clockwise` exists in the regular Phosphor set; verify with `curl -s https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.1/src/regular/style.css | grep -c "ph-arrow-clockwise:before"`, expected `1`.)

- [ ] **Step 2: CSS**

Append to `css/style.css`:

```css

/* Time travel inside the radio view */
.radio-top-left { display:flex; align-items:center; gap:16px; }
.radio-view .era-panel { margin-bottom:24px; }
.radio-view .track-list-wrapper { margin-bottom:24px; }
```

- [ ] **Step 3: State**

In `js/config.js`, before `let trackMeta = {};`, add:

```js
let travelActive = false;       // the radio view is showing a time-travel session
let radioHeroLive = false;      // the hero has a track from the current session (gates the progress bar)
```

- [ ] **Step 4: View functions**

In `js/radio.js` replace `showRadioView` and `hideRadioView` with:

```js
function radioResetHero() {
  radioHeroLive = false;
  $("radioTrack").textContent = "Tuning...";
  $("radioArtist").textContent = "";
  $("radioArt").removeAttribute("src");
  $("radioFill").style.width = "0"; $("radioElapsed").textContent = "0:00"; $("radioDuration").textContent = "0:00";
  $("radioPlay").innerHTML = '<i class="ph-fill ph-play"></i>';
  radioInfoIdx = -1; radioHideInfo();
}

// mode "radio" (default) shows Up next; "travel" shows the era panel and the full track list
function showRadioView(mode) {
  const travel = mode === "travel";
  travelActive = travel;
  $("homeView").style.display = "none";
  $("radioView").style.display = "";
  document.body.classList.add("radio-mode");
  $("radioTitle").textContent = travel ? "Time travel" : "Library radio";
  $("radioAgainBtn").style.display = travel ? "" : "none";
  $("radioUpNextBlock").style.display = travel ? "none" : "";
  radioResetHero();
  if (!travel) radioRenderQueue();
}

function hideRadioView() {
  travelActive = false;
  $("radioView").style.display = "none";
  $("homeView").style.display = "";
  document.body.classList.remove("radio-mode");
  $("radioUpNext").innerHTML = "";
  radioResetHero();
}

// Repeat the last Time Travel mode with the same inputs
function travelAgain() { handleGo(); }
```

In `radioRenderNow`, add `radioHeroLive = true;` as its first statement after `radioSetPaused(paused);`.

- [ ] **Step 5: Player hooks and match flow**

In `js/player.js`:

1. SDK hook: replace `  if (radioActive) radioRenderNow(track, state.paused);` with `  if ((radioActive || travelActive) && uriToIndices[track.uri]) radioRenderNow(track, state.paused);`.
2. Polling hook: replace the block

```js
  if (radioActive) {
    radioRenderNow(data.item, !data.is_playing);
    if (data.item.duration_ms) updateProgressBar(data.progress_ms || 0, data.item.duration_ms);
  }
```
with
```js
  if ((radioActive || travelActive) && uriToIndices[playingUri]) {
    radioRenderNow(data.item, !data.is_playing);
    if (data.item.duration_ms) updateProgressBar(data.progress_ms || 0, data.item.duration_ms);
  }
```
3. `updateProgressBar`: change the radio lines to

```js
  if (radioHeroLive) {
    const rf = $("radioFill"), re = $("radioElapsed"), rd = $("radioDuration");
    if (rf && pct) rf.style.width = pct;
    if (re) re.textContent = fmtMs(position);
    if (rd) rd.textContent = fmtMs(duration);
  }
```
4. `matchAndPlay`: make its first line `showRadioView("travel");` (before `$("trackListWrapper").style.display = "";`).
5. In both `fetchAndPlay` and `fetchAndPlayDirect`, make the first line of the `catch(err) {` block `radioStop();` (so a failure after the view opened returns to the home view; the status is set right after).

- [ ] **Step 6: Verify statically**

Run:

```bash
for f in js/*.js; do node --check "$f" || echo FAIL $f; done
node -e '
const fs=require("fs");
const html=fs.readFileSync("index.html","utf8");
const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
const used=new Set();
for(const f of fs.readdirSync("js")){ const s=fs.readFileSync("js/"+f,"utf8"); for(const m of s.matchAll(/\$\("([A-Za-z0-9_-]+)"\)/g)) used.add(m[1]); }
console.log("missing ids:", [...used].filter(i=>!ids.has(i)).join(", ")||"none");
'
grep -c 'saveSlotTrackList' index.html js/*.js
node tests/radio-helpers.test.js && node tests/radio-engine.test.js && node tests/contrast.test.js
```

Expected: no `FAIL`; missing ids lists only the dynamic ones (`timelineSlider, timelinePct, timelineHint, eraDate, eraAgo, artistSuggestions`); every `saveSlotTrackList` count is `0`; three `ok` lines. If `saveSlotTrackList` still appears in `js/radio.js`, delete the remaining line that moves `savePlaylistBtn`.

- [ ] **Step 7: Commit**

```bash
git add index.html css/style.css js/config.js js/radio.js js/player.js
git commit -m "$(cat <<'EOF'
Show Time Travel in the radio view

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018j2ofAvBqL7MngZnPvpSWW
EOF
)"
```

---

### Task 4: Live verification, docs, and version

**Files:**
- Modify: `CLAUDE.md`, `ROADMAP.md`, `changelog.html`

- [ ] **Step 1: Live checks (local server on `http://127.0.0.1:3000/`, user's Chrome, user not touching the tab)**

Reload the tab, then for each of Random, On This Day, Date (2012, March), Decade, Mood, Artist, Album, First Listen and Streak check, through the page state and screenshots: the radio view opens titled "Time travel"; the era panel shows; the hero shows the playing song (not the previous session's) with progress starting near 0; the info panel shows play counts and bio; the track list shows rows with dates and statuses; the status text has no page number; no console errors. Then check: clicking a row plays it; skipping loads more matches; Again repeats the mode; Home pauses and returns; Random slider release refreshes in place; a failing mode (artist with no history) returns home with an error; starting the radio after a travel session shows no era panel, track list, or Again button.

Expected: every item passes. Any failure is a finding to fix before Step 2.

- [ ] **Step 2: Docs and version**

- `CLAUDE.md`: in the Library Radio section replace the **Views** bullet so it reads: `#homeView` (headline, Start radio, `#timeTravel` inputs) and `#radioView`, which serves both Library Radio and every Time Travel mode (`showRadioView("radio" | "travel")`). Travel shows `#eraPanel` and the full `#trackList` instead of Up next, plus an Again button (`travelAgain()`); `matchAndPlay()` opens it and `fetchAndPlay*` failures call `radioStop()` to return home. Add: `Player events only drive the hero when the track belongs to the current session (uriToIndices), and the radio progress bar is gated by radioHeroLive.` Update the `radioInfoFor` bullet to mention `radioInfoSource` (trackMeta or currentTracks).
- `changelog.html`: in the v2.4 entry add `<li><strong>Time Travel</strong>: every mode now plays in the same view as the radio, with artist bio, your play counts, and Again</li>` and `<li><strong>No page numbers</strong>: moments are described by date instead</li>`.
- `ROADMAP.md`: in the v2.4 list add `- [x] Time Travel in the radio view; page numbers removed`.

- [ ] **Step 3: Final run and commit**

```bash
node tests/radio-helpers.test.js && node tests/radio-engine.test.js && node tests/contrast.test.js
git add CLAUDE.md ROADMAP.md changelog.html
git commit -m "$(cat <<'EOF'
Document Time Travel in the radio view

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018j2ofAvBqL7MngZnPvpSWW
EOF
)"
```

Expected: three `ok` lines, commit created.

---

## Self-Review

- **Spec coverage:** unified view and titles (Task 3), era panel and track list relocation (Task 3), Again (Task 3), error path (Task 3 step 5), info source fallback (Task 1), page numbers removed including slider label, statuses, playlist label (Task 2), stale progress fix (Task 3: `radioResetHero`, `radioHeroLive`, session-only hooks), docs (Task 4), live verification of all nine modes (Task 4).
- **Placeholders:** none; every edit shows the code or the exact old and new text.
- **Names:** `radioEraLabel`, `radioInfoSource`, `showRadioView(mode)`, `radioResetHero`, `travelAgain`, `travelActive`, `radioHeroLive`, `radioTitle`, `radioAgainBtn`, `radioUpNextBlock` are used consistently across tasks.
- **Review Focus:** 1 is covered by the session-only hooks and live step 1; 2, 3, 5 by live step 1; 4 by the `radioEraLabel` fallback test.
