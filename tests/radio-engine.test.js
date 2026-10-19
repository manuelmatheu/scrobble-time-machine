const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

global.window = { location: { origin: "http://localhost", pathname: "/" } };
global.document = { getElementById: () => null, createElement: () => ({ set textContent(v) { this.t = String(v); }, get innerHTML() { return this.t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); } }) };  // enough for escHtml
const load = f => vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), { filename: f });
const run = code => vm.runInThisContext(code);
load("config.js");
load("radio.js");
load("spotify.js");
load("ui.js");
load("player.js");
const realSpotifySearch = global.spotifySearch;  // the real one, before the tests stub it
const realSpotifyPlay = global.spotifyPlay;
const realShowStatus = global.showStatus;

function reset() {
  run("radioCarry = []; matchedUris = {}; allTrackCount = 0; uriToIndices = {}; totalMatched = 0; trackMeta = {}; sessionQueue = new Set(); radioSeen = new Set(); radioTotal = 1000; radioFailures = 0; radioUser = 'tester'; radioActive = true; radioExhausted = false; radioRefilling = false; radioPaused = false; radioPendingReissue = false; sdkReady = false; lastSearchError = null; radioArtistCache = {}; radioTrackCache = {}; radioBuf = { past: [], new: [] }; radioMixCursor = 0;");
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
  assert.equal(meta0.fromPast, true);  // a Library pick is from your history: "From 2017" in the hero and the Up next row
  assert.match(run("radioQueueRowHtml(0, trackMeta[0], s => s)"), /radio-chip past.*From 2017/);

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

  // 12b. with the SDK driving, a finished top-up does not touch playback: it waits for the seam
  reset(); played = []; n = 100; run(existing); run("sdkReady = true; sdkDeviceId = 'dev'; _sdkCurrentUri = 'spotify:track:Existing'; radioContextLastUri = 'spotify:track:Existing'; _sdkDurationMs = 180000; _sdkPositionMs = 12000;");
  global.getLastFmScrobbleAt = async () => song(n++);
  await run("continueRadio()");
  assert.equal(played.length, 0);
  assert.equal(run("radioPendingReissue"), true);
  run("radioMaybeSeam()");  // mid-song: still nothing
  await new Promise(r => setImmediate(r));
  assert.equal(played.length, 0);
  let playOpts = null;
  global.spotifyPlay = async (token, uris, pos, opts) => { played.push(uris); playOpts = opts; return true; };
  run("_sdkPositionMs = 179000;");
  run("radioMaybeSeam(); radioMaybeSeam();");  // two ticks in the window fire once
  await new Promise(r => setImmediate(r));
  assert.equal(played.length, 1);
  assert.notEqual(played[0][0], "spotify:track:Existing");  // starts at the first new track
  assert.ok(played[0].length > 1);
  assert.deepEqual(playOpts, { quick: true });
  assert.equal(run("radioPendingReissue"), false);
  global.spotifyPlay = async (token, uris) => { played.push(uris); return true; };
  run("sdkReady = false;");

  // 12b1. another Connect device (polling): a finished top-up waits for the end of the last track we sent, then swaps quick
  reset(); played = []; n = 100; run(existing);
  run("sdkReady = false; radioActive = true; radioSeaming = false; radioContextLastUri = 'spotify:track:Existing'; remoteSeamAt = 0; remoteFastAt = 0; remoteNow = { uri: 'spotify:track:Existing', pos: 12000, dur: 180000, playing: true, at: Date.now() };");
  global.getLastFmScrobbleAt = async () => song(n++);
  await run("continueRadio()");
  assert.equal(played.length, 0);                       // mid-song on a polled device: no re-issue
  assert.equal(run("radioPendingReissue"), true);
  let polls = 0; const realPoll = global.pollNowPlaying; global.pollNowPlaying = () => { polls++; };
  run("radioRemoteTick()");                             // 168s left: nothing, no fast poll
  await new Promise(r => setImmediate(r));
  assert.equal(played.length, 0); assert.equal(polls, 0);
  run("remoteNow.pos = 170000; remoteNow.at = Date.now();");  // 10s left: re-sync every second, still no swap
  run("radioRemoteTick(); radioRemoteTick();");
  assert.equal(polls, 1);
  assert.equal(played.length, 0);
  global.pollNowPlaying = realPoll;
  global.spotifyPlay = async (token, uris, pos, opts) => { played.push(uris); playOpts = opts; return true; };
  run("remoteNow.pos = 178500; remoteNow.at = Date.now();");  // 1.5s left: inside the window
  run("radioRemoteTick(); radioRemoteTick();");
  await new Promise(r => setImmediate(r));
  assert.equal(played.length, 1);                       // one swap even with two ticks
  assert.notEqual(played[0][0], "spotify:track:Existing");
  assert.deepEqual(playOpts, { quick: true });
  run("radioRemoteTick();");                            // a failed or repeated swap is not retried inside 3s
  await new Promise(r => setImmediate(r));
  assert.equal(played.length, 1);
  // missed it: Spotify moved on to a track that is not ours. The late recovery re-issues once
  played = []; run("radioContextLastUri = 'spotify:track:Existing'; radioSeaming = false;");
  assert.equal(run("radioRecoverRunOff('spotify:track:Elsewhere')"), false);     // we were not at the last track before
  assert.equal(run("radioRecoverRunOff('spotify:track:Existing')"), true);
  await new Promise(r => setImmediate(r));
  assert.equal(played.length, 1);
  run("radioContextLastUri = 'spotify:track:Existing'; radioPaused = true;");     // paused: the tick stays quiet
  played = []; run("radioSeaming = false; remoteSeamAt = 0; remoteNow = { uri: 'spotify:track:Existing', pos: 179000, dur: 180000, playing: true, at: Date.now() }; radioRemoteTick();");
  await new Promise(r => setImmediate(r));
  assert.equal(played.length, 0);
  // no recent reading to time a swap from: the old behaviour (re-issue now) stays
  reset(); played = []; n = 200; run(existing); run("radioPaused = false; remoteNow = null; sdkReady = false;");
  global.spotifyPlay = async (token, uris) => { played.push(uris); return true; };
  await run("continueRadio()");
  assert.equal(played.length, 1);
  run("radioActive = false; radioPaused = false; remoteNow = null; radioContextLastUri = null;");

  // 12b2. the swap waits for the last track we sent to Spotify, whatever Spotify reports as queued next (its autoplay can add its own)
  reset(); played = []; run(existing);
  run("sdkReady = true; sdkDeviceId = 'dev'; _sdkCurrentUri = 'spotify:track:Elsewhere'; radioContextLastUri = 'spotify:track:Existing'; _sdkDurationMs = 180000; _sdkPositionMs = 179500; radioPendingReissue = true;");
  run("radioMaybeSeam()");
  await new Promise(r => setImmediate(r));
  assert.equal(played.length, 0);
  assert.equal(run("radioPendingReissue"), true);  // still waiting
  // 12b3. Next on the last track Spotify holds (the first song plays alone) swaps the unsent tracks in instead of running off the end
  reset(); played = []; n = 100; run(existing); run("radioActive = true; sdkReady = true; sdkDeviceId = 'dev'; _sdkCurrentUri = 'spotify:track:Existing'; radioContextLastUri = 'spotify:track:Existing'; _sdkDurationMs = 180000; _sdkPositionMs = 12000; radioSeaming = false;");
  assert.equal(run("radioSkipHandled()"), false, "nothing unsent and no top-up running: Spotify's own next is fine");
  global.getLastFmScrobbleAt = async () => song(n++);
  await run("continueRadio()");
  assert.equal(played.length, 0);
  assert.equal(run("radioSkipHandled()"), true);
  await new Promise(r => setImmediate(r));
  assert.equal(played.length, 1);
  assert.notEqual(played[0][0], "spotify:track:Existing");  // starts at the first new track, mid-song
  run("_sdkCurrentUri = 'spotify:track:Elsewhere'; radioSeaming = false;");
  assert.equal(run("radioSkipHandled()"), false, "not on the last sent track: Spotify's next works");
  // pressed while the top-up is still running: it swaps as soon as the tracks arrive
  reset(); played = []; n = 100; run(existing); run("radioActive = true; sdkReady = true; sdkDeviceId = 'dev'; _sdkCurrentUri = 'spotify:track:Existing'; radioContextLastUri = 'spotify:track:Existing'; radioSeaming = false;");
  const topUp = run("continueRadio()");
  assert.equal(run("radioSkipHandled()"), true);
  await topUp;
  await new Promise(r => setImmediate(r));
  assert.equal(played.length, 1);
  assert.notEqual(played[0][0], "spotify:track:Existing");
  assert.equal(run("radioPendingReissue"), false);
  run("sdkReady = false; radioActive = false; radioContextLastUri = null;");
  // ...and spotifyPlay remembers the end of every context it sends (Spotify caps a play at 100 URIs)
  const realFetch = global.fetch;
  const playCalls = [];
  global.fetch = async (url) => { playCalls.push(String(url)); return { ok: true, status: 204 }; };
  run("sdkReady = true; sdkDeviceId = 'dev'; radioContextLastUri = null;");
  assert.equal(await realSpotifyPlay("t", ["spotify:track:a", "spotify:track:b"]), true);
  assert.equal(run("radioContextLastUri"), "spotify:track:b");
  // a full play also turns shuffle and repeat off (both persist on the account), a quick one skips that
  assert.ok(playCalls.some(u => /me\/player\/shuffle\?state=false/.test(u)));
  assert.ok(playCalls.some(u => /me\/player\/repeat\?state=off/.test(u)));
  playCalls.length = 0;
  await realSpotifyPlay("t", ["spotify:track:q"], 0, { quick: true });
  assert.ok(!playCalls.some(u => /repeat|shuffle/.test(u)));
  await realSpotifyPlay("t", Array.from({ length: 150 }, (_, i) => "spotify:track:n" + i), 0, { quick: true });
  assert.equal(run("radioContextLastUri"), "spotify:track:n99");
  global.fetch = async () => ({ ok: false, status: 500 });
  run("radioContextLastUri = 'keep'; sdkReady = false;");
  global.getSpotifyDevices = async () => [];
  assert.equal(await realSpotifyPlay("t", ["spotify:track:z"]), false);
  assert.equal(run("radioContextLastUri"), "keep");  // a failed play does not move it
  global.fetch = realFetch;
  run("sdkReady = false; radioPendingReissue = false; radioContextLastUri = null;");

  // 12b2b. a quick play on another device goes straight to it: no device list, no transfer, no shuffle/repeat resets; it falls back to the full logic if refused
  {
    const f0 = global.fetch, calls = [];
    run("sdkReady = false; playbackDeviceId = 'cast1'; radioContextLastUri = null;");
    global.fetch = async (url) => { calls.push(String(url)); return { ok: true, status: 204 }; };
    let listed = 0; global.getSpotifyDevices = async () => { listed++; return []; };
    assert.equal(await realSpotifyPlay("t", ["spotify:track:a", "spotify:track:b"], 0, { quick: true }), true);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /me\/player\/play\?device_id=cast1/);
    assert.equal(listed, 0);
    assert.equal(run("radioContextLastUri"), "spotify:track:b");
    // refused: the full device logic runs (the device list is read)
    calls.length = 0; let first = true;
    global.fetch = async (url) => { calls.push(String(url)); if (first) { first = false; return { ok: false, status: 404 }; } return { ok: true, status: 204 }; };
    global.getSpotifyDevices = async () => { listed++; return [{ id: "cast1", name: "Nest", is_active: true }]; };
    assert.equal(await realSpotifyPlay("t", ["spotify:track:c"], 0, { quick: true }), true);
    assert.ok(listed >= 1);
    global.fetch = f0;
    run("playbackDeviceId = null; radioContextLastUri = null;");
  }

  // 12b4. the first sound does not wait for a full queue: playback starts with the first match, the rest is fetched behind it
  {
    reset(); n = 0; played = []; let lfmCalls = 0;
    global.getLastFmScrobbleAt = async () => { lfmCalls++; return song(n++); };
    // a fill that is done leaves what it already collected (and vetted) for the next one instead of throwing it away
    assert.equal(await run("radioFill(1)"), 1);
    const callsAfterFirst = lfmCalls;
    assert.equal(run("radioCarry.length"), 3, "the other three scrobbles of the batch are kept");
    assert.equal(await run("radioFill(3)"), 3);
    assert.equal(lfmCalls, callsAfterFirst, "the next fill uses the kept picks before asking Last.fm again");
    assert.equal(run("radioCarry.length"), 0);
    // startRadio: one track in the first play, the queue grows behind it, and the swap waits for the end of the first song
    reset(); n = 0; lfmCalls = 0; played = [];
    const els = {};
    global.document.getElementById = id => els[id] || (els[id] = { id, style: {}, className: "", innerHTML: "", textContent: "", value: id === "usernameInput" ? "tester" : "", children: [], classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, removeAttribute() {}, setAttribute() {}, addEventListener() {} });
    global.beginSession = () => {}; global.endSessionUI = () => {}; global.startPolling = () => {}; global.checkLikedTracks = () => {};
    global.getLastFmTotalPages = async () => { lfmCalls += 100; return { totalScrobbles: 5000 }; };
    global.spotifyPlay = async (token, uris) => { played.push(uris); run("radioContextLastUri = " + JSON.stringify(uris[uris.length - 1])); return true; };  // like the real one
    run("spotifyToken = 't'; radioStation = 'library'; homeTotalCache = { user: 'tester', total: 4321, at: Date.now() };");
    let startErr = ""; const keepShow = global.showStatus; global.showStatus = (m, t) => { if (t === "error") startErr = m; };
    await run("startRadio()");
    global.showStatus = keepShow;
    assert.equal(startErr, "", "startRadio failed: " + startErr);
    assert.equal(played.length, 1);
    assert.equal(played[0].length, 1, "the first play carries only the first match");
    assert.ok(lfmCalls < 100, "the scrobble count the home card fetched is reused");
    assert.equal(run("radioTotal"), 4321);
    for (let i = 0; i < 200 && run("allTrackCount") < 9; i++) await new Promise(r => setImmediate(r));  // the background fill
    assert.ok(run("allTrackCount") >= 9, "the queue fills behind the first song");
    assert.equal(played.length, 1, "no restart mid-song: the new tracks wait for the end of the last one we sent");
    assert.equal(run("radioPendingReissue"), true);
    assert.equal(run("radioUnsentUris().length"), run("allTrackCount") - 1);
    // an old count is not reused
    reset(); lfmCalls = 0; played = [];
    run("homeTotalCache = { user: 'tester', total: 4321, at: Date.now() - 3600000 };");
    await run("startRadio()");
    assert.ok(lfmCalls >= 100, "a stale count is fetched again");
    run("radioStop()");  // the background fill of the last start must not leak into the next tests
    await new Promise(r => setImmediate(r));
    global.spotifyPlay = async (token, uris) => { played.push(uris); return true; };
  }

  // 12b2c. a prewarmed device is not prepared twice: the transfer and the shuffle/repeat resets happen once, the play follows at once
  {
    const f0 = global.fetch, calls = [];
    run("sdkReady = true; sdkDeviceId = 'dev'; playbackDeviceId = null; radioContextLastUri = null;");
    global.fetch = async (url, o) => { calls.push((o && o.method || "GET") + " " + String(url).replace("https://api.spotify.com/v1", "")); return { ok: true, status: 204 }; };
    const warm = run("spotifyPrewarm('t')");
    assert.ok(warm && typeof warm.then === "function", "the prewarm returns a promise");
    assert.equal(await realSpotifyPlay("t", ["spotify:track:a"]), true);
    const prep = calls.filter(c => /PUT \/me\/player( |$)|shuffle|repeat/.test(c));
    assert.equal(prep.length, 3, "one transfer, one shuffle, one repeat, not a second set: " + calls.join(" | "));
    assert.equal(calls.filter(c => /\/me\/player\/play/.test(c)).length, 1);
    // the next full play prepares again (nothing is warm any more)
    calls.length = 0;
    await realSpotifyPlay("t", ["spotify:track:b"]);
    assert.equal(calls.filter(c => /shuffle|repeat/.test(c)).length, 2);
    // a remote device is not prewarmed (it needs the device list)
    run("playbackDeviceId = 'cast1';");
    assert.equal(run("spotifyPrewarm('t')"), null);
    global.fetch = f0;
    run("sdkReady = false; playbackDeviceId = null; radioContextLastUri = null;");
  }

  // 12b3. the swap is driven by the tracks we hold, not by a flag: it fires with the flag lost, and not when nothing is unsent
  reset(); played = []; run(existing);
  run("matchedUris[1] = 'spotify:track:Later'; matchedUris[2] = 'spotify:track:Latest'; allTrackCount = 3; uriToIndices['spotify:track:Later'] = [1]; uriToIndices['spotify:track:Latest'] = [2];");
  run("sdkReady = true; radioSeaming = false; radioPendingReissue = false; _sdkCurrentUri = 'spotify:track:Existing'; radioContextLastUri = 'spotify:track:Existing'; _sdkDurationMs = 180000; _sdkPositionMs = 179000;");
  assert.deepEqual(run("radioUnsentUris()"), ["spotify:track:Later", "spotify:track:Latest"]);
  global.spotifyPlay = async (token, uris, pos, opts) => { played.push(uris); return true; };
  run("radioMaybeSeam(); radioMaybeSeam();");
  await new Promise(r => setImmediate(r));
  assert.equal(played.length, 1);  // one swap even with two ticks in flight
  assert.deepEqual(played[0], ["spotify:track:Later", "spotify:track:Latest"]);
  assert.equal(run("radioSeaming"), false);
  run("radioContextLastUri = 'spotify:track:Latest'; _sdkCurrentUri = 'spotify:track:Latest';");  // the swap's own play moved the end
  assert.deepEqual(run("radioUnsentUris()"), []);
  run("radioMaybeSeam()");
  await new Promise(r => setImmediate(r));
  assert.equal(played.length, 1);  // nothing unsent: nothing to swap
  run("sdkReady = false; radioContextLastUri = null;");
  global.spotifyPlay = async (token, uris) => { played.push(uris); return true; };

  // 12c. Discover: vets candidates (played songs and saved songs are dropped), labels the source, mixes both sources
  const dReset = () => {
    reset(); played = []; statuses = [];
    run("radioActiveStation = 'discover'; discoverPool = []; discoverSeeds = null; discoverSeedRound = 0; discoverSimilarCache = {}; discoverTopCache = {}; discoverUsedArtists = new Set(); discoverNeedsReconnect = false; discoverWarnedEmpty = false;");
    global.radioSleep = async () => {};
    global.spotifySearch = async (token, artist, track) => ({ uri: uriFor(track), name: track, artists: [{ name: artist }], album: { images: [] } });
  };
  const plays = { "Newcomer": [0, 0], "Regular": [40, 0], "Played": [9, 3], "Saver": [2, 0] };  // artist plays, song plays
  global.getLastFmArtistInfo = async (u, a) => ({ artist: { bio: { summary: "" }, stats: { userplaycount: String((plays[a] || [0, 0])[0]) } } });
  global.getLastFmTrackInfo = async (u, a) => ({ track: { userplaycount: String((plays[a] || [0, 0])[1]) } });
  global.getLastFmStation = async () => ({ playlist: [
    { name: "Fresh", artists: [{ name: "Newcomer" }] }, { name: "Heard", artists: [{ name: "Played" }] },
    { name: "Kept", artists: [{ name: "Saver" }] }, { name: "NewSong", artists: [{ name: "Regular" }] }, { name: "", artists: [] }] });
  global.getLastFmSimilarArtists = async () => ({ similarartists: { artist: [{ name: "Sim One" }] } });
  global.getLastFmArtistTopTracks = async () => ({ toptracks: { track: [{ name: "Deep Cut" }] } });
  const spCalls = [];
  global.spGet = async path => {
    spCalls.push(path);
    if (path.startsWith("/me/top/artists")) return { items: [{ name: "Seed Band" }] };
    if (path.startsWith("/me/library/contains")) return [path.includes("Kept")];
    return {};
  };
  dReset();
  const dAdded = await run("radioFill(10)");
  assert.equal(dAdded, 3);  // Fresh, NewSong, Deep Cut; "Heard" was played and "Kept" is saved
  const dNames = [0, 1, 2].map(i => run("trackMeta[" + i + "].name")).sort();
  assert.deepEqual(dNames, ["Deep Cut", "Fresh", "NewSong"]);
  const metaOf = n => [0, 1, 2].map(i => run("trackMeta[" + i + "]")).find(m => m.name === n);
  assert.equal(metaOf("Fresh").source, "Last.fm pick");
  assert.equal(metaOf("Fresh").kind, "new-artist");
  assert.equal(metaOf("NewSong").kind, "new-song");
  assert.equal(metaOf("NewSong").artistPlays, 40);
  assert.equal(metaOf("Deep Cut").source, "Similar to Seed Band");
  assert.ok(spCalls.some(c => c.startsWith("/me/top/artists?limit=5&time_range=short_term")));
  assert.equal(run("radioSeen.has('played||heard')"), true);  // a vetted-out song is never retried

  // 12d. Discover without the user-top-read scope: the station still plays, and the app asks to reconnect
  dReset();
  global.spGet = async path => { if (path.startsWith("/me/top/artists")) throw Object.assign(new Error("Spotify 403"), { status: 403 }); if (path.startsWith("/me/library/contains")) return [false]; return {}; };
  assert.equal(await run("radioFill(2)"), 2);
  assert.equal(run("discoverNeedsReconnect"), true);
  assert.ok([0, 1].every(i => run("trackMeta[" + i + "].source") === "Last.fm pick"));

  // 12e. Discover with both sources failing gives up after a few rounds instead of looping
  dReset();
  global.getLastFmStation = async () => { throw new Error("down"); };
  global.spGet = async () => ({ items: [] });
  assert.equal(await run("radioFill(5)"), 0);
  assert.ok(run("radioFailures") > 0);
  assert.equal(run("radioExhausted"), false);

  // 12f. an empty but healthy Discover round warns once and is retried later; it never ends the radio
  dReset();
  global.getLastFmStation = async () => ({ playlist: [] });
  run("radioRefilling = false; radioExhausted = false; radioActive = true;");
  await run("continueRadio()");
  await run("continueRadio()");
  assert.equal(run("radioExhausted"), false);
  assert.equal(statuses.filter(m => /No new music found/.test(m)).length, 1);

  // 12g. Up next rows show where a Discover pick came from (escaped)
  assert.match(run("radioQueueRowHtml(3, { name: 'Song', artist: 'A', source: 'Similar to <b>' }, s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))"), /radio-chip.*Similar to &lt;b&gt;/);
  assert.doesNotMatch(run("radioQueueRowHtml(3, { name: 'Song', artist: 'A' }, s => s)"), /radio-chip/);
  run("radioActiveStation = 'library'");

  // 12h. Mix: alternates your past and new music in the pattern of the balance; each source is vetted its own way
  const mReset = bal => {
    dReset();
    run("radioActiveStation = 'mix'; radioActiveBalance = '" + bal + "'; radioTotal = 1000;");
    let sn = 0, fn = 0;
    global.getLastFmScrobbleAt = async () => [{ name: "Old " + (sn++), artist: { "#text": "Artist" }, date: { uts: "1400000000" } }];
    global.getLastFmStation = async () => ({ playlist: Array.from({ length: 6 }, () => ({ name: "Fresh " + (fn++), artists: [{ name: "Newcomer" }] })) });
    global.spGet = async path => path.startsWith("/me/library/contains") ? [false] : { items: [] };
    global.getLastFmArtistInfo = async () => ({ artist: { bio: { summary: "" }, stats: { userplaycount: "0" } } });
    global.getLastFmTrackInfo = async () => ({ track: { userplaycount: "0" } });
  };
  const origin = i => run("trackMeta[" + i + "]").source ? "new" : "past";
  mReset("balanced");
  assert.equal(await run("radioFill(6)"), 6);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(origin), ["past", "new", "past", "new", "past", "new"]);
  assert.equal(run("trackMeta[0].fromPast"), true);   // from your history, shown as "From 2014"
  assert.equal(run("trackMeta[0].year"), 2014);
  assert.equal(run("trackMeta[1].fromPast"), undefined);
  assert.equal(run("trackMeta[1].source"), "Last.fm pick");
  mReset("mostly-past");
  assert.equal(await run("radioFill(8)"), 8);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(origin), ["past", "past", "past", "new", "past", "past", "past", "new"]);
  mReset("mostly-new");
  assert.equal(await run("radioFill(4)"), 4);
  assert.deepEqual([0, 1, 2, 3].map(origin), ["new", "new", "new", "past"]);

  // 12i. Mix: when new music is unavailable the history keeps playing (and the other way round)
  mReset("balanced");
  global.getLastFmStation = async () => { throw new Error("down"); };
  assert.equal(await run("radioFill(4)"), 4);
  assert.deepEqual([0, 1, 2, 3].map(origin), ["past", "past", "past", "past"]);
  mReset("balanced");
  global.getLastFmScrobbleAt = async () => { throw new Error("rate limit"); };
  assert.equal(await run("radioFill(3)"), 3);
  assert.deepEqual([0, 1, 2].map(origin), ["new", "new", "new"]);
  // ...and only when both fail is it a failure
  mReset("balanced");
  global.getLastFmScrobbleAt = async () => { throw new Error("x"); };
  global.getLastFmStation = async () => { throw new Error("y"); };
  assert.equal(await run("radioFill(2)"), 0);
  assert.ok(run("radioFailures") > 0);
  run("radioActiveStation = 'library'; radioActiveBalance = 'balanced';");

  // 12j. Library in Moments: one random point, the scrobbles around it in the order played, each carrying its moment
  reset();
  run("radioActiveStation = 'library'; radioActiveHow = 'moments'; radioRange = null; radioMomentSeq = 0;");
  const mPage = (base, names) => ({ track: names.map((nm, k) => ({ name: nm, artist: { "#text": "M" }, date: { uts: String(base - k * 240) } })) });  // newest first
  const mPages = [mPage(1394567000, ["m3", "m2", "m1"]), mPage(1401631000, ["n2", "n1"])];
  let mp = 0; const mAsked = [];
  global.getLastFmScrobbles = async (user, page, limit, range) => { mAsked.push({ page, limit, range }); return mPages[mp++ % 2]; };
  global.spotifySearch = defaultSearch;
  assert.equal(await run("radioFill(5)"), 5);
  assert.deepEqual([0, 1, 2, 3, 4].map(i => run("trackMeta[" + i + "].name")), ["m1", "m2", "m3", "n1", "n2"]);
  assert.equal(run("trackMeta[0].moment.id"), 1);
  assert.equal(run("trackMeta[3].moment.id"), 2);
  assert.equal(run("trackMeta[0].moment.size"), 3);
  assert.equal(run("trackMeta[0].fromPast"), true);
  assert.equal(mAsked[0].limit, 30);
  assert.ok(mAsked[0].page >= 1 && mAsked[0].page <= Math.ceil(1000 / 30));
  // a fill that stops mid-moment keeps the rest of it, in order, for the next one
  reset(); mp = 0; run("radioMomentSeq = 0;");
  assert.equal(await run("radioFill(2)"), 2);
  assert.equal(await run("radioFill(1)"), 1);
  assert.equal(run("trackMeta[2].name"), "m3");
  // a failing Last.fm page counts as a failure (backoff), not as an empty library
  reset(); let mFails = 2, mCalls = 0;
  global.getLastFmScrobbles = async () => { mCalls++; if (mFails-- > 0) throw new Error("down"); return mPages[0]; };
  assert.equal(await run("radioFill(1)"), 1);
  assert.equal(mCalls, 3, "two failures, then a moment");
  assert.equal(run("radioFailures"), 0);

  // 12k. One year: every pick is asked inside that year
  reset(); run("radioActiveHow = 'songs'; radioRange = radioYearRange(2014);");
  const yRanges = []; n = 0;
  global.getLastFmScrobbleAt = async (user, page, range) => { yRanges.push(range); return song(n++); };
  assert.equal(await run("radioFill(2)"), 2);
  assert.ok(yRanges.length && yRanges.every(r => r && r.from === run("radioYearRange(2014).from") && r.to === run("radioYearRange(2014).to")));
  run("radioRange = null; radioActiveHow = 'songs';");

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

  const realGetElementById = global.document.getElementById;
  // 18. the artist panel only reads the running radio's own scrobble names (left-over metadata is ignored)
  reset();
  run("trackMeta = { 0: { lfmArtist: 'Radio Artist', lfmTrack: 'Radio Song' } };");
  assert.deepEqual(run("radioInfoSource(0)"), { artist: "Radio Artist", track: "Radio Song" });
  assert.equal(run("radioInfoSource(5)"), null);
  run("radioActive = false;");
  assert.equal(run("radioInfoSource(0)"), null);
  run("radioActive = true;");

  // 19. opening the radio view starts at the top, once (not on every refresh), and the title names the Library options
  const viewEls = {};
  global.document.getElementById = id => viewEls[id] || (viewEls[id] = { style: id === "radioView" ? { display: "none" } : {}, textContent: "", innerHTML: "", classList: { add() {}, remove() {} }, removeAttribute() {}, appendChild() {} });
  global.document.querySelectorAll = () => [];
  global.document.body = { classList: { add() {}, remove() {} } };
  global.escHtml = s => s;
  const windowScrolls = [];
  global.window.scrollTo = (x, y) => windowScrolls.push([x, y]);
  run("radioActiveStation = 'library'; radioActiveHow = 'moments'; radioActiveYear = 2014;");
  run("showRadioView()");
  assert.deepEqual(windowScrolls, [[0, 0]]);
  assert.equal(viewEls.radioTitle.textContent, "Library radio · Moments · 2014");
  run("showRadioView()");
  assert.deepEqual(windowScrolls, [[0, 0]]);
  run("radioActiveHow = 'songs'; radioActiveYear = 0;");

  // 24. the radio's Up next rows play from the clicked track onward
  reset(); played = [];
  run("matchedUris = { 0: 'a', 1: 'b', 2: 'c', 3: 'd' }; allTrackCount = 4; trackMeta = { 1: { name: 'B', artist: 'x' }, 2: { name: 'C', artist: 'y' }, 3: { name: 'D', artist: 'z' } }; nowPlayingIndex = 0; radioRefilling = false;");
  run("radioRenderQueue()");
  assert.match(viewEls.radioUpNext.innerHTML, /radioPlayFrom\(2\)/);
  assert.match(viewEls.radioUpNext.innerHTML, /radioPlayFrom\(3\)/);
  assert.doesNotMatch(viewEls.radioUpNext.innerHTML, /radioPlayFrom\(0\)/);
  await run("radioPlayFrom(1)");
  assert.deepEqual(played, [["b", "c", "d"]]);
  await run("radioPlayFrom(9)");
  assert.equal(played.length, 1);
  run("radioActive = false;");
  await run("radioPlayFrom(1)");
  assert.equal(played.length, 1);

  // 25. showing the radio view and going back home
  const slotEls = {};
  global.document.getElementById = id => slotEls[id] || (slotEls[id] = { id, style: id === "radioView" ? { display: "none" } : {}, textContent: "", innerHTML: "", children: [], classList: { add() {}, remove() {} }, removeAttribute() {}, appendChild(c) { this.children.push(c); } });
  run("showRadioView()");
  run("hideRadioView()");
  global.showStatus = () => {}; global.checkLikedTracks = () => {};
  global.spotifyPlay = async () => true;

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

  // 27b. the plain fallback query only counts when the hit has the same artist and title
  run("spotifyBlockedUntil = 0; searchCache = {};");
  const plainItems = [
    { uri: "spotify:track:school", name: "School Spirit", artists: [{ name: "Kanye West" }] },
    { uri: "spotify:track:yamaha", name: "Yamaha - Remastered 2011", artists: [{ name: "Delta Spirit" }] }
  ];
  const fetched = [];
  global.fetch = async url => {
    const q = new URL(url).searchParams.get("q"); fetched.push(q);
    const items = q.startsWith("track:") ? [] : plainItems;
    return { status: 200, ok: true, json: async () => ({ tracks: { items } }) };
  };
  assert.equal((await realSpotifySearch("token", "Delta Spirit", "Yamaha")).uri, "spotify:track:yamaha");
  run("searchCache = {};");
  plainItems.pop();  // Yamaha is not on Spotify: the top hit is an unrelated song
  assert.equal(await realSpotifySearch("token", "Delta Spirit", "Yamaha"), null);
  assert.equal(run("searchCache['delta spirit||yamaha']"), null);  // a clean miss is cached
  assert.equal(run("spotifyLooseMatch('Air', 'Fair')"), false);
  assert.equal(run("spotifyLooseMatch('Beyoncé', 'beyonce')"), true);

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
    const mk = id => { const cl = new Set(); return { id, style: id === "radioView" ? { display: "none" } : { setProperty(k, v) { this[k] = v; } }, textContent: "", innerHTML: "", className: "", value: "80", children: [], cl, classList: { add: c => cl.add(c), remove: c => cl.delete(c), toggle: (c, on) => (on ? cl.add(c) : cl.delete(c)) }, getAttribute(k) { return this[k] === undefined ? null : this[k]; }, setAttribute(k, v) { this[k] = String(v); }, removeAttribute(k) { delete this[k]; }, appendChild(c) { this.children.push(c); } }; };
    global.document.getElementById = id => els[id] || (els[id] = mk(id));
    global.window.scrollTo = () => {};
    reset();
    run("radioActive = true;");
    run("showRadioView()");
    assert.equal(els.radioBackBtn.style.display, "none", "no Back to radio while the radio view is showing");
    run("radioMinimize()");
    assert.equal(els.radioView.style.display, "none");
    assert.equal(els.homeView.style.display, "");
    assert.equal(run("radioActive"), true, "minimizing must not stop the radio");
    assert.equal(run("radioMinimized"), true);
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
    assert.equal(els.radioBackBtn.style.display, "none");
    assert.equal(els.radioPlaying.style.display, "none");
    assert.match(els.radioBtn.className, /btn-primary/);
    assert.match(els.radioBtn.innerHTML, /Start Library radio/);
    // reopening with nothing minimized does nothing
    els.radioView.style.display = "none"; els.homeView.style.display = "";
    run("radioReopen()");
    assert.equal(els.radioView.style.display, "none");
    // minimizing a view that is not showing, or with no session, does nothing
    run("radioMinimize()");
    assert.equal(run("radioMinimized"), false);
    run("radioActive = false;"); els.radioView.style.display = "";
    run("radioMinimize()");
    assert.equal(run("radioMinimized"), false);
    // ending the session clears the home card
    run("radioActive = true;"); run("radioMinimize()");
    assert.equal(run("radioMinimized"), true);
    assert.equal(els.radioBackBtn.style.display, "");
    run("hideRadioView()");
    assert.equal(run("radioMinimized"), false);
    assert.equal(els.radioBackBtn.style.display, "none");
    assert.match(els.radioBtn.innerHTML, /Start Library radio/);
    // the liked state shows on both hearts: the controls row (desktop) and the title row (phones)
    run("matchedUris = { 0: 'spotify:track:abc' }; allTrackCount = 1; nowPlayingIndex = 0; likedSet = new Set(['abc']);");
    run("updateNowPlayingHeart()");
    assert.ok(els.radioHeart.cl.has("liked") && els.radioHeartTitle.cl.has("liked"));
    assert.match(els.radioHeartTitle.innerHTML, /ph-fill/);
    run("likedSet = new Set();"); run("updateNowPlayingHeart()");
    assert.ok(!els.radioHeart.cl.has("liked") && !els.radioHeartTitle.cl.has("liked"));

    // This moment: shown only for a moment's track; Next moment needs a later moment queued; Save saves the moment's songs
    const mA = { id: 1, label: "Tuesday, March 11, 2014 · evening", chip: "Mar 11, 2014", start: 1394564640, end: 1394567520, size: 2 };
    const mB = { id: 2, label: "Sunday, June 1, 2014 · afternoon", chip: "Jun 1, 2014", start: 1401631200, end: 1401631400, size: 1 };
    run("matchedUris = { 0: 'u0', 1: 'u1', 2: 'u2', 3: 'u3' }; allTrackCount = 4; nowPlayingIndex = 0; radioActive = true; radioMomentShown = null;");
    global.__mA = mA; global.__mB = mB;
    run("trackMeta = { 0: { name: 'a', artist: 'x', moment: globalThis.__mA }, 1: { name: 'b', artist: 'x', moment: globalThis.__mA }, 2: { name: 'c', artist: 'y' }, 3: { name: 'd', artist: 'z', moment: globalThis.__mB } };");
    run("radioSyncMoment()");
    assert.equal(els.radioMoment.style.display, "");
    assert.equal(els.radioMomentLabel.textContent, mA.label);
    assert.match(els.radioMomentMeta.textContent, /^2 songs you played between/);
    assert.equal(els.momentNextBtn.disabled, false);
    assert.equal(run("radioNextMomentIndex(0)"), 3, "the next moment is the next track with another moment");
    assert.deepEqual(run("radioMomentIndices(1)"), [0, 1]);
    let saved = null;
    global.saveAsPlaylist = async (btn, uris, label) => { saved = { uris, label }; };
    await run("saveMomentPlaylist()");
    assert.deepEqual(saved, { uris: ["u0", "u1"], label: mA.label });
    played = []; global.spotifyPlay = async (token, uris) => { played.push(uris); return true; };
    await run("radioNextMoment()");
    assert.deepEqual(played, [["u3"]]);
    run("nowPlayingIndex = 3;"); run("radioSyncMoment()");
    assert.equal(els.radioMomentLabel.textContent, mB.label);
    assert.equal(els.momentNextBtn.disabled, false, "no later moment queued yet: pressing it fetches one");
    run("radioExhausted = true; radioMomentShown = null;"); run("radioSyncMoment()");
    assert.equal(els.momentNextBtn.disabled, true, "nothing left to fetch");
    run("radioExhausted = false;");
    // pressing it then drops the rest of this moment, fetches the next one and plays its first song as soon as it is matched
    global.__mC = { id: 3, label: "c", chip: "c", start: 1, end: 1, size: 1 };
    run("radioCarry = [{ artist: 'A', track: 'rest of B', moment: globalThis.__mB }]; radioRefilling = true;");
    run("radioNextMoment()");
    assert.equal(run("radioJumpFrom"), 2);
    assert.equal(run("radioCarry.length"), 0, "the rest of the playing moment is dropped");
    played = [];
    run("radioRefilling = false; radioCarry = [{ artist: 'A', track: 'first of C', moment: globalThis.__mC }];");
    global.spotifySearch = async (token, artist, track) => ({ uri: uriFor(track), name: track, album: { images: [] } });
    await run("radioFill(1)");
    assert.equal(run("radioJumpFrom"), null);
    assert.deepEqual(played, [["spotify:track:first_of_C"]]);
    run("nowPlayingIndex = 2;"); run("radioSyncMoment()");
    assert.equal(els.radioMoment.style.display, "none", "a track without a moment hides the panel");
    // Up next marks where the next moment starts
    run("nowPlayingIndex = 0;"); run("radioRenderQueue()");
    assert.match(els.radioUpNext.innerHTML, /radio-row-play" onclick="radioPlayFrom\(1\)/, "no divider inside the playing moment");
    assert.match(els.radioUpNext.innerHTML, /moment-start" onclick="radioPlayFrom\(3\)/);
  }

  // 29. toasts: only errors and warnings show, one at a time; success dismisses; they expire on their own
  {
    const host = { id: "toastHost", children: [], appendChild(el) { el.parent = this; this.children.push(el); } };
    const mk = () => { const l = {}; const el = { className: "", textContent: "", innerHTML: "", children: [], attrs: {}, listeners: l,
      classList: { add(c) { el.className += " " + c; }, contains: c => (" " + el.className + " ").includes(" " + c + " ") },
      setAttribute(k, v) { el.attrs[k] = v; }, addEventListener(e, f) { l[e] = f; },
      append(...n) { el.children.push(...n); }, remove() { if (el.parent) el.parent.children = el.parent.children.filter(c => c !== el); } }; return el; };
    global.document.getElementById = id => (id === "toastHost" ? host : null);
    global.document.createElement = () => mk();
    const timers = []; const realSet = global.setTimeout, realClear = global.clearTimeout;
    global.setTimeout = (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length - 1; };
    global.clearTimeout = id => { if (timers[id]) timers[id].live = false; };
    const fire = () => { const t = [...timers].reverse().find(x => x.live); if (t) { t.live = false; t.fn(); } };
    const savedShow = global.showStatus; global.showStatus = realShowStatus;
    const text = () => host.children.map(e => e.children[1].textContent);
    global.showStatus("Reading your Last.fm library...", "");
    assert.deepEqual(text(), [], "progress messages are not shown");
    global.showStatus("Spotify is limiting searches.", "error");
    assert.deepEqual(text(), ["Spotify is limiting searches."]);
    assert.match(host.children[0].className, /toast error/);
    assert.equal(host.children[0].children[2].attrs["aria-label"], "Dismiss message");
    global.showStatus("Reading your Last.fm library...", "");
    assert.equal(host.children.length, 1, "progress text does not dismiss a problem");
    global.showStatus("Spotify is limiting searches.", "error");
    assert.equal(host.children.length, 1, "the same message again is not stacked");
    global.showStatus("Playback moved to another session", "warn");
    assert.deepEqual(text(), ["Playback moved to another session"], "a new message replaces the old one");
    assert.match(host.children[0].className, /toast warn/);
    global.showStatus("▶ Library radio", "success");
    assert.match(host.children[0].className, /leaving/, "a success message dismisses a problem (it slides away)");
    fire();  // the removal after the exit animation
    assert.deepEqual(text(), []);
    // it goes away by itself: errors stay longer than warnings
    global.showStatus("Spotify is limiting searches.", "error");
    const errMs = timers.filter(t => t.live).pop().ms;
    global.showStatus("Could not switch devices.", "warn");
    const warnMs = timers.filter(t => t.live).pop().ms;
    assert.ok(errMs > warnMs && warnMs >= 5000, "errors stay longer than warnings");
    fire();  // the dismissal timer
    assert.match(host.children[0].className, /leaving/);
    fire(); assert.deepEqual(text(), []);
    // hovering holds it; leaving re-arms a short timer
    global.showStatus("Hold me", "warn");
    host.children[0].listeners.mouseenter();
    assert.equal(timers.filter(t => t.live).length, 0, "hovering cancels the dismissal");
    host.children[0].listeners.mouseleave();
    assert.equal(timers.filter(t => t.live).pop().ms, 2500);
    // the close button dismisses at once
    host.children[0].children[2].listeners.click();
    assert.match(host.children[0].className, /leaving/);
    fire(); assert.deepEqual(text(), []);
    // text is never parsed as HTML
    global.showStatus("<b>x</b>", "warn");
    assert.equal(host.children[0].children[1].textContent, "<b>x</b>");
    global.setTimeout = realSet; global.clearTimeout = realClear;
    run("removeToast(true)");
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
    // wide desktop (1100px and up): 8 rows, and the top-up threshold follows
    global.window.matchMedia = q => ({ matches: /1100/.test(q) });
    run("trackMeta = " + JSON.stringify(meta) + "; allTrackCount = 9; nowPlayingIndex = 0;");
    assert.equal(run("radioUpNextRows()"), run("RADIO_UPNEXT_ROWS_WIDE"));
    assert.equal(run("RADIO_UPNEXT_ROWS_WIDE"), 8);
    run("radioRenderQueue()");
    assert.equal((q.innerHTML.match(/radio-row-play/g) || []).length, 8);
    assert.equal(q.style["--upnext-rows"], 8);
    delete global.window.matchMedia;
    assert.equal(run("radioUpNextRows()"), run("RADIO_UPNEXT_ROWS"));  // no media query support: the phone count
  }

  // 31. the artist photo comes from Spotify, once per artist, and only for the artist that is playing
  {
    const els = {};
    const mk = id => ({ id, style: {}, innerHTML: "", textContent: "", getAttribute(k) { return this[k] === undefined ? null : this[k]; }, setAttribute(k, v) { this[k] = String(v); }, removeAttribute(k) { delete this[k]; } });
    global.document.getElementById = id => els[id] || (els[id] = mk(id));
    global.window.matchMedia = () => ({ matches: true });
    const idA = "1dfeR4HaWDbWqFHLkxsg1d", idB = "4Z8W4fKeB5YxbusRsdQVPb";
    const calls = []; const waiting = {};
    global.spGet = path => { calls.push(path); return new Promise((res, rej) => { waiting[path] = { res, rej }; }); };
    const trackOf = id => ({ artists: [{ name: "X", uri: "spotify:artist:" + id }] });
    run("radioPhotoCache = {}; radioPhotoId = '';");
    run("radioSyncArtistPhoto(" + JSON.stringify(trackOf(idA)) + ")");
    run("radioSyncArtistPhoto(" + JSON.stringify(trackOf(idA)) + ")");  // the same artist again: no second request
    assert.deepEqual(calls, ["/artists/" + idA]);
    // the artist changes before the first answer arrives: the late answer must not show
    run("radioSyncArtistPhoto(" + JSON.stringify(trackOf(idB)) + ")");
    waiting["/artists/" + idA].res({ images: [{ url: "https://i.scdn.co/a", width: 640 }] });
    await new Promise(r => setImmediate(r));
    assert.equal(els.radioArtistImg.src, undefined, "a late answer for the previous artist is ignored");
    waiting["/artists/" + idB].res({ images: [{ url: "https://i.scdn.co/b-big", width: 640 }, { url: "https://i.scdn.co/b-mid", width: 320 }, { url: "https://i.scdn.co/b-small", width: 160 }], external_urls: { spotify: "https://open.spotify.com/artist/" + idB } });
    await new Promise(r => setImmediate(r));
    assert.equal(els.radioArtistImg.src, "https://i.scdn.co/b-mid");
    assert.equal(els.radioArtistImg.style.display, "");
    assert.equal(els.radioArtistPhoto.href, "https://open.spotify.com/artist/" + idB);
    // an artist with no photo, and a failed request (not cached, retried next time)
    run("radioSyncArtistPhoto(" + JSON.stringify(trackOf(idA)) + ")");
    await new Promise(r => setImmediate(r));
    assert.equal(els.radioArtistImg.src, "https://i.scdn.co/a", "the cached answer for A shows without a new request");
    assert.equal(calls.length, 2);
    run("radioPhotoCache = {}; radioPhotoId = '';");
    run("radioSyncArtistPhoto(" + JSON.stringify(trackOf(idA)) + ")");
    waiting["/artists/" + idA].rej(new Error("boom"));
    await new Promise(r => setImmediate(r));
    assert.equal(els.radioArtistImg.src, undefined, "a failed lookup shows no photo");
    assert.equal(run("Object.keys(radioPhotoCache).length"), 0, "a failed lookup is not cached");
    // narrow screens (phones) never request the photo
    global.window.matchMedia = () => ({ matches: false });
    const before = calls.length;
    run("radioPhotoId = '';"); run("radioSyncArtistPhoto(" + JSON.stringify(trackOf(idB)) + ")");
    assert.equal(calls.length, before);
    delete global.window.matchMedia;
  }

  global.document.getElementById = realGetElementById;

  // Spotify Connect: a picked device wins over the SDK and over the active device
  {
    const realFetch = global.fetch, realDevices = global.getSpotifyDevices, stubPlay = global.spotifyPlay;
    global.spotifyPlay = realSpotifyPlay;  // the fallback re-enters spotifyPlay by name
    const calls = [];
    global.fetch = async (url, init) => { calls.push({ url: String(url), body: init && init.body }); return { ok: true, status: 204 }; };
    run("sdkReady = true; sdkDeviceId = 'sdk'; playbackDeviceId = null;");
    assert.equal(run("sdkPlaying()"), true);
    run("playbackDeviceId = 'phone'; playbackDeviceName = 'Pixel';");
    assert.equal(run("sdkPlaying()"), false);
    global.getSpotifyDevices = async () => [{ id: "laptop", is_active: true }, { id: "phone", is_active: true }];
    assert.equal(await realSpotifyPlay("t", ["spotify:track:a"]), true);
    const play = calls.find(c => /me\/player\/play/.test(c.url));
    assert.ok(/device_id=phone/.test(play.url), "plays on the picked device, not the SDK or the other active one");
    assert.ok(!calls.some(c => /device_id=sdk/.test(c.url)));
    // an inactive picked device is transferred to first
    calls.length = 0;
    global.getSpotifyDevices = async () => [{ id: "laptop", is_active: true }, { id: "phone", is_active: false }];
    await realSpotifyPlay("t", ["spotify:track:a"]);
    assert.ok(calls.some(c => /\/me\/player$/.test(c.url) && /"phone"/.test(c.body)), "transfers to the picked device");
    // a picked device Spotify does not list but still plays on (many Sonos): played directly, the pick stays
    calls.length = 0;
    global.getSpotifyDevices = async () => [{ id: "laptop", is_active: true }];
    assert.equal(await realSpotifyPlay("t", ["spotify:track:a"]), true);
    assert.equal(run("playbackDeviceId"), "phone");
    assert.ok(calls.some(c => /me\/player\/play\?device_id=phone/.test(c.url)));
    // a picked device that is gone (Spotify refuses it): the pick is cleared, with a warning, and the SDK plays
    calls.length = 0; const warns = [];
    global.showStatus = (m, t) => { if (t === "warn") warns.push(m); };
    global.fetch = async (url, init) => { calls.push({ url: String(url), body: init && init.body }); return /device_id=phone/.test(String(url)) ? { ok: false, status: 404 } : { ok: true, status: 204 }; };
    assert.equal(await realSpotifyPlay("t", ["spotify:track:a"]), true);
    assert.equal(run("playbackDeviceId"), null);
    assert.ok(/Pixel/.test(warns[0]));
    assert.ok(calls.some(c => /me\/player\/play\?device_id=sdk/.test(c.url)));
    global.showStatus = () => {};
    global.fetch = async (url, init) => { calls.push({ url: String(url), body: init && init.body }); return { ok: true, status: 204 }; };
    // automatic, nothing listed as active: play where Spotify is playing (no device_id) before picking a device
    run("sdkReady = false; playbackDeviceId = null;"); calls.length = 0;
    global.getSpotifyDevices = async () => [{ id: "laptop", is_active: false }];
    assert.equal(await realSpotifyPlay("t", ["spotify:track:a"]), true);
    assert.ok(/me\/player\/play$/.test(calls[0].url), "no device_id first");
    assert.ok(!calls.some(c => /\/me\/player$/.test(c.url)), "no transfer away from an unlisted active device");
    run("sdkReady = true;");
    // the session moved to another device outside STM: follow it; back on the SDK device: automatic again
    run("sessionQueue = new Set(['spotify:track:x']);");
    run("followPlaybackDevice({ device: { id: 'sonos', name: 'Living Room', type: 'Speaker' }, item: { uri: 'spotify:track:x' } })");
    assert.equal(run("playbackDeviceId"), "sonos");
    run("followPlaybackDevice({ device: { id: 'other' }, item: { uri: 'spotify:track:not-ours' } })");
    assert.equal(run("playbackDeviceId"), "sonos", "not our session: ignored");
    run("followPlaybackDevice({ device: { id: 'sdk' }, item: { uri: 'spotify:track:x' } })");
    assert.equal(run("playbackDeviceId"), null);
    // with another device picked, SDK state events are ignored (polling follows the device)
    run("playbackDeviceId = 'phone'; nowPlayingIndex = -1; uriToIndices = { 'spotify:track:x': [0] };");
    let highlighted = null; const realHl = global.highlightNowPlaying;
    global.highlightNowPlaying = i => { highlighted = i; };
    run("onSDKStateChange({ paused: true, position: 0, duration: 1000, track_window: { current_track: { uri: 'spotify:track:x' } } })");
    assert.equal(highlighted, null);
    global.highlightNowPlaying = realHl;
    run("playbackDeviceId = null; playbackDeviceName = ''; sdkReady = false; sdkDeviceId = null;");
    global.fetch = realFetch; global.getSpotifyDevices = realDevices; global.spotifyPlay = stubPlay;
  }

  console.log("radio engine: ok");
})().catch(e => { console.error(e); process.exit(1); });
