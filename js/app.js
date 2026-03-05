
// ═════════════════════════════════════════════════════════════════════════════
// INIT
// ═════════════════════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
  $("currentUrl").textContent = SPOTIFY_REDIRECT_URI;
  if (LASTFM_API_KEY !== "YOUR_LASTFM_API_KEY" && SPOTIFY_CLIENT_ID !== "YOUR_SPOTIFY_CLIENT_ID") $("setupBanner").style.display = "none";
  const code = new URLSearchParams(window.location.search).get("code");
  if (code) exchangeCodeForToken(code).then(t => { spotifyToken = t; updateSpotifyUI(true); }).catch(() => showStatus("Spotify auth failed", "error"));
  else getSpotifyToken().then(t => { if (t) { spotifyToken = t; updateSpotifyUI(true); } });
  $("usernameInput").addEventListener("input", updateGoButton);
  $("usernameInput").addEventListener("keydown", e => { if (e.key === "Enter" && !$("goBtn").disabled) handleGo(); });
  $("usernameInput").addEventListener("change", refreshYearsForUser);
  $("artistInput").addEventListener("input", updateGoButton);
  $("artistInput").addEventListener("keydown", e => { if (e.key === "Enter" && !$("goBtn").disabled) handleGo(); });
  $("dateMonth").addEventListener("change", () => { populateDays(); updateGoButton(); });
  $("dateYear").addEventListener("change", () => { populateDays(); updateGoButton(); });
  populateYears();
  updateGoButton();
});
