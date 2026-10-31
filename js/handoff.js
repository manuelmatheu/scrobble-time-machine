// =============================================================================
// HAND-OFF: the session note
// The window that drives a radio keeps a note on the server (api/session.js) so another device can pick the
// radio up. This file builds the note from the running session, reads one back, applies it, and talks to the
// server. Exactly one window drives (adds songs, seams, writes the note); every other window follows the note.
// =============================================================================

const HANDOFF_FETCH_TIMEOUT = 8000;  // ms before a request to the store counts as dead

let handoffMe = rndStr(16);          // this page load's id
let handoffSessionId = "";           // the radio the note describes
let handoffOff = false;              // the store is absent: nothing is sent for the rest of this page load
let handoffAnswered = false;         // the store has answered once on this page load
let handoffFails = 0;                // failed calls in a row since its last answer
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

// One request to the store: its answer (200, or 409 for a PUT), or null. The hand-off turns off for this page load, without a
// toast, only when the store is absent: a 503 (the server has none), or the page's first call fails (a local server, a preview
// without it). After the store has answered once, a failed call (a 5xx, a timeout, no network, a body that is not JSON) is
// skipped and the next one tries again; HANDOFF_FAILS_MAX in a row turn it off. A 401 (a bad token) is skipped and counts for nothing.
async function handoffCall(method, body) {
  if (handoffOff) return null;
  const token = await getSpotifyToken();
  if (!token) return null;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), HANDOFF_FETCH_TIMEOUT);
  let status = 0;
  try {
    const opts = { method, signal: ctl.signal, headers: { Authorization: "Bearer " + token } };
    if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    const res = await fetch("/api/session", opts);
    status = res.status;
    if (status === 401) return null;
    if (status !== 200 && !(method === "PUT" && status === 409)) throw new Error("status " + status);
    const data = await res.json();
    if (!data || typeof data !== "object") throw new Error("not json");
    handoffAnswered = true; handoffFails = 0;
    return { status, note: data.note || null, now: data.now };
  } catch (e) {
    if (status === 503 || !handoffAnswered || ++handoffFails >= HANDOFF_FAILS_MAX) handoffOff = true;
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
let handoffUnclaimed = false;  // this window's new radio got no answer from the store: its next write claims it again ("new")

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
  handoffSessionId = ""; handoffFollowing = false; handoffAskedUri = null; handoffUnclaimed = false;
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

// One write in flight and one queued. The queued one is built when it is sent, so it carries the latest state. A new radio whose
// claim got no answer claims the note again with the next write (a plain "keep" would get the 409 of the radio it replaced).
function handoffWrite(claim) {
  if (handoffWriting) { if (handoffQueued !== "new") handoffQueued = claim; return handoffWriting; }
  handoffWriting = (async () => {
    try {
      for (let next = claim; next && handoffDriving(); ) {
        handoffQueued = null;
        const sid = handoffSessionId, send = next === "keep" && handoffUnclaimed ? "new" : next;
        const r = await handoffPut(send);
        if (send === "new") handoffUnclaimed = !r;
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
  handoffNote = note; handoffFollowing = true; handoffUnclaimed = false;
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
// added songs) or the radio was replaced elsewhere, so it re-reads the note once for that song. A driver checks whether another
// device drives now, with a radio that plays it: a new one, or this one taken over (the same session id). The 409 on its next
// write would say so, after a warning it must not show.
async function handoffSongKnown(uri) {
  if (!uri) return false;
  if (sessionQueue.has(uri)) return true;
  if (uri === handoffAskedUri || !(handoffFollowing || handoffDriving())) return false;
  handoffAskedUri = uri;
  const r = await handoffGet();
  const note = r && handoffParseNote(r.note);
  if (!note) return false;
  if (handoffFollowing) handoffFollow(note);
  else if (handoffDriving() && handoffRole(note, handoffMe, r.now) === "follower" && note.songs.some(s => s.uri === uri)) handoffFollow(note);
  return sessionQueue.has(uri);
}

// =============================================================================
// TAKING OVER, AND A PHONE DRIVING (spec 5.2, 5.3)
// A window becomes the driver of a radio whose driver left (released) or went silent for 3 minutes. A window without a browser
// player (every phone) cannot top up from the background: whenever it takes over, starts a radio or comes back to the screen it
// makes sure PHONE_TOPUP songs are queued after the current one, and sends them to Spotify at once, from the current song at its
// position (the phone may be locked before the seam), together with any songs queued earlier and not sent yet. While its page is
// hidden it adds nothing more (radioMaybeRefill); a visible page tops up on track changes as any driver does.
// =============================================================================
let handoffTopUpBusy = false, handoffOpening = false;

// This window drives a radio and has no browser player of its own
function handoffPhoneDriver() { return !handoffOff && !handoffFollowing && radioActive && !sdkReady; }
// Songs to add so that PHONE_TOPUP are queued after the current one
function handoffTopUpWant(remaining) { return Math.max(0, PHONE_TOPUP - remaining); }

// A /me/player reading young enough to send songs from (connectCurrentPosition trusts no older one)
function handoffFresh() { return !!remoteNow && Date.now() - remoteNow.at < REMOTE_FRESH_MS; }
// Read /me/player into remoteNow (and the bar), as a poll does. An empty reading (nothing plays, the device went idle) leaves no
// old "playing" behind: the last song counts as stopped, so nothing restarts it.
async function handoffRead(token) {
  const data = await getCurrentlyPlaying(token);
  if (data && data.device) setCurrentDevice(data.device);
  if (data && data.item) remoteNow = { uri: data.item.uri, pos: data.progress_ms || 0, dur: data.item.duration_ms || 0, playing: !!data.is_playing, at: Date.now() };
  else if (remoteNow) remoteNow = Object.assign({}, remoteNow, { playing: false });
  return data;
}
// Nothing plays and Spotify reports no device (the driver's tab closed and the music stopped): Pause / Play has no device to talk
// to. The radio waits paused on its current song, and Play brings it back through radioResumeHere (spotifyPlay plays it on this
// browser, on the phone's Spotify app, or asks the user to open Spotify). No toast.
function handoffPausedHere() {
  if (!radioActive || handoffFollowing || sdkInactive) return;
  const cur = handoffCurrentUri();
  if (cur) { _sdkCurrentUri = cur; _sdkPositionMs = remoteNow && remoteNow.uri === cur ? remoteNow.pos || 0 : 0; }
  radioPausedElsewhere(false);
}
// The radio's current song: the one Spotify reports when it is ours, else the last one seen, else (a radio that just started,
// nothing read yet) the first
function handoffCurrentUri() {
  const r = remoteNow && remoteNow.uri;
  if (r && sessionQueue.has(r)) return r;
  if (radioCurrentUri && sessionQueue.has(radioCurrentUri)) return radioCurrentUri;
  return radioUrisFrom(matchedUris, allTrackCount, null)[0] || null;
}

// confirmed: the store has just agreed this window drives (a takeover)
async function handoffPhoneTopUp(confirmed) {
  // Does this window still drive? A page back from the pocket may have lost the radio meanwhile (another device took it over):
  // it asks the store first, and a 409 makes it a follower before it adds or sends a song. A radio that just started waits for
  // its first write (which also says whether the store is there).
  if (handoffWriting) await handoffWriting;
  else if (!confirmed && handoffDriving()) await handoffWrite("keep");
  if (!handoffPhoneDriver()) {
    if (handoffOff && radioActive && !handoffFollowing) continueRadio();  // no store: the phone tops up as it always did
    return;
  }
  if (handoffTopUpBusy || radioRefilling) return;
  handoffTopUpBusy = true;
  const sid = radioSession;
  let added = 0, none = false;  // none: the last reading here reported no device
  try {
    const token = await getSpotifyToken();
    if (!token || sid !== radioSession) return;
    const read = async () => { const data = await handoffRead(token); none = !(data && data.device); };
    if (!handoffFresh()) await read();
    if (sid !== radioSession || !handoffPhoneDriver()) return;
    const want = handoffTopUpWant(radioRemaining(matchedUris, allTrackCount, handoffCurrentUri()));
    if (want) {
      radioRefilling = true; radioRenderQueue();
      try { added = await radioFill(want); }
      finally { if (sid === radioSession) { radioRefilling = false; radioRenderQueue(); } }
      if (sid !== radioSession) return;
    }
    // Nothing added and nothing queued that Spotify was not sent (a top-up made while paused, a refill waiting for its seam)
    if (!added && !radioUnsentUris().length) return;
    if (!handoffFresh()) await read();  // the fill took a while: send from where the song is now
    if (sid !== radioSession) return;
    const cur = handoffCurrentUri();
    // Only over this radio's own song while a fresh reading says it plays. Paused, outside music or no fresh reading: nothing is
    // started or unpaused; the songs join on resume or at the seam, as for any top-up made while paused.
    if (handoffFresh() && remoteNow.playing && remoteNow.uri === cur
      && await spotifyPlay(token, radioUrisFrom(matchedUris, allTrackCount, cur), connectCurrentPosition(cur))) {
      if (sid === radioSession) { radioPendingReissue = false; checkLikedTracks(); }
    } else if (sid === radioSession) { radioPendingReissue = true; if (none) handoffPausedHere(); }
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
    // No answer from a store that answered before: this window goes on following, and the next re-read tries again. With the
    // store gone (handoffOff is set) this window carries the radio on alone, as without the hand-off.
    if (!r && !handoffOff) return "refused";
    handoffFollowing = false; handoffSessionId = note.sessionId;
    if (r) handoffNote = r.note;
    taken = true;
    if (!(data && data.device)) handoffPausedHere();
  } finally { handoffTaking = false; }
  if (taken) {
    if (handoffPhoneDriver()) await handoffPhoneTopUp(true);
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
  if (r) handoffNote = handoffParseNote(r.note);  // a failed read keeps the last note (the next one tries again)
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
