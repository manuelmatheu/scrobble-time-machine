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

// A window that comes back to the front re-reads when its radio plays on another device
if (typeof window !== "undefined" && window.addEventListener && typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("visibilitychange", () => {
    if (pollVisible() && radioActive && !sdkPlaying()) pollNowPlaying();
  });
}

// Where the current song is now, in ms
function connectCurrentPosition() {
  if (sdkPlaying()) return _sdkPositionMs || 0;
  if (remoteNow && remoteNow.playing) return Math.max(0, Math.round(remoteNow.pos + (Date.now() - remoteNow.at)));
  return remoteNow ? Math.max(0, remoteNow.pos || 0) : 0;
}

async function connectPick(id) {
  if (connectBusy) return false;
  connectBusy = true;
  try {
    const currentId = playbackDeviceId || (sdkReady ? sdkDeviceId : null);
    if (id === currentId) { if (typeof connectClose === "function") connectClose(); return true; }
    const token = await getSpotifyToken();
    if (!token) return false;
    let d = connectDevices.find(x => x && x.id === id);
    if (!d) {
      try { d = ((await getSpotifyDevices(token)) || []).find(x => x && x.id === id); } catch (e) { d = null; }
    }
    if (!d) d = { id, name: id === sdkDeviceId ? "this browser" : "that device", type: "" };
    const prev = playbackDeviceId ? { id: playbackDeviceId, name: playbackDeviceName, type: playbackDeviceType } : null;
    const target = id === sdkDeviceId ? null : { id, name: d.name, type: d.type };
    setPlaybackDevice(target);
    let ok = true;
    if (radioActive) {
      const unsent = radioUnsentUris().length > 0 || radioPendingReissue;
      if (unsent) {
        const cur = sdkPlaying() ? _sdkCurrentUri : radioCurrentUri;
        ok = !!(await spotifyPlay(token, radioUrisFrom(matchedUris, allTrackCount, cur), connectCurrentPosition()));
        // spotifyPlay falls back to this browser (and returns true) when the device is not listed: that is not the pick
        if (ok && playbackDeviceId !== (target ? target.id : null)) ok = false;
      } else {
        const status = await connectTransfer(token, id, !radioPaused);
        ok = status >= 200 && status < 300;
        if (ok) await spotifyResetPlayMode(token, id);
      }
    }
    if (ok) {
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

if (typeof module !== "undefined" && module.exports) {
  module.exports = { connectDeviceRows, connectDeviceIcon, connectRestrictedLine, connectSameRows, connectDefaultDevice, connectOnPhone, connectPick, connectTransfer, connectSetCurrent, connectCurrentPosition };
}
