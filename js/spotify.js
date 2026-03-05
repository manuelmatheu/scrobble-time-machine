
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
  window.location.href = "https://accounts.spotify.com/authorize?" + new URLSearchParams({ client_id:SPOTIFY_CLIENT_ID, response_type:"code", redirect_uri:SPOTIFY_REDIRECT_URI, scope:SPOTIFY_SCOPES, code_challenge_method:"S256", code_challenge:ch });
}
async function exchangeCodeForToken(code) {
  const r = await fetch("https://accounts.spotify.com/api/token", { method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body: new URLSearchParams({ client_id:SPOTIFY_CLIENT_ID, grant_type:"authorization_code", code, redirect_uri:SPOTIFY_REDIRECT_URI, code_verifier:sessionStorage.getItem("spotify_code_verifier") }) });
  if (!r.ok) throw new Error("Token exchange failed");
  const d = await r.json();
  sessionStorage.setItem("spotify_access_token", d.access_token);
  sessionStorage.setItem("spotify_refresh_token", d.refresh_token);
  sessionStorage.setItem("spotify_token_expires", Date.now() + d.expires_in * 1000);
  const u = sessionStorage.getItem("lastfm_username"); if (u) { $("usernameInput").value = u; refreshYearsForUser(); }
  window.history.replaceState({}, document.title, SPOTIFY_REDIRECT_URI);
  return d.access_token;
}
async function refreshSpotifyToken() {
  const rt = sessionStorage.getItem("spotify_refresh_token"); if (!rt) return null;
  const r = await fetch("https://accounts.spotify.com/api/token", { method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body: new URLSearchParams({ client_id:SPOTIFY_CLIENT_ID, grant_type:"refresh_token", refresh_token:rt }) });
  if (!r.ok) return null; const d = await r.json();
  sessionStorage.setItem("spotify_access_token", d.access_token);
  if (d.refresh_token) sessionStorage.setItem("spotify_refresh_token", d.refresh_token);
  sessionStorage.setItem("spotify_token_expires", Date.now() + d.expires_in * 1000);
  return d.access_token;
}
async function getSpotifyToken() { const e = parseInt(sessionStorage.getItem("spotify_token_expires")||"0"); if (Date.now() < e - 60000) return sessionStorage.getItem("spotify_access_token"); return refreshSpotifyToken(); }

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

async function spotifyPlay(token, uris) {
  // First try without device_id (works if a device is already active)
  let r = await fetch("https://api.spotify.com/v1/me/player/play", {
    method:"PUT", headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"}, body:JSON.stringify({uris}) });
  if (r.ok || r.status === 204) return true;

  // If that failed, find a device and target it explicitly
  const devices = await getSpotifyDevices(token);
  if (!devices.length) return false;
  // Prefer active device, then any non-restricted device
  const device = devices.find(d => d.is_active) || devices.find(d => !d.is_restricted) || devices[0];
  r = await fetch("https://api.spotify.com/v1/me/player/play?" + new URLSearchParams({device_id: device.id}), {
    method:"PUT", headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"}, body:JSON.stringify({uris}) });
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
    try {
      const r = await fetch("https://api.spotify.com/v1/playlists/" + playlistId + "/tracks", {
        method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ uris: batch })
      });
      if (!r.ok) return false;
    } catch { return false; }
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
    if (!playlist) throw new Error("Could not create playlist. You may need to reconnect Spotify with updated permissions.");
    // Try adding tracks directly
    const addOk = await addTracksToPlaylist(token, playlist.id, uris);
    if (addOk) {
      btn.textContent = "Saved!";
      btn.className = "btn-save-playlist saved";
      if (playlist.external_urls && playlist.external_urls.spotify) {
        window.open(playlist.external_urls.spotify, "_blank");
      }
    } else {
      // Dev mode fallback: copy URIs to clipboard, open empty playlist
      await navigator.clipboard.writeText(uris.join("\n"));
      btn.textContent = "Playlist created - URIs copied!";
      btn.className = "btn-save-playlist saved";
      showStatus("Playlist created but tracks must be added manually (dev mode limit). " + uris.length + " track URIs copied to clipboard - paste into Spotify search.", "success");
      if (playlist.external_urls && playlist.external_urls.spotify) {
        window.open(playlist.external_urls.spotify, "_blank");
      }
    }
  } catch (err) {
    btn.textContent = "Save as Playlist";
    btn.disabled = false;
    showStatus(err.message, "error");
  }
}
