// =============================================================================
// LIBRARY RADIO - pure helpers (no globals, no DOM; unit-tested with node)
// =============================================================================

// Random 1-based position in the user's scrobble history. With limit=1, Last.fm's
// "page" parameter is an index into the scrobbles, so this is uniform over history.
function radioPickPage(total, rand) {
  return Math.floor((rand || Math.random)() * total) + 1;
}

function radioTrackKey(artist, track) {
  return (artist + "||" + track).toLowerCase();
}

// Turn Last.fm's track list (array, single object, or missing) into one scrobble
function radioScrobbleFromTracks(list, page) {
  const arr = Array.isArray(list) ? list : (list ? [list] : []);
  const t = arr.find(x => x && !(x["@attr"] && x["@attr"].nowplaying));
  if (!t || !t.name) return null;
  const artist = (t.artist && (t.artist["#text"] || t.artist.name)) || "";
  if (!artist) return null;
  const uts = t.date && parseInt(t.date.uts, 10);
  return { artist, track: t.name, album: (t.album && t.album["#text"]) || "", page, year: uts ? new Date(uts * 1000).getFullYear() : null };
}

function radioFormatPage(page, total, year) {
  return "Page " + page.toLocaleString("en-US") + " of " + total.toLocaleString("en-US") + (year ? ", " + year : "");
}

// How many matched tracks come after currentUri (Infinity when it is not ours)
function radioRemaining(matched, count, currentUri) {
  let found = false, after = 0;
  for (let i = 0; i < count; i++) {
    const u = matched[i];
    if (!u) continue;
    if (found) after++; else if (u === currentUri) found = true;
  }
  return found ? after : Infinity;
}

// Matched URIs from currentUri onward (everything when currentUri is null)
function radioUrisFrom(matched, count, currentUri) {
  const uris = [];
  let started = !currentUri;
  for (let i = 0; i < count; i++) {
    const u = matched[i];
    if (!u) continue;
    if (!started && u === currentUri) started = true;
    if (started) uris.push(u);
  }
  return uris;
}

function radioShouldRefill(s, lowWater) {
  return !!s.active && !s.refilling && !s.exhausted && s.remaining <= lowWater;
}

function radioCoverUrl(hit, size) {
  const im = hit && hit.album && hit.album.images;
  if (!im || !im.length) return "";
  const pick = size === "medium" ? (im[1] || im[0]) : (im[im.length - 1] || im[0]);
  return pick.url || "";
}

// =============================================================================
// LIBRARY RADIO - engine (uses globals from config.js, spotify.js, player.js)
// =============================================================================
function radioSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Fire RADIO_CONCURRENCY single-scrobble requests in parallel
async function radioCollectBatch(user) {
  const pages = [];
  for (let k = 0; k < RADIO_CONCURRENCY; k++) pages.push(radioPickPage(radioTotal));
  const settled = await Promise.allSettled(pages.map(p => getLastFmScrobbleAt(user, p).then(list => radioScrobbleFromTracks(list, p))));
  const picks = []; let failed = 0;
  for (const s of settled) {
    if (s.status === "rejected") failed++;
    else if (s.value) picks.push(s.value);
  }
  return { picks, failed, total: settled.length };
}

