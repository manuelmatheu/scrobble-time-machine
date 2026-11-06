// vercel.json security headers: other sites cannot frame the app, but the app can frame its own pages
// (the changelog overlay loads changelog.html in an iframe).
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
const all = cfg.headers.find(h => h.source === "/(.*)");
assert.ok(all, "headers for every path");
const get = k => (all.headers.find(h => h.key.toLowerCase() === k) || {}).value;

assert.equal(get("x-frame-options"), "SAMEORIGIN");
assert.match(get("content-security-policy"), /frame-ancestors 'self'/);
assert.doesNotMatch(get("content-security-policy"), /frame-ancestors 'none'/);
assert.equal(get("x-content-type-options"), "nosniff");
assert.ok(get("referrer-policy"));

// the overlay really does frame a page of this site
const ui = fs.readFileSync(path.join(__dirname, "..", "js", "ui.js"), "utf8");
assert.match(ui, /changelogFrame"\)\.src = "changelog\.html"/);

console.log("headers: ok");
