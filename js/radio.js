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

// Last.fm bio summary (HTML) -> plain text plus the trailing "Read more on Last.fm" url
function radioParseBio(html) {
  if (!html) return { text: "", url: "" };
  let url = "";
  let s = String(html).replace(/<a\s[^>]*href="([^"]*)"[^>]*>\s*Read more on Last\.fm\s*<\/a>/i, (m, href) => { url = /^https?:\/\//i.test(href) ? href : ""; return " "; });
  s = s.replace(/<br\s*\/?>|<\/p>/gi, " ").replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
  if (s.length > 600) { const cut = s.slice(0, 600); s = cut.slice(0, cut.lastIndexOf(" ")) + "..."; }
  return { text: s, url };
}

function radioPlaysText(n) {
  return n.toLocaleString("en-US") + (n === 1 ? " time" : " times");
}

// "You've listened to <artist> N times and <track> M times." (empty when the artist count is unknown)
function radioStatsHtml(artist, artistPlays, track, trackPlays, esc) {
  esc = esc || (s => s);
  if (artistPlays === null || artistPlays === undefined) return "";
  let s = "You've listened to <strong>" + esc(artist) + "</strong> " + radioPlaysText(artistPlays);
  if (trackPlays !== null && trackPlays !== undefined) s += " and <strong>" + esc(track) + "</strong> " + radioPlaysText(trackPlays);
  return s + ".";
}

