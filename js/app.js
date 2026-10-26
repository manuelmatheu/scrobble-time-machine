// ═════════════════════════════════════════════════════════════════════════════
// INIT
// ═════════════════════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
  $("currentUrl").textContent = SPOTIFY_REDIRECT_URI;
  if (LASTFM_API_KEY !== "YOUR_LASTFM_API_KEY" && SPOTIFY_CLIENT_ID !== "YOUR_SPOTIFY_CLIENT_ID") $("setupBanner").style.display = "none";
  const code = new URLSearchParams(window.location.search).get("code");
  // Returning users (a stored session or the Spotify redirect) go straight to the Home card; everyone else sees the landing first
  let hasSession = !!code; try { hasSession = hasSession || !!localStorage.getItem("spotify_refresh_token"); } catch {}
  showLanding(!hasSession);
  if (code) exchangeCodeForToken(code).then(t => { spotifyToken = t; updateSpotifyUI(true); if (window.Spotify && window.Spotify.Player) initSDKPlayer(); }).catch(() => { showStatus("Spotify auth failed", "error"); updateSpotifyUI(false); });
  else getSpotifyToken().then(t => { if (t) { spotifyToken = t; updateSpotifyUI(true); if (window.Spotify && window.Spotify.Player) initSDKPlayer(); } else updateSpotifyUI(false); });

  // Restore saved username from localStorage or sessionStorage
  const savedUser = localStorage.getItem("lastfm_username") || sessionStorage.getItem("lastfm_username");
  if (savedUser) $("usernameInput").value = savedUser;
  $("landingUser").value = $("usernameInput").value; landingSync();
  refreshHomeMeta();
  refreshLibraryYears();
  const saved = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
  radioSetHow(saved("stm_library_how", "songs"));
  radioSetYear(saved("stm_library_year", "0"));
  radioFillYears();  // until the first scrobble's year arrives: this year down to the saved one
  radioSetStation(saved("stm_station", "library"));
  radioSetBalance(saved("stm_mix_balance", "balanced"));
  loadPlaybackDevice();

  // Landing: the username field mirrors #usernameInput; Connect Spotify unlocks once there is a username
  $("landingUser").addEventListener("input", () => {
    $("usernameInput").value = $("landingUser").value;
    landingSync();
    const user = $("landingUser").value.trim();
    if (user) { try { localStorage.setItem("lastfm_username", user); sessionStorage.setItem("lastfm_username", user); } catch {} }
  });
  $("landingUser").addEventListener("keydown", e => { if (e.key === "Enter" && !$("landingConnectBtn").disabled) initiateSpotifyAuth(); });

  // Username: save on change, update button
  $("usernameInput").addEventListener("input", updateRadioButton);
  $("usernameInput").addEventListener("change", () => {
    const user = $("usernameInput").value.trim();
    if (user) {
      localStorage.setItem("lastfm_username", user);
      sessionStorage.setItem("lastfm_username", user);
    }
    refreshHomeMeta();
    refreshLibraryYears();
  });
  $("usernameInput").addEventListener("keydown", e => { if (e.key === "Enter" && !$("radioBtn").disabled) startRadio(); });

  // Global keyboard shortcuts
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && $("changelogOverlay").style.display !== "none") { closeChangelog(); return; }
    if (e.key === "Escape" && currentPhase === "working") { handleReset(); return; }
  });

  updateRadioButton();
});
