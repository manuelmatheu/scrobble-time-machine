// Motion rules for css/style.css: ease-out curves only, every animation covered by the reduced-motion block
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const css = fs.readFileSync(path.join(__dirname, "..", "css", "style.css"), "utf8");

// no overshoot: a cubic-bezier whose y values leave 0..1 bounces
for (const m of css.matchAll(/cubic-bezier\(([^)]*)\)/g)) {
  const [, y1, , y2] = m[1].split(",").map(Number);
  assert.ok(y1 >= 0 && y1 <= 1 && y2 >= 0 && y2 <= 1, "overshoot easing: " + m[0]);
}

// keyframes move opacity and transform only (no layout properties)
for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?\})\s*\}/g)) {
  const props = [...m[2].matchAll(/([\w-]+)\s*:/g)].map(p => p[1]);
  for (const p of props) assert.ok(["opacity", "transform"].includes(p), "keyframes " + m[1] + " animates " + p);
}

// the reduced-motion block switches animations and transitions off for everything
const rm = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/);
assert.ok(rm, "reduced-motion block");
assert.match(rm[1], /animation:\s*none\s*!important/);
assert.match(rm[1], /transition:\s*none\s*!important/);

console.log("motion: ok");
