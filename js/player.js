
// ═════════════════════════════════════════════════════════════════════════════
// NOW-PLAYING POLL + AUTO-CONTINUATION
// ═════════════════════════════════════════════════════════════════════════════
function startPolling() {
  stopPolling();
  pollTimer = setInterval(pollNowPlaying, POLL_INTERVAL);
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  nowPlayingIndex = -1;
}

async function pollNowPlaying() {
  if (sdkPlaying()) return;
  const token = await getSpotifyToken();
  if (!token) return;
  const data = await getCurrentlyPlaying(token);
  if (!data || !data.item) return;

  const playingUri = data.item.uri;

  // Session check: is Spotify playing one of our queued tracks?
  if (sessionQueue.size > 0 && !sessionQueue.has(playingUri)) {
    if (!sessionPaused) {
      sessionPaused = true;
      highlightNowPlaying(-1);
      showStatus("Playback moved to another session - click a track to reclaim", "warn");
    }
    return;
  }
  if (sessionPaused) {
    sessionPaused = false;
    showStatus("▶ Playing · " + totalMatched + " of " + allTrackCount + " matched", "success");
    $("savePlaylistBtn").style.display = ""; $("savePlaylistBtn").disabled = false;
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
  if ((radioActive || travelActive) && uriToIndices[playingUri]) {
    radioRenderNow(data.item, !data.is_playing);
    if (data.item.duration_ms) updateProgressBar(data.progress_ms || 0, data.item.duration_ms);
  }
  radioMaybeRefill(playingUri, data.progress_ms);

  // Auto-continue: check if we're near the end of matched tracks and have skipped ones
  if (!isContinuing && skippedPlan.length > 0) {
    // Count how many matched URIs come AFTER the currently playing one
    const matchedAfter = [];
    let foundCurrent = false;
    for (let i = 0; i < allTrackCount; i++) {
      if (matchedUris[i] === playingUri) foundCurrent = true;
      if (foundCurrent && matchedUris[i] && matchedUris[i] !== playingUri) matchedAfter.push(i);
    }
    // If 2 or fewer tracks remain in queue, load next batch
    if (matchedAfter.length <= 2) {
      continueMatching();
    }
  }
}

async function continueMatching() {
  if (isContinuing || skippedPlan.length === 0) return;
  if (spotifyBlockedFor() > 0) { showStatus(spotifyLimitMessage(), "error"); return; }
  isContinuing = true;
  const token = await getSpotifyToken();
  if (!token) { isContinuing = false; return; }

  // Take the next batch from skippedPlan
  const batch = skippedPlan.splice(0, BATCH_SIZE);
  let batchMatched = 0, limited = false;
  // Spotify is rate limiting us: put the unsearched tracks back for later instead of calling them missing
  const requeue = from => { const rest = batch.slice(from); rest.forEach(q => setTrackStatus(q.i, "skipped")); skippedPlan.unshift(...rest); limited = true; };

  showStatus("Loading more tracks… (" + totalMatched + " matched so far)", "");

  for (let bi = 0; bi < batch.length; bi++) {
    const p = batch[bi];
    if (p.ck in searchCache) {
      const c = searchCache[p.ck];
      if (c) { matchedUris[p.i] = c.uri; registerUri(c.uri, p.i); totalMatched++; batchMatched++; setTrackStatus(p.i, "found"); updateTrackArt(p.i, c); }
      else { setTrackStatus(p.i, "not_found"); }
      updateMatchCount(); continue;
    }
    if (spotifyBlockedFor() > 0) { requeue(bi); break; }
    setTrackStatus(p.i, "searching");
    const result = await spotifySearch(token, p.artist, p.track);
    if (result) { matchedUris[p.i] = result.uri; registerUri(result.uri, p.i); totalMatched++; batchMatched++; setTrackStatus(p.i, "found"); updateTrackArt(p.i, result); }
    else if (spotifyBlockedFor() > 0) { requeue(bi); break; }
    else { setTrackStatus(p.i, "not_found"); }
    updateMatchCount();
    if (bi < batch.length - 1) await new Promise(r => setTimeout(r, SEARCH_DELAY));
  }

  if (batchMatched > 0) {
    // Re-issue spotifyPlay from the current track onwards so new tracks enter the
    // Spotify context (not the persistent user queue). Matches SpotiMix pattern.
    const currentUri = _sdkCurrentUri;
    const remainingUris = [];
    let passedCurrent = !currentUri;
    for (let i = 0; i < allTrackCount; i++) {
      if (!matchedUris[i]) continue;
      if (!passedCurrent) { if (matchedUris[i] === currentUri) passedCurrent = true; }
      if (passedCurrent) remainingUris.push(matchedUris[i]);
    }
    if (remainingUris.length > 0) {
      const tok2 = await getSpotifyToken();
      if (tok2) {
        // With the SDK, swap the new tracks in at the end of the last queued track: a re-issue
        // mid-song restarts the stream and stutters (see radioMaybeSeam)
        if (sdkPlaying()) radioPendingReissue = true;
        else await spotifyPlay(tok2, remainingUris, _sdkPositionMs || 0);
        remainingUris.forEach(u => sessionQueue.add(u));
      }
    }
    if (limited) showStatus(spotifyLimitMessage(), "error");
    else showStatus("▶ Playing · " + totalMatched + " of " + allTrackCount + " matched" + (skippedPlan.length > 0 ? " · more pending" : ""), "success");
    checkLikedTracks();
  } else {
    if (limited) showStatus(spotifyLimitMessage(), "error");
    else showStatus("▶ Playing · " + totalMatched + " matched · couldn't find more", "success");
  }
  isContinuing = false;
}

function registerUri(uri, index) {
  if (!uriToIndices[uri]) uriToIndices[uri] = [];
  if (!uriToIndices[uri].includes(index)) uriToIndices[uri].push(index);
}

function updateMatchCount() {
  $("matchCount").textContent = totalMatched + " of " + allTrackCount + " matched";
}


// ═════════════════════════════════════════════════════════════════════════════
// SMART MATCH (first batch)
// ═════════════════════════════════════════════════════════════════════════════
function buildPlan(tracks) {
  const plan = [], seen = new Set();
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const artist = (t.artist && (t.artist["#text"]||t.artist.name)) || "";
    const track = t.name || "";
    const ck = (artist + "||" + track).toLowerCase();
    const needs = !seen.has(ck) && !(ck in searchCache);
    seen.add(ck);
    plan.push({ i, artist, track, ck, needs });
  }
  return plan;
}

