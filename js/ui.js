
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
  showLanding(!c);
  updateRadioButton();
}
// First run (no Spotify session): a short landing with two steps, username then Connect Spotify. The Home card with every
// option appears once Spotify is connected. The landing's field feeds #usernameInput, which the rest of the app reads.
function showLanding(on) {
  const landing = $("landing"), card = $("homeCard");
  if (!landing || !card) return;
  if (on && landing.style.display === "none") { $("landingUser").value = $("usernameInput").value; landingSync(); }
  landing.style.display = on ? "" : "none";
  card.style.display = on ? "none" : "";
}
// The first-run steps: 1 username, 2 your Spotify app (not shown when this copy has a built-in Client ID), then Connect
function landingState(user, id, builtIn) {
  const canConnect = !!user && (builtIn || !!id);
  return { user: user ? "done" : "active", app: builtIn ? "hidden" : id ? "done" : user ? "active" : "locked",
    connect: canConnect ? "active" : "locked", connectNum: builtIn ? 2 : 3, canConnect };
}
function landingSync() {
  const id = spotifyStoredClientId();
  const s = landingState($("landingUser").value.trim(), id, spotifyClientIdValid(SPOTIFY_CLIENT_ID));
  $("landingStepUser").className = "landing-step " + s.user;
  const app = $("landingStepApp");
  app.hidden = s.app === "hidden";
  app.className = "landing-step " + s.app;
  $("landingAppGuide").hidden = s.app === "done";
  $("landingAppDone").hidden = s.app !== "done";
  $("landingAppId").textContent = id ? spotifyShortId(id) : "";
  $("landingStepSpotify").className = "landing-step " + s.connect;
  $("landingConnectNum").textContent = s.connectNum;
  $("landingConnectBtn").disabled = !s.canConnect;
}
// The Client ID field: a valid ID is saved at once (the step closes, Connect takes the focus); a wrong one is pointed out
// once it is long enough to be meant (or the field is left)
function landingClientIdInput(final) {
  const el = $("landingClientId"), err = $("landingClientIdError"), v = el.value.trim();
  if (spotifyClientIdValid(v)) {
    spotifySetClientId(v);
    el.value = ""; el.removeAttribute("aria-invalid"); err.hidden = true;
    landingSync();
    if (!$("landingConnectBtn").disabled) $("landingConnectBtn").focus();
    return;
  }
  const bad = !!v && (final || v.length >= 32);
  err.hidden = !bad;
  if (bad) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid");
}
function landingChangeApp() {
  spotifyForgetClientId();
  landingSync();
  $("landingClientId").focus();
}
function copyRedirectUri(btn) {
  const label = btn && btn.querySelector(".copy-label");
  const select = () => { const r = document.createRange(); r.selectNodeContents($("landingRedirectUri")); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); };
  const done = () => { if (!label) return; label.textContent = "Copied"; setTimeout(() => { label.textContent = "Copy"; }, 2000); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(SPOTIFY_REDIRECT_URI).then(done, select);
  else select();
}
// The Spotify badge's menu: which app you use (when it is your own), change it, Spotify's dashboard, Disconnect
function spotifyMenuToggle(open) {
  const menu = $("spotifyMenu"), btn = $("spotifyMenuBtn");
  if (!menu || !btn) return;
  if (open === undefined) open = menu.hidden;
  menu.hidden = !open;
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  if (!open) return;
  const own = !spotifyClientIdValid(SPOTIFY_CLIENT_ID), id = spotifyClientId();
  $("spotifyMenuApp").hidden = !own || !id;
  $("spotifyMenuId").textContent = id ? spotifyShortId(id) : "";
  $("spotifyMenuChange").hidden = !own;
}
// Another app: sign out (its tokens belong to the old one), forget the ID, and open step 2 again
function spotifyChangeApp() {
  spotifyMenuToggle(false);
  disconnectSpotify();
  spotifyForgetClientId();
  landingSync();
  $("landingClientId").focus();
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
  sessionQueue = new Set(); sessionPaused = false; sdkInactive = false;
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
