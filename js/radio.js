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

// How long until Spotify lets searches through again, as words ("30 seconds", "2 minutes", "2 hours")
function radioRateLimitText(ms) {
  if (ms <= 0) return "a moment";
  const secs = Math.ceil(ms / 1000);
  if (secs <= 90) return secs + (secs === 1 ? " second" : " seconds");
  const mins = Math.ceil(secs / 60);
  if (mins < 90) return mins + " minutes";
  const hours = Math.ceil(mins / 60);
  return hours + (hours === 1 ? " hour" : " hours");
}

// Label for a set of Last.fm tracks: the oldest date, to the day when all tracks share one
function radioEraLabel(tracks) {
  const uts = (tracks || []).filter(t => t && t.date && t.date.uts).map(t => parseInt(t.date.uts, 10));
  if (!uts.length) return "Random";
  const oldest = new Date(Math.min(...uts) * 1000), newest = new Date(Math.max(...uts) * 1000);
  const sameDay = oldest.toDateString() === newest.toDateString();
  return oldest.toLocaleDateString("en-US", sameDay ? { year: "numeric", month: "long", day: "numeric" } : { year: "numeric", month: "long" });
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
  if (spotifyBlockedFor() > 0) { lastSearchError = "Rate limited (429)"; showStatus(spotifyLimitMessage(), "error"); return 0; }
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
      if (spotifyBlockedFor() > 0) { showStatus(spotifyLimitMessage(), "error"); return added; }
      const hit = await spotifySearch(token, p.artist, p.track);
      if (sid !== radioSession) return added;
      if (!hit && spotifyBlockedFor() > 0) { showStatus(spotifyLimitMessage(), "error"); return added; }
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
    if (!added) throw new Error(spotifyBlockedFor() > 0 ? spotifyLimitMessage() : "No tracks matched" + (lastSearchError ? " (" + lastSearchError + ")" : ""));
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
function radioResetHero() {
  radioHeroLive = false;
  $("radioTrack").textContent = "Tuning...";
  $("radioArtist").textContent = "";
  $("radioArt").removeAttribute("src");
  $("radioFill").style.width = "0"; $("radioElapsed").textContent = "0:00"; $("radioDuration").textContent = "0:00";
  $("radioPlay").innerHTML = '<i class="ph-fill ph-play"></i>';
  radioInfoIdx = -1; radioHideInfo();
}

// mode "radio" (default) shows Up next; "travel" shows the era panel and the full track list
function showRadioView(mode) {
  const travel = mode === "travel";
  const wasHidden = $("radioView").style.display === "none";
  travelActive = travel;
  $("homeView").style.display = "none";
  $("radioView").style.display = "";
  document.body.classList.add("radio-mode");
  $("radioStatusSlot").appendChild($("statusBar"));  // status messages sit between the bio and the list
  $("radioTitle").textContent = travel ? "Time travel" : "Library radio";
  $("radioAgainBtn").style.display = travel ? "" : "none";
  $("radioUpNextBlock").style.display = travel ? "none" : "";
  radioResetHero();
  if (!travel) radioRenderQueue();
  if (wasHidden) window.scrollTo(0, 0);  // the home view may have been scrolled; open the new view at its top
}

function hideRadioView() {
  travelActive = false;
  $("statusSlotHome").appendChild($("statusBar"));  // back to the home view's slot
  $("radioView").style.display = "none";
  $("homeView").style.display = "";
  document.body.classList.remove("radio-mode");
  $("radioUpNext").innerHTML = "";
  radioResetHero();
}

// Repeat the last Time Travel mode with the same inputs
function travelAgain() {
  if (currentPhase === "working") return;  // a session is still loading: starting another would run two at once
  handleGo();
}

// Last.fm names for the track at idx: the radio's scrobble names, or the time-travel track objects
function radioInfoSource(idx) {
  const m = trackMeta[idx];
  // trackMeta can be left over from a radio session that failed to start: only trust it while the radio runs
  if (radioActive && m && m.lfmArtist) return { artist: m.lfmArtist, track: m.lfmTrack };
  const t = currentTracks[idx];
  if (!t) return null;
  const artist = (t.artist && (t.artist["#text"] || t.artist.name)) || "";
  return artist && t.name ? { artist, track: t.name } : null;
}

// Bio + your play counts for the track at idx. Cached per artist and per track (as promises, so
// concurrent calls share one request); a failed lookup is never cached and never throws.
async function radioInfoFor(idx) {
  const src = radioInfoSource(idx);
  if (!src) return null;
  // radioUser belongs to the radio and can be stale; time travel reads the username field
  const user = travelActive ? $("usernameInput").value.trim() : radioUser;
  const uKey = user.toLowerCase();
  const aKey = uKey + "|" + src.artist.toLowerCase(), tKey = uKey + "|" + radioTrackKey(src.artist, src.track);
  if (!(aKey in radioArtistCache)) radioArtistCache[aKey] = getLastFmArtistInfo(user, src.artist).then(radioArtistFromInfo, () => null);
  if (!(tKey in radioTrackCache)) radioTrackCache[tKey] = getLastFmTrackInfo(user, src.artist, src.track).then(radioTrackPlaysFromInfo, () => null);
  const [artist, trackPlays] = await Promise.all([radioArtistCache[aKey], radioTrackCache[tKey]]);
  if (!artist) delete radioArtistCache[aKey];
  if (trackPlays === null) delete radioTrackCache[tKey];
  const bio = artist ? radioParseBio(artist.bioHtml) : { text: "", url: "" };
  return { artist: src.artist, track: src.track, bioText: bio.text, bioUrl: bio.url, plays: artist ? artist.plays : null, trackPlays };
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
  if (idx < 0 || !radioInfoSource(idx)) return;
  radioInfoFor(idx).then(info => {
    if (!info || sid !== radioSession || idx !== radioInfoIdx) return;
    radioRenderInfo(info);
  });
}

// Hero: the playing track (SDK track object or Spotify currently-playing item)
function radioRenderNow(track, paused) {
  radioSetPaused(paused);
  radioHeroLive = true;
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

// One Up next row: cover (https only, so the URL is safe in an attribute), title, artist, and the scrobble year when known
function radioQueueRowHtml(idx, m, esc) {
  esc = esc || (s => s);
  const art = /^https:\/\/[^"'<>\s]+$/.test(m.art || "")
    ? '<img class="radio-row-art" src="' + m.art + '" alt="" loading="lazy">'
    : '<div class="radio-row-art"></div>';
  const year = m.year ? '<span class="radio-row-year">' + esc(String(m.year)) + '</span>' : "";
  return '<div class="radio-row radio-row-play" onclick="radioPlayFrom(' + idx + ')">' + art
    + '<div class="radio-row-text"><div class="radio-row-title">' + esc(m.name) + '</div><div class="radio-row-artist">' + esc(m.artist) + '</div></div>' + year + '</div>';
}

// Up next: the matched tracks after the current one, plus a Tuning row while a top-up runs
function radioRenderQueue() {
  const box = $("radioUpNext");
  if (!box) return;
  let html = "", shown = 0;
  for (let i = Math.max(nowPlayingIndex + 1, 0); i < allTrackCount && shown < RADIO_UPNEXT_ROWS; i++) {
    const m = trackMeta[i];
    if (!m) continue;
    html += radioQueueRowHtml(i, m, escHtml);
    shown++;
  }
  if (radioRefilling) {
    html += '<div class="radio-row radio-row-tuning"><div class="radio-row-text"><div class="radio-row-title">Tuning...</div></div></div>';
  }
  box.innerHTML = html;
}

// Play the radio from a queued track onward (the Up next rows call this)
async function radioPlayFrom(idx) {
  if (!radioActive || !matchedUris[idx]) return;
  const token = await getSpotifyToken();
  if (!token) return;
  const ok = await spotifyPlay(token, radioUrisFrom(matchedUris, allTrackCount, matchedUris[idx]));
  if (!ok) showStatus("Playback failed. Is Spotify active?", "error");
}

// Back: pause playback and return to the home view
async function leaveRadio() {
  handleReset();
  try { await spPut("/me/player/pause", null); } catch (e) {}
}

// ===== node test exports (no-op in browsers) =====
if (typeof module !== "undefined" && module.exports) {
  module.exports = { radioPickPage, radioTrackKey, radioScrobbleFromTracks, radioParseBio, radioPlaysText, radioStatsHtml, radioArtistFromInfo, radioTrackPlaysFromInfo, radioEraLabel, radioRateLimitText, radioRemaining, radioUrisFrom, radioShouldRefill, radioCoverUrl, radioTransportRequest, radioQueueRowHtml };
}
