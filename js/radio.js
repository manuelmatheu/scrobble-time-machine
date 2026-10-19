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

// ===== Library options: one year, and moments =====
// Unix-second bounds of a calendar year in local time; null for 0 (every year)
function radioYearRange(year) {
  if (!year) return null;
  return { from: Math.floor(new Date(year, 0, 1).getTime() / 1000), to: Math.floor(new Date(year + 1, 0, 1).getTime() / 1000) - 1 };
}

// A moment: the run of scrobbles around one point of a Last.fm page with no silence longer than gapS, oldest first,
// at most max tracks. list is the page (newest first), at the index of the random point in it. null when nothing is usable.
function radioMomentFromTracks(list, at, gapS, max) {
  const arr = Array.isArray(list) ? list : (list ? [list] : []);
  const items = [];
  arr.forEach((t, i) => {
    if (!t || (t["@attr"] && t["@attr"].nowplaying) || !t.name || !t.date || !t.date.uts) return;
    const artist = (t.artist && (t.artist["#text"] || t.artist.name)) || "";
    const uts = parseInt(t.date.uts, 10);
    if (artist && uts) items.push({ i, artist, track: t.name, album: (t.album && t.album["#text"]) || "", uts });
  });
  if (!items.length) return null;
  items.sort((a, b) => a.uts - b.uts || b.i - a.i);
  let p = 0, best = Infinity;
  items.forEach((x, k) => { const d = Math.abs(x.i - at); if (d < best) { best = d; p = k; } });
  let s = p, e = p;
  while (s > 0 && items[s].uts - items[s - 1].uts <= gapS) s--;
  while (e < items.length - 1 && items[e + 1].uts - items[e].uts <= gapS) e++;
  if (e - s + 1 > max) { s = Math.max(s, Math.min(p, e - max + 1)); e = s + max - 1; }  // too long: start at the point
  const run = items.slice(s, e + 1).map(x => ({ artist: x.artist, track: x.track, album: x.album, uts: x.uts }));
  return { tracks: run, start: run[0].uts, end: run[run.length - 1].uts };
}

