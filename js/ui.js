
// ═════════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ═════════════════════════════════════════════════════════════════════════════
function showStatus(msg, type) { const e=$("statusBar"); e.style.display=""; e.className="status-bar "+(type||""); e.innerHTML = (!type && currentPhase==="working" ? '<span class="spinner"></span>' : "") + msg; }
function hideStatus() { $("statusBar").style.display = "none"; }
function escHtml(s) { const d=document.createElement("div"); d.textContent=s; return d.innerHTML; }
function fmtDate(uts) { return new Date(parseInt(uts)*1000).toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}); }

function renderTrackRow(t, i) {
  const artist = (t.artist && (t.artist["#text"]||t.artist.name))||"", album = (t.album&&t.album["#text"])||"";
  const img = t.image&&t.image[1]&&t.image[1]["#text"], dt = t.date ? fmtDate(t.date.uts) : "Now playing";
  const imgH = img ? '<img class="track-art" src="'+img+'" alt="" loading="lazy">' : '<div class="track-art-placeholder">♪</div>';
  return '<div class="track-row" id="track-'+i+'" onclick="playFromTrack('+i+')"><div class="track-num-wrap"><span class="track-num">'+(i+1)+'</span><span class="play-icon">▶</span></div>'
    +imgH+'<div class="track-info"><div class="track-name">'+escHtml(t.name)+'</div><div class="track-meta">'+escHtml(artist)+(album?' · '+escHtml(album):'')+'</div></div>'
    +'<span class="track-date">'+dt+'</span><span class="track-status" id="status-'+i+'"></span></div>';
}
function setTrackStatus(i, s) {
  const e=$("status-"+i); if(!e) return;
  e.className="track-status "+s; e.textContent = s==="found"?"✓":s==="not_found"?"✗":s==="searching"?"…":s==="skipped"?"–":"";
  const row=$("track-"+i); if(!row) return;
  if(s==="found"){row.classList.add("playable");row.classList.remove("not-matched");}
  else if(s==="not_found"||s==="skipped"){row.classList.add("not-matched");row.classList.remove("playable");}
}

function highlightNowPlaying(index) {
  if (index === nowPlayingIndex) return;
  document.querySelectorAll(".track-row.now-playing").forEach(r => r.classList.remove("now-playing"));
  if (index >= 0) { const row = $("track-" + index); if (row) { row.classList.add("now-playing"); row.scrollIntoView({behavior:"smooth", block:"nearest"}); } }
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
  } else { showStatus("Playback failed. Is Spotify active?", "error"); }
}

function animatePagePick(final, total) { return new Promise(res => { const el=$("pageNumber"); let i=0; el.classList.add("spinning"); const iv=setInterval(()=>{i++;el.textContent=(Math.floor(Math.random()*total)+1).toLocaleString();if(i>=22){clearInterval(iv);el.textContent=final.toLocaleString();el.classList.remove("spinning");res();}},70); }); }


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
  document.querySelectorAll(".mode-pill").forEach(p => p.classList.toggle("active", p.dataset.mode === mode));
  $("modeInputDate").style.display = mode === "date" ? "" : "none";
  $("modeInputArtist").style.display = mode === "artist" ? "" : "none";
  $("modeInputMood").style.display = mode === "mood" ? "" : "none";
  if (mode === "date") { lastRefreshedUser = ""; refreshYearsForUser(); }
  updateGoButton();
  if (mode === "artist") $("artistInput").focus();
}

function updateSpotifyUI(c) { $("spotifyConnectBtn").style.display = c ? "none" : ""; $("spotifyBadge").style.display = c ? "" : "none"; if (c) $("modeSelector").style.display = ""; updateGoButton(); }
function updateGoButton() {
  const user = $("usernameInput").value.trim();
  const base = user && spotifyToken && LASTFM_API_KEY !== "YOUR_LASTFM_API_KEY" && (currentPhase==="idle"||currentPhase==="done"||currentPhase==="error");
  let ok = base;
  if (searchMode === "date") ok = base && $("dateYear").value;
  else if (searchMode === "artist") ok = base && $("artistInput").value.trim();
  $("goBtn").disabled = !ok; $("goBtn").className = "btn btn-primary" + (ok ? " ready" : "");
  const labels = { random: currentPhase==="done" ? "↻ Again" : "Time Travel", date: "Go to Date", artist: "Find Artist", mood: "Find Mood" };
  $("goBtn").textContent = labels[searchMode] || "Time Travel";
}


