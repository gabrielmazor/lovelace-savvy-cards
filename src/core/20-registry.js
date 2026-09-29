// ---------------------------------------------------------------------------------------
// core/registry: auto-discovery. Everything is found through HA's area, device and entity
// registries plus device_class, never from entity-id patterns (ids differ house to house).
// ---------------------------------------------------------------------------------------

const domainOf = (id) => String(id || "").split(".")[0];

const isOff = (st) => !st || st.state === "unavailable" || st.state === "unknown";
// a button/scene/script sits at "unknown" until it's first used; that isn't broken
const STATELESS = new Set(["button", "input_button", "scene", "script"]);
const isDown = (st) => !st || st.state === "unavailable"
  || (st.state === "unknown" && !STATELESS.has(domainOf(st.entity_id)));

const TOGGLES = new Set(["light", "switch", "input_boolean", "fan", "siren", "automation", "lock", "cover",
  "humidifier", "climate", "media_player", "vacuum", "valve", "water_heater"]);

// "Is it doing something?" per domain, for counting and for a chip's lit state.
function isActive(st) {
  if (!st || isOff(st)) return false;
  const d = domainOf(st.entity_id), s = st.state;
  if (d === "media_player") return s === "playing";
  if (d === "climate") return s !== "off";
  if (d === "lock") return s === "unlocked" || s === "open" || s === "opening";
  if (d === "cover" || d === "valve") return s === "open" || s === "opening" || s === "closing";
  if (d === "vacuum") return s === "cleaning" || s === "returning";
  if (d === "alarm_control_panel") return s !== "disarmed";
  if (d === "sensor" || d === "number" || d === "input_number") return false;
  return s === "on" || s === "home" || s === "open";
}

// The area an entity lives in: its own, else its device's.
const entityArea = (hass, id) => {
  const e = hass.entities?.[id];
  if (!e) return null;
  return e.area_id || hass.devices?.[e.device_id]?.area_id || null;
};

// A registry entry that shouldn't be discovered: hidden, disabled, or a config/diagnostic
// entity (a battery level, a firmware switch). Explicit config can still name it.
const discoverable = (e) => !!e && !e.hidden && !e.hidden_by && !e.disabled_by && !e.entity_category;

// All discoverable entities of an area, cached against the registries' identity: they
// only change on config edits, while states change constantly.
const areaCache = new WeakMap();
function areaEntities(hass, area) {
  if (!hass?.entities || !area) return [];
  let byArea = areaCache.get(hass.entities);
  if (!byArea || byArea.devices !== hass.devices) {
    byArea = new Map();
    byArea.devices = hass.devices;
    for (const id in hass.entities) {
      const e = hass.entities[id];
      if (!discoverable(e)) continue;
      const a = e.area_id || hass.devices?.[e.device_id]?.area_id;
      if (!a) continue;
      if (!byArea.has(a)) byArea.set(a, []);
      byArea.get(a).push(id);
    }
    areaCache.set(hass.entities, byArea);
  }
  return byArea.get(area) || [];
}

// Every discoverable entity in the house, optionally only those that sit in some area
// (the house's "real" rooms, leaving out integration and cloud entities).
function houseEntities(hass, { inArea = false } = {}) {
  const out = [];
  for (const id in hass.states) {
    const e = hass.entities?.[id];
    if (e && !discoverable(e)) continue;
    if (inArea && !entityArea(hass, id)) continue;
    out.push(id);
  }
  return out;
}

// Filter a list of ids by domain(s) and device_class(es), and drop exclusions.
// deviceClasses is a preference order: rank() is its index, so callers can pick the best.
function pick(hass, ids, { domains, deviceClasses, exclude } = {}) {
  const dom = domains ? new Set([].concat(domains)) : null;
  const dcs = deviceClasses ? [].concat(deviceClasses) : null;
  const skip = new Set([].concat(exclude || []));
  return ids.filter((id) => {
    if (skip.has(id)) return false;
    if (dom && !dom.has(domainOf(id))) return false;
    if (dcs && !dcs.includes(hass.states[id]?.attributes.device_class)) return false;
    return !!hass.states[id];
  });
}
const rankBy = (hass, ids, deviceClasses) => {
  const dcs = [].concat(deviceClasses);
  const rank = (id) => { const i = dcs.indexOf(hass.states[id]?.attributes.device_class); return i < 0 ? 99 : i; };
  return [...ids].sort((a, b) => rank(a) - rank(b));
};

const areaInfo = (hass, area) => {
  const a = hass?.areas?.[area];
  return { id: area, name: a?.name || title(area || ""), icon: a?.icon || null };
};
const allAreas = (hass) => Object.values(hass?.areas || {})
  .map((a) => ({ id: a.area_id, name: a.name || title(a.area_id), icon: a.icon || null }))
  .sort((a, b) => a.name.localeCompare(b.name));

// A friendly name with the area's name taken off its front: "Living Room Main Light"
// in the Living Room reads "Main Light". Unchanged if that would leave nothing.
function shortName(hass, id, area) {
  const st = hass.states[id];
  const name = st?.attributes.friendly_name || title((id.split(".")[1] || id));
  const a = area || entityArea(hass, id);
  const prefix = a ? areaInfo(hass, a).name : "";
  if (prefix && name.toLowerCase().startsWith(`${prefix.toLowerCase()} `) && name.length > prefix.length + 1) {
    return name.slice(prefix.length + 1);
  }
  return name;
}

// A config value that may be one id, a list, {entity, …} objects, or false.
function asItems(v) {
  if (v === false || v == null) return [];
  return [].concat(v).map((x) => (typeof x === "string" ? { entity: x } : x)).filter((x) => x && (x.entity || x.navigation_path || x.tap_action));
}