// "Tuesday, March 11, 2014 · evening" (the moment panel) and "Mar 11, 2014" (the chips)
function radioMomentLabel(uts) {
  const d = new Date(uts * 1000), h = d.getHours();
  const part = h < 5 ? "night" : h < 12 ? "morning" : h < 18 ? "afternoon" : h < 23 ? "evening" : "night";
  return d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) + " · " + part;
}
function radioMomentChip(uts) {
  return new Date(uts * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
function radioClock(uts) {
  return new Date(uts * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}
// The moment panel's line: how many songs, and when
function radioMomentMeta(m) {
  if (!m) return "";
  if (m.size === 1) return "1 song you played at " + radioClock(m.start) + ".";
  return m.size + " songs you played between " + radioClock(m.start) + " and " + radioClock(m.end) + ", in that order.";
}

// Home card headline for the picked station and Library options
function radioHomeHeadline(station, how, year) {
  if (station !== "library") return RADIO_STATIONS[station].headline;
  if (how === "moments") return year ? "Back in " + year + ", as you played it." : "Your past, one moment at a time.";
  return year ? "Your " + year + ", shuffled." : RADIO_STATIONS.library.headline;
}
// Radio view title: the station, plus the Library options in use
function radioSessionTitle(station, how, year) {
  let t = RADIO_STATIONS[station].title;
  if (station === "library") { if (how === "moments") t += " · Moments"; if (year) t += " · " + year; }
  return t;
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
  discover: { eyebrow: "Discover radio", headline: "New music, picked from your taste.", title: "Discover radio", button: "Start Discover radio" },
  mix: { eyebrow: "Mix radio", headline: "Your past, with new music woven in.", title: "Mix radio", button: "Start Mix radio" }
};

// Mix: which source the next track comes from. A pattern per balance, repeated.
const MIX_PATTERNS = {
  "mostly-past": ["past", "past", "past", "new"],
  "balanced": ["past", "new"],
  "mostly-new": ["new", "new", "new", "past"]
};
function mixKindAt(balance, cursor) {
  const p = MIX_PATTERNS[balance] || MIX_PATTERNS.balanced;
  return p[((cursor % p.length) + p.length) % p.length];
}

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
  const settled = await Promise.allSettled(pages.map(p => getLastFmScrobbleAt(user, p, radioRange).then(list => radioScrobbleFromTracks(list, p))));
  const picks = []; let failed = 0;
  for (const s of settled) {
    if (s.status === "rejected") failed++;
    else if (s.value) picks.push(s.value);
  }
  return { picks, failed, total: settled.length };
}

// Library in Moments: one random point of the history (or of the year), and the scrobbles around it in the order you
// played them. Every pick carries its moment, so the view can say when it was and save it as a playlist.
async function momentCollectBatch(user) {
  const pos = radioPickPage(radioTotal);
  const page = Math.ceil(pos / MOMENT_FETCH), at = (pos - 1) % MOMENT_FETCH;
  let rt;
  try { rt = await getLastFmScrobbles(user, page, MOMENT_FETCH, radioRange); } catch { return { picks: [], failed: 1, total: 1 }; }
  const m = radioMomentFromTracks(rt && rt.track, at, MOMENT_GAP_S, MOMENT_MAX);
  if (!m) return { picks: [], failed: 0, total: 1 };
  const moment = { id: ++radioMomentSeq, label: radioMomentLabel(m.start), chip: radioMomentChip(m.start), start: m.start, end: m.end, size: m.tracks.length };
  const year = new Date(m.start * 1000).getFullYear();
  return { picks: m.tracks.map(t => ({ artist: t.artist, track: t.track, album: t.album, page: null, year, moment })), failed: 0, total: 1 };
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

// ===== Mix station =====
// Both sources are collected in parallel (picks wait in radioBuf between rounds) and handed out in the pattern of the
// chosen balance, so the queue alternates between your past and new music. If one source runs dry the other fills in.
async function mixCollectBatch(user, sid) {
  const wanted = { past: radioBuf.past.length < 2, new: radioBuf.new.length < 2 };
  const [past, fresh] = await Promise.all([wanted.past ? radioCollectBatch(user) : null, wanted.new ? discoverCollectBatch(user, sid) : null]);
  if (sid !== radioSession) return { picks: [], failed: 0, total: 1 };
  if (past) radioBuf.past.push(...past.picks.map(p => Object.assign(p, { origin: "past" })));
  if (fresh) radioBuf.new.push(...fresh.picks);
  const picks = [];
  // Hand picks out in pattern order until the source whose turn it is runs empty (the next round fetches more of it)...
  while (picks.length < MIX_BATCH) {
    const kind = mixKindAt(radioActiveBalance, radioMixCursor);
    if (!radioBuf[kind].length) break;
    picks.push(radioBuf[kind].shift()); radioMixCursor++;
  }
  // ...unless that source has nothing at all (down, or dry): then the other one keeps the radio going
  if (!picks.length) {
    const other = mixKindAt(radioActiveBalance, radioMixCursor) === "past" ? "new" : "past";
    while (radioBuf[other].length && picks.length < MIX_BATCH) picks.push(radioBuf[other].shift());
  }
  // A failure only counts when nothing could be fetched from any source we asked
  const asked = [past, fresh].filter(Boolean);
  const failed = !picks.length && asked.length && asked.every(b => b.failed === b.total) ? 1 : 0;
  return { picks, failed, total: 1 };
}

// Pick random scrobbles, match them on Spotify, append matches to the session. Returns
// the number of tracks added. Bails out quietly if the session changes mid-flight.
async function radioFill(want) {
  const sid = radioSession, user = radioUser, station = radioActiveStation;
  const fresh = station !== "library";  // Discover and Mix: more than one round of vetting per fill
  const token = await getSpotifyToken();
  if (!token || sid !== radioSession) return 0;
  if (spotifyBlockedFor() > 0) { lastSearchError = "Rate limited (429)"; showStatus(spotifyLimitMessage(), "error"); return 0; }
  lastSearchError = null;
  let added = 0, attempts = 0;
  while (added < want && attempts < (fresh ? DISCOVER_MAX_ROUNDS : RADIO_MAX_ATTEMPTS)) {
    // picks a previous fill collected but did not need come first (they were already vetted: Discover and Mix pay for that)
    const batch = radioCarry.length ? { picks: radioCarry.splice(0), failed: 0, total: 1 }
      : station === "mix" ? await mixCollectBatch(user, sid) : station === "discover" ? await discoverCollectBatch(user, sid)
      : radioActiveHow === "moments" ? await momentCollectBatch(user) : await radioCollectBatch(user);
    if (sid !== radioSession) return added;
    attempts += fresh ? 1 : batch.total;
    if (batch.failed === batch.total) {
      radioFailures++;
      await radioSleep(Math.min(1000 * radioFailures, 8000));
      if (sid !== radioSession) return added;
      continue;
    }
    radioFailures = 0;
    for (let pi = 0; pi < batch.picks.length; pi++) {
      const p = batch.picks[pi];
      if (added >= want) { radioCarry.push(...batch.picks.slice(pi)); break; }
      const key = radioTrackKey(p.artist, p.track);
      if (radioSeen.has(key)) continue;
      radioSeen.add(key);
      if (spotifyBlockedFor() > 0) { showStatus(spotifyLimitMessage(), "error"); return added; }
      const hit = await spotifySearch(token, p.artist, p.track);
      if (sid !== radioSession) return added;
      if (!hit && spotifyBlockedFor() > 0) { showStatus(spotifyLimitMessage(), "error"); return added; }
      if (hit && p.source && await discoverIsSaved(hit.uri)) continue;  // saved songs are not new to you
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
        if (p.source) Object.assign(trackMeta[idx], { source: p.source, kind: p.kind, artistPlays: p.artistPlays });
        else trackMeta[idx].fromPast = true;  // from your history (Library, and the past half of a Mix): shown as "From YEAR"
        if (p.moment) trackMeta[idx].moment = p.moment;  // Library in Moments: shown as the moment's date
        added++;
        radioRenderQueue();  // Up next fills as the tracks arrive, not when the whole fill is done
        // Next moment was pressed before the next moment was queued: its first song is here, play it
        if (radioJumpFrom !== null && p.moment && p.moment.id !== radioJumpFrom) { radioJumpFrom = null; radioPlayFrom(idx); }
      }
      if (added >= want) { radioCarry.push(...batch.picks.slice(pi + 1)); return added; }  // done: no pause before leaving
      await radioSleep(SEARCH_DELAY);
      if (sid !== radioSession) return added;
    }
  }
  return added;
}

// A radio is starting: the home card's controls wait, and the previous session is gone
function beginSession() {
  radioStop();
  currentPhase = "working"; updateRadioButton();
  $("cancelBtn").style.display = ""; $("usernameInput").disabled = true;
  searchCache = {}; sessionQueue = new Set(); sessionPaused = false; stopPolling(); hideStatus();
}
function endSessionUI() {
  $("cancelBtn").style.display = "none"; $("usernameInput").disabled = false; updateRadioButton();
}

async function startRadio() {
  const user = $("usernameInput").value.trim();
  if (!user || !spotifyToken) return;
  beginSession();
  radioActiveStation = radioStation; radioActiveBalance = radioBalance;
  const library = radioActiveStation === "library";
  radioActiveHow = library ? radioHow : "songs"; radioActiveYear = library ? radioYear : 0;
  radioRange = radioYearRange(radioActiveYear); radioMomentSeq = 0;
  const discover = radioActiveStation === "discover", fresh = radioActiveStation !== "library";
  radioBuf = { past: [], new: [] }; radioMixCursor = 0;
  discoverPool = []; discoverSeeds = null; discoverSeedRound = 0; discoverSimilarCache = {}; discoverTopCache = {}; discoverUsedArtists = new Set();
  discoverNeedsReconnect = false; discoverWarnedEmpty = false;
  matchedUris = {}; allTrackCount = 0; uriToIndices = {}; totalMatched = 0;
  trackMeta = {}; radioSeen = new Set(); radioFailures = 0; radioRefilling = false; radioExhausted = false;
  radioCurrentUri = null; radioLastPos = 0; radioPaused = false; radioPendingReissue = false; radioUser = user; radioActive = true;
  radioCarry = []; radioStartedAt = 0;
  const sid = ++radioSession;
  try {
    // Get the device ready (transfer, shuffle and repeat off) while the first song is being picked
    const token0 = await getSpotifyToken();
    if (token0) spotifyPrewarm(token0);
    let totalScrobbles = 0;
    if (!discover) {
      // the home card already counted the scrobbles: one request less before the first pick
      if (radioRange) totalScrobbles = await getLastFmCountIn(user, radioRange);  // one year: its own count, so positions stay inside it
      else if (homeTotalCache.user === user && homeTotalCache.total && Date.now() - homeTotalCache.at < HOME_TOTAL_FRESH_MS) totalScrobbles = homeTotalCache.total;
      else ({ totalScrobbles } = await getLastFmTotalPages(user));
      if (sid !== radioSession) return;
      if (!totalScrobbles) throw new Error(radioRange ? "No scrobbles in " + radioActiveYear + ". Pick another year." : "No scrobbles found");
      radioTotal = totalScrobbles;
    }
    showRadioView();
    // Playback starts with the first match; the rest of the queue is fetched while it plays (see the top-up below)
    const added = await radioFill(RADIO_START_TRACKS);
    if (sid !== radioSession) return;
    if (!added) throw new Error(spotifyBlockedFor() > 0 ? spotifyLimitMessage() : "No tracks matched" + (lastSearchError ? " (" + lastSearchError + ")" : ""));
    radioRenderQueue();
    const token = await getSpotifyToken();
    if (!token) throw new Error("Spotify expired. Reconnect.");
    const ok = await spotifyPlay(token, radioUrisFrom(matchedUris, allTrackCount, null));
    if (sid !== radioSession) return;
    if (!ok) {
      const devs = await getSpotifyDevices(token);
      throw new Error(devs.length === 0 ? "No active Spotify device. Open Spotify and try again." : "Playback failed. Make sure Spotify is active.");
    }
    currentPhase = "done";
    showStatus("", "success");
    if (fresh && discoverNeedsReconnect) showStatus("Reconnect Spotify to get picks based on what you play lately.", "warn");
    radioStartedAt = Date.now();
    startPolling();
    checkLikedTracks();
    endSessionUI();
    continueRadio();  // fills the queue behind the first song; the new tracks join at the end of the last one we sent (the seam)
  } catch (err) {
    if (sid !== radioSession) return;
    radioStop(); currentPhase = "error"; showStatus(err.message, "error"); endSessionUI();
  }
}

// Top up the queue, then re-issue playback from the current track so the new tracks join
// the Spotify context (avoids the persistent user queue)
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
      if (healthy && radioActiveStation !== "library") {
        // New music keeps arriving (the station changes on every call): an empty round is retried on the next track change
        if (!discoverWarnedEmpty) { discoverWarnedEmpty = true; showStatus("No new music found right now. Playing what is queued.", "warn"); }
      } else if (healthy) { radioExhausted = true; showStatus("No more new tracks " + (radioActiveYear ? "from " + radioActiveYear : "in your library") + ". Playing what is queued.", "warn"); }
      return;
    }
    if (radioSkipWanted) { radioSkipWanted = false; await radioSeamReissue(); return; }  // Next was pressed while this top-up ran
    if (radioPaused || radioCanSeam()) { radioPendingReissue = true; return; }  // paused: do not resume it; SDK or a polled device: swap at the seam (radioMaybeSeam / radioRemoteTick)
    await radioReissue();
  } finally {
    radioSkipWanted = false;
    if (sid === radioSession) { radioRefilling = false; radioRenderQueue(); }
  }
}