// ═════════════════════════════════════════════════════════════════════════════
// ERA PANEL
// ═════════════════════════════════════════════════════════════════════════════
function timeAgo(d) { const days=Math.floor((new Date()-d)/864e5),y=Math.floor(days/365),m=Math.floor((days%365)/30); if(y>0&&m>0) return y+" yr"+(y>1?"s":"")+", "+m+" mo"+(m>1?"s":"")+" ago"; if(y>0) return y+" year"+(y>1?"s":"")+" ago"; if(m>0) return m+" month"+(m>1?"s":"")+" ago"; if(days>0) return days+" day"+(days>1?"s":"")+" ago"; return "today"; }
function calcPace(tracks,f,l) { const ms=Math.abs(parseInt(f)-parseInt(l))*1000,h=ms/36e5,d=ms/864e5; if(d>=1){const dd=Math.round(d*10)/10;return{s:Math.round(tracks.length/d)+" scrobbles/day",sub:"across "+(dd<2?dd.toFixed(1):Math.round(dd))+" day"+(dd>=2?"s":"")};} if(h>=1){return{s:tracks.length+" tracks",sub:"in "+(Math.round(h*10)/10).toFixed(1)+" hr"+(h>=2?"s":"")};} const mins=Math.round(ms/6e4); return{s:tracks.length+" tracks",sub:mins>0?"in "+mins+" min"+(mins>1?"s":""):"rapid succession"}; }
function topArtist(tracks) { const c={}; tracks.forEach(t=>{const a=(t.artist&&(t.artist["#text"]||t.artist.name))||"?";c[a]=(c[a]||0)+1;}); const s=Object.entries(c).sort((a,b)=>b[1]-a[1]); return{name:s[0]?s[0][0]:"?",count:s[0]?s[0][1]:0,uniq:s.length}; }

function renderEraPanel(tracks, page, totalPages) {
  const panel=$("eraPanel"), f=tracks[0]&&tracks[0].date&&tracks[0].date.uts, l=tracks[tracks.length-1]&&tracks[tracks.length-1].date&&tracks[tracks.length-1].date.uts;
  if(!f||!l){panel.style.display="none";return;}
  const newest=new Date(parseInt(f)*1000), oldest=new Date(parseInt(l)*1000), same=newest.toDateString()===oldest.toDateString();
  const ds=same?newest.toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"}):oldest.toLocaleDateString("en-US",{year:"numeric",month:"long"});
  const pct=Math.round((page/totalPages)*100), pace=calcPace(tracks,f,l), top=topArtist(tracks);
  cachedTotalPages=totalPages; cachedCurrentPage=page;
  panel.innerHTML='<div class="era-headline"><span class="label">Traveling back to</span><div class="date" id="eraDate">'+ds+'</div><div class="ago" id="eraAgo">'+timeAgo(oldest)+'</div></div>'
    +'<div class="era-timeline"><div class="era-timeline-labels"><span>Now</span><span>First scrobble</span></div>'
    +'<div class="era-timeline-slider-wrap"><input type="range" class="era-timeline-slider" id="timelineSlider" min="1" max="'+totalPages+'" value="'+page+'" style="--slider-pct:'+pct+'%"></div>'
    +'<div class="era-timeline-pct" id="timelinePct">Page '+page.toLocaleString()+' of '+totalPages.toLocaleString()+' · '+pct+'%</div>'
    +'<div class="era-timeline-hint" id="timelineHint">Drag to scrub through time</div></div>'
    +'<div class="era-stats"><div class="era-stat"><div class="era-stat-label">Top artist</div><div class="era-stat-value" id="eraTop"><span class="accent">'+escHtml(top.name)+'</span></div>'
    +'<div class="era-stat-sub" id="eraTopSub">'+top.count+' of '+tracks.length+' · '+top.uniq+' artist'+(top.uniq>1?'s':'')+'</div></div>'
    +'<div class="era-stat"><div class="era-stat-label">Listening pace</div><div class="era-stat-value" id="eraPace">'+pace.s+'</div>'
    +'<div class="era-stat-sub" id="eraPaceSub">'+pace.sub+'</div></div></div>';
  panel.style.display="";
  $("timelineSlider").addEventListener("input", onSliderInput);
  $("timelineSlider").addEventListener("change", onSliderChange);
}
function updateEraInfo(tracks,page,tp) {
  const f=tracks[0]&&tracks[0].date&&tracks[0].date.uts, l=tracks[tracks.length-1]&&tracks[tracks.length-1].date&&tracks[tracks.length-1].date.uts;
  if(!f||!l) return;
  const newest=new Date(parseInt(f)*1000),oldest=new Date(parseInt(l)*1000),same=newest.toDateString()===oldest.toDateString();
  const ds=same?newest.toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"}):oldest.toLocaleDateString("en-US",{year:"numeric",month:"long"});
  const pct=Math.round((page/tp)*100),pace=calcPace(tracks,f,l),top=topArtist(tracks);
  const s=(id,v)=>{const e=$(id);if(e){if(typeof v==="object")e.innerHTML=v.h;else e.textContent=v;e.style.opacity="";}};
  s("eraDate",ds);s("eraAgo",timeAgo(oldest));s("timelinePct","Page "+page.toLocaleString()+" of "+tp.toLocaleString()+" · "+pct+"%");
  s("eraTop",{h:'<span class="accent">'+escHtml(top.name)+'</span>'});s("eraTopSub",top.count+" of "+tracks.length+" · "+top.uniq+" artist"+(top.uniq>1?"s":""));
  s("eraPace",pace.s);s("eraPaceSub",pace.sub);
  const sl=$("timelineSlider"); if(sl&&!isDragging){sl.value=page;sl.style.setProperty("--slider-pct",pct+"%");}
  cachedCurrentPage=page;
}

