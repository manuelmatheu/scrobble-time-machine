// ═════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═════════════════════════════════════════════════════════════════════════════
const LASTFM_API_KEY = "177b9e8ee70fe2325bfff606cfdaee23";
const SPOTIFY_CLIENT_ID = "73fce01f5762463e86ff6555751a148c";
const SPOTIFY_REDIRECT_URI = window.location.origin + window.location.pathname;
const SPOTIFY_SCOPES = "user-modify-playback-state user-read-playback-state user-read-currently-playing playlist-modify-private playlist-modify-public streaming user-library-modify user-library-read user-top-read";
const SEARCH_DELAY = 500; // ms between search calls
const POLL_INTERVAL = 5000; // ms between now-playing polls
const PHONE_TOPUP = 10;           // songs a phone adds when the radio runs low (hand-off)
const HANDOFF_BEAT_MS = 60000;    // the driver rewrites the session note this often
const HANDOFF_FOLLOW_MS = 30000;  // a follower re-reads the note this often
const HANDOFF_STALE_MS = 180000;  // a driver silent this long is gone
const HANDOFF_SEEN_MAX = 300;     // radioSeen keys kept in the note
const HANDOFF_BEFORE = 3;         // songs before the current one kept in the note
const HANDOFF_FAILS_MAX = 3;      // failed calls in a row (after the store answered once) that turn the hand-off off

// ═════════════════════════════════════════════════════════════════════════════
// STATE
// ═════════════════════════════════════════════════════════════════════════════
let spotifyToken = null, currentPhase = "idle";  // "idle" | "working" (a radio is starting) | "done" | "error"
let matchedUris = {};       // index -> spotify URI
let allTrackCount = 0;
let searchCache = {}, lastSearchError = null;
let uriToIndices = {};      // URI -> [indices] (reverse map)
let pollTimer = null;       // setInterval id
let nowPlayingIndex = -1;   // currently playing track index
let totalMatched = 0;       // running total of matched tracks
let sessionQueue = new Set();
let sessionPaused = false;

const $ = id => document.getElementById(id);
let sdkReady = false;
let sdkDeviceId = null;
let sdkNeedsRetransfer = false;
const STM_PLAYER_NAME = "Scrobble Time Machine";  // the name of this app's browser player in Spotify's device list
let sdkInactive = false;  // another window or device took the music from this browser's player: Play brings this window's queue back here
// Spotify Connect: the device the user picked to play on (null = automatic: this browser through the SDK, else the active device)
let playbackDeviceId = null, playbackDeviceName = "", playbackDeviceType = "";
let likedSet = new Set();

