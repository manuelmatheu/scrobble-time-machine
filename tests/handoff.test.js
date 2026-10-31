const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

global.window = { location: { origin: "http://localhost", pathname: "/" }, scrollTo() {} };
// a small fake DOM: every id is an element that takes whatever the views write to it
const els = {};
const fakeEl = () => ({ style: {}, dataset: {}, children: [], hidden: true, textContent: "", innerHTML: "", disabled: false,
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
  addEventListener() {}, appendChild() {}, append() {}, focus() {}, querySelector: () => null, querySelectorAll: () => [] });
global.document = { getElementById: id => els[id] || (els[id] = fakeEl()), visibilityState: "visible",
  createElement: () => ({ set textContent(v) { this.t = String(v); }, get innerHTML() { return this.t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); } }) };
const load = f => vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), { filename: f });
["config.js", "radio.js", "spotify.js", "ui.js", "player.js", "connect.js"].forEach(load);
// handoff.js registers its pagehide listener and its timers at load: record them instead of running them
const listeners = {}, intervals = [];
window.addEventListener = (ev, fn) => { listeners[ev] = fn; };
const realSetInterval = global.setInterval;
global.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; };
load("handoff.js");
global.setInterval = realSetInterval;
delete window.addEventListener;

const run = code => vm.runInThisContext(code);
const uriOf = i => "spotify:track:t" + i;

// a running session of n songs; every momentEvery songs share a moment; seen keys pad radioSeen
function fillSession(n, o) {
  o = o || {};
  run(`matchedUris = {}; trackMeta = {}; uriToIndices = {}; sessionQueue = new Set(); allTrackCount = 0; totalMatched = 0;
    radioSeen = new Set(); radioCarry = []; radioMomentSeq = 0;`);
  const moments = {};
  for (let i = 0; i < n; i++) {
    const meta = { name: "N" + i, artist: "A" + i, album: "Al", page: i, year: 2010, art: "u" + i, lfmArtist: "A" + i, lfmTrack: "N" + i, fromPast: true };
    if (o.momentEvery) {
      const id = Math.floor(i / o.momentEvery) + 1;
      moments[id] = moments[id] || { id, label: "L" + id, chip: "C" + id, start: id * 10, end: id * 10 + 5, size: o.momentEvery };
      meta.moment = moments[id];
    }
    global.__m = meta;
    run(`matchedUris[${i}] = "${uriOf(i)}"; trackMeta[${i}] = __m; registerUri("${uriOf(i)}", ${i}); sessionQueue.add("${uriOf(i)}"); allTrackCount = ${i + 1}; totalMatched = ${i + 1};`);
  }
  run(`radioUser = "bob"; radioActiveStation = "library"; radioActiveHow = "moments"; radioActiveYear = 2010; radioRange = { from: 1, to: 2 };
    radioActiveBalance = "balanced"; radioTotal = 99; radioMomentSeq = 4; radioContextLastUri = "${uriOf(n - 1)}"; nowPlayingIndex = ${o.current || 0};`);
  for (let i = 0; i < (o.seen || 0); i++) run(`radioSeen.add("k${i}")`);
}
function clearSession() {
  run(`matchedUris = {}; trackMeta = {}; uriToIndices = {}; sessionQueue = new Set(); allTrackCount = 0; totalMatched = 0;
    radioSeen = new Set(); radioCarry = []; radioMomentSeq = 0; radioContextLastUri = null; radioRefilling = true; radioExhausted = true;`);
}

let serverAnswer = null, sent = [], puts = [], gets = 0, others = [];
const toasts = [];
global.getSpotifyToken = async () => "tok";
global.showStatus = (m, k) => toasts.push([m, k]);
global.fetch = async (url, opts) => {
  opts = opts || {};
  if (url !== "/api/session") { others.push({ url, opts }); return { ok: true, status: 204, json: async () => ({}) }; }  // Spotify's Web API
  sent.push({ url, opts });
  if ((opts.method || "GET") === "GET") gets++;
  if (opts.method === "PUT") puts.push(JSON.parse(opts.body));
  const a = serverAnswer;
  if (a.hang) return new Promise((_, rej) => opts.signal.addEventListener("abort", () => rej(new Error("aborted"))));
  if (a.throws) throw new Error("net");
  if (a.gate) await a.gate;
  return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => { if (a.text !== undefined) throw new Error("bad json"); return a.json !== undefined ? a.json : a.body; } };
};
function resetHandoff() {
  run("handoffOff = false; handoffFollowing = false; radioActive = true; playbackDeviceId = null; sdkReady = false; sdkInactive = false; sessionPaused = false; remoteNow = null");
  sent = []; puts = []; gets = 0; others = []; toasts.length = 0; beacons = []; plays = [];
}

