// Rebuilds test/icons.js: the path of every mdi: icon the cards or the tests name, so the
// test page can draw them. Rerun after adding an icon:  node test/make-icons.mjs
// (needs @mdi/js: `@mdi/js` installed, or MDI=/path/to/@mdi/js)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const mdi = require(process.env.MDI || "@mdi/js");

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const files = [...walk(path.join(ROOT, "src")), ...walk(path.join(ROOT, "test"))].filter((f) => /\.m?js$/.test(f) && f !== path.join(ROOT, "test/icons.js"));
const names = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, "test/icons.js"), "utf8").replace(/^window\.ICONS=/, "").replace(/;\s*$/, ""))));
for (const f of files) for (const m of fs.readFileSync(f, "utf8").matchAll(/mdi:([a-z0-9]+(?:-[a-z0-9]+)*)/g)) names.add(`mdi:${m[1]}`);
for (let v = 10; v <= 90; v += 10) names.add(`mdi:battery-${v}`);   // the card builds these names from a number
const camel = (n) => "mdi" + n.slice(4).split("-").map((p) => p[0].toUpperCase() + p.slice(1)).join("");
const out = {}, missing = [];
for (const n of [...names].sort()) (mdi[camel(n)] ? (out[n] = mdi[camel(n)]) : missing.push(n));
fs.writeFileSync(path.join(ROOT, "test/icons.js"), `window.ICONS=${JSON.stringify(out)};\n`);
console.log(`${Object.keys(out).length} icons written${missing.length ? `; not in @mdi/js: ${missing.join(", ")}` : ""}`);
