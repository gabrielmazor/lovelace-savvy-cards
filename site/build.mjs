// Builds the demo site into a folder any static host can serve: site/ with vendor/ filled in.
//   node site/build.mjs            copy the built cards, write the icon map
//   node site/build.mjs --serve    the same, then serve site/ on http://localhost:8080
// The icon map needs @mdi/js (`npm install --no-save @mdi/js`, or MDI=/path/to/@mdi/js); without it
// the test page's icon map is used, which covers the cards but not every icon the demo names.
// Run `node build.mjs` at the root first when the cards changed: this copies dist/ as it is.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const SITE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SITE, "..");
const VENDOR = path.join(SITE, "vendor");
const require = createRequire(import.meta.url);

fs.mkdirSync(VENDOR, { recursive: true });
fs.copyFileSync(path.join(ROOT, "dist/savvy-cards.js"), path.join(VENDOR, "savvy-cards.js"));
const version = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();

// every mdi: name the cards and the demo use
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const names = new Set();
for (const f of [...walk(path.join(ROOT, "src")), ...walk(path.join(SITE, "assets"))].filter((f) => f.endsWith(".js"))) {
  for (const m of fs.readFileSync(f, "utf8").matchAll(/mdi:([a-z0-9]+(?:-[a-z0-9]+)*)/g)) names.add(`mdi:${m[1]}`);
}
for (let v = 10; v <= 90; v += 10) names.add(`mdi:battery-${v}`);   // the battery icon is built from a number
for (let v = 1; v <= 3; v++) names.add(`mdi:fan-speed-${v}`);        // so is a fan speed
// the on / off pairs an entity's own icon flips between are written without the mdi: prefix
const pairs = fs.readFileSync(path.join(ROOT, "src/core/55-icons.js"), "utf8").match(/const ICON_PAIRS = \[([\s\S]*?)\];/);
for (const m of pairs?.[1].matchAll(/"([a-z0-9-]+)"/g) || []) names.add(`mdi:${m[1]}`);
names.delete("mdi:fan-speed");

let icons;
try {
  const mdi = require(process.env.MDI || "@mdi/js");
  const camel = (n) => "mdi" + n.slice(4).split("-").map((p) => p[0].toUpperCase() + p.slice(1)).join("");
  icons = {};
  const missing = [];
  for (const n of [...names].sort()) (mdi[camel(n)] ? (icons[n] = mdi[camel(n)]) : missing.push(n));
  if (missing.length) console.warn(`not in @mdi/js: ${missing.join(", ")}`);
} catch (err) {
  // no @mdi/js here: keep a map an earlier build made, else fall back to the test page's (fewer icons)
  const prev = path.join(VENDOR, "icons.js");
  const read = (f) => JSON.parse(fs.readFileSync(f, "utf8").match(/^window\.ICONS=(\{.*?\});/s)[1]);
  if (fs.existsSync(prev)) { icons = read(prev); console.warn("@mdi/js not found: keeping the icon map already in site/vendor"); }
  else { icons = read(path.join(ROOT, "test/icons.js")); console.warn("@mdi/js not found: using the test page's icon map, some icons will be plain circles"); }
}
fs.writeFileSync(path.join(VENDOR, "icons.js"), `window.ICONS=${JSON.stringify(icons)};window.SAVVY_DEMO_VERSION=${JSON.stringify(version)};\n`);
console.log(`site/vendor: savvy-cards.js v${version}, ${Object.keys(icons).length} icons`);

if (process.argv.includes("--serve")) {
  const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
  const port = Number(process.env.PORT) || 8080;
  http.createServer((req, res) => {
    let file = path.join(SITE, decodeURIComponent(req.url.split("?")[0]));
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!file.startsWith(SITE) || !fs.existsSync(file)) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  }).listen(port, () => console.log(`http://localhost:${port}/`));
}
