// ═════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═════════════════════════════════════════════════════════════════════════════
const LASTFM_API_KEY = "177b9e8ee70fe2325bfff606cfdaee23";
const SPOTIFY_CLIENT_ID = "73fce01f5762463e86ff6555751a148c";
const SPOTIFY_REDIRECT_URI = window.location.origin + window.location.pathname;
const SPOTIFY_SCOPES = "user-modify-playback-state user-read-playback-state user-read-currently-playing playlist-modify-private playlist-modify-public streaming user-library-modify user-library-read user-top-read";
const BATCH_SIZE = 5;     // max Spotify searches per batch (time travel loads more as you listen)
const SEARCH_DELAY = 500; // ms between search calls
const POLL_INTERVAL = 5000; // ms between now-playing polls

// ═════════════════════════════════════════════════════════════════════════════
// STATE
// ═════════════════════════════════════════════════════════════════════════════
let spotifyToken = null, abortController = null, currentPhase = "idle";
let matchedUris = {};       // index -> spotify URI
let allTrackCount = 0;
let cachedTotalPages = 0, cachedTotalScrobbles = 0, cachedCurrentPage = 0;
let isDragging = false, searchCache = {}, lastSearchError = null;
let currentTracks = [];     // track objects for current page
let uriToIndices = {};      // URI -> [indices] (reverse map)
let skippedPlan = [];       // plan entries that were skipped (for continuation)
let isContinuing = false;   // guard: are we currently matching the next batch?
let pollTimer = null;       // setInterval id
let nowPlayingIndex = -1;   // currently highlighted track index
let totalMatched = 0;       // running total of matched tracks
let searchMode = "random";
let sessionQueue = new Set();
let sessionPaused = false;
let playlistLabel = "";
let selectedMood = "chill";  // "random" | "date" | "artist"

const $ = id => document.getElementById(id);
const HEART_EMPTY  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>';
const HEART_FILLED = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>';
const MOOD_TAGS = {
  chill: ["chillout", "ambient", "mellow"],
  melancholy: ["sad", "melancholy", "dark"],
  energetic: ["electronic", "dance", "edm"],
  raw: ["rock", "punk", "metal"],
  dreamy: ["dreamy", "shoegaze", "dream pop"],
  soul: ["soul", "jazz", "rnb"],
  indie: ["indie", "alternative", "indie rock"]
};
let lastRefreshedUser = "";
let sdkReady = false;
let sdkDeviceId = null;
let sdkNeedsRetransfer = false;
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
let radioMinimized = false;   // the radio/time-travel session keeps playing while the home view is showing
let travelActive = false;       // the radio view is showing a time-travel session
let radioHeroLive = false;      // the hero has a track from the current session (gates the progress bar)
let spotifyBlockedUntil = 0;    // Spotify 429 cooldown: no search is sent before this timestamp (ms)
let trackMeta = {};             // index -> { name, artist, album, page, year, art }
