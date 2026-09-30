const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const css = fs.readFileSync(path.join(__dirname, "..", "css", "style.css"), "utf8").split("\n");
function tokens(line) {
  const out = {};
  for (const m of line.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}
const dark = tokens(css[0]);
const light = { ...dark, ...tokens(css[1]) };

function lum(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const texts = ["text-primary", "text-secondary", "text-tertiary", "text-muted", "lastfm-red-text"];
const surfaces = ["bg-primary", "bg-secondary", "bg-tertiary"];
const failures = [];
for (const [theme, t] of [["dark", dark], ["light", light]]) {
  for (const tx of texts) for (const sf of surfaces) {
    const r = ratio(t[tx], t[sf]);
    if (r < 4.5) failures.push(theme + ": " + tx + " on " + sf + " = " + r.toFixed(2));
  }
}
assert.deepEqual(failures, [], "Contrast below 4.5:1:\n" + failures.join("\n"));
console.log("contrast: ok");
