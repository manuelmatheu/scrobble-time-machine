
// ═════════════════════════════════════════════════════════════════════════════
// PKCE + AUTH
// ═════════════════════════════════════════════════════════════════════════════
function rndStr(n) { const c="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~",a=new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a,b=>c[b%c.length]).join(""); }
async function sha256(s) { return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); }
function b64url(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }

async function initiateSpotifyAuth() {
  const v = rndStr(128), ch = b64url(await sha256(v));
  sessionStorage.setItem("spotify_code_verifier", v);
  sessionStorage.setItem("lastfm_username", $("usernameInput").value.trim());
  window.location.href = "https://accounts.spotify.com/authorize?" + new URLSearchParams({ client_id:SPOTIFY_CLIENT_ID, response_type:"code", redirect_uri:SPOTIFY_REDIRECT_URI, scope:SPOTIFY_SCOPES, code_challenge_method:"S256", code_challenge:ch, show_dialog:"true" });
}
async function exchangeCodeForToken(code) {
  const r = await fetch("https://accounts.spotify.com/api/token", { method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body: new URLSearchParams({ client_id:SPOTIFY_CLIENT_ID, grant_type:"authorization_code", code, redirect_uri:SPOTIFY_REDIRECT_URI, code_verifier:sessionStorage.getItem("spotify_code_verifier") }) });
  if (!r.ok) throw new Error("Token exchange failed");
  const d = await r.json();
  localStorage.setItem("spotify_access_token", d.access_token);
  localStorage.setItem("spotify_refresh_token", d.refresh_token);
  localStorage.setItem("spotify_token_expires", Date.now() + d.expires_in * 1000);
  const u = sessionStorage.getItem("lastfm_username"); if (u) { $("usernameInput").value = u; refreshYearsForUser(); }
  window.history.replaceState({}, document.title, window.location.pathname);
  return d.access_token;
}
async function refreshSpotifyToken() {
  const rt = localStorage.getItem("spotify_refresh_token"); if (!rt) return null;
  const r = await fetch("https://accounts.spotify.com/api/token", { method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body: new URLSearchParams({ client_id:SPOTIFY_CLIENT_ID, grant_type:"refresh_token", refresh_token:rt }) });
  if (!r.ok) return null; const d = await r.json();
  localStorage.setItem("spotify_access_token", d.access_token);
  if (d.refresh_token) localStorage.setItem("spotify_refresh_token", d.refresh_token);
  localStorage.setItem("spotify_token_expires", Date.now() + d.expires_in * 1000);
  return d.access_token;
}
async function getSpotifyToken() { const e = parseInt(localStorage.getItem("spotify_token_expires")||"0"); if (Date.now() < e - 60000) return localStorage.getItem("spotify_access_token"); return refreshSpotifyToken(); }
function disconnectSpotify() {
  localStorage.removeItem("spotify_access_token");
  localStorage.removeItem("spotify_refresh_token");
  localStorage.removeItem("spotify_token_expires");
  spotifyToken = null;
  if (window._stmPlayer) { window._stmPlayer.disconnect(); window._stmPlayer = null; }
  sdkReady = false; sdkDeviceId = null;
  updateSpotifyUI(false);
}

