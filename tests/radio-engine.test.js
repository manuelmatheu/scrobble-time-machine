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

  // 12. leaving the radio invalidates the session before it pauses playback
  const order = [];
  global.handleReset = () => order.push("reset");
  global.spPut = async () => { order.push("pause"); };
  await run("leaveRadio()");
  assert.deepEqual(order, ["reset", "pause"]);

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
  global.document.getElementById = id => id === "track-2" ? fakeRow : (travelEls[id] || (travelEls[id] = { style: id === "radioView" ? { display: "none" } : {}, textContent: "", innerHTML: "", classList: { add() {}, remove() {} }, removeAttribute() {} }));
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

  global.document.getElementById = realGetElementById;

  console.log("radio engine: ok");
})().catch(e => { console.error(e); process.exit(1); });
