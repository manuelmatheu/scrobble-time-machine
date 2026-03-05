
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

  // PHASE 1: Sample random time windows to find ANY occurrence of the artist
  const maxScanAttempts = 10;
  let hitTimestamps = []; // collect timestamps where we found the artist

  for (let attempt = 0; attempt < maxScanAttempts; attempt++) {
    const randomUts = oldestUts + Math.floor(Math.random() * (newestUts - oldestUts));
    const windowEnd = Math.min(randomUts + 86400 * 30, newestUts);
    const r = await fetch("https://ws.audioscrobbler.com/2.0/?" + new URLSearchParams({ method:"user.getrecenttracks", user, api_key:LASTFM_API_KEY, format:"json", limit:"200", from:String(randomUts), to:String(windowEnd) }));
    if (!r.ok) continue;
    const d = await r.json();
    if (d.error) continue;
    const tracks = (d.recenttracks.track || []).filter(t => !(t["@attr"] && t["@attr"].nowplaying));

    for (const t of tracks) {
      const a = (t.artist && (t.artist["#text"] || t.artist.name)) || "";
      if (a.toLowerCase() === artistLower && t.date && t.date.uts) {
        hitTimestamps.push(parseInt(t.date.uts));
      }
    }
    if (hitTimestamps.length > 0) break;
  }

  if (!hitTimestamps.length) return null;

  // PHASE 2: For each hit timestamp, zoom in with a tight window (3 days) to find dense clusters
  // Pick a random hit to explore
  const MIN_TRACKS = 5;
  let bestResult = null, bestSliceCount = 0;

  // Shuffle hits and try up to 3 different ones
  hitTimestamps.sort(() => Math.random() - 0.5);
  const hitsToTry = hitTimestamps.slice(0, 3);

  for (const hitUts of hitsToTry) {
    // Search 3 days centered on the hit
    const zoomFrom = hitUts - 86400 * 1.5;
    const zoomTo = hitUts + 86400 * 1.5;
    const r = await fetch("https://ws.audioscrobbler.com/2.0/?" + new URLSearchParams({ method:"user.getrecenttracks", user, api_key:LASTFM_API_KEY, format:"json", limit:"200", from:String(Math.floor(zoomFrom)), to:String(Math.floor(zoomTo)) }));
    if (!r.ok) continue;
    const d = await r.json();
    if (d.error) continue;
    const tracks = (d.recenttracks.track || []).filter(t => !(t["@attr"] && t["@attr"].nowplaying));
    if (!tracks.length) continue;

    // Slide a 50-track window to find the densest cluster
    let localBestStart = 0, localBestCount = 0;
    for (let s = 0; s <= Math.max(0, tracks.length - 50); s++) {
      let sc = 0;
      for (let j = s; j < Math.min(s + 50, tracks.length); j++) {
        const a = (tracks[j].artist && (tracks[j].artist["#text"] || tracks[j].artist.name)) || "";
        if (a.toLowerCase() === artistLower) sc++;
      }
      if (sc > localBestCount) { localBestCount = sc; localBestStart = s; }
    }

    if (localBestCount > bestSliceCount) {
      bestSliceCount = localBestCount;
      const slice = tracks.slice(localBestStart, localBestStart + 50);
      bestResult = { tracks: slice, page: 0, attempt: hitsToTry.indexOf(hitUts) + 1, matchCount: localBestCount };
    }
    if (bestSliceCount >= MIN_TRACKS) break;
  }

  // If zoom didn't yield good results but we had hits, try a wider 14-day window
  if (bestSliceCount < MIN_TRACKS && hitTimestamps.length > 0) {
    const hitUts = hitTimestamps[0];
    const wideFrom = hitUts - 86400 * 7;
    const wideTo = hitUts + 86400 * 7;
    const r = await fetch("https://ws.audioscrobbler.com/2.0/?" + new URLSearchParams({ method:"user.getrecenttracks", user, api_key:LASTFM_API_KEY, format:"json", limit:"200", from:String(Math.floor(wideFrom)), to:String(Math.floor(wideTo)) }));
    if (r.ok) {
      const d = await r.json();
      if (!d.error) {
        const tracks = (d.recenttracks.track || []).filter(t => !(t["@attr"] && t["@attr"].nowplaying));
        let localBestStart = 0, localBestCount = 0;
        for (let s = 0; s <= Math.max(0, tracks.length - 50); s++) {
          let sc = 0;
          for (let j = s; j < Math.min(s + 50, tracks.length); j++) {
            const a = (tracks[j].artist && (tracks[j].artist["#text"] || tracks[j].artist.name)) || "";
            if (a.toLowerCase() === artistLower) sc++;
          }
          if (sc > localBestCount) { localBestCount = sc; localBestStart = s; }
        }
        if (localBestCount > bestSliceCount) {
          bestSliceCount = localBestCount;
          const slice = tracks.slice(localBestStart, localBestStart + 50);
          bestResult = { tracks: slice, page: 0, attempt: 0, matchCount: localBestCount };
        }
      }
    }
  }

  return bestResult;
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

