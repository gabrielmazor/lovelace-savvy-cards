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
// the media card with several video sources and sound outputs: a TV, a console, a streamer and a PC, the
// soundbar the TV and console play through, a speaker pair the PC plays through
const MEDIA_SOURCES = `(() => {
  const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
  const patch = {};
  const add = (id, state, attrs, mins = 5) => {
    window.house.entities[id] = { entity_id: id, area_id: "living_room", device_id: null, platform: "demo", entity_category: null, hidden: false, disabled_by: null };
    patch[id] = { entity_id: id, state, attributes: attrs, last_changed: ago(mins), last_updated: ago(mins) };
  };
  const SF = 21437;
  add("media_player.living_room_console", "playing", { friendly_name: "Console", device_class: "tv", media_title: "Night Drive", media_artist: "Racing game", supported_features: SF }, 14);
  add("media_player.living_room_streamer", "idle", { friendly_name: "Streamer", device_class: "tv", supported_features: SF }, 90);
  add("media_player.living_room_pc", "off", { friendly_name: "PC", device_class: "tv", supported_features: SF }, 300);
  add("media_player.living_room_soundbar", "on", { friendly_name: "Soundbar", device_class: "receiver", volume_level: 0.34, supported_features: SF }, 14);
  add("media_player.living_room_speakers", "idle", { friendly_name: "Speakers", device_class: "speaker", volume_level: 0.2, supported_features: SF }, 90);
  add("media_player.living_room_tv", "on", { friendly_name: "Living Room TV", device_class: "tv", source: "HDMI 2", source_list: ["HDMI 1", "HDMI 2", "HDMI 3"], volume_level: 0.12, supported_features: SF | 2048 }, 14);
  window.setStates(patch);
})();`;
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
// a house with the garage left open, for the Last check card
const LEFT_OPEN = `(() => {
  const h = window.hass, house = window.house;
  house.states["cover.garage_door"] = { entity_id: "cover.garage_door", state: "open", attributes: { friendly_name: "Garage Door", device_class: "garage" }, last_changed: new Date().toISOString(), last_updated: new Date().toISOString() };
  h.entities["cover.garage_door"] = { entity_id: "cover.garage_door", area_id: "hallway", device_id: null, platform: "demo", entity_category: null, hidden: false, disabled_by: null };
  window.hass = { ...h, states: { ...house.states } };
})();`;
// a day at home, for the Home story card: the logbook is faked
const STORY_DAY = `(() => {
  const h = window.hass, house = window.house;
  const add = (id, state, attributes, area) => { house.states[id] = { entity_id: id, state, attributes, last_changed: new Date().toISOString(), last_updated: new Date().toISOString() }; h.entities[id] = { entity_id: id, area_id: area, device_id: null, platform: "demo", entity_category: null, hidden: false, disabled_by: null }; };
  add("binary_sensor.kitchen_motion", "off", { friendly_name: "Kitchen Motion", device_class: "motion" }, "kitchen");
  add("person.alex", "home", { friendly_name: "Alex", user_id: "u1" }, null);
  window.hass = { ...h, states: { ...house.states } };
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const at = (hh, mm = 0) => (day.getTime() + (hh * 60 + mm) * 60000) / 1000;
  const ev = (entity_id, state, when, extra = {}) => ({ entity_id, state, when, ...extra });
  const events = [
    ...[0, 5, 10, 15, 20, 25, 30].map((m) => ev("binary_sensor.kitchen_motion", "on", at(7, 10 + m))),
    ev("person.alex", "not_home", at(8)), ev("binary_sensor.living_room_door", "on", at(12)), ev("binary_sensor.living_room_door", "off", at(12, 1)),
    ev("person.alex", "home", at(17, 55)), ev("lock.front_door", "unlocked", at(18, 2), { context_user_id: "u1" }), ev("lock.front_door", "locked", at(18, 3)),
    ev("light.living_room_ceiling", "on", at(18, 2)), ev("light.living_room_floor_lamp", "on", at(18, 10)),
    ev("light.living_room_ceiling", "off", at(21, 40)), ev("light.living_room_floor_lamp", "off", at(21, 52)),
  ];
  window.hass.callWS = async (m) => (m.type === "logbook/get_events" ? events : {});
})();`;
// covers around the house, for the Cover card
const COVERS = `(() => {
  const h = window.hass, house = window.house;
  const add = (id, state, attributes, area) => { house.states[id] = { entity_id: id, state, attributes, last_changed: new Date().toISOString(), last_updated: new Date().toISOString() }; h.entities[id] = { entity_id: id, area_id: area, device_id: null, platform: "demo", entity_category: null, hidden: false, disabled_by: null }; };
  add("cover.living_room_blind", "open", { friendly_name: "Living Room Blind", device_class: "blind", current_position: 60, current_tilt_position: 40, supported_features: 207 }, "living_room");
  add("cover.living_room_curtain", "closed", { friendly_name: "Living Room Curtain", device_class: "curtain", current_position: 0, supported_features: 15 }, "living_room");
  add("cover.living_room_awning", "open", { friendly_name: "Living Room Awning", device_class: "awning", current_position: 100, supported_features: 15 }, "living_room");
  window.hass = { ...h, states: { ...house.states } };
  window.__after = () => { const R = window.cards[0].shadowRoot; R.querySelector(".sv-row .sv-chev")?.click(); };
})();`;
// a family, for the People card
const FAMILY = `(() => {
  const h = window.hass, house = window.house;
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  const add = (id, state, attributes, extra = {}) => { house.states[id] = { entity_id: id, state, attributes, last_changed: extra.changed || ago(30), last_updated: ago(30) }; h.entities[id] = { entity_id: id, area_id: null, device_id: extra.device || null, platform: "demo", entity_category: null, hidden: false, disabled_by: null }; };
  const pic = (c) => "data:image/svg+xml;utf8," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='88' height='88'><rect width='88' height='88' fill='" + c + "'/><circle cx='44' cy='34' r='15' fill='white' fill-opacity='.85'/><ellipse cx='44' cy='78' rx='26' ry='22' fill='white' fill-opacity='.85'/></svg>");
  add("person.alex", "home", { friendly_name: "Alex", source: "device_tracker.alex_phone", entity_picture: pic("#5a8fd6") }, { changed: ago(190) });
  add("device_tracker.alex_phone", "home", {}, { device: "d_alex" });
  add("sensor.alex_phone_battery", "78", { device_class: "battery", unit_of_measurement: "%" }, { device: "d_alex" });
  add("person.sam", "Work Campus Building", { friendly_name: "Sam", source: "device_tracker.sam_phone", entity_picture: pic("#c98bd9") }, { changed: ago(40) });
  add("device_tracker.sam_phone", "Work", { battery_level: 14 });
  add("zone.work", "0", { friendly_name: "Work Campus Building", icon: "mdi:briefcase" });
  add("person.jo", "not_home", { friendly_name: "Jo", source: "device_tracker.jo_phone" }, { changed: ago(25) });
  add("device_tracker.jo_phone", "not_home", { battery_level: 56 });
  add("sensor.jo_travel", "12", { unit_of_measurement: "min" });
  for (const id of ["person.alex", "person.sam", "person.jo"]) house.states[id].attributes.user_id = id;
  window.hass = { ...h, states: { ...house.states } };
})();`;
// air around the house, for the Fan card
const AIR = `(() => {
  const h = window.hass, house = window.house;
  const add = (id, state, attributes, area) => { house.states[id] = { entity_id: id, state, attributes, last_changed: new Date().toISOString(), last_updated: new Date().toISOString() }; h.entities[id] = { entity_id: id, area_id: area, device_id: null, platform: "demo", entity_category: null, hidden: false, disabled_by: null }; };
  add("fan.bedroom_fan", "on", { friendly_name: "Bedroom Fan", percentage: 60, preset_modes: ["auto", "sleep", "turbo"], preset_mode: "sleep", oscillating: true, supported_features: 11 }, "bedroom");
  add("fan.bedroom_purifier", "off", { friendly_name: "Bedroom Purifier", preset_modes: ["auto", "sleep"], supported_features: 8 }, "bedroom");
  add("humidifier.bedroom_humidifier", "on", { friendly_name: "Bedroom Humidifier", humidity: 50, current_humidity: 38, min_humidity: 30, max_humidity: 80, available_modes: ["normal", "eco", "sleep"], mode: "eco" }, "bedroom");
  window.hass = { ...h, states: { ...house.states } };
  window.__after = () => { for (const r of window.cards[0].shadowRoot.querySelectorAll(".sv-row")) if (/^Fan$/.test(r.querySelector(".sv-name").textContent)) r.querySelector(".sv-chev")?.click(); };
})();`;
// a house's energy, for the Energy card: the clock is set to a Friday at half past six in the evening so the picture is the same at any hour
const POWER = `(() => {
  const RealDate = Date, fixed = new RealDate(); fixed.setHours(18, 30, 0, 0); fixed.setDate(fixed.getDate() - ((fixed.getDay() - 5 + 7) % 7));
  const offset = fixed - RealDate.now();
  window.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + offset); } static now() { return RealDate.now() + offset; } };
  const h = window.hass, house = window.house;
  const add = (id, state, attributes, area) => { house.states[id] = { entity_id: id, state, attributes, last_changed: new Date().toISOString(), last_updated: new Date().toISOString() }; h.entities[id] = { entity_id: id, area_id: area, device_id: null, platform: "demo", entity_category: null, hidden: false, disabled_by: null }; };
  const energy = { device_class: "energy", state_class: "total_increasing", unit_of_measurement: "kWh" };
  add("sensor.house_energy", "1200", { ...energy, friendly_name: "House Energy" }, null);
  add("sensor.kitchen_oven_energy", "300", { ...energy, friendly_name: "Kitchen Oven" }, "kitchen");
  add("sensor.living_room_tv_energy", "80", { ...energy, friendly_name: "Living Room TV" }, "living_room");
  add("sensor.bedroom_ac_energy", "90", { ...energy, friendly_name: "Bedroom AC" }, "bedroom");
  add("sensor.washer_energy", "40", { ...energy, friendly_name: "Washer" }, "kitchen");
  add("sensor.house_power", "1420", { device_class: "power", unit_of_measurement: "W", friendly_name: "House Power" }, null);
  window.hass = { ...h, states: { ...house.states } };
  const base = { "sensor.house_energy": (hr) => 0.35 + (hr >= 6 && hr <= 9 ? 0.7 : 0) + (hr >= 17 && hr <= 22 ? 1.1 : 0) + (hr >= 12 && hr <= 14 ? 0.4 : 0),
    "sensor.kitchen_oven_energy": (hr) => (hr === 18 || hr === 12 ? 0.9 : 0.02), "sensor.living_room_tv_energy": (hr) => (hr >= 17 ? 0.18 : 0.01), "sensor.bedroom_ac_energy": (hr) => (hr >= 21 || hr < 6 ? 0.45 : 0.05), "sensor.washer_energy": (hr) => (hr === 8 || hr === 9 ? 0.5 : 0) };
  window.hass.callWS = async (m) => {
    if (m.type !== "recorder/statistics_during_period") return {};
    const out = {};
    for (const id of m.statistic_ids) { out[id] = []; for (let t = Date.parse(m.start_time); t < Date.parse(m.end_time) && t <= Date.now(); t += 3600000) out[id].push({ start: t, end: t + 3600000, change: base[id](new Date(t).getHours()) * (t < Date.now() - 86400000 * 0.5 ? 0.85 : 1) }); }
    return out;
  };
})();`;
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
  ["graph", "savvy-graph-card", { title: "House", entities: [{ entity: "sensor.living_room_temperature", name: "Living room", thresholds: "temperature" },
    { entity: "sensor.kitchen_temperature", name: "Kitchen", smooth: true, thresholds: [{ value: 16, color: "blue" }, { value: 22, color: "teal" }, { value: 28, color: "deep-orange" }] }, { entity: "sensor.energy_cost", name: "Energy", hours_to_show: 720 },
    { entity: "binary_sensor.living_room_door", name: "Door" }, { entity: "sensor.watchman_last_parse", name: "Checked" }] }, 560, RECORDER],
  ["room-activity", "savvy-room-activity-card", { area: "living_room", chips: [{ entity: "input_boolean.movie_mode", name: "Movie", icon: "mdi:movie-open" }] }, 460],
  ["room-activity-compact", "savvy-room-activity-card", { area: "bedroom", layout: "compact" }, 400],
  ["media", "savvy-media-card", { area: "living_room", presets: [{ entity: "script.good_night", name: "Good night" }] }, 460],
  ["media-sources", "savvy-media-card", { name: "Living room", screen: "media_player.living_room_tv", video: [
      { entity: "media_player.living_room_tv" },
      { entity: "media_player.living_room_streamer", name: "Streamer", icon: "mdi:cast-variant", input: "HDMI 1" },
      { entity: "media_player.living_room_console", name: "Console", icon: "mdi:controller", input: "HDMI 2" },
      { entity: "media_player.living_room_pc", name: "PC", icon: "mdi:desktop-tower-monitor", input: "HDMI 3" }],
    audio: [{ entity: "media_player.living_room_soundbar", name: "Soundbar" }, { entity: "media_player.living_room_speakers", name: "Speakers" }],
    video_output: "media_player.living_room_soundbar" }, 460, MEDIA_SOURCES],
  ["media-compact", "savvy-media-card", { area: "kitchen", layout: "compact" }, 460],
  ["scene", "savvy-scene-card", { area: ["living_room", "office"], entities: [{ entity: "scene.party", icon: "mdi:party-popper", color: "purple" }], strip: "^.*//\\s*|\\s*-\\s*on$" }, 460],
  ["lock", "savvy-lock-card", { entity: "lock.entrance_door", alarm: "alarm_control_panel.home_alarm", camera: "camera.living_room" }, 460, DOOR({})],
  ["lock-full", "savvy-lock-card", { entity: "lock.entrance_door", alarm: "alarm_control_panel.home_alarm", camera: "camera.living_room", alarm_view: "full", camera_view: "full" }, 460, DOOR({})],
  ["lock-unlocked", "savvy-lock-card", { entity: "lock.entrance_door", camera: false }, 460, DOOR({ lock: "unlocked", changed: 25 * 60000, door: "off", battery: 31 })],
  ["lock-compact", "savvy-lock-card", { entities: ["lock.entrance_door", "lock.shed"], layout: "compact", alarm: false, camera: false }, 460, DOOR({})],
  ["lock-several", "savvy-lock-card", { entities: ["lock.entrance_door", "lock.shed", "lock.back_door"], name: "Doors", alarm: false, camera: false }, 460, DOOR({})],
  ["last-check", "savvy-last-check-card", { mode: "leave", area: ["living_room", "kitchen", "hallway", "bedroom"], max_rows: 6 }, 420, LEFT_OPEN],
  ["last-check-compact", "savvy-last-check-card", { mode: "goodnight", layout: "compact", area: ["living_room", "kitchen", "hallway", "bedroom"] }, 420, LEFT_OPEN],
  ["story", "savvy-story-card", { range: "24h" }, 420, STORY_DAY],
  ["story-compact", "savvy-story-card", { layout: "compact", filters: false, max_events: 5 }, 420, STORY_DAY],
  ["cover", "savvy-cover-card", { area: "living_room" }, 420, COVERS],
  ["cover-sliders", "savvy-cover-card", { area: "living_room", controls: "slider" }, 420, COVERS],
  ["cover-compact", "savvy-cover-card", { area: "living_room", layout: "compact" }, 420, COVERS],
  ["people", "savvy-people-card", { title: "Family", people: ["person.alex", "person.sam", { entity: "person.jo", eta: "sensor.jo_travel" }] }, 420, FAMILY],
  ["people-horizontal", "savvy-people-card", { title: "Family", direction: "horizontal", people: ["person.alex", "person.sam", { entity: "person.jo", eta: "sensor.jo_travel" }] }, 400, FAMILY],
  ["people-compact", "savvy-people-card", { layout: "compact", title: "Family" }, 420, FAMILY],
  ["fan", "savvy-fan-card", { area: "bedroom" }, 420, AIR],
  ["fan-compact", "savvy-fan-card", { area: "bedroom", layout: "compact" }, 420, AIR],
  ["energy", "savvy-energy-card", { total: "sensor.house_energy", consumers: ["sensor.kitchen_oven_energy", "sensor.living_room_tv_energy", "sensor.bedroom_ac_energy", "sensor.washer_energy"], power: "sensor.house_power", price: 0.28, currency: "EUR" }, 420, POWER],
  ["energy-week", "savvy-energy-card", { range: "week", by: "room", total: "sensor.house_energy", consumers: ["sensor.kitchen_oven_energy", "sensor.living_room_tv_energy", "sensor.bedroom_ac_energy", "sensor.washer_energy"], price: 0.28, currency: "EUR" }, 420, POWER],
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