// driver and follower
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };
const dev = (id, name, type) => ({ id, name, type });
let plays = [], fills = 0, beacons = [], readings = [], playingDevice = dev("k", "Kitchen", "Speaker");
global.spotifyPlay = async (token, uris, pos, opts) => { plays.push({ uris, pos, opts }); return true; };
global.radioFill = async () => { fills++; return 0; };
global.checkLikedTracks = () => {};
global.radioSyncInfo = () => {}; global.radioSyncArtistPhoto = () => {};  // the info panel's Last.fm and Spotify lookups
global.pollSoon = () => {};
// /me/player: the next queued reading, else the note's first song on playingDevice
global.getCurrentlyPlaying = async () => readings.length ? readings.shift() : { item: { uri: run("matchedUris[0]") }, device: playingDevice, is_playing: true };
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "node", sendBeacon: (url, body) => { beacons.push({ url, body }); return true; } }, configurable: true, writable: true });
const store = { spotify_access_token: "tok" };
Object.defineProperty(globalThis, "localStorage", { value: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } }, configurable: true, writable: true });
const firePagehide = () => listeners.pagehide();
function makeNote(sessionId, driverId, uris, o) {
  o = o || {};
  return { v: 1, sessionId, driverId, beatAt: 1, released: false,
    radio: { username: "amy", station: "library", how: o.moment ? "moments" : "songs", year: 0, range: null, balance: "balanced", total: 50, momentSeq: 1, contextLastUri: uris[uris.length - 1] },
    songs: uris.map((uri, i) => ({ uri, name: "O" + i, artist: "B", album: "Al", art: "", page: i, year: 2012, fromPast: true, momentId: o.moment ? 1 : undefined })),
    moments: o.moment ? [{ id: 1, label: "Moment one", chip: "M1", start: 1, end: 2, size: uris.length }] : [], carry: [], seen: ["b||o0"] };
}
const oUri = i => "spotify:track:o" + i;
const otherNote = makeNote("s-other", "other", [0, 1, 2, 3, 4, 5].map(oUri));
function followWith(note) { gets = 0; run("handoffFollow(" + JSON.stringify(note) + ")"); }

