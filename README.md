# Scrobble Time Machine

Your Last.fm history meets Spotify playback. An endless radio of your own past.

**Use it:** [https://stm-lastfm.vercel.app/](https://stm-lastfm.vercel.app/) (bring your own Spotify app, see [Getting started](#getting-started))

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
- **Pick it up on your phone** - start a radio on the computer, open the app on your phone and tap Open radio
- **Installable** - add it to your phone's home screen like an app
- **Embedded player** - the Spotify Web Playback SDK plays in the browser; no other device needed
- **Liked songs** - a heart button saves or removes the current song in your Spotify Liked Songs

## Getting started

Spotify only lets an app in Development Mode serve 5 people, so everyone brings their own Spotify app. It's free and takes about 3 minutes. The first screen walks you through it; here are the same steps.

**You need:** a Last.fm account with a public profile, and Spotify **Premium** (Spotify requires it to own a developer app and to play in the browser).

1. **Create the app.** Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), log in with your Spotify account and press **Create app**. Any name and description will do.
2. **Tick two APIs.** Under **Which API/SDKs are you planning to use?** tick **Web API** and **Web Playback SDK**.
3. **Add the Redirect URI.** Paste `https://stm-lastfm.vercel.app/` into **Redirect URIs**, press Add, then Save. It must match exactly, slash included. (The first screen shows the address to use, with a Copy button.)
4. **Copy the Client ID.** Open the app's **Settings**. The Client ID is at the top. You don't need the Client secret.
5. **Paste it into Scrobble Time Machine**, enter your Last.fm username and press **Connect Spotify**.
6. **Optional: invite friends.** In your app's **User Management**, add the name and Spotify email of up to 4 more people. They paste the same Client ID.

Your Client ID stays in your browser. It isn't a password: it only tells Spotify which app is asking. To switch apps later, open the **Spotify** menu in the header and choose **Use a different Spotify app**.

### Troubleshooting

| What you see | What to do |
|---|---|
| Spotify says **INVALID_CLIENT: Invalid redirect URI** | The Redirect URI in your Spotify app is not exactly the app's address (check https, the domain and the trailing slash) |
| Spotify says **INVALID_CLIENT: Invalid client** | The Client ID was mistyped, or the app was deleted: choose **Use a different Spotify app** and paste it again |
| "This Spotify account isn't on that Spotify app's user list yet" | Using a friend's app: they add your Spotify email under User Management. Your own app: sign in with the Spotify account that created it |
| "Spotify Premium is needed to play in this browser" | That account is not Premium; it can still play on another device where Spotify is open |
| Nothing works with your app anymore | The app owner's Premium lapsed: Spotify turns Development Mode apps off until it is renewed |
| "Spotify is limiting searches" | Spotify's rate limit for your app; wait the time shown |

## How it works

No build step, no dependencies. Everything runs in the browser (plain HTML, CSS and JS files), plus two small Vercel functions:

- `api/lfm-station.js` fetches Last.fm's recommended station for Discover (Last.fm does not let a browser fetch it directly; it needs no key, only your username)
- `api/session.js` keeps a small note per Spotify user, so a radio can be picked up on another device (needs an Upstash Redis store)

Sign-in is Spotify's PKCE flow with your own app's Client ID, so there is no client secret anywhere. The Last.fm API key in `js/config.js` is shared: it only names the app, and Last.fm answers for whichever public username is asked.

## Privacy

- Your Spotify tokens, your app's Client ID and your Last.fm username stay in your browser (`localStorage`); Disconnect removes the tokens, and Use a different Spotify app also forgets the Client ID.
- The app reads only public data from Last.fm (your scrobbles and play counts).
- `api/session.js` keeps the running radio's song list and state under your Spotify user id for 12 hours, so another device can pick it up. Your token is sent to it only to ask Spotify who you are; it is never stored or logged.
- No analytics, no cookies, no other servers.

## Self-hosting (optional)

You don't need your own copy to use the app. If you want one anyway:

1. **Fork this repo** and import it into Vercel (**Add New > Project**, framework preset **Other**, no build command).
2. **Your redirect URI:** visitors register your copy's address (for example `https://my-stm.vercel.app/`) in their Spotify apps; the first screen shows it to them.
3. **Optional, built-in Spotify app:** to skip the Client ID step for your visitors, put your app's Client ID in `SPOTIFY_CLIENT_ID` in `js/config.js` and your domains in `KEYS_HOSTS`. Your app's 5-person limit then applies to everyone using your copy. On a domain not in `KEYS_HOSTS` the page shows **Setup required**.
4. **Optional, your own Last.fm key:** replace `LASTFM_API_KEY` (create one at [last.fm/api/account/create](https://www.last.fm/api/account/create)).
5. **Optional, phone hand-off:** in your Vercel project open **Storage**, create an **Upstash for Redis** database (the free plan is plenty) and connect it; Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Redeploy. Without it everything else works; the hand-off stays off.

- **Other static hosts** (GitHub Pages, Netlify, Cloudflare Pages) serve the app but not the two functions: Discover then plays only artists similar to your top artists, and the hand-off stays off.
- **Locally:** serve the folder (`npx serve -l 3000`), open `http://127.0.0.1:3000/` (not `localhost`, and not the file directly), and add `http://127.0.0.1:3000/` as a redirect URI in your Spotify app. The functions only run under `vercel dev`.

## Tech stack

- Vanilla HTML/CSS/JS (multi-file, no framework or build step)
- Last.fm API (scrobble history)
- Spotify Web API (search, playback, playlists, liked songs)
- Spotify Web Playback SDK (in-browser audio streaming)
- Spotify PKCE OAuth with each visitor's own Client ID (no client secret)
- Upstash Redis (for the hand-off between devices)
- Barlow font (matching Last.fm's style) and Phosphor icons

## Rate limit strategy

Spotify's API in Development Mode has strict rate limits, per app. The app handles this with:

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
