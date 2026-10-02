// ---------------------------------------------------------------------------------------
// core/rooms: what a room has and what the house is doing, for the home, room, heading and
// tile cards. All of it is computed from states and the registries: no helper needed.
//
// Badges (a room's row of little status icons) follow one rule everywhere:
//   entities:       pinned, in this order, always shown (dimmed when idle)
//   auto_discover:  true (default) adds what the area has, one badge per kind; presence and
//                   doors always show, the rest only while they're doing something.
//                   A kind you pinned an entity of is yours: it isn't discovered again.
//   include:        entities discovered as if they were in the area (a lock that has none)
//   exclude:        entities never discovered;  exclude_kinds: kinds never discovered
// ---------------------------------------------------------------------------------------

const BADGE_KINDS = [
  { key: "presence", name: "Presence", domain: "binary_sensor", dc: ["occupancy", "motion", "presence"], always: true },
  { key: "door", name: "Door", domain: "binary_sensor", dc: ["door", "garage_door", "opening"], always: true },
  { key: "media", name: "Media", domain: "media_player", color: "#C98BD9" },
  { key: "lock", name: "Lock", domain: "lock", color: "#E6C48F" },
  { key: "climate", name: "Climate", domain: "climate", color: "#7FC4E8", icon: "mdi:fan", spin: true },
  { key: "fan", name: "Fan", domain: "fan", color: "#7FC4E8" },
  { key: "cover", name: "Cover", domain: "cover" },
  { key: "window", name: "Window", domain: "binary_sensor", dc: ["window"] },
  { key: "leak", name: "Leak", domain: "binary_sensor", dc: ["moisture"], color: "#5FA8E0", critical: true },
  { key: "alarm", name: "Smoke / gas", domain: "binary_sensor", dc: ["smoke", "gas", "carbon_monoxide"], color: "#E06666", critical: true },
];
const LIGHT_COLOR = "#F5B83D";
// a pinned entity's colour when active, by domain (a kind's colour wins when it matches)
const DOMAIN_COLOR = { light: LIGHT_COLOR, switch: LIGHT_COLOR, input_boolean: LIGHT_COLOR, media_player: "#C98BD9",
  lock: "#E6C48F", climate: "#7FC4E8", fan: "#7FC4E8", alarm_control_panel: "#E6C48F" };

const kindOf = (hass, id) => {
  const d = domainOf(id), dc = hass.states[id]?.attributes.device_class;
  return BADGE_KINDS.find((k) => k.domain === d && (!k.dc || k.dc.includes(dc))) || null;
};

// A group entity (a light group, a media group) lists its members in `entity_id`:
// counting it too would count its lights twice.
const isGroup = (st) => Array.isArray(st?.attributes.entity_id) || st?.attributes.is_hue_group === true
  || (String(st?.entity_id).startsWith("light.") && Array.isArray(st?.attributes.lights));

// The badge row for an area: [{ key, entity, ids, kind, on, pinned, cfg }]
// opts.idle: every kind the area has, active or not (the room card's full sensor row)
// opts.alwaysKinds: kind keys that show even when idle, besides presence and doors
function roomBadges(hass, area, cfg = {}, opts = {}) {
  const out = [], pinnedIds = new Set(), pinnedKinds = new Set();
  for (const item of asItems(cfg.entities)) {
    const st = hass.states[item.entity];
    if (!st) continue;
    const kind = kindOf(hass, item.entity);
    pinnedIds.add(item.entity);
    if (kind) pinnedKinds.add(kind.key);
    out.push({ key: `pin:${item.entity}`, entity: item.entity, ids: [item.entity], kind, on: isActive(st), pinned: true, cfg: item });
  }
  if (cfg.auto_discover === false || (!area && !cfg.include)) return out;
  const skip = new Set([...asItems(cfg.exclude).map((i) => i.entity), ...pinnedIds]);
  const skipKinds = new Set([].concat(cfg.exclude_kinds || []));
  const ids = [...new Set([...areaEntities(hass, area), ...asItems(cfg.include).map((i) => i.entity)])];
  for (const kind of BADGE_KINDS) {
    if (skipKinds.has(kind.key) || pinnedKinds.has(kind.key)) continue;
    const found = pick(hass, ids, { domains: kind.domain, deviceClasses: kind.dc, exclude: [...skip] }).filter((id) => !isGroup(hass.states[id]));
    if (!found.length) continue;
    const active = found.find((id) => isActive(hass.states[id]));
    if (!active && !kind.always && !opts.idle && !(opts.alwaysKinds || []).includes(kind.key)) continue;
    out.push({ key: kind.key, entity: active || found[0], ids: found, kind, on: !!active, pinned: false, cfg: {} });
  }
  return out;
}

