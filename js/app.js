// ═════════════════════════════════════════════════════════════════════════════
// INIT
// ═════════════════════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
  $("currentUrl").textContent = SPOTIFY_REDIRECT_URI;
  if (!stmSetupNeeded(location.hostname)) $("setupBanner").style.display = "none";
  // Back from Spotify's login: a code is used only when the state matches the one this browser sent; a cancel or error says so
  const qs = new URLSearchParams(window.location.search);
  const back = spotifyAuthReturn(qs, qs.has("code") || qs.has("error") ? spotifyTakeAuthState() : null);
  const code = back && back.code;
  if (back && back.error) { window.history.replaceState({}, document.title, window.location.pathname); showStatus(back.error, "error"); }
  const connected = t => { spotifyToken = t; updateSpotifyUI(true); if (window.Spotify && window.Spotify.Player) initSDKPlayer(); spotifyCheckAccess(t); };
  // Returning users (a stored session or the Spotify redirect) go straight to the Home card; everyone else sees the landing first
  let hasSession = !!code; try { hasSession = hasSession || !!localStorage.getItem("spotify_refresh_token"); } catch {}
  showLanding(!hasSession);
  if (code) exchangeCodeForToken(code).then(connected).catch(() => { showStatus("Spotify auth failed", "error"); updateSpotifyUI(false); });
  else getSpotifyToken().then(t => { if (t) connected(t); else updateSpotifyUI(false); });

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
  if (window.ResizeObserver && $("stationPanelIn")) { new ResizeObserver(fitStationPanel).observe($("stationPanelIn")); fitStationPanel(); }
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
    if (e.key === "Escape" && connectIsOpen()) { connectClose(); return; }  // the Play on list first: it sits on top
    if (e.key === "Escape" && $("changelogOverlay").style.display !== "none") { closeChangelog(); return; }
    if (e.key === "Escape" && currentPhase === "working") { handleReset(); return; }
  });

  // Installable app: the service worker needs https (or a local address)
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) navigator.serviceWorker.register("sw.js").catch(() => {});
  updateRadioButton();
});
