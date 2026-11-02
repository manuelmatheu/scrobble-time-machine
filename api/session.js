// Vercel serverless store for the hand-off "session note": the window that drives a radio keeps
// a small note here (keyed by Spotify user id) so another device can pick the radio up.
// GET -> { note, now }; PUT { claim, note } -> { note, now } or 409; POST ?release -> 204.
// 401: the token is not signed in. 503: no store is set up (the app turns the hand-off off). 502: Spotify or the store
// failed this time (the app tries again on its next call).
// Tokens are only used to ask Spotify who the user is; they are never stored or logged.
const ID_TTL = 300000;       // token -> user id cache, in memory only
const NOTE_TTL = 43200;      // seconds the store keeps a note
const MAX_BODY = 65536;      // bytes
const STALE_DRIVER = 180000; // ms without a heartbeat before a takeover is allowed
const idCache = new Map();

function canWrite(stored, note, claim, now) {
  if (!stored || claim === "new") return true;
  if (stored.driverId === note.driverId) return true;
  return claim === "takeover" && !!(stored.released || now - stored.beatAt > STALE_DRIVER);
}

// The Spotify user id of the token; null when Spotify says it is not signed in (401). Any other failure (a 429, a 5xx, no id)
// throws: it says nothing about the token.
async function userIdFor(token) {
  const hit = idCache.get(token);
  if (hit && Date.now() - hit.at < ID_TTL) return hit.id;
  const r = await fetch("https://api.spotify.com/v1/me", { headers: { Authorization: "Bearer " + token } });
  if (r.status === 401) return null;
  if (r.status !== 200) throw new Error("me " + r.status);
  const me = await r.json();
  if (!me || !me.id) throw new Error("me without id");
  idCache.set(token, { id: me.id, at: Date.now() });
  return me.id;
}

async function kv(cmd) {
  const r = await fetch(process.env.KV_REST_API_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.KV_REST_API_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(cmd)
  });
  if (!r.ok) throw new Error("store " + r.status);
  return (await r.json()).result;
}

function parseBody(body) {
  if (typeof body === "string") {
    try { return JSON.parse(body); } catch (e) { return null; }
  }
  return body && typeof body === "object" ? body : null;
}

async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const method = req.method;
  const query = req.query || {};
  const release = method === "POST" && "release" in query;
  if (method !== "GET" && method !== "PUT" && !release) return res.status(405).json({ error: "method not allowed" });
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return res.status(503).json({ error: "no store" });

  const raw = req.body;
  const size = raw == null ? 0 : Buffer.byteLength(typeof raw === "string" ? raw : JSON.stringify(raw));
  if (size > MAX_BODY) return res.status(413).json({ error: "too large" });
  const body = parseBody(raw);

  const auth = String((req.headers && req.headers.authorization) || "");
  let token = auth.indexOf("Bearer ") === 0 ? auth.slice(7) : "";
  if (!token && release && body && typeof body.token === "string") token = body.token;
  if (!token) return res.status(401).json({ error: "no token" });

  try {
    const uid = await userIdFor(token);
    if (!uid) return res.status(401).json({ error: "not signed in" });
    const key = "stm:session:" + uid;
    const now = Date.now();
    const raw0 = await kv(["GET", key]);
    const stored = raw0 ? JSON.parse(raw0) : null;

    if (method === "GET") return res.status(200).json({ note: stored, now });

    if (release) {
      if (stored && body && stored.driverId === body.driverId) {
        await kv(["SET", key, JSON.stringify({ ...stored, released: true }), "EX", NOTE_TTL]);
      }
      return res.status(204).end();
    }

    const note = body && body.note;
    if (!note || typeof note !== "object") return res.status(400).json({ error: "no note" });
    if (!canWrite(stored, note, body.claim, now)) return res.status(409).json({ note: stored, now });
    const out = { ...note, beatAt: now, released: false };
    await kv(["SET", key, JSON.stringify(out), "EX", NOTE_TTL]);
    return res.status(200).json({ note: out, now });
  } catch (e) {
    return res.status(502).json({ error: "try again" });
  }
}

module.exports = handler;
module.exports.canWrite = canWrite;
module.exports._reset = function () { idCache.clear(); };
