// ═════════════════════════════════════════════════════════════════════════════
// NOW-PLAYING POLL
// ═════════════════════════════════════════════════════════════════════════════
function startPolling() {
  stopPolling();
  pollTimer = setInterval(pollNowPlaying, POLL_INTERVAL);
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  nowPlayingIndex = -1;
}

let _pollBusy = false, _emptyPolls = 0;
async function pollNowPlaying() {
  if (sdkPlaying() || _pollBusy) return;
  _pollBusy = true;
  try { await pollNowPlayingOnce(); } finally { _pollBusy = false; }
}
async function pollNowPlayingOnce() {
  const token = await getSpotifyToken();
  if (!token) return;
  const data = await getCurrentlyPlaying(token);
  if (!data || !data.item) {
    // Spotify drops a followed device that sat idle: /me/player then comes back empty for good. Let go of it, or the controls
    // keep talking to a device that is gone
    if (playbackDeviceId && ++_emptyPolls >= 2) releaseDeadDevice(false);
    return;
  }
  _emptyPolls = 0;

  const playingUri = data.item.uri;
  const prevUri = remoteNow && remoteNow.uri;
  remoteNow = { uri: playingUri, pos: data.progress_ms || 0, dur: data.item.duration_ms || 0, playing: !!data.is_playing, at: Date.now() };
  followPlaybackDevice(data);

  // Session check: is Spotify playing one of our queued tracks?
  if (sessionQueue.size > 0 && !sessionQueue.has(playingUri)) {
    if (radioRecoverRunOff(prevUri)) return;  // it ran past the last track we sent: the swap was missed, put our tracks back
    if (!sessionPaused) {
      sessionPaused = true;
      highlightNowPlaying(-1);
      showStatus("Playback moved to another session - click a track to reclaim", "warn");
    }
    return;
  }
  if (sessionPaused) {
    sessionPaused = false;
    showStatus("", "success");
  }

  // Update now-playing highlight using reverse map
  if (uriToIndices[playingUri]) {
    // Find the first index in our list that has this URI
    // If the user hasn't manually jumped, pick the lowest unplayed index
    const candidates = uriToIndices[playingUri];
    let best = candidates[0];
    // Prefer the one closest to (and >= ) the current highlight
    for (const idx of candidates) {
      if (idx >= nowPlayingIndex) { best = idx; break; }
    }
    highlightNowPlaying(best);
  }
  if (radioActive && uriToIndices[playingUri]) {
    radioRenderNow(data.item, !data.is_playing);
    if (data.item.duration_ms) updateProgressBar(data.progress_ms || 0, data.item.duration_ms);
  }
  radioMaybeRefill(playingUri, data.progress_ms);
}

function registerUri(uri, index) {
  if (!uriToIndices[uri]) uriToIndices[uri] = [];
  if (!uriToIndices[uri].includes(index)) uriToIndices[uri].push(index);
}

// =========================================================================
// SDK STATE HANDLER + PLAYER CONTROLS
// =========================================================================
let _sdkDurationMs = 0;
let _sdkPositionMs = 0;
let _sdkPlaying = false;
let _sdkProgressTimer = null;
let _sdkCurrentUri = null;

function onSDKStateChange(state) {
  if (!state) return;
  if (!sdkPlaying()) { clearInterval(_sdkProgressTimer); return; }  // the music plays on another Connect device: polling follows it
  const track = state.track_window && state.track_window.current_track;
  if (!track) return;

  if (sdkInactive && !state.paused) { sdkInactive = false; if (sessionPaused) { sessionPaused = false; hideStatus(); } }  // this window has the music again
  _sdkDurationMs = state.duration;
  _sdkPositionMs = state.position;
  _sdkPlaying = !state.paused;

  updateProgressBar(_sdkPositionMs, _sdkDurationMs);

  clearInterval(_sdkProgressTimer);
  if (_sdkPlaying) {
    _sdkProgressTimer = setInterval(() => {
      _sdkPositionMs = Math.min(_sdkPositionMs + 250, _sdkDurationMs);
      updateProgressBar(_sdkPositionMs, _sdkDurationMs);
      radioMaybeSeam();
    }, 250);
  }

  // Highlight now-playing track
  if (track.uri && uriToIndices[track.uri]) {
    const candidates = uriToIndices[track.uri];
    let best = candidates[0];
    for (const idx of candidates) { if (idx >= nowPlayingIndex) { best = idx; break; } }
    highlightNowPlaying(best);
  }
  if (radioActive && uriToIndices[track.uri]) radioRenderNow(track, state.paused);

  // Check liked status and top up the radio whenever the track changes
  if (track.uri !== _sdkCurrentUri) {
    _sdkCurrentUri = track.uri;
    checkAndUpdateTrackLiked(track.uri);
    radioMaybeRefill(track.uri, state.position);
  } else {
    updateNowPlayingHeart();
  }
}

