# Scrobble Time Machine

Your Last.fm history meets Spotify playback. Time travel through your music.

**Live:** [manuelmatheu.github.io/scrobble-time-machine](https://manuelmatheu.github.io/scrobble-time-machine/)

## What it does

Scrobble Time Machine connects your Last.fm scrobble history with Spotify playback. Search by date, artist, mood, or let fate pick a random page — then listen to exactly what you were playing months or years ago.

## Features

- **Random time travel** - spins through your history and lands on a random page of 50 scrobbles
- **Date search** - jump to a specific year, month, or day
- **Artist search** - find a random page where a specific artist appears
- **Mood search** - pick a vibe (Chill, Melancholy, Energetic, Raw, Dreamy, Soul, Indie) and find matching tracks from your history using Last.fm tags
- **Interactive timeline** - drag the slider to scrub through your entire listening history
- **Era context panel** - see when you listened, your top artist on that page, and your listening pace
- **Smart matching** - deduplicates searches, caches results, respects Spotify rate limits (15 searches per batch with 500ms delays)
- **Auto-continuation** - as you listen, the next batch of tracks loads automatically
- **Live now-playing tracking** - highlights the currently playing track in real time
- **Session-aware polling** - detects if another device takes over Spotify playback
- **Save as Playlist** - save any matched set of tracks as a private Spotify playlist

## How it works

The entire app is a single HTML file. No build step, no backend, no dependencies. Everything runs client-side in your browser.

1. Enter your Last.fm username
2. Connect your Spotify account (OAuth PKCE - no secrets stored)
3. Choose a mode: Random, Date, or Artist
4. Tracks are matched against Spotify's catalog and played back immediately
5. Optionally save the matched tracks as a Spotify playlist

## Setup (self-hosting)

If you want to run your own instance:

1. **Get a Last.fm API key** at [last.fm/api/account/create](https://www.last.fm/api/account/create)
2. **Create a Spotify app** at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
   - Set the redirect URI to your hosting URL (e.g. `https://yourusername.github.io/scrobble-time-machine/`)
   - No client secret needed (uses PKCE)
3. **Edit `index.html`** and replace the two API keys at the top of the `<script>` section:
   ```js
   const LASTFM_API_KEY = "your_lastfm_key";
   const SPOTIFY_CLIENT_ID = "your_spotify_client_id";
   ```
4. **Deploy** - push to GitHub Pages, or any static hosting (Netlify, Cloudflare Pages, Vercel, etc.)

### Spotify Development Mode

New Spotify apps start in Development Mode, which limits access to 25 manually-added users. To let anyone use your instance, you'd need to apply for Extended Quota Mode in the Spotify Developer Dashboard. The app works well within dev mode limits for personal use.

## Requirements

- A Last.fm account with scrobble history
- A Spotify Premium account (required for playback control)
- An active Spotify device (open Spotify on any device before using)

## Tech stack

- Vanilla HTML/CSS/JS (single file, no framework)
- Last.fm API (scrobble history)
- Spotify Web API (search, playback, playlists)
- Spotify PKCE OAuth (no backend needed)
- Barlow font (matching Last.fm's style)

## Rate limit strategy

Spotify's API in development mode has strict rate limits. The app handles this with:

- **Batch cap**: max 15 Spotify searches per batch
- **Deduplication**: same artist+track combo is only searched once
- **Caching**: results persist across timeline scrubs within a session
- **Delays**: 500ms between search calls
- **Auto-retry**: backs off on 429 responses using Retry-After headers
- **Auto-continuation**: remaining tracks are searched as you listen, naturally spreading API usage over time

## Built with

Built with [Claude](https://claude.ai) by Anthropic.

## License

[MIT](LICENSE)