// Re-issue playback from the current track so the queued tracks include the new ones
async function radioReissue() {
  const sid = radioSession;
  const currentUri = sdkPlaying() ? _sdkCurrentUri : radioCurrentUri;
  if (!currentUri) return;
  const uris = radioUrisFrom(matchedUris, allTrackCount, currentUri);
  if (!uris.length) return;
  const token = await getSpotifyToken();
  if (!token || sid !== radioSession) return;
  await spotifyPlay(token, uris, sdkPlaying() ? _sdkPositionMs : radioLastPos);
  checkLikedTracks();
}

// Track the play/pause state; a top-up that finished while paused re-issues on resume
function radioSetPaused(paused) {
  radioPaused = paused;
  if (!paused && radioPendingReissue && !radioCanSeam()) { radioPendingReissue = false; radioReissue(); }
}

// SDK only. A re-issue restarts the stream (device transfer + play), which stutters if it lands a few
// seconds into a song. So new tracks wait until the last track Spotify has queued is about to end, then
// replace the context starting at the first new track.
function radioSeamDue(pending, atLastTrack, positionMs, durationMs, seamMs) {
  return !!pending && !!atLastTrack && durationMs > 0 && durationMs - positionMs <= seamMs;
}

// Tracks we hold that Spotify has not been sent: everything after the last URI of our latest play. Derived from the
// data on purpose: a flag that something is pending can get lost (or never be set), the tracks themselves cannot.
function radioUnsentUris() {
  if (!radioContextLastUri) return [];
  return radioUrisFrom(matchedUris, allTrackCount, radioContextLastUri).slice(1);
}
// Polling (the music plays on another Connect device): is there a recent reading to time a swap from?
function radioCanSeam() {
  return sdkPlaying() || (!!remoteNow && Date.now() - remoteNow.at < REMOTE_FRESH_MS) || (radioStartedAt > 0 && Date.now() - radioStartedAt < REMOTE_FRESH_MS);
}
// ms left in the track of a /me/player reading, extrapolated from when it was taken (null: unknown)
function radioRemoteLeft(r, now) {
  if (!r || !(r.dur > 0)) return null;
  return r.dur - (r.pos + (r.playing ? now - r.at : 0));
}
// The 250ms tick for another device (the SDK timer does not exist there): when the last track we sent is about to end and
// we hold tracks Spotify was not sent, swap them in. Near the end it re-reads /me/player every second, since the position
// is only as exact as the last reading.
function radioRemoteTick() {
  if (!radioActive || sdkPlaying() || radioSeaming || radioPaused || !remoteNow || !remoteNow.playing) return;
  if (!radioContextLastUri || remoteNow.uri !== radioContextLastUri || !radioUnsentUris().length) return;
  const now = Date.now(), left = radioRemoteLeft(remoteNow, now);
  if (left === null || now - remoteSeamAt < 3000) return;
  if (radioSeamDue(true, true, remoteNow.dur - left, remoteNow.dur, RADIO_REMOTE_SEAM_MS)) { remoteSeamAt = now; radioSeamReissue(); return; }
  if (left <= 12000 && now - remoteFastAt >= 1000 && typeof pollNowPlaying === "function") { remoteFastAt = now; pollNowPlaying(); }
}
// Spotify ran past the last track we sent (we missed the swap) and moved on to something else: put the tracks back now
function radioRecoverRunOff(prevUri) {
  if (!radioActive || radioSeaming || !radioContextLastUri || prevUri !== radioContextLastUri || !radioUnsentUris().length) return false;
  radioSeamReissue();
  return true;
}
function radioMaybeSeam() {
  if (!radioActive || !sdkPlaying() || radioSeaming) return;
  const atLast = !!radioContextLastUri && _sdkCurrentUri === radioContextLastUri;
  if (!radioSeamDue(radioPendingReissue || (atLast && radioUnsentUris().length > 0), atLast, _sdkPositionMs, _sdkDurationMs, RADIO_SEAM_MS)) return;
  radioSeamReissue();
}

