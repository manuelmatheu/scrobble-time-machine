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

// radioRemoteLeft: ms left in a track from a /me/player reading, extrapolated between polls (another Connect device)
assert.equal(r.radioRemoteLeft({ pos: 100000, dur: 180000, playing: true, at: 1000 }, 6000), 75000);   // 5s since the reading
assert.equal(r.radioRemoteLeft({ pos: 100000, dur: 180000, playing: false, at: 1000 }, 6000), 80000);  // paused: the clock does not run
assert.equal(r.radioRemoteLeft({ pos: 0, dur: 0, playing: true, at: 0 }, 5), null);                    // no duration yet
assert.equal(r.radioRemoteLeft(null, 5), null);

// radioSeamDue: swap new tracks in only at the end of the last queued track
assert.equal(r.radioSeamDue(true, true, 178500, 180000, 1500), true);
assert.equal(r.radioSeamDue(true, true, 10000, 180000, 1500), false);   // mid-song: never
assert.equal(r.radioSeamDue(true, false, 179000, 180000, 1500), false); // not the last track we sent to Spotify
assert.equal(r.radioSeamDue(false, true, 179000, 180000, 1500), false); // nothing pending
assert.equal(r.radioSeamDue(true, true, 0, 0, 1500), false);            // no duration yet

// Discover helpers
assert.deepEqual(r.discoverParseStation({ playlist: [{ name: "A", artists: [{ name: "X" }] }, { name: "", artists: [{ name: "Y" }] }, { name: "B", artists: [] }, null] }), [{ artist: "X", track: "A" }]);
assert.deepEqual(r.discoverParseStation(null), []);
assert.deepEqual(r.discoverParseSimilarArtists({ similarartists: { artist: [{ name: "P" }, { name: "Q" }] } }), ["P", "Q"]);
assert.deepEqual(r.discoverParseSimilarArtists({ similarartists: { artist: { name: "Solo" } } }), ["Solo"]);
assert.deepEqual(r.discoverParseSimilarArtists({}), []);
assert.deepEqual(r.discoverParseTopTracks({ toptracks: { track: [{ name: "T1" }, { name: "T2" }] } }), ["T1", "T2"]);
assert.deepEqual(r.discoverInterleave([1, 2, 3, 4, 5], ["a", "b"], 2), [1, 2, "a", 3, 4, "b", 5]);
assert.deepEqual(r.discoverInterleave([], ["a"], 2), ["a"]);
assert.deepEqual(r.discoverShuffle([1, 2, 3, 4], () => 0).sort(), [1, 2, 3, 4]);
assert.equal(r.discoverVerdict(10, 2), "skip");
assert.equal(r.discoverVerdict(0, 0), "new-artist");
assert.equal(r.discoverVerdict(7, 0), "new-song");
assert.equal(r.discoverVerdict(null, null), "unknown");
assert.equal(r.discoverVerdict(0, null), "new-artist");
assert.match(r.discoverStatsHtml("Band", 0, "new-artist", "Last.fm pick"), /New to you.*never played <strong>Band<\/strong>.*Picked for you by Last\.fm/);
assert.match(r.discoverStatsHtml("Band", 12, "new-song", "Similar to Seed"), /New song.*12 times, never this one.*Similar to <strong>Seed<\/strong>/);
assert.equal(r.discoverStatsHtml("Band", null, "unknown", ""), "");

// Mix pattern
assert.deepEqual([0, 1, 2, 3].map(i => r.mixKindAt("balanced", i)), ["past", "new", "past", "new"]);
assert.deepEqual([0, 1, 2, 3, 4].map(i => r.mixKindAt("mostly-past", i)), ["past", "past", "past", "new", "past"]);
assert.deepEqual([0, 1, 2, 3].map(i => r.mixKindAt("mostly-new", i)), ["new", "new", "new", "past"]);
assert.equal(r.mixKindAt("nonsense", 1), "new");
assert.equal(r.mixKindAt("balanced", -1), "new");

// radioCoverUrl (Spotify lists images largest first)
const hit = { album: { images: [{ url: "big" }, { url: "mid" }, { url: "small" }] } };
assert.equal(r.radioCoverUrl(hit), "small");
assert.equal(r.radioCoverUrl(hit, "medium"), "mid");
assert.equal(r.radioCoverUrl({ album: { images: [{ url: "only" }] } }, "medium"), "only");
assert.equal(r.radioCoverUrl({ album: { images: [] } }), "");
assert.equal(r.radioCoverUrl(null), "");

// radioTransportRequest: REST fallback for the radio controls when the SDK is not driving playback
assert.deepEqual(r.radioTransportRequest("toggle", false), { method: "PUT", path: "/me/player/pause" });
assert.deepEqual(r.radioTransportRequest("toggle", true), { method: "PUT", path: "/me/player/play" });
assert.deepEqual(r.radioTransportRequest("next", false), { method: "POST", path: "/me/player/next" });
assert.deepEqual(r.radioTransportRequest("prev", true), { method: "POST", path: "/me/player/previous" });
assert.equal(r.radioTransportRequest("bogus", false), null);

