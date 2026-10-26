const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

// Time Travel was folded into Library radio (v2.11): its modes, track list and era panel stay removed
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const js = fs.readdirSync(path.join(root, "js")).map(f => fs.readFileSync(path.join(root, "js", f), "utf8")).join("\n");
const css = fs.readFileSync(path.join(root, "css", "style.css"), "utf8");

assert.ok(!fs.existsSync(path.join(root, "js", "modes.js")), "js/modes.js is back");
assert.doesNotMatch(html, /modes\.js|id="timeTravel"|mode-card|id="trackList"|id="goBtn"|eraPanel|era-panel/, "index.html still has Time Travel markup");
assert.doesNotMatch(js, /handleGo|setMode\(|matchAndPlay|smartMatch|continueMatching|travelActive|renderTrackRow|eraPanel|timelineSlider/, "js still references Time Travel");
assert.doesNotMatch(css, /\.mode-card|\.track-row|\.track-status|\.mood-btn|\.era-/, "css still styles Time Travel");
console.log("no time travel: ok");
