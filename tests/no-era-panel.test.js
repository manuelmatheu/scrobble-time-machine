const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

// The time-travel context panel (era panel) and the Random time slider were removed on purpose
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const js = fs.readdirSync(path.join(root, "js")).map(f => fs.readFileSync(path.join(root, "js", f), "utf8")).join("\n");
const css = fs.readFileSync(path.join(root, "css", "style.css"), "utf8");

assert.doesNotMatch(html, /eraPanel|era-panel/, "index.html still has the era panel");
assert.doesNotMatch(js, /eraPanel|renderEraPanel|updateEraInfo|timelineSlider|loadPageFromSlider|onSliderInput|onSliderChange/, "js still references the era panel or slider");
assert.doesNotMatch(css, /\.era-/, "css still styles the era panel");
console.log("no era panel: ok");
