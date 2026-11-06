// Self-hosting checks and the Spotify login return: the setup banner rule, the OAuth state check,
// a cancelled login, and the message for a Spotify account the app owner has not added.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

global.window = { location: { origin: "http://localhost", pathname: "/" } };
global.document = { getElementById: () => null, createElement: () => ({ set textContent(v) { this.t = String(v); }, get innerHTML() { return this.t; } }) };
const load = f => vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), { filename: f });
const run = code => vm.runInThisContext(code);
load("config.js");
load("spotify.js");

(async () => {
  // 1. setup banner: placeholder keys always need setup; real keys only on the hosts they are registered for
  assert.ok(Array.isArray(run("KEYS_HOSTS")));
  run("KEYS_HOSTS.length = 0; KEYS_HOSTS.push('stm-lastfm.vercel.app')");
  assert.equal(run("stmSetupNeeded('stm-lastfm.vercel.app')"), false);
  assert.equal(run("stmSetupNeeded('someone-else.vercel.app')"), true);  // a fork that kept these keys
  run("KEYS_HOSTS.length = 0");
  assert.equal(run("stmSetupNeeded('anywhere.example')"), false);         // an empty list skips the host check
  assert.equal(run("stmSetupNeeded('x', 'YOUR_LASTFM_API_KEY', 'id')"), true);
  assert.equal(run("stmSetupNeeded('x', 'key', 'YOUR_SPOTIFY_CLIENT_ID')"), true);

  // 2. the login return: not a return, a good code, a wrong or missing state, a cancel, another error
  const ret = (qs, want) => run("spotifyAuthReturn")(new URLSearchParams(qs), want);
  assert.equal(ret("", "s1"), null);
  assert.equal(ret("foo=1", "s1"), null);
  assert.deepEqual(ret("code=abc&state=s1", "s1"), { code: "abc" });
  assert.ok(ret("code=abc&state=evil", "s1").error);
  assert.ok(ret("code=abc", "s1").error);
  assert.ok(ret("code=abc&state=s1", null).error);  // nothing stored: this browser never started a login
  assert.match(ret("error=access_denied&state=s1", "s1").error, /not connected/i);
  assert.match(ret("error=server_error&state=s1", "s1").error, /server_error/);

  // 3. the login sends a state and keeps it for the return, in both storages (an installed app may come back in a new context)
  const ss = {}, ls = {};
  global.sessionStorage = { setItem: (k, v) => { ss[k] = String(v); }, getItem: k => (k in ss ? ss[k] : null), removeItem: k => { delete ss[k]; } };
  global.localStorage = { setItem: (k, v) => { ls[k] = String(v); }, getItem: k => (k in ls ? ls[k] : null), removeItem: k => { delete ls[k]; } };
  document.getElementById = () => ({ value: "tester" });
  window.location.href = "";
  await run("initiateSpotifyAuth()");
  const sent = new URL(window.location.href).searchParams.get("state");
  assert.ok(sent && sent.length >= 16);
  assert.equal(ss.spotify_auth_state, sent);
  assert.equal(ls.spotify_auth_state, sent);
  assert.equal(run("spotifyTakeAuthState()"), sent);
  assert.equal(ss.spotify_auth_state, undefined);  // single use
  assert.equal(ls.spotify_auth_state, undefined);
  assert.equal(run("spotifyTakeAuthState()"), null);
  ls.spotify_auth_state = "fromLocal";               // the installed-app case: only the localStorage copy survived
  assert.equal(run("spotifyTakeAuthState()"), "fromLocal");

  // 4. an account the owner has not added (403 from Spotify): one plain message, at connect and when a search fails
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

  console.log("auth: ok");
})().catch(e => { console.error(e); process.exit(1); });
