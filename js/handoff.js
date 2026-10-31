// =============================================================================
// HAND-OFF: the session note
// The window that drives a radio keeps a note on the server (api/session.js) so another device can pick the
// radio up. This file builds the note from the running session, reads one back, applies it, and talks to the
// server. Exactly one window drives (adds songs, seams, writes the note); every other window follows the note.
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
  return {
    v: 1, sessionId: handoffSessionId, driverId: handoffMe, beatAt: Date.now(), released: false,
    radio: { username: radioUser, station: radioActiveStation, how: radioActiveHow, year: radioActiveYear, range: radioRange,
      balance: radioActiveBalance, total: radioTotal, momentSeq: radioMomentSeq, contextLastUri: radioContextLastUri },
    songs, moments: Object.values(moments), carry, seen: Array.from(radioSeen).slice(-HANDOFF_SEEN_MAX)
  };
}

// A note this version cannot apply (unknown v, a song without a uri, lists that are not lists) is ignored (spec 5.4)
function handoffParseNote(x) {
  if (!x || typeof x !== "object" || x.v !== 1 || typeof x.sessionId !== "string" || !Array.isArray(x.songs)) return null;
  const objects = list => list === undefined || (Array.isArray(list) && list.every(o => o && typeof o === "object"));
  if (!x.songs.every(s => s && typeof s === "object" && typeof s.uri === "string")) return null;
  if (!objects(x.moments) || !objects(x.carry) || (x.seen !== undefined && !Array.isArray(x.seen))) return null;
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

// =============================================================================
// DRIVER AND FOLLOWER (spec 5.2)
// The driver writes the note when a fill adds songs, on every track change and as a heartbeat. A write the server refuses
// (409: another window drives now) turns this window into a follower: it shows the note's radio and never fills, seams or
// re-issues (radio.js asks radioFollower()); its controls are a remote through the Web API.
// =============================================================================
let handoffWriting = null;   // the note write in flight (a promise), or null
let handoffQueued = null;    // the claim of the one write waiting behind it ("new" wins over "keep")
let handoffAskedUri = null;  // the reported song the note was last re-read for (once per song)
let handoffTickBusy = false;

// This window drives a radio it can write the note for
function handoffDriving() { return radioActive && !handoffFollowing && !handoffOff && !!handoffSessionId; }

// A radio started here (the end of a successful startRadio): a new id, and this window claims the note
function handoffStarted() {
  handoffSessionId = rndStr(16);
  handoffFollowing = false; handoffAskedUri = null;
  return handoffWrite("new");
}
// The radio stopped here (radioStop): nothing to write or follow until the next start
function handoffStopped() {
  handoffSessionId = ""; handoffFollowing = false; handoffAskedUri = null;
}

// Songs were added, or the track changed. The driver writes the note; a follower re-reads it (the reported song changed),
// unless it just did for that song
function handoffChanged() {
  if (handoffFollowing) {
    if (radioCurrentUri === handoffAskedUri) return;
    handoffAskedUri = radioCurrentUri;
    return handoffFollowerTick();
  }
  if (handoffDriving()) return handoffWrite("keep");
}
function handoffBeat() { if (handoffDriving()) handoffWrite("keep"); }

// One write in flight and one queued. The queued one is built when it is sent, so it carries the latest state.
function handoffWrite(claim) {
  if (handoffWriting) { if (handoffQueued !== "new") handoffQueued = claim; return handoffWriting; }
  handoffWriting = (async () => {
    try {
      for (let next = claim; next && handoffDriving(); ) {
        handoffQueued = null;
        const sid = handoffSessionId;
        const r = await handoffPut(next);
        next = handoffQueued;
        if (r && r.status === 409) {
          // Another window drives now: follow its radio, with no toast. A refusal of a radio this window has replaced since
          // (a new start waits behind it) is not about the new one, which claims the note next.
          if (next !== "new" && sid === handoffSessionId) { handoffFollow(r.note); return; }
        } else if (r) handoffNote = r.note;
      }
    } finally { handoffWriting = null; handoffQueued = null; }
  })();
  return handoffWriting;
}

// The page closes: the note is released, so another device can take the radio over at once. No refresh is possible during
// pagehide, so the cached access token goes in the beacon's body.
function handoffRelease() {
  if (!handoffDriving() || typeof navigator === "undefined" || !navigator.sendBeacon) return;
  let token = null;
  try { token = localStorage.getItem("spotify_access_token"); } catch (e) {}
  if (token) navigator.sendBeacon("/api/session?release", JSON.stringify({ token, driverId: handoffMe }));
}

// Show another device's radio from its note: hero, Up next, moment panel, dates. The music plays on the driver's device,
// which polling follows (followPlaybackDevice), so this window's own player is not the player. No toast.
function handoffFollow(note) {
  note = handoffParseNote(note);
  if (!note) return false;
  if (radioActive && handoffFollowing && note.sessionId === handoffSessionId) { handoffReapply(note); return true; }
  const reported = [remoteNow && remoteNow.uri, radioCurrentUri];  // the last songs Spotify reported here
  handoffApplyNote(note);
  handoffNote = note; handoffFollowing = true;
  radioActive = true; radioPendingReissue = false; radioSkipWanted = false; radioJumpFrom = null; radioStartedAt = 0;
  sdkInactive = false;
  if (sessionPaused) { sessionPaused = false; hideStatus(); }  // the music that played elsewhere is this radio
  startPolling();  // (clears the highlight)
  const known = reported.find(u => u && uriToIndices[u]);
  if (known) highlightNowPlaying(uriToIndices[known][0]);
  showRadioView();
  checkLikedTracks();
  pollSoon(0);  // the hero shows the song Spotify reports at once, not at the next poll
  return true;
}
// The same radio, read again: the driver's latest songs, keeping the song highlighted now (indices move as old songs drop
// out of the note) and the moment panel as it is (a saved moment stays saved: radioSyncMoment keeps an unchanged moment)
function handoffReapply(note) {
  const songs = () => Array.from({ length: allTrackCount }, (_, i) => matchedUris[i]).join(" ");
  const cur = matchedUris[nowPlayingIndex] || null, before = songs();
  if (!pollTimer) startPolling();  // a follower always reads what Spotify plays (nothing here should stop it, but never stay dark)
  handoffApplyNote(note);
  handoffNote = note;
  highlightNowPlaying(cur && uriToIndices[cur] ? uriToIndices[cur][0] : -1);
  radioRenderQueue(); radioSyncMoment();
  if (songs() !== before) checkLikedTracks();
}

// A follower re-reads the note every HANDOFF_FOLLOW_MS while visible and when the reported song changes: the driver's new
// songs, or the new radio when one was started elsewhere (sessionId changed). Taking over a released or silent driver's
// radio comes next (the note's role is "free" then).
async function handoffFollowerTick() {
  if (!handoffFollowing || handoffTickBusy) return;
  handoffTickBusy = true;
  try {
    const r = await handoffGet();
    const note = r && handoffParseNote(r.note);
    if (handoffFollowing && note) handoffFollow(note);
  } finally { handoffTickBusy = false; }
}

// The reported song is not in this window's copy: is it the radio's after all? A follower's copy may be behind (the driver
// added songs) or the radio was replaced elsewhere, so it re-reads the note once for that song. A driver checks whether
// another device started a new radio that plays it (the 409 on its next write would say so, after a warning it must not show).
async function handoffSongKnown(uri) {
  if (!uri) return false;
  if (sessionQueue.has(uri)) return true;
  if (uri === handoffAskedUri || !(handoffFollowing || handoffDriving())) return false;
  handoffAskedUri = uri;
  const r = await handoffGet();
  const note = r && handoffParseNote(r.note);
  if (!note) return false;
  if (handoffFollowing) handoffFollow(note);
  else if (handoffDriving() && note.sessionId !== handoffSessionId && handoffRole(note, handoffMe, r.now) === "follower"
    && note.songs.some(s => s.uri === uri)) handoffFollow(note);
  return sessionQueue.has(uri);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { handoffBuildNote, handoffParseNote, handoffApplyNote, handoffRole, handoffGet, handoffPut,
    handoffStarted, handoffChanged, handoffFollow, handoffFollowerTick, handoffSongKnown };
}

if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("pagehide", handoffRelease);
  setInterval(handoffBeat, HANDOFF_BEAT_MS);
  setInterval(() => { if (handoffFollowing && pollVisible()) handoffFollowerTick(); }, HANDOFF_FOLLOW_MS);
}
