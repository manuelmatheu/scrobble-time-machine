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
const listeners = {}, docListeners = {}, intervals = [];
window.addEventListener = (ev, fn) => { listeners[ev] = fn; };
document.addEventListener = (ev, fn) => { docListeners[ev] = fn; };
const realSetInterval = global.setInterval;
global.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; };
load("handoff.js");
global.setInterval = realSetInterval;
delete window.addEventListener; delete document.addEventListener;

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

let serverAnswer = null, sent = [], puts = [], gets = 0, others = [], webStatus = 204;
const toasts = [];
global.getSpotifyToken = async () => "tok";
global.showStatus = (m, k) => toasts.push([m, k]);
global.fetch = async (url, opts) => {
  opts = opts || {};
  if (url !== "/api/session") { others.push({ url, opts }); return { ok: webStatus < 300, status: webStatus, json: async () => ({}) }; }  // Spotify's Web API
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
  reported = null; playingDevice = dev("k", "Kitchen", "Speaker");
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
// /me/player: the next queued reading, else what remote() set, else the note's first song on playingDevice
let reported = null;
global.getCurrentlyPlaying = async () => readings.length ? readings.shift()
  : reported ? { item: { uri: reported.uri, duration_ms: 200000 }, device: playingDevice, is_playing: reported.playing, progress_ms: reported.pos }
  : { item: { uri: run("matchedUris[0]") }, device: playingDevice, is_playing: true };
// what Spotify reports now: remoteNow (a fresh reading) and the stubbed /me/player, on device (Kitchen by default)
function remote(r, device) {
  reported = r; playingDevice = device || dev("k", "Kitchen", "Speaker");
  global.__r = { uri: r.uri, pos: r.pos, dur: 200000, playing: r.playing, at: Date.now() };
  run("remoteNow = __r");
}
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
  // the driver's device drops (two empty readings): a follower lets it go and keeps reading, with no paused look, toast or play
  const deskFollower = () => { resetHandoff(); followWith(otherNote); run("sdkReady = true; sdkDeviceId = 'mine'; setPlaybackDevice({ id: 'k', name: 'Kitchen', type: 'Speaker' }); _emptyPolls = 0"); };
  deskFollower(); readings = [null, null];
  await run("pollNowPlayingOnce()"); await run("pollNowPlayingOnce()"); await flush();
  assert.equal(run("playbackDeviceId"), null); assert.notEqual(run("pollTimer"), null); assert.equal(run("sdkInactive"), false);
  assert.equal(toasts.length, 0); assert.equal(plays.length, 0); assert.equal(els.radioTrack.textContent, "Checking what's playing…");
  // ...and when the driver's music plays again, the next poll shows it and follows its device
  readings = [{ item: { uri: oUri(3) }, device: dev("k", "Kitchen", "Speaker"), is_playing: true }];
  await run("pollNowPlaying()");
  assert.equal(readings.length, 0); assert.equal(run("playbackDeviceId"), "k"); assert.equal(run("nowPlayingIndex"), 3); assert.equal(run("sessionPaused"), false);
  // a control that gets a 404 (the device is gone): the same, and the follower does not play the note itself
  deskFollower(); webStatus = 404;
  await run("playerNext()"); await flush();
  webStatus = 204;
  assert.equal(others.at(-1).url, "https://api.spotify.com/v1/me/player/next");
  assert.equal(run("playbackDeviceId"), null); assert.notEqual(run("pollTimer"), null); assert.equal(run("sdkInactive"), false);
  assert.equal(toasts.length, 0); assert.equal(plays.length, 0);
  // a follower whose polling stopped anyway starts it again at the next re-read of the same radio
  serverAnswer = { status: 200, json: { note: otherNote, now: 1 } };
  run("stopPolling()"); await handoffFollowerTick(); assert.notEqual(run("pollTimer"), null);
  run("stopPolling(); sdkReady = false; sdkDeviceId = null; setPlaybackDevice(null)");
  // a new follower highlights the song Spotify last reported, when the note has it
  resetHandoff(); fillSession(3, {}); handoffStarted(); await flush();
  run("remoteNow = { uri: 'spotify:track:old', pos: 0, dur: 1, playing: true, at: Date.now() }; radioCurrentUri = '" + oUri(2) + "'");
  serverAnswer = { status: 409, json: { note: otherNote, now: 1 } };
  handoffChanged(); await flush();
  assert.equal(run("handoffFollowing"), true); assert.equal(run("nowPlayingIndex"), 2);
  run("radioStop(); stopPolling()");
  // ===== Taking over, and the phone's 10-song top-up (spec 5.2, 5.3) =====
  const remainingAfter = i => otherNote.songs.length - 1 - i;
  let fillWants = []; global.__fillN = 0;
  // the stubbed fill adds as many songs as it is asked for
  global.radioFill = async want => {
    fills++; fillWants.push(want);
    run(`for (let k = 0; k < ${want}; k++) { const u = "spotify:track:f" + (__fillN++), idx = allTrackCount++;
      matchedUris[idx] = u; registerUri(u, idx); sessionQueue.add(u); totalMatched++; trackMeta[idx] = { name: u, artist: "F" }; }`);
    return want;
  };
  serverAnswer = { status: 200, json: { note: null, now: 1 } };
  assert.equal(handoffTopUpWant(0), 10); assert.equal(handoffTopUpWant(4), 6); assert.equal(handoffTopUpWant(12), 0);
  assert.equal(handoffTopUpWant(Infinity), 0);
  // a free note on a phone: take over, fill to 10 after the current song, send them at the current position
  resetHandoff(); run("sdkReady = false;"); remote({ uri: otherNote.songs[1].uri, pos: 30000, playing: true });
  run("discoverPool = [{ artist: 'x' }]; discoverSeeds = ['s']; radioBuf = { past: [1], new: [2] }; radioMixCursor = 3; discoverUsedArtists = new Set(['x'])");
  assert.equal(await handoffTakeOver({ ...otherNote, released: true }), true);
  // (the brief's puts.at(-1): the takeover is the first write; the top-up's "keep" with the new songs follows it, checked below)
  assert.equal(puts[0].claim, "takeover"); assert.equal(puts[0].note.driverId, run("handoffMe")); assert.equal(puts[0].note.sessionId, "s-other");
  assert.equal(fillWants.at(-1), 10 - remainingAfter(1));
  assert.equal(plays.at(-1).uris[0], otherNote.songs[1].uri); assert.ok(plays.at(-1).pos >= 30000);
  assert.equal(plays.at(-1).uris.length, 10 + 1);
  assert.equal(run("handoffFollowing"), false); assert.equal(run("handoffSessionId"), "s-other"); assert.equal(run("radioActive"), true);
  assert.equal(run("playbackDeviceId"), "k"); assert.equal(run("radioPendingReissue"), false); assert.equal(run("nowPlayingIndex"), 1);
  // the note then carries the new songs, from this window
  await flush();
  assert.equal(puts.at(-1).claim, "keep"); assert.equal(puts.at(-1).note.songs.length, otherNote.songs.length + 6);
  // no more than that per opening: track changes do not fill on a phone driver
  fills = 0; run("radioMaybeRefill(matchedUris[2], 0)"); assert.equal(fills, 0);
  run("radioMaybeRefill(matchedUris[allTrackCount - 2], 0)"); await flush(); assert.equal(fills, 0);
  // never over another STM window's player
  playingDevice = { id: "other", name: STM_PLAYER_NAME, type: "Computer" }; puts = [];
  assert.equal(await handoffTakeOver({ ...otherNote, released: true }), false);
  assert.equal(puts.length, 0);
  // Discover and Mix rebuild their pools on the new driver
  assert.deepEqual(run("discoverPool"), []); assert.equal(run("discoverSeeds"), null);
  assert.deepEqual(run("radioBuf"), { past: [], new: [] }); assert.equal(run("radioMixCursor"), 0); assert.equal(run("discoverUsedArtists.size"), 0);
  // Review Focus: a paused speaker is not unpaused by the top-up
  resetHandoff(); remote({ uri: otherNote.songs[1].uri, pos: 0, playing: false }); plays = [];
  await handoffTakeOver({ ...otherNote, released: true });
  assert.equal(plays.length, 0); assert.equal(run("radioPendingReissue"), true);
  assert.equal(run("radioPaused"), true);
  await flush();
  // a lost race (409): this window follows the radio the server holds, and adds nothing
  resetHandoff(); remote({ uri: oUri(1), pos: 0, playing: true }); fillWants = [];
  serverAnswer = { status: 409, json: { note: makeNote("s-won", "x", [oUri(1), oUri(2)]), now: 1 } };
  assert.equal(await handoffTakeOver({ ...otherNote, released: true }), false); await flush();
  assert.equal(run("handoffFollowing"), true); assert.equal(run("handoffSessionId"), "s-won"); assert.equal(fillWants.length, 0); assert.equal(plays.length, 0);
  serverAnswer = { status: 200, json: { note: null, now: 1 } };
  // a desktop (a browser player) takes over with its usual top-up: refill at the low water, the new songs wait for the seam
  resetHandoff(); run("sdkReady = true; sdkDeviceId = 'mine'"); remote({ uri: oUri(4), pos: 1000, playing: true }); fillWants = [];
  assert.equal(await handoffTakeOver({ ...otherNote, released: true }), true); await flush();
  assert.equal(fillWants.at(-1), RADIO_REFILL); assert.equal(plays.length, 0); assert.equal(run("radioPendingReissue"), true);
  assert.equal(run("playbackDeviceId"), "k"); assert.equal(run("handoffFollowing"), false);
  run("sdkReady = false; sdkDeviceId = null; setPlaybackDevice(null)");
  // a phone driver coming back to the screen tops up to 10 again, and only then
  resetHandoff(); remote({ uri: oUri(1), pos: 0, playing: true });
  await handoffTakeOver({ ...otherNote, released: true }); await flush();
  const nearEnd = run("matchedUris[allTrackCount - 3]");
  remote({ uri: nearEnd, pos: 5000, playing: true }); fillWants = []; plays = [];
  document.visibilityState = "hidden"; docListeners.visibilitychange(); await flush(); assert.equal(fillWants.length, 0);
  document.visibilityState = "visible"; docListeners.visibilitychange(); await flush();
  assert.equal(fillWants.at(-1), 8); assert.equal(plays.at(-1).uris[0], nearEnd); assert.ok(plays.at(-1).pos >= 5000);
  fillWants = []; docListeners.visibilitychange(); await flush(); assert.equal(fillWants.length, 0);  // 10 are queued: nothing to add
  // a stale reading is read again before the songs are sent: the song plays on from where it is, not from its start
  remote({ uri: run("matchedUris[allTrackCount - 1]"), pos: 90000, playing: true });
  run("remoteNow = { uri: 'spotify:track:o0', pos: 0, dur: 200000, playing: true, at: Date.now() - 60000 }"); plays = [];
  await handoffPhoneTopUp(); await flush();
  assert.equal(fillWants.at(-1), 10); assert.ok(plays.at(-1).pos >= 90000);
  // ...and again after a fill that took a while (the song went on meanwhile)
  const quickFill = global.radioFill;
  global.radioFill = async want => { const n = await quickFill(want); reported.pos = 150000; run("remoteNow.at = Date.now() - 60000"); return n; };
  remote({ uri: run("matchedUris[allTrackCount - 1]"), pos: 100000, playing: true }); plays = [];
  await handoffPhoneTopUp(); await flush();
  global.radioFill = quickFill;
  assert.equal(plays.at(-1).uris[0], run("matchedUris[allTrackCount - 11]")); assert.ok(plays.at(-1).pos >= 150000);
  // outside music on the speaker: the top-up adds songs but plays nothing over it
  remote({ uri: "spotify:track:podcast", pos: 1000, playing: true }); run("radioCurrentUri = matchedUris[allTrackCount - 1]"); plays = []; fillWants = [];
  await handoffPhoneTopUp(); await flush();
  assert.equal(fillWants.at(-1), 10); assert.equal(plays.length, 0); assert.equal(run("radioPendingReissue"), true);
  // without the store a phone keeps today's top-up on track changes
  run("handoffOff = true; radioPendingReissue = false"); fills = 0; remote({ uri: run("matchedUris[allTrackCount - 2]"), pos: 0, playing: true });
  run("radioMaybeRefill(matchedUris[allTrackCount - 2], 0)"); await flush(); assert.equal(fills, 1);
  assert.equal(await handoffTakeOver({ ...otherNote, released: true }), false);
  run("handoffOff = false");
  // a follower coming back to the screen takes a released radio over
  resetHandoff(); followWith(otherNote); remote({ uri: oUri(1), pos: 1000, playing: true });
  serverAnswer = { status: 200, json: { note: { ...otherNote, released: true }, now: 1 } }; puts = [];
  docListeners.visibilitychange(); await flush();
  assert.equal(puts[0].claim, "takeover"); assert.equal(run("handoffFollowing"), false);
  // ...and one silent for 3 minutes; a live driver's radio is only followed
  resetHandoff(); followWith(otherNote); remote({ uri: oUri(1), pos: 1000, playing: true });
  serverAnswer = { status: 200, json: { note: otherNote, now: 2 } };
  await handoffFollowerTick(); await flush(); assert.equal(puts.length, 0); assert.equal(run("handoffFollowing"), true);
  serverAnswer = { status: 200, json: { note: otherNote, now: 1 + HANDOFF_STALE_MS + 1 } };
  await handoffFollowerTick(); await flush(); assert.equal(puts[0].claim, "takeover"); assert.equal(run("handoffFollowing"), false);
  // ...but not when another STM window's player plays it: it goes on following
  resetHandoff(); followWith(otherNote); remote({ uri: oUri(1), pos: 1000, playing: true }, { id: "other", name: STM_PLAYER_NAME, type: "Computer" });
  serverAnswer = { status: 200, json: { note: { ...otherNote, released: true }, now: 1 } };
  await handoffFollowerTick(); await flush(); assert.equal(puts.length, 0); assert.equal(run("handoffFollowing"), true);
  // a follower's Play on outside music plays the note's songs only through the driver's last sent one (ruling 24)
  resetHandoff(); followWith(otherNote);
  run("sessionPaused = true; radioContextLastUri = matchedUris[3]; radioCurrentUri = matchedUris[1]; _sdkCurrentUri = null"); plays = [];
  await run("radioResumeHere()");
  assert.deepEqual(plays.at(-1).uris, [1, 2, 3].map(oUri));
  run("radioStop(); stopPolling()");
  // the phone strip: Open radio shows when the song it reports is in the session note, which it re-reads at most every 30 s
  resetHandoff(); run("radioActive = false; spotifyToken = 'tok'; connectLoaded = true");
  window.matchMedia = () => ({ matches: true, addEventListener() {} }); document.getElementById("homeCard").style.display = ""; document.getElementById("homeView").style.display = "";
  serverAnswer = { status: 200, json: { note: otherNote, now: 1 } };
  remote({ uri: oUri(2), pos: 0, playing: true }); gets = 0;
  await connectHomeTick();
  assert.equal(els.connectNowOn.hidden, false); assert.equal(els.connectNowOpen.hidden, false); assert.equal(gets, 1);
  await connectHomeTick(); assert.equal(gets, 1);
  run("connectNoteAt = Date.now() - HANDOFF_FOLLOW_MS - 1"); await connectHomeTick(); assert.equal(gets, 2);
  remote({ uri: "spotify:track:else", pos: 0, playing: true });  // the reported song changed: at once
  await connectHomeTick(); assert.equal(gets, 3); assert.equal(els.connectNowOpen.hidden, true);
  // Open radio: a driven radio is followed...
  remote({ uri: oUri(2), pos: 0, playing: true }); puts = [];
  await handoffOpen(); await flush();
  assert.equal(run("radioActive"), true); assert.equal(run("handoffFollowing"), true); assert.equal(puts.length, 0);
  // ...a free one is taken over
  run("radioStop(); stopPolling()"); resetHandoff(); run("radioActive = false"); remote({ uri: oUri(2), pos: 0, playing: true });
  serverAnswer = { status: 200, json: { note: { ...otherNote, released: true }, now: 1 } };
  await handoffOpen(); await flush();
  assert.equal(run("radioActive"), true); assert.equal(run("handoffFollowing"), false); assert.equal(puts[0].claim, "takeover");
  assert.equal(fillWants.at(-1), 10 - remainingAfter(2));
  delete window.matchMedia;
  // a radio started on a phone fills its first song, then tops up to 10 after it (not the usual refill)
  run("radioStop(); stopPolling()"); resetHandoff(); fillWants = [];
  run("radioActive = false; radioStation = 'library'; radioHow = 'songs'; radioYear = 0; homeTotalCache = { user: 'amy', total: 500, at: Date.now() }");
  document.getElementById("usernameInput").value = "amy"; global.spotifyPrewarm = () => {};
  serverAnswer = { status: 200, json: { note: null, now: 1 } };
  await run("startRadio()"); await flush();
  assert.deepEqual(fillWants, [RADIO_START_TRACKS, 10]); assert.equal(puts[0].claim, "new");
  // without the store, the usual refill
  run("radioStop(); stopPolling()"); resetHandoff(); fillWants = [];
  serverAnswer = { status: 503, json: {} };
  await run("startRadio()"); await flush();
  assert.deepEqual(fillWants, [RADIO_START_TRACKS, RADIO_REFILL]); assert.equal(run("handoffOff"), true);
  run("radioStop(); stopPolling(); handoffOff = false");
  console.log("handoff: ok");
})().catch(e => { console.error(e); process.exit(1); });
