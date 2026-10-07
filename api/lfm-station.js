// Spike: Vercel serverless proxy for Last.fm's personalized "recommended" station.
// The endpoint is undocumented and blocks cross-origin requests, so the browser asks this
// function and this function asks Last.fm. Usage: /api/lfm-station?user=<last.fm username>
module.exports = async function handler(req, res) {
  const user = req.query.user;
  if (!user || typeof user !== "string" || !/^[\w\-. ]{1,64}$/.test(user)) {
    return res.status(400).json({ error: "missing or invalid user param" });
  }
  try {
    const upstream = await fetch("https://www.last.fm/player/station/user/" + encodeURIComponent(user) + "/recommended", {
      headers: { Accept: "application/json" }
    });
    const body = await upstream.text();
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    res.status(upstream.status).send(body);
  } catch (e) {
    res.status(502).json({ error: "could not reach Last.fm", detail: String(e && e.message || e) });
  }
};
