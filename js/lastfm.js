
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
  const maxAttempts = 10;
  const artistLower = artist.toLowerCase();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const page = Math.floor(Math.random() * totalPages) + 1;
    const tracks = await getLastFmPage(user, page);
    const filtered = tracks.filter(t => !(t["@attr"] && t["@attr"].nowplaying));
    const hasArtist = filtered.some(t => {
      const a = (t.artist && (t.artist["#text"] || t.artist.name)) || "";
      return a.toLowerCase() === artistLower;
    });
    if (hasArtist) return { tracks: filtered, page, attempt: attempt + 1 };
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