async function smartMatch(tracks, token) {
  matchedUris = {}; lastSearchError = null; allTrackCount = tracks.length;
  uriToIndices = {}; totalMatched = 0; skippedPlan = []; isContinuing = false;
  currentTracks = tracks;

  const plan = buildPlan(tracks);
  const budget = Math.min(plan.filter(p => p.needs).length, BATCH_SIZE);
  let searchesDone = 0;

  for (const p of plan) {
    if (abortController.signal.aborted) return { matched: 0 };

    // Cached hit
    if (p.ck in searchCache) {
      const c = searchCache[p.ck];
      if (c) { matchedUris[p.i] = c.uri; registerUri(c.uri, p.i); totalMatched++; setTrackStatus(p.i, "found"); updateTrackArt(p.i, c); }
      else { setTrackStatus(p.i, "not_found"); }
      updateMatchCount(); continue;
    }

    // Over budget → skip for later
    if (searchesDone >= budget || spotifyBlockedFor() > 0) { setTrackStatus(p.i, "skipped"); skippedPlan.push(p); continue; }

    // Search
    setTrackStatus(p.i, "searching");
    showStatus("Matching… (" + (searchesDone+1) + "/" + budget + " searches, " + totalMatched + " found)");
    const result = await spotifySearch(token, p.artist, p.track);
    searchesDone++;
    if (result) { matchedUris[p.i] = result.uri; registerUri(result.uri, p.i); totalMatched++; setTrackStatus(p.i, "found"); updateTrackArt(p.i, result); }
    else if (spotifyBlockedFor() > 0) { setTrackStatus(p.i, "skipped"); skippedPlan.push(p); }  // rate limited, not missing: try again later
    else { setTrackStatus(p.i, "not_found"); }
    updateMatchCount();
    if (searchesDone < budget && spotifyBlockedFor() === 0) await new Promise(r => setTimeout(r, SEARCH_DELAY));
  }

  // Resolve skipped tracks that may have been cached during this batch
  for (let si = skippedPlan.length - 1; si >= 0; si--) {
    const p = skippedPlan[si];
    if (p.ck in searchCache) {
      const c = searchCache[p.ck];
      if (c) { matchedUris[p.i] = c.uri; registerUri(c.uri, p.i); totalMatched++; setTrackStatus(p.i, "found"); updateTrackArt(p.i, c); }
      else { setTrackStatus(p.i, "not_found"); }
      skippedPlan.splice(si, 1);
    }
  }
  updateMatchCount();
  return { matched: totalMatched };
}

