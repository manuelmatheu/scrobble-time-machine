const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

global.window = { location: { origin: "http://localhost", pathname: "/" } };
global.document = { getElementById: () => null, createElement: () => ({ set textContent(v) { this.t = String(v); }, get innerHTML() { return this.t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); } }) };  // enough for escHtml
const load = f => vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), { filename: f });
["config.js", "radio.js", "spotify.js", "ui.js", "player.js", "connect.js"].forEach(load);

(async () => {
  // === device list model ===
  const dev = (id, name, type, extra) => Object.assign({ id, name, type, is_active: false, is_restricted: false }, extra);
  const ctx = { sdkDeviceId: "me", sdkReady: true, onPhone: false, currentId: "me" };
  // this browser first even when Spotify has not listed it yet; other STM players left out
  let r = connectDeviceRows([dev("k", "Kitchen", "Speaker"), dev("o", STM_PLAYER_NAME, "Computer")], ctx);
  assert.deepEqual(r.rows.map(x => x.id), ["me", "k"]);
  assert.equal(r.rows[0].name, "This browser"); assert.equal(r.rows[0].current, true);
  // our own SDK device listed by Spotify appears once
  r = connectDeviceRows([dev("me", STM_PLAYER_NAME, "Computer", { is_active: true }), dev("k", "Kitchen", "Speaker")], ctx);
  assert.deepEqual(r.rows.map(x => x.id), ["me", "k"]);
  assert.match(r.rows[0].line, /playing/);
  // restricted devices go to their own group, disabled, with the brand line
  r = connectDeviceRows([dev("s", "Living Room", "Speaker", { is_restricted: true, name: "Sonos Living Room" })], ctx);
  assert.equal(r.rows.length, 1); assert.equal(r.restricted[0].disabled, true);
  assert.equal(r.restricted[0].line, "Sonos. Spotify doesn't let other apps control it.");
  assert.equal(connectRestrictedLine(dev("x", "Den", "TV", { is_restricted: true })), "Spotify doesn't let other apps control it.");
  // on a phone its own Spotify app is "This phone"
  r = connectDeviceRows([dev("p", "Pixel 9", "Smartphone")], { sdkDeviceId: null, sdkReady: false, onPhone: true, currentId: null });
  assert.equal(r.rows[0].name, "This phone"); assert.equal(r.rows[0].line, "Plays through your Spotify app");
  // defaults: this browser; on a phone the active device, else its own app
  assert.equal(connectDefaultDevice([], ctx).id, "me");
  assert.equal(connectDefaultDevice([dev("p", "Pixel", "Smartphone"), dev("k", "Kitchen", "Speaker", { is_active: true })], { sdkReady: false, onPhone: true }).id, "k");
  assert.equal(connectDefaultDevice([dev("p", "Pixel", "Smartphone")], { sdkReady: false, onPhone: true }).id, "p");
  assert.equal(connectDefaultDevice([], { sdkReady: false, onPhone: true }), null);
  // quiet refresh: unchanged lists compare equal, a new active device does not
  const a = connectDeviceRows([dev("k", "Kitchen", "Speaker")], ctx).rows;
  assert.equal(connectSameRows(a, connectDeviceRows([dev("k", "Kitchen", "Speaker")], ctx).rows), true);
  assert.equal(connectSameRows(a, connectDeviceRows([dev("k", "Kitchen", "Speaker", { is_active: true })], ctx).rows), false);
  // icons, and a device without an id cannot be picked
  assert.equal(connectDeviceIcon("Computer"), "ph-desktop");
  assert.equal(connectDeviceIcon("Smartphone"), "ph-device-mobile");
  assert.equal(connectDeviceIcon("CastAudio"), "ph-speaker-simple-high");
  assert.equal(connectDeviceIcon("Mystery"), "ph-speaker-high");
  assert.deepEqual(connectDeviceRows([dev(null, "Ghost", "Speaker")], ctx).rows.map(x => x.id), ["me"]);
  assert.equal(connectOnPhone(), false);

  console.log("connect: ok");
})().catch(e => { console.error(e); process.exit(1); });
