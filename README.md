# Scrobble Time Machine

Your Last.fm history meets Spotify playback. An endless radio of your own past.

**Live:** [https://stm-lastfm.vercel.app/](https://stm-lastfm.vercel.app/) (open only to the accounts its owner added; to use it yourself, run your own copy: see [Setup](#setup-self-hosting))

## What it does

Scrobble Time Machine connects your Last.fm scrobble history with Spotify playback. Start an endless radio of your own scrobbles: random songs from any year, or whole moments played back in the order you played them, so you hear exactly what you were listening to months or years ago.

## Features

- **Stations** - pick **Library** (below), **Discover** (new music from Last.fm's recommendations and artists similar to your recent top artists, skipping songs you played or saved) or **Mix** (your past and new music, alternating)
- **Library Radio** - one click starts an endless stream from your own history; songs you played more often come up more often. Two options:
  - **How it plays:** **Songs** (random scrobbles, each from a different day) or **Moments** (a stretch of what you played back then, in the order you played it; when it ends the radio jumps to another moment)
  - **When:** every year, or one year you pick
- **This moment** - while Moments plays, a panel says when it was ("Tuesday, March 11, 2014 · evening"), with **Save this moment** (a Spotify playlist named after it) and **Next moment**
- **Up next and artist info** - click a queued song to jump to it; the artist's Last.fm bio and your play counts for the artist and track
- **Play on** - pick a speaker or another device on your Spotify account; a running radio moves with its queue, and on a computer the volume slider sets the speaker's volume
- **Pick it up on your phone** - start a radio on the computer, open the app on your phone and tap Open radio (needs the optional store, see Setup step 4)
- **Installable** - add it to your phone's home screen like an app
- **Embedded player** - the Spotify Web Playback SDK plays in the browser; no other device needed
- **Liked songs** - a heart button saves or removes the current song in your Spotify Liked Songs

## How it works

No build step, no dependencies. Everything runs in the browser (plain HTML, CSS and JS files), plus two small Vercel functions:

- `api/lfm-station.js` fetches Last.fm's recommended station for Discover (Last.fm does not let a browser fetch it directly)
- `api/session.js` keeps a small note per Spotify user, so a radio can be picked up on another device (optional; needs an Upstash Redis store)

1. Enter your Last.fm username
2. Connect your Spotify account (OAuth PKCE - no secrets stored)
3. Pick a station (Library with its options, Discover or Mix) and press Start radio
4. Tracks are matched against Spotify's catalog and played back immediately
5. In Moments, optionally save the moment as a Spotify playlist

## Setup (self-hosting)

A Spotify app in Development Mode can only be used by **5 Spotify accounts**, added by hand by its owner, so each group of friends runs its own copy. Plan on about 15 minutes.

**You need:** a Spotify **Premium** account (Spotify requires it for the app's owner, and every listener needs Premium to play in the browser), a Last.fm account, a GitHub account and a free Vercel account.

### 1. Fork and get your own keys

1. **Fork this repo** on GitHub.
2. **Last.fm API key:** create one at [last.fm/api/account/create](https://www.last.fm/api/account/create). Only the "API key" is used, not the shared secret.
3. **Spotify app:** at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard), press **Create app**:
   - **APIs used:** tick **Web API** and **Web Playback SDK**.
   - **Redirect URIs:** the exact address of your app, with the trailing slash, for example `https://my-stm.vercel.app/`. Add one line per address you will use (a preview deploy, a custom domain). For local testing add `http://127.0.0.1:3000/`; Spotify does not accept `localhost`.
   - No client secret is needed (the app uses PKCE). Copy the **Client ID**.
4. **Edit `js/config.js`** (the first lines):
   ```js
   const LASTFM_API_KEY = "your_lastfm_key";
   const SPOTIFY_CLIENT_ID = "your_spotify_client_id";
   const KEYS_HOSTS = ["my-stm.vercel.app"];  // the domains in your redirect URIs, or [] to skip the check
   ```
   Until the keys and the domain match, the page shows a **Setup required** banner, so a copy never sends people to someone else's Spotify app.

### 2. Deploy

1. In Vercel, **Add New > Project** and import your fork. Framework preset: **Other**; no build command, no output directory.
2. Deploy. The address Vercel gives you must match a redirect URI from step 1 exactly. Each push to your main branch deploys again.

### 3. Add your listeners

In the Spotify dashboard, open your app, then **User Management**, and add each person with their name and the **email of their Spotify account** (up to 5, you included). Anyone not on the list can sign in, but Spotify refuses every request; the app tells them to ask you to add them.

### 4. Optional: pick up a radio on another device

The phone hand-off needs a small Redis store. In your Vercel project, open **Storage**, create an **Upstash for Redis** database (the free plan is plenty) and connect it to the project; Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Redeploy. Without it everything else works; the hand-off stays off.

### Other hosts and local testing

- **Other static hosts** (GitHub Pages, Netlify, Cloudflare Pages) serve the app but not the two functions: Discover then plays only artists similar to your top artists, and the hand-off stays off.
- **Locally:** serve the folder (`npx serve -l 3000`) and open `http://127.0.0.1:3000/`: not `localhost`, and not the file directly, because Spotify's login needs a registered address. The functions only run under `vercel dev`.

### Troubleshooting

| What you see | What to do |
|---|---|
| Spotify says **INVALID_CLIENT: Invalid redirect URI** | The page address and the redirect URIs in the Spotify dashboard differ (check https, the domain and the trailing slash), or `js/config.js` still has someone else's Client ID |
| "This Spotify account can't use this copy of the app yet" | Add that person's Spotify email under User Management (step 3) |
| "Spotify Premium is needed to play in this browser" | That account is not Premium; it can still play on another device where Spotify is open |
| Nothing works for anyone | The app owner's Premium lapsed: Spotify turns Development Mode apps off until it is renewed |
| "Spotify is limiting searches" | Spotify's rate limit; wait the time shown. The limit is per app, so everyone using your copy shares it |
| Discover only plays similar artists | The `api/lfm-station` function is not running (a host other than Vercel) |

## Privacy

- Your Spotify tokens and Last.fm username stay in your browser (`localStorage`); Disconnect removes the tokens.
- The app reads only public data from Last.fm (your scrobbles and play counts).
- With the optional store, `api/session.js` keeps the running radio's song list and state under your Spotify user id for 12 hours, so another device can pick it up. Your token is sent to it only to ask Spotify who you are; it is never stored or logged.
- No analytics, no cookies, no other servers.

## Requirements

- A Last.fm account with scrobble history
- A Spotify Premium account (required for playback control and in-browser SDK streaming)

## Tech stack

- Vanilla HTML/CSS/JS (multi-file, no framework or build step)
- Last.fm API (scrobble history)
- Spotify Web API (search, playback, playlists, liked songs)
- Spotify Web Playback SDK (in-browser audio streaming)
- Spotify PKCE OAuth (no client secret)
- Upstash Redis (optional, for the hand-off between devices)
- Barlow font (matching Last.fm's style) and Phosphor icons

## Rate limit strategy

Spotify's API in Development Mode has strict rate limits, shared by everyone using the same app. The app handles this with:

- **Small first batch**: the radio starts after the first match; the rest of the queue is searched while it plays
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