// Pick random scrobbles, match them on Spotify, append matches to the session. Returns
// the number of tracks added. Bails out quietly if the session changes mid-flight.
async function radioFill(want) {
  const sid = radioSession, user = radioUser;
  const token = await getSpotifyToken();
  if (!token || sid !== radioSession) return 0;
  lastSearchError = null;
  let added = 0, attempts = 0;
  while (added < want && attempts < RADIO_MAX_ATTEMPTS) {
    const batch = await radioCollectBatch(user);
    if (sid !== radioSession) return added;
    attempts += batch.total;
    if (batch.failed === batch.total) {
      radioFailures++;
      if (radioFailures >= 3) showStatus("Last.fm is slow, retrying...", "");
      await radioSleep(Math.min(1000 * radioFailures, 8000));
      if (sid !== radioSession) return added;
      continue;
    }
    radioFailures = 0;
    for (const p of batch.picks) {
      if (added >= want) break;
      const key = radioTrackKey(p.artist, p.track);
      if (radioSeen.has(key)) continue;
      radioSeen.add(key);
      const hit = await spotifySearch(token, p.artist, p.track);
      if (sid !== radioSession) return added;
      if (hit && !uriToIndices[hit.uri]) {
        const idx = allTrackCount++;
        matchedUris[idx] = hit.uri; registerUri(hit.uri, idx); sessionQueue.add(hit.uri); totalMatched++;
        trackMeta[idx] = {
          name: hit.name || p.track,
          artist: (hit.artists && hit.artists.length ? hit.artists.map(a => a.name).join(", ") : p.artist),
          album: p.album, page: p.page, year: p.year, art: radioCoverUrl(hit)
        };
        added++;
      }
      await radioSleep(SEARCH_DELAY);
      if (sid !== radioSession) return added;
    }
  }
  return added;
}

async function startRadio() {
  const user = $("usernameInput").value.trim();
  if (!user || !spotifyToken) return;
  beginSession();
  matchedUris = {}; allTrackCount = 0; uriToIndices = {}; totalMatched = 0; skippedPlan = []; isContinuing = false;
  trackMeta = {}; radioSeen = new Set(); radioFailures = 0; radioRefilling = false; radioExhausted = false;
  radioCurrentUri = null; radioLastPos = 0; radioUser = user; radioActive = true;
  const sid = ++radioSession;
  try {
    showStatus("Reading your Last.fm library...");
    const { totalScrobbles } = await getLastFmTotalPages(user);
    if (sid !== radioSession) return;
    if (!totalScrobbles) throw new Error("No scrobbles found");
    radioTotal = totalScrobbles;
    showStatus("Tuning your library...");
    const added = await radioFill(RADIO_INITIAL);
    if (sid !== radioSession) return;
    if (!added) throw new Error("No tracks matched" + (lastSearchError ? " (" + lastSearchError + ")" : ""));
    const token = await getSpotifyToken();
    if (!token) throw new Error("Spotify expired. Reconnect.");
    showStatus("Starting playback...");
    const ok = await spotifyPlay(token, radioUrisFrom(matchedUris, allTrackCount, null));
    if (sid !== radioSession) return;
    if (!ok) {
      const devs = await getSpotifyDevices(token);
      throw new Error(devs.length === 0 ? "No active Spotify device. Open Spotify and try again." : "Playback failed. Make sure Spotify is active.");
    }
    currentPhase = "done"; playlistLabel = "Library Radio";
    showStatus("▶ Library radio" + (totalScrobbles < 200 ? " · small library, new tracks may run out" : ""), "success");
    startPolling();
    checkLikedTracks();
    const btn = $("savePlaylistBtn");
    btn.style.display = ""; btn.disabled = false; btn.textContent = "Save as Playlist"; btn.className = "btn-save-playlist"; btn.onclick = saveAsPlaylist;
    endSessionUI();
  } catch (err) {
    if (sid !== radioSession) return;
    radioStop(); currentPhase = "error"; showStatus(err.message, "error"); endSessionUI();
  }
}

// Top up the queue, then re-issue playback from the current track so the new tracks join
// the Spotify context (same approach as continueMatching; avoids the persistent user queue)
async function continueRadio() {
  if (!radioActive || radioRefilling || radioExhausted) return;
  const sid = radioSession;
  radioRefilling = true;
  try {
    const added = await radioFill(RADIO_REFILL);
    if (sid !== radioSession) return;
    if (!added) { if (radioFailures === 0) radioExhausted = true; return; }
    const currentUri = sdkReady ? _sdkCurrentUri : radioCurrentUri;
    if (!currentUri) return;
    const uris = radioUrisFrom(matchedUris, allTrackCount, currentUri);
    if (!uris.length) return;
    const token = await getSpotifyToken();
    if (!token || sid !== radioSession) return;
    await spotifyPlay(token, uris, sdkReady ? _sdkPositionMs : radioLastPos);
    checkLikedTracks();
  } finally {
    if (sid === radioSession) radioRefilling = false;
  }
}

