const assert = require("node:assert/strict");
const r = require("../js/radio.js");

// radioPickPage: uniform over 1..total, both ends reachable
assert.equal(r.radioPickPage(10, () => 0), 1);
assert.equal(r.radioPickPage(10, () => 0.5), 6);
assert.equal(r.radioPickPage(10, () => 0.999999), 10);
assert.equal(r.radioPickPage(1, () => 0.7), 1);

// radioTrackKey
assert.equal(r.radioTrackKey("Radiohead", "Airbag"), "radiohead||airbag");

// radioScrobbleFromTracks
const base = { name: "Airbag", artist: { "#text": "Radiohead" }, album: { "#text": "OK Computer" }, date: { uts: "1500000000" } };
assert.deepEqual(r.radioScrobbleFromTracks([base], 5019), { artist: "Radiohead", track: "Airbag", album: "OK Computer", page: 5019, year: 2017 });
// page 1 carries a now-playing entry first: it must be skipped
const nowPlaying = { name: "Live", artist: { "#text": "X" }, "@attr": { nowplaying: "true" } };
assert.equal(r.radioScrobbleFromTracks([nowPlaying, base], 1).track, "Airbag");
assert.equal(r.radioScrobbleFromTracks([nowPlaying], 1), null);
// a single object instead of an array
assert.equal(r.radioScrobbleFromTracks(base, 7).track, "Airbag");
// empty / missing
assert.equal(r.radioScrobbleFromTracks([], 3), null);
assert.equal(r.radioScrobbleFromTracks(undefined, 3), null);
// artist under .name, no album, no date
assert.deepEqual(r.radioScrobbleFromTracks([{ name: "N", artist: { name: "A" } }], 1), { artist: "A", track: "N", album: "", page: 1, year: null });
// missing artist or name
assert.equal(r.radioScrobbleFromTracks([{ name: "N", artist: {} }], 1), null);
assert.equal(r.radioScrobbleFromTracks([{ artist: { "#text": "A" } }], 1), null);

// radioFormatPage
assert.equal(r.radioFormatPage(5019, 48213, 2017), "Page 5,019 of 48,213, 2017");
assert.equal(r.radioFormatPage(5019, 48213, null), "Page 5,019 of 48,213");

// radioRemaining / radioUrisFrom (matched is sparse and index-keyed)
const matched = { 0: "a", 1: "b", 3: "c" };
assert.equal(r.radioRemaining(matched, 4, "a"), 2);
assert.equal(r.radioRemaining(matched, 4, "b"), 1);
assert.equal(r.radioRemaining(matched, 4, "c"), 0);
assert.equal(r.radioRemaining(matched, 4, "zzz"), Infinity);
assert.deepEqual(r.radioUrisFrom(matched, 4, "b"), ["b", "c"]);
assert.deepEqual(r.radioUrisFrom(matched, 4, null), ["a", "b", "c"]);
assert.deepEqual(r.radioUrisFrom(matched, 4, "zzz"), []);

// radioShouldRefill
const s = { active: true, refilling: false, exhausted: false, remaining: 2 };
assert.equal(r.radioShouldRefill(s, 2), true);
assert.equal(r.radioShouldRefill({ ...s, remaining: 3 }, 2), false);
assert.equal(r.radioShouldRefill({ ...s, refilling: true }, 2), false);
assert.equal(r.radioShouldRefill({ ...s, exhausted: true }, 2), false);
assert.equal(r.radioShouldRefill({ ...s, active: false }, 2), false);
assert.equal(r.radioShouldRefill({ ...s, remaining: Infinity }, 2), false);

// radioCoverUrl (Spotify lists images largest first)
const hit = { album: { images: [{ url: "big" }, { url: "mid" }, { url: "small" }] } };
assert.equal(r.radioCoverUrl(hit), "small");
assert.equal(r.radioCoverUrl(hit, "medium"), "mid");
assert.equal(r.radioCoverUrl({ album: { images: [{ url: "only" }] } }, "medium"), "only");
assert.equal(r.radioCoverUrl({ album: { images: [] } }), "");
assert.equal(r.radioCoverUrl(null), "");

console.log("radio helpers: ok");