// ── SLIDER ───────────────────────────────────────────────────────────────────
function onSliderInput(e) {
  isDragging=true; const pg=parseInt(e.target.value),pct=Math.round((pg/cachedTotalPages)*100);
  e.target.style.setProperty("--slider-pct",pct+"%");
  const p=$("timelinePct"); if(p) p.textContent="Page "+pg.toLocaleString()+" of "+cachedTotalPages.toLocaleString()+" · "+pct+"%";
  const h=$("timelineHint"); if(h){h.textContent="Release to load";h.style.opacity="1";}
  const d=$("eraDate"),a=$("eraAgo"); if(d) d.style.opacity="0.3"; if(a){a.textContent="…";a.style.opacity="0.3";}
}
let sliderTimer=null;
function onSliderChange(e) {
  isDragging=false; const pg=parseInt(e.target.value);
  if(pg===cachedCurrentPage){const h=$("timelineHint");if(h){h.textContent="Drag to scrub through time";h.style.opacity="";}const d=$("eraDate"),a=$("eraAgo");if(d)d.style.opacity="";if(a)a.style.opacity="";return;}
  if(sliderTimer) clearTimeout(sliderTimer);
  sliderTimer=setTimeout(()=>loadPageFromSlider(pg),200);
}
async function loadPageFromSlider(pg) {
  const user=$("usernameInput").value.trim(); if(!user||!spotifyToken) return;
  const h=$("timelineHint"); if(h) h.textContent="Loading…";
  cachedCurrentPage=pg;
  if(abortController) abortController.abort();
  stopPolling();
  abortController=new AbortController(); currentPhase="working";
  await fetchAndPlay(user,pg,cachedTotalPages);
  if(h) h.textContent="Drag to scrub through time";
}

// Era panel from tracks (no page number needed)
function renderEraPanelFromTracks(tracks, label, totalPages) {
  const panel = $("eraPanel");
  const f = tracks[0] && tracks[0].date && tracks[0].date.uts;
  const l = tracks[tracks.length-1] && tracks[tracks.length-1].date && tracks[tracks.length-1].date.uts;
  if (!f || !l) { panel.style.display = "none"; return; }
  const newest = new Date(parseInt(f)*1000), oldest = new Date(parseInt(l)*1000);
  const pace = calcPace(tracks, f, l), top = topArtist(tracks);
  cachedTotalPages = totalPages;
  panel.innerHTML = '<div class="era-headline"><span class="label">Traveling back to</span><div class="date" id="eraDate">'+escHtml(label)+'</div>'
    +'<div class="ago" id="eraAgo">'+timeAgo(oldest)+'</div></div>'
    +'<div class="era-stats"><div class="era-stat"><div class="era-stat-label">Top artist</div><div class="era-stat-value"><span class="accent">'+escHtml(top.name)+'</span></div>'
    +'<div class="era-stat-sub">'+top.count+' of '+tracks.length+' · '+top.uniq+' artist'+(top.uniq>1?'s':'')+'</div></div>'
    +'<div class="era-stat"><div class="era-stat-label">Listening pace</div><div class="era-stat-value">'+pace.s+'</div>'
    +'<div class="era-stat-sub">'+pace.sub+'</div></div></div>';
  panel.style.display = "";
}
function handleReset() {
  if (abortController) abortController.abort();
  stopPolling();
  currentPhase = "idle"; matchedUris = {}; allTrackCount = 0; uriToIndices = {};
  skippedPlan = []; isContinuing = false; currentTracks = []; sessionQueue = new Set(); sessionPaused = false;
  endSessionUI();
  $("pagePicker").style.display = "none"; $("eraPanel").style.display = "none";
  $("trackListWrapper").style.display = "none"; hideStatus();
}