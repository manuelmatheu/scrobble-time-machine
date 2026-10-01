
// ═════════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ═════════════════════════════════════════════════════════════════════════════
function showStatus(msg, type) { const e=$("statusBar"); e.style.display=""; e.className="status-bar "+(type||""); e.innerHTML = (!type && currentPhase==="working" ? '<span class="spinner"></span>' : "") + msg; }
function hideStatus() { $("statusBar").style.display = "none"; }
function escHtml(s) { const d=document.createElement("div"); d.textContent=s; return d.innerHTML; }
function fmtDate(uts) { return new Date(parseInt(uts)*1000).toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}); }

// Last.fm returns this fixed hash for tracks/albums with no artwork -- treat it as absent
const LASTFM_BLANK_ART = "2a96cbd8b46e442fc41c2b86b821562f";
function lastfmArt(t) {
  const img = t.image && t.image[1] && t.image[1]["#text"];
  return (img && img.indexOf(LASTFM_BLANK_ART) === -1) ? img : null;
}

function renderTrackRow(t, i) {
  const artist = (t.artist && (t.artist["#text"]||t.artist.name))||"", album = (t.album&&t.album["#text"])||"";
  const img = lastfmArt(t), dt = t.date ? fmtDate(t.date.uts) : "Now playing";
  const imgH = img ? '<img class="track-art" src="'+img+'" alt="" loading="lazy">' : '<div class="track-art-placeholder"><i class="ph ph-music-note" aria-hidden="true"></i></div>';
  return '<div class="track-row" id="track-'+i+'" onclick="playFromTrack('+i+')"><div class="track-num-wrap"><span class="track-num">'+(i+1)+'</span><span class="play-icon"><i class="ph-fill ph-play" aria-hidden="true"></i></span></div>'
    +'<div class="track-art-wrap" id="art-'+i+'">'+imgH+'</div>'
    +'<div class="track-info"><div class="track-name">'+escHtml(t.name)+'</div><div class="track-meta">'+escHtml(artist)+(album?' · '+escHtml(album):'')+'</div></div>'
    +'<span class="track-date">'+dt+'</span>'
    +'<button class="heart-btn" id="heart-'+i+'" onclick="event.stopPropagation(); toggleLikeTrack('+i+')" title="Save to Liked Songs">'+HEART_EMPTY+'</button>'
    +'<span class="track-status" id="status-'+i+'"></span></div>';
}

// Swap in Spotify's album art once a track is matched -- Last.fm's own art is frequently missing
function updateTrackArt(i, spotifyItem) {
  const images = spotifyItem && spotifyItem.album && spotifyItem.album.images;
  if (!images || !images.length) return;
  const wrap = $("art-"+i);
  if (!wrap || wrap.querySelector("img")) return;
  const url = (images[images.length-1] || images[0]).url;
  wrap.innerHTML = '<img class="track-art" src="'+url+'" alt="" loading="lazy">';
}
function setTrackStatus(i, s) {
  const e=$("status-"+i); if(!e) return;
  e.className="track-status "+s; e.textContent = s==="found"?"✓":s==="not_found"?"✗":s==="searching"?"…":s==="skipped"?"–":"";
  const row=$("track-"+i); if(!row) return;
  if(s==="found"){row.classList.add("playable");row.classList.remove("not-matched");}
  else if(s==="not_found"||s==="skipped"){row.classList.add("not-matched");row.classList.remove("playable");}
}

// Wide desktop: the Time Travel list scrolls inside its panel; keep the playing row in view without moving the page
function scrollTrackListTo(row) {
  const box = $("trackList");
  if (!box || box.scrollHeight <= box.clientHeight + 1) return;
  const top = row.offsetTop, bottom = top + row.offsetHeight;
  if (top < box.scrollTop || bottom > box.scrollTop + box.clientHeight) box.scrollTop = Math.max(top - 8, 0);
}

function highlightNowPlaying(index) {
  if (index === nowPlayingIndex) return;
  document.querySelectorAll(".track-row.now-playing").forEach(r => r.classList.remove("now-playing"));
  if (index >= 0) { const row = $("track-" + index); if (row) { row.classList.add("now-playing"); if (!travelActive) row.scrollIntoView({behavior:"smooth", block:"nearest"}); else scrollTrackListTo(row); } }
  nowPlayingIndex = index;
}

