
// ═════════════════════════════════════════════════════════════════════════════
// INIT
// ═════════════════════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
  $("currentUrl").textContent = SPOTIFY_REDIRECT_URI;
  if (LASTFM_API_KEY !== "YOUR_LASTFM_API_KEY" && SPOTIFY_CLIENT_ID !== "YOUR_SPOTIFY_CLIENT_ID") $("setupBanner").style.display = "none";
  const code = new URLSearchParams(window.location.search).get("code");
  if (code) exchangeCodeForToken(code).then(t => { spotifyToken = t; updateSpotifyUI(true); }).catch(() => showStatus("Spotify auth failed", "error"));
  else getSpotifyToken().then(t => { if (t) { spotifyToken = t; updateSpotifyUI(true); } });

  // Restore saved username from localStorage or sessionStorage
  const savedUser = localStorage.getItem("lastfm_username") || sessionStorage.getItem("lastfm_username");
  if (savedUser) { $("usernameInput").value = savedUser; refreshYearsForUser(); }

  // Username: save on change, update button
  $("usernameInput").addEventListener("input", updateGoButton);
  $("usernameInput").addEventListener("change", () => {
    const user = $("usernameInput").value.trim();
    if (user) {
      localStorage.setItem("lastfm_username", user);
      sessionStorage.setItem("lastfm_username", user);
    }
    refreshYearsForUser();
  });
  $("usernameInput").addEventListener("keydown", e => { if (e.key === "Enter" && !$("goBtn").disabled) handleGo(); });

  // Artist input: autocomplete + validation
  $("artistInput").addEventListener("input", () => {
    updateGoButton();
    handleArtistAutocomplete();
  });
  $("artistInput").addEventListener("keydown", e => {
    if (handleArtistKeydown(e)) return;
    if (e.key === "Enter" && !$("goBtn").disabled) handleGo();
  });
  $("artistInput").addEventListener("blur", () => { setTimeout(clearArtistSuggestions, 200); });

  // Date selectors
  $("dateMonth").addEventListener("change", () => { populateDays(); updateGoButton(); });
  $("dateYear").addEventListener("change", () => { populateDays(); updateGoButton(); });

  // Global keyboard shortcuts
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && $("changelogOverlay").style.display !== "none") { closeChangelog(); return; }
    if (e.key === "Escape" && currentPhase === "working") { handleReset(); return; }
  });

  populateYears();
  updateGoButton();
  initTheme();
});
