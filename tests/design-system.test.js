// Design system guards: colors only as tokens, every match status styled, no tiny text, no `transition:all`.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const lines = fs.readFileSync(path.join(root, "css", "style.css"), "utf8").split("\n");
const body = lines.slice(2).join("\n").replace(/url\("data:[^"]*"\)/g, "");  // token lines and inline SVGs aside

const colors = body.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || [];
assert.deepEqual(colors, [], "Hardcoded colors outside the token lines: " + colors.join(", "));

const ui = fs.readFileSync(path.join(root, "js", "ui.js"), "utf8");
const statuses = [...new Set([...ui.matchAll(/s==="([a-z_]+)"/g)].map(m => m[1]))];
assert.ok(statuses.length >= 4, "could not find the match statuses in ui.js");
for (const s of statuses) assert.ok(body.includes(".track-status." + s + " "), "no CSS rule for .track-status." + s);

const tiny = [...body.matchAll(/font-size:\s*(\d+)px/g)].map(m => +m[1]).filter(n => n < 12);
assert.deepEqual(tiny, [], "font sizes below 12px");

assert.ok(!/transition:\s*all\b/.test(body), "transition:all (name the properties)");

console.log("design-system: ok");
