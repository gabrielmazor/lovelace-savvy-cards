// Renders every card on the made-up house, dark and light, into docs/images/ for the
// README. Rerun after a card changes:  node test/screenshots.mjs
// (needs Playwright: `playwright` installed, or PLAYWRIGHT=/path/to/playwright)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs/images");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

// name, card type, config, width, and an optional setup run in the page first
const VACUUM_WS = `window.hass.callWS = async (m) => {
  if (m.type === "config/entity_registry/get") return { entity_id: m.entity_id, options: { vacuum: { area_mapping: { living_room: ["16"], kitchen: ["17"], bedroom: ["18"] } } } };
  if (m.type === "vacuum/get_segments") return { segments: [] };
  throw new Error("unmocked " + m.type);
};`;
// the tiles: three rooms side by side (the first is mounted by the loop)
const TILES = `window.__tiles = () => { for (const area of ["bedroom", "office"]) window.mount("savvy-room-tile", { area }, 260); };`;
// a day of history, and a month of statistics, for the graphs
const RECORDER = `window.hass.callWS = async (m) => {
  const now = Date.now(), H = 3600000, out = {};
  for (const id of m.entity_ids || m.statistic_ids) {
    if (m.type === "history/history_during_period") out[id] = Array.from({ length: 48 }, (_, i) => ({ s: String(21.5 + 2.2 * Math.sin(i / 7) + (i % 5) * 0.08), lu: (now - (48 - i) * H / 2) / 1000 }));
    else out[id] = Array.from({ length: 30 }, (_, i) => ({ mean: 3 + (i % 7) * 0.6 + Math.sin(i) * 0.4, start: now - (30 - i) * 24 * H }));
  }
  return out;
};`;
// Frigate, enough for the recordings summary
const FRIGATE = `window.hass.callWS = async (m) => {
  const now = Date.now() / 1000;
  if (m.type === "frigate/reviews/get") return [{ id: "r1", camera: m.cameras[0], start_time: now - 300, end_time: now - 240, severity: "alert", has_been_reviewed: false, thumb_path: "/x", data: { objects: ["person"] } },
    { id: "r2", camera: m.cameras[0], start_time: now - 7200, end_time: now - 7150, severity: "detection", has_been_reviewed: true, thumb_path: "/x", data: { objects: ["dog"] } }];
  if (m.type === "frigate/recordings/get") return [];
  if (m.type === "frigate/recordings/summary") return [];
  if (m.type === "auth/sign_path") return { path: m.path };
  throw new Error("unmocked");
};`;
const SHOTS = [
  ["lights", "savvy-lights-card", { area: "living_room", featured: ["light.living_room_ceiling"], chips: [{ entity: "switch.living_room_plug", name: "Plug" }] }, 520],
  ["lights-compact", "savvy-lights-card", { area: "living_room", layout: "compact" }, 520],
  ["climate", "savvy-climate-card", { area: "living_room", weather: "weather.home" }, 460],
  ["climate-compact", "savvy-climate-card", { area: "living_room", layout: "compact" }, 460],
  ["vacuum", "savvy-vacuum-card", { entity: "vacuum.robot", start: "button.robot_vacuum" }, 520, VACUUM_WS],
  ["vacuum-compact", "savvy-vacuum-card", { entity: "vacuum.robot", layout: "compact" }, 460, VACUUM_WS],
  ["health", "savvy-health-card", { watchman: ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"], max_rows: 10 }, 420],
  ["health-batteries", "savvy-health-card", { source: "battery" }, 420],
  ["home", "savvy-home-card", { mode: "input_select.house_mode", home_path: "/lovelace/home",
    health: { watchman: ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"] } }, 600],
  ["room", "savvy-room-card", { area: "living_room", mode: "input_select.living_room_scene", home_path: "/lovelace/home", room_path: "/lovelace/{slug}",
    entities: [{ entity: "input_boolean.movie_mode", name: "Movie", icon: "mdi:movie-open" }] }, 600],
  ["heading", "savvy-heading-card", { area: "living_room", mode: "input_select.living_room_scene" }, 520],
  ["tiles", "savvy-room-tile", { area: "living_room", mode: "input_select.living_room_scene" }, 260, TILES],
  ["entity", "savvy-entity-card", { entity: "person.alex", chips: [{ entity: "switch.living_room_plug", name: "Plug", icon: "mdi:power-plug", color: "blue" },
    { entity: "sensor.alex_phone_battery", name: "Phone" }] }, 340],
  ["graph", "savvy-graph-card", { title: "House", entities: [{ entity: "sensor.living_room_temperature", name: "Living room",
    thresholds: [{ value: 0, level: "good" }, { value: 23, level: "warn" }, { value: 26, level: "bad" }] }, { entity: "sensor.energy_cost", name: "Energy", hours_to_show: 720 },
    { entity: "binary_sensor.living_room_door", name: "Door" }, { entity: "sensor.watchman_last_parse", name: "Checked" }] }, 560, RECORDER],
  ["snapshot", "savvy-snapshot-card", { area: "living_room", chips: [{ entity: "input_boolean.movie_mode", name: "Movie", icon: "mdi:movie-open" }] }, 460],
  ["snapshot-compact", "savvy-snapshot-card", { area: "bedroom", layout: "compact" }, 400],
  ["media", "savvy-media-card", { area: "living_room", presets: [{ entity: "script.good_night", name: "Good night" }] }, 460],
  ["media-compact", "savvy-media-card", { area: "kitchen", layout: "compact" }, 460],
  ["camera", "savvy-camera-card", { area: ["living_room", "kitchen"] }, 820, FRIGATE],
];

const TYPES = { ".html": "text/html", ".js": "application/javascript" };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/test/page.html`;
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const errors = [];
for (const [name, type, config, width, setup] of SHOTS) {
  for (const theme of ["dark", "light"]) {
    const page = await browser.newPage({ viewport: { width: (name === "tiles" ? 3 * width + 24 : width) + 80, height: 1200 }, deviceScaleFactor: 2 });
    page.on("pageerror", (e) => errors.push(`${name}/${theme}: ${e}`));
    if (theme === "light") {
      await page.addInitScript(() => new MutationObserver((_, o) => { if (document.body) { document.body.classList.add("light"); o.disconnect(); } })
        .observe(document, { childList: true, subtree: true }));
    }
    await page.goto(base);
    await page.waitForFunction(() => window.mount);
    if (setup) await page.evaluate(setup);
    await page.evaluate(({ type, config, width }) => {
      document.getElementById("stage").style.cssText = "padding:16px;display:block";
      window.mount(type, config, width);
      if (window.__tiles) { document.getElementById("stage").style.cssText = "padding:16px;display:flex;gap:12px"; window.__tiles(); }
    }, { type, config, width });
    await page.waitForTimeout(900);
    for (let i = 0; i < 30; i++) {
      if (!(await page.evaluate(() => window.cards.some((c) => (c._springs || []).some((s) => !s.idle && s.group !== "liquid"))))) break;
      await page.waitForTimeout(150);
    }
    const stage = await page.evaluateHandle(() => document.getElementById("stage"));   // not a card's own #stage
    await stage.asElement().screenshot({ path: path.join(OUT, `${name}-${theme}.png`) });
    await page.close();
  }
  process.stdout.write(`${name} `);
}
await browser.close();
server.close();
console.log(`\n${SHOTS.length * 2} screenshots in docs/images`);
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