// The look of a badge: icon (null: the entity's own state icon), colour when active.
const badgeLook = (b) => ({
  icon: b.cfg.icon || b.kind?.icon || null,
  color: colorOf(b.cfg.color) || b.kind?.color || DOMAIN_COLOR[domainOf(b.entity)] || "",
  spin: !!b.kind?.spin && !b.cfg.icon,
  critical: !!b.kind?.critical,
});

// What a badge does when config says nothing: pinned entities do their domain's obvious
// thing (a helper toggles, a sensor opens more-info); a discovered kind with several
// members lists them on hold.
const badgeDefaults = (b) => ({
  tap: b.pinned ? defaultTapAction(b.entity) : { action: "more-info" },
  hold: b.ids.length > 1 ? { action: "list" } : { action: "more-info" },
});

// Is a climate unit actually blowing? hvac_action when it reports one, else its state.
const climateRunning = (st) => {
  if (!st || isOff(st) || st.state === "off") return false;
  const a = st.attributes.hvac_action;
  return a === undefined || !["off", "idle"].includes(a);
};
// Turns per second for a spinning fan icon, by the unit's fan speed.
const SPIN = { low: 1 / 6.5, medium: 1 / 4.4, high: 1 / 3.1 };
const fanRate = (st) => {
  const mode = norm(st?.attributes.fan_mode);
  for (const key in SPIN) if (mode.includes(key)) return SPIN[key];
  if (/quiet|silent|eco|min|low/.test(mode)) return SPIN.low;
  if (/turbo|max|strong|high/.test(mode)) return SPIN.high;
  return SPIN.medium;
};

// The room's temperature: the one config names (false: none), else the area's temperature
// sensor, else its climate unit's own reading. -> { entity, value, unit } or null
function roomTemperature(hass, area, cfg = {}) {
  const given = cfg.temperature;
  if (given === false) return null;
  const read = (id) => {
    const st = hass.states[id];
    const v = st ? parseFloat(st.state) : NaN;
    return Number.isFinite(v) ? { entity: id, value: v, unit: st.attributes.unit_of_measurement || "°C" } : null;
  };
  if (typeof given === "string") return read(given);
  if (!area) return null;
  const ids = areaEntities(hass, area);
  const sensor = pick(hass, ids, { domains: "sensor", deviceClasses: "temperature" }).find((id) => read(id));
  if (sensor) return read(sensor);
  for (const id of pick(hass, ids, { domains: "climate" })) {
    const st = hass.states[id], v = Number(st.attributes.current_temperature);
    if (st.attributes.current_temperature != null && Number.isFinite(v)) {
      return { entity: id, value: v, unit: hass.config?.unit_system?.temperature || "°C" };
    }
  }
  return null;
}

// The lights of an area (groups left out), by name.
const areaLights = (hass, area) => pick(hass, areaEntities(hass, area), { domains: "light" })
  .filter((id) => !isGroup(hass.states[id]))
  .sort((a, b) => (hass.states[a].attributes.friendly_name || a).localeCompare(hass.states[b].attributes.friendly_name || b));

// ---- the house: what the home card's four chips count

// Every light and every media player in the house that sits in an area (integration and
// cloud entities without a room aren't the house's lights).
const houseOf = (hass, domain, skip = NONE) => houseEntities(hass, { inArea: true })
  .filter((id) => domainOf(id) === domain && !isGroup(hass.states[id]) && !skip(id));

// A chip's ignore list: `exclude` (entities) and `exclude_areas` (rooms). Counting and the
// popup both go through it, so the number is always what the popup lists.
const NONE = () => false;
function ignoring(hass, cfg = {}) {
  const ids = new Set([].concat(cfg.exclude || []));
  const areas = new Set([].concat(cfg.exclude_areas || []));
  if (!ids.size && !areas.size) return NONE;
  return (id) => ids.has(id) || (areas.size > 0 && areas.has(entityArea(hass, id)));
}

// Every light in the house: with an area or not, hidden or not (a group's members are
// often hidden), in the registry or not (YAML lights). Groups are left out so nothing
// counts twice, and so are disabled lights and config/diagnostic ones.
function houseLights(hass, skip = NONE) {
  const all = Object.keys(hass.states).filter((id) => {
    if (!id.startsWith("light.")) return false;
    const e = hass.entities?.[id];
    return !(e && (e.disabled_by || e.entity_category)) && !isGroup(hass.states[id]) && !skip(id);
  }).sort((a, b) => (hass.states[a].attributes.friendly_name || a).localeCompare(hass.states[b].attributes.friendly_name || b));
  return { all, on: all.filter((id) => hass.states[id].state === "on") };
}
function housePlaying(hass, skip = NONE) {
  const all = houseOf(hass, "media_player", skip);
  return { all, on: all.filter((id) => hass.states[id].state === "playing") };
}

