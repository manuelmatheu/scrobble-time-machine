
// ═════════════════════════════════════════════════════════════════════════════
// LAST.FM API
// ═════════════════════════════════════════════════════════════════════════════
async function getLastFmTotalPages(user) {
  const r = await fetch("https://ws.audioscrobbler.com/2.0/?" + new URLSearchParams({ method:"user.getrecenttracks", user, api_key:LASTFM_API_KEY, format:"json", limit:"1", page:"1" }));
  if (!r.ok) throw new Error("Last.fm API error"); const d = await r.json(); if (d.error) throw new Error(d.message);
  const t = parseInt(d.recenttracks["@attr"].total); return { totalPages: Math.ceil(t/50), totalScrobbles: t };
}
async function fetchEarliestYear(user) {
  try {
    // Fetch with limit=1 to get total count, then grab the very last entry
    const r1 = await fetch("https://ws.audioscrobbler.com/2.0/?" + new URLSearchParams({ method:"user.getrecenttracks", user, api_key:LASTFM_API_KEY, format:"json", limit:"1", page:"1" }));
    if (!r1.ok) return null;
    const d1 = await r1.json();
    if (d1.error) return null;
    const total = parseInt(d1.recenttracks["@attr"].total);
    if (!total) return null;
    // Fetch the very last scrobble (page = total when limit=1)
    const r2 = await fetch("https://ws.audioscrobbler.com/2.0/?" + new URLSearchParams({ method:"user.getrecenttracks", user, api_key:LASTFM_API_KEY, format:"json", limit:"1", page:String(total) }));
    if (!r2.ok) return null;
    const d2 = await r2.json();
    const tracks = d2.recenttracks.track;
    if (!tracks) return null;
    const t = Array.isArray(tracks) ? tracks[tracks.length - 1] : tracks;
    if (t && t.date && t.date.uts) return new Date(parseInt(t.date.uts) * 1000).getFullYear();
  } catch {}
  return null;
}

// Artist bio plus the user's own play count (stats.userplaycount) for that artist
async function getLastFmArtistInfo(user, artist) {
  const r = await fetch("https://ws.audioscrobbler.com/2.0/?" + new URLSearchParams({ method:"artist.getinfo", artist, username:user, autocorrect:"1", api_key:LASTFM_API_KEY, format:"json" }));
  if (!r.ok) throw new Error("Last.fm API error");
  const d = await r.json(); if (d.error) throw new Error(d.message);
  return d;
}
// The user's own play count (userplaycount) for one track
async function getLastFmTrackInfo(user, artist, track) {
  const r = await fetch("https://ws.audioscrobbler.com/2.0/?" + new URLSearchParams({ method:"track.getinfo", artist, track, username:user, autocorrect:"1", api_key:LASTFM_API_KEY, format:"json" }));
  if (!r.ok) throw new Error("Last.fm API error");
  const d = await r.json(); if (d.error) throw new Error(d.message);
  return d;
}

// Artists Last.fm lists as similar to one artist
async function getLastFmSimilarArtists(artist, limit) {
  const r = await fetch("https://ws.audioscrobbler.com/2.0/?" + new URLSearchParams({ method:"artist.getsimilar", artist, limit:String(limit || 10), autocorrect:"1", api_key:LASTFM_API_KEY, format:"json" }));
  if (!r.ok) throw new Error("Last.fm API error");
  const d = await r.json(); if (d.error) throw new Error(d.message);
  return d;
}
async function getLastFmArtistTopTracks(artist, limit) {
  const r = await fetch("https://ws.audioscrobbler.com/2.0/?" + new URLSearchParams({ method:"artist.gettoptracks", artist, limit:String(limit || 10), autocorrect:"1", api_key:LASTFM_API_KEY, format:"json" }));
  if (!r.ok) throw new Error("Last.fm API error");
  const d = await r.json(); if (d.error) throw new Error(d.message);
  return d;
}
// Last.fm's personalized "recommended" station. The endpoint is undocumented and blocks cross-origin
// requests, so a Vercel function (api/lfm-station.js) fetches it; each call returns a different set of ~24 tracks
async function getLastFmStation(user) {
  const r = await fetch("/api/lfm-station?user=" + encodeURIComponent(user), { cache: "no-store" });
  if (!r.ok) throw new Error("Last.fm station unavailable");
  return r.json();
}

// A page of the user's scrobbles, newest first. range = { from, to } (unix seconds) limits it to that window.
async function getLastFmScrobbles(user, page, limit, range) {
  const q = { method:"user.getrecenttracks", user, api_key:LASTFM_API_KEY, format:"json", limit:String(limit), page:String(page) };
  if (range) { q.from = String(range.from); q.to = String(range.to); }
  const r = await fetch("https://ws.audioscrobbler.com/2.0/?" + new URLSearchParams(q));
  if (r.status === 429) throw new Error("Last.fm rate limit");
  if (!r.ok) throw new Error("Last.fm API error");
  const d = await r.json(); if (d.error) throw new Error(d.message);
  return d.recenttracks;
}

// One scrobble at a 1-based position in the user's history, or in a range of it (limit=1 makes "page" an index)
async function getLastFmScrobbleAt(user, page, range) {
  return (await getLastFmScrobbles(user, page, 1, range)).track || [];
}

// How many scrobbles the user has in a range
async function getLastFmCountIn(user, range) {
  const rt = await getLastFmScrobbles(user, 1, 1, range);
  return parseInt(rt["@attr"] && rt["@attr"].total, 10) || 0;
}
