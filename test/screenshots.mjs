// Renders every card on the made-up house, dark and light, into docs/images/ for the
// README. Rerun after a card changes:  node test/screenshots.mjs
// (needs Playwright: `playwright` installed, or PLAYWRIGHT=/path/to/playwright)
// Only some:  node test/screenshots.mjs system-health   (names that start with it)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.SHOTS_OUT || path.join(ROOT, "docs/images");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

// name, card type, config, width, and an optional setup run in the page first
const VACUUM_WS = `window.hass.callWS = async (m) => {
  if (m.type === "config/entity_registry/get") return { entity_id: m.entity_id, options: { vacuum: { area_mapping: { living_room: ["16"], kitchen: ["17"], bedroom: ["18"] } } } };
  if (m.type === "vacuum/get_segments") return { segments: [] };
  throw new Error("unmocked " + m.type);
};`;
// a house where things stopped, for the health card: a Zigbee2MQTT-like bridge (its connectivity
// sensor off) and its devices, a mostly-offline washer, a retrying Tuya integration
const OFFLINE = `const f = window.offlineFixture(window.house, { z2m: true, washer: true, tuya: true, tuyaState: "setup_retry" });
window.hass.callWS = async (m) => { if (m.type === "config_entries/get") return f.entries; throw new Error("unmocked " + m.type); };
window.hass.services = { watchman: { report: {} } };
window.setStates(f.patch);`;
const OFFLINE_OPEN = OFFLINE + `window.__after = () => { const c = window.cards[0]; c._open.add("h:dev_n_bridge"); c._open.add("h:dev_n_bridge/d:dev_n_k1"); c._open.add("i:e:entry_tuya"); c._update(); };`;
// the same house, with a low battery and a device put aside, and their line opened
const DISMISSED = OFFLINE + `const sum = window.__savvy.healthSummary(window.hass, {});
const bat = sum.battery.find((b) => b.alert), dev = sum.offline.find((i) => i.kind === "device");
if (bat) window.__savvy.dismissAdd(window.hass, { id: bat.dismissId, kind: "bat", name: bat.name, members: bat.members });
if (dev) window.__savvy.dismissAdd(window.hass, { id: dev.dismissId, kind: "off", name: dev.name, members: dev.members });
window.__after = () => { const c = window.cards[0]; c._open.add("dm:battery"); c._open.add("dm:unavailable"); c._update(); };`;
// the tiles: three rooms side by side (the first is mounted by the loop)
// the front door: a Nuki-like lock with its door contact and battery, the house alarm, a camera
const DOOR = (o) => `window.setStates(window.entranceFixture(window.house, ${JSON.stringify(o)}));`;
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
// the home header's lights popup with its page button
const POPUP = `window.__popup = true;
window.__after = () => { const c = window.cards[0]; c._showList("Lights on", window.__savvy.houseLights(window.hass).on, "#F5B83D", null, pageButtonFor(c), { sort: "room", toggle: true, storeKey: "shot", bulk: "lights" });
  setTimeout(() => window.__savvy.portalRoot().querySelector('.sv-row[data-kind="light"] .sv-chev:not([data-none])')?.click(), 300); };
function pageButtonFor() { return { label: "Open lights", onTap() {} }; }`;
// popups with their row controls: a few entities made up for the purpose, listed straight from the home header
const SEED = `const add = (id, state, attributes, area, minutesAgo = 20) => {
  window.house.states[id] = { entity_id: id, state, attributes, last_changed: new Date(Date.now() - minutesAgo * 60000).toISOString(), last_updated: new Date().toISOString() };
  window.house.entities[id] = { entity_id: id, area_id: area, device_id: null, platform: "demo", entity_category: null, hidden: false, disabled_by: null };
};`;
const popupOf = (ids, title, color, seed, { bulk = null, open = null, pinned = [] } = {}) => `${SEED}${seed}
window.hass = { ...window.hass, states: { ...window.house.states } };
window.__popup = true;
window.__after = () => { window.cards[0]._showList(${JSON.stringify(title)}, ${JSON.stringify(ids)}, ${JSON.stringify(color)}, null, null, { sort: "room", toggle: true, storeKey: "shot", bulk: ${JSON.stringify(bulk)}, pinned: ${JSON.stringify(pinned)} });
  ${open ? `setTimeout(() => window.__savvy.portalRoot().querySelector('.sv-row[data-id="${open}"] .sv-chev')?.click(), 300);` : ""} };`;