// radioVolumeIcon: off, minimum, normal, loud
assert.deepEqual([0, 1, 33, 34, 66, 67, 100].map(r.radioVolumeIcon), ["ph-speaker-x", "ph-speaker-none", "ph-speaker-none", "ph-speaker-low", "ph-speaker-low", "ph-speaker-high", "ph-speaker-high"]);

// radioParseBio: Last.fm bio summary (HTML) -> plain text + "Read more" url
const readMore = '<a href="https://www.last.fm/music/Arcade+Fire">Read more on Last.fm</a>';
assert.deepEqual(r.radioParseBio("Arcade Fire is an indie rock band &amp; more. " + readMore), { text: "Arcade Fire is an indie rock band & more.", url: "https://www.last.fm/music/Arcade+Fire" });
assert.deepEqual(r.radioParseBio(""), { text: "", url: "" });
assert.deepEqual(r.radioParseBio(undefined), { text: "", url: "" });
assert.deepEqual(r.radioParseBio(readMore), { text: "", url: "https://www.last.fm/music/Arcade+Fire" });
// only http(s) urls are accepted for the Read more link
assert.deepEqual(r.radioParseBio('Text <a href="javascript:alert(1)">Read more on Last.fm</a>'), { text: "Text", url: "" });
// inline links keep their words; other tags are stripped; entities decoded; whitespace collapsed
assert.equal(r.radioParseBio('Founded by <a href="https://x">Win Butler</a> in 2001.').text, "Founded by Win Butler in 2001.");
assert.equal(r.radioParseBio("Hello <b>world</b>&nbsp;it&#39;s  &quot;ok&quot;\n\nfine<br>next").text, "Hello world it's \"ok\" fine next");
// long bios are cut at a word boundary with an ellipsis
const longText = r.radioParseBio(("word ".repeat(200)).trim()).text;
assert.ok(longText.length <= 603 && longText.endsWith("..."));

// radioPlaysText / radioStatsHtml
assert.equal(r.radioPlaysText(1), "1 time");
assert.equal(r.radioPlaysText(62), "62 times");
assert.equal(r.radioPlaysText(0), "0 times");
assert.equal(r.radioPlaysText(1234), "1,234 times");
assert.equal(r.radioStatsHtml("Arcade Fire", 62, "Ready To Start", 1), "You've listened to <strong>Arcade Fire</strong> 62 times and <strong>Ready To Start</strong> 1 time.");
assert.equal(r.radioStatsHtml("Arcade Fire", 62, "Ready To Start", null), "You've listened to <strong>Arcade Fire</strong> 62 times.");
assert.equal(r.radioStatsHtml("Arcade Fire", null, "Ready To Start", 1), "");
assert.equal(r.radioStatsHtml("A<b>", 2, "T", 1, s => s.replace(/</g, "&lt;")), "You've listened to <strong>A&lt;b></strong> 2 times and <strong>T</strong> 1 time.");

// radioArtistFromInfo / radioTrackPlaysFromInfo: Last.fm getInfo responses (userplaycount is a string)
assert.deepEqual(r.radioArtistFromInfo({ artist: { bio: { summary: "S" }, stats: { userplaycount: "62" } } }), { bioHtml: "S", plays: 62 });
assert.deepEqual(r.radioArtistFromInfo({ artist: { stats: { userplaycount: "0" } } }), { bioHtml: "", plays: 0 });
assert.deepEqual(r.radioArtistFromInfo({ artist: {} }), { bioHtml: "", plays: null });
assert.deepEqual(r.radioArtistFromInfo(null), { bioHtml: "", plays: null });
assert.equal(r.radioTrackPlaysFromInfo({ track: { userplaycount: "1" } }), 1);
assert.equal(r.radioTrackPlaysFromInfo({ track: {} }), null);
assert.equal(r.radioTrackPlaysFromInfo(undefined), null);

// radioYearRange: a calendar year in local time, as unix seconds; 0 means every year
assert.equal(r.radioYearRange(0), null);
const y14 = r.radioYearRange(2014);
assert.equal(new Date(y14.from * 1000).getFullYear(), 2014);
assert.equal(new Date(y14.to * 1000).getFullYear(), 2014);
assert.equal(new Date((y14.to + 1) * 1000).getFullYear(), 2015);
assert.equal(new Date((y14.from - 1) * 1000).getFullYear(), 2013);