function updateProgressBar(position, duration) {
  const pct = duration > 0 ? (position / duration * 100) + "%" : null;
  if (radioHeroLive) {
    const rf = $("radioFill"), re = $("radioElapsed"), rd = $("radioDuration");
    if (rf && pct) rf.style.width = pct;
    if (re) re.textContent = fmtMs(position);
    if (rd) rd.textContent = fmtMs(duration);
  }
}

function fmtMs(ms) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
  return m + ":" + String(s % 60).padStart(2, "0");
}

// Without the SDK (polling fallback) the controls talk to the Spotify REST API instead
async function playerRest(action) {
  const req = radioTransportRequest(action, radioPaused);
  if (!req) return;
  const token = await getSpotifyToken();
  if (!token) return;
  try {
    const r = await fetch("https://api.spotify.com/v1" + req.path, { method: req.method, headers: { Authorization: "Bearer " + token } });
    if (r.status === 404 && playbackDeviceId) releaseDeadDevice(true);  // the followed device is gone
  } catch (e) {}
}
// The followed device is gone (switched off, or idle too long). Back to this browser; with resume, carry on from the last
// track seen so the control that was pressed does something.
async function releaseDeadDevice(resume) {
  const name = playbackDeviceName, last = remoteNow && remoteNow.uri;
  setPlaybackDevice(null);
  _emptyPolls = 0;
  remoteNow = null;
  if (!sdkReady || sessionQueue.size === 0) return;
  stopPolling();
  if (!resume) { showStatus((name || "The other device") + " is not available. Playing here again.", "warn"); return; }
  const uris = radioUrisFrom(matchedUris, allTrackCount, last && sessionQueue.has(last) ? last : null);
  const token = uris.length ? await getSpotifyToken() : null;
  if (token && await spotifyPlay(token, uris)) { sessionPaused = false; startPolling(); }
  else showStatus("Playback stopped. Click a track to continue.", "warn");
}
async function playerPlayPause() {
  if ((sdkInactive || sessionPaused) && sessionQueue.size > 0) { radioResumeHere(); return; }
  if (window._stmPlayer && sdkPlaying()) { window._stmPlayer.togglePlay(); return; }
  playerRest("toggle");
}
async function playerPrev() {
  if ((sdkInactive || sessionPaused) && sessionQueue.size > 0) { radioResumeHere("restart"); return; }
  if (window._stmPlayer && sdkPlaying()) { window._stmPlayer.previousTrack(); return; }
  playerRest("prev");
}
async function playerNext() {
  if ((sdkInactive || sessionPaused) && sessionQueue.size > 0) { radioResumeHere("next"); return; }
  if (radioSkipHandled()) return;
  if (window._stmPlayer && sdkPlaying()) { window._stmPlayer.nextTrack(); return; }
  playerRest("next");
}
// Volume slider (desktop only): the SDK player's own volume, so only while the SDK device is the active player
async function setVolume(el) {
  const v = Math.min(Math.max(parseInt(el.value, 10) || 0, 0), 100);
  el.style.setProperty("--vol", v + "%");
  if (typeof radioSetVolumeIcon === "function") radioSetVolumeIcon(v);
  if (window._stmPlayer && sdkPlaying()) window._stmPlayer.setVolume(v / 100);
}
function seekTo(e) {
  const bar = e.currentTarget;
  if (!bar || !window._stmPlayer || !sdkPlaying() || !_sdkDurationMs) return;
  const rect = bar.getBoundingClientRect();
  const pct = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
  const posMs = Math.floor(pct * _sdkDurationMs);
  _sdkPositionMs = posMs;
  window._stmPlayer.seek(posMs);
}

