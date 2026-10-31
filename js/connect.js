// === Play on: Spotify Connect device picker ===
// Pure device-list model. No DOM access at load time (node tests load this file).

const CONNECT_RESTRICTED_LINE = "Spotify doesn't let other apps control it.";

function connectDeviceIcon(type) {
  switch (type) {
    case "Computer": return "ph-desktop";
    case "Smartphone": return "ph-device-mobile";
    case "Speaker": return "ph-speaker-hifi";
    case "CastAudio": return "ph-speaker-simple-high";
    case "TV": return "ph-television";
    case "Automobile": return "ph-car";
    default: return "ph-speaker-high";
  }
}

function connectKind(type) {
  switch (type) {
    case "Computer": return "Computer";
    case "Smartphone": return "Phone";
    case "Speaker": return "Speaker";
    case "CastAudio": return "Speaker group";
    case "TV": return "TV";
    case "Automobile": return "Car";
    default: return "Speaker";
  }
}

// "Sonos. Spotify doesn't let other apps control it." (only Sonos is recognised)
function connectRestrictedLine(device) {
  const first = String((device && device.name) || "").trim().split(/\s+/)[0];
  return /^sonos$/i.test(first) ? "Sonos. " + CONNECT_RESTRICTED_LINE : CONNECT_RESTRICTED_LINE;
}

function connectOnPhone() {
  try { return !!(typeof window !== "undefined" && window.matchMedia && window.matchMedia("(max-width:720px)").matches); }
  catch (e) { return false; }
}

function connectDeviceRows(devices, ctx) {
  ctx = ctx || {};
  const currentId = ctx.currentId || null;
  const mk = (d, name, kind, line, extra) => Object.assign({
    id: d.id, name, type: d.type, kind, line, icon: connectDeviceIcon(d.type),
    current: !!currentId && d.id === currentId, active: !!d.is_active, disabled: false
  }, extra);
  const playing = d => d.is_active ? " \u00b7 playing" : "";
  const own = ctx.sdkReady && ctx.sdkDeviceId ? ctx.sdkDeviceId : null;
  let mine = null, phoneUsed = false;
  const rows = [], restricted = [];
  for (const d of devices || []) {
    if (!d || d.id == null) continue;  // cannot be picked
    if (own && d.id === own) {
      mine = mk(d, "This browser", "Computer", "Computer" + playing(d));
      continue;
    }
    if (d.name === STM_PLAYER_NAME) continue;  // another STM window's player
    if (d.is_restricted) {
      restricted.push(mk(d, d.name, connectKind(d.type), connectRestrictedLine(d), { disabled: true }));
    } else if (ctx.onPhone && d.type === "Smartphone" && !phoneUsed) {
      phoneUsed = true;
      rows.push(mk(d, "This phone", "Phone", "Plays through your Spotify app"));
    } else {
      const kind = connectKind(d.type);
      rows.push(mk(d, d.name, kind, kind + playing(d)));
    }
  }
  if (own && !mine) {
    mine = mk({ id: own, type: "Computer", is_active: false }, "This browser", "Computer", "Computer");
  }
  if (mine) rows.unshift(mine);
  return { rows, restricted };
}

function connectSameRows(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((x, i) => x.id === b[i].id && x.name === b[i].name && x.current === b[i].current
    && x.active === b[i].active && x.disabled === b[i].disabled);
}

// Where "Play on" starts: this browser; on a phone the active device, else its own Spotify app
function connectDefaultDevice(devices, ctx) {
  ctx = ctx || {};
  const { rows } = connectDeviceRows(devices, ctx);
  if (ctx.sdkReady && ctx.sdkDeviceId) return rows.find(r => r.id === ctx.sdkDeviceId) || null;
  if (ctx.onPhone) return rows.find(r => r.active) || rows.find(r => r.name === "This phone") || null;
  return rows.find(r => r.active) || null;
}

// === Picking a device ===
let connectDevices = [];   // the last device list read (a refresh fills it)
let connectBusy = false;   // a pick is in flight

// PUT /me/player: move the session to a device. Resolves to the HTTP status (0 on a network error).
async function connectTransfer(token, id, play) {
  try {
    const res = await fetch("https://api.spotify.com/v1/me/player", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ device_ids: [id], play: !!play })
    });
    return res.status;
  } catch (e) { return 0; }
}