// Library Radio
const RADIO_START_TRACKS = 1;   // tracks matched before playback starts: the first sound should not wait for a full queue
const RADIO_REFILL = 8;         // tracks added per top-up
const RADIO_CONCURRENCY = 4;    // parallel Last.fm requests per round
const RADIO_MAX_ATTEMPTS = 40;  // Last.fm fetches per fill before giving up
const RADIO_UPNEXT_ROWS = 6;    // rows shown in the Up next list (phones, tablets)
const RADIO_UPNEXT_ROWS_WIDE = 8;  // ...and on wide desktop (1100px and up), where the list panel is taller and the rows tighter
const RADIO_ROW_PX_WIDE = 51;     // height of one Up next row in the wide panel (5px + 40px cover + 5px + 1px divider); the list shows as many as fit
const RADIO_LOW_WATER = RADIO_UPNEXT_ROWS - 1;  // top up when fewer than a full Up next list remains after the current one (phones)
let radioActive = false, radioUser = "", radioTotal = 0;
let radioSession = 0;           // bumped on every start/stop; stale fills compare against it
let radioSeen = new Set();      // artist||track keys already picked this session
let radioRefilling = false, radioExhausted = false, radioFailures = 0;
let radioCurrentUri = null, radioLastPos = 0;  // now-playing fallback when the SDK is not driving state
let radioPaused = false, radioPendingReissue = false;  // new tracks not in Spotify's context yet: re-issue on resume (no SDK) or at the end of the last queued track (SDK)
let radioCarry = [];           // picks a fill collected but did not use because it was done: the next fill uses them first
let radioStartedAt = 0;        // when the session's first play went out (for a few seconds there is no position reading to time a swap from)
let homeTotalCache = { user: "", total: 0, at: 0 };  // the scrobble count the home card already fetched (startRadio reuses it)
const HOME_TOTAL_FRESH_MS = 10 * 60 * 1000;
let radioSeaming = false;      // a seam swap is in flight (the 250ms timer must not start another)
let radioContextLastUri = null;  // last URI of the most recent play we issued: after it Spotify has nothing of ours (set by spotifyPlay)
const RADIO_SEAM_MS = 1500;     // with the SDK, swap in the new tracks this close to the end of the last queued track
// Music on another Connect device (polling): the last /me/player reading, so the position can be extrapolated between polls
let remoteNow = null;           // { uri, pos, dur, playing, at } or null
let remoteFastAt = 0, remoteSeamAt = 0;  // throttles: the 1s re-sync polls near the end, and retries of a failed swap
const RADIO_REMOTE_SEAM_MS = 2500;  // on another device the swap lands this close to the end (the position is only as exact as the last poll)
const REMOTE_FRESH_MS = 20000;      // a reading older than this is not trusted for a seam
// Stations: radioStation is the one picked on the home card; radioActiveStation is the one the running session plays
let radioStation = "library", radioActiveStation = "library";  // "library" | "discover" | "mix"
let radioBalance = "balanced", radioActiveBalance = "balanced";  // Mix: "mostly-past" | "balanced" | "mostly-new"
const MIX_BATCH = 8;                 // picks handed out per Mix round
let radioBuf = { past: [], new: [] }; // Mix: picks collected but not used yet, by source
let radioMixCursor = 0;              // position in the Mix pattern
const DISCOVER_BATCH = 6;            // candidates vetted per round
const DISCOVER_MAX_ROUNDS = 6;       // rounds per fill before giving up
const DISCOVER_SEEDS_PER_ROUND = 2;  // top artists expanded per pool refill
let discoverPool = [];               // candidates waiting to be vetted: { artist, track, source }
let discoverSeeds = null;            // names of your recent top artists (null = not loaded yet)
let discoverSeedRound = 0, discoverSimilarCache = {}, discoverTopCache = {}, discoverUsedArtists = new Set();
let discoverNeedsReconnect = false, discoverWarnedEmpty = false;
let radioInfoIdx = -1;          // index whose bio/plays panel is showing (or loading)
let radioArtistCache = {}, radioTrackCache = {};  // Last.fm getInfo results (promises), by artist / artist||track
// Library options: how it plays ("songs" = random scrobbles, "moments" = stretches of consecutive scrobbles, in order)
// and when (0 = every year, else one year). radioHow / radioYear are the home card's picks; the active ones belong to the session.
let radioHow = "songs", radioActiveHow = "songs";
let radioYear = 0, radioActiveYear = 0;
let radioRange = null;               // the running session's { from, to } in unix seconds, or null for every year
let libraryYears = { user: "", first: 0 };  // the year of the user's first scrobble (the When list starts there)
const MOMENT_FETCH = 30;             // scrobbles fetched around a random point to build one moment
const MOMENT_MAX = 15;               // tracks per moment at most
const MOMENT_GAP_S = 2 * 3600;       // a silence longer than this ends a moment
let radioMomentSeq = 0;              // moment ids of the running session
let radioJumpFrom = null;            // Next moment pressed with no next moment queued: the moment id to leave (null: none)
let radioMinimized = false;   // the radio keeps playing while the home view is showing
let radioHeroLive = false;      // the hero has a track from the current session (gates the progress bar)
let spotifyBlockedUntil = 0;    // Spotify 429 cooldown: no search is sent before this timestamp (ms)
let trackMeta = {};             // index -> { name, artist, album, page, year, art, moment? }