// =========================================================================
// LIKED SONGS
// =========================================================================
async function checkAndUpdateTrackLiked(uri) {
  const id = uri.split(":").pop();
  try {
    const results = await spGet("/me/library/contains?uris=" + encodeURIComponent(uri));
    if (results[0]) likedSet.add(id); else likedSet.delete(id);
  } catch {}
  updateNowPlayingHeart();
}

async function checkLikedTracks() {
  if (!allTrackCount) return;
  const matchedIds = [];
  for (let i = 0; i < allTrackCount; i++) {
    if (matchedUris[i]) matchedIds.push({ uri: matchedUris[i], id: matchedUris[i].split(":").pop(), i });
  }
  if (!matchedIds.length) return;
  likedSet = new Set();
  for (let b = 0; b < matchedIds.length; b += 40) {
    const batch = matchedIds.slice(b, b + 40);
    try {
      const results = await spGet("/me/library/contains?uris=" + batch.map(x => x.uri).join(","));
      batch.forEach(({ id }, j) => { if (results[j]) likedSet.add(id); });
    } catch (e) {
      if (e.status === 403) { showStatus("Liked Songs: " + (e.spotifyMsg || "403 Forbidden"), "error"); return; }
    }
  }
  updateNowPlayingHeart();
}

async function toggleLikeTrack(idx) {
  if (!matchedUris[idx]) return;
  const id = matchedUris[idx].split(":").pop();
  const wasLiked = likedSet.has(id);

  // Optimistic update
  if (wasLiked) likedSet.delete(id); else likedSet.add(id);
  updateNowPlayingHeart();

  try {
    const uri = encodeURIComponent("spotify:track:" + id);
    if (wasLiked) await spDelete("/me/library?uris=" + uri, null);
    else await spPut("/me/library?uris=" + uri, null);
    showStatus(wasLiked ? "Removed from Liked Songs" : "Saved to Liked Songs", "success");
  } catch (e) {
    // Revert on error
    if (wasLiked) likedSet.add(id); else likedSet.delete(id);
    updateNowPlayingHeart();
    showStatus(e.status === 403 ? "Reconnect Spotify to enable Liked Songs" : "Could not update Liked Songs", "error");
  }
}

async function toggleLikeCurrentTrack() {
  if (nowPlayingIndex >= 0) await toggleLikeTrack(nowPlayingIndex);
}

function updateNowPlayingHeart() {
  if (nowPlayingIndex < 0 || !matchedUris[nowPlayingIndex]) return;
  const id = matchedUris[nowPlayingIndex].split(":").pop();
  const liked = likedSet.has(id);
  for (const id of ["radioHeart", "radioHeartTitle"]) {  // the controls row (desktop) and the title row (phones)
    const rh = $(id);
    if (rh) { rh.classList.toggle("liked", liked); rh.setAttribute("aria-pressed", liked ? "true" : "false"); rh.innerHTML = '<i class="' + (liked ? "ph-fill" : "ph") + ' ph-heart" aria-hidden="true"></i>'; }
  }
}

// =========================================================================
// SPOTIFY CONNECT (follow only)
// =========================================================================
// There is no device picker: the music plays in this browser. If the session is moved to another device from the
// Spotify app (or a speaker's own app), we follow it, so top-ups go there instead of pulling the music back.
// The followed device lives in memory only; a pick saved by an older version (stm_device) is dropped on load.

// Some devices (many Sonos) come back from /me/player with device.id null. They get a stand-in id so they can be
// followed; it is never sent to Spotify (spotifyPlayDirect omits device_id).
const UNLISTED_PREFIX = "unlisted:";
function isUnlistedDeviceId(id) { return typeof id === "string" && id.indexOf(UNLISTED_PREFIX) === 0; }

function setPlaybackDevice(dev) {
  playbackDeviceId = dev ? dev.id : null;
  playbackDeviceName = dev ? dev.name || "" : "";
  playbackDeviceType = dev ? dev.type || "" : "";
  if (typeof radioSyncVolume === "function") radioSyncVolume();
}
function loadPlaybackDevice() {
  try { localStorage.removeItem("stm_device"); } catch {}
}

