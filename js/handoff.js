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
let handoffTaking = false;   // a takeover is waiting for the server's answer: nothing else writes or re-reads meanwhile

// This window drives a radio it can write the note for
function handoffDriving() { return radioActive && !handoffFollowing && !handoffOff && !handoffTaking && !!handoffSessionId; }

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
  if (handoffTaking) return;
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
  handoffShow(note);
  return true;
}
// Make the note's radio this window's, as a follower: the radio view, the song Spotify last reported highlighted
function handoffShow(note) {
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
// songs, or the new radio when one was started elsewhere (sessionId changed). A released or silent driver's radio is taken over
// (the note's role is "free" then).
async function handoffFollowerTick() {
  if (!handoffFollowing || handoffTickBusy || handoffTaking) return;
  handoffTickBusy = true;
  try {
    const r = await handoffGet();
    const note = r && handoffParseNote(r.note);
    if (!handoffFollowing || !note) return;
    if (handoffRole(note, handoffMe, r.now) === "free" && await handoffTryTakeOver(note) !== "refused") return;
    if (handoffFollowing) handoffFollow(note);
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

// =============================================================================
// TAKING OVER, AND A PHONE DRIVING (spec 5.2, 5.3)
// A window becomes the driver of a radio whose driver left (released) or went silent for 3 minutes. A window without a browser
// player (every phone) cannot top up from the background: whenever it takes over, starts a radio or comes back to the screen it
// makes sure PHONE_TOPUP songs are queued after the current one, and sends them to Spotify at once, from the current song at its
// position (the phone may be locked before the seam). It adds no more than that per opening.
// =============================================================================
let handoffTopUpBusy = false, handoffOpening = false;

// This window drives a radio and has no browser player of its own
function handoffPhoneDriver() { return !handoffOff && !handoffFollowing && radioActive && !sdkReady; }
// Songs to add so that PHONE_TOPUP are queued after the current one
function handoffTopUpWant(remaining) { return Math.max(0, PHONE_TOPUP - remaining); }

// A /me/player reading young enough to send songs from (connectCurrentPosition trusts no older one)
function handoffFresh() { return !!remoteNow && Date.now() - remoteNow.at < REMOTE_FRESH_MS; }
// Read /me/player into remoteNow (and the bar), as a poll does
async function handoffRead(token) {
  const data = await getCurrentlyPlaying(token);
  if (data && data.device) setCurrentDevice(data.device);
  if (data && data.item) remoteNow = { uri: data.item.uri, pos: data.progress_ms || 0, dur: data.item.duration_ms || 0, playing: !!data.is_playing, at: Date.now() };
  return data;
}
// The radio's current song: the one Spotify reports when it is ours, else the last one seen, else (a radio that just started,
// nothing read yet) the first
function handoffCurrentUri() {
  const r = remoteNow && remoteNow.uri;
  if (r && sessionQueue.has(r)) return r;
  if (radioCurrentUri && sessionQueue.has(radioCurrentUri)) return radioCurrentUri;
  return radioUrisFrom(matchedUris, allTrackCount, null)[0] || null;
}

async function handoffPhoneTopUp() {
  if (handoffWriting) await handoffWriting;  // a radio that just started: the store's first answer says whether it is there
  if (!handoffPhoneDriver()) {
    if (handoffOff && radioActive && !handoffFollowing) continueRadio();  // no store: the phone tops up as it always did
    return;
  }
  if (handoffTopUpBusy || radioRefilling) return;
  handoffTopUpBusy = true;
  const sid = radioSession;
  let added = 0;
  try {
    const token = await getSpotifyToken();
    if (!token || sid !== radioSession) return;
    if (!handoffFresh()) await handoffRead(token);
    if (sid !== radioSession || !handoffPhoneDriver()) return;
    const want = handoffTopUpWant(radioRemaining(matchedUris, allTrackCount, handoffCurrentUri()));
    if (!want) return;
    radioRefilling = true; radioRenderQueue();
    try { added = await radioFill(want); }
    finally { if (sid === radioSession) { radioRefilling = false; radioRenderQueue(); } }
    if (!added || sid !== radioSession) return;
    if (!handoffFresh()) await handoffRead(token);  // the fill took a while: send from where the song is now
    if (sid !== radioSession) return;
    const cur = handoffCurrentUri();
    // Only over this radio's own song while it plays. Paused (or outside music), nothing is unpaused: the songs join on resume
    // or at the seam, as for any top-up made while paused.
    if (remoteNow && remoteNow.playing && remoteNow.uri === cur
      && await spotifyPlay(token, radioUrisFrom(matchedUris, allTrackCount, cur), connectCurrentPosition(cur))) {
      if (sid === radioSession) { radioPendingReissue = false; checkLikedTracks(); }
    } else if (sid === radioSession) radioPendingReissue = true;
  } finally {
    handoffTopUpBusy = false;
    if (added > 0 && sid === radioSession) handoffChanged();  // the note gets the new songs
  }
}

// Take the note's radio over: "taken", "refused" (nothing changed here) or "lost" (another window won: it is followed now)
async function handoffTryTakeOver(note) {
  note = handoffParseNote(note);
  if (!note || handoffOff || handoffTaking) return "refused";
  handoffTaking = true;
  let taken = false;
  try {
    const token = await getSpotifyToken();
    if (!token) return "refused";
    const data = await handoffRead(token), d = data && data.device;
    // Another STM window's browser player plays it: that window is alive and driving, and the app never plays there
    if (d && d.name === STM_PLAYER_NAME && d.id !== sdkDeviceId) return "refused";
    // Until the server agrees this window follows: it shows the radio, and fills, seams and re-issues nothing
    handoffShow(note);
    radioResetPools();
    radioFailures = 0; lastSearchError = null;
    followPlaybackDevice(data);
    const cur = handoffCurrentUri();
    radioCurrentUri = cur; radioLastPos = remoteNow && remoteNow.uri === cur ? remoteNow.pos : 0;
    radioPaused = !!(remoteNow && remoteNow.uri === cur && !remoteNow.playing);
    const r = await handoffPut("takeover");
    if (r && r.status === 409) { handoffTaking = false; handoffFollow(r.note); return "lost"; }
    // (no answer: the store is gone, handoffOff is set, and this window carries the radio on alone, as without the hand-off)
    handoffFollowing = false; handoffSessionId = note.sessionId;
    if (r) handoffNote = r.note;
    taken = true;
  } finally { handoffTaking = false; }
  if (taken) {
    if (handoffPhoneDriver()) await handoffPhoneTopUp();
    else radioMaybeRefill(radioCurrentUri, radioLastPos);  // a desktop tops up as it always does
  }
  return "taken";
}
async function handoffTakeOver(note) { return await handoffTryTakeOver(note) === "taken"; }

// The phone strip's Open radio: the radio of the song that plays. A radio whose driver left is taken over, a driven one followed.
async function handoffOpen() {
  if (handoffOpening) return;
  handoffOpening = true;
  try {
    const r = await handoffGet();
    const note = r && handoffParseNote(r.note);
    if (!note) return;
    if (handoffRole(note, handoffMe, r.now) !== "follower" && await handoffTryTakeOver(note) !== "refused") return;
    handoffFollow(note);
  } finally { handoffOpening = false; }
}

// The phone strip (connect.js) re-reads the note to know whether the song it shows is a radio's
async function handoffRefreshNote() {
  const r = await handoffGet();
  handoffNote = r ? handoffParseNote(r.note) : null;
}
function handoffNoteHas(uri) { return !handoffOff && !!uri && !!handoffNote && handoffNote.songs.some(s => s.uri === uri); }

// Back on the screen: a phone driver tops up, a follower re-reads the note (and takes a radio over whose driver left)
function handoffVisible() {
  if (!pollVisible()) return;
  if (handoffFollowing) handoffFollowerTick();
  else if (handoffPhoneDriver()) handoffPhoneTopUp();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { handoffBuildNote, handoffParseNote, handoffApplyNote, handoffRole, handoffGet, handoffPut,
    handoffStarted, handoffChanged, handoffFollow, handoffFollowerTick, handoffSongKnown,
    handoffPhoneDriver, handoffTopUpWant, handoffPhoneTopUp, handoffTakeOver, handoffOpen, handoffNoteHas };
}

if (typeof window !== "undefined" && window.addEventListener) {
  if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("visibilitychange", handoffVisible);
  window.addEventListener("pagehide", handoffRelease);
  setInterval(handoffBeat, HANDOFF_BEAT_MS);
  setInterval(() => { if (handoffFollowing && pollVisible()) handoffFollowerTick(); }, HANDOFF_FOLLOW_MS);
}