// The device Spotify reports as playing (null: checking). The bar (Task 4) renders it.
let connectCurrent = null;
function connectSetCurrent(device) {
  connectCurrent = device ? { id: device.id, name: device.name, type: device.type } : null;
  if (typeof connectRender === "function") connectRender();
}

// Where the song uri is now, in ms. Call it before the device changes (sdkPlaying() follows playbackDeviceId). A /me/player
// reading only counts when it is of that song and fresh: another song's, or an old one extrapolated, would start it elsewhere
function connectCurrentPosition(uri) {
  if (sdkPlaying()) return _sdkPositionMs || 0;
  const r = remoteNow;
  if (!r || !uri || r.uri !== uri || !(Date.now() - r.at < REMOTE_FRESH_MS)) return 0;
  const pos = Math.max(0, Math.round((r.pos || 0) + (r.playing ? Date.now() - r.at : 0)));
  return r.dur > 0 ? Math.min(pos, r.dur) : pos;
}

async function connectPick(id) {
  if (connectBusy) return false;
  connectBusy = true;
  try {
    // A radio Spotify was sent. Before its first play (the first song is being picked) a pick only sets where it starts
    const sent = radioActive && !!radioContextLastUri;
    // Another window or app has the music (this window shows its radio paused): a pick brings this window's own queue back,
    // even on the device it was on, and never moves their music
    const elsewhere = sent && (sdkInactive || sessionPaused);
    const currentId = playbackDeviceId || (sdkReady ? sdkDeviceId : null);
    if (id === currentId && !elsewhere) { if (typeof connectClose === "function") connectClose(); return true; }
    const token = await getSpotifyToken();
    if (!token) return false;
    let d = connectDevices.find(x => x && x.id === id);
    if (!d) {
      try { d = ((await getSpotifyDevices(token)) || []).find(x => x && x.id === id); } catch (e) { d = null; }
    }
    if (!d) d = { id, name: id === sdkDeviceId ? "this browser" : "that device", type: "" };
    const prev = playbackDeviceId ? { id: playbackDeviceId, name: playbackDeviceName, type: playbackDeviceType } : null;
    const target = id === sdkDeviceId ? null : { id, name: d.name, type: d.type };
    const targetId = target ? target.id : null;
    if (!sent) {
      // Nothing to move, and nothing to read: an idle speaker reads empty, and empty readings are not a reason to drop the pick
      setPlaybackDevice(target);
      connectRenderHome();
      if (typeof connectClose === "function") connectClose();
      return true;
    }
    // Where the music is, read before the device changes
    const cur = sdkPlaying() ? _sdkCurrentUri : radioCurrentUri;
    const pos = connectCurrentPosition(cur);
    const resume = elsewhere ? radioResumePoint() : null;
    setPlaybackDevice(target);
    // This browser: only its own player counts (spotifyPlay would otherwise fall through to another device and report success)
    const opts = target ? undefined : { sdkOnly: true };
    const playFrom = async (uri, at) => {
      const uris = radioUrisFrom(matchedUris, allTrackCount, uri);
      if (!uris.length) return false;
      // spotifyPlay falls back to this browser (and returns true) when the device is not listed: that is not the pick
      return !!(await spotifyPlay(token, uris, at, opts)) && playbackDeviceId === targetId;
    };
    let ok;
    if (elsewhere) {
      ok = await playFrom(resume.last, resume.pos);
      if (ok) { sdkInactive = false; sessionPaused = false; hideStatus(); }
    } else if (radioUnsentUris().length > 0 || radioPendingReissue) {
      ok = await playFrom(cur, pos);
    } else {
      const status = await connectTransfer(token, id, !radioPaused);
      ok = status >= 200 && status < 300;
      if (ok) await spotifyResetPlayMode(token, id);
    }
    if (ok) {
      remoteNow = null;  // that reading was of the other device: the next one (pollSoon below) is of this one
      if (!pollTimer) startPolling();
      if (typeof connectClose === "function") connectClose();
    } else {
      setPlaybackDevice(prev);
      showStatus("Couldn't play on " + d.name + ". Play something on it from the Spotify app, then try again.", "error");
      if (typeof connectRefresh === "function") connectRefresh(false);
    }
    pollSoon(1500);
    return ok;
  } finally { connectBusy = false; }
}

