
// ═════════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ═════════════════════════════════════════════════════════════════════════════
// Only errors and warnings are shown. Progress and success messages are dropped (the interface already shows that
// state) and clear whatever message was up, so an old error does not linger once things move on.
// Toasts: errors and warnings float at the bottom, one at a time, and go away on their own.
// "success" means the problem they reported is over, so it dismisses the current one; plain progress text ("") is not shown.
const TOAST_MS = { warn: 6000, error: 9000 };  // how long each stays; hovering or focusing it holds it
let toastEl = null, toastTimer = null, toastKey = "";
function showStatus(msg, type) {
  if (type === "success") { hideStatus(); return; }
  if (type !== "error" && type !== "warn") return;
  const host = $("toastHost");
  if (!host || !msg) return;
  const key = type + "|" + msg;
  if (toastEl && key === toastKey) { armToast(type); return; }  // the same message again: keep it up a little longer
  removeToast(true);
  const el = document.createElement("div");
  el.className = "toast " + type;
  const icon = document.createElement("i");
  icon.className = "ph " + (type === "error" ? "ph-warning-circle" : "ph-info"); icon.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.className = "toast-text"; text.textContent = msg;
  const close = document.createElement("button");
  close.className = "toast-close"; close.setAttribute("aria-label", "Dismiss message");
  close.innerHTML = '<i class="ph ph-x" aria-hidden="true"></i>';
  close.addEventListener("click", () => hideStatus());
  el.append(icon, text, close);
  el.addEventListener("mouseenter", () => clearTimeout(toastTimer));
  el.addEventListener("mouseleave", () => armToast(type, 2500));
  el.addEventListener("focusin", () => clearTimeout(toastTimer));
  el.addEventListener("focusout", () => armToast(type, 2500));
  host.appendChild(el);
  toastEl = el; toastKey = key;
  armToast(type);
}
function armToast(type, ms) {
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => removeToast(false), ms || TOAST_MS[type] || TOAST_MS.warn);
}
// Dismiss the current toast: slides away (or goes at once when another replaces it or motion is reduced)
function removeToast(now) {
  clearTimeout(toastTimer);
  const el = toastEl; toastEl = null; toastKey = "";
  if (!el) return;
  if (now) { el.remove(); return; }
  el.classList.add("leaving");
  setTimeout(() => el.remove(), 250);  // not animationend: with reduced motion there is no animation to end
}
function hideStatus() { removeToast(false); }
function escHtml(s) { const d=document.createElement("div"); d.textContent=s; return d.innerHTML; }

// The track playing now (its index in the session). The radio view reads it to render the hero and Up next.
function highlightNowPlaying(index) {
  nowPlayingIndex = index;
}

function updateSpotifyUI(c) {
  $("spotifyConnectBtn").style.display = c ? "none" : "";
  $("spotifyBadge").style.display = c ? "" : "none";
  $("radioBtn").style.display = c ? "" : "none";
  updateRadioButton();
}
// Start radio needs a username, Spotify and no radio starting already
function updateRadioButton() {
  const user = $("usernameInput").value.trim();
  const ok = user && spotifyToken && LASTFM_API_KEY !== "YOUR_LASTFM_API_KEY" && currentPhase !== "working";
  $("radioBtn").disabled = !ok;
}

function handleReset() {
  radioStop(); trackMeta = {};
  stopPolling();
  currentPhase = "idle"; matchedUris = {}; allTrackCount = 0; uriToIndices = {};
  sessionQueue = new Set(); sessionPaused = false;
  endSessionUI();
  hideStatus();
}

// ═════════════════════════════════════════════════════════════════════════════
// CHANGELOG OVERLAY
// ═════════════════════════════════════════════════════════════════════════════
function openChangelog() {
  $("changelogOverlay").style.display = "flex";
  $("changelogFrame").src = "changelog.html";
  document.body.style.overflow = "hidden";
}
function closeChangelog() {
  const overlay = $("changelogOverlay");
  if (overlay.classList.contains("leaving")) return;
  const done = () => {
    overlay.style.display = "none";
    overlay.classList.remove("leaving");
    $("changelogFrame").src = "about:blank";
    document.body.style.overflow = "";
  };
  // wait out the 200ms exit, unless motion is reduced (the CSS animation is off then, so there is nothing to wait for)
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return done();
  overlay.classList.add("leaving");
  setTimeout(done, 200);
}

// (Theme toggle is handled by inline IIFE in index.html to prevent flash)
