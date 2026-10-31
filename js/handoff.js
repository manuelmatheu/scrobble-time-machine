// =============================================================================
// HAND-OFF: the session note
// The window that drives a radio keeps a note on the server (api/session.js) so another device can pick the
// radio up. This file builds the note from the running session, reads one back, applies it, and talks to the
// server. It never touches the DOM. Driver and follower behavior lives elsewhere.
// =============================================================================

const HANDOFF_FETCH_TIMEOUT = 8000;  // ms before a request to the store counts as dead

let handoffMe = rndStr(16);          // this page load's id
let handoffSessionId = "";           // the radio the note describes
let handoffOff = false;              // the store does not answer: nothing is sent for the rest of this page load
let handoffNote = null;              // the last note seen
let handoffFollowing = false;        // this window follows another device's radio

function handoffBuildNote() {
  const start = Math.max(0, nowPlayingIndex - HANDOFF_BEFORE);
  const moments = {}, songs = [];
  const keep = m => { if (m) moments[m.id] = { id: m.id, label: m.label, chip: m.chip, start: m.start, end: m.end, size: m.size }; };
  for (let i = start; i < allTrackCount; i++) {
    const uri = matchedUris[i], m = trackMeta[i];
    if (!uri || !m) continue;
    keep(m.moment);
    songs.push({ uri, name: m.name, artist: m.artist, album: m.album, art: m.art, page: m.page, year: m.year, fromPast: m.fromPast,
      source: m.source, kind: m.kind, artistPlays: m.artistPlays, lfmArtist: m.lfmArtist, lfmTrack: m.lfmTrack, momentId: m.moment ? m.moment.id : undefined });
  }
  const carry = radioCarry.map(p => {
    keep(p.moment);
    const c = Object.assign({}, p);
    delete c.moment;
    if (p.moment) c.momentId = p.moment.id;
    return c;
  });
  if (!handoffSessionId) handoffSessionId = rndStr(16);
  return {
    v: 1, sessionId: handoffSessionId, driverId: handoffMe, beatAt: Date.now(), released: false,
    radio: { username: radioUser, station: radioActiveStation, how: radioActiveHow, year: radioActiveYear, range: radioRange,
      balance: radioActiveBalance, total: radioTotal, momentSeq: radioMomentSeq, contextLastUri: radioContextLastUri },
    songs, moments: Object.values(moments), carry, seen: Array.from(radioSeen).slice(-HANDOFF_SEEN_MAX)
  };
}

function handoffParseNote(x) {
  if (!x || typeof x !== "object" || x.v !== 1 || typeof x.sessionId !== "string" || !Array.isArray(x.songs)) return null;
  return x;
}

// Makes this window's session the note's: songs from index 0, one shared moment object per id
function handoffApplyNote(note) {
  const r = note.radio || {}, byId = {};
  (note.moments || []).forEach(m => { byId[m.id] = Object.assign({}, m); });
  ++radioSession;  // an in-flight fill of an older session of this window bails out
  radioRefilling = false; radioExhausted = false;
  matchedUris = {}; trackMeta = {}; uriToIndices = {}; sessionQueue = new Set();
  allTrackCount = 0; totalMatched = 0;
  note.songs.forEach(s => {
    const idx = allTrackCount++;
    matchedUris[idx] = s.uri; registerUri(s.uri, idx); sessionQueue.add(s.uri); totalMatched++;
    const m = { name: s.name, artist: s.artist, album: s.album, page: s.page, year: s.year, art: s.art, lfmArtist: s.lfmArtist, lfmTrack: s.lfmTrack };
    if (s.fromPast) m.fromPast = true;
    if (s.source) Object.assign(m, { source: s.source, kind: s.kind, artistPlays: s.artistPlays });
    if (s.momentId != null && byId[s.momentId]) m.moment = byId[s.momentId];
    trackMeta[idx] = m;
  });
  radioCarry = (note.carry || []).map(c => {
    const p = Object.assign({}, c);
    delete p.momentId;
    if (c.momentId != null && byId[c.momentId]) p.moment = byId[c.momentId];
    return p;
  });
  radioSeen = new Set(note.seen || []);
  radioUser = r.username || ""; radioActiveStation = r.station || "library"; radioActiveHow = r.how || "songs";
  radioActiveYear = r.year || 0; radioRange = r.range || null; radioActiveBalance = r.balance || "balanced";
  radioTotal = r.total || 0; radioMomentSeq = r.momentSeq || 0; radioContextLastUri = r.contextLastUri || null;
  handoffSessionId = note.sessionId;
}

function handoffRole(note, me, now) {
  if (!note) return "none";
  if (note.driverId === me) return "driver";
  if (note.released || now - note.beatAt > HANDOFF_STALE_MS) return "free";
  return "follower";
}

// One request to the store. Anything but 200 (and 409 for a PUT) turns the hand-off off for this page load, without a toast.
async function handoffCall(method, body) {
  if (handoffOff) return null;
  const token = await getSpotifyToken();
  if (!token) return null;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), HANDOFF_FETCH_TIMEOUT);
  try {
    const opts = { method, signal: ctl.signal, headers: { Authorization: "Bearer " + token } };
    if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    const res = await fetch("/api/session", opts);
    if (res.status !== 200 && !(method === "PUT" && res.status === 409)) throw new Error("status " + res.status);
    const data = await res.json();
    if (!data || typeof data !== "object") throw new Error("not json");
    return { status: res.status, note: data.note || null, now: data.now };
  } catch (e) {
    handoffOff = true;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function handoffGet() {
  const r = await handoffCall("GET");
  return r ? { note: r.note, now: r.now } : null;
}

function handoffPut(claim) {
  return handoffCall("PUT", { claim, note: handoffBuildNote() });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { handoffBuildNote, handoffParseNote, handoffApplyNote, handoffRole, handoffGet, handoffPut };
}
