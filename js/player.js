
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
      showStatus("Playback moved to another session - click a track to reclaim", "");
    }
    return;
  }
  if (sessionPaused) {
    sessionPaused = false;
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
  isContinuing = true;
  const token = await getSpotifyToken();
  if (!token) { isContinuing = false; return; }

  // Take the next batch from skippedPlan
  const batch = skippedPlan.splice(0, BATCH_SIZE);
  let batchMatched = 0;

  showStatus("Loading more tracks… (" + totalMatched + " matched so far)", "");

  for (let bi = 0; bi < batch.length; bi++) {
    const p = batch[bi];
    // Maybe it got cached from a previous search
    if (p.ck in searchCache) {
      const c = searchCache[p.ck];
      if (c) {
        matchedUris[p.i] = c.uri;
        registerUri(c.uri, p.i);
        totalMatched++; batchMatched++;
        setTrackStatus(p.i, "found");
        // Add to Spotify queue
        await spotifyAddToQueue(token, c.uri);
        sessionQueue.add(c.uri);
      } else { setTrackStatus(p.i, "not_found"); }
      updateMatchCount();
      continue;
    }

    setTrackStatus(p.i, "searching");
    const result = await spotifySearch(token, p.artist, p.track);
    if (result) {
      matchedUris[p.i] = result.uri;
      registerUri(result.uri, p.i);
      totalMatched++; batchMatched++;
      setTrackStatus(p.i, "found");
      await spotifyAddToQueue(token, result.uri);
      sessionQueue.add(result.uri);
    } else {
      setTrackStatus(p.i, "not_found");
    }
    updateMatchCount();
    if (bi < batch.length - 1) await new Promise(r => setTimeout(r, SEARCH_DELAY));
  }

  if (batchMatched > 0) {
    showStatus("▶ Playing · " + totalMatched + " of " + allTrackCount + " matched" + (skippedPlan.length > 0 ? " · more pending" : ""), "success");
  } else {
    showStatus("▶ Playing · " + totalMatched + " matched · couldn't find more", "success");
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
      if (c) { matchedUris[p.i] = c.uri; registerUri(c.uri, p.i); totalMatched++; setTrackStatus(p.i, "found"); }
      else { setTrackStatus(p.i, "not_found"); }
      updateMatchCount(); continue;
    }

    // Over budget → skip for later
    if (searchesDone >= budget) { setTrackStatus(p.i, "skipped"); skippedPlan.push(p); continue; }

    // Search
    setTrackStatus(p.i, "searching");
    showStatus("Matching… (" + (searchesDone+1) + "/" + budget + " searches, " + totalMatched + " found)");
    const result = await spotifySearch(token, p.artist, p.track);
    searchesDone++;
    if (result) { matchedUris[p.i] = result.uri; registerUri(result.uri, p.i); totalMatched++; setTrackStatus(p.i, "found"); }
    else { setTrackStatus(p.i, "not_found"); }
    updateMatchCount();
    if (searchesDone < budget) await new Promise(r => setTimeout(r, SEARCH_DELAY));
  }

  // Resolve skipped tracks that may have been cached during this batch
  for (let si = skippedPlan.length - 1; si >= 0; si--) {
    const p = skippedPlan[si];
    if (p.ck in searchCache) {
      const c = searchCache[p.ck];
      if (c) { matchedUris[p.i] = c.uri; registerUri(c.uri, p.i); totalMatched++; setTrackStatus(p.i, "found"); }
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
    showStatus("Loading page "+page.toLocaleString()+"…");
    const raw = await getLastFmPage(user, page);
    const tracks = raw.filter(t => !(t["@attr"] && t["@attr"].nowplaying));
    if (!tracks.length) throw new Error("No tracks on this page");
    updateEraInfo(tracks, page, tp);
    await matchAndPlay(tracks, page, tp);
  } catch(err) {
    if (!abortController.signal.aborted) { currentPhase = "error"; showStatus(err.message, "error"); }
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
    if (!abortController.signal.aborted) { currentPhase = "error"; showStatus(err.message, "error"); }
  } finally {
    $("goBtn").style.display = ""; $("cancelBtn").style.display = "none";
    $("usernameInput").disabled = false; updateGoButton();
  }
}

// Shared match + play logic
async function matchAndPlay(tracks, page, tp, label) {
  $("trackListWrapper").style.display = "";
  $("trackList").innerHTML = tracks.map((t,i) => renderTrackRow(t,i)).join("");
  let token = await getSpotifyToken(); if (!token) throw new Error("Spotify expired. Reconnect.");
  const { matched } = await smartMatch(tracks, token);
  if (!matched) { const d = lastSearchError ? " (" + lastSearchError + ")" : ""; throw new Error("No tracks matched" + d); }
  const uris = []; for (let i = 0; i < tracks.length; i++) if (matchedUris[i]) uris.push(matchedUris[i]);
  sessionQueue = new Set(uris); sessionPaused = false;
  playlistLabel = label || (page ? "Page " + page.toLocaleString() : "Random");
  showStatus("Starting playback…");
  token = await getSpotifyToken();
  const ok = await spotifyPlay(token, uris);
  if (!ok) { const devs = await getSpotifyDevices(token); throw new Error(devs.length === 0 ? "No active Spotify device. Open Spotify and try again." : "Playback failed. Make sure Spotify is active."); }
  currentPhase = "done";
  const where = label || (page ? "page " + page.toLocaleString() : "");
  const pendingMsg = skippedPlan.length > 0 ? " · more will load as you listen" : "";
  showStatus("▶ Playing " + matched + " tracks" + (where ? " from " + where : "") + pendingMsg, "success");
  for (let i = 0; i < tracks.length; i++) { if (matchedUris[i]) { highlightNowPlaying(i); break; } }
  startPolling();
  $("savePlaylistBtn").style.display = ""; $("savePlaylistBtn").disabled = false;
  $("savePlaylistBtn").textContent = "Save as Playlist"; $("savePlaylistBtn").className = "btn-save-playlist";
}