// === The bar, the list, the Home row and the phone strip ===
const CONNECT_REFRESH_MS = 4000;  // the open list re-reads the devices this often
let connectOpenFrom = null;       // the Change button that opened the list (focus goes back to it)
let connectTimer = null;          // the open list's quiet refresh
let connectLoaded = false;        // a device list has been read at least once
let connectShown = null;          // what the open list shows: { rows, restricted }
let connectRefreshing = false, connectRefreshAgain = false;
let connectWantFocus = false;     // opened before any row could take the focus: the first rows to arrive take it

function connectEsc(s) { return typeof escHtml === "function" ? escHtml(s) : String(s); }

// One row of the list: a button, pressed for the current device, disabled when Spotify does not let us play there
function connectRowHtml(row, esc) {
  esc = esc || (s => String(s));
  const attr = s => String(esc(String(s == null ? "" : s))).replace(/"/g, "&quot;");
  let line = row.line || "";
  if (row.active && !row.disabled && !/playing$/.test(line)) line += " · playing";  // "This phone" keeps its own line
  const cls = "connect-row" + (row.current ? " current" : "") + (row.active ? " active" : "");
  return '<button type="button" class="' + cls + '" data-id="' + attr(row.id) + '" aria-pressed="' + (row.current ? "true" : "false") + '"' + (row.disabled ? " disabled" : "") + ">"
    + '<i class="ph ' + attr(row.icon || "ph-speaker-high") + ' connect-row-icon" aria-hidden="true"></i>'
    + '<span class="connect-row-text"><span class="connect-row-name">' + esc(row.name || "") + '</span><span class="connect-row-line">' + esc(line) + "</span></span>"
    + (row.current ? '<i class="ph ph-check connect-row-check" aria-hidden="true"></i>' : "")
    + "</button>";
}

// The device a pick is measured against (connectPick's rule), else where the next radio would start
function connectPickedId() {
  if (playbackDeviceId) return playbackDeviceId;
  if (sdkReady && sdkDeviceId) return sdkDeviceId;
  const d = connectDefaultDevice(connectDevices, { sdkDeviceId, sdkReady, onPhone: connectOnPhone() });
  return d ? d.id : null;
}
function connectCtx() { return { sdkDeviceId, sdkReady, onPhone: connectOnPhone(), currentId: connectPickedId() }; }

// Home "Plays on": the picked or followed device; this browser; the default of the last list read; the phone's own app
function connectHomeTarget() {
  const onPhone = connectOnPhone();
  if (playbackDeviceId) {
    const row = connectDeviceRows(connectDevices, { sdkDeviceId, sdkReady, onPhone }).rows.find(r => r.id === playbackDeviceId);
    return row ? { name: row.name, type: row.type } : { name: playbackDeviceName || "that device", type: playbackDeviceType || "" };
  }
  if (sdkReady) return { name: "This browser", type: "Computer" };
  const d = connectDefaultDevice(connectDevices, { sdkDeviceId, sdkReady, onPhone });
  if (d) return { name: d.name, type: d.type };
  // a desktop whose player is not ready yet plays here in a moment
  return onPhone ? { name: "Spotify on this phone", type: "Smartphone" } : { name: "This browser", type: "Computer" };
}

function connectSetText(id, t) { const el = $(id); if (el) el.textContent = t; }

// The bar (what Spotify reports) and the Home row (where the next radio starts)
function connectRender() {
  connectRenderBar();
  connectRenderHome();
}
function connectRenderBar() {
  const bar = $("connectBar");
  if (!bar) return;
  const d = connectCurrent, own = !!(d && sdkDeviceId && d.id === sdkDeviceId);
  if (bar.classList) bar.classList.toggle("checking", !d);
  connectSetText("connectBarName", d ? (own ? "This browser" : d.name || "Another device") : "Checking what's playing…");
  connectSetText("connectBarKind", d ? " · " + connectKind(own ? "Computer" : d.type) : "");
  const ic = $("connectBarIcon");
  if (ic) ic.className = "ph " + (d ? connectDeviceIcon(own ? "Computer" : d.type) : "ph-speaker-high") + " connect-bar-icon";
}
function connectRenderHome() {
  if (!$("connectHomeRow")) return;
  const t = connectHomeTarget();
  connectSetText("connectHomeName", t.name);
  const ic = $("connectHomeIcon");
  if (ic) ic.className = "ph " + connectDeviceIcon(t.type) + " connect-home-icon";
}

function connectIsOpen() { const l = $("connectList"); return !!(l && !l.hidden); }

// Change: a dropdown under the bar or the Home row; on a phone a bottom sheet over a scrim
function connectOpen(fromEl) {
  const list = $("connectList");
  if (!list) return;
  if (connectIsOpen()) {
    const same = connectOpenFrom === fromEl;
    connectClose(true);
    if (same) { if (fromEl && fromEl.focus) fromEl.focus(); return; }  // a second tap on Change closes it
  }
  connectOpenFrom = fromEl || null;
  const phone = connectOnPhone();
  const anchor = !phone && fromEl && fromEl.closest ? fromEl.closest(".connect-anchor") : null;
  (anchor || document.body).appendChild(list);
  list.classList.toggle("sheet", phone);
  list.setAttribute("aria-modal", phone ? "true" : "false");
  const scrim = $("connectScrim");
  if (scrim) scrim.hidden = !phone;
  if (phone) document.body.classList.add("connect-locked");
  list.hidden = false;
  if (fromEl) fromEl.setAttribute("aria-expanded", "true");
  connectShown = null;
  connectRenderList();
  connectFocusFirst();
  connectWantFocus = !list.querySelector(".connect-row:not([disabled])");
  connectReveal(list);
  list.onanimationend = () => { if (!list.hidden) connectReveal(list); };  // the page only scrolls that far once the list is full size
  connectRefresh(false);
  clearInterval(connectTimer);
  connectTimer = setInterval(connectTick, CONNECT_REFRESH_MS);
}

// Escape, a scrim tap, a pick, Change again: close, and give the focus back to Change (noFocus: the user went elsewhere)
function connectClose(noFocus) {
  clearInterval(connectTimer); connectTimer = null;
  const list = $("connectList");
  if (!list || list.hidden) return;
  list.hidden = true;
  const scrim = $("connectScrim");
  if (scrim) scrim.hidden = true;
  if (document.body) document.body.classList.remove("connect-locked");
  const from = connectOpenFrom;
  connectOpenFrom = null;
  connectWantFocus = false;
  if (from) {
    from.setAttribute("aria-expanded", "false");
    if (!noFocus && from.focus) from.focus();
  }
  connectRender();
}

// Scroll the page so the whole dropdown shows (from the layout box: the opening animation scales the drawn one)
function connectReveal(list) {
  if (connectOnPhone() || !list.offsetParent || typeof window.scrollBy !== "function") return;
  const top = list.offsetParent.getBoundingClientRect().top + list.offsetTop;
  const over = top + list.offsetHeight + 16 - window.innerHeight;
  if (over > 0) window.scrollBy(0, Math.min(over, top - 16));
}

function connectFocusFirst() {
  const list = $("connectList");
  if (!list) return;
  const el = list.querySelector(".connect-row:not([disabled])") || $("connectRefreshBtn");
  if (el && el.focus) el.focus();
}

function connectRenderList() {
  const box = $("connectRows");
  if (!box) return;
  const ctx = connectCtx();
  const shown = connectDeviceRows(connectDevices, ctx);
  const act = document.activeElement;
  const focusedId = act && box.contains(act) && act.getAttribute ? act.getAttribute("data-id") : null;
  let html = shown.rows.map(r => connectRowHtml(r, connectEsc)).join("");
  if (!shown.rows.length && connectLoaded && ctx.onPhone) {
    html += '<p class="connect-empty">No devices found. Open Spotify on this phone or on a speaker, then Refresh.</p>';
  }
  if (shown.restricted.length) {
    html += '<div class="connect-sep" aria-hidden="true"></div><h3 class="connect-group">Can\'t play from here</h3>'
      + shown.restricted.map(r => connectRowHtml(r, connectEsc)).join("");
  }
  box.innerHTML = html;
  connectShown = shown;
  if (focusedId != null) {  // a rebuild must not drop the focus
    const el = Array.from(box.querySelectorAll(".connect-row")).find(b => b.getAttribute("data-id") === focusedId);
    if (el && !el.disabled) el.focus(); else connectFocusFirst();
  } else if (connectWantFocus && box.querySelector(".connect-row:not([disabled])")) {
    connectWantFocus = false;
    const list = $("connectList");
    if (list && list.contains(document.activeElement)) connectFocusFirst();  // only if the focus is still in the list (on Refresh)
    if (list) connectReveal(list);
  }
}

// The open list's 4 s tick: closes when the Change that opened it is no longer shown (its view was hidden); a hidden page does not read
function connectAnchorShown() {
  const a = connectOpenFrom;
  return !a || !a.getClientRects || a.getClientRects().length > 0;
}
function connectCheckAnchor() {
  if (connectIsOpen() && !connectAnchorShown()) connectClose(true);
}
function connectTick() {
  if (!connectIsOpen()) { clearInterval(connectTimer); connectTimer = null; return; }
  connectCheckAnchor();
  if (!connectIsOpen() || !pollVisible()) return;
  connectRefresh(true);
}

// GET /me/player/devices for the picker: the devices, or null when the read failed (getSpotifyDevices returns [] then)
async function connectReadDevices(token) {
  try {
    const r = await fetch("https://api.spotify.com/v1/me/player/devices", { headers: { Authorization: "Bearer " + token } });
    if (!r || !r.ok) return null;
    const j = await r.json();
    return j && Array.isArray(j.devices) ? j.devices : [];
  } catch (e) { return null; }
}

// Read the device list. Quiet (the 4 s timer): rebuild only when the rows changed, so a tap never lands on a row that moved
async function connectRefresh(quiet) {
  if (connectRefreshing) { if (!quiet) connectRefreshAgain = true; return; }
  if (quiet && connectBusy) return;
  connectRefreshing = true;
  const btn = $("connectRefreshBtn");
  if (!quiet && btn && btn.classList) btn.classList.add("busy");
  try {
    const token = await getSpotifyToken();
    if (!token) return;
    const devices = await connectReadDevices(token);
    if (!devices) return;  // a failed read is not an empty list: keep what is shown
    connectDevices = devices;
    connectLoaded = true;
    connectRenderHome();
    if (!connectIsOpen()) return;
    if (quiet && connectShown) {
      const next = connectDeviceRows(connectDevices, connectCtx());
      if (connectSameRows(connectShown.rows, next.rows) && connectSameRows(connectShown.restricted, next.restricted)) return;
    }
    connectRenderList();
  } finally {
    connectRefreshing = false;
    if (btn && btn.classList) btn.classList.remove("busy");
    if (connectRefreshAgain) { connectRefreshAgain = false; connectRefresh(false); }
  }
}

function connectRowClick(e) {
  const row = e && e.target && e.target.closest ? e.target.closest(".connect-row") : null;
  if (!row || row.disabled || connectBusy) return;
  row.classList.add("busy");
  row.setAttribute("aria-busy", "true");
  connectPick(row.getAttribute("data-id")).finally(() => { row.classList.remove("busy"); row.removeAttribute("aria-busy"); });
}

// === Phone home: what plays on another device (a speaker, the phone's own app), with Pause / Play and Next ===
let connectStripReading = null;  // the strip's last /me/player reading (its controls are built from it)
let _connectHomeBusy = false, _connectHomeSoon = null;
function connectHomeShows() {
  const card = $("homeCard"), view = $("homeView");
  return !!(card && view && card.style.display !== "none" && view.style.display !== "none");
}
async function connectHomeTick() {
  connectRenderHome();
  if (!$("connectNowOn")) return;
  if (radioActive || !spotifyToken || !connectOnPhone()) { connectStripShow(null); return; }
  if (!connectHomeShows() || !pollVisible() || _connectHomeBusy) return;
  _connectHomeBusy = true;
  try {
    const token = await getSpotifyToken();
    if (!token) return;
    if (!connectLoaded) connectRefresh(true);  // one device list read, for the Home row's default
    const data = await getCurrentlyPlaying(token);
    if (connectStripShows(data)) await connectStripNote(data);
    connectStripShow(data);
  } finally { _connectHomeBusy = false; }
}
// Hand-off (part 2): Open radio shows when the song the strip shows is in the session note. The note is re-read at most every
// HANDOFF_FOLLOW_MS while the strip shows, and at once when the reported song changes. (handoff.js loads after this file.)
let connectNoteAt = 0, connectNoteUri = null;
async function connectStripNote(data) {
  if (typeof handoffRefreshNote !== "function") return;
  const uri = data.item.uri;
  if (uri === connectNoteUri && Date.now() - connectNoteAt < HANDOFF_FOLLOW_MS) return;
  connectNoteUri = uri; connectNoteAt = Date.now();
  await handoffRefreshNote();
}
// The strip shows music that plays on another device (not this browser's player)
function connectStripShows(data) {
  const d = data && data.device;
  return !!(d && data.item && !(sdkDeviceId && d.id === sdkDeviceId));
}
function connectHomeSoon(ms) {
  clearTimeout(_connectHomeSoon);
  _connectHomeSoon = setTimeout(() => { _connectHomeSoon = null; connectHomeTick(); }, ms);
}
function connectStripShow(data) {
  const strip = $("connectNowOn");
  if (!strip) return;
  const d = data && data.device, item = data && data.item;
  const show = connectStripShows(data);
  connectStripReading = show ? data : null;
  strip.hidden = !show;
  if (!show) return;
  const open = $("connectNowOpen");
  if (open) open.hidden = !(typeof handoffNoteHas === "function" && handoffNoteHas(item.uri));
  connectSetText("connectNowDevice", d.name || "another device");
  const artists = (item.artists || []).map(a => a && a.name).filter(Boolean).join(", ");
  connectSetText("connectNowTrack", (item.name || "") + (artists ? " · " + artists : ""));
  const ic = $("connectNowIcon");
  if (ic) ic.className = "ph " + connectDeviceIcon(d.type) + " connect-now-icon";
  const btn = $("connectNowToggle");
  if (btn) {
    btn.setAttribute("aria-label", data.is_playing ? "Pause" : "Play");
    btn.innerHTML = '<i class="ph-fill ' + (data.is_playing ? "ph-pause" : "ph-play") + '" aria-hidden="true"></i>';
  }
}
// The strip's controls act on the reading it shows (not radioPaused: that belongs to a radio this window does not run)
async function connectNowControl(action) {
  const r = connectStripReading;
  if (!r) return;
  const req = radioTransportRequest(action, !r.is_playing);
  if (!req) return;
  const token = await getSpotifyToken();
  if (!token) return;
  try { await fetch("https://api.spotify.com/v1" + req.path, { method: req.method, headers: { Authorization: "Bearer " + token } }); } catch (e) {}
  if (action === "toggle" && connectStripReading === r) { r.is_playing = !r.is_playing; connectStripShow(r); }
  connectHomeSoon(1500);  // re-read the strip (pollSoon reads for a radio, which this window does not run)
}

function connectStopTimers() {
  clearInterval(connectTimer); connectTimer = null;
  clearTimeout(_connectHomeSoon); _connectHomeSoon = null;
}

if (typeof window !== "undefined" && window.addEventListener && typeof document !== "undefined" && document.addEventListener) {
  // A window that comes back to the front re-reads when its radio plays on another device (and the phone strip)
  document.addEventListener("visibilitychange", () => {
    if (!pollVisible()) return;
    if (radioActive && !sdkPlaying()) pollNowPlaying();
    connectHomeTick();
    if (connectIsOpen()) connectTick();  // the open list was not read while hidden: once now
  });
  setInterval(connectHomeTick, POLL_INTERVAL);
  document.addEventListener("DOMContentLoaded", () => { connectRender(); connectHomeTick(); });
  // The dropdown closes on a tap or a focus outside it; the sheet keeps the focus inside
  document.addEventListener("pointerdown", e => {
    if (!connectIsOpen() || connectOnPhone()) return;
    const list = $("connectList");
    if (list.contains(e.target) || (connectOpenFrom && connectOpenFrom.contains(e.target))) return;
    connectClose(true);
  });
  document.addEventListener("focusin", e => {
    if (!connectIsOpen()) return;
    const list = $("connectList");
    if (list.contains(e.target) || (connectOpenFrom && connectOpenFrom.contains(e.target))) return;
    if (connectOnPhone()) connectFocusFirst(); else connectClose(true);
  });
  // Crossing the phone breakpoint turns the dropdown into a sheet or back: close rather than show the wrong one
  try { window.matchMedia("(max-width:720px)").addEventListener("change", () => connectClose(true)); } catch (e) {}
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { connectDeviceRows, connectDeviceIcon, connectRestrictedLine, connectSameRows, connectDefaultDevice, connectOnPhone, connectPick, connectTransfer, connectSetCurrent, connectCurrentPosition,
    connectRowHtml, connectOpen, connectClose, connectRefresh, connectRender, connectHomeTick, connectHomeTarget, connectNowControl, connectTick, connectCheckAnchor };
}
