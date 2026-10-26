# Scrobble Time Machine — Roadmap

A living document tracking planned features, improvements, and ideas for future development.

## v2.11 (current) ✅

- [x] Time Travel folded into Library radio (Design canvas "Time Travel into Radio", https://claude.ai/artifact/FxeAUu2yox3QMPWRoxfPbh): the nine mode cards are gone
- [x] Library **How it plays**: Songs (random scrobbles) or Moments (a stretch of consecutive scrobbles in the order played, then a jump to another moment: an endless Random mode)
- [x] Library **When**: every year or one year (`user.getrecenttracks` with `from`/`to`, so positions stay inside the year)
- [x] This moment panel: when it was, how many songs, Save this moment (playlist) and Next moment
- [x] Station picker is a tab bar with one options panel that eases between stations (Design canvas, Proposals B)
- [x] First run is a landing: username, then Connect Spotify (Premium stated up front); the full Home card appears once connected (Design canvas v2.11, Home - first run)
- [ ] Open: should the past half of a Mix follow When too?

---

## v2.10 ✅

- [x] Faster start: the first song plays as soon as it is matched (about 1.5s instead of 8s with typical latencies for Library, 2-3s for Discover and Mix); the rest of the queue fills behind it
- [x] New tracks reach a speaker or other Connect device at the end of the last queued song (like in the browser), instead of restarting the music mid-song
- [x] Errors and warnings are toasts (bottom center, auto-dismiss, close button) instead of a status bar that never went away
- [x] Wide desktop shows 8 Up next rows (6 on smaller screens); the phone like heart sits on the first line of the title; the console logs are gone
- [x] Library radio shows the "From YEAR" chip too (hero and Up next), like the past half of a Mix
- [x] Fix: Next on the last song Spotify holds (such as the first song of a session) no longer stops the music; the queued tracks are swapped in at once
- [x] Removed the "Play on" device picker (it did not work as intended and broke the player layout); a session moved to another device from the Spotify app is still followed
- [x] Quiet motion: track-change fade, new Up next rows slide in, view/overlay/menu transitions, like pop, Tuning skeleton; ease-out tokens, no overshoot, off under reduced motion (`tests/motion.test.js`)
- [x] Fix: a followed device that went idle and was dropped by Spotify no longer leaves Next/Play stuck on 404s; STM releases it and resumes in this browser
- [x] The device list refreshes by itself while open, has a labelled Refresh button and explains why Chromecast, Nest and Sonos speakers may be missing

---

## v2.9 ✅

- [x] Spotify Connect device picker ("Play on") on the home card and in the radio controls; switching mid-session keeps the queue and position
- [x] Follows the session when it is moved to another device from the Spotify app, including devices Spotify returns without an id (many Sonos), which are shown but cannot be controlled from STM
- [x] A watchdog notices when the SDK loses playback without sending its null state

---

## v2.8 ✅

- [x] Stations on the home card: Library (your history), Discover (new music) and Mix (both, with a balance control)
- [x] Discover: Last.fm's personalized station plus artists similar to your top artists of the last month; songs you played or saved are skipped
- [x] Each pick shows where it came from (Last.fm pick, Similar to an artist, or From a year of your history)
- [x] The radio keeps getting new tracks even when Spotify queues its own autoplay songs after ours

---

## v2.7 ✅

- [x] No more stutter a few seconds into a song: new tracks are swapped in at the end of the last queued track instead of mid-song
- [x] The plain-query Spotify fallback only accepts a hit with the same artist and title (no more unrelated songs for tracks missing from Spotify)

---

## v2.6 ✅

- [x] Artist photo (from Spotify) in the artist panel on wide desktop, linking to the artist on Spotify

---

## v2.5 ✅


- [x] Home redesign: radio card with a larger Start radio button
- [x] Time Travel modes as a grid of nine cards with descriptions (replaces the pills and the More toggle)
- [x] Wide desktop layout: two-column home, radio and Time Travel views
- [x] Back to radio: Home keeps the session playing; no more bottom player bar; volume slider
- [x] Quieter status bar (errors and warnings only) and a steady Up next list
- [x] Phone polish: like heart next to the title, centered controls, full-width progress bar

---

## v2.4 ✅

- [x] Library Radio: endless stream of random scrobbles from the whole Last.fm history
- [x] Radio-first redesign: home with one Start radio button, radio view with Up next, artist bio and your play counts, time travel as secondary
- [x] Time Travel in the radio view (all nine modes); page numbers removed
- [x] Contrast, shape, and reduced-motion pass; Phosphor icons

---

## v2.2 ✅

- [x] Embedded Spotify Web Playback SDK player (in-browser streaming)
- [x] Fixed player bar: album art, track info, prev/play-pause/next, seekable progress, volume
- [x] Liked songs: heart on track rows + player bar, batch-checks on load, one-click toggle
- [x] Save as Playlist: auto-named, one-click, opens result in Spotify, improved error messages

---

## v2.1 ✅

- [x] Decade mode
- [x] Album mode
- [x] First Listen (Discovery Tracker)
- [x] Streak finder

---

## v2.0 ✅

- [x] Random time travel
- [x] Date search (year/month/day)
- [x] Artist search with autocomplete (top 500 artists, play counts)
- [x] Mood search (7 presets via Last.fm tags)
- [x] On This Day (today's date in a random past year)
- [x] Save as Spotify Playlist
- [x] Interactive timeline slider
- [x] Era context panel with stats
- [x] Smart matching with rate limit strategy
- [x] Now-playing tracking + auto-continuation
- [x] Session-aware polling (multi-device safety)
- [x] Dark/light theme toggle with system preference
- [x] Remember Last.fm username (localStorage)
- [x] Keyboard shortcuts (Escape to cancel)
- [x] Changelog page with in-app overlay
- [x] Multi-file architecture
- [x] Mobile responsive layout

---

## Next up (v2.x)

- [ ] Sonos: Spotify answers `403 "Restricted device"` to `play` and `next` on it, so STM cannot skip, play from a row or top up the queue there, and a failed play falls back to this browser. Show a clear message instead of moving the music, and/or send up to 100 tracks in the first play so the queue lasts longer
- [ ] "Not for me" on Discover picks: a dislike button so a Last.fm recommendation (track, or the whole artist) never comes back. Last.fm has no ban API anymore, so keep the list in `localStorage` and drop it in `discoverVet()`; it would sync across devices once there is a backend (see Future)
- [ ] Autoplay: when the app opens (username saved, Spotify connected), start the last station with its last settings by itself, as an opt-in setting. Browsers block sound until the user interacts with the page (the SDK needs `activateElement()` from a click), so in this browser it may need one tap: prepare the queue on load and show a single "Resume <station> radio" button; a session followed on another Spotify Connect device can start with no tap

---

## Future (v3.x)

### Rust core, more platforms, desktop/mobile sync
Explore moving the radio engine (matching, queue, seams) to a Rust core and shipping desktop and mobile apps around it (for example Tauri 2), for a sturdier app that is not tied to one browser tab. Points to settle first: the Web Playback SDK only runs in a browser, so mobile would play through Spotify Connect or Spotify's native SDKs; and sync between desktop and phone (pick up the same session, Up next, dislikes and settings) needs a small backend for shared state no matter the language, so it can be built before or without the rewrite.

### Listening Journey Visualization
A timeline or heatmap showing your top artists per month/year. Click any cell to travel there. Think GitHub contribution graph but for music. Could use `user.getTopArtists` with period filters to build the dataset.

### Musical Neighbors
Compare your history against a friend's Last.fm username. Find overlapping artists and time periods where you were both listening to the same thing. Social feature that could drive sharing.

### Stats Dashboard
Dedicated stats page with:
- Total scrobbles and listening time
- Top artists/albums/tracks by era
- Most active listening days/hours
- Genre evolution over time
- "Your music in numbers" annual recap

### Share Links
Generate URLs like `scrobbletime.app?user=manu&from=1234567890` that load a specific time window. People could share "listen to what I was into in 2012" links on social media.

### "More Like This"
After playing a page, generate a fresh mix based on the artists from that page. Bridges past discovery with new listening. Uses Spotify's `related-artists` endpoint.

---

## Quality of Life (ongoing)

### Fuzzy Artist Matching
Currently artist search requires exact name match. Could add fuzzy matching to handle slight misspellings or alternate names (e.g., "RHCP" → "Red Hot Chili Peppers").

### Smarter Mood Tags
Current mood presets are hardcoded. Could dynamically pull tags from the user's most-scrobbled artists to create personalized mood categories. Or let users create custom moods with their own tag combinations.

### Playlist Improvements
- Playlist cover art generation (collage of album art from matched tracks)
- Batch operations (save multiple sessions as playlists)
- Better dev mode fallback (currently copies URIs to clipboard)

### Extended Quota Mode
Apply for Spotify Extended Quota to remove the 25-user limit and enable full playlist API access. Required for public launch.

### Performance
- Cache Last.fm total pages and time range per session
- Preload artist autocomplete data on first username entry
- Service worker for offline-capable shell
- Lazy load era panel stats

### Custom Domain
Set up `scrobbletime.app` or similar for better branding and shareability. GitHub Pages supports custom domains with HTTPS.

---

## Ideas / Exploring

These are raw ideas that need more thought before committing:

- **Listening calendar** — visual calendar view showing what you listened to each day
- **Track journey** — trace a single song through your history (when did you first hear it, how often, when did you stop)
- **Genre time travel** — like mood search but using Last.fm tag weights per artist to build genre profiles over time
- **Collaborative time travel** — two users enter their usernames, find pages where both were listening to the same artist at the same time
- **Import/export** — export session history, import to playlist managers
- **PWA** — installable as a phone app with push notifications ("On this day 5 years ago, you were listening to...")
- **Last.fm integration** — love/unlove tracks on Last.fm directly from the interface (currently uses Spotify Liked Songs)

---

*Last updated: v2.2 (March 2026)*
