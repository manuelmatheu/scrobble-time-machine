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

// ===== Stations =====
const RADIO_STATIONS = {
  library: { eyebrow: "Library radio", headline: "Your library, shuffled across every year.", title: "Library radio", button: "Start Library radio" },
  discover: { eyebrow: "Discover radio", headline: "New music, picked from your taste.", title: "Discover radio", button: "Start Discover radio" }
};

// Last.fm station JSON -> [{ artist, track }] (entries without a title or artist are dropped)
function discoverParseStation(data) {
  const list = data && Array.isArray(data.playlist) ? data.playlist : [];
  const out = [];
  for (const t of list) {
    const artist = t && t.artists && t.artists[0] && t.artists[0].name;
    if (t && typeof t.name === "string" && t.name && typeof artist === "string" && artist) out.push({ artist, track: t.name });
  }
  return out;
}
// artist.getsimilar JSON -> artist names (Last.fm sends one object instead of an array for a single result)
function discoverParseSimilarArtists(d) {
  const a = d && d.similarartists && d.similarartists.artist;
  return (Array.isArray(a) ? a : a ? [a] : []).map(x => x && x.name).filter(n => typeof n === "string" && n);
}
// artist.gettoptracks JSON -> track names
function discoverParseTopTracks(d) {
  const t = d && d.toptracks && d.toptracks.track;
  return (Array.isArray(t) ? t : t ? [t] : []).map(x => x && x.name).filter(n => typeof n === "string" && n);
}
// Take `ratio` items of a for every item of b, then whatever is left
function discoverInterleave(a, b, ratio) {
  const out = [], r = Math.max(1, ratio || 1), x = a.slice(), y = b.slice();
  while (x.length || y.length) {
    for (let i = 0; i < r && x.length; i++) out.push(x.shift());
    if (y.length) out.push(y.shift());
  }
  return out;
}
function discoverShuffle(list, rand) {
  const a = list.slice(), rnd = rand || Math.random;
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// What a candidate is to you: "skip" (you played the song), "new-artist" (never played the artist),
// "new-song" (an artist you play, a song you have not) or "unknown" (the lookups failed: not a reason to drop it)
function discoverVerdict(artistPlays, trackPlays) {
  if (trackPlays !== null && trackPlays !== undefined && trackPlays > 0) return "skip";
  if (artistPlays === null || artistPlays === undefined) return "unknown";
  return artistPlays === 0 ? "new-artist" : "new-song";
}
// The artist panel's first lines for a Discover track; "" when there is nothing to say
function discoverStatsHtml(artist, artistPlays, kind, source, esc) {
  esc = esc || (s => s);
  let s = "";
  if (kind === "new-artist") s = "<strong>New to you.</strong> You have never played <strong>" + esc(artist) + "</strong>.";
  else if (kind === "new-song" && artistPlays > 0) s = "<strong>New song.</strong> You've listened to <strong>" + esc(artist) + "</strong> " + radioPlaysText(artistPlays) + ", never this one.";
  if (source === "Last.fm pick") s += (s ? " " : "") + "Picked for you by Last.fm.";
  else if (/^Similar to /.test(source || "")) s += (s ? " " : "") + "Similar to <strong>" + esc(source.slice(11)) + "</strong>, who you listen to lately.";
  return s;
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

// ===== Discover station =====
// Candidates come from two places, interleaved two to one: Last.fm's personalized station (new set on every call)
// and artists similar to your top artists of the last month (a random song from each one's top 10). Every candidate
// is vetted before it costs a Spotify search: songs you have played are dropped, and so are songs you saved.

// Your top artists of the last month (the seeds). Needs the user-top-read scope: without it the station still works.
async function discoverLoadSeeds() {
  if (discoverSeeds) return discoverSeeds;
  try {
    const d = await spGet("/me/top/artists?limit=5&time_range=short_term");
    discoverSeeds = ((d && d.items) || []).map(a => a && a.name).filter(Boolean);
  } catch (e) {
    discoverSeeds = [];
    if (e && e.status === 403) discoverNeedsReconnect = true;
  }
  return discoverSeeds;
}

async function discoverStationCandidates(user) {
  const list = discoverParseStation(await getLastFmStation(user));
  return discoverShuffle(list).map(c => ({ artist: c.artist, track: c.track, source: "Last.fm pick" }));
}

// A few artists similar to the next top artists in rotation, each with one random top-10 song
async function discoverSimilarCandidates() {
  const seeds = await discoverLoadSeeds();
  if (!seeds.length) return [];
  const out = [];
  for (let k = 0; k < DISCOVER_SEEDS_PER_ROUND; k++) {
    const seed = seeds[discoverSeedRound++ % seeds.length];
    if (!discoverSimilarCache[seed]) {
      try { discoverSimilarCache[seed] = discoverParseSimilarArtists(await getLastFmSimilarArtists(seed, 15)); } catch { continue; }  // a failure is not cached
    }
    const fresh = discoverShuffle(discoverSimilarCache[seed].filter(n => !discoverUsedArtists.has(n.toLowerCase()))).slice(0, 3);
    await Promise.all(fresh.map(async name => {
      discoverUsedArtists.add(name.toLowerCase());
      if (!discoverTopCache[name]) {
        try { discoverTopCache[name] = discoverParseTopTracks(await getLastFmArtistTopTracks(name, 10)); } catch { return; }
      }
      const options = discoverTopCache[name].filter(t => !radioSeen.has(radioTrackKey(name, t)));
      if (options.length) out.push({ artist: name, track: options[Math.floor(Math.random() * options.length)], source: "Similar to " + seed });
    }));
  }
  return out;
}

// Fill the pool from both sources. failed = true only when nothing at all could be fetched.
async function discoverRefillPool(user, sid) {
  const [st, sim] = await Promise.allSettled([discoverStationCandidates(user), discoverSimilarCandidates()]);
  if (sid !== radioSession) return { failed: false };
  const station = st.status === "fulfilled" ? st.value : [];
  const similar = sim.status === "fulfilled" ? sim.value : [];
  discoverPool.push(...discoverInterleave(station, similar, 2));
  return { failed: st.status === "rejected" && !similar.length };
}

// Your plays of the artist and of the song, and whether it is worth queueing. null = drop it.
async function discoverVet(user, c) {
  const [artistInfo, trackPlays] = await Promise.all([radioArtistInfoP(user, c.artist), radioTrackPlaysP(user, c.artist, c.track)]);
  const artistPlays = artistInfo ? artistInfo.plays : null;
  const kind = discoverVerdict(artistPlays, trackPlays);
  if (kind === "skip") { radioSeen.add(radioTrackKey(c.artist, c.track)); return null; }
  return { artist: c.artist, track: c.track, album: "", page: null, year: null, source: c.source, kind, artistPlays };
}

async function discoverIsSaved(uri) {
  try { const r = await spGet("/me/library/contains?uris=" + uri); return Array.isArray(r) && !!r[0]; } catch { return false; }
}

// Same shape as radioCollectBatch: a batch of vetted picks. An empty batch is a failure only when the sources failed.
async function discoverCollectBatch(user, sid) {
  if (discoverPool.length < DISCOVER_BATCH) {
    const r = await discoverRefillPool(user, sid);
    if (sid !== radioSession) return { picks: [], failed: 0, total: 1 };
    if (!discoverPool.length) return { picks: [], failed: r.failed ? 1 : 0, total: 1 };
  }
  const cands = [];
  while (cands.length < DISCOVER_BATCH && discoverPool.length) {
    const c = discoverPool.shift();
    if (!radioSeen.has(radioTrackKey(c.artist, c.track))) cands.push(c);
  }
  const vetted = await Promise.all(cands.map(c => discoverVet(user, c)));
  return { picks: vetted.filter(Boolean), failed: 0, total: 1 };
}

// Pick random scrobbles, match them on Spotify, append matches to the session. Returns
// the number of tracks added. Bails out quietly if the session changes mid-flight.
async function radioFill(want) {
  const sid = radioSession, user = radioUser, discover = radioActiveStation === "discover";
  const token = await getSpotifyToken();
  if (!token || sid !== radioSession) return 0;
  if (spotifyBlockedFor() > 0) { lastSearchError = "Rate limited (429)"; showStatus(spotifyLimitMessage(), "error"); return 0; }
  lastSearchError = null;
  let added = 0, attempts = 0;
  while (added < want && attempts < (discover ? DISCOVER_MAX_ROUNDS : RADIO_MAX_ATTEMPTS)) {
    const batch = discover ? await discoverCollectBatch(user, sid) : await radioCollectBatch(user);
    if (sid !== radioSession) return added;
    attempts += discover ? 1 : batch.total;
    if (batch.failed === batch.total) {
      radioFailures++;
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
      if (hit && discover && await discoverIsSaved(hit.uri)) continue;  // saved songs are not new to you
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
        if (discover) Object.assign(trackMeta[idx], { source: p.source, kind: p.kind, artistPlays: p.artistPlays });
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
  radioActiveStation = radioStation;
  const discover = radioActiveStation === "discover";
  discoverPool = []; discoverSeeds = null; discoverSeedRound = 0; discoverSimilarCache = {}; discoverTopCache = {}; discoverUsedArtists = new Set();
  discoverNeedsReconnect = false; discoverWarnedEmpty = false;
  matchedUris = {}; allTrackCount = 0; uriToIndices = {}; totalMatched = 0; skippedPlan = []; isContinuing = false;
  trackMeta = {}; radioSeen = new Set(); radioFailures = 0; radioRefilling = false; radioExhausted = false;
  radioCurrentUri = null; radioLastPos = 0; radioPaused = false; radioPendingReissue = false; radioUser = user; radioActive = true;
  const sid = ++radioSession;
  try {
    let totalScrobbles = 0;
    if (!discover) {
      showStatus("Reading your Last.fm library...");
      ({ totalScrobbles } = await getLastFmTotalPages(user));
      if (sid !== radioSession) return;
      if (!totalScrobbles) throw new Error("No scrobbles found");
      radioTotal = totalScrobbles;
    }
    showRadioView();
    showStatus(discover ? "Tuning new music..." : "Tuning your library...");
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
    currentPhase = "done";
    showStatus("▶ " + RADIO_STATIONS[radioActiveStation].title + (!discover && totalScrobbles < 200 ? " · small library, new tracks may run out" : ""), "success");
    if (discover && discoverNeedsReconnect) showStatus("Reconnect Spotify to get picks based on what you play lately.", "warn");
    startPolling();
    checkLikedTracks();
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
      if (healthy && radioActiveStation === "discover") {
        // New music keeps arriving (the station changes on every call): an empty round is retried on the next track change
        if (!discoverWarnedEmpty) { discoverWarnedEmpty = true; showStatus("No new music found right now. Playing what is queued.", "warn"); }
      } else if (healthy) { radioExhausted = true; showStatus("No more new tracks in your library. Playing what is queued.", "warn"); }
      return;
    }
    if (radioPaused || sdkReady) { radioPendingReissue = true; return; }  // paused: do not resume it; SDK: swap at the seam (radioMaybeSeam)
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
  if (!paused && radioPendingReissue && !sdkReady) { radioPendingReissue = false; radioReissue(); }
}

// SDK only. A re-issue restarts the stream (device transfer + play), which stutters if it lands a few
// seconds into a song. So new tracks wait until the last track Spotify has queued is about to end, then
// replace the context starting at the first new track.
function radioSeamDue(pending, nextCount, positionMs, durationMs, seamMs) {
  return !!pending && nextCount === 0 && durationMs > 0 && durationMs - positionMs <= seamMs;
}

function radioMaybeSeam() {
  if (!(radioActive || travelActive) || !sdkReady) return;
  if (!radioSeamDue(radioPendingReissue, _sdkNextCount, _sdkPositionMs, _sdkDurationMs, RADIO_SEAM_MS)) return;
  radioSeamReissue();
}

async function radioSeamReissue() {
  radioPendingReissue = false;  // first, so the next 250ms tick does not fire it again
  const sid = radioSession;
  const uris = radioUrisFrom(matchedUris, allTrackCount, _sdkCurrentUri).slice(1);  // drop the track that is ending
  if (!uris.length) return;
  const token = await getSpotifyToken();
  if (!token || sid !== radioSession) return;
  let ok = false;
  try { ok = await spotifyPlay(token, uris, 0, { quick: true }); } catch {}
  if (!ok && sid === radioSession) ok = await spotifyPlay(token, uris);  // full device logic as a fallback
  if (ok) checkLikedTracks();
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
// Volume slider: shown (on wide screens, via CSS) only while the SDK device plays; it starts from the player's real volume
let radioVolumeSynced = false;
function radioSyncVolume() {
  const wrap = $("radioVolumeWrap");
  if (!wrap) return;
  wrap.classList.toggle("sdk", !!sdkReady);
  if (!sdkReady || radioVolumeSynced || !window._stmPlayer || !window._stmPlayer.getVolume) return;
  radioVolumeSynced = true;
  Promise.resolve(window._stmPlayer.getVolume()).then(v => {
    const el = $("radioVolume");
    if (el && typeof v === "number") { el.value = Math.round(v * 100); el.style.setProperty("--vol", el.value + "%"); }
  }).catch(() => { radioVolumeSynced = false; });
}

// Home card: while a session runs behind the home view it shows what is playing and leads back to it
let radioNowLabel = "", radioNowPaused = false;
function radioSyncHome() {
  const on = radioMinimized;
  const box = $("radioPlaying"), back = $("radioBackBtn"), again = $("radioBtn");
  if (back) back.style.display = on ? "" : "none";
  if (box) box.style.display = on ? "" : "none";
  if (again) {
    again.className = "btn btn-radio " + (on ? "btn-ghost" : "btn-primary");
    again.innerHTML = on ? "Start a new radio" : '<i class="ph-fill ph-play" aria-hidden="true"></i> ' + RADIO_STATIONS[radioStation].button;
  }
  const state = $("radioPlayingState"), track = $("radioPlayingTrack");
  if (state) state.textContent = radioNowPaused ? "Paused" : "Playing now";
  if (track) track.textContent = radioNowLabel || "Tuning...";
}

function radioResetHero() {
  radioHeroLive = false; radioNowLabel = ""; radioNowPaused = false;
  $("radioTrack").textContent = "Tuning...";
  $("radioArtist").textContent = "";
  $("radioArt").removeAttribute("src");
  $("radioFill").style.width = "0"; $("radioElapsed").textContent = "0:00"; $("radioDuration").textContent = "0:00";
  $("radioPlay").innerHTML = '<i class="ph-fill ph-play"></i>';
  radioInfoIdx = -1; radioHideInfo();
  radioPhotoId = ""; radioShowArtistPhoto(null);
  radioShowSource("");
}

// The "why this track" chip next to NOW PLAYING (Discover only)
function radioShowSource(text) {
  const el = $("radioSource");
  if (!el) return;
  el.style.display = text ? "" : "none";
  const t = $("radioSourceText");
  if (t) t.textContent = text || "";
}

// Home card: the station picked here is the one Start radio plays
function radioSetStation(name) {
  if (!RADIO_STATIONS[name]) name = "library";
  radioStation = name;
  try { localStorage.setItem("stm_station", name); } catch {}
  document.querySelectorAll(".station-opt").forEach(b => { const on = b.dataset.station === name; b.classList.toggle("active", on); b.setAttribute("aria-pressed", on ? "true" : "false"); });
  const s = RADIO_STATIONS[name];
  if ($("radioEyebrow")) $("radioEyebrow").textContent = s.eyebrow;
  if ($("homeHeadline")) $("homeHeadline").textContent = s.headline;
  radioSyncHome();
}

// mode "radio" (default) shows Up next; "travel" shows the era panel and the full track list
function showRadioView(mode) {
  const travel = mode === "travel";
  const wasHidden = $("radioView").style.display === "none";
  travelActive = travel; radioMinimized = false; radioSyncHome();
  $("homeView").style.display = "none";
  $("radioView").style.display = "";
  $("radioStatusSlot").appendChild($("statusBar"));  // status messages sit between the bio and the list
  $("radioTitle").textContent = travel ? "Time travel" : RADIO_STATIONS[radioActiveStation].title;
  $("radioAgainBtn").style.display = travel ? "" : "none";
  $("radioUpNextBlock").style.display = travel ? "none" : "";
  radioResetHero();
  if (!travel) radioRenderQueue();
  if (wasHidden) window.scrollTo(0, 0);  // the home view may have been scrolled; open the new view at its top
}

function hideRadioView() {
  travelActive = false; radioMinimized = false; radioSyncHome();
  $("statusSlotHome").appendChild($("statusBar"));  // back to the home view's slot
  $("radioView").style.display = "none";
  $("homeView").style.display = "";
  $("radioUpNext").innerHTML = "";
  radioResetHero();
}

// Home button: show the home view again but keep the session and the music going; the home card leads back
function radioMinimize() {
  if (!(radioActive || travelActive) || $("radioView").style.display === "none") return;
  radioMinimized = true; radioSyncHome();
  $("statusSlotHome").appendChild($("statusBar"));
  $("radioView").style.display = "none";
  $("homeView").style.display = "";
}

// Back to radio: return to the session that is still running (the hero and queue kept updating while hidden)
function radioReopen() {
  if (!radioMinimized) return;
  radioMinimized = false; radioSyncHome();
  $("homeView").style.display = "none";
  $("radioView").style.display = "";
  $("radioStatusSlot").appendChild($("statusBar"));
  window.scrollTo(0, 0);
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

// Cached Last.fm lookups (promises, so concurrent calls share one request); the info panel and Discover use the same caches
function radioArtistInfoP(user, artist) {
  const k = user.toLowerCase() + "|" + artist.toLowerCase();
  if (!(k in radioArtistCache)) radioArtistCache[k] = getLastFmArtistInfo(user, artist).then(radioArtistFromInfo, () => null);
  return radioArtistCache[k];
}
function radioTrackPlaysP(user, artist, track) {
  const k = user.toLowerCase() + "|" + radioTrackKey(artist, track);
  if (!(k in radioTrackCache)) radioTrackCache[k] = getLastFmTrackInfo(user, artist, track).then(radioTrackPlaysFromInfo, () => null);
  return radioTrackCache[k];
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
  const [artist, trackPlays] = await Promise.all([radioArtistInfoP(user, src.artist), radioTrackPlaysP(user, src.artist, src.track)]);
  if (!artist) delete radioArtistCache[aKey];
  if (trackPlays === null) delete radioTrackCache[tKey];
  const bio = artist ? radioParseBio(artist.bioHtml) : { text: "", url: "" };
  return { artist: src.artist, track: src.track, bioText: bio.text, bioUrl: bio.url, plays: artist ? artist.plays : null, trackPlays };
}

function radioHideInfo() {
  const box = $("radioInfo");
  if (box) box.style.display = "none";
}

function radioRenderInfo(info, meta) {
  const stats = (radioActive && radioActiveStation === "discover" && meta && meta.source && discoverStatsHtml(info.artist, info.plays, meta.kind, meta.source, escHtml))
    || radioStatsHtml(info.artist, info.plays, info.track, info.trackPlays, escHtml);
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

// ===== Artist photo (Spotify) =====
// Last.fm no longer serves artist photos through its API, so the photo comes from Spotify (GET /artists/{id}).
// Pure: the smallest https image that is at least 2x the 148px slot (retina), else the largest; plus the artist's Spotify page.
function radioArtistPhotoFromSpotify(d) {
  const imgs = (d && Array.isArray(d.images) ? d.images : []).filter(i => i && typeof i.url === "string" && /^https:\/\/[^"'<>\s]+$/.test(i.url));
  if (!imgs.length) return null;
  const sorted = imgs.slice().sort((a, b) => (a.width || 0) - (b.width || 0));
  const pick = sorted.find(i => (i.width || 0) >= 296) || sorted[sorted.length - 1];
  const page = d.external_urls && d.external_urls.spotify;
  return { url: pick.url, link: typeof page === "string" && /^https:\/\/open\.spotify\.com\/[^"'<>\s]+$/.test(page) ? page : "" };
}

// Spotify id of the first artist of a playing track (SDK track: artists[].uri; Web API item: artists[].id)
function radioArtistId(track) {
  const a = track && track.artists && track.artists[0];
  if (!a) return "";
  const id = a.id || String(a.uri || "").split(":").pop();
  return /^[A-Za-z0-9]{10,}$/.test(id) ? id : "";
}

let radioPhotoCache = {};  // artist id -> promise of { url, link } | null (a failed request is never kept)
let radioPhotoId = "";     // artist whose photo is showing (or loading)
function radioArtistPhoto(id) {
  if (!(id in radioPhotoCache)) radioPhotoCache[id] = spGet("/artists/" + id).then(radioArtistPhotoFromSpotify, () => undefined);
  return radioPhotoCache[id].then(p => { if (p === undefined) delete radioPhotoCache[id]; return p || null; });
}

function radioShowArtistPhoto(p) {
  const box = $("radioArtistPhoto"), img = $("radioArtistImg");
  if (!box || !img) return;
  if (p) { img.src = p.url; img.style.display = ""; } else { img.removeAttribute("src"); img.style.display = "none"; }
  if (p && p.link) box.href = p.link; else box.removeAttribute("href");
}

// Called on every player event: loads the photo when the playing artist changes (wide desktop only: phones never show it)
function radioSyncArtistPhoto(track) {
  const img = $("radioArtistImg");
  if (!img) return;
  const id = radioArtistId(track);
  const wide = typeof window === "undefined" || !window.matchMedia || window.matchMedia("(min-width:1100px)").matches;
  if (id === radioPhotoId && (!wide || img.getAttribute("src"))) return;
  if (id !== radioPhotoId) { radioPhotoId = id; radioShowArtistPhoto(null); }
  if (!id || !wide) return;
  radioArtistPhoto(id).then(p => { if (id === radioPhotoId) radioShowArtistPhoto(p); });
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
    radioRenderInfo(info, trackMeta[idx]);
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
  radioNowLabel = (track.name || (meta && meta.name) || "") + (artists ? " \u00b7 " + artists : "");
  radioNowPaused = !!paused;
  radioSyncVolume();
  radioShowSource(radioActive && radioActiveStation === "discover" && meta && meta.source ? meta.source : "");
  if (radioMinimized) radioSyncHome();
  radioSyncInfo();
  radioSyncArtistPhoto(track);
  radioRenderQueue();
}

// One Up next row: cover (https only, so the URL is safe in an attribute), title and artist
function radioQueueRowHtml(idx, m, esc) {
  esc = esc || (s => s);
  const art = /^https:\/\/[^"'<>\s]+$/.test(m.art || "")
    ? '<img class="radio-row-art" src="' + m.art + '" alt="" loading="lazy">'
    : '<div class="radio-row-art"></div>';
  const chip = m.source ? '<span class="radio-chip"><i class="ph-fill ph-sparkle" aria-hidden="true"></i><span>' + esc(m.source) + '</span></span>' : '';
  return '<div class="radio-row radio-row-play" onclick="radioPlayFrom(' + idx + ')">' + art
    + '<div class="radio-row-text"><div class="radio-row-title">' + esc(m.name) + '</div><div class="radio-row-artist">' + esc(m.artist) + '</div></div>' + chip + '</div>';
}

// Up next: the matched tracks after the current one, plus a Tuning row while a top-up runs
function radioRenderQueue() {
  const box = $("radioUpNext");
  if (!box) return;
  if (box.style && box.style.setProperty) box.style.setProperty("--upnext-rows", RADIO_UPNEXT_ROWS);  // wide layout: every row is 1/N of the panel
  let html = "", shown = 0;
  for (let i = Math.max(nowPlayingIndex + 1, 0); i < allTrackCount && shown < RADIO_UPNEXT_ROWS; i++) {
    const m = trackMeta[i];
    if (!m) continue;
    html += radioQueueRowHtml(i, m, escHtml);
    shown++;
  }
  if (radioRefilling && shown < RADIO_UPNEXT_ROWS) {  // the Tuning row only takes a free slot
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
  else radioPendingReissue = false;  // the new context already holds every queued track
}

// ===== node test exports (no-op in browsers) =====
if (typeof module !== "undefined" && module.exports) {
  module.exports = { radioPickPage, radioTrackKey, radioScrobbleFromTracks, radioParseBio, radioPlaysText, radioStatsHtml, radioArtistFromInfo, radioTrackPlaysFromInfo, radioEraLabel, radioRateLimitText, radioRemaining, radioUrisFrom, radioShouldRefill, radioSeamDue, radioCoverUrl, radioTransportRequest, radioQueueRowHtml, radioArtistPhotoFromSpotify, radioArtistId, discoverParseStation, discoverParseSimilarArtists, discoverParseTopTracks, discoverInterleave, discoverShuffle, discoverVerdict, discoverStatsHtml };
}
