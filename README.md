# Scrobble Time Machine

Your Last.fm history meets Spotify playback. Time travel through your music.

**Live:** [https://stm-lastfm.vercel.app/](https://stm-lastfm.vercel.app/)

## What it does

Scrobble Time Machine connects your Last.fm scrobble history with Spotify playback. Start an endless radio of random scrobbles from your whole history, or time travel by date, artist, mood, decade and more — then listen to exactly what you were playing months or years ago.

## Features

- **Stations** - pick **Library** (below), **Discover** (new music from Last.fm's recommendations and artists similar to your recent top artists, skipping songs you played or saved) or **Mix** (your past and new music, alternating)
- **Library Radio** - one click starts an endless stream of random scrobbles from your whole history; songs you played more often come up more often. Shows an Up next list (click to jump), the artist's Last.fm bio and your play counts for the artist and track
- **Random time travel** - lands on a random moment in your history, labelled by date
- **Date search** - jump to a specific year, month, or day
- **Artist search** - find a random page where a specific artist appears
- **Mood search** - pick a vibe (Chill, Melancholy, Energetic, Raw, Dreamy, Soul, Indie) and find matching tracks from your history using Last.fm tags
- **On This Day** - one click to hear what you were listening to on today's date in a random past year
- **Artist autocomplete** - suggestions from your top 500 artists as you type, with play counts
- **Smart matching** - deduplicates searches, caches results, respects Spotify rate limits (5 searches first, more as you listen, with a cooldown after a 429)
- **Auto-continuation** - as you listen, the next batch of tracks loads automatically
- **Live now-playing tracking** - highlights the currently playing track in real time
- **Session-aware polling** - detects if another device takes over Spotify playback
- **Decade mode** - quick-access buttons for an era (My 2010s, The 2000s, etc.)
- **Album mode** - find when you first listened to a specific album
- **First Listen** - discover the exact date you first scrobbled an artist
- **Streak finder** - surface your longest consecutive listening run for an artist
- **Embedded player** - Spotify Web Playback SDK streams audio in-browser; no external device required
- **Liked songs** - heart button on each track row and in the radio view; saves/removes tracks from Spotify Liked Songs with one click
- **Save as Playlist** - in Time Travel, one-click, auto-named (includes mode context: date, artist, etc.), opens result in Spotify

## How it works

No build step, no backend, no dependencies. Everything runs client-side in your browser (plain HTML, CSS and JS files).

1. Enter your Last.fm username
2. Connect your Spotify account (OAuth PKCE - no secrets stored)
3. Press Start radio, or pick a Time Travel mode (Random, Date, Artist, Mood, On This Day, Decade, Album, First Listen, Streak)
4. Tracks are matched against Spotify's catalog and played back immediately
5. Optionally save the matched tracks as a Spotify playlist

## Setup (self-hosting)

If you want to run your own instance:

1. **Get a Last.fm API key** at [last.fm/api/account/create](https://www.last.fm/api/account/create)
2. **Create a Spotify app** at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
   - Set the redirect URI to your hosting URL (e.g. `https://yourusername.github.io/scrobble-time-machine/`); it must exactly match the page URL, so serve the app over http(s), not `file://`
   - No client secret needed (uses PKCE)
3. **Edit `js/config.js`** and replace the two API keys at the top of the file:
   ```js
   const LASTFM_API_KEY = "your_lastfm_key";
   const SPOTIFY_CLIENT_ID = "your_spotify_client_id";
   ```
4. **Deploy** - push to GitHub Pages, or any static hosting (Netlify, Cloudflare Pages, Vercel, etc.)

### Spotify Development Mode

New Spotify apps start in Development Mode, which limits access to 25 manually-added users. To let anyone use your instance, you'd need to apply for Extended Quota Mode in the Spotify Developer Dashboard. The app works well within dev mode limits for personal use.

## Requirements

- A Last.fm account with scrobble history
- A Spotify Premium account (required for playback control and in-browser SDK streaming)

## Tech stack

- Vanilla HTML/CSS/JS (multi-file, no framework or build step)
- Last.fm API (scrobble history)
- Spotify Web API (search, playback, playlists, liked songs)
- Spotify Web Playback SDK (in-browser audio streaming)
- Spotify PKCE OAuth (no backend needed)
- Barlow font (matching Last.fm's style) and Phosphor icons

## Rate limit strategy

Spotify's API in development mode has strict rate limits. The app handles this with:

- **Small first batch**: 5 Spotify searches up front, more loaded as you listen
- **Deduplication**: same artist+track combo is only searched once
- **Caching**: successful matches are cached for the session (rate-limited or failed lookups are not)
- **Delays**: 500ms between search calls
- **Retry**: waits out a `Retry-After` of 5 seconds or less
- **Cooldown**: on a longer `Retry-After`, searches pause, unsearched tracks are kept for later, and the app shows when to try again
- **Auto-continuation**: remaining tracks are searched as you listen, naturally spreading API usage over time

## Built with

Built with [Claude](https://claude.ai) by Anthropic.

## License

[MIT](LICENSE)

