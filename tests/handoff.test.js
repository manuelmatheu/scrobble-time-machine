const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

global.window = { location: { origin: "http://localhost", pathname: "/" } };
global.document = { getElementById: () => null };
const load = f => vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), { filename: f });
["config.js", "radio.js", "spotify.js", "ui.js", "player.js", "connect.js", "handoff.js"].forEach(load);

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

let serverAnswer = null, sent = [];
const toasts = [];
global.getSpotifyToken = async () => "tok";
global.showStatus = (m, k) => toasts.push([m, k]);
global.fetch = async (url, opts) => {
  sent.push({ url, opts });
  const a = serverAnswer;
  if (a.hang) return new Promise((_, rej) => opts.signal.addEventListener("abort", () => rej(new Error("aborted"))));
  if (a.throws) throw new Error("net");
  return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => { if (a.text !== undefined) throw new Error("bad json"); return a.body; } };
};
function resetHandoff() { run("handoffOff = false"); sent = []; toasts.length = 0; }

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
  console.log("handoff: ok");
})().catch(e => { console.error(e); process.exit(1); });
