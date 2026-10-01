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
load("spotify.js");
load("ui.js");
load("player.js");
const realSpotifySearch = global.spotifySearch;  // the real one, before the tests stub it
const realShowStatus = global.showStatus;

function reset() {
  run("matchedUris = {}; allTrackCount = 0; uriToIndices = {}; totalMatched = 0; trackMeta = {}; sessionQueue = new Set(); radioSeen = new Set(); radioTotal = 1000; radioFailures = 0; radioUser = 'tester'; radioActive = true; radioExhausted = false; radioRefilling = false; radioPaused = false; radioPendingReissue = false; sdkReady = false; lastSearchError = null; radioArtistCache = {}; radioTrackCache = {};");
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

  // shared setup for continueRadio cases: one track already queued and playing
  const existing = "matchedUris = { 0: 'spotify:track:Existing' }; allTrackCount = 1; uriToIndices = { 'spotify:track:Existing': [0] }; radioCurrentUri = 'spotify:track:Existing';";
  const defaultSearch = async (token, artist, track) => ({ uri: uriFor(track), name: track, album: { images: [] } });
  let statuses = [], played = [];
  global.showStatus = m => statuses.push(m);
  global.spotifyPlay = async (token, uris) => { played.push(uris); return true; };
  global.checkLikedTracks = () => {};

  // 9. an exhausted library is marked exhausted, says so, and never re-issues playback
  reset(); statuses = []; played = []; global.spotifySearch = defaultSearch;
  run(existing); run("radioSeen = new Set(['artist||song 0']);");
  global.getLastFmScrobbleAt = async () => song(0);
  await run("continueRadio()");
  assert.equal(run("radioExhausted"), true);
  assert.ok(statuses.some(m => /No more new tracks/.test(m)));
  assert.equal(played.length, 0);
  assert.equal(run("radioRefilling"), false);

  // 10. a transient Spotify failure (search error, or no token) must not end the stream
  reset(); statuses = []; played = []; n = 0; run(existing);
  global.getLastFmScrobbleAt = async () => song(n++);
  global.spotifySearch = async () => { run("lastSearchError = 'Rate limited (429)'"); return null; };
  await run("continueRadio()");
  assert.equal(run("radioExhausted"), false);
  assert.ok(!statuses.some(m => /No more new tracks/.test(m)));
  reset(); statuses = []; n = 0; run(existing); global.spotifySearch = defaultSearch;
  global.getSpotifyToken = async () => null;
  await run("continueRadio()");
  assert.equal(run("radioExhausted"), false);
  global.getSpotifyToken = async () => "token";

  // 11. a top-up that finishes while paused must not resume playback; it re-issues on resume
  reset(); played = []; n = 0; global.spotifySearch = defaultSearch; run(existing); run("radioPaused = true;");
  global.getLastFmScrobbleAt = async () => song(n++);
  await run("continueRadio()");
  assert.equal(played.length, 0);
  assert.equal(run("radioPendingReissue"), true);
  run("radioSetPaused(false)");
  await new Promise(r => setImmediate(r));
  assert.equal(played.length, 1);
  assert.equal(played[0][0], "spotify:track:Existing");
  assert.ok(played[0].length > 1);
  assert.equal(run("radioPendingReissue"), false);
  run("radioSetPaused(false)");
  await new Promise(r => setImmediate(r));
  assert.equal(played.length, 1);
  reset(); played = []; n = 100; run(existing);
  await run("continueRadio()");
  assert.equal(played.length, 1);

  // 13. disconnecting Spotify tears the session down
  let resets = 0;
  global.handleReset = () => { resets++; };
  global.updateSpotifyUI = () => {};
  global.localStorage = { removeItem() {}, getItem() { return null; }, setItem() {} };
  run("spotifyToken = 'x'; radioActive = true;");
  run("disconnectSpotify()");
  assert.equal(resets, 1);

  // 14. radioInfoFor composes bio + your play counts from Last.fm getInfo, using the scrobble's own names
  reset();
  run("trackMeta = { 0: { lfmArtist: 'Arcade Fire', lfmTrack: 'Ready To Start' }, 1: { lfmArtist: 'Arcade Fire', lfmTrack: 'Wake Up' }, 2: { lfmArtist: 'Broken', lfmTrack: 'Song' } };");
  let artistCalls = 0, trackCalls = 0, failArtist = false;
  global.getLastFmArtistInfo = async (user, artist) => {
    artistCalls++;
    if (failArtist) throw new Error("down");
    return { artist: { bio: { summary: 'Indie band. <a href="https://l.fm/x">Read more on Last.fm</a>' }, stats: { userplaycount: "62" } } };
  };
  global.getLastFmTrackInfo = async (user, artist, track) => { trackCalls++; return { track: { userplaycount: track === "Ready To Start" ? "1" : "9" } }; };
  assert.deepEqual(await run("radioInfoFor(0)"), { artist: "Arcade Fire", track: "Ready To Start", bioText: "Indie band.", bioUrl: "https://l.fm/x", plays: 62, trackPlays: 1 });
  assert.equal(artistCalls, 1); assert.equal(trackCalls, 1);

  // 15. results are cached per artist and per track
  await run("radioInfoFor(0)");
  assert.equal(artistCalls, 1); assert.equal(trackCalls, 1);
  const second = await run("radioInfoFor(1)");
  assert.equal(second.trackPlays, 9);
  assert.equal(artistCalls, 1); assert.equal(trackCalls, 2);

  // 16. a failing Last.fm call never throws, leaves those fields empty, and is retried next time
  failArtist = true;
  const failed = await run("radioInfoFor(2)");
  assert.equal(failed.bioText, ""); assert.equal(failed.plays, null); assert.equal(failed.trackPlays, 9);
  const callsAfterFail = artistCalls;
  await run("radioInfoFor(2)");
  assert.equal(artistCalls, callsAfterFail + 1);

  // 17. an index with no metadata yields nothing
  assert.equal(await run("radioInfoFor(99)"), null);

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

  // 19. time travel: radioSyncInfo loads the panel from currentTracks (no trackMeta) using the username field
  const realGetElementById = global.document.getElementById;
  const els = {};
  global.document.getElementById = id => els[id] || (els[id] = { style: {}, textContent: "", innerHTML: "", value: id === "usernameInput" ? "tester" : "" });
  global.escHtml = s => s;
  reset();
  run("radioUser = ''; travelActive = true; trackMeta = {}; nowPlayingIndex = 0; radioInfoIdx = -1; currentTracks = [{ name: 'Ready To Start', artist: { '#text': 'Arcade Fire' } }];");
  let seenUser = null;
  global.getLastFmArtistInfo = async (user, artist) => { seenUser = user; return { artist: { bio: { summary: "Indie band." }, stats: { userplaycount: "62" } } }; };
  global.getLastFmTrackInfo = async () => ({ track: { userplaycount: "1" } });
  run("radioSyncInfo()");
  await new Promise(r => setTimeout(r, 20));
  assert.equal(seenUser, "tester");
  assert.match(els.radioStats.innerHTML, /You've listened to/);
  assert.equal(els.radioInfo.style.display, "");
  // 20. time travel uses the username field, never a stale radioUser, and the info caches are per user
  reset();
  run("radioUser = 'stale'; travelActive = true; trackMeta = {}; currentTracks = [{ name: 'Song A', artist: { '#text': 'Band A' } }];");
  const infoUsers = [];
  global.getLastFmArtistInfo = async user => { infoUsers.push(user); return { artist: { bio: { summary: "b" }, stats: { userplaycount: "5" } } }; };
  global.getLastFmTrackInfo = async () => ({ track: { userplaycount: "2" } });
  els.usernameInput.value = "tester";
  await run("radioInfoFor(0)");
  els.usernameInput.value = "other";
  await run("radioInfoFor(0)");
  assert.deepEqual(infoUsers, ["tester", "other"]);

  // 21. stale radio trackMeta must not outrank the time-travel tracks when the radio is not running
  reset();
  run("radioActive = false; travelActive = true; trackMeta = { 0: { lfmArtist: 'Stale Radio Artist', lfmTrack: 'Stale Song' } }; currentTracks = [{ name: 'Song A', artist: { '#text': 'Band A' } }];");
  assert.deepEqual(run("radioInfoSource(0)"), { artist: "Band A", track: "Song A" });
  run("radioActive = true; travelActive = false;");
  assert.deepEqual(run("radioInfoSource(0)"), { artist: "Stale Radio Artist", track: "Stale Song" });

  // 22. Again is ignored while a session is still loading
  let goCalls = 0;
  global.handleGo = () => { goCalls++; };
  run("currentPhase = 'working'"); run("travelAgain()");
  assert.equal(goCalls, 0);
  run("currentPhase = 'done'"); run("travelAgain()");
  assert.equal(goCalls, 1);

  // 23. time travel: following the playing row must not scroll the page away from the hero
  let rowScrolls = 0;
  const fakeRow = { classList: { add() {}, remove() {} }, scrollIntoView() { rowScrolls++; } };
  const travelEls = {};
  global.document.getElementById = id => id === "track-2" ? fakeRow : (travelEls[id] || (travelEls[id] = { style: id === "radioView" ? { display: "none" } : {}, textContent: "", innerHTML: "", classList: { add() {}, remove() {} }, removeAttribute() {}, appendChild() {} }));
  global.document.querySelectorAll = () => [];
  global.document.body = { classList: { add() {}, remove() {} } };
  run("travelActive = true; nowPlayingIndex = -1;"); run("highlightNowPlaying(2)");
  assert.equal(rowScrolls, 0);
  run("travelActive = false; nowPlayingIndex = -1;"); run("highlightNowPlaying(2)");
  assert.equal(rowScrolls, 1);
  // ...and opening the view starts at the top, once (not on every refresh)
  const windowScrolls = [];
  global.window.scrollTo = (x, y) => windowScrolls.push([x, y]);
  run('showRadioView("travel")');
  assert.deepEqual(windowScrolls, [[0, 0]]);
  run('showRadioView("travel")');
  assert.deepEqual(windowScrolls, [[0, 0]]);

  // 24. the radio's Up next rows play from the clicked track onward
  reset(); played = [];
  run("matchedUris = { 0: 'a', 1: 'b', 2: 'c', 3: 'd' }; allTrackCount = 4; trackMeta = { 1: { name: 'B', artist: 'x' }, 2: { name: 'C', artist: 'y' }, 3: { name: 'D', artist: 'z' } }; nowPlayingIndex = 0; radioRefilling = false;");
  run("radioRenderQueue()");
  assert.match(travelEls.radioUpNext.innerHTML, /radioPlayFrom\(2\)/);
  assert.match(travelEls.radioUpNext.innerHTML, /radioPlayFrom\(3\)/);
  assert.doesNotMatch(travelEls.radioUpNext.innerHTML, /radioPlayFrom\(0\)/);
  await run("radioPlayFrom(1)");
  assert.deepEqual(played, [["b", "c", "d"]]);
  await run("radioPlayFrom(9)");
  assert.equal(played.length, 1);
  run("radioActive = false;");
  await run("radioPlayFrom(1)");
  assert.equal(played.length, 1);

  // 25. the status bar sits between the bio and the list in the radio view, and goes back home with it
  const slotEls = {};
  global.document.getElementById = id => slotEls[id] || (slotEls[id] = { id, style: id === "radioView" ? { display: "none" } : {}, textContent: "", innerHTML: "", children: [], classList: { add() {}, remove() {} }, removeAttribute() {}, appendChild(c) { this.children.push(c); } });
  run('showRadioView("travel")');
  assert.ok(slotEls.radioStatusSlot.children.includes(slotEls.statusBar), "status bar should move into the radio view");
  run("hideRadioView()");
  assert.ok(slotEls.statusSlotHome.children.includes(slotEls.statusBar), "status bar should return to the home slot");

  // 26. time travel searches BATCH_SIZE (5) tracks first and loads the rest in batches of 5
  const ttTracks = Array.from({ length: 12 }, (_, i) => ({ name: "TT Song " + i, artist: { "#text": "TT Artist " + i } }));
  reset();
  run("searchCache = {}; skippedPlan = []; isContinuing = false; abortController = { signal: { aborted: false } };");
  let ttSearches = 0;
  global.spotifySearch = async (token, artist, track) => { ttSearches++; return { uri: uriFor(track), name: track, album: { images: [] } }; };
  global.setTrackStatus = () => {}; global.updateTrackArt = () => {}; global.updateMatchCount = () => {};
  global.showStatus = () => {}; global.checkLikedTracks = () => {};
  global.spotifyPlay = async () => true;
  const realSetTimeout = global.setTimeout;
  global.setTimeout = fn => realSetTimeout(fn, 0);
  await run("smartMatch(" + JSON.stringify(ttTracks) + ", 'token')");
  assert.equal(ttSearches, 5);
  assert.equal(run("skippedPlan.length"), 7);
  await run("continueMatching()");
  assert.equal(ttSearches, 10);
  assert.equal(run("skippedPlan.length"), 2);
  global.setTimeout = realSetTimeout;

  // 27. a long Retry-After trips a cooldown: no sleeping, no retries, and later searches make no requests
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls++; return { status: 429, ok: false, headers: { get: () => "30" } }; };
  run("spotifyBlockedUntil = 0; lastSearchError = null;");
  assert.deepEqual(await run("runSpotifySearch('token', 'q')"), { rateLimited: true });
  assert.equal(fetchCalls, 1);
  assert.ok(run("spotifyBlockedFor()") > 25000);
  assert.equal(run("lastSearchError"), "Rate limited (429)");
  run("searchCache = {};");
  assert.equal(await realSpotifySearch("token", "Some Artist", "Some Track"), null);
  assert.equal(fetchCalls, 1, "a blocked search must not call Spotify");
  // a short Retry-After is waited out once and retried
  run("spotifyBlockedUntil = 0; searchCache = {};");
  let shortCalls = 0;
  global.fetch = async () => { shortCalls++; return shortCalls === 1 ? { status: 429, ok: false, headers: { get: () => "1" } } : { status: 200, ok: true, json: async () => ({ tracks: { items: [{ uri: "spotify:track:ok" }] } }) }; };
  const realTimeout = global.setTimeout;
  global.setTimeout = fn => realTimeout(fn, 0);
  assert.deepEqual(await run("runSpotifySearch('token', 'q')"), { item: { uri: "spotify:track:ok" } });
  global.setTimeout = realTimeout;
  assert.equal(run("spotifyBlockedFor()"), 0);

  // 28. time travel: a rate limit stops the batch, keeps the rest pending, and never marks tracks as not found
  run("spotifyBlockedUntil = 0; searchCache = {}; skippedPlan = []; isContinuing = false; abortController = { signal: { aborted: false } };");
  let blockSearches = 0;
  const tstat = {};
  global.setTrackStatus = (i, s) => { tstat[i] = s; };
  global.spotifySearch = async (token, artist, track) => {
    blockSearches++;
    if (blockSearches === 2) { run("spotifyBlockedUntil = Date.now() + 60000; lastSearchError = 'Rate limited (429)'"); return null; }
    return { uri: uriFor(track), name: track, album: { images: [] } };
  };
  global.setTimeout = fn => realTimeout(fn, 0);
  await run("smartMatch(" + JSON.stringify(ttTracks) + ", 'token')");
  assert.equal(blockSearches, 2);
  assert.equal(run("totalMatched"), 1);
  assert.equal(run("skippedPlan.length"), 11);
  assert.equal(tstat[1], "skipped");
  // continuing while blocked makes no searches and says why
  blockSearches = 0;
  const limitMessages = [];
  global.showStatus = m => limitMessages.push(m);
  await run("continueMatching()");
  assert.equal(blockSearches, 0);
  assert.ok(limitMessages.some(m => /Spotify is limiting searches/.test(m)));
  // once the cooldown ends it resumes with the next batch
  run("spotifyBlockedUntil = 0;");
  global.spotifySearch = async (token, artist, track) => { blockSearches++; return { uri: uriFor(track), name: track, album: { images: [] } }; };
  await run("continueMatching()");
  assert.equal(blockSearches, 5);
  global.setTimeout = realTimeout;

  // 29. radio: a rate limit stops the fill, and a cooldown never marks the library exhausted
  reset();
  run("spotifyBlockedUntil = 0; lastSearchError = null;");
  let radioSearches = 0, radioN = 0;
  global.getLastFmScrobbleAt = async () => song(radioN++);
  global.spotifySearch = async (token, artist, track) => {
    radioSearches++;
    if (radioSearches === 2) { run("spotifyBlockedUntil = Date.now() + 60000; lastSearchError = 'Rate limited (429)'"); return null; }
    return { uri: uriFor(track), name: track, album: { images: [] } };
  };
  assert.equal(await run("radioFill(5)"), 1);
  assert.equal(radioSearches, 2);
  radioSearches = 0;
  run("radioExhausted = false; radioRefilling = false; matchedUris = { 0: 'spotify:track:Song_0' }; allTrackCount = 1; radioCurrentUri = 'spotify:track:Song_0';");
  await run("continueRadio()");
  assert.equal(radioSearches, 0);
  assert.equal(run("radioExhausted"), false);
  run("spotifyBlockedUntil = 0;");

  // 28. Home keeps the session running; the home card leads back to it
  {
    const els = {};
    const mk = id => { const cl = new Set(); return { id, style: id === "radioView" ? { display: "none" } : { setProperty(k, v) { this[k] = v; } }, textContent: "", innerHTML: "", className: "", value: "80", children: [], cl, classList: { add: c => cl.add(c), remove: c => cl.delete(c), toggle: (c, on) => (on ? cl.add(c) : cl.delete(c)) }, removeAttribute() {}, appendChild(c) { this.children.push(c); } }; };
    global.document.getElementById = id => els[id] || (els[id] = mk(id));
    global.window.scrollTo = () => {};
    reset();
    run("radioActive = true; travelActive = false;");
    run("showRadioView()");
    assert.equal(els.radioBackBtn.style.display, "none", "no Back to radio while the radio view is showing");
    run("radioMinimize()");
    assert.equal(els.radioView.style.display, "none");
    assert.equal(els.homeView.style.display, "");
    assert.equal(run("radioActive"), true, "minimizing must not stop the radio");
    assert.equal(run("radioMinimized"), true);
    assert.ok(els.statusSlotHome.children.includes(els.statusBar));
    // the home card: Back to radio + Playing now + a secondary Start a new radio
    assert.equal(els.radioBackBtn.style.display, "");
    assert.equal(els.radioPlaying.style.display, "");
    assert.equal(els.radioPlayingTrack.textContent, "Tuning...");
    assert.match(els.radioBtn.className, /btn-ghost/);
    assert.equal(els.radioBtn.innerHTML, "Start a new radio");
    // a track change while hidden updates the line, and a pause says so
    run("trackMeta = { 0: { name: 'Airbag', artist: 'Radiohead' } }; nowPlayingIndex = 0;");
    run("radioRenderNow({ name: 'Airbag', artists: [{ name: 'Radiohead' }], album: { name: 'OK Computer', images: [] } }, false)");
    assert.equal(els.radioPlayingTrack.textContent, "Airbag \u00b7 Radiohead");
    assert.equal(els.radioPlayingState.textContent, "Playing now");
    run("radioRenderNow({ name: 'Airbag', artists: [{ name: 'Radiohead' }], album: { name: 'OK Computer', images: [] } }, true)");
    assert.equal(els.radioPlayingState.textContent, "Paused");
    // the volume slider shows only while the SDK device plays
    assert.ok(!els.radioVolumeWrap.cl.has("sdk"), "no slider without the SDK");
    run("sdkReady = true; window._stmPlayer = { getVolume: async () => 0.35, setVolume() {} };");
    run("radioRenderNow({ name: 'Airbag', artists: [], album: { images: [] } }, false)");
    assert.ok(els.radioVolumeWrap.cl.has("sdk"));
    await new Promise(r => setImmediate(r));
    assert.equal(els.radioVolume.value, 35, "the slider starts from the player's real volume");
    const vols = [];
    run("window._stmPlayer.setVolume = v => globalThis.__vols.push(v);"); global.__vols = vols;
    await run("setVolume({ value: '60', style: { setProperty(k, v) { globalThis.__prop = [k, v]; } } })");
    assert.deepEqual(vols, [0.6]);
    assert.deepEqual(global.__prop, ["--vol", "60%"]);
    await run("setVolume({ value: '999', style: { setProperty() {} } })");
    assert.deepEqual(vols, [0.6, 1], "volume is clamped to 0-100");
    run("sdkReady = false;");
    await run("setVolume({ value: '10', style: { setProperty() {} } })");
    assert.equal(vols.length, 2, "no SDK, no volume call");
    run("radioRenderNow({ name: 'Airbag', artists: [], album: { images: [] } }, false)");
    assert.ok(!els.radioVolumeWrap.cl.has("sdk"), "the slider hides again when the SDK drops");
    run("window._stmPlayer = undefined;");
    run("radioReopen()");
    assert.equal(els.radioView.style.display, "");
    assert.equal(els.homeView.style.display, "none");
    assert.equal(run("radioMinimized"), false);
    assert.ok(els.radioStatusSlot.children.includes(els.statusBar));
    assert.equal(els.radioBackBtn.style.display, "none");
    assert.equal(els.radioPlaying.style.display, "none");
    assert.match(els.radioBtn.className, /btn-primary/);
    assert.match(els.radioBtn.innerHTML, /Start radio/);
    // reopening with nothing minimized does nothing
    els.radioView.style.display = "none"; els.homeView.style.display = "";
    run("radioReopen()");
    assert.equal(els.radioView.style.display, "none");
    // minimizing a view that is not showing, or with no session, does nothing
    run("radioMinimize()");
    assert.equal(run("radioMinimized"), false);
    run("radioActive = false; travelActive = false;"); els.radioView.style.display = "";
    run("radioMinimize()");
    assert.equal(run("radioMinimized"), false);
    // a time travel session minimizes too, and ending the session clears the home card
    run("travelActive = true;"); run("radioMinimize()");
    assert.equal(run("radioMinimized"), true);
    assert.equal(els.radioBackBtn.style.display, "");
    run("hideRadioView()");
    assert.equal(run("radioMinimized"), false);
    assert.equal(els.radioBackBtn.style.display, "none");
    assert.match(els.radioBtn.innerHTML, /Start radio/);
    // Save as Playlist exists only in Time Travel: showing the radio view never touches it
    run('showRadioView("travel")'); run("showRadioView()");
    assert.equal(els.savePlaylistBtn, undefined, "the radio view does not create or show the save button");
  }

  // 29. the status bar only shows errors and warnings; progress and success messages clear it
  {
    const els = {};
    global.document.getElementById = id => els[id] || (els[id] = { id, style: {}, className: "", innerHTML: "", textContent: "" });
    const savedShow = global.showStatus; global.showStatus = realShowStatus;
    global.showStatus("Reading your Last.fm library...", "");
    assert.equal(els.statusBar.style.display, "none", "progress messages are not shown");
    global.showStatus("Spotify is limiting searches.", "error");
    assert.equal(els.statusBar.style.display, "");
    assert.match(els.statusBar.className, /error/);
    assert.equal(els.statusBar.innerHTML, "Spotify is limiting searches.");
    global.showStatus("▶ Library radio", "success");
    assert.equal(els.statusBar.style.display, "none", "a success message clears an old error");
    global.showStatus("Playback moved to another session", "warn");
    assert.equal(els.statusBar.style.display, "");
    assert.match(els.statusBar.className, /warn/);
    global.showStatus = savedShow;
  }

  // 30. Up next keeps a full list: top up as soon as fewer than RADIO_UPNEXT_ROWS tracks remain
  {
    assert.equal(run("RADIO_LOW_WATER"), run("RADIO_UPNEXT_ROWS") - 1);
    const low = run("RADIO_LOW_WATER");
    assert.equal(run("radioShouldRefill({ active: true, refilling: false, exhausted: false, remaining: " + (low + 1) + " }, RADIO_LOW_WATER)"), false);
    assert.equal(run("radioShouldRefill({ active: true, refilling: false, exhausted: false, remaining: " + low + " }, RADIO_LOW_WATER)"), true);
    // the Tuning row only takes a free slot, so the list never grows past its rows
    const q = { id: "radioUpNext", style: { setProperty(k, v) { this[k] = v; } }, innerHTML: "" };
    global.document.getElementById = id => (id === "radioUpNext" ? q : null);
    const meta = {}; for (let i = 1; i <= 8; i++) meta[i] = { name: "T" + i, artist: "A" };
    run("trackMeta = " + JSON.stringify(meta) + "; allTrackCount = 9; nowPlayingIndex = 0; radioRefilling = true;");
    run("radioRenderQueue()");
    assert.equal((q.innerHTML.match(/radio-row-play/g) || []).length, run("RADIO_UPNEXT_ROWS"));
    assert.doesNotMatch(q.innerHTML, /Tuning/, "no Tuning row when the list is already full");
    assert.equal(q.style["--upnext-rows"], run("RADIO_UPNEXT_ROWS"));
    run("allTrackCount = 4;");
    run("radioRenderQueue()");
    assert.equal((q.innerHTML.match(/radio-row-play/g) || []).length, 3);
    assert.match(q.innerHTML, /Tuning/, "a Tuning row fills a free slot while topping up");
    run("radioRefilling = false;");
  }

  global.document.getElementById = realGetElementById;

  console.log("radio engine: ok");
})().catch(e => { console.error(e); process.exit(1); });