// ═════════════════════════════════════════════════════════════════════════════
// CORE: FETCH + MATCH + PLAY (by page number)
// ═════════════════════════════════════════════════════════════════════════════
async function fetchAndPlay(user, page, tp) {
  $("trackListWrapper").style.display="none"; $("trackList").innerHTML=""; $("matchCount").textContent="";
  stopPolling();
  try {
    showStatus("Loading that moment…");
    const raw = await getLastFmPage(user, page);
    const tracks = raw.filter(t => !(t["@attr"] && t["@attr"].nowplaying));
    if (!tracks.length) throw new Error("No tracks found for that moment");
    await matchAndPlay(tracks, page, tp);
  } catch(err) {
    if (!abortController.signal.aborted) { radioStop(); currentPhase = "error"; showStatus(err.message, "error"); }
  } finally {
    $("goBtn").style.display = ""; $("cancelBtn").style.display = "none";
    $("usernameInput").disabled = false; updateGoButton();
  }
}

// Plays a direct array of tracks (for date search)
async function fetchAndPlayDirect(tracks, label) {
  $("trackListWrapper").style.display="none"; $("trackList").innerHTML=""; $("matchCount").textContent="";
  stopPolling();
  try {
    if (!tracks.length) throw new Error("No tracks found for this date");
    await matchAndPlay(tracks, null, null, label);
  } catch(err) {
    if (!abortController.signal.aborted) { radioStop(); currentPhase = "error"; showStatus(err.message, "error"); }
  } finally {
    $("goBtn").style.display = ""; $("cancelBtn").style.display = "none";
    $("usernameInput").disabled = false; updateGoButton();
  }
}

