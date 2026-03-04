
// ═════════════════════════════════════════════════════════════════════════════
// MAIN: DISPATCH BY MODE
// ═════════════════════════════════════════════════════════════════════════════
async function handleGo() {
  if (searchMode === "date") return handleGoDate();
  if (searchMode === "artist") return handleGoArtist();
  if (searchMode === "mood") return handleGoMood();
  return handleGoRandom();
}

// ── RANDOM MODE ──────────────────────────────────────────────────────────────
async function handleGoRandom() {
  const user = $("usernameInput").value.trim(); if (!user || !spotifyToken) return;
  beginSession();
  try {
    showStatus("Reading your Last.fm library…");
    const { totalPages, totalScrobbles } = await getLastFmTotalPages(user);
    cachedTotalPages = totalPages; cachedTotalScrobbles = totalScrobbles;
    if (!totalPages) throw new Error("No scrobbles found");
    $("pagePicker").style.display = ""; $("pageTotal").textContent = "of " + totalPages.toLocaleString() + " pages · " + totalScrobbles.toLocaleString() + " scrobbles";
    showStatus("Spinning the wheel…");
    const page = Math.floor(Math.random() * totalPages) + 1;
    await animatePagePick(page, totalPages);
    if (abortController.signal.aborted) return;
    showStatus("Loading page " + page.toLocaleString() + "…");
    const raw = await getLastFmPage(user, page);
    const tracks = raw.filter(t => !(t["@attr"] && t["@attr"].nowplaying));
    if (!tracks.length) throw new Error("No tracks on this page");
    renderEraPanel(tracks, page, totalPages);
    await fetchAndPlay(user, page, totalPages);
  } catch(err) {
    if (!abortController.signal.aborted) { currentPhase = "error"; showStatus(err.message, "error"); }
    endSessionUI();
  }
}

// ── DATE MODE ────────────────────────────────────────────────────────────────
async function handleGoDate() {
  const user = $("usernameInput").value.trim(); if (!user || !spotifyToken) return;
  const year = parseInt($("dateYear").value);
  const month = parseInt($("dateMonth").value) || 0;
  const day = parseInt($("dateDay").value) || 0;
  if (!year) return;

  // Build from/to timestamps
  let from, to, label;
  if (month && day) {
    from = Math.floor(new Date(year, month - 1, day, 0, 0, 0).getTime() / 1000);
    to = Math.floor(new Date(year, month - 1, day, 23, 59, 59).getTime() / 1000);
    label = new Date(year, month - 1, day).toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" });
  } else if (month) {
    from = Math.floor(new Date(year, month - 1, 1).getTime() / 1000);
    to = Math.floor(new Date(year, month, 0, 23, 59, 59).getTime() / 1000);
    label = new Date(year, month - 1).toLocaleDateString("en-US", { year:"numeric", month:"long" });
  } else {
    from = Math.floor(new Date(year, 0, 1).getTime() / 1000);
    to = Math.floor(new Date(year, 11, 31, 23, 59, 59).getTime() / 1000);
    label = String(year);
  }

  beginSession();
  try {
    showStatus("Searching " + label + "…");
    const result = await getLastFmPageByDate(user, from, to);
    if (!result.total) throw new Error("No scrobbles found for " + label);

    // If there are multiple pages, pick a random one
    let tracks;
    if (result.totalPages > 1) {
      const rndPage = Math.floor(Math.random() * result.totalPages) + 1;
      showStatus("Found " + result.total.toLocaleString() + " scrobbles in " + label + " · loading page " + rndPage + "…");
      const r2 = await getLastFmPageByDate(user, from, to);
      // Actually fetch the random page
      const r3 = await fetch("https://ws.audioscrobbler.com/2.0/?" + new URLSearchParams({ method:"user.getrecenttracks", user, api_key:LASTFM_API_KEY, format:"json", limit:"50", from:String(from), to:String(to), page:String(rndPage) }));
      if (!r3.ok) throw new Error("Last.fm API error");
      const d3 = await r3.json(); if (d3.error) throw new Error(d3.message);
      tracks = (d3.recenttracks.track || []).filter(t => !(t["@attr"] && t["@attr"].nowplaying));
    } else {
      tracks = result.tracks.filter(t => !(t["@attr"] && t["@attr"].nowplaying));
    }

    if (!tracks.length) throw new Error("No tracks found for " + label);

    // Build era panel from the tracks we got
    const oldest = tracks[tracks.length-1], newest = tracks[0];
    if (oldest && oldest.date && newest && newest.date) {
      // Get total pages for the slider context
      const { totalPages } = await getLastFmTotalPages(user);
      cachedTotalPages = totalPages;
      // Estimate what page this falls on: use the timestamp to guess
      const midUts = parseInt(oldest.date.uts);
      // We don't know the exact page, so render era panel without slider interaction
      renderEraPanelFromTracks(tracks, label, totalPages);
    }

    showStatus("Found " + result.total.toLocaleString() + " scrobbles in " + label);
    await fetchAndPlayDirect(tracks, label);
  } catch(err) {
    if (!abortController.signal.aborted) { currentPhase = "error"; showStatus(err.message, "error"); }
    endSessionUI();
  }
}