// Called from the SDK state handler and the polling fallback on every track change
function radioMaybeRefill(currentUri, positionMs) {
  radioCurrentUri = currentUri; radioLastPos = positionMs || 0;
  const remaining = radioRemaining(matchedUris, allTrackCount, currentUri);
  if (radioShouldRefill({ active: radioActive, refilling: radioRefilling, exhausted: radioExhausted, remaining }, RADIO_LOW_WATER)) continueRadio();
}

function radioStop() {
  radioActive = false; radioSession++; radioRefilling = false;
  radioCurrentUri = null; radioLastPos = 0;
}

// =============================================================================
// HOME: library meta line and cover mosaic
// =============================================================================
let mosaicUser = "";

async function refreshHomeMeta() {
  const user = $("usernameInput").value.trim();
  const el = $("homeMeta");
  if (!user) { el.textContent = "Enter your Last.fm username to start."; return; }
  try {
    const { totalScrobbles } = await getLastFmTotalPages(user);
    if ($("usernameInput").value.trim() !== user) return;
    el.textContent = user + " · " + totalScrobbles.toLocaleString("en-US") + " scrobbles";
  } catch (e) {
    if ($("usernameInput").value.trim() === user) el.textContent = "Could not load a library for " + user;
  }
}

function renderMosaic(urls) {
  document.querySelectorAll("#mosaic .mosaic-tile").forEach((tile, i) => {
    const old = tile.querySelector("img");
    if (old) old.remove();
    if (!urls[i]) return;
    const img = new Image();
    img.className = "mosaic-img"; img.alt = "";
    img.onload = () => { tile.appendChild(img); requestAnimationFrame(() => img.classList.add("loaded")); };
    img.src = urls[i];
  });
}

// Fill the mosaic with Spotify covers of random scrobbles. Purely decorative: any failure
// leaves the placeholder tiles, and it yields to a radio or time-travel session.
async function loadMosaic() {
  const user = $("usernameInput").value.trim();
  if (!user || !spotifyToken || mosaicUser === user) return;
  mosaicUser = user;
  const cacheKey = "stm_mosaic:" + user.toLowerCase();
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
    if (cached && cached.length) { renderMosaic(cached); return; }
  } catch (e) {}
  try {
    const { totalScrobbles } = await getLastFmTotalPages(user);
    if (!totalScrobbles) { mosaicUser = ""; return; }
    const token = await getSpotifyToken();
    if (!token) { mosaicUser = ""; return; }
    const urls = [], seen = new Set();
    let tries = 0;
    while (urls.length < 8 && tries < 16) {
      const batch = await Promise.allSettled(Array.from({ length: 4 }, () => {
        const p = radioPickPage(totalScrobbles);
        return getLastFmScrobbleAt(user, p).then(list => radioScrobbleFromTracks(list, p));
      }));
      tries += 4;
      for (const s of batch) {
        if (urls.length >= 8) break;
        if (s.status !== "fulfilled" || !s.value) continue;
        const key = radioTrackKey(s.value.artist, s.value.track);
        if (seen.has(key)) continue;
        seen.add(key);
        if (radioActive || currentPhase === "working" || $("usernameInput").value.trim() !== user) { mosaicUser = ""; return; }
        const hit = await spotifySearch(token, s.value.artist, s.value.track);
        const url = hit ? radioCoverUrl(hit, "medium") : "";
        if (url && !urls.includes(url)) urls.push(url);
        await radioSleep(SEARCH_DELAY);
      }
    }
    if (urls.length) {
      renderMosaic(urls);
      try { sessionStorage.setItem(cacheKey, JSON.stringify(urls)); } catch (e) {}
    } else { mosaicUser = ""; }
  } catch (e) { mosaicUser = ""; }
}

// ===== node test exports (no-op in browsers) =====
if (typeof module !== "undefined" && module.exports) {
  module.exports = { radioPickPage, radioTrackKey, radioScrobbleFromTracks, radioFormatPage, radioRemaining, radioUrisFrom, radioShouldRefill, radioCoverUrl };
}