(async () => {
  // round trip: build, JSON, parse, apply in a clean session gives the same songs and meta
  fillSession(20, { momentEvery: 5, current: 10 });
  const note = handoffParseNote(JSON.parse(JSON.stringify(handoffBuildNote())));
  assert.equal(note.songs.length, 13);
  assert.equal(note.v, 1); assert.equal(note.radio.username, "bob"); assert.equal(note.radio.momentSeq, 4);
  clearSession(); handoffApplyNote(note);
  assert.equal(run("allTrackCount"), 13); assert.equal(run("matchedUris[3]"), uriOf(10));
  assert.equal(run("trackMeta[3].moment === trackMeta[4].moment"), true);
  assert.equal(run("trackMeta[3].moment.label"), "L3");
  assert.equal(run("uriToIndices['" + uriOf(10) + "'][0]"), 3);
  assert.equal(run("sessionQueue.size"), 13); assert.equal(run("totalMatched"), 13);
  assert.equal(run("radioUser"), "bob"); assert.equal(run("radioActiveHow"), "moments"); assert.equal(run("radioActiveYear"), 2010);
  assert.equal(run("radioTotal"), 99); assert.equal(run("radioContextLastUri"), uriOf(19));
  assert.equal(run("radioRefilling"), false); assert.equal(run("radioExhausted"), false);
  // the carry keeps its moments linked
  fillSession(5, { momentEvery: 5 });
  global.__c = { artist: "X", track: "Y", moment: { id: 1, label: "L1", chip: "C1", start: 10, end: 15, size: 5 } };
  run("radioCarry = [__c]");
  const n2 = handoffParseNote(JSON.parse(JSON.stringify(handoffBuildNote())));
  assert.equal(n2.carry[0].momentId, 1); assert.equal(n2.carry[0].moment, undefined);
  const s0 = run("radioSession"); clearSession(); handoffApplyNote(n2);
  assert.equal(run("radioCarry[0].moment === trackMeta[0].moment"), true);
  assert.equal(run("radioSession"), s0 + 1);
  // radioSeen is capped at the last 300 keys
  fillSession(5, { seen: 2000 });
  const capped = handoffBuildNote().seen;
  assert.equal(capped.length, 300); assert.equal(capped[299], "k1999");
  // parse rejects what it does not know
  assert.equal(handoffParseNote({ v: 2, sessionId: "s", songs: [] }), null);
  assert.equal(handoffParseNote({ v: 1, sessionId: 5, songs: [] }), null);
  assert.equal(handoffParseNote({ v: 1, sessionId: "s" }), null);
  assert.equal(handoffParseNote("nope"), null);
  assert.equal(handoffParseNote(null), null);
  // roles
  const t = 1e12, base = { driverId: "d1", beatAt: t, released: false };
  assert.equal(handoffRole(null, "me", t), "none");
  assert.equal(handoffRole(base, "d1", t), "driver");
  assert.equal(handoffRole(base, "me", t + 60000), "follower");
  assert.equal(handoffRole(base, "me", t + 180001), "free");
  assert.equal(handoffRole({ ...base, released: true }, "me", t), "free");
  // the state
  assert.equal(run("typeof handoffMe"), "string"); assert.equal(run("handoffMe.length"), 16);
  assert.equal(run("handoffFollowing"), false);
  // server: good answers
  resetHandoff(); serverAnswer = { status: 200, body: { note: null, now: 5 } };
  assert.deepEqual(await handoffGet(), { note: null, now: 5 });
  assert.equal(sent[0].url, "/api/session"); assert.equal(sent[0].opts.headers.Authorization, "Bearer tok");
  serverAnswer = { status: 200, body: { note: { sessionId: "s" }, now: 6 } };
  const put = await handoffPut("keep");
  assert.equal(put.status, 200); assert.equal(sent[1].opts.method, "PUT");
  assert.equal(JSON.parse(sent[1].opts.body).claim, "keep");
  serverAnswer = { status: 409, body: { note: { sessionId: "z" }, now: 7 } };
  const conflict = await handoffPut("new");
  assert.equal(conflict.status, 409); assert.equal(conflict.note.sessionId, "z"); assert.equal(run("handoffOff"), false);
  // a store that answers garbage, 5xx, 503, 401, a network error or never turns the hand-off off, silently
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn, ms) => realSetTimeout(fn, ms >= 8000 ? 5 : ms);
  for (const bad of [{ status: 200, text: "<html>" }, { status: 500 }, { status: 503 }, { status: 401 }, { status: 413 }, { throws: true }, { hang: true }]) {
    resetHandoff(); serverAnswer = bad;
    assert.equal(await handoffGet(), null); assert.equal(run("handoffOff"), true); assert.equal(toasts.length, 0);
    resetHandoff(); serverAnswer = bad;
    assert.equal(await handoffPut("keep"), null); assert.equal(run("handoffOff"), true);
  }
  global.setTimeout = realSetTimeout;
  // nothing is sent while off
  sent = []; assert.equal(await handoffGet(), null); assert.equal(await handoffPut("keep"), null); assert.equal(sent.length, 0);
  // no token: null, not off
  resetHandoff(); global.getSpotifyToken = async () => null;
  assert.equal(await handoffGet(), null); assert.equal(run("handoffOff"), false); assert.equal(sent.length, 0);

  // ===== Driver and follower =====
  global.getSpotifyToken = async () => "tok";
  serverAnswer = { status: 200, json: { note: null, now: 1 } };
  // a new radio claims the note
  resetHandoff(); fillSession(3, {}); handoffStarted(); await flush();
  assert.equal(puts.at(-1).claim, "new"); assert.equal(puts.at(-1).note.driverId, run("handoffMe"));
  // every start gets a new session id
  const firstId = run("handoffSessionId"); assert.equal(firstId.length, 16);
  handoffStarted(); await flush();
  assert.notEqual(run("handoffSessionId"), firstId); assert.equal(puts.at(-1).note.sessionId, run("handoffSessionId"));
  // a track change writes the note with claim "keep"; the same song again (the next poll) does not
  serverAnswer = { status: 200, json: { note: null, now: 1 } }; puts = [];
  run("radioMaybeRefill(matchedUris[1], 0)"); await flush();
  assert.equal(puts.length, 1); assert.equal(puts[0].claim, "keep");
  run("radioMaybeRefill(matchedUris[1], 5000)"); await flush();
  assert.equal(puts.length, 1);
  // a fill that adds songs writes it too
  let added = 2; global.radioFill = async () => { fills++; return added; };
  puts = []; run("radioRefilling = false; radioExhausted = false; radioPaused = true"); await run("continueRadio()"); await flush();
  assert.equal(puts.length, 1);
  added = 0; puts = []; run("radioExhausted = false"); await run("continueRadio()"); await flush();
  assert.equal(puts.length, 0);
  global.radioFill = async () => { fills++; return 0; };
  run("radioPaused = false; radioExhausted = false; radioPendingReissue = false");
  // at most one write in flight and one queued
  let open; serverAnswer = { status: 200, json: { note: null, now: 1 }, gate: new Promise(r => { open = r; }) }; puts = [];
  handoffChanged(); handoffChanged(); handoffChanged(); await flush();
  assert.equal(puts.length, 1);
  serverAnswer = { status: 200, json: { note: null, now: 1 } }; open(); await flush();
  assert.equal(puts.length, 2);
  // the heartbeat writes while driving
  const beat = intervals.find(t => t.ms === HANDOFF_BEAT_MS), followTick = intervals.find(t => t.ms === HANDOFF_FOLLOW_MS);
  assert.ok(beat && followTick);
  puts = []; beat.fn(); await flush(); assert.equal(puts.length, 1); assert.equal(puts[0].claim, "keep");
  // a 409 while this window's new radio waits to be written is the old radio's: the new one is claimed, nobody is followed
  serverAnswer = { status: 409, json: { note: makeNote("s-x", "x", [oUri(9)]), now: 1 }, gate: new Promise(r => { open = r; }) }; puts = [];
  handoffChanged(); await flush(); handoffStarted();
  serverAnswer = { status: 200, json: { note: null, now: 1 } }; open(); await flush();
  assert.equal(run("handoffFollowing"), false); assert.deepEqual(puts.map(p => p.claim), ["keep", "new"]);

  // a 409 turns the window into a follower of the returned note, without a toast
  resetHandoff(); fillSession(3, {}); handoffStarted(); await flush();
  serverAnswer = { status: 409, json: { note: otherNote, now: 1 } };
  handoffChanged(); await flush();
  assert.equal(run("handoffFollowing"), true); assert.equal(run("matchedUris[0]"), otherNote.songs[0].uri); assert.equal(toasts.length, 0);
  assert.equal(run("radioActive"), true); assert.equal(run("handoffSessionId"), "s-other");
  serverAnswer = { status: 200, json: { note: otherNote, now: 1 } };  // what a follower's re-reads get from here on
  // a follower never fills, seams or re-issues
  fills = 0; await run("continueRadio()"); run("radioMaybeSeam()"); await run("radioSeamReissue()");
  assert.equal(fills, 0); assert.equal(plays.length, 0);
  // (the driver has sent songs 0 to 2 so far: 3 to 5 wait for its seam)
  run("radioContextLastUri = matchedUris[2]"); await run("radioSeamReissue()");
  run("sdkReady = true; sdkDeviceId = 'mine'; _sdkCurrentUri = radioContextLastUri; _sdkDurationMs = 200000; _sdkPositionMs = 199900; radioPendingReissue = true");
  run("radioMaybeSeam()"); await run("radioReissue()"); await flush();
  run("sdkReady = false; sdkDeviceId = null; remoteNow = null; radioStartedAt = 0; radioSetPaused(false)"); await flush();
  // near the end of the driver's last sent song a follower does not re-read /me/player every second, nor swap
  readings = [{ item: { uri: oUri(2) }, device: playingDevice, is_playing: true }];
  run("remoteNow = { uri: radioContextLastUri, pos: 190000, dur: 200000, playing: true, at: Date.now() }; remoteFastAt = 0; remoteSeamAt = 0; radioRemoteTick()");
  await flush(); assert.equal(readings.length, 1); readings = [];
  run("remoteNow = { uri: radioContextLastUri, pos: 199000, dur: 200000, playing: true, at: Date.now() }; radioRemoteTick()");
  assert.equal(run("radioRecoverRunOff(radioContextLastUri)"), false); assert.equal(run("radioSkipHandled()"), false);
  await flush(); assert.equal(plays.length, 0); assert.equal(fills, 0);
  assert.equal(run("radioPendingReissue"), true);  // the pending re-issue on resume stays the driver's: nothing was sent
  run("remoteNow = null; radioPendingReissue = false; radioContextLastUri = matchedUris[5]");
  // no heartbeat and no note writes from a follower
  puts = []; beat.fn(); handoffChanged(); await flush(); assert.equal(puts.length, 0);
  // a row tap plays the note's songs up to the driver's last sent song
  run("radioContextLastUri = matchedUris[4]"); await run("radioPlayFrom(2)");
  assert.deepEqual(plays.at(-1).uris, [2, 3, 4].map(i => run("matchedUris[" + i + "]")));
  // ...and is off while the music plays on another STM window's player
  playingDevice = { id: "other", name: STM_PLAYER_NAME, type: "Computer" }; plays = [];
  await run("radioPlayFrom(2)"); assert.equal(plays.length, 0);
  playingDevice = dev("k", "Kitchen", "Speaker");
  // controls are a remote through the Web API, even with this browser's player ready
  let sdkCalls = 0;
  run("sdkReady = true; sdkDeviceId = 'mine'; playbackDeviceId = null"); window._stmPlayer ={ nextTrack() { sdkCalls++; }, togglePlay() { sdkCalls++; }, previousTrack() { sdkCalls++; } };
  others = []; await run("playerNext()"); await run("playerPlayPause()"); await run("playerPrev()");
  assert.equal(sdkCalls, 0);
  assert.deepEqual(others.map(o => o.url.replace("https://api.spotify.com/v1", "")), ["/me/player/next", "/me/player/pause", "/me/player/previous"]);
  delete window._stmPlayer;
  // a follower polls even while this browser's player is ready (the music is on the driver's device), and follows that device
  run("playbackDeviceId = null");
  readings = [{ item: { uri: oUri(1) }, device: dev("k", "Kitchen", "Speaker"), is_playing: true, progress_ms: 1000 }];
  await run("pollNowPlaying()");
  assert.equal(readings.length, 0); assert.equal(run("playbackDeviceId"), "k"); assert.equal(run("nowPlayingIndex"), 1);
  run("sdkReady = false; sdkDeviceId = null; playbackDeviceId = null");
  // a hidden follower does not poll...
  document.visibilityState = "hidden"; readings = [{ item: { uri: oUri(1) }, device: playingDevice, is_playing: true }];
  await run("pollNowPlaying()"); assert.equal(readings.length, 1);
  // ...nor re-read the note; visible, the 30 s tick re-reads it
  gets = 0; followTick.fn(); await flush(); assert.equal(gets, 0);
  document.visibilityState = "visible"; readings = [];
  serverAnswer = { status: 200, json: { note: otherNote, now: 1 } };
  followTick.fn(); await flush(); assert.equal(gets, 1);

  // pagehide sends the release beacon with this window's id
  resetHandoff(); fillSession(3, {}); handoffStarted(); await flush(); firePagehide();
  assert.equal(beacons[0].url, "/api/session?release"); assert.equal(JSON.parse(beacons[0].body).driverId, run("handoffMe"));
  assert.equal(JSON.parse(beacons[0].body).token, "tok");
  // a follower has nothing to release
  followWith(otherNote); beacons = []; firePagehide(); assert.equal(beacons.length, 0);

  // Review Focus: an unknown song makes the follower re-read once; still unknown -> paused-radio state, no note hero
  resetHandoff();
  followWith(otherNote); readings = [{ item: { uri: "spotify:track:new" }, device: dev("k", "Kitchen", "Speaker"), is_playing: true }];
  serverAnswer = { status: 200, json: { note: otherNote, now: 1 } };
  await run("pollNowPlayingOnce()");
  assert.equal(gets, 1); assert.equal(run("sessionPaused"), true);
  assert.equal(run("radioHeroLive"), false);
  // the same unknown song again: no second re-read
  readings = [{ item: { uri: "spotify:track:new" }, device: dev("k", "Kitchen", "Speaker"), is_playing: true }];
  await run("pollNowPlayingOnce()"); assert.equal(gets, 1);
  // a song the driver added since: the re-read note has it, and the follower shows it
  resetHandoff(); followWith(otherNote);
  const grown = makeNote("s-other", "other", [0, 1, 2, 3, 4, 5, 6].map(oUri));
  serverAnswer = { status: 200, json: { note: grown, now: 1 } };
  readings = [{ item: { uri: oUri(6), name: "O6", artists: [] }, device: dev("k", "Kitchen", "Speaker"), is_playing: true }];
  await run("pollNowPlayingOnce()");
  assert.equal(gets, 1); assert.equal(run("sessionPaused"), false); assert.equal(run("nowPlayingIndex"), 6); assert.equal(run("radioHeroLive"), true);
  assert.equal(toasts.length, 0);
  // a driver whose radio was replaced elsewhere follows the new one when the reported song is in it, without a toast
  resetHandoff(); fillSession(3, {}); handoffStarted(); await flush();
  serverAnswer = { status: 200, json: { note: makeNote("s-new", "phone", [oUri(7), oUri(8)]), now: 2 } };
  readings = [{ item: { uri: oUri(7), name: "O7", artists: [] }, device: dev("k", "Kitchen", "Speaker"), is_playing: true }];
  gets = 0; await run("pollNowPlayingOnce()");
  assert.equal(gets, 1); assert.equal(run("handoffFollowing"), true); assert.equal(run("handoffSessionId"), "s-new");
  assert.equal(run("sessionPaused"), false); assert.equal(toasts.length, 0); assert.equal(run("nowPlayingIndex"), 0);
  // ...but not when the song is in neither radio: that is outside music, the paused radio of today
  resetHandoff(); fillSession(3, {}); handoffStarted(); await flush();
  serverAnswer = { status: 200, json: { note: makeNote("s-new", "phone", [oUri(7), oUri(8)]), now: 2 } };
  readings = [{ item: { uri: "spotify:track:podcast" }, device: dev("k", "Kitchen", "Speaker"), is_playing: true }];
  gets = 0; await run("pollNowPlayingOnce()");
  assert.equal(gets, 1); assert.equal(run("handoffFollowing"), false); assert.equal(run("sessionPaused"), true); assert.equal(toasts.length, 1);
  // a desktop follower whose SDK lost the music follows the speaker, with no paused look or toast
  resetHandoff(); followWith(otherNote);
  run("sdkReady = true; sdkDeviceId = 'mine'; playbackDeviceId = null");
  const realST = global.setTimeout; global.setTimeout = (fn, ms) => realST(fn, ms === 1000 ? 0 : ms);
  readings = [{ item: { uri: oUri(2) }, device: dev("k", "Kitchen", "Speaker"), is_playing: true }];
  await run("sdkLostPlayback()");
  global.setTimeout = realST;
  assert.equal(run("playbackDeviceId"), "k"); assert.equal(run("sdkInactive"), false); assert.equal(run("sessionPaused"), false); assert.equal(toasts.length, 0);
  // ...also when the song is one the driver added since: the note is re-read before calling it someone else's music
  run("playbackDeviceId = null; stopPolling()"); gets = 0;
  serverAnswer = { status: 200, json: { note: grown, now: 1 } };
  readings = [{ item: { uri: oUri(6) }, device: dev("k", "Kitchen", "Speaker"), is_playing: true }];
  global.setTimeout = (fn, ms) => realST(fn, ms === 1000 ? 0 : ms);
  await run("sdkLostPlayback()");
  global.setTimeout = realST;
  assert.equal(gets, 1); assert.equal(run("playbackDeviceId"), "k"); assert.equal(run("sdkInactive"), false); assert.equal(toasts.length, 0);
  run("stopPolling(); sdkReady = false; sdkDeviceId = null; playbackDeviceId = null");

  // the tick re-applies the note keeping the current highlight; a new sessionId switches to the new radio
  resetHandoff(); followWith(makeNote("s-other", "other", [0, 1, 2, 3, 4].map(oUri), { moment: true }));
  run("highlightNowPlaying(3); radioSyncMoment()");
  assert.equal(run("radioMomentShown"), 1);
  els.momentSaveBtn.innerHTML = "Saved";  // the moment was saved
  serverAnswer = { status: 200, json: { note: makeNote("s-other", "other", [2, 3, 4, 5].map(oUri), { moment: true }), now: 1 } };
  await handoffFollowerTick();
  assert.equal(run("matchedUris[0]"), oUri(2)); assert.equal(run("nowPlayingIndex"), 1); assert.equal(run("matchedUris[nowPlayingIndex]"), oUri(3));
  assert.equal(run("radioMomentShown"), 1); assert.equal(els.momentSaveBtn.innerHTML, "Saved");  // the same moment: still saved
  serverAnswer = { status: 200, json: { note: makeNote("s-third", "other", [oUri(20), oUri(21)]), now: 1 } };
  await handoffFollowerTick();
  assert.equal(run("handoffSessionId"), "s-third"); assert.equal(run("matchedUris[0]"), oUri(20)); assert.equal(run("handoffFollowing"), true);
  // a bad note from the store is ignored: the follower keeps what it shows
  serverAnswer = { status: 200, json: { note: { v: 1, sessionId: "s-bad", songs: [{ name: "no uri" }] }, now: 1 } };
  await handoffFollowerTick();
  assert.equal(run("handoffSessionId"), "s-third");
  // parse refuses notes with songs, moments, carry or seen keys it cannot apply
  assert.equal(handoffParseNote({ v: 1, sessionId: "s", songs: [{ name: "x" }] }), null);
  assert.equal(handoffParseNote({ v: 1, sessionId: "s", songs: [null] }), null);
  assert.equal(handoffParseNote({ v: 1, sessionId: "s", songs: [{ uri: 5 }] }), null);
  assert.equal(handoffParseNote({ v: 1, sessionId: "s", songs: [], moments: "x" }), null);
  assert.equal(handoffParseNote({ v: 1, sessionId: "s", songs: [], moments: [null] }), null);
  assert.equal(handoffParseNote({ v: 1, sessionId: "s", songs: [], carry: [null] }), null);
  assert.equal(handoffParseNote({ v: 1, sessionId: "s", songs: [], seen: "abc" }), null);
  assert.ok(handoffParseNote(otherNote));
  // stopping the radio ends following
  run("radioStop()"); assert.equal(run("handoffFollowing"), false); assert.equal(run("handoffSessionId"), "");
  // a new follower highlights the song Spotify last reported, when the note has it
  resetHandoff(); fillSession(3, {}); handoffStarted(); await flush();
  run("remoteNow = { uri: 'spotify:track:old', pos: 0, dur: 1, playing: true, at: Date.now() }; radioCurrentUri = '" + oUri(2) + "'");
  serverAnswer = { status: 409, json: { note: otherNote, now: 1 } };
  handoffChanged(); await flush();
  assert.equal(run("handoffFollowing"), true); assert.equal(run("nowPlayingIndex"), 2);
  run("radioStop(); stopPolling()");
  console.log("handoff: ok");
})().catch(e => { console.error(e); process.exit(1); });
