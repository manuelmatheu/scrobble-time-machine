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

  // === the list's rows ===
  const html = connectRowHtml(connectDeviceRows([dev("k", "Kitchen", "Speaker", { is_active: true })], ctx).rows[1], s => s);
  assert.match(html, /Kitchen/); assert.match(html, /aria-pressed="false"/); assert.match(html, /min-height|connect-row/);
  const off = connectRowHtml(connectDeviceRows([dev("s", "Sonos Den", "Speaker", { is_restricted: true })], ctx).restricted[0], s => s);
  assert.match(off, /disabled/);
  // the current device is pressed; an active phone row still says it is playing
  assert.match(connectRowHtml(connectDeviceRows([], ctx).rows[0], s => s), /aria-pressed="true"/);
  const phoneRow = connectDeviceRows([dev("p", "Pixel 9", "Smartphone", { is_active: true })], { onPhone: true }).rows[0];
  assert.match(connectRowHtml(phoneRow, s => s), /Plays through your Spotify app · playing/);
  // a quote in an id cannot break out of the attribute
  assert.doesNotMatch(connectRowHtml({ id: 'a"b', name: "X", line: "Speaker", icon: "ph-speaker-high" }, s => s), /data-id="a"b"/);

  // === picking a device ===
  const run = code => vm.runInThisContext(code);
  const fetches = [], plays = [], toasts = [], soon = [];
  let fetchStatus = 200, slowFetch = false, spotifyPlayOk = true;
  global.fetch = async (url, opts) => {
    fetches.push({ url, method: opts && opts.method, body: opts && opts.body });
    if (slowFetch) await new Promise(r => setTimeout(r, 20));
    return { ok: fetchStatus >= 200 && fetchStatus < 300, status: fetchStatus };
  };
  global.spotifyPlay = async (token, uris, pos) => { plays.push({ uris, pos }); return spotifyPlayOk; };
  global.spotifyResetPlayMode = async () => {};
  global.getSpotifyToken = async () => "tok";
  global.showStatus = (msg, kind) => toasts.push([msg, kind]);
  global.pollSoon = ms => soon.push(ms);
  global.getSpotifyDevices = async () => [dev("k", "Kitchen", "Speaker")];
  function setupRadio(o) {
    fetches.length = 0; plays.length = 0; fetchStatus = 200; slowFetch = false; spotifyPlayOk = true;
    run(`radioActive = true; sdkReady = false; playbackDeviceId = null; connectBusy = false; connectDevices = [];
      matchedUris = { 0: "spotify:track:a", 1: "spotify:track:b", 2: "spotify:track:c" }; allTrackCount = 3;
      radioContextLastUri = ${o.unsent ? '"spotify:track:b"' : '"spotify:track:c"'}; radioPendingReissue = false;
      radioCurrentUri = ${JSON.stringify(o.current || "spotify:track:b")}; radioPaused = ${!!o.paused};
      remoteNow = { uri: radioCurrentUri, pos: ${o.pos || 0}, dur: 200000, playing: false, at: Date.now() };`);
  }
  // no radio: the pick only sets the device
  run("radioActive = false; playbackDeviceId = null; connectBusy = false;");
  assert.equal(await connectPick("k"), true);
  assert.equal(run("playbackDeviceId"), "k"); assert.equal(fetches.length, 0); assert.equal(plays.length, 0);
  // radio with unsent songs: a full play from the current song at the current position
  setupRadio({ unsent: true, current: "spotify:track:b", pos: 42000 });
  await connectPick("k");
  assert.deepEqual(plays[0].uris, ["spotify:track:b", "spotify:track:c"]); assert.equal(plays[0].pos, 42000);
  // radio with nothing unsent: a transfer that keeps the play state
  setupRadio({ unsent: false, paused: true });
  await connectPick("k");
  assert.deepEqual(JSON.parse(fetches[0].body), { device_ids: ["k"], play: false });
  // failure: previous device back, the exact toast
  setupRadio({ unsent: false }); fetchStatus = 404;
  assert.equal(await connectPick("k"), false);
  assert.equal(run("playbackDeviceId"), null);
  assert.deepEqual(toasts.at(-1), ["Couldn't play on Kitchen. Play something on it from the Spotify app, then try again.", "error"]);
  // a failed full play too
  setupRadio({ unsent: true }); spotifyPlayOk = false;
  assert.equal(await connectPick("k"), false); assert.equal(run("playbackDeviceId"), null);
  // spotifyPlay falling back to this browser (device not listed) is a failed pick
  setupRadio({ unsent: true }); run("playbackDeviceId = 'z'; playbackDeviceName = 'Den'; playbackDeviceType = 'TV';");
  const realPlay = global.spotifyPlay;
  global.spotifyPlay = async () => { run("setPlaybackDevice(null);"); return true; };
  assert.equal(await connectPick("k"), false);
  assert.equal(run("playbackDeviceId"), "z");
  assert.deepEqual(toasts.at(-1), ["Couldn't play on Kitchen. Play something on it from the Spotify app, then try again.", "error"]);
  global.spotifyPlay = realPlay;
  // the current device sends nothing
  setupRadio({ unsent: false }); run("playbackDeviceId = 'k';");
  assert.equal(await connectPick("k"), true); assert.equal(fetches.length + plays.length, 0);
  // this browser means no followed device
  setupRadio({ unsent: false }); run("sdkReady = true; sdkDeviceId = 'me'; playbackDeviceId = 'k';");
  await connectPick("me"); assert.equal(run("playbackDeviceId"), null); run("sdkReady = false; sdkDeviceId = null;");
  // a second tap while the first is in flight sends one request
  setupRadio({ unsent: false }); slowFetch = true;
  await Promise.all([connectPick("k"), connectPick("k")]); assert.equal(fetches.length, 1);
  // every pick re-reads soon
  assert.ok(soon.length > 0 && soon.every(ms => ms === 1500));
  // position: remote reading extrapolated while playing
  run("remoteNow = { pos: 1000, at: Date.now() - 500, playing: true };");
  const cp = connectCurrentPosition(); assert.ok(cp >= 1500 && cp < 2000);

  // === what's playing is always true ===
  let readings = [];
  global.getCurrentlyPlaying = async () => readings.length ? readings.shift() : null;
  const els = {};
  ["radioTrack", "radioArtist", "radioArt", "radioPlay", "radioElapsed", "radioDuration", "radioFill"].forEach(n => {
    els[n] = { textContent: "", innerHTML: "", style: {}, removeAttribute() {}, classList: { add() {}, remove() {} } };
  });
  global.document.getElementById = id => els[id] || null;
  const heroText = () => els.radioTrack.textContent;
  // the bar shows the device Spotify reports, even for music that is not the radio
  setupRadio({}); readings = [{ item: { uri: "spotify:track:zzz", duration_ms: 1 }, device: { id: "k", name: "Kitchen", type: "Speaker" }, is_playing: true }];
  await run("pollNowPlayingOnce()");
  assert.equal(run("connectCurrent.id"), "k");
  assert.equal(run("connectCurrent.name"), "Kitchen");
  // two empty readings: the neutral hero, never the old song
  setupRadio({}); readings = [null, null]; els.radioTrack.textContent = "Old song";
  await run("pollNowPlayingOnce()"); assert.notEqual(heroText(), "Checking what's playing\u2026");
  await run("pollNowPlayingOnce()"); assert.equal(heroText(), "Checking what's playing\u2026");
  assert.equal(run("connectCurrent"), null);
  assert.equal(run("radioHeroLive"), false);
  // a hidden page with no radio does not poll; a hidden radio window does
  run("radioActive = false;"); global.document.visibilityState = "hidden"; fetches.length = 0;
  let asked = 0; global.getCurrentlyPlaying = async () => { asked++; return null; };
  await run("pollNowPlaying()"); assert.equal(asked, 0);
  setupRadio({}); await run("pollNowPlaying()"); assert.equal(asked, 1);
  global.document.visibilityState = "visible";
  assert.equal(run("pollVisible()"), true);

  // === Home: where the next radio plays, and the phone strip ===
  run("playbackDeviceId = 'k'; playbackDeviceName = 'Kitchen'; playbackDeviceType = 'Speaker'; sdkReady = true; sdkDeviceId = 'me';");
  assert.equal(connectHomeTarget().name, "Kitchen");
  run("playbackDeviceId = null;");
  assert.equal(connectHomeTarget().name, "This browser");
  run("sdkReady = false; sdkDeviceId = null; connectDevices = [];");
  assert.equal(connectHomeTarget().name, "This browser");  // a desktop whose player is not ready yet
  global.window.matchMedia = () => ({ matches: true });  // a phone
  assert.equal(connectHomeTarget().name, "Spotify on this phone");
  run("connectDevices = [{ id: 'k', name: 'Kitchen', type: 'Speaker', is_active: true }];");
  assert.equal(connectHomeTarget().name, "Kitchen");
  run("connectDevices = [];"); delete global.window.matchMedia;
  // the strip's Pause / Play come from its own reading, not from radioPaused
  fetches.length = 0; run("radioPaused = true; connectStripReading = { is_playing: true, device: { id: 'k' }, item: {} };");
  await connectNowControl("toggle");
  assert.match(fetches.at(-1).url, /\/me\/player\/pause$/); assert.equal(fetches.at(-1).method, "PUT");
  run("connectStripReading = { is_playing: false, device: { id: 'k' }, item: {} };");
  await connectNowControl("toggle");
  assert.match(fetches.at(-1).url, /\/me\/player\/play$/);
  await connectNowControl("next");
  assert.match(fetches.at(-1).url, /\/me\/player\/next$/); assert.equal(fetches.at(-1).method, "POST");
  // Home's "Playing now" line drops the old song too when nothing can be vouched for
  els.radioPlayingTrack = { textContent: "Old song", style: {} };
  run("radioMinimized = true;"); radioShowChecking();
  assert.equal(els.radioPlayingTrack.textContent, "Checking what's playing…");
  run("radioMinimized = false;");

  // === the open list: hidden pages do not read, a failed read keeps the rows, a hidden anchor closes it ===
  const devReads = () => fetches.filter(f => /\/me\/player\/devices$/.test(f.url)).length;
  let shownRect = [1];
  global.__opener = { getClientRects: () => shownRect, setAttribute() {}, focus() {} };
  els.connectList = { hidden: false, contains: () => false, querySelector: () => null };
  els.connectRows = { innerHTML: "ROWS", contains: () => false, querySelectorAll: () => [] };
  run("connectOpenFrom = globalThis.__opener; connectBusy = false; connectRefreshing = false; sdkReady = false; playbackDeviceId = null;");
  run("connectDevices = [{ id: 'k', name: 'Kitchen', type: 'Speaker', is_active: true }]; connectShown = connectDeviceRows(connectDevices, connectCtx());");
  // a hidden page: the 4 s tick reads nothing
  global.document.visibilityState = "hidden"; fetches.length = 0;
  connectTick(); await new Promise(r => setTimeout(r, 10));
  assert.equal(devReads(), 0);
  global.document.visibilityState = "visible";
  // a failed read (429 / 5xx) keeps the devices and the rows shown
  fetchStatus = 503;
  await connectRefresh(true);
  assert.equal(devReads(), 1);
  assert.deepEqual(run("connectDevices.map(d => d.id)"), ["k"]);
  assert.equal(els.connectRows.innerHTML, "ROWS");
  fetchStatus = 200;
  // the view holding the Change was hidden: the list closes and its timer stops
  run("connectTimer = setInterval(() => {}, 100000);");
  shownRect = [];
  connectTick();
  assert.equal(els.connectList.hidden, true);
  assert.equal(run("connectTimer"), null);
  delete els.connectList; delete els.connectRows;
  connectStopTimers();

  stopPolling();  // a successful pick starts the poll interval
  console.log("connect: ok");
})().catch(e => { console.error(e); process.exit(1); });
