const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

global.window = { location: { origin: "http://localhost", pathname: "/" } };
global.document = { getElementById: () => null };
const load = f => vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), { filename: f });
const run = code => vm.runInThisContext(code);
load("config.js");
load("radio.js");

function reset() {
  run("matchedUris = {}; allTrackCount = 0; uriToIndices = {}; totalMatched = 0; trackMeta = {}; sessionQueue = new Set(); radioSeen = new Set(); radioTotal = 1000; radioFailures = 0; radioUser = 'tester'; radioActive = true; radioExhausted = false; radioRefilling = false;");
}
const song = n => [{ name: "Song " + n, artist: { "#text": "Artist" }, date: { uts: "1500000000" } }];
const uriFor = name => "spotify:track:" + name.replace(/ /g, "_");

(async () => {
  global.showStatus = () => {};
  global.getSpotifyToken = async () => "token";
  let sleeps = [];
  global.radioSleep = async ms => { sleeps.push(ms); };
  run("function registerUri(u, i) { (uriToIndices[u] = uriToIndices[u] || []).push(i); }");
  global.spotifySearch = async (token, artist, track) => ({ uri: uriFor(track), name: track, album: { images: [] } });

  // 1. fills unique tracks and records bookkeeping
  reset(); let n = 0;
  global.getLastFmScrobbleAt = async () => song(n++);
  assert.equal(await run("radioFill(5)"), 5);
  assert.equal(run("allTrackCount"), 5);
  assert.equal(run("matchedUris[0]"), "spotify:track:Song_0");
  assert.equal(run("sessionQueue.size"), 5);
  const meta0 = run("trackMeta[0]");
  assert.equal(meta0.name, "Song 0");
  assert.ok(meta0.page >= 1 && meta0.page <= 1000);
  assert.equal(meta0.year, 2017);

  // 2. the same scrobble picked twice is queued once
  reset(); const seq = [0, 0, 1, 2]; let c = 0;
  global.getLastFmScrobbleAt = async () => song(seq[c++]);
  assert.equal(await run("radioFill(3)"), 3);
  assert.deepEqual([0, 1, 2].map(i => run("trackMeta[" + i + "].name")), ["Song 0", "Song 1", "Song 2"]);

  // 3. two different scrobbles that resolve to one Spotify URI are queued once
  reset(); c = 0;
  const seq3 = [0, 1, 2, 3];
  global.getLastFmScrobbleAt = async () => song(seq3[c++]);
  global.spotifySearch = async (token, artist, track) => ({ uri: track === "Song 1" ? uriFor("Song 0") : uriFor(track), name: track, album: { images: [] } });
  assert.equal(await run("radioFill(3)"), 3);
  assert.equal(new Set(Object.values(run("matchedUris"))).size, 3);
  global.spotifySearch = async (token, artist, track) => ({ uri: uriFor(track), name: track, album: { images: [] } });

  // 4. a fill that goes stale (Cancel, Back, or a new mode) adds nothing
  reset(); n = 0;
  global.getLastFmScrobbleAt = async () => { run("radioSession++"); return song(n++); };
  assert.equal(await run("radioFill(3)"), 0);
  assert.equal(run("allTrackCount"), 0);

  // 5. Last.fm fails, then recovers: backoff, then the streak resets
  reset(); n = 0; sleeps = []; let fails = 6;
  global.getLastFmScrobbleAt = async () => { if (fails-- > 0) throw new Error("boom"); return song(n++); };
  assert.equal(await run("radioFill(2)"), 2);
  assert.equal(sleeps[0], 1000);
  assert.equal(run("radioFailures"), 0);

  // 6. Last.fm keeps failing: terminates, backoff is capped at 8 seconds
  reset(); sleeps = [];
  global.getLastFmScrobbleAt = async () => { throw new Error("down"); };
  assert.equal(await run("radioFill(3)"), 0);
  assert.ok(run("radioFailures") >= 3);
  assert.equal(Math.max(...sleeps), 8000);

  // 7. a library with one unique track: terminates and returns what it found
  reset(); sleeps = [];
  global.getLastFmScrobbleAt = async () => song(0);
  assert.equal(await run("radioFill(3)"), 1);
  assert.equal(run("radioFailures"), 0);

  // 8. radioMaybeRefill records the now-playing uri and position
  reset();
  run("matchedUris = { 0: 'a', 1: 'b' }; allTrackCount = 2; radioRefilling = true;");
  run("radioMaybeRefill('a', 4200)");
  assert.equal(run("radioCurrentUri"), "a");
  assert.equal(run("radioLastPos"), 4200);

  console.log("radio engine: ok");
})().catch(e => { console.error(e); process.exit(1); });