// Last.fm getInfo responses carry userplaycount as a string
function radioArtistFromInfo(d) {
  const a = d && d.artist;
  const raw = a && a.stats ? a.stats.userplaycount : undefined;
  const plays = raw === undefined ? NaN : parseInt(raw, 10);
  return { bioHtml: (a && a.bio && a.bio.summary) || "", plays: isNaN(plays) ? null : plays };
}
function radioTrackPlaysFromInfo(d) {
  const t = d && d.track;
  const n = t && t.userplaycount !== undefined ? parseInt(t.userplaycount, 10) : NaN;
  return isNaN(n) ? null : n;
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

// REST fallback for the radio controls when the SDK is not driving playback
function radioTransportRequest(action, paused) {
  if (action === "toggle") return { method: "PUT", path: paused ? "/me/player/play" : "/me/player/pause" };
  if (action === "next") return { method: "POST", path: "/me/player/next" };
  if (action === "prev") return { method: "POST", path: "/me/player/previous" };
  return null;
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
          album: p.album, page: p.page, year: p.year, art: radioCoverUrl(hit),
          lfmArtist: p.artist, lfmTrack: p.track  // the scrobble's own names, for Last.fm getInfo lookups
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
  radioCurrentUri = null; radioLastPos = 0; radioPaused = false; radioPendingReissue = false; radioUser = user; radioActive = true;
  const sid = ++radioSession;
  try {
    showStatus("Reading your Last.fm library...");
    const { totalScrobbles } = await getLastFmTotalPages(user);
    if (sid !== radioSession) return;
    if (!totalScrobbles) throw new Error("No scrobbles found");
    radioTotal = totalScrobbles;
    showRadioView();
    showStatus("Tuning your library...");
    const added = await radioFill(RADIO_INITIAL);
    if (sid !== radioSession) return;
    if (!added) throw new Error("No tracks matched" + (lastSearchError ? " (" + lastSearchError + ")" : ""));
    radioRenderQueue();
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
  radioRefilling = true; radioRenderQueue();
  try {
    const added = await radioFill(RADIO_REFILL);
    if (sid !== radioSession) return;
    if (!added) {
      // Only a healthy Last.fm + Spotify round that found nothing new means the library is exhausted;
      // a failing search or a missing token is transient and must stay retryable
      const healthy = radioFailures === 0 && !lastSearchError && await getSpotifyToken();
      if (sid !== radioSession) return;
      if (healthy) { radioExhausted = true; showStatus("No more new tracks in your library. Playing what is queued.", ""); }
      return;
    }
    if (radioPaused) { radioPendingReissue = true; return; }  // do not resume what the user paused
    await radioReissue();
  } finally {
    if (sid === radioSession) { radioRefilling = false; radioRenderQueue(); }
  }
}

// Re-issue playback from the current track so the queued tracks include the new ones
async function radioReissue() {
  const sid = radioSession;
  const currentUri = sdkReady ? _sdkCurrentUri : radioCurrentUri;
  if (!currentUri) return;
  const uris = radioUrisFrom(matchedUris, allTrackCount, currentUri);
  if (!uris.length) return;
  const token = await getSpotifyToken();
  if (!token || sid !== radioSession) return;
  await spotifyPlay(token, uris, sdkReady ? _sdkPositionMs : radioLastPos);
  checkLikedTracks();
}

// Track the play/pause state; a top-up that finished while paused re-issues on resume
function radioSetPaused(paused) {
  radioPaused = paused;
  if (!paused && radioPendingReissue) { radioPendingReissue = false; radioReissue(); }
}

// Called from the SDK state handler and the polling fallback on every track change
function radioMaybeRefill(currentUri, positionMs) {
  radioCurrentUri = currentUri; radioLastPos = positionMs || 0;
  const remaining = radioRemaining(matchedUris, allTrackCount, currentUri);
  if (radioShouldRefill({ active: radioActive, refilling: radioRefilling, exhausted: radioExhausted, remaining }, RADIO_LOW_WATER)) continueRadio();
}

function radioStop() {
  radioActive = false; radioSession++; radioRefilling = false;
  radioCurrentUri = null; radioLastPos = 0; radioPaused = false; radioPendingReissue = false;
  hideRadioView();
}

// =============================================================================
// HOME: library meta line
// =============================================================================
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

// =============================================================================
// RADIO VIEW
// =============================================================================
function showRadioView() {
  $("homeView").style.display = "none";
  $("radioView").style.display = "";
  document.body.classList.add("radio-mode");
  $("saveSlotRadio").appendChild($("savePlaylistBtn"));
  radioRenderQueue();
}

function hideRadioView() {
  $("radioView").style.display = "none";
  $("homeView").style.display = "";
  document.body.classList.remove("radio-mode");
  $("saveSlotTrackList").appendChild($("savePlaylistBtn"));
  $("radioTrack").textContent = "Tuning...";
  $("radioArtist").textContent = "";
  $("radioArt").removeAttribute("src");
  $("radioFill").style.width = "0"; $("radioElapsed").textContent = "0:00"; $("radioDuration").textContent = "0:00";
  $("radioUpNext").innerHTML = "";
  radioInfoIdx = -1; radioHideInfo();
}

// Bio + your play counts for trackMeta[idx]. Cached per artist and per track (as promises, so
// concurrent calls share one request); a failed lookup is never cached and never throws.
async function radioInfoFor(idx) {
  const m = trackMeta[idx];
  if (!m) return null;
  const user = radioUser;
  const aKey = m.lfmArtist.toLowerCase(), tKey = radioTrackKey(m.lfmArtist, m.lfmTrack);
  if (!(aKey in radioArtistCache)) radioArtistCache[aKey] = getLastFmArtistInfo(user, m.lfmArtist).then(radioArtistFromInfo, () => null);
  if (!(tKey in radioTrackCache)) radioTrackCache[tKey] = getLastFmTrackInfo(user, m.lfmArtist, m.lfmTrack).then(radioTrackPlaysFromInfo, () => null);
  const [artist, trackPlays] = await Promise.all([radioArtistCache[aKey], radioTrackCache[tKey]]);
  if (!artist) delete radioArtistCache[aKey];
  if (trackPlays === null) delete radioTrackCache[tKey];
  const bio = artist ? radioParseBio(artist.bioHtml) : { text: "", url: "" };
  return { artist: m.lfmArtist, track: m.lfmTrack, bioText: bio.text, bioUrl: bio.url, plays: artist ? artist.plays : null, trackPlays };
}

function radioHideInfo() {
  const box = $("radioInfo");
  if (box) box.style.display = "none";
}

function radioRenderInfo(info) {
  const stats = radioStatsHtml(info.artist, info.plays, info.track, info.trackPlays, escHtml);
  $("radioStats").innerHTML = stats;
  $("radioStats").style.display = stats ? "" : "none";
  const hasBio = !!info.bioText;
  $("radioBio").style.display = hasBio ? "" : "none";
  if (hasBio) {
    $("radioBioName").textContent = info.artist;
    $("radioBioText").textContent = info.bioText;
    const link = $("radioBioLink");
    link.style.display = info.bioUrl ? "" : "none";
    if (info.bioUrl) link.href = info.bioUrl;
  }
  $("radioInfo").style.display = (stats || hasBio) ? "" : "none";
}

// Load the panel when the playing track changes (radioRenderNow runs on every player event)
function radioSyncInfo() {
  if (nowPlayingIndex === radioInfoIdx) return;
  radioInfoIdx = nowPlayingIndex;
  const idx = radioInfoIdx, sid = radioSession;
  radioHideInfo();
  if (idx < 0 || !trackMeta[idx]) return;
  radioInfoFor(idx).then(info => {
    if (!info || sid !== radioSession || idx !== radioInfoIdx) return;
    radioRenderInfo(info);
  });
}

// Hero: the playing track (SDK track object or Spotify currently-playing item)
function radioRenderNow(track, paused) {
  radioSetPaused(paused);
  const meta = trackMeta[nowPlayingIndex];
  const img = track.album && track.album.images && track.album.images[0];
  $("radioArt").src = img ? img.url : (meta && meta.art) || "";
  $("radioTrack").textContent = track.name || (meta && meta.name) || "";
  const artists = (track.artists || []).map(a => a.name).join(", ");
  const album = track.album && track.album.name;
  $("radioArtist").textContent = artists + (album ? " · " + album : "");
  $("radioPlay").innerHTML = '<i class="ph-fill ph-' + (paused ? "play" : "pause") + '"></i>';
  radioSyncInfo();
  radioRenderQueue();
}

// Up next: the matched tracks after the current one, plus a Tuning row while a top-up runs
function radioRenderQueue() {
  const box = $("radioUpNext");
  if (!box) return;
  let html = "", shown = 0;
  for (let i = Math.max(nowPlayingIndex + 1, 0); i < allTrackCount && shown < RADIO_UPNEXT_ROWS; i++) {
    const m = trackMeta[i];
    if (!m) continue;
    html += '<div class="radio-row"><div class="radio-row-text"><div class="radio-row-title">' + escHtml(m.name) + '</div><div class="radio-row-artist">' + escHtml(m.artist) + '</div></div></div>';
    shown++;
  }
  if (radioRefilling) {
    html += '<div class="radio-row radio-row-tuning"><div class="radio-row-text"><div class="radio-row-title">Tuning...</div></div></div>';
  }
  box.innerHTML = html;
}

// Back: pause playback and return to the home view
async function leaveRadio() {
  handleReset();
  try { await spPut("/me/player/pause", null); } catch (e) {}
}

// ===== node test exports (no-op in browsers) =====
if (typeof module !== "undefined" && module.exports) {
  module.exports = { radioPickPage, radioTrackKey, radioScrobbleFromTracks, radioParseBio, radioPlaysText, radioStatsHtml, radioArtistFromInfo, radioTrackPlaysFromInfo, radioRemaining, radioUrisFrom, radioShouldRefill, radioCoverUrl, radioTransportRequest };
}