// The session was moved to another device outside STM (the Spotify app, a speaker's own app): follow it, so
// top-ups go there instead of pulling the music back. Devices Spotify does not list (many Sonos) are followed too.
function followPlaybackDevice(data) {
  const d = data && data.device;
  if (!d || !data.item || !sessionQueue.has(data.item.uri)) return;
  const id = d.id || (d.name ? UNLISTED_PREFIX + d.name : null);
  if (!id) return;
  if (id === sdkDeviceId) { if (playbackDeviceId) setPlaybackDevice(null); return; }
  if (id !== playbackDeviceId) setPlaybackDevice({ id, name: d.name, type: d.type });
}
// SDK: our device stopped being the player. If the session plays elsewhere now, follow it and poll it
async function sdkLostPlayback() {
  await new Promise(r => setTimeout(r, 1000));  // let Spotify settle on the new device
  if (!sdkPlaying() || sessionQueue.size === 0) return;
  const token = await getSpotifyToken();
  const data = token ? await getCurrentlyPlaying(token) : null;
  if (data && data.device && data.device.id === sdkDeviceId) return;  // still ours: a passing null state
  if (data && data.item && sessionQueue.has(data.item.uri)) {
    followPlaybackDevice(data);
    if (!sdkPlaying()) { clearInterval(_sdkProgressTimer); startPolling(); }
    return;
  }
  // Nothing of this session plays anywhere: another window (a second tab, another STM) or another app took the music, or it
  // stopped. Do not mirror what plays there; show this window paused, and let Play bring its own queue back here.
  radioPausedElsewhere(!!(data && data.item));
}
// This window's player is no longer the active one. Paused look, no seam re-issues (radioPaused), and Play resumes here.
function radioPausedElsewhere(somethingElsePlays) {
  sdkInactive = true;
  clearInterval(_sdkProgressTimer);
  radioSetPaused(true);
  radioNowPaused = true;
  if ($("radioPlay")) $("radioPlay").innerHTML = '<i class="ph-fill ph-play"></i>';
  if (radioMinimized) radioSyncHome();
  if (somethingElsePlays && !sessionPaused) { sessionPaused = true; showStatus("Playing in another window or device. Press play to bring it back here.", "warn"); }
}
// Play (or Next / Previous) while this window is not the active player: carry on with this window's own queue on this browser,
// from where it stopped. mode: "next" starts the following song, "restart" the current one from its start.
let _resumeBusy = false;
async function radioResumeHere(mode) {
  if (_resumeBusy) return;
  _resumeBusy = true;
  try {
    const token = await getSpotifyToken();
    if (!token) return;
    const last = [_sdkCurrentUri, radioCurrentUri].find(u => u && sessionQueue.has(u)) || null;
    let uris = radioUrisFrom(matchedUris, allTrackCount, last);
    let pos = last && last === _sdkCurrentUri ? _sdkPositionMs : 0;
    if (mode === "next" && uris.length > 1) { uris = uris.slice(1); pos = 0; }
    if (mode === "restart") pos = 0;
    if (!uris.length) { showStatus("Nothing left to resume. Start a new radio.", "warn"); return; }
    if (await spotifyPlay(token, uris, pos)) { sdkInactive = false; sessionPaused = false; hideStatus(); }
    else showStatus("Could not resume here. Click a track to continue.", "warn");
  } finally { _resumeBusy = false; }
}

// The SDK does not always send its null state when the music is moved away (a Sonos taken over from the Spotify
// app never did), so while the SDK is the player and a session runs, check now and then that it still has a state.
let _sdkWatchBusy = false;
async function sdkWatchPlayback() {
  if (_sdkWatchBusy || sdkInactive || !sdkPlaying() || sessionQueue.size === 0 || !window._stmPlayer) return;
  _sdkWatchBusy = true;
  try {
    const st = await window._stmPlayer.getCurrentState();
    if (!st) await sdkLostPlayback();
  } catch {} finally { _sdkWatchBusy = false; }
}

if (typeof window !== "undefined" && window.addEventListener) {
  setInterval(sdkWatchPlayback, POLL_INTERVAL);
  setInterval(() => radioRemoteTick(), 250);  // radio.js loads after this file: look the function up at each tick
}