// Shared match + play logic
async function matchAndPlay(tracks, page, tp, label) {
  showRadioView("travel");
  $("trackListWrapper").style.display = "";
  $("trackList").innerHTML = tracks.map((t,i) => renderTrackRow(t,i)).join("");
  let token = await getSpotifyToken(); if (!token) throw new Error("Spotify expired. Reconnect.");
  const { matched } = await smartMatch(tracks, token);
  if (!matched) {
    if (spotifyBlockedFor() > 0) throw new Error(spotifyLimitMessage());
    const d = lastSearchError ? " (" + lastSearchError + ")" : ""; throw new Error("No tracks matched" + d);
  }
  const uris = []; for (let i = 0; i < tracks.length; i++) if (matchedUris[i]) uris.push(matchedUris[i]);
  sessionQueue = new Set(uris); sessionPaused = false;
  const eraLabel = label || radioEraLabel(tracks);
  playlistLabel = eraLabel;
  if (eraLabel !== "Random") $("radioTitle").textContent = "Time travel \u00b7 " + eraLabel;
  showStatus("Starting playback…");
  token = await getSpotifyToken();
  const ok = await spotifyPlay(token, uris);
  if (!ok) { const devs = await getSpotifyDevices(token); throw new Error(devs.length === 0 ? "No active Spotify device. Open Spotify and try again." : "Playback failed. Make sure Spotify is active."); }
  currentPhase = "done";
  if (spotifyBlockedFor() > 0) showStatus(spotifyLimitMessage(), "error");  // more tracks cannot load right now: say why
  for (let i = 0; i < tracks.length; i++) { if (matchedUris[i]) { highlightNowPlaying(i); break; } }
  startPolling();
  checkLikedTracks();
  $("savePlaylistBtn").style.display = ""; $("savePlaylistBtn").disabled = false;
  $("savePlaylistBtn").textContent = "Save as Playlist"; $("savePlaylistBtn").className = "btn-save-playlist";
  $("savePlaylistBtn").onclick = saveAsPlaylist;
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
  if ((radioActive || travelActive) && uriToIndices[track.uri]) radioRenderNow(track, state.paused);

  // Check liked status and auto-continue whenever the track changes
  if (track.uri !== _sdkCurrentUri) {
    _sdkCurrentUri = track.uri;
    checkAndUpdateTrackLiked(track.uri);

    // Auto-continue: if we're near the end of matched tracks, load next batch
    if (!isContinuing && skippedPlan.length > 0) {
      const matchedAfter = [];
      let foundCurrent = false;
      for (let i = 0; i < allTrackCount; i++) {
        if (matchedUris[i] === track.uri) foundCurrent = true;
        if (foundCurrent && matchedUris[i] && matchedUris[i] !== track.uri) matchedAfter.push(i);
      }
      if (matchedAfter.length <= 2) continueMatching();
    }
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
  try { await fetch("https://api.spotify.com/v1" + req.path, { method: req.method, headers: { Authorization: "Bearer " + token } }); } catch (e) {}
}
async function playerPlayPause() {
  if (window._stmPlayer && sdkPlaying()) { window._stmPlayer.togglePlay(); return; }
  playerRest("toggle");
}
async function playerPrev() {
  if (window._stmPlayer && sdkPlaying()) { window._stmPlayer.previousTrack(); return; }
  playerRest("prev");
}
async function playerNext() {
  if (window._stmPlayer && sdkPlaying()) { window._stmPlayer.nextTrack(); return; }
  playerRest("next");
}
// Volume slider (desktop only): the SDK player's own volume, so only while the SDK device is the active player
async function setVolume(el) {
  const v = Math.min(Math.max(parseInt(el.value, 10) || 0, 0), 100);
  el.style.setProperty("--vol", v + "%");
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
  for (let i = 0; i < allTrackCount; i++) {
    if (!matchedUris[i]) continue;
    const id = matchedUris[i].split(":").pop();
    const btn = $("heart-" + i);
    if (btn) {
      const liked = likedSet.has(id);
      btn.classList.toggle("liked", liked);
      btn.innerHTML = liked ? HEART_FILLED : HEART_EMPTY;
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
  const btn = $("heart-" + idx);
  if (btn) { btn.classList.toggle("liked", !wasLiked); btn.innerHTML = !wasLiked ? HEART_FILLED : HEART_EMPTY; }
  updateNowPlayingHeart();

  try {
    const uri = encodeURIComponent("spotify:track:" + id);
    if (wasLiked) await spDelete("/me/library?uris=" + uri, null);
    else await spPut("/me/library?uris=" + uri, null);
    showStatus(wasLiked ? "Removed from Liked Songs" : "Saved to Liked Songs", "success");
  } catch (e) {
    // Revert on error
    if (wasLiked) likedSet.add(id); else likedSet.delete(id);
    if (btn) { btn.classList.toggle("liked", wasLiked); btn.innerHTML = wasLiked ? HEART_FILLED : HEART_EMPTY; }
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
    if (rh) { rh.classList.toggle("liked", liked); rh.innerHTML = '<i class="' + (liked ? "ph-fill" : "ph") + ' ph-heart"></i>'; }
  }
}

// =========================================================================
// SPOTIFY CONNECT DEVICES
// =========================================================================
// Pick where the music plays (a speaker, the TV, your phone -- which is how it reaches Android Auto) without
// opening the Spotify app. The pick is remembered; if the device is gone at play time, spotifyPlay() falls back.
const DEVICE_ICONS = { computer: "ph-laptop", smartphone: "ph-device-mobile", tablet: "ph-device-tablet", speaker: "ph-speaker-hifi", tv: "ph-television", automobile: "ph-car", castaudio: "ph-speaker-hifi", castvideo: "ph-television", gameconsole: "ph-game-controller" };
function deviceIcon(type) { return DEVICE_ICONS[String(type || "").toLowerCase()] || "ph-speaker-simple-high"; }

function setPlaybackDevice(dev) {
  playbackDeviceId = dev ? dev.id : null;
  playbackDeviceName = dev ? dev.name || "" : "";
  playbackDeviceType = dev ? dev.type || "" : "";
  try {
    if (dev) localStorage.setItem("stm_device", JSON.stringify({ id: playbackDeviceId, name: playbackDeviceName, type: playbackDeviceType }));
    else localStorage.removeItem("stm_device");
  } catch {}
  renderDeviceButtons();
}
function loadPlaybackDevice() {
  try {
    const d = JSON.parse(localStorage.getItem("stm_device") || "null");
    if (d && d.id) { playbackDeviceId = d.id; playbackDeviceName = d.name || ""; playbackDeviceType = d.type || ""; }
  } catch {}
  renderDeviceButtons();
}

// The label on both device buttons: the picked device, or where automatic playback goes
function renderDeviceButtons() {
  const remote = !!playbackDeviceId;
  const name = remote ? playbackDeviceName : (sdkReady ? "This browser" : "Automatic");
  const icon = remote ? deviceIcon(playbackDeviceType) : (sdkReady ? "ph-laptop" : "ph-speaker-simple-high");
  [["radioDeviceBtn", "radioDeviceName", "radioDeviceIcon"], ["homeDeviceBtn", "homeDeviceName", "homeDeviceIcon"]].forEach(([b, n, i]) => {
    const btn = $(b); if (!btn) return;
    btn.classList.toggle("remote", remote);
    btn.title = "Playing on " + name + ". Choose a device";
    if ($(n)) $(n).textContent = name;
    if ($(i)) $(i).className = "ph " + icon;
  });
  if (typeof radioSyncVolume === "function") radioSyncVolume();
}

let devicePickerAnchor = null;
async function toggleDevicePicker(btn) {
  const pop = $("devicePicker");
  if (!pop) return;
  if (pop.style.display !== "none" && devicePickerAnchor === btn) { closeDevicePicker(); return; }
  devicePickerAnchor = btn;
  pop.style.display = "";
  btn.setAttribute("aria-expanded", "true");
  placeDevicePicker();
  await refreshDevicePicker();
}
function closeDevicePicker() {
  const pop = $("devicePicker");
  if (pop) pop.style.display = "none";
  if (devicePickerAnchor) devicePickerAnchor.setAttribute("aria-expanded", "false");
  devicePickerAnchor = null;
}
// Fixed position under the button (or above it when there is no room below)
function placeDevicePicker() {
  const pop = $("devicePicker"), btn = devicePickerAnchor;
  if (!pop || !btn) return;
  const r = btn.getBoundingClientRect(), w = Math.min(320, window.innerWidth - 32);
  pop.style.width = w + "px";
  pop.style.left = Math.max(16, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 16)) + "px";
  const h = pop.offsetHeight || 240;
  const below = r.bottom + 8 + h <= window.innerHeight || r.top - 8 - h < 0;
  pop.style.top = (below ? r.bottom + 8 : r.top - 8 - h) + "px";
}

async function refreshDevicePicker() {
  const list = $("deviceList");
  if (!list) return;
  list.innerHTML = '<div class="device-empty">Looking for devices...</div>';
  const token = await getSpotifyToken();
  let devices = token ? await getSpotifyDevices(token).catch(() => []) : [];
  // This browser's SDK device first (Spotify may not list it until it has played)
  devices = devices.filter(d => d.id !== sdkDeviceId);
  if (sdkReady && sdkDeviceId) devices.unshift({ id: sdkDeviceId, name: "This browser", type: "Computer", browser: true });
  const current = playbackDeviceId || (sdkReady ? sdkDeviceId : (devices.find(d => d.is_active) || {}).id);
  list.innerHTML = devices.length ? devices.map((d, i) =>
    '<button class="device-opt' + (d.id === current ? " active" : "") + '" data-i="' + i + '"' + (d.is_restricted ? " disabled" : "") + '>' +
    '<i class="ph ' + deviceIcon(d.type) + '" aria-hidden="true"></i><span class="device-opt-name">' + escHtml(d.name || "Unnamed device") + '</span>' +
    (d.id === current ? '<i class="ph-fill ph-speaker-high device-opt-on" aria-label="Playing here"></i>' : "") + '</button>'
  ).join("") : '<div class="device-empty">No devices found.</div>';
  list.querySelectorAll(".device-opt").forEach(b => b.addEventListener("click", () => selectPlaybackDevice(devices[+b.dataset.i])));
  placeDevicePicker();
}

// Switch to a device; a running session moves there and keeps playing from the same spot
async function selectPlaybackDevice(dev) {
  closeDevicePicker();
  if (!dev) return;
  const wasSdk = sdkPlaying();
  const toBrowser = !!dev.browser || dev.id === sdkDeviceId;
  if (toBrowser ? wasSdk : dev.id === playbackDeviceId) return;
  setPlaybackDevice(toBrowser ? null : dev);
  if (sessionQueue.size === 0) return;  // nothing playing yet: the next play goes there
  const token = await getSpotifyToken();
  if (!token) return;
  let ok = false;
  try {
    const cur = wasSdk ? _sdkCurrentUri : radioCurrentUri;
    if (wasSdk && !radioPaused && cur && (radioPendingReissue || radioUnsentUris().length > 0)) {
      // Tracks waiting for the seam would never reach the new device: send the whole list from here
      radioPendingReissue = false;
      ok = await spotifyPlay(token, radioUrisFrom(matchedUris, allTrackCount, cur), _sdkPositionMs);
    } else {
      // A transfer keeps Spotify's queue and position as they are
      const r = await fetch("https://api.spotify.com/v1/me/player", {
        method: "PUT", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ device_ids: [toBrowser ? sdkDeviceId : dev.id], play: !radioPaused })
      });
      ok = r.ok || r.status === 204;
    }
  } catch {}
  if (!ok) { showStatus("Could not switch to " + (dev.name || "that device") + ". Open Spotify on it and try again.", "error"); return; }
  if (toBrowser) stopPolling();
  else { clearInterval(_sdkProgressTimer); startPolling(); setTimeout(pollNowPlaying, 1500); }
}

if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("resize", () => closeDevicePicker());
  window.addEventListener("scroll", () => closeDevicePicker(), { passive: true });
}
