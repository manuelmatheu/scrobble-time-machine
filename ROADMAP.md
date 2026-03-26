# Scrobble Time Machine — Roadmap

A living document tracking planned features, improvements, and ideas for future development.

## v2.2 (current) ✅

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

---

## Future (v3.x)

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
