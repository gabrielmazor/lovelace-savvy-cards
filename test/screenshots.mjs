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
const SHOTS = [
  ["lights", "savvy-lights-card", { area: "living_room", featured: ["light.living_room_ceiling"], chips: [{ entity: "switch.living_room_plug", name: "Plug" }] }, 520],
  ["lights-compact", "savvy-lights-card", { area: "living_room", layout: "compact" }, 520],
  ["climate", "savvy-climate-card", { area: "living_room", weather: "weather.home" }, 460],
  ["climate-compact", "savvy-climate-card", { area: "living_room", layout: "compact" }, 460],
  ["vacuum", "savvy-vacuum-card", { entity: "vacuum.robot", start: "button.robot_vacuum" }, 520, VACUUM_WS],
  ["vacuum-compact", "savvy-vacuum-card", { entity: "vacuum.robot", layout: "compact" }, 460, VACUUM_WS],
  ["health", "savvy-health-card", { watchman: ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"], max_rows: 10 }, 420],
  ["health-batteries", "savvy-health-card", { source: "battery" }, 420],
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
    const page = await browser.newPage({ viewport: { width: width + 80, height: 1200 }, deviceScaleFactor: 2 });
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
    }, { type, config, width });
    await page.waitForTimeout(900);
    for (let i = 0; i < 30; i++) {
      if (!(await page.evaluate(() => window.cards.some((c) => (c._springs || []).some((s) => !s.idle))))) break;
      await page.waitForTimeout(150);
    }
    await page.locator("#stage").screenshot({ path: path.join(OUT, `${name}-${theme}.png`) });
    await page.close();
  }
  process.stdout.write(`${name} `);
}
await browser.close();
server.close();
console.log(`\n${SHOTS.length * 2} screenshots in docs/images`);
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