async function playFromTrack(i) {
  const uris = []; for (let j = i; j < allTrackCount; j++) if (matchedUris[j]) uris.push(matchedUris[j]);
  if (!uris.length) return;
  const tk = await getSpotifyToken(); if (!tk) { showStatus("Spotify expired.", "error"); return; }
  if (await spotifyPlay(tk, uris)) {
    sessionQueue = new Set(uris); sessionPaused = false;
    highlightNowPlaying(i);
    showStatus("▶ Playing from track " + (i+1) + " (" + uris.length + " queued)", "success");
    startPolling();
    $("savePlaylistBtn").style.display = ""; $("savePlaylistBtn").disabled = false;
  } else { showStatus("Playback failed. Is Spotify active?", "error"); }
}



function populateYears(startYear) {
  const sel = $("dateYear"), now = new Date().getFullYear();
  const floor = startYear || 2002;
  sel.innerHTML = '<option value="">Year</option>';
  for (let y = now; y >= floor; y--) sel.innerHTML += '<option value="'+y+'">'+y+'</option>';
}

function populateDays() {
  const sel = $("dateDay"), y = parseInt($("dateYear").value), m = parseInt($("dateMonth").value);
  sel.innerHTML = '<option value="">Day (any)</option>';
  if (!y || !m) return;
  const days = new Date(y, m, 0).getDate();
  for (let d = 1; d <= days; d++) sel.innerHTML += '<option value="'+d+'">'+d+'</option>';
}

async function refreshYearsForUser() {
  const user = $("usernameInput").value.trim();
  if (!user || user === lastRefreshedUser) return;
  lastRefreshedUser = user;
  const year = await fetchEarliestYear(user);
  if (year) populateYears(year);
}


