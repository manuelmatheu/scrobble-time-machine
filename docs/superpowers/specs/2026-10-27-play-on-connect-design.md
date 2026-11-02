# Play on (Spotify Connect) and session hand-off: Design Spec

Date: 2026-10-27
Status: written from the conversation, pending the owner's review
Design reference: Design canvas "Radio Home Redesign", column "Proposal · Play on", direction B (https://claude.ai/artifact/RGMxpKGBicDSnLjYzvETMv). Code wins over the mockups where they disagree.
Protocol reference: librespot (https://github.com/librespot-org/librespot), for how Spotify Connect devices join the device list and take transfers.

## 1. Intent

**Outcome.** From the desktop or the phone, the owner picks a speaker (or a speaker group) and the radio plays there, without opening the Spotify app. A radio started on the desktop can be picked up on the phone in another room, and the phone keeps that same radio going after the desktop is closed.

**Why.** The Play on picker shipped in v2.9 and was removed in v2.10 (commit `b38dc04`): starting playback from the desktop on another speaker did not work, and the workaround was to open the Spotify app and pick the speaker there. The owner wants that step gone. Today the only device the app plays on is the browser itself; a session moved to a speaker from the Spotify app is followed (`followPlaybackDevice()`), but nothing can be chosen from the app.

**The bar this time (what would make the owner wince).** Desktop and phone get mixed up about what is playing: a window shows a song that is not the one coming out of the speaker, or does not notice that another window or the Spotify app changed it. The previous version failed exactly there.

**For whom.** The owner, one Spotify Premium account, at home: a desktop browser and a phone (the installed PWA or the browser).

## 2. What Spotify allows (the constraints that shape everything)

Findings from the conversation, with librespot as the reference for the Connect side:

- **Only signed-in devices can be picked.** `/me/player/devices` lists a device only after it has signed in to Spotify itself. A Connect speaker signs in when a Spotify app on the same Wi-Fi finds it (`_spotify-connect._tcp` over mDNS) and hands it the user's encrypted credentials (`getInfo` / `addUser`, librespot `discovery/src/server.rs`). A web page cannot browse the local network, cannot reach a speaker's local address from https, and does not hold that credentials blob (a Web API token is not one; librespot notes the access-token type makes clients fail). **So the app cannot wake a sleeping speaker.** A speaker that was used recently from the Spotify app, or one that stays signed in (for example a Raspberry Pi running librespot/Raspotify), is listed and can be picked.
- **Google Cast speakers** are listed only while Spotify's Cast receiver runs on them. Waking them from outside Spotify's own apps relied on web-player cookie credentials, which Spotify blocked on 2025-05-07.
- **Sonos** is listed but refuses `play`, `next` and transfer from other apps (`403 Restricted device`, `is_restricted: true`).
- **Casting** does not help: the Web Playback SDK is a Connect device only, and Spotify's audio is protected, so there is no file to hand to Google's Cast sender. Chrome's "Cast tab" may carry the browser's sound to a Nest speaker; that is the user's own Chrome feature, outside this work (untested whether it carries protected audio).
- **Phones have no browser player** (the Web Playback SDK does not run there). A phone plays through a Connect device: its own Spotify app (type `Smartphone`) or a speaker. Phones also pause web pages in the background, so a phone cannot add songs on a timer while it is in a pocket.
- **Spotify's own apps share the queue** through an internal channel (librespot's dealer / connect-state) that only accepts Spotify's own logins. This app sees only the public `/me/player` and `/me/player/queue`: the current song, the device, and the upcoming URIs, never the radio's station, moments or scrobble dates. Carrying those between devices needs a store of our own (part 2).

## 3. Goals, non-goals, anti-goals

**Goals.**
1. Pick where the radio plays from the radio view and from the home card, on desktop and phone, among the devices Spotify lists.
2. Switching device mid-session keeps the song, position and queue.
3. Every open window shows what is actually playing and where, within a few seconds of a change made anywhere (either device, the Spotify app, a speaker's own buttons).
4. A radio started on one device can be continued on another: the phone shows the full radio (Up next, moment panel, scrobble dates) and, once the desktop is gone, keeps the same radio going.

**Non-goals.**
- Waking sleeping speakers or Cast devices, and anything built on Spotify's private APIs or web-player cookies.
- Controlling Sonos (it stays listed but greyed out).
- Casting (Google Cast sender, Chrome tab casting).
- Volume for remote devices (the volume slider stays a this-browser control, as today).
- Syncing anything other than the running radio (likes, settings, history) and more than one Spotify account.

**Anti-goals (a failure even if it technically works).**
- A window shows a song, a device or a play state that Spotify does not report.
- Two windows add songs to the same radio, so the list gets songs twice or jumps.
- The app burns through Spotify's request limit: no 100-song batches, no polling from hidden pages.
- The picker breaks the player layout again (the v2.10 removal reason).

## 4. Part 1: the Play on picker (no server)

Ships first, on its own.

### 4.1 Where it shows (direction B on the canvas)

- **Radio view:** a "Playing on <device> · <type>" bar directly under the now-playing card (`.radio-now`), with a **Change** button (min 44px). The controls row is not touched. Desktop: Change opens the device list as a dropdown anchored under the bar. Phone (below 720px): it opens as a bottom sheet with a grabber and a scrim.
- **Home card:** a "Plays on <device> · Change" row just above the Start button, on desktop and phone. It sets where the next radio starts.
- **Phone home while something plays on a Connect device:** a strip "Playing on <device> · <track> · <artist>" with Pause and Next (44px), above the username field. This is shown whenever Spotify reports playback on another device and this window has no radio of its own, whatever is playing (it is the truth of the speaker, not a claim that it is our radio). Part 2 adds "Open radio" here when the song belongs to a radio in the session note.
- Boards: `Connect-B-wide`, `Connect-home-wide`, `Connect-B-mobile`, `Connect-sheet-mobile`, `Connect-pickup-mobile`, each with a light twin. Board A (button in the controls row) is not built.

### 4.2 The device list

- Source: `GET /me/player/devices`. On a desktop with the SDK ready, "This browser" (the SDK device) is always first, even before Spotify lists it.
- Other STM windows' players (`name === STM_PLAYER_NAME` and not our `sdkDeviceId`) are **left out**: the app never plays on another window's player (existing rule in `spotifyPlay()`).
- Each row: icon by type (computer, smartphone, speaker, cast audio / group, TV, car), name, a second line with the kind and "playing" for the active one, a check mark on the current device. On a phone its own Spotify app is labelled "This phone · Plays through your Spotify app".
- `is_restricted` devices go under a "Can't play from here" heading, disabled, with the line "<Brand>. Spotify doesn't let other apps control it." (Sonos is the known case; for others: "Spotify doesn't let other apps control it.").
- Under the list, always: "Don't see a speaker? Play something on it once from the Spotify app, then Refresh." No "asleep" rows: the app cannot know about devices Spotify does not list.
- A **Refresh** button, and while the list is open it re-reads by itself every 4 s (the v2.9 behavior; a speaker started from the Spotify app shows up without a click). The quiet refresh does not rebuild the list when nothing changed, so a tap never lands on a row that just moved.
- On a phone with nothing listed: "No devices found. Open Spotify on this phone or on a speaker, then Refresh."

### 4.3 Picking a device

- **No radio running:** the pick is where the next radio starts (`startRadio()` -> `spotifyPlay()` uses the picked device). Kept in memory for this page only (an old `stm_device` key is still deleted on load). Default: this browser when the SDK is ready; on a phone, the active device if there is one, else the phone's Spotify app if listed.
- **Radio running:** move it. If the radio holds songs Spotify was not sent yet (`radioUnsentUris()` non-empty or `radioPendingReissue`), send the whole list from the current song at the current position (`spotifyPlay()` to the new device), as the v2.9 code did; otherwise a transfer (`PUT /me/player` with `device_ids` and `play` as it was) keeps Spotify's queue and position. Then follow the device (polling) or stop polling when it is this browser.
- **Failure** (404 gone, 403 restricted, 5xx): an error toast "Couldn't play on <device>. Play something on it from the Spotify app, then try again.", the music stays where it was, and the list refreshes.
- After a pick (success or not), the window re-reads `/me/player` after about 1.5 s instead of waiting for the next 5 s poll.

### 4.4 What's playing is always true

- The source of truth is Spotify's state: the SDK's `player_state_changed` while this browser plays, otherwise `/me/player`. The Playing on bar, the hero, the progress bar and the Up next highlight come from it, never from what the app last sent or picked.
- The device in the bar is the device Spotify reports, so a speaker change made in the Spotify app shows in every open window on its next reading. A window that is not the player polls every `POLL_INTERVAL` (5 s) while visible, and re-reads right after its own actions.
- No reading (a failed or empty poll) never leaves an old song looking live: after two empty readings the card shows a neutral "Checking what's playing…" state. The existing `releaseDeadDevice()` rule (a followed device that went away) stays.
- Outside music (Spotify plays something that is not the radio) keeps today's behavior: the window shows its own radio paused with the existing warning; Play brings its queue back (`radioPausedElsewhere()` / `radioResumeHere()`). The phone home strip of 4.1 is the one place that shows whatever plays.
- Hidden pages do not poll (`document.visibilityState`); on becoming visible a window reads `/me/player` at once.

## 5. Part 2: the session hand-off (small server)

### 5.1 The session note

While a radio runs, the window that drives it keeps a **session note** on the server, one per Spotify account. The note is everything another device needs to show the radio and carry it on:

- `v`, `sessionId` (random, new on every start), `driverId` (a random id per page load), `beatAt` (last write, server time), `released` (true once the driver's page closed)
- the radio's settings: Last.fm `username`, `station`, `how`, `year`, `range`, `balance`, `total` (`radioTotal`)
- the songs: from a few before the current one to the end of the queue, each with `uri`, title, artist, album, `art`, and the `trackMeta` fields the UI uses (scrobble time / year, `fromPast`, `source`, `kind`, `artistPlays`, the moment id); the moments those songs belong to (`id`, `label`, `chip`, `start`, `end`, `size`); `momentSeq`; `contextLastUri`
- what the engine needs to continue without repeats: the unused picks (`radioCarry`, so a moment continues in order) and the last 300 `radioSeen` keys

The driver writes the note when a fill adds songs, on every track change, and as a heartbeat every 60 s while it runs (a background desktop tab is throttled to about once a minute, which is enough). When the driver's page closes (`pagehide`) it sends `released: true` with `navigator.sendBeacon`.

### 5.2 Who drives

- Exactly one window adds songs: the note's `driverId`. Writes carry the `driverId` they expect, and the server refuses a write from a window that is no longer the driver (HTTP 409); that window then becomes a follower.
- A **follower** window (any other open window or device) shows the radio from the note when the song Spotify reports is in it: hero, Up next, moment panel, dates. It does not fill, seam or re-issue on its own. Its controls work as a remote (Pause, Next, Previous) through the Web API; the driver sees the change on its next reading and tops up as today. If the reported song is not in the note, the follower does not pretend it is the radio (4.4 applies).
- A follower re-reads the note when the reported song changes or is missing from its copy, and every 30 s while visible, so it sees the songs the driver adds and notices a release. (My call.)
- A tap on an Up next row in a follower plays the note's songs from that row on the current device, ending at the note's last song (the driver's `contextLastUri`), so the driver's seam timing stays right. It is disabled while the music plays on another STM window's browser player, which the app never plays on. (My call.)
- **Taking over:** a window becomes the driver when the note is `released`, or when its `beatAt` is older than 3 minutes (the computer went to sleep without a beacon). It also becomes the driver of a **new** radio when the user starts one there; the old driver's next write gets 409, and it becomes a follower of the new radio, showing it like any follower, with no toast. (My call: following is more truthful than ending.)
- The window never takes over a radio whose music plays on another STM window's browser player (that window is alive and driving).

### 5.3 A phone driving

A window without a browser player (every phone) cannot top up from the background. Its rule, from the conversation:

- When the phone becomes the driver, and every time the app is opened or comes back to the screen while it is the driver, it makes sure **10 songs** are queued after the current one (`PHONE_TOPUP = 10`), from the same station and options, continuing the current moment. It does not add more than that per opening.
- It sends them to Spotify right after the fill, from the current song at the current position (one short restart of the song on the speaker, at the moment the user is looking), instead of waiting for the seam: the phone may be locked before the seam comes. (The builder may instead use the seam when the page stays visible until then.)
- When those songs run out and nobody opened the app, the music stops (or Spotify's autoplay takes over). Opening the app on any device adds the next batch.
- The desktop keeps its current top-up behavior when it drives.
- What carries over exactly: Library (Songs, Moments, one year) continues as is. Discover and Mix rebuild their candidate pools on the new driver (the seeds and buffers are not in the note), so the next picks differ from what the desktop would have chosen; dedupe still holds through `radioSeen`.

### 5.4 The server piece

- `api/session.js`, a Vercel function next to `api/lfm-station.js`, plain Node and `fetch`, no npm dependencies (the project has no package manager). Methods: `GET` (read the note) and `PUT` (write it, with the expected `driverId`), plus `POST ?release` for the beacon.
- **Who you are:** the browser sends its Spotify access token (`Authorization: Bearer`, or in the beacon body); the function calls `GET https://api.spotify.com/v1/me` and keys the note by the Spotify user id. It keeps token -> id for 5 minutes in memory to avoid a call per write. Tokens are never stored or logged.
- **Storage:** Upstash Redis through the Vercel Marketplace (free tier), called over its REST API with `fetch` (`KV_REST_API_URL` / `KV_REST_API_TOKEN`). Key `stm:session:<spotify user id>`, expires 12 hours after the last write. A note is capped at 64 KB.
- **Without the store** (local `npx serve`, a preview without the env vars, the store down): the function answers 503 and the app runs exactly as after part 1, with no hand-off and no error toast. A note that fails to parse or has an unknown `v` is ignored.
- The driver check is a read then a write, not atomic. With one account and a few windows that is acceptable; a lost race costs one extra fill, which the 409 on the next write corrects.
- Setup the owner does once: add Upstash Redis to the Vercel project (production and the `stm-preview` preview), which sets the two env vars.

## 6. Decisions

| Decision | Choice | Whose |
|---|---|---|
| Placement | B: Playing on bar under the player, Home "Plays on" row, phone sheet | Owner |
| Sleeping / asleep devices | Not shown; a hint explains how to make a speaker appear | Owner (scoped list) |
| Phone home while a speaker plays | Shows and controls what plays; no claim it is the desktop's radio without the note | Owner |
| Phone keeps the same radio going | Yes, after the desktop is gone | Owner |
| Phone top-up | 10 songs per opening, no 100-song batches, more by opening the app again | Owner |
| Outside music | Keep today's paused-radio behavior | Owner |
| Where the note lives | Vercel function + Upstash Redis, keyed by Spotify user id | My call |
| Stale driver | 3 minutes without a heartbeat, or released by beacon | My call |
| Phone sends its songs | Right after the fill, at the current position | My call |
| Device pick persistence | In memory only | My call |
| Code layout | New `js/connect.js` (picker, device list, note sync), loaded after `player.js` and before `radio.js`; added to `sw.js` SHELL | My call |
| Light theme green text | New token for green text in light (Spotify green on white fails 4.5:1); fills and borders keep `--spotify-green` | My call |
| Version | v2.12 when part 2 ships (part 1 alone rides as v2.12 too if released first) | My call |
| Delivery | Two pull requests: part 1, then part 2 on a branch restarted from `origin/main` | My call |
| Follower controls | Remote via the Web API; row taps play the note's songs on the current device | My call |
| New radio elsewhere | The old driver follows the new radio, no toast | My call |

## 7. Testing

- Node tests (dependency-free, like the others): the device list builder (order, this browser first, other STM players left out, restricted rows and their text), the driver decision (fresh / stale / released / other session / 409), the note's build and parse (round trip, cap, unknown version), the phone top-up count, and `api/session.js` with `fetch` and the store stubbed (auth, 409, 503 without env vars, expiry).
- Existing tests keep passing; `design-system` and `contrast` cover the new tokens.
- Manual, on the preview (`stm-preview.vercel.app`) with the store connected: pick a speaker before starting and mid-session (desktop and phone); move the music from the Spotify app and check both windows follow within a few seconds; pause and skip from the Spotify app, the phone and a speaker; pick a Sonos (greyed out); start on desktop, open the phone, check the full radio view; close the desktop tab and check the phone takes over and adds 10 songs; put the computer to sleep and check the 3-minute takeover; start a new radio on the phone while the desktop runs and check the desktop lets go quietly.

## 8. Left to the builder

- Exact markup, class names and CSS of the bar, dropdown, sheet and strips, following the canvas boards and `DESIGN.md`.
- How the follower view is assembled from the note (rebuilding `matchedUris` / `trackMeta` / `uriToIndices` from the note's songs is the expected way).
- The note's exact JSON shape within 5.1.
- Docs: `CLAUDE.md`, `docs/architecture.md` (replace "No device picker"), `DESIGN.md`, `ROADMAP.md`, `changelog.html`, the version in `index.html`.

## 9. Open

- The owner mentioned a "Spotify Fast" repo as a reference; which repo that is was not settled. If it adds something, it goes into section 2.