// radioMomentFromTracks: a Last.fm page (newest first) -> the run around one point, oldest first
const sc = (name, uts, extra) => Object.assign({ name, artist: { "#text": "A" }, album: { "#text": "Al" }, date: { uts: String(uts) } }, extra);
const T0 = 1394560000;
// newest first: an evening session (3 songs, 4 minutes apart), then 5 hours of silence, then an older session of 2
const page = [sc("e3", T0 + 480), sc("e2", T0 + 240), sc("e1", T0), sc("o2", T0 - 5 * 3600), sc("o1", T0 - 5 * 3600 - 200)];
const mom = r.radioMomentFromTracks(page, 1, 2 * 3600, 15);
assert.deepEqual(mom.tracks.map(t => t.track), ["e1", "e2", "e3"]);  // in the order they were played
assert.equal(mom.start, T0); assert.equal(mom.end, T0 + 480);
assert.deepEqual(mom.tracks[0], { artist: "A", track: "e1", album: "Al", uts: T0 });
assert.deepEqual(r.radioMomentFromTracks(page, 4, 2 * 3600, 15).tracks.map(t => t.track), ["o1", "o2"]);  // the point picks the session
// a long session is cut at max, starting at the point
const long = []; for (let k = 9; k >= 0; k--) long.push(sc("s" + k, T0 + k * 200));
assert.deepEqual(r.radioMomentFromTracks(long, 9, 3600, 4).tracks.map(t => t.track), ["s0", "s1", "s2", "s3"]);
assert.deepEqual(r.radioMomentFromTracks(long, 0, 3600, 4).tracks.map(t => t.track), ["s6", "s7", "s8", "s9"]);
// the song playing now, entries without a date or artist and a missing page are skipped
const odd = [sc("now", 0, { "@attr": { nowplaying: "true" }, date: undefined }), sc("ok", T0), { name: "noartist", date: { uts: String(T0 - 10) } }];
assert.deepEqual(r.radioMomentFromTracks(odd, 0, 3600, 15).tracks.map(t => t.track), ["ok"]);
assert.equal(r.radioMomentFromTracks(undefined, 0, 3600, 15), null);
assert.deepEqual(r.radioMomentFromTracks(sc("single", T0), 0, 3600, 15).tracks.map(t => t.track), ["single"]);  // Last.fm sends one object for one result

// radioMomentLabel / radioMomentChip / radioMomentMeta: the moment's date, part of day and songs
const at = (y, mo, d, h, mi) => Math.floor(new Date(y, mo - 1, d, h, mi).getTime() / 1000);
assert.equal(r.radioMomentLabel(at(2014, 3, 11, 21, 4)), "Tuesday, March 11, 2014 · evening");
assert.match(r.radioMomentLabel(at(2014, 3, 11, 9, 0)), /morning$/);
assert.match(r.radioMomentLabel(at(2014, 3, 11, 15, 0)), /afternoon$/);
assert.match(r.radioMomentLabel(at(2014, 3, 11, 2, 0)), /night$/);
assert.equal(r.radioMomentChip(at(2014, 3, 11, 21, 4)), "Mar 11, 2014");
assert.equal(r.radioMomentMeta({ size: 11, start: at(2014, 3, 11, 21, 4), end: at(2014, 3, 11, 21, 52) }), "11 songs you played between 21:04 and 21:52, in that order.");
assert.equal(r.radioMomentMeta({ size: 1, start: at(2014, 3, 11, 8, 5), end: at(2014, 3, 11, 8, 5) }), "1 song you played at 08:05.");
assert.equal(r.radioMomentMeta(null), "");

// radioHomeHeadline / radioSessionTitle: the Library options show in the headline and the radio title
assert.equal(r.radioHomeHeadline("library", "songs", 0), "Your library, shuffled across every year.");
assert.equal(r.radioHomeHeadline("library", "songs", 2014), "Your 2014, shuffled.");
assert.equal(r.radioHomeHeadline("library", "moments", 0), "Your past, one moment at a time.");
assert.equal(r.radioHomeHeadline("library", "moments", 2014), "Back in 2014, as you played it.");
assert.equal(r.radioHomeHeadline("discover", "moments", 2014), "New music, picked from your taste.");  // the options belong to Library
assert.equal(r.radioSessionTitle("library", "songs", 0), "Library radio");
assert.equal(r.radioSessionTitle("library", "moments", 2014), "Library radio · Moments · 2014");
assert.equal(r.radioSessionTitle("mix", "songs", 0), "Mix radio");

// radioLibraryYears: newest first, down to the first scrobble (a saved year older than that stays listed)
assert.deepEqual(r.radioLibraryYears(2022, 2025, 0), [2025, 2024, 2023, 2022]);
assert.deepEqual(r.radioLibraryYears(0, 2025, 0), [2025]);  // not loaded yet: this year only
assert.deepEqual(r.radioLibraryYears(0, 2025, 2023), [2025, 2024, 2023]);