// ── ARTIST MODE ──────────────────────────────────────────────────────────────
async function handleGoArtist() {
  const user = $("usernameInput").value.trim(); if (!user || !spotifyToken) return;
  const artist = $("artistInput").value.trim(); if (!artist) return;

  beginSession();
  try {
    showStatus("Reading your Last.fm library…");
    const { totalPages, totalScrobbles } = await getLastFmTotalPages(user);
    cachedTotalPages = totalPages;
    if (!totalPages) throw new Error("No scrobbles found");

    showStatus("Searching for " + artist + " in your history…");
    const result = await findArtistPage(user, artist, totalPages);
    if (!result) throw new Error("Couldn't find " + artist + " in your history. Check the spelling or try again — each search samples different time periods.");

    const tracks = result.tracks;
    const oldest = tracks[tracks.length - 1];
    const dateStr = oldest && oldest.date ? new Date(parseInt(oldest.date.uts) * 1000).toLocaleDateString("en-US", { year:"numeric", month:"long" }) : "";
    const label = artist + (dateStr ? " · " + dateStr : "");

    renderEraPanelFromTracks(tracks, label, totalPages);
    showStatus("Found " + artist + " on page " + result.page.toLocaleString() + " (attempt " + result.attempt + ")");
    await fetchAndPlayDirect(tracks, label);
  } catch(err) {
    if (!abortController.signal.aborted) { currentPhase = "error"; showStatus(err.message, "error"); }
    endSessionUI();
  }
}

// ── MOOD MODE ────────────────────────────────────────────────────────────
async function handleGoMood() {
  const user = $("usernameInput").value.trim(); if (!user || !spotifyToken) return;
  const mood = selectedMood;
  const moodLabel = document.querySelector('.mood-btn[data-mood="'+mood+'"]').textContent.trim();

  beginSession();
  try {
    showStatus("Finding " + moodLabel + " artists…");
    const moodArtists = await getMoodArtists(mood);
    if (!moodArtists.size) throw new Error("No artists found for this mood");

    showStatus("Reading your Last.fm library…");
    const { totalPages, totalScrobbles } = await getLastFmTotalPages(user);
    cachedTotalPages = totalPages;
    if (!totalPages) throw new Error("No scrobbles found");

    showStatus("Searching for " + moodLabel + " tracks in your history…");
    const maxAttempts = 15;
    let bestPage = null, bestCount = 0, bestTracks = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (abortController.signal.aborted) return;
      const page = Math.floor(Math.random() * totalPages) + 1;
      const raw = await getLastFmPage(user, page);
      const tracks = raw.filter(t => !(t["@attr"] && t["@attr"].nowplaying));
      // Count how many tracks on this page match mood artists
      let count = 0;
      for (const t of tracks) {
        const a = ((t.artist && (t.artist["#text"] || t.artist.name)) || "").toLowerCase();
        if (moodArtists.has(a)) count++;
      }
      showStatus("Searching for " + moodLabel + " tracks… (attempt " + (attempt+1) + ", best: " + bestCount + " matches)");
      if (count > bestCount) {
        bestCount = count; bestPage = page; bestTracks = tracks;
      }
      // If we found a good page (3+ matches), stop early
      if (bestCount >= 3) break;
    }

    if (!bestTracks || bestCount === 0) throw new Error("Couldn't find " + moodLabel + " tracks in your history after " + maxAttempts + " pages. Try again!");

    const oldest = bestTracks[bestTracks.length - 1];
    const dateStr = oldest && oldest.date ? new Date(parseInt(oldest.date.uts) * 1000).toLocaleDateString("en-US", { year:"numeric", month:"long" }) : "";
    const label = moodLabel + (dateStr ? " · " + dateStr : "");

    renderEraPanelFromTracks(bestTracks, label, totalPages);
    showStatus("Found " + bestCount + " " + moodLabel + " tracks on page " + bestPage.toLocaleString());
    await fetchAndPlayDirect(bestTracks, label);
  } catch(err) {
    if (!abortController.signal.aborted) { currentPhase = "error"; showStatus(err.message, "error"); }
    endSessionUI();
  }
}

// ── SESSION HELPERS ──────────────────────────────────────────────────────────
function beginSession() {
  abortController = new AbortController(); currentPhase = "working"; updateGoButton();
  $("goBtn").style.display = "none"; $("cancelBtn").style.display = ""; $("usernameInput").disabled = true;
  $("pagePicker").style.display = "none"; $("eraPanel").style.display = "none";
  $("trackListWrapper").style.display = "none"; $("trackList").innerHTML = ""; $("matchCount").textContent = "";
  searchCache = {}; sessionQueue = new Set(); sessionPaused = false; stopPolling(); hideStatus();
  $("savePlaylistBtn").style.display = "none";
}
function endSessionUI() {
  $("goBtn").style.display = ""; $("cancelBtn").style.display = "none"; $("usernameInput").disabled = false; updateGoButton();
}