const POPUP_LOCKS = popupOf(["lock.front_door", "lock.back_door", "lock.garage"], "Security", "#E6C48F", `
add("lock.front_door", "locked", { friendly_name: "Front Door", supported_features: 1 }, "hallway", 180);
add("lock.back_door", "unlocked", { friendly_name: "Back Door", supported_features: 1 }, "kitchen", 4);
add("lock.garage", "locked", { friendly_name: "Garage Door" }, "bedroom", 600);`, { bulk: "security" });
const POPUP_SECURITY = popupOf(["alarm_control_panel.home_alarm", "lock.front_door", "binary_sensor.hallway_leak", "binary_sensor.living_room_presence", "binary_sensor.kitchen_motion", "binary_sensor.front_window"], "Security", "#E6C48F", `
add("alarm_control_panel.home_alarm", "armed_home", { friendly_name: "Home Alarm", supported_features: 15 }, null, 300);
add("lock.front_door", "locked", { friendly_name: "Front Door", supported_features: 1 }, "hallway", 180);
add("binary_sensor.hallway_leak", "on", { friendly_name: "Hallway Leak", device_class: "moisture" }, "hallway", 3);
add("binary_sensor.living_room_presence", "on", { friendly_name: "Living Room Presence", device_class: "occupancy" }, "living_room", 12);
add("binary_sensor.kitchen_motion", "off", { friendly_name: "Kitchen Motion", device_class: "motion" }, "kitchen", 25);
add("binary_sensor.front_window", "off", { friendly_name: "Front Window", device_class: "window" }, "living_room", 90);`,
  { bulk: "security", pinned: ["alarm_control_panel.home_alarm", "lock.front_door", "binary_sensor.hallway_leak"] });
const POPUP_MEDIA = popupOf(["media_player.living_tv", "media_player.kitchen_speaker", "media_player.bedroom_tv"], "Media", "#C98BD9", `
add("media_player.living_tv", "playing", { friendly_name: "Living Room TV", supported_features: 21437, volume_level: 0.42, media_title: "Slow Horses", media_artist: "Apple TV+" }, "living_room", 12);
add("media_player.kitchen_speaker", "idle", { friendly_name: "Kitchen Speaker", supported_features: 21437, volume_level: 0.3 }, "kitchen", 90);
add("media_player.bedroom_tv", "off", { friendly_name: "Bedroom TV", supported_features: 21437 }, "bedroom", 300);`, { bulk: "media", open: "media_player.living_tv" });
const POPUP_CLIMATE = popupOf(["climate.living_ac", "climate.bedroom_ac", "climate.office_heater"], "Climate", "#7FC4E8", `
add("climate.living_ac", "cool", { friendly_name: "Living Room AC", hvac_modes: ["off", "cool", "heat", "fan_only"], min_temp: 16, max_temp: 30, target_temp_step: 0.5, temperature: 22, current_temperature: 23.4, hvac_action: "cooling", fan_mode: "medium" }, "living_room", 25);
add("climate.bedroom_ac", "heat", { friendly_name: "Bedroom AC", hvac_modes: ["off", "cool", "heat"], min_temp: 16, max_temp: 30, target_temp_step: 0.5, temperature: 24, current_temperature: 21.8, hvac_action: "idle" }, "bedroom", 50);
add("climate.office_heater", "off", { friendly_name: "Office Heater", hvac_modes: ["off", "heat"], min_temp: 10, max_temp: 28, temperature: 20, current_temperature: 19.2 }, "office", 400);`, { bulk: "climate", open: "climate.living_ac" });
// the settings card, with a few cards on the page taking what it holds (hidden, so only it is in the picture)
const SETTINGS_USERS = `window.__after = () => {
  const SS = window.__savvy.SettingsStore;
  for (const [type, cfg] of [["savvy-home-header-card", {}], ["savvy-section-title-card", { area: "kitchen" }], ["savvy-section-title-card", { area: "living_room" }], ["savvy-room-tile", { area: "office" }]]) {
    window.mount(type, cfg, 300).style.display = "none";
  }
  SS._statsSoon();
};`;
const SETTINGS_CFG = { pages: { home: "/lovelace/home", lights: "/lovelace/lights", room: "/lovelace/{slug}" }, house: { control: "input_select.house_mode", tap: "navigate" },
  health: { battery_threshold: 20 }, rooms: { living_room: { control: "input_select.living_room_scene", light_state: "input_boolean.movie_mode" }, kitchen: { name: "Kitchen" } } };
