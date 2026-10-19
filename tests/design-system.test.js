// Design system guards: colors only as tokens, no tiny text, no `transition:all`.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const lines = fs.readFileSync(path.join(root, "css", "style.css"), "utf8").split("\n");
const body = lines.slice(2).join("\n").replace(/url\("data:[^"]*"\)/g, "");  // token lines and inline SVGs aside

const colors = body.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || [];
assert.deepEqual(colors, [], "Hardcoded colors outside the token lines: " + colors.join(", "));

const tiny = [...body.matchAll(/font-size:\s*(\d+)px/g)].map(m => +m[1]).filter(n => n < 12);
assert.deepEqual(tiny, [], "font sizes below 12px");

assert.ok(!/transition:\s*all\b/.test(body), "transition:all (name the properties)");

console.log("design-system: ok");