function selectMood(btn) {
  document.querySelectorAll(".mood-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  selectedMood = btn.dataset.mood;
  updateGoButton();
}

function setMode(mode) {
  searchMode = mode;
  document.querySelectorAll(".mode-card").forEach(p => p.classList.toggle("active", p.dataset.mode === mode));
  $("modeInputDate").style.display = mode === "date" ? "" : "none";
  $("modeInputArtist").style.display = mode === "artist" ? "" : "none";
  $("modeInputMood").style.display = mode === "mood" ? "" : "none";
  $("modeInputDecade").style.display = mode === "decade" ? "" : "none";
  $("modeInputAlbum").style.display = mode === "album" ? "" : "none";
  $("modeInputDiscovery").style.display = mode === "discovery" ? "" : "none";
  $("modeInputStreak").style.display = mode === "streak" ? "" : "none";
  if (mode === "date") { lastRefreshedUser = ""; refreshYearsForUser().then(() => updateGoButton()); }
  if (mode === "decade") populateDecades();
  updateGoButton();
  if (mode === "artist") $("artistInput").focus();
  if (mode === "album") $("albumArtistInput").focus();
  if (mode === "discovery") $("discoveryInput").focus();
  if (mode === "streak") $("streakInput").focus();
}

function updateSpotifyUI(c) {
  $("spotifyConnectBtn").style.display = c ? "none" : "";
  $("spotifyBadge").style.display = c ? "" : "none";
  $("radioBtn").style.display = c ? "" : "none";
  $("timeTravel").style.display = c ? "" : "none";
  updateGoButton();
}
function updateGoButton() {
  const user = $("usernameInput").value.trim();
  const base = user && spotifyToken && LASTFM_API_KEY !== "YOUR_LASTFM_API_KEY" && (currentPhase==="idle"||currentPhase==="done"||currentPhase==="error");
  $("radioBtn").disabled = !base;
  $("radioAgainBtn").disabled = currentPhase === "working";
  let ok = base;
  if (searchMode === "date") ok = base && $("dateYear").value;
  else if (searchMode === "artist") ok = base && $("artistInput").value.trim();
  else if (searchMode === "album") ok = base && $("albumArtistInput").value.trim() && $("albumInput").value.trim();
  else if (searchMode === "discovery") ok = base && $("discoveryInput").value.trim();
  else if (searchMode === "streak") ok = base && $("streakInput").value.trim();
  $("goBtn").disabled = !ok; $("goBtn").className = "btn btn-primary" + (ok ? " ready" : "");
  const labels = { random: currentPhase==="done" ? "↻ Again" : "Time Travel", date: "Go to Date", artist: "Find Artist", mood: "Find Mood", onthisday: "On This Day", decade: "Go to Era", album: "Find Album", discovery: "Find First Listen", streak: "Find Streak" };
  $("goBtn").textContent = labels[searchMode] || "Time Travel";
}


function handleReset() {
  radioStop(); trackMeta = {};
  if (abortController) abortController.abort();
  stopPolling();
  currentPhase = "idle"; matchedUris = {}; allTrackCount = 0; uriToIndices = {};
  skippedPlan = []; isContinuing = false; currentTracks = []; sessionQueue = new Set(); sessionPaused = false;
  endSessionUI();
  $("trackListWrapper").style.display = "none"; hideStatus();
}

// ═════════════════════════════════════════════════════════════════════════════
// DECADE SELECTOR
// ═════════════════════════════════════════════════════════════════════════════
let selectedDecade = null;

async function populateDecades() {
  const box = $("modeInputDecade");
  const now = new Date().getFullYear();
  const user = $("usernameInput").value.trim();
  let startYear = 2005;
  if (user) {
    const year = await fetchEarliestYear(user);
    if (year) startYear = year;
  }
  const startDecade = Math.floor(startYear / 10) * 10;
  const endDecade = Math.floor(now / 10) * 10;
  let html = "";
  for (let d = endDecade; d >= startDecade; d -= 10) {
    const label = d + "s";
    const active = selectedDecade === d ? " active" : "";
    html += '<button class="mood-btn' + active + '" data-decade="' + d + '" onclick="selectDecade(this)">' + label + '</button>';
  }
  box.innerHTML = html;
  if (!selectedDecade && box.children.length) {
    box.children[0].classList.add("active");
    selectedDecade = parseInt(box.children[0].dataset.decade);
  }
}

function selectDecade(btn) {
  document.querySelectorAll("#modeInputDecade .mood-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  selectedDecade = parseInt(btn.dataset.decade);
  updateGoButton();
}

// ═════════════════════════════════════════════════════════════════════════════
// ARTIST AUTOCOMPLETE
// ═════════════════════════════════════════════════════════════════════════════
let acCache = null;
let acUser = "";
let acTimer = null;
let acSelectedIdx = -1;

async function fetchTopArtists(user) {
  if (acCache && acUser === user) return acCache;
  const artists = [];
  // Fetch up to 500 top artists (5 pages of 100)
  for (let page = 1; page <= 5; page++) {
    const r = await fetch("https://ws.audioscrobbler.com/2.0/?" + new URLSearchParams({ method:"user.gettopartists", user, api_key:LASTFM_API_KEY, format:"json", limit:"100", page:String(page), period:"overall" }));
    if (!r.ok) break;
    const d = await r.json();
    if (d.error) break;
    const list = d.topartists && d.topartists.artist || [];
    if (!list.length) break;
    for (const a of list) artists.push({ name: a.name, playcount: parseInt(a.playcount) });
  }
  acCache = artists;
  acUser = user;
  return artists;
}

function handleArtistAutocomplete() {
  clearTimeout(acTimer);
  const query = $("artistInput").value.trim().toLowerCase();
  if (query.length < 2) { clearArtistSuggestions(); return; }
  const user = $("usernameInput").value.trim();
  if (!user) return;

  acTimer = setTimeout(async () => {
    const artists = await fetchTopArtists(user);
    const matches = artists.filter(a => a.name.toLowerCase().includes(query)).slice(0, 6);
    renderArtistSuggestions(matches);
  }, 150);
}

function renderArtistSuggestions(matches) {
  let box = $("artistSuggestions");
  if (!box) {
    box = document.createElement("div");
    box.id = "artistSuggestions";
    box.className = "autocomplete-box";
    $("artistInput").parentNode.appendChild(box);
  }
  acSelectedIdx = -1;
  if (!matches.length) { box.innerHTML = ""; box.style.display = "none"; return; }
  box.innerHTML = matches.map((m, i) =>
    '<div class="autocomplete-item" data-idx="'+i+'" onmousedown="selectArtistSuggestion('+i+')">'
    + '<span class="ac-name">'+escHtml(m.name)+'</span>'
    + '<span class="ac-count">'+m.playcount.toLocaleString()+' plays</span>'
    + '</div>'
  ).join("");
  box.style.display = "";
  box._matches = matches;
}

function selectArtistSuggestion(idx) {
  const box = $("artistSuggestions");
  if (!box || !box._matches || !box._matches[idx]) return;
  $("artistInput").value = box._matches[idx].name;
  clearArtistSuggestions();
  updateGoButton();
}

function clearArtistSuggestions() {
  const box = $("artistSuggestions");
  if (box) { box.innerHTML = ""; box.style.display = "none"; }
  acSelectedIdx = -1;
}

function handleArtistKeydown(e) {
  const box = $("artistSuggestions");
  if (!box || box.style.display === "none" || !box._matches || !box._matches.length) return false;
  const items = box.querySelectorAll(".autocomplete-item");
  if (e.key === "ArrowDown") {
    e.preventDefault();
    acSelectedIdx = Math.min(acSelectedIdx + 1, items.length - 1);
    items.forEach((el, i) => el.classList.toggle("ac-active", i === acSelectedIdx));
    return true;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    acSelectedIdx = Math.max(acSelectedIdx - 1, -1);
    items.forEach((el, i) => el.classList.toggle("ac-active", i === acSelectedIdx));
    return true;
  }
  if ((e.key === "Enter" || e.key === "Tab") && acSelectedIdx >= 0) {
    e.preventDefault();
    selectArtistSuggestion(acSelectedIdx);
    return true;
  }
  return false;
}

// ═════════════════════════════════════════════════════════════════════════════
// CHANGELOG OVERLAY
// ═════════════════════════════════════════════════════════════════════════════
function openChangelog() {
  $("changelogOverlay").style.display = "flex";
  $("changelogFrame").src = "changelog.html";
  document.body.style.overflow = "hidden";
}
function closeChangelog() {
  $("changelogOverlay").style.display = "none";
  $("changelogFrame").src = "about:blank";
  document.body.style.overflow = "";
}

// (Theme toggle is handled by inline IIFE in index.html to prevent flash)

// ═════════════════════════════════════════════════════════════════════════════
// GENERIC ARTIST AUTOCOMPLETE FACTORY
// ═════════════════════════════════════════════════════════════════════════════
function makeAutocomplete(inputId, boxId) {
  let timer = null, selIdx = -1;
  function getBox() {
    let box = $(boxId);
    if (!box) {
      box = document.createElement("div");
      box.id = boxId;
      box.className = "autocomplete-box";
      $(inputId).parentNode.appendChild(box);
    }
    return box;
  }
  function render(matches) {
    const box = getBox();
    selIdx = -1;
    if (!matches.length) { box.innerHTML = ""; box.style.display = "none"; return; }
    box.innerHTML = matches.map((m, i) =>
      '<div class="autocomplete-item" data-idx="'+i+'" onmousedown="window._acSelect_'+boxId+'('+i+')">'
      + '<span class="ac-name">'+escHtml(m.name)+'</span>'
      + '<span class="ac-count">'+m.playcount.toLocaleString()+' plays</span></div>'
    ).join("");
    box.style.display = "";
    box._matches = matches;
  }
  window['_acSelect_'+boxId] = function(idx) {
    const box = getBox();
    if (!box._matches || !box._matches[idx]) return;
    $(inputId).value = box._matches[idx].name;
    box.innerHTML = ""; box.style.display = "none"; selIdx = -1;
    updateGoButton();
  };
  return {
    handle: function() {
      clearTimeout(timer);
      const q = $(inputId).value.trim().toLowerCase();
      if (q.length < 2) { getBox().innerHTML = ""; getBox().style.display = "none"; return; }
      const user = $("usernameInput").value.trim();
      if (!user) return;
      timer = setTimeout(async () => {
        const artists = await fetchTopArtists(user);
        render(artists.filter(a => a.name.toLowerCase().includes(q)).slice(0, 6));
      }, 150);
    },
    keydown: function(e) {
      const box = getBox();
      if (box.style.display === "none" || !box._matches || !box._matches.length) return false;
      const items = box.querySelectorAll(".autocomplete-item");
      if (e.key === "ArrowDown") { e.preventDefault(); selIdx = Math.min(selIdx + 1, items.length - 1); items.forEach((el, i) => el.classList.toggle("ac-active", i === selIdx)); return true; }
      if (e.key === "ArrowUp") { e.preventDefault(); selIdx = Math.max(selIdx - 1, -1); items.forEach((el, i) => el.classList.toggle("ac-active", i === selIdx)); return true; }
      if ((e.key === "Enter" || e.key === "Tab") && selIdx >= 0) { e.preventDefault(); window['_acSelect_'+boxId](selIdx); return true; }
      return false;
    },
    clear: function() { const box = getBox(); box.innerHTML = ""; box.style.display = "none"; selIdx = -1; }
  };
}

const discoveryAC = makeAutocomplete("discoveryInput", "discoverySuggestions");
const handleDiscoveryAutocomplete = discoveryAC.handle;
const handleDiscoveryKeydown = discoveryAC.keydown;
const clearDiscoverySuggestions = discoveryAC.clear;

const streakAC = makeAutocomplete("streakInput", "streakSuggestions");
const handleStreakAutocomplete = streakAC.handle;
const handleStreakKeydown = streakAC.keydown;
const clearStreakSuggestions = streakAC.clear;