const SHOTS = [
  ["lights", "savvy-lights-card", { area: "living_room", featured: ["light.living_room_ceiling"], chips: [{ entity: "switch.living_room_plug", name: "Plug" }] }, 520],
  ["lights-compact", "savvy-lights-card", { area: "living_room", layout: "compact" }, 520],
  ["climate", "savvy-climate-card", { area: "living_room", weather: "weather.home" }, 460],
  ["climate-compact", "savvy-climate-card", { area: "living_room", layout: "compact" }, 460],
  ["vacuum", "savvy-vacuum-card", { entity: "vacuum.robot", start: "button.robot_vacuum" }, 520, VACUUM_WS],
  ["vacuum-compact", "savvy-vacuum-card", { entity: "vacuum.robot", layout: "compact" }, 460, VACUUM_WS],
  ["system-health", "savvy-system-health-card", { watchman: ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"], max_rows: 10 }, 420, OFFLINE],
  ["system-health-columns", "savvy-system-health-card", { watchman: ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"], max_rows: 6 }, 900, OFFLINE],
  ["system-health-expanded", "savvy-system-health-card", { max_rows: 16 }, 420, OFFLINE_OPEN],
  ["system-health-details", "savvy-system-health-card", { watchman: ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"], max_rows: 10, details: true }, 420, OFFLINE],
  ["system-health-dismissed", "savvy-system-health-card", { max_rows: 16 }, 420, DISMISSED],
  ["system-health-batteries", "savvy-system-health-card", { source: "battery" }, 420],
  ["home-header", "savvy-home-header-card", { control: "input_select.house_mode", home_path: "/lovelace/home",
    health: { watchman: ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"] } }, 600],
  ["room-header", "savvy-room-header-card", { area: "living_room", control: "input_select.living_room_scene", home_path: "/lovelace/home", room_path: "/lovelace/{slug}",
    entities: [{ entity: "input_boolean.movie_mode", name: "Movie", icon: "mdi:movie-open" }] }, 600],
  ["section-title", "savvy-section-title-card", { area: "living_room", control: "input_select.living_room_scene" }, 520],
  ["home-header-popup", "savvy-home-header-card", { control: "input_select.house_mode", lights: { navigation_path: "/lovelace/lights" } }, 520, POPUP],
  ["home-header-row", "savvy-home-header-card", { home_path: "/lovelace/home" }, 420],
  ["popup-lock", "savvy-home-header-card", { health: false }, 520, POPUP_LOCKS],
  ["popup-security", "savvy-home-header-card", { health: false }, 520, POPUP_SECURITY],
  ["popup-media", "savvy-home-header-card", { health: false }, 520, POPUP_MEDIA],
  ["popup-climate", "savvy-home-header-card", { health: false }, 520, POPUP_CLIMATE],
  ["tiles", "savvy-room-tile", { area: "living_room", control: "input_select.living_room_scene" }, 260, TILES],
  ["entity", "savvy-entity-card", { entity: "person.alex", chips: [{ entity: "switch.living_room_plug", name: "Plug", icon: "mdi:power-plug", color: "blue" },
    { entity: "sensor.alex_phone_battery", name: "Phone" }] }, 340],
  ["graph", "savvy-graph-card", { title: "House", entities: [{ entity: "sensor.living_room_temperature", name: "Living room",
    thresholds: [{ value: 0, level: "good" }, { value: 23, level: "warn" }, { value: 26, level: "bad" }] }, { entity: "sensor.energy_cost", name: "Energy", hours_to_show: 720 },
    { entity: "binary_sensor.living_room_door", name: "Door" }, { entity: "sensor.watchman_last_parse", name: "Checked" }] }, 560, RECORDER],
  ["room-activity", "savvy-room-activity-card", { area: "living_room", chips: [{ entity: "input_boolean.movie_mode", name: "Movie", icon: "mdi:movie-open" }] }, 460],
  ["room-activity-compact", "savvy-room-activity-card", { area: "bedroom", layout: "compact" }, 400],
  ["media", "savvy-media-card", { area: "living_room", presets: [{ entity: "script.good_night", name: "Good night" }] }, 460],
  ["media-compact", "savvy-media-card", { area: "kitchen", layout: "compact" }, 460],
  ["scene", "savvy-scene-card", { area: ["living_room", "office"], entities: [{ entity: "scene.party", icon: "mdi:party-popper", color: "purple" }], strip: "^.*//\\s*|\\s*-\\s*on$" }, 460],
  ["lock", "savvy-lock-card", { entity: "lock.entrance_door", alarm: "alarm_control_panel.home_alarm", camera: "camera.living_room" }, 460, DOOR({})],
  ["lock-full", "savvy-lock-card", { entity: "lock.entrance_door", alarm: "alarm_control_panel.home_alarm", camera: "camera.living_room", alarm_view: "full", camera_view: "full" }, 460, DOOR({})],
  ["lock-unlocked", "savvy-lock-card", { entity: "lock.entrance_door", camera: false }, 460, DOOR({ lock: "unlocked", changed: 25 * 60000, door: "off", battery: 31 })],
  ["lock-compact", "savvy-lock-card", { entities: ["lock.entrance_door", "lock.shed"], layout: "compact", alarm: false, camera: false }, 460, DOOR({})],
  ["lock-several", "savvy-lock-card", { entities: ["lock.entrance_door", "lock.shed", "lock.back_door"], name: "Doors", alarm: false, camera: false }, 460, DOOR({})],
  ["settings", "savvy-settings-card", SETTINGS_CFG, 460, SETTINGS_USERS],
  ["settings-compact", "savvy-settings-card", { ...SETTINGS_CFG, layout: "compact" }, 460, SETTINGS_USERS],
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
const only = process.argv[2];
const todo = SHOTS.filter(([name]) => !only || name.startsWith(only));
for (const [name, type, config, width, setup] of todo) {
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
    if (await page.evaluate(() => !!window.__after)) await page.evaluate(() => window.__after());
    await page.waitForTimeout(900);
    for (let i = 0; i < 30; i++) {
      if (!(await page.evaluate(() => window.cards.some((c) => (c._springs || []).some((s) => !s.idle && s.group !== "liquid"))))) break;
      await page.waitForTimeout(150);
    }
    // a popup lives in the page-level layer: shoot the sheet itself
    const shot = await page.evaluateHandle(() => (window.__popup ? window.__savvy.portalRoot().querySelector(".sv-sheet") : document.getElementById("stage")));   // not a card's own #stage
    if (await page.evaluate(() => !!window.__popup)) await page.waitForTimeout(500);
    await shot.asElement().screenshot({ path: path.join(OUT, `${name}-${theme}.png`) });
    await page.close();
  }
  process.stdout.write(`${name} `);
}
await browser.close();
server.close();
console.log(`\n${todo.length * 2} screenshots in docs/images`);
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
