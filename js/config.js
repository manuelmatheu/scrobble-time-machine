// ═════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═════════════════════════════════════════════════════════════════════════════
const LASTFM_API_KEY = "177b9e8ee70fe2325bfff606cfdaee23";
const SPOTIFY_CLIENT_ID = "73fce01f5762463e86ff6555751a148c";
const SPOTIFY_REDIRECT_URI = window.location.origin + window.location.pathname;
const SPOTIFY_SCOPES = "user-modify-playback-state user-read-playback-state user-read-currently-playing playlist-modify-private playlist-modify-public streaming user-library-modify user-library-read";
const BATCH_SIZE = 15;    // max Spotify searches per batch
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
let likedSet = new Set();