// Next on the last track Spotify holds would run off the end of its context and stop the music (the first song of a session plays
// alone until the rest is swapped in). Swap the tracks it does not have in right now instead; true when the skip was handled here.
let radioSkipWanted = false;  // Next was pressed on the last sent track while the queue was still filling: swap as soon as it has tracks
function radioSkipHandled() {
  if (!radioActive || !radioContextLastUri) return false;
  const cur = sdkPlaying() ? _sdkCurrentUri : remoteNow && remoteNow.uri;
  if (cur !== radioContextLastUri) return false;
  if (radioSeaming) return true;
  if (radioUnsentUris().length) { radioSeamReissue(); return true; }
  if (radioRefilling) { radioSkipWanted = true; return true; }
  return false;
}

async function radioSeamReissue() {
  radioSeaming = true;  // first, so the next 250ms tick does not fire it again
  radioPendingReissue = false;
  try {
    const sid = radioSession;
    const ending = sdkPlaying() ? _sdkCurrentUri : radioContextLastUri;  // another device: the swap only fires at the last track we sent
    const uris = radioUrisFrom(matchedUris, allTrackCount, ending).slice(1);  // drop the track that is ending
    if (!uris.length) return;
    const token = await getSpotifyToken();
    if (!token || sid !== radioSession) return;
    let ok = false;
    try { ok = await spotifyPlay(token, uris, 0, { quick: true }); } catch {}
    if (!ok && sid === radioSession) ok = await spotifyPlay(token, uris);  // full device logic as a fallback
    if (ok) checkLikedTracks();
  } finally { radioSeaming = false; }
}

