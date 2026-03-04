
// ═════════════════════════════════════════════════════════════════════════════
// LAST.FM API
// ═════════════════════════════════════════════════════════════════════════════
async function getLastFmTotalPages(user) {
  const r = await fetch("https://ws.audioscrobbler.com/2.0/?" + new URLSearchParams({ method:"user.getrecenttracks", user, api_key:LASTFM_API_KEY, format:"json", limit:"1", page:"1" }));
  if (!r.ok) throw new Error("Last.fm API error"); const d = await r.json(); if (d.error) throw new Error(d.message);
  const t = parseInt(d.recenttracks["@attr"].total); return { totalPages: Math.ceil(t/50), totalScrobbles: t };
}
async function getLastFmPage(user, page) {
  const r = await fetch("https://ws.audioscrobbler.com/2.0/?" + new URLSearchParams({ method:"user.getrecenttracks", user, api_key:LASTFM_API_KEY, format:"json", limit:"50", page:String(page) }));
  if (!r.ok) throw new Error("Last.fm API error"); const d = await r.json(); if (d.error) throw new Error(d.message);
  return d.recenttracks.track || [];
}

async function getLastFmPageByDate(user, from, to) {
  const r = await fetch("https://ws.audioscrobbler.com/2.0/?" + new URLSearchParams({ method:"user.getrecenttracks", user, api_key:LASTFM_API_KEY, format:"json", limit:"50", from:String(from), to:String(to) }));
  if (!r.ok) throw new Error("Last.fm API error"); const d = await r.json(); if (d.error) throw new Error(d.message);
  const attr = d.recenttracks["@attr"];
  return { tracks: d.recenttracks.track || [], totalPages: parseInt(attr.totalPages), total: parseInt(attr.total) };
}

// Find a random page containing the given artist by sampling random pages
async function findArtistPage(user, artist, totalPages) {
  const artistLower = artist.toLowerCase();
  const maxAttempts = 8;

  // Get time range of user's history
  const r1 = await fetch("https://ws.audioscrobbler.com/2.0/?" + new URLSearchParams({ method:"user.getrecenttracks", user, api_key:LASTFM_API_KEY, format:"json", limit:"1", page:"1" }));
  if (!r1.ok) return null;
  const d1 = await r1.json();
  const total = parseInt(d1.recenttracks["@attr"].total);
  if (!total) return null;
  const newestTrack = d1.recenttracks.track;
  const newest = Array.isArray(newestTrack) ? newestTrack[0] : newestTrack;
  const newestUts = newest && newest.date ? parseInt(newest.date.uts) : Math.floor(Date.now() / 1000);

  const r2 = await fetch("https://ws.audioscrobbler.com/2.0/?" + new URLSearchParams({ method:"user.getrecenttracks", user, api_key:LASTFM_API_KEY, format:"json", limit:"1", page:String(total) }));
  if (!r2.ok) return null;
  const d2 = await r2.json();
  const oldestTrack = d2.recenttracks.track;
  const oldest = Array.isArray(oldestTrack) ? oldestTrack[oldestTrack.length - 1] : oldestTrack;
  const oldestUts = oldest && oldest.date ? parseInt(oldest.date.uts) : newestUts - 86400 * 365;

  // Sample random time windows, fetching 200 tracks per call
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const randomUts = oldestUts + Math.floor(Math.random() * (newestUts - oldestUts));
    // Use a bounded window: from randomUts to randomUts + 30 days
    const windowEnd = Math.min(randomUts + 86400 * 30, newestUts);
    const r = await fetch("https://ws.audioscrobbler.com/2.0/?" + new URLSearchParams({ method:"user.getrecenttracks", user, api_key:LASTFM_API_KEY, format:"json", limit:"200", from:String(randomUts), to:String(windowEnd) }));
    if (!r.ok) continue;
    const d = await r.json();
    if (d.error) continue;
    const tracks = (d.recenttracks.track || []).filter(t => !(t["@attr"] && t["@attr"].nowplaying));
    const hasArtist = tracks.some(t => {
      const a = (t.artist && (t.artist["#text"] || t.artist.name)) || "";
      return a.toLowerCase() === artistLower;
    });
    if (hasArtist) {
      // Narrow down to a 50-track window centered on the artist for a tighter page feel
      const idx = tracks.findIndex(t => {
        const a = (t.artist && (t.artist["#text"] || t.artist.name)) || "";
        return a.toLowerCase() === artistLower;
      });
      const start = Math.max(0, idx - 25);
      const slice = tracks.slice(start, start + 50);
      return { tracks: slice, page: Math.floor(randomUts / 86400), attempt: attempt + 1 };
    }
  }
  return null;
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

async function getMoodArtists(mood) {
  const tags = MOOD_TAGS[mood] || [mood];
  const artists = new Set();
  for (const tag of tags) {
    const r = await fetch("https://ws.audioscrobbler.com/2.0/?" + new URLSearchParams({ method:"tag.gettopartists", tag, api_key:LASTFM_API_KEY, format:"json", limit:"20" }));
    if (!r.ok) continue;
    const d = await r.json();
    const list = d.topartists && d.topartists.artist || [];
    list.forEach(a => artists.add(a.name.toLowerCase()));
  }
  return artists;
}