// radioChipText: the Discover reason, else the moment's date, else the year
assert.equal(r.radioChipText({ source: "Last.fm pick", fromPast: false }), "Last.fm pick");
assert.equal(r.radioChipText({ fromPast: true, year: 2014, moment: { chip: "Mar 11, 2014" } }), "Mar 11, 2014");
assert.equal(r.radioChipText({ fromPast: true, year: 2014 }), "From 2014");
assert.equal(r.radioChipText({}), "");
// a row that starts a new moment gets the divider class, with the moment date in its chip
const mrow = r.radioQueueRowHtml(2, { name: "S", artist: "A", fromPast: true, year: 2014, moment: { chip: "Mar 11, 2014" } }, s => s, true);
assert.match(mrow, /radio-row radio-row-play moment-start/);
assert.match(mrow, /radio-chip past.*Mar 11, 2014/);
assert.doesNotMatch(r.radioQueueRowHtml(2, { name: "S", artist: "A" }, s => s, false), /moment-start/);

// radioRateLimitText: how long until Spotify lets searches through again
assert.equal(r.radioRateLimitText(0), "a moment");
assert.equal(r.radioRateLimitText(1000), "1 second");
assert.equal(r.radioRateLimitText(30000), "30 seconds");
assert.equal(r.radioRateLimitText(60000), "60 seconds");
assert.equal(r.radioRateLimitText(120000), "2 minutes");
assert.equal(r.radioRateLimitText(61 * 60000), "61 minutes");
assert.equal(r.radioRateLimitText(2 * 3600000), "2 hours");
assert.equal(r.radioRateLimitText(5400000), "2 hours");

// radioQueueRowHtml: Up next row with cover (no year: it is the year of one random scrobble)
const row = r.radioQueueRowHtml(3, { name: "A <b>", artist: "X", art: "https://i.scdn.co/image/abc", year: 2014 }, s => s.replace(/</g, "&lt;"));
assert.match(row, /radioPlayFrom\(3\)/);
assert.match(row, /<img class="radio-row-art" src="https:\/\/i\.scdn\.co\/image\/abc"/);
assert.match(row, /A &lt;b>/);
assert.doesNotMatch(row, /radio-row-year/);
// no cover: placeholder tile
const bare = r.radioQueueRowHtml(1, { name: "B", artist: "Y" });
assert.match(bare, /<div class="radio-row-art"><\/div>/);
// a cover URL that is not plain https never reaches the attribute
assert.doesNotMatch(r.radioQueueRowHtml(1, { name: "B", artist: "Y", art: 'javascript:alert(1)' }), /<img/);
assert.doesNotMatch(r.radioQueueRowHtml(1, { name: "B", artist: "Y", art: 'https://x/" onerror="y' }), /<img/);

// radioArtistPhotoFromSpotify: smallest https image that is at least 296px wide, else the largest
const imgs = [{ url: "https://i.scdn.co/640", width: 640, height: 640 }, { url: "https://i.scdn.co/320", width: 320, height: 320 }, { url: "https://i.scdn.co/160", width: 160, height: 160 }];
assert.deepEqual(r.radioArtistPhotoFromSpotify({ images: imgs, external_urls: { spotify: "https://open.spotify.com/artist/abc" } }), { url: "https://i.scdn.co/320", link: "https://open.spotify.com/artist/abc" });
assert.equal(r.radioArtistPhotoFromSpotify({ images: [imgs[2]] }).url, "https://i.scdn.co/160");
assert.equal(r.radioArtistPhotoFromSpotify({ images: [] }), null);
assert.equal(r.radioArtistPhotoFromSpotify({}), null);
assert.equal(r.radioArtistPhotoFromSpotify(null), null);
// only plain https URLs reach the page; the Spotify link must be an open.spotify.com page
assert.equal(r.radioArtistPhotoFromSpotify({ images: [{ url: "javascript:alert(1)", width: 640 }, { url: 'https://x/" onerror="y', width: 640 }] }), null);
assert.equal(r.radioArtistPhotoFromSpotify({ images: [imgs[1]], external_urls: { spotify: "https://evil.example/x" } }).link, "");
// radioArtistId: first artist, from the SDK uri or the Web API id
assert.equal(r.radioArtistId({ artists: [{ name: "A", uri: "spotify:artist:1dfeR4HaWDbWqFHLkxsg1d" }] }), "1dfeR4HaWDbWqFHLkxsg1d");
assert.equal(r.radioArtistId({ artists: [{ id: "4Z8W4fKeB5YxbusRsdQVPb", name: "B" }] }), "4Z8W4fKeB5YxbusRsdQVPb");
assert.equal(r.radioArtistId({ artists: [] }), "");
assert.equal(r.radioArtistId({ artists: [{ name: "local", uri: "spotify:local:a:b" }] }), "");
assert.equal(r.radioArtistId(null), "");

console.log("radio helpers: ok");