// Called from the SDK state handler and the polling fallback on every track change
// Rows in the Up next list: more on wide desktop. The top-up threshold follows it (a full list must stay queued)
function radioUpNextRows() {
  const wide = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(min-width:1100px)").matches;
  return wide ? RADIO_UPNEXT_ROWS_WIDE : RADIO_UPNEXT_ROWS;
}
function radioMaybeRefill(currentUri, positionMs) {
  radioCurrentUri = currentUri; radioLastPos = positionMs || 0;
  const remaining = radioRemaining(matchedUris, allTrackCount, currentUri);
  if (radioShouldRefill({ active: radioActive, refilling: radioRefilling, exhausted: radioExhausted, remaining }, radioUpNextRows() - 1)) continueRadio();
}

function radioStop() {
  radioActive = false; radioSession++; radioRefilling = false; radioJumpFrom = null;
  radioCurrentUri = null; radioLastPos = 0; radioPaused = false; radioPendingReissue = false; radioContextLastUri = null; remoteNow = null; radioCarry = []; radioStartedAt = 0;
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
    homeTotalCache = { user, total: totalScrobbles, at: Date.now() };
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
// Speaker glyph for a 0-100 volume: off, minimum, normal or loud
const RADIO_VOLUME_ICONS = ["ph-speaker-x", "ph-speaker-none", "ph-speaker-low", "ph-speaker-high"];
function radioVolumeIcon(v) { return RADIO_VOLUME_ICONS[v <= 0 ? 0 : v <= 33 ? 1 : v <= 66 ? 2 : 3]; }
function radioSetVolumeIcon(v) {
  const ic = $("radioVolumeIcon");
  if (!ic || !ic.classList || !ic.classList.contains) return;
  const next = radioVolumeIcon(v);
  if (ic.classList.contains(next)) return;
  RADIO_VOLUME_ICONS.forEach(c => ic.classList.remove(c));
  ic.classList.add(next);
}
function radioSyncVolume() {
  const wrap = $("radioVolumeWrap");
  if (!wrap) return;
  wrap.classList.toggle("sdk", sdkPlaying());
  if (!sdkPlaying() || radioVolumeSynced || !window._stmPlayer || !window._stmPlayer.getVolume) return;
  radioVolumeSynced = true;
  Promise.resolve(window._stmPlayer.getVolume()).then(v => {
    const el = $("radioVolume");
    if (el && typeof v === "number") { el.value = Math.round(v * 100); el.style.setProperty("--vol", el.value + "%"); radioSetVolumeIcon(Math.round(v * 100)); }
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
  if (box && box.classList && box.classList.toggle) box.classList.toggle("paused", !!radioNowPaused);
  if (track) track.textContent = radioNowLabel || "Tuning...";
}

function radioResetHero() {
  radioHeroLive = false; radioNowLabel = ""; radioNowPaused = false;
  $("radioTrack").textContent = "Tuning...";
  $("radioArtist").textContent = "";
  $("radioArt").removeAttribute("src"); radioArtUrl = "";
  $("radioFill").style.width = "0"; $("radioElapsed").textContent = "0:00"; $("radioDuration").textContent = "0:00";
  $("radioPlay").innerHTML = '<i class="ph-fill ph-play"></i>';
  radioInfoIdx = -1; radioHideInfo();
  radioPhotoId = ""; radioShowArtistPhoto(null);
  radioShowSource("");
  radioMomentShown = null;
  if ($("radioMoment")) $("radioMoment").style.display = "none";
}

// The "why this track" chip next to NOW PLAYING (Discover only)
function radioShowSource(text, past) {
  const el = $("radioSource");
  if (!el) return;
  el.style.display = text ? "" : "none";
  if (el.classList) el.classList[past ? "add" : "remove"]("past");
  const ic = $("radioSourceIcon");
  if (ic) ic.className = past ? "ph ph-clock" : "ph-fill ph-sparkle";
  const t = $("radioSourceText");
  if (t) t.textContent = text || "";
}

// Home card: how much of a Mix is new
function radioSetBalance(name) {
  if (!MIX_PATTERNS[name]) name = "balanced";
  radioBalance = name;
  try { localStorage.setItem("stm_mix_balance", name); } catch {}
  document.querySelectorAll(".seg-opt[data-balance]").forEach(b => { const on = b.dataset.balance === name; b.classList.toggle("active", on); b.setAttribute("aria-pressed", on ? "true" : "false"); });
}

// Home card: the station picked here is the one Start radio plays
function radioSetStation(name) {
  if (!RADIO_STATIONS[name]) name = "library";
  radioStation = name;
  try { localStorage.setItem("stm_station", name); } catch {}
  document.querySelectorAll(".station-opt").forEach(b => { const on = b.dataset.station === name; b.classList.toggle("active", on); b.setAttribute("aria-pressed", on ? "true" : "false"); });
  const s = RADIO_STATIONS[name];
  if ($("mixBalance")) $("mixBalance").style.display = name === "mix" ? "" : "none";
  if ($("libraryOptions")) $("libraryOptions").style.display = name === "library" ? "" : "none";
  if ($("radioEyebrow")) $("radioEyebrow").textContent = s.eyebrow;
  radioSyncHeadline();
  radioSyncHome();
}
function radioSyncHeadline() {
  if ($("homeHeadline")) $("homeHeadline").textContent = radioHomeHeadline(radioStation, radioHow, radioYear);
}

// Home card, Library: how it plays (Songs or Moments) and when (every year or one)
const LIBRARY_HOW_HELP = {
  songs: "One song at a time, each from a different day of your history.",
  moments: "A stretch of what you played back then, in the order you played it. When it ends, the radio jumps to another moment."
};
function radioSetHow(name) {
  if (!LIBRARY_HOW_HELP[name]) name = "songs";
  radioHow = name;
  try { localStorage.setItem("stm_library_how", name); } catch {}
  document.querySelectorAll(".seg-opt[data-how]").forEach(b => { const on = b.dataset.how === name; b.classList.toggle("active", on); b.setAttribute("aria-pressed", on ? "true" : "false"); });
  if ($("libraryHowHelp")) $("libraryHowHelp").textContent = LIBRARY_HOW_HELP[name];
  radioSyncHeadline();
}
// year: 0 for every year. "one" picks the year in the list (the last one used, else the newest)
function radioSetYear(year) {
  if (year === "one") year = parseInt(($("libraryYear") && $("libraryYear").value) || "", 10) || new Date().getFullYear();
  year = parseInt(year, 10) || 0;
  radioYear = year;
  try { localStorage.setItem("stm_library_year", String(year)); } catch {}
  document.querySelectorAll(".seg-opt[data-when]").forEach(b => { const on = (b.dataset.when === "one") === !!year; b.classList.toggle("active", on); b.setAttribute("aria-pressed", on ? "true" : "false"); });
  const sel = $("libraryYear");
  if (sel) {
    sel.style.display = year ? "" : "none";
    if (year) { radioEnsureYearOption(sel, year); sel.value = String(year); }
  }
  if ($("libraryWhenHelp")) $("libraryWhenHelp").textContent = year ? "Only scrobbles from " + year + "." : "Anywhere in your history, from your first scrobble to today.";
  radioSyncHeadline();
}
// The years from the first scrobble to today, newest first (a year saved earlier stays in the list)
function radioLibraryYears(first, now, keep) {
  const out = [];
  for (let y = now; y >= Math.min(first || now, keep || now); y--) out.push(y);
  return out;
}
function radioEnsureYearOption(sel, year) {
  if ([].some.call(sel.options || [], o => o.value === String(year))) return;
  const o = document.createElement("option"); o.value = String(year); o.textContent = String(year);
  sel.appendChild(o);
}
function radioFillYears() {
  const sel = $("libraryYear");
  if (!sel) return;
  const years = radioLibraryYears(libraryYears.first, new Date().getFullYear(), radioYear);
  sel.innerHTML = years.map(y => '<option value="' + y + '">' + y + '</option>').join("");
  if (radioYear) sel.value = String(radioYear);
}
// The When list starts at the year of the user's first scrobble (one lookup per username)
async function refreshLibraryYears() {
  const user = $("usernameInput").value.trim();
  if (!user || libraryYears.user === user.toLowerCase()) return;
  libraryYears = { user: user.toLowerCase(), first: 0 };
  const first = await fetchEarliestYear(user);
  if (libraryYears.user !== user.toLowerCase()) return;
  libraryYears.first = first || 0;
  radioFillYears();
}

function showRadioView() {
  const wasHidden = $("radioView").style.display === "none";
  radioMinimized = false; radioSyncHome();
  $("homeView").style.display = "none";
  $("radioView").style.display = "";
  $("radioTitle").textContent = radioSessionTitle(radioActiveStation, radioActiveHow, radioActiveYear);
  radioResetHero();
  radioRenderQueue();
  if (wasHidden) window.scrollTo(0, 0);  // the home view may have been scrolled; open the new view at its top
}

function hideRadioView() {
  radioMinimized = false; radioSyncHome();
  $("radioView").style.display = "none";
  $("homeView").style.display = "";
  $("radioUpNext").innerHTML = "";
  radioQueueShown = []; radioHeroKey = "";
  restartClass($("homeView"), "view-in");
  radioResetHero();
}

// Home button: show the home view again but keep the session and the music going; the home card leads back
function radioMinimize() {
  if (!radioActive || $("radioView").style.display === "none") return;
  radioMinimized = true; radioSyncHome();
  $("radioView").style.display = "none";
  $("homeView").style.display = "";
  restartClass($("homeView"), "view-in");
}

// Back to radio: return to the session that is still running (the hero and queue kept updating while hidden)
function radioReopen() {
  if (!radioMinimized) return;
  radioMinimized = false; radioSyncHome();
  $("homeView").style.display = "none";
  $("radioView").style.display = "";
  window.scrollTo(0, 0);
}

// Last.fm names for the track at idx (the scrobble's own names, which getInfo knows)
function radioInfoSource(idx) {
  const m = trackMeta[idx];
  // trackMeta can be left over from a radio session that failed to start: only trust it while the radio runs
  return radioActive && m && m.lfmArtist ? { artist: m.lfmArtist, track: m.lfmTrack } : null;
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
  const user = radioUser;
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
  const stats = (radioActive && meta && meta.source && discoverStatsHtml(info.artist, info.plays, meta.kind, meta.source, escHtml))
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

// Motion helpers: CSS does the animating, these only restart a class (a no-op where the DOM is stubbed)
function restartClass(el, cls) {
  if (!el || !el.classList) return;
  el.classList.remove(cls);
  void el.offsetWidth;  // reflow, so the animation plays again
  el.classList.add(cls);
}

// Cover: a new URL starts the loading pulse, which ends when the image arrives (or fails)
let radioArtUrl = "";
function radioSetArt(url) {
  const el = $("radioArt");
  if (url === radioArtUrl) return;
  radioArtUrl = url;
  if (el.classList && url) {
    el.classList.add("loading");
    el.onload = el.onerror = () => { if (radioArtUrl === url) el.classList.remove("loading"); };
  }
  if (url) el.src = url; else el.removeAttribute("src");
}

let radioHeroKey = "";  // the track the hero last faded in for
function radioHeroSwap(key) {
  if (key === radioHeroKey) return;
  const first = !radioHeroKey;
  radioHeroKey = key;
  if (!first) restartClass(document.querySelector && document.querySelector(".radio-now"), "hero-swap");
}

// Hero: the playing track (SDK track object or Spotify currently-playing item)
function radioRenderNow(track, paused) {
  radioSetPaused(paused);
  radioHeroLive = true;
  const meta = trackMeta[nowPlayingIndex];
  const img = track.album && track.album.images && track.album.images[0];
  radioHeroSwap(track.uri || track.id || track.name || "");
  radioSetArt(img ? img.url : (meta && meta.art) || "");
  $("radioTrack").textContent = track.name || (meta && meta.name) || "";
  const artists = (track.artists || []).map(a => a.name).join(", ");
  const album = track.album && track.album.name;
  $("radioArtist").textContent = artists + (album ? " · " + album : "");
  $("radioPlay").innerHTML = '<i class="ph-fill ph-' + (paused ? "play" : "pause") + '"></i>';
  radioNowLabel = (track.name || (meta && meta.name) || "") + (artists ? " \u00b7 " + artists : "");
  radioNowPaused = !!paused;
  radioSyncVolume();
  const fromPast = radioActive && meta && meta.fromPast && meta.year;
  radioShowSource(radioActive && meta ? radioChipText(meta) : "", !!fromPast);
  if (radioMinimized) radioSyncHome();
  radioSyncMoment();
  radioSyncInfo();
  radioSyncArtistPhoto(track);
  radioRenderQueue();
}

// Why a track is playing: the Discover reason, the moment's date (Library in Moments) or the year it is from
function radioChipText(m) {
  if (!m) return "";
  if (m.source) return m.source;
  if (m.moment) return m.moment.chip;
  return m.fromPast && m.year ? "From " + m.year : "";
}

// One Up next row: cover (https only, so the URL is safe in an attribute), title and artist.
// newMoment marks the first song of a moment that is not the one playing (a stronger divider above it).
function radioQueueRowHtml(idx, m, esc, newMoment) {
  esc = esc || (s => s);
  const art = /^https:\/\/[^"'<>\s]+$/.test(m.art || "")
    ? '<img class="radio-row-art" src="' + m.art + '" alt="" loading="lazy">'
    : '<div class="radio-row-art"></div>';
  const text = radioChipText(m);
  const chip = !text ? '' : m.source ? '<span class="radio-chip"><i class="ph-fill ph-sparkle" aria-hidden="true"></i><span>' + esc(text) + '</span></span>'
    : '<span class="radio-chip past"><i class="ph ph-clock" aria-hidden="true"></i><span>' + esc(text) + '</span></span>';
  return '<div class="radio-row radio-row-play' + (newMoment ? ' moment-start' : '') + '" onclick="radioPlayFrom(' + idx + ')">' + art
    + '<div class="radio-row-text"><div class="radio-row-title">' + esc(m.name) + '</div><div class="radio-row-artist">' + esc(m.artist) + '</div></div>' + chip + '</div>';
}

// Up next: the matched tracks after the current one, plus a Tuning row while a top-up runs
function radioRenderQueue() {
  const box = $("radioUpNext");
  if (!box) return;
  if (box.style && box.style.setProperty) box.style.setProperty("--upnext-rows", radioUpNextRows());  // wide layout: every row is 1/N of the panel
  const upRows = radioUpNextRows();
  let html = "", shown = 0;
  const idxs = [];
  const cur = trackMeta[nowPlayingIndex];
  let prevMoment = cur && cur.moment ? cur.moment.id : null;
  for (let i = Math.max(nowPlayingIndex + 1, 0); i < allTrackCount && shown < upRows; i++) {
    const m = trackMeta[i];
    if (!m) continue;
    const mid = m.moment ? m.moment.id : null;
    html += radioQueueRowHtml(i, m, escHtml, mid !== null && prevMoment !== null && mid !== prevMoment);
    if (mid !== null) prevMoment = mid;
    idxs.push(i);
    shown++;
  }
  if (radioRefilling && shown < upRows) {  // the Tuning row only takes a free slot
    html += '<div class="radio-row radio-row-tuning"><div class="radio-row-art skeleton"></div><div class="radio-row-text"><div class="radio-row-title">Tuning...</div></div></div>';
  }
  box.innerHTML = html;
  // rows are rebuilt on every player event: only a track that was not listed before slides in, and never the first fill
  const prev = radioQueueShown;
  radioQueueShown = idxs;
  if (prev.length && box.children && box.children.length) {
    idxs.forEach((idx, n) => { if (!prev.includes(idx) && box.children[n] && box.children[n].classList) box.children[n].classList.add("radio-row-in"); });
  }
}
let radioQueueShown = [];  // track indices listed in Up next at the last render

// Play the radio from a queued track onward (the Up next rows call this)
async function radioPlayFrom(idx) {
  if (!radioActive || !matchedUris[idx]) return;
  const token = await getSpotifyToken();
  if (!token) return;
  const ok = await spotifyPlay(token, radioUrisFrom(matchedUris, allTrackCount, matchedUris[idx]));
  if (!ok) showStatus("Playback failed. Is Spotify active?", "error");
  else radioPendingReissue = false;  // the new context already holds every queued track
}

// ===== This moment (Library in Moments) =====
// The queued tracks of a moment, in order
function radioMomentIndices(id) {
  const out = [];
  for (let i = 0; i < allTrackCount; i++) if (matchedUris[i] && trackMeta[i] && trackMeta[i].moment && trackMeta[i].moment.id === id) out.push(i);
  return out;
}
// The first queued track after idx that belongs to another moment (-1: none queued yet)
function radioNextMomentIndex(idx) {
  const cur = trackMeta[idx], id = cur && cur.moment ? cur.moment.id : null;
  for (let i = idx + 1; i < allTrackCount; i++) {
    const m = trackMeta[i];
    if (matchedUris[i] && m && m.moment && m.moment.id !== id) return i;
  }
  return -1;
}

let radioMomentShown = null;  // id of the moment the panel shows
function radioSyncMoment() {
  const box = $("radioMoment");
  if (!box) return;
  const meta = radioActive ? trackMeta[nowPlayingIndex] : null;
  const m = meta && meta.moment;
  box.style.display = m ? "" : "none";
  if (!m) { radioMomentShown = null; return; }
  // Next moment works before the next moment is queued (it is fetched then); only a finished library or a pending jump disables it
  if ($("momentNextBtn")) $("momentNextBtn").disabled = radioJumpFrom !== null || (radioExhausted && radioNextMomentIndex(nowPlayingIndex) < 0);
  if (m.id === radioMomentShown) return;
  radioMomentShown = m.id;
  $("radioMomentLabel").textContent = m.label;
  $("radioMomentMeta").textContent = radioMomentMeta(m);
  radioResetSaveMoment();
}
function radioResetSaveMoment() {
  const btn = $("momentSaveBtn");
  if (!btn) return;
  btn.disabled = false; btn.className = "btn-save-playlist"; btn.onclick = saveMomentPlaylist;
  btn.innerHTML = '<i class="ph ph-plus" aria-hidden="true"></i> Save this moment';
}

// Next moment: play from the first song of the next queued moment
// When none is queued yet, the rest of this moment is dropped and the next one is fetched; it plays as soon as its first
// song is matched (radioFill)
function radioNextMoment() {
  const idx = radioNextMomentIndex(nowPlayingIndex);
  if (idx >= 0) { radioPlayFrom(idx); return; }
  const cur = trackMeta[nowPlayingIndex], id = cur && cur.moment ? cur.moment.id : null;
  if (!radioActive || id === null || radioExhausted) return;
  radioCarry = radioCarry.filter(p => !(p.moment && p.moment.id === id));
  radioJumpFrom = id;
  if ($("momentNextBtn")) $("momentNextBtn").disabled = true;
  if (!radioRefilling) continueRadio();
}

// Save the playing moment (its queued songs) as a Spotify playlist named after its date
async function saveMomentPlaylist() {
  const meta = trackMeta[nowPlayingIndex], m = meta && meta.moment;
  if (!m) return;
  const uris = radioMomentIndices(m.id).map(i => matchedUris[i]);
  await saveAsPlaylist($("momentSaveBtn"), uris, m.label, () => radioMomentShown === m.id);
}

// ===== node test exports (no-op in browsers) =====
if (typeof module !== "undefined" && module.exports) {
  module.exports = { radioVolumeIcon, radioPickPage, radioTrackKey, radioScrobbleFromTracks, radioParseBio, radioPlaysText, radioStatsHtml, radioArtistFromInfo, radioTrackPlaysFromInfo, radioYearRange, radioMomentFromTracks, radioMomentLabel, radioMomentChip, radioMomentMeta, radioHomeHeadline, radioSessionTitle, radioLibraryYears, radioChipText, radioRateLimitText, radioRemaining, radioUrisFrom, radioShouldRefill, radioSeamDue, radioCoverUrl, radioTransportRequest, radioQueueRowHtml, radioArtistPhotoFromSpotify, radioArtistId, discoverParseStation, discoverParseSimilarArtists, discoverParseTopTracks, discoverInterleave, discoverShuffle, discoverVerdict, discoverStatsHtml, mixKindAt, radioRemoteLeft };
}
