const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

// Status and error messages must describe a moment by date, never by a page number
const offenders = [];
for (const f of ["modes.js", "player.js", "ui.js", "radio.js"]) {
  fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8").split("\n").forEach((line, i) => {
    if (/showStatus|new Error\(/.test(line) && /loading page|on page|from page|page \d|"Page "/i.test(line)) offenders.push(f + ":" + (i + 1) + ": " + line.trim());
  });
}
assert.deepEqual(offenders, [], "Page numbers in messages:\n" + offenders.join("\n"));
console.log("no page numbers: ok");
