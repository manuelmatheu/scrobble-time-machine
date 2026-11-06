// Sign-in: each visitor's own Spotify app (Client ID stored in the browser), the setup banner rule, the first-run
// steps, the one-time move for sessions made with the old built-in app, the OAuth state check, a cancelled login,
// and the message for a Spotify account the app's owner has not added.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

global.window = { location: { origin: "http://localhost", pathname: "/" } };
global.document = { getElementById: () => null, createElement: () => ({ set textContent(v) { this.t = String(v); }, get innerHTML() { return this.t; } }) };
const ss = {}, ls = {};
const store = o => ({ setItem: (k, v) => { o[k] = String(v); }, getItem: k => (k in o ? o[k] : null), removeItem: k => { delete o[k]; } });
global.sessionStorage = store(ss);
global.localStorage = store(ls);
const clear = o => Object.keys(o).forEach(k => delete o[k]);
const load = f => vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), { filename: f });
const run = code => vm.runInThisContext(code);
load("config.js");
load("spotify.js");
load("ui.js");

const ID = "3f9a1c0e7b2d4a6f8e1c5b7d9a0f2e4c", ID2 = "aaaabbbbccccddddeeeeffff00001111";

(async () => {
  // 1. the public copy has no built-in Client ID: every visitor brings their own
  assert.equal(run("SPOTIFY_CLIENT_ID"), "");

  // 2. setup banner: a placeholder Last.fm key always; a built-in Client ID only off the hosts it is registered for; none never
  run("KEYS_HOSTS.length = 0; KEYS_HOSTS.push('stm-lastfm.vercel.app')");
  assert.equal(run("stmSetupNeeded('stm-lastfm.vercel.app', 'key', '" + ID + "')"), false);
  assert.equal(run("stmSetupNeeded('someone-else.vercel.app', 'key', '" + ID + "')"), true);  // a fork that kept a built-in ID
  assert.equal(run("stmSetupNeeded('someone-else.vercel.app', 'key', '')"), false);            // visitors paste their own
  assert.equal(run("stmSetupNeeded('someone-else.vercel.app', 'key', 'YOUR_SPOTIFY_CLIENT_ID')"), false);
  assert.equal(run("stmSetupNeeded('x', 'YOUR_LASTFM_API_KEY', '')"), true);
  run("KEYS_HOSTS.length = 0");
  assert.equal(run("stmSetupNeeded('anywhere.example', 'key', '" + ID + "')"), false);           // an empty list skips the host check
  assert.equal(run("stmSetupNeeded('anywhere.example')"), false);                               // this copy: shared Last.fm key, no built-in ID

  // 3. what counts as a Client ID: 32 hex characters, spaces around it ignored
  const valid = s => run("spotifyClientIdValid")(s);
  assert.equal(valid(ID), true);
  assert.equal(valid(ID.toUpperCase()), true);
  assert.equal(valid("  " + ID + "\n"), true);
  assert.equal(valid(ID.slice(1)), false);
  assert.equal(valid(ID.slice(1) + "g"), false);
  assert.equal(valid(""), false);
  assert.equal(valid(null), false);
  assert.equal(run("spotifyShortId")(ID), "3f9a1c…f2e4c");

  // 4. the visitor's Client ID: saved in this browser, a built-in one wins, a bad one is not saved
  assert.equal(run("spotifyClientId()"), "");
  assert.equal(run("spotifySetClientId('nope')"), false);
  assert.equal(run("spotifyClientId()"), "");
  assert.equal(run("spotifySetClientId(' " + ID + " ')"), true);
  assert.equal(ls.stm_spotify_client_id, ID);
  assert.equal(run("spotifyClientId()"), ID);
  assert.equal(run("spotifyClientId('" + ID2 + "')"), ID2);  // a fork's built-in ID wins over a stored one
  ls.stm_spotify_client_id = "garbage";
  assert.equal(run("spotifyClientId()"), "");                // a stored value that is not an ID is ignored
  ls.stm_spotify_client_id = ID;

  // 5. tokens belong to the app that issued them: a different ID signs out, the same one does not
  ls.spotify_access_token = "a"; ls.spotify_refresh_token = "r"; ls.spotify_token_expires = "1";
  assert.equal(run("spotifySetClientId('" + ID + "')"), true);
  assert.equal(ls.spotify_refresh_token, "r");
  assert.equal(run("spotifySetClientId('" + ID2 + "')"), true);
  assert.equal(ls.spotify_refresh_token, undefined);
  assert.equal(ls.spotify_access_token, undefined);
  assert.equal(ls.stm_spotify_client_id, ID2);
  run("spotifyForgetClientId()");
  assert.equal(ls.stm_spotify_client_id, undefined);
  assert.equal(run("spotifyClientId()"), "");

  // 6. the one-time move: a session from the old built-in app, with no Client ID now, is signed out
  ls.spotify_refresh_token = "old";
  assert.equal(run("spotifyNeedsAppMove()"), true);
  ls.stm_spotify_client_id = ID;
  assert.equal(run("spotifyNeedsAppMove()"), false);
  delete ls.stm_spotify_client_id; delete ls.spotify_refresh_token;
  assert.equal(run("spotifyNeedsAppMove()"), false);         // nothing to move: a first visit

  // 7. the login goes out with the visitor's Client ID and a state, kept in both storages; without an ID it does not go out
  document.getElementById = () => ({ value: "tester" });
  window.location.href = "";
  await run("initiateSpotifyAuth()");
  assert.equal(window.location.href, "");
  ls.stm_spotify_client_id = ID;
  await run("initiateSpotifyAuth()");
  const sent = new URL(window.location.href).searchParams;
  assert.equal(sent.get("client_id"), ID);
  assert.ok(sent.get("state") && sent.get("state").length >= 16);
  assert.equal(ss.spotify_auth_state, sent.get("state"));
  assert.equal(ls.spotify_auth_state, sent.get("state"));
  assert.equal(run("spotifyTakeAuthState()"), sent.get("state"));
  assert.equal(ss.spotify_auth_state, undefined);  // single use
  assert.equal(ls.spotify_auth_state, undefined);
  assert.equal(run("spotifyTakeAuthState()"), null);
  ls.spotify_auth_state = "fromLocal";               // the installed-app case: only the localStorage copy survived
  assert.equal(run("spotifyTakeAuthState()"), "fromLocal");

  // 8. the token exchange and the refresh use the same Client ID
  const bodies = [];
  global.fetch = async (url, opts) => { bodies.push(new URLSearchParams(opts.body)); return { ok: true, json: async () => ({ access_token: "A", refresh_token: "R", expires_in: 3600 }) }; };
  window.history = { replaceState: () => {} };
  global.refreshLibraryYears = () => {};
  document.title = "";
  await run("exchangeCodeForToken('code')");
  await run("refreshSpotifyToken()");
  assert.deepEqual(bodies.map(b => b.get("client_id")), [ID, ID]);

  // 9. the login return: not a return, a good code, a wrong or missing state, a cancel, another error
  const ret = (qs, want) => run("spotifyAuthReturn")(new URLSearchParams(qs), want);
  assert.equal(ret("", "s1"), null);
  assert.equal(ret("foo=1", "s1"), null);
  assert.deepEqual(ret("code=abc&state=s1", "s1"), { code: "abc" });
  assert.ok(ret("code=abc&state=evil", "s1").error);
  assert.ok(ret("code=abc", "s1").error);
  assert.ok(ret("code=abc&state=s1", null).error);  // nothing stored: this browser never started a login
  assert.match(ret("error=access_denied&state=s1", "s1").error, /not connected/i);
  assert.match(ret("error=server_error&state=s1", "s1").error, /server_error/);

  // 10. the first-run steps: username, your Spotify app (none with a built-in ID), connect
  const st = (user, id, builtIn) => run("landingState")(user, id, builtIn);
  assert.deepEqual(st("", "", false), { user: "active", app: "locked", connect: "locked", connectNum: 3, canConnect: false });
  assert.deepEqual(st("me", "", false), { user: "done", app: "active", connect: "locked", connectNum: 3, canConnect: false });
  assert.deepEqual(st("me", ID, false), { user: "done", app: "done", connect: "active", connectNum: 3, canConnect: true });
  assert.deepEqual(st("", ID, false), { user: "active", app: "done", connect: "locked", connectNum: 3, canConnect: false });
  assert.deepEqual(st("me", ID, true), { user: "done", app: "hidden", connect: "active", connectNum: 2, canConnect: true });

  // 11. an account the app's owner has not added (403 from Spotify): one plain message, at connect and when a search fails
  const msgs = [];
  global.showStatus = (m, kind) => msgs.push([m, kind]);
  let status = 403;
  global.fetch = async () => ({ status, ok: status === 200, headers: { get: () => null }, json: async () => ({ error: { message: "Check settings on developer.spotify.com/dashboard, the user may not be registered." } }) });
  assert.equal(await run("spotifyCheckAccess('t')"), false);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0][0], run("SPOTIFY_NOT_REGISTERED"));
  assert.equal(msgs[0][1], "error");
  assert.match(run("SPOTIFY_NOT_REGISTERED"), /User Management/);
  status = 200;
  assert.equal(await run("spotifyCheckAccess('t')"), true);
  assert.equal(msgs.length, 1);
  status = 500;
  assert.equal(await run("spotifyCheckAccess('t')"), true);  // a hiccup says nothing about the account
  global.fetch = async () => { throw new Error("offline"); };
  assert.equal(await run("spotifyCheckAccess('t')"), true);
  assert.equal(msgs.length, 1);

  status = 403;
  global.fetch = async () => ({ status, ok: false, headers: { get: () => null }, json: async () => ({ error: { message: "the user may not be registered" } }) });
  run("lastSearchError = null");
  assert.deepEqual(await run("runSpotifySearch('t', 'q')"), { error: true });
  assert.equal(run("lastSearchError"), run("SPOTIFY_NOT_REGISTERED"));
  assert.equal(run("spotifyNoMatchMessage()"), run("SPOTIFY_NOT_REGISTERED"));  // not "No tracks matched (403: ...)"
  run("lastSearchError = '500: boom'");
  assert.equal(run("spotifyNoMatchMessage()"), "No tracks matched (500: boom)");
  run("lastSearchError = null");
  assert.equal(run("spotifyNoMatchMessage()"), "No tracks matched");

  clear(ss); clear(ls);
  console.log("auth: ok");
})().catch(e => { console.error(e); process.exit(1); });