// ═════════════════════════════════════════════════════════════════════════════
// SPOTIFY API HELPERS (auto-refresh on 401, surface 403 scope errors)
// ═════════════════════════════════════════════════════════════════════════════
async function spGet(path) {
  let token = await getSpotifyToken(); if (!token) throw new Error("no token");
  let r = await fetch("https://api.spotify.com/v1" + path, { headers: { Authorization: "Bearer " + token } });
  if (r.status === 401) {
    token = await refreshSpotifyToken();
    if (token) r = await fetch("https://api.spotify.com/v1" + path, { headers: { Authorization: "Bearer " + token } });
  }
  if (!r.ok) {
    let msg = r.status;
    try { const e = await r.clone().json(); msg = (e.error && e.error.message) || r.status; } catch {}
    console.error("spGet", path, r.status, msg);
    if (r.status === 403) throw Object.assign(new Error("Spotify 403: " + msg), { status: 403, spotifyMsg: msg });
    throw new Error("Spotify GET " + r.status + ": " + msg);
  }
  return r.json();
}
async function spPut(path, body) {
  let token = await getSpotifyToken(); if (!token) throw new Error("no token");
  const opts = (t) => body !== null
    ? { method: "PUT", headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : { method: "PUT", headers: { Authorization: "Bearer " + t } };
  let r = await fetch("https://api.spotify.com/v1" + path, opts(token));
  if (r.status === 401) { token = await refreshSpotifyToken(); if (token) r = await fetch("https://api.spotify.com/v1" + path, opts(token)); }
  if (r.status === 403) throw Object.assign(new Error("Spotify 403"), { status: 403 });
  if (!r.ok) throw new Error("Spotify PUT " + r.status);
  return r.status === 204 ? {} : r.json().catch(() => ({}));
}
async function spDelete(path, body) {
  let token = await getSpotifyToken(); if (!token) throw new Error("no token");
  const opts = (t) => body !== null
    ? { method: "DELETE", headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : { method: "DELETE", headers: { Authorization: "Bearer " + t } };
  let r = await fetch("https://api.spotify.com/v1" + path, opts(token));
  if (r.status === 401) { token = await refreshSpotifyToken(); if (token) r = await fetch("https://api.spotify.com/v1" + path, opts(token)); }
  if (r.status === 403) throw Object.assign(new Error("Spotify 403"), { status: 403 });
  if (!r.ok) throw new Error("Spotify DELETE " + r.status);
  return {};
}

// ═════════════════════════════════════════════════════════════════════════════
// SPOTIFY API
// ═════════════════════════════════════════════════════════════════════════════
async function spotifySearch(token, artist, track, retries) {
  if (retries === undefined) retries = 2;
  const ck = (artist + "||" + track).toLowerCase();
  if (ck in searchCache) return searchCache[ck];
  try {
    const r = await fetch("https://api.spotify.com/v1/search?" + new URLSearchParams({ q: "track:" + track + " artist:" + artist, type: "track", limit: "1" }), { headers: { Authorization: "Bearer " + token } });
    if (r.status === 429) {
      if (retries <= 0) { lastSearchError = "Rate limited (429)"; return null; }
      const w = parseInt(r.headers.get("Retry-After") || "5"); await new Promise(x => setTimeout(x, (isNaN(w)?5:w) * 1000));
      return spotifySearch(token, artist, track, retries - 1);
    }
    if (!r.ok) { if (!lastSearchError) { try { const e = await r.json(); lastSearchError = r.status+": "+(e.error?e.error.message:r.statusText); } catch(e) { lastSearchError = r.status+": "+r.statusText; } } return null; }
    const d = await r.json(), item = (d.tracks && d.tracks.items && d.tracks.items[0]) || null;
    searchCache[ck] = item; return item;
  } catch (err) { if (!lastSearchError) lastSearchError = err.message; return null; }
}

async function spotifyPlay(token, uris, positionMs) {
  const body = positionMs > 0 ? { uris, position_ms: positionMs } : { uris };
  // Prefer SDK device when ready
  if (sdkReady && sdkDeviceId) {
    try {
      // Transfer playback to SDK device first
      await fetch("https://api.spotify.com/v1/me/player", {
        method:"PUT", headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
        body:JSON.stringify({device_ids:[sdkDeviceId],play:false}) });
      await new Promise(r => setTimeout(r, 300));
      const r = await fetch("https://api.spotify.com/v1/me/player/play?" + new URLSearchParams({device_id:sdkDeviceId}), {
        method:"PUT", headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"}, body:JSON.stringify(body) });
      if (r.ok || r.status === 204) return true;
    } catch {}
  }

  // First try without device_id (works if a device is already active)
  let r = await fetch("https://api.spotify.com/v1/me/player/play", {
    method:"PUT", headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"}, body:JSON.stringify(body) });
  if (r.ok || r.status === 204) return true;

  // If that failed, find a device and target it explicitly
  const devices = await getSpotifyDevices(token);
  if (!devices.length) return false;
  const device = devices.find(d => d.is_active) || devices.find(d => !d.is_restricted) || devices[0];
  r = await fetch("https://api.spotify.com/v1/me/player/play?" + new URLSearchParams({device_id: device.id}), {
    method:"PUT", headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"}, body:JSON.stringify(body) });
  return r.ok || r.status === 204;
}

async function spotifyAddToQueue(token, uri) {
  const r = await fetch("https://api.spotify.com/v1/me/player/queue?" + new URLSearchParams({uri}), {
    method:"POST", headers:{Authorization:"Bearer "+token} });
  return r.ok || r.status === 204;
}

async function getSpotifyDevices(token) {
  const r = await fetch("https://api.spotify.com/v1/me/player/devices", { headers:{Authorization:"Bearer "+token} });
  if (!r.ok) return []; return (await r.json()).devices || [];
}

async function getCurrentlyPlaying(token) {
  try {
    const r = await fetch("https://api.spotify.com/v1/me/player/currently-playing", { headers:{Authorization:"Bearer "+token} });
    if (r.status === 204 || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// =========================================================================
// SPOTIFY WEB PLAYBACK SDK
// =========================================================================
function initSDKPlayer() {
  if (!spotifyToken) return;
  const player = new Spotify.Player({
    name: 'Scrobble Time Machine',
    getOAuthToken: async cb => { const t = await getSpotifyToken(); cb(t); },
    volume: 0.8
  });
  player.addListener('ready', ({ device_id }) => {
    sdkDeviceId = device_id;
    sdkReady = true;
  });
  player.addListener('not_ready', () => {
    sdkReady = false;
    sdkDeviceId = null;
  });
  player.addListener('player_state_changed', state => {
    if (state) onSDKStateChange(state);
  });
  player.addListener('authentication_error', async () => {
    await refreshSpotifyToken();
    player.connect();
  });
  player.connect();
  window._stmPlayer = player;
}

window.onSpotifyWebPlaybackSDKReady = () => { initSDKPlayer(); };


// =========================================================================
// SAVE AS SPOTIFY PLAYLIST
// =========================================================================
async function getSpotifyUserId(token) {
  const r = await fetch("https://api.spotify.com/v1/me", { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) return null;
  return (await r.json()).id;
}

async function createSpotifyPlaylist(token, name, desc) {
  const r = await fetch("https://api.spotify.com/v1/me/playlists", {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ name, description: desc, public: false })
  });
  if (!r.ok) return null;
  return await r.json();
}

async function addTracksToPlaylist(token, playlistId, uris) {
  for (let i = 0; i < uris.length; i += 100) {
    const batch = uris.slice(i, i + 100);
    const method = i === 0 ? "PUT" : "POST";
    try {
      let r = await fetch("https://api.spotify.com/v1/playlists/" + playlistId + "/items", {
        method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ uris: batch })
      });
      if (r.status === 401) {
        const refreshed = await refreshSpotifyToken();
        if (refreshed) {
          r = await fetch("https://api.spotify.com/v1/playlists/" + playlistId + "/items", {
            method, headers: { Authorization: "Bearer " + refreshed, "Content-Type": "application/json" },
            body: JSON.stringify({ uris: batch })
          });
        }
      }
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error("Adding tracks failed (" + r.status + "): " + (err?.error?.message || "unknown"));
      }
    } catch (e) { throw e; }
  }
  return true;
}

async function saveAsPlaylist() {
  const btn = $("savePlaylistBtn");
  btn.disabled = true;
  btn.textContent = "Saving...";
  try {
    const token = await getSpotifyToken();
    if (!token) throw new Error("Spotify expired. Reconnect.");
    const uris = [];
    for (let i = 0; i < allTrackCount; i++) if (matchedUris[i]) uris.push(matchedUris[i]);
    if (!uris.length) throw new Error("No matched tracks to save");
    const name = "Time Machine: " + (playlistLabel || "Random");
    const now = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    const desc = "Created by Scrobble Time Machine on " + now + " - " + uris.length + " tracks";
    const playlist = await createSpotifyPlaylist(token, name, desc);
    if (!playlist) throw new Error("Could not create playlist. Disconnect and reconnect Spotify.");
    await addTracksToPlaylist(token, playlist.id, uris);
    btn.textContent = "Saved! Open";
    btn.className = "btn-save-playlist saved";
    btn.disabled = false;
    btn.onclick = function() {
      if (playlist.external_urls && playlist.external_urls.spotify) {
        window.open(playlist.external_urls.spotify, "_blank");
      }
    };
  } catch (err) {
    btn.textContent = "Save as Playlist";
    btn.disabled = false;
    btn.onclick = saveAsPlaylist;
    const msg = (err.message || "").toLowerCase();
    if (msg.includes("403") || msg.includes("401") || msg.includes("permission")) {
      showStatus("Permission error -- disconnect and reconnect Spotify.", "error");
    } else {
      showStatus("Could not save: " + err.message, "error");
    }
  }
}
