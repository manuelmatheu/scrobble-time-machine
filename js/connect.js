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

if (typeof module !== "undefined" && module.exports) {
  module.exports = { connectDeviceRows, connectDeviceIcon, connectRestrictedLine, connectSameRows, connectDefaultDevice, connectOnPhone };
}
