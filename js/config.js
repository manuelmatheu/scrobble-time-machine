// ═════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═════════════════════════════════════════════════════════════════════════════
const LASTFM_API_KEY = "177b9e8ee70fe2325bfff606cfdaee23";
const SPOTIFY_CLIENT_ID = "73fce01f5762463e86ff6555751a148c";
const SPOTIFY_REDIRECT_URI = window.location.origin + window.location.pathname;
const SPOTIFY_SCOPES = "user-modify-playback-state user-read-playback-state user-read-currently-playing playlist-modify-private playlist-modify-public streaming user-library-modify user-library-read";
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
let likedSet = new Set();

// Library Radio
const RADIO_INITIAL = 8;        // tracks matched before playback starts
const RADIO_REFILL = 8;         // tracks added per top-up
const RADIO_LOW_WATER = 2;      // top up when this many tracks remain after the current one
const RADIO_CONCURRENCY = 4;    // parallel Last.fm requests per round
const RADIO_MAX_ATTEMPTS = 40;  // Last.fm fetches per fill before giving up
const RADIO_UPNEXT_ROWS = 6;    // rows shown in the Up next list
let radioActive = false, radioUser = "", radioTotal = 0;
let radioSession = 0;           // bumped on every start/stop; stale fills compare against it
let radioSeen = new Set();      // artist||track keys already picked this session
let radioRefilling = false, radioExhausted = false, radioFailures = 0;
let radioCurrentUri = null, radioLastPos = 0;  // now-playing fallback when the SDK is not driving state
let radioPaused = false, radioPendingReissue = false;  // a top-up finished while paused: re-issue playback on resume
let radioInfoIdx = -1;          // index whose bio/plays panel is showing (or loading)
let radioArtistCache = {}, radioTrackCache = {};  // Last.fm getInfo results (promises), by artist / artist||track
let travelActive = false;       // the radio view is showing a time-travel session
let radioHeroLive = false;      // the hero has a track from the current session (gates the progress bar)
let spotifyBlockedUntil = 0;    // Spotify 429 cooldown: no search is sent before this timestamp (ms)
let trackMeta = {};             // index -> { name, artist, album, page, year, art }
