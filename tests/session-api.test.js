// The session note store (api/session.js) with Spotify and the key-value store stubbed.
const assert = require("assert");
const handler = require("../api/session.js");

let clock = 1000000;
Date.now = () => clock;
let meCalls = 0;
let lastSet = null, kvDown = false;
const store = {};
const meStatus = { good: 200, busy: 429, down: 500 };  // tokens: signed in, Spotify rate-limited, Spotify down (else 401)
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.indexOf("api.spotify.com/v1/me") >= 0) {
    meCalls++;
    const tok = String((opts && opts.headers && opts.headers.Authorization) || "").replace("Bearer ", "");
    const status = meStatus[tok] || 401, ok = status === 200;
    return { status, ok, json: async () => (ok ? { id: "u1" } : {}) };
  }
  if (u.indexOf("https://kv.test") === 0) {
    if (kvDown) return { status: 500, ok: false, json: async () => ({}) };
    const cmd = JSON.parse(opts.body);
    if (cmd[0] === "GET") return { status: 200, ok: true, json: async () => ({ result: store[cmd[1]] === undefined ? null : store[cmd[1]] }) };
    if (cmd[0] === "SET") { lastSet = cmd; store[cmd[1]] = cmd[2]; return { status: 200, ok: true, json: async () => ({ result: "OK" }) }; }
  }
  throw new Error("unexpected fetch " + u);
};

function storeNote() { return JSON.parse(store["stm:session:u1"]); }

async function call(method, body, token, query) {
  const req = { method, query: query ? { [query]: "" } : {}, headers: token ? { authorization: "Bearer " + token } : {}, body };
  const out = { status: 200, body: undefined, headers: {} };
  const res = {
    setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
    status(c) { out.status = c; return res; },
    json(b) { out.body = b; return res; },
    send(b) { out.body = b; return res; },
    end() { return res; }
  };
  await handler(req, res);
  return out;
}

(async () => {
  delete process.env.KV_REST_API_URL; assert.equal((await call("GET", {}, "good")).status, 503);
  Object.assign(process.env, { KV_REST_API_URL: "https://kv.test", KV_REST_API_TOKEN: "kv" });
  assert.equal((await call("GET", {}, "bad")).status, 401);
  assert.equal((await call("GET", {}, null)).status, 401);
  assert.equal((await call("DELETE", {}, "good")).status, 405);
  const g = await call("GET", {}, "good");
  assert.deepEqual(g.body.note, null);
  assert.equal(g.headers["cache-control"], "no-store");
  const n = { v: 1, sessionId: "s1", driverId: "d1" };
  let r = await call("PUT", { claim: "new", note: n }, "good");
  assert.equal(r.status, 200); assert.equal(r.body.note.beatAt, r.body.now);
  assert.deepEqual(lastSet.slice(0, 2), ["SET", "stm:session:u1"]); assert.deepEqual(lastSet.slice(3), ["EX", 43200]);
  assert.equal((await call("PUT", { claim: "keep", note: { ...n, driverId: "d2" } }, "good")).status, 409);   // not the driver
  assert.equal((await call("PUT", { claim: "takeover", note: { ...n, driverId: "d2" } }, "good")).status, 409); // fresh driver
  clock += 180001;
  assert.equal((await call("PUT", { claim: "takeover", note: { ...n, driverId: "d2" } }, "good")).status, 200); // stale
  assert.equal((await call("PUT", { claim: "keep", note: n }, "good")).status, 409);   // the old driver is now refused
  assert.equal((await call("PUT", { claim: "new", note: { ...n, sessionId: "s2" } }, "good")).status, 200); // a new radio wins
  await call("POST", JSON.stringify({ token: "good", driverId: "d1" }), null, "release");
  assert.equal(storeNote().released, true);
  assert.equal((await call("PUT", { claim: "keep", note: { ...n, pad: "x".repeat(70000) } }, "good")).status, 413);
  meCalls = 0; await call("GET", {}, "good"); await call("GET", {}, "good"); assert.equal(meCalls, 0); // cached id
  // a /me answer other than 401 (Spotify rate-limited or down) is not "signed out": 502, and the app tries again later
  assert.equal((await call("GET", {}, "busy")).status, 502);
  assert.equal((await call("PUT", { claim: "keep", note: n }, "down")).status, 502);
  // a store error: 502 too (503 says only that no store is set up)
  kvDown = true;
  assert.equal((await call("GET", {}, "good")).status, 502);
  assert.equal((await call("PUT", { claim: "keep", note: n }, "good")).status, 502);
  kvDown = false;

  // canWrite rules
  const c = handler.canWrite;
  assert.equal(c(null, n, "keep", 0), true);
  assert.equal(c({ driverId: "d1", beatAt: 0 }, n, "keep", 10), true);
  assert.equal(c({ driverId: "d9", beatAt: 0, released: true }, n, "takeover", 10), true);
  assert.equal(c({ driverId: "d9", beatAt: 0, released: true }, n, "keep", 10), false);
  assert.equal(c({ driverId: "d9", beatAt: 0 }, n, "takeover", 180000), false);
  console.log("session-api: ok");
})().catch((e) => { console.error(e); process.exit(1); });
