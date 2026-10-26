# Scrobble Time Machine

Your Last.fm history meets Spotify playback. An endless radio of your own past.

**Live:** [https://stm-lastfm.vercel.app/](https://stm-lastfm.vercel.app/)

## What it does

Scrobble Time Machine connects your Last.fm scrobble history with Spotify playback. Start an endless radio of your own scrobbles: random songs from any year, or whole moments played back in the order you played them, so you hear exactly what you were listening to months or years ago.

## Features

- **Stations** - pick **Library** (below), **Discover** (new music from Last.fm's recommendations and artists similar to your recent top artists, skipping songs you played or saved) or **Mix** (your past and new music, alternating)
- **Library Radio** - one click starts an endless stream from your own history; songs you played more often come up more often. Two options:
  - **How it plays:** **Songs** (random scrobbles, each from a different day) or **Moments** (a stretch of what you played back then, in the order you played it; when it ends the radio jumps to another moment)
  - **When:** every year, or one year you pick
- **This moment** - while Moments plays, a panel says when it was ("Tuesday, March 11, 2014 · evening"), with **Save this moment** (a Spotify playlist named after it) and **Next moment**
- **Up next and artist info** - click a queued song to jump to it; the artist's Last.fm bio and your play counts for the artist and track
- **Smart matching** - deduplicates searches, caches results, respects Spotify rate limits (a cooldown after a 429)
- **Session-aware polling** - follows the music if it moves to another device
- **Embedded player** - Spotify Web Playback SDK streams audio in-browser; no external device required
- **Liked songs** - heart button in the radio view; saves/removes tracks from Spotify Liked Songs with one click

## How it works

No build step, no dependencies. Everything runs client-side in your browser (plain HTML, CSS and JS files), except one small serverless function (`api/lfm-station.js`) that proxies Last.fm's recommended station for Discover, since Last.fm doesn't allow it to be fetched from the browser (CORS).

1. Enter your Last.fm username
2. Connect your Spotify account (OAuth PKCE - no secrets stored)
3. Pick a station (Library with its options, Discover or Mix) and press Start radio
4. Tracks are matched against Spotify's catalog and played back immediately
5. In Moments, optionally save the moment as a Spotify playlist

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
4. **Deploy** - Vercel serves both the static files and `api/lfm-station.js` with no configuration. Any static host (GitHub Pages, Netlify, Cloudflare Pages) also works, but without the function Discover only plays artists similar to your top artists; the Last.fm station source is skipped.

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