// The average indoor temperature: climate units' own readings, else the temperature
// sensors assigned to an area. -> { value, unit, ids, running: [climates blowing] }
function houseTemperature(hass, skip = NONE) {
  const inside = houseEntities(hass, { inArea: true }).filter((id) => !skip(id));
  const climates = inside.filter((id) => domainOf(id) === "climate");
  const running = climates.filter((id) => climateRunning(hass.states[id]));
  let ids = climates.filter((id) => Number.isFinite(Number(hass.states[id].attributes.current_temperature)) && hass.states[id].attributes.current_temperature != null);
  let values = ids.map((id) => Number(hass.states[id].attributes.current_temperature));
  let unit = hass.config?.unit_system?.temperature || "°C";
  if (!ids.length) {
    ids = pick(hass, inside, { domains: "sensor", deviceClasses: "temperature" }).filter((id) => Number.isFinite(parseFloat(hass.states[id].state)));
    values = ids.map((id) => parseFloat(hass.states[id].state));
    if (ids.length) unit = hass.states[ids[0]].attributes.unit_of_measurement || unit;
  }
  const value = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  return { value, unit, ids: [...new Set([...climates, ...ids])], running };
}

// Security: the alarm panel when there is one; otherwise what's open or unlocked. A tripped
// leak / smoke / gas / CO sensor is an alert on top of that; presence and motion are listed
// for information and never change the word.
// -> { entity, open, locks, presence, safety, tripped, ids: [everything relevant] }
const SAFETY_CLASSES = ["moisture", "smoke", "gas", "carbon_monoxide"];
const PRESENCE_CLASSES = ["occupancy", "motion", "presence"];
const SAFETY_WORD = { moisture: "Leak", smoke: "Smoke", gas: "Gas", carbon_monoxide: "CO" };
function houseSecurity(hass, skip = NONE) {
  const inside = houseEntities(hass).filter((id) => !skip(id));
  const alarm = inside.find((id) => domainOf(id) === "alarm_control_panel") || null;
  const locks = inside.filter((id) => domainOf(id) === "lock");
  const openings = pick(hass, houseEntities(hass, { inArea: true }).filter((id) => !skip(id)), { domains: "binary_sensor", deviceClasses: ["door", "window", "garage_door", "opening"] });
  const presence = pick(hass, inside, { domains: "binary_sensor", deviceClasses: PRESENCE_CLASSES });
  const safety = pick(hass, inside, { domains: "binary_sensor", deviceClasses: SAFETY_CLASSES });
  const tripped = safety.filter((id) => hass.states[id]?.state === "on");
  const open = [...locks, ...openings].filter((id) => isActive(hass.states[id]));
  return { entity: alarm, open, locks, presence, safety, tripped, ids: [...(alarm ? [alarm] : []), ...locks, ...openings, ...safety, ...presence] };
}

// what a tripped safety sensor is called: "Leak", "Smoke", or "2 alerts"
function securityAlertWord(hass, tripped) {
  if (!tripped.length) return "";
  const kinds = [...new Set(tripped.map((id) => SAFETY_WORD[hass.states[id]?.attributes.device_class] || "Alert"))];
  return tripped.length === 1 ? kinds[0] : `${tripped.length} alerts`;
}

// The pre-Savvy badge keys, for the room / heading / tile cards: `locks: lock.x` (or any
// kind's own key) named entities to show as that kind; `light_state` was the room's
// lights helper, shown first and toggled on tap; `ignore_sensors` hid kinds.
function legacyBadges(c) {
  const out = { ...c };
  const include = asItems(c.include).map((i) => i.entity);
  for (const k of BADGE_KINDS) {
    for (const key of [k.key, `${k.key}s`]) {
      const v = c[key];
      if (typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "string"))) { include.push(...[].concat(v)); delete out[key]; }
    }
  }
  if (include.length) out.include = [...new Set(include)];
  if (c.light_state && c.entities === undefined) out.entities = [{ entity: c.light_state, name: "Light", icon: "mdi:light-switch" }];
  if (c.ignore_sensors && c.exclude_kinds === undefined) out.exclude_kinds = c.ignore_sensors;
  return out;
}
