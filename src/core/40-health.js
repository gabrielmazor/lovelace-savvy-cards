// ---------------------------------------------------------------------------------------
// core/health: what needs attention. savvy-health-card lists these, and savvy-home-card's
// cog counts exactly the same thing, through the same functions and the same options, so
// the badge always matches the lists.
//
// Options (shared by both cards):
//   battery_threshold   a battery below this % is low (default 20)
//   exclude_platforms   integrations to leave out, by registry platform (default
//                       [mobile_app]: phones aren't house batteries). Never by entity-id
//                       suffix: that also matches wall switches and other devices.
//   watchman            Watchman's summary sensors (missing entities / missing actions);
//                       off unless given
//   group_by            hub (default) | device | none: how unavailable entities become issues.
//                       none: one issue per entity. device: one per device (down when all of
//                       its entities are unavailable, partial when only some are). hub: a hub
//                       whose devices are down (a Zigbee bridge, a coordinator) is one issue.
//   group_min           how many devices a hub needs to roll up (default 3)
// ---------------------------------------------------------------------------------------

const HEALTH_DEFAULTS = { battery_threshold: 20, exclude_platforms: ["mobile_app"], watchman: [], group_by: "hub", group_min: 3 };
const GROUP_MODES = ["hub", "device", "none"];
const WATCHMAN_ICON = { missing: "mdi:cloud-alert", unavail: "mdi:cloud-off-outline" };

const healthOptions = (cfg = {}) => ({
  battery_threshold: Number(cfg.battery_threshold ?? HEALTH_DEFAULTS.battery_threshold),
  exclude_platforms: [].concat(cfg.exclude_platforms ?? HEALTH_DEFAULTS.exclude_platforms),
  watchman: [].concat(cfg.watchman || []).filter(Boolean),
  group_by: GROUP_MODES.includes(cfg.group_by) ? cfg.group_by : HEALTH_DEFAULTS.group_by,
  group_min: Math.max(2, Math.floor(Number(cfg.group_min ?? HEALTH_DEFAULTS.group_min)) || HEALTH_DEFAULTS.group_min),
});

// Every battery sensor, lowest first, each flagged low or not.
function batteryRows(hass, opts) {
  const skip = new Set(opts.exclude_platforms);
  const list = [];
  for (const id in hass.states) {
    if (!id.startsWith("sensor.")) continue;
    const st = hass.states[id];
    if (st.attributes.device_class !== "battery") continue;
    const reg = hass.entities?.[id];
    if (reg && (reg.hidden || reg.hidden_by || reg.disabled_by || skip.has(reg.platform))) continue;
    const v = parseFloat(st.state);
    if (!Number.isFinite(v)) continue;
    list.push({ id, name: st.attributes.friendly_name || id, value: v, low: v < opts.battery_threshold });
  }
  list.sort((a, b) => a.value - b.value);
  return list.map((b, i) => ({
    key: b.id, entity: b.id, name: b.name, value: `${Math.round(b.value)}%`, num: b.value,
    icon: b.low ? "mdi:battery-alert" : "mdi:battery-medium",
    alert: b.low, dim: !b.low, groupStart: i > 0 && b.low !== list[i - 1].low,
  }));
}

// Integrations whose own name isn't just their id title-cased.
const INTEGRATION_NAMES = { mqtt: "MQTT", zha: "ZHA", zwave_js: "Z-Wave", esphome: "ESPHome", hue: "Hue", tuya: "Tuya", homekit_controller: "HomeKit",
  matter: "Matter", shelly: "Shelly", sonos: "Sonos", tplink: "TP-Link", upnp: "UPnP", unifi: "UniFi", nest: "Nest" };
const integrationName = (platform) => (platform ? INTEGRATION_NAMES[platform] || title(platform.replace(/_/g, " ")) : "");

// What is offline, as a short list of issues. An unavailable entity is an issue by itself
// only when it belongs to no device; otherwise its device is the issue. A device is down
// when every entity it has is unavailable, partial when only some are. And a hub (a
// Zigbee bridge, a coordinator, any device other devices are attached to through
// `via_device_id`) that is down takes its down devices with it: they become one issue.
// All pure: the registry and the states in, a tree of issues out.
function offlineIssues(hass, opts) {
  const skip = new Set(opts.exclude_platforms);
  const registry = hass.devices || {};
  const per = new Map();            // device id -> { all: [entity ids], down: [entity ids], platforms }
  const loose = [];                 // unavailable entities with no (known) device
  const downEntities = [];          // every unavailable entity, for group_by: none
  for (const id in hass.states) {
    const reg = hass.entities?.[id];
    if (reg && (reg.hidden || reg.hidden_by || reg.disabled_by || skip.has(reg.platform))) continue;
    const down = hass.states[id].state === "unavailable";
    if (down) downEntities.push(id);
    const dev = reg?.device_id && registry[reg.device_id] ? reg.device_id : null;
    if (!dev) { if (down) loose.push(id); continue; }
    let rec = per.get(dev);
    if (!rec) per.set(dev, rec = { all: [], down: [], platforms: {} });
    rec.all.push(id);
    if (down) rec.down.push(id);
    if (reg.platform) rec.platforms[reg.platform] = (rec.platforms[reg.platform] || 0) + 1;
  }

  const nameOf = (id) => hass.states[id]?.attributes.friendly_name || title(id.split(".")[1] || id);
  const sinceOf = (ids) => {
    return earliest(ids.map((id) => Date.parse(hass.states[id]?.last_changed)));
  };
  const earliest = (times) => { const t = times.filter(Number.isFinite); return t.length ? Math.min(...t) : NaN; };
  const entityIssue = (id, parent = "") => ({ kind: "entity", key: `${parent}e:${id}`, id, entity: id, name: nameOf(id), since: sinceOf([id]) });
  const sorted = (list) => list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  const deviceName = (id) => registry[id]?.name_by_user || registry[id]?.name || id;
  const areaOf = (id) => { const a = registry[id]?.area_id; return a ? hass.areas?.[a]?.name || title(a.replace(/_/g, " ")) : ""; };
  const platformOf = (rec) => Object.entries(rec?.platforms || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || "";

  const isDown = (id) => { const r = per.get(id); return !!r && r.all.length > 0 && r.down.length === r.all.length; };
  const deviceIssue = (id, parent = "") => {
    const r = per.get(id), d = registry[id];
    return { kind: "device", key: `${parent}d:${id}`, id, name: deviceName(id), state: isDown(id) ? "down" : "partial",
      total: r.all.length, down: r.down.length, since: sinceOf(r.down), area: areaOf(id), integration: integrationName(platformOf(r)),
      manufacturer: d?.manufacturer || "", model: d?.model || "",
      entities: sorted(r.down.map((e) => entityIssue(e, `${parent}d:${id}/`))) };
  };

  let issues = [];
  if (opts.group_by === "none") {
    issues = downEntities.map((id) => entityIssue(id));
  } else {
    const kids = new Map();         // hub id -> the devices (with entities) attached to it
    for (const id of per.keys()) {
      const via = registry[id]?.via_device_id;
      if (via && via !== id) (kids.get(via) || kids.set(via, []).get(via)).push(id);
    }
    const allKidsDown = (hub) => { const k = kids.get(hub) || []; return k.length > 0 && k.every(isDown); };
    // down by itself, or with no entities of its own and everything behind it down
    const hubDown = (hub) => (per.get(hub)?.all.length ? isDown(hub) : allKidsDown(hub));
    // or up, with at least group_min devices behind it and every one of them down
    const rolls = (hub) => hubDown(hub) || ((kids.get(hub)?.length || 0) >= opts.group_min && allKidsDown(hub));
    const rootOf = (id) => {
      let root = id;
      const seen = new Set([id]);
      for (;;) {
        const up = registry[root]?.via_device_id;
        if (!up || seen.has(up) || !registry[up] || !rolls(up)) return root;
        seen.add(up);
        root = up;
      }
    };
    const downIds = [...per.keys()].filter(isDown);
    const behind = new Map();       // root -> the down devices that end up under it
    if (opts.group_by === "hub") {
      for (const id of downIds) {
        const root = rootOf(id);
        if (root !== id) (behind.get(root) || behind.set(root, []).get(root)).push(id);
      }
    }
    const consumed = new Set();
    for (const [root, list] of behind) {
      if (list.length < opts.group_min) continue;
      list.forEach((id) => consumed.add(id));
      consumed.add(root);
      const own = per.get(root);
      const devices = sorted(list.map((id) => deviceIssue(id, `h:${root}/`)));
      issues.push({ kind: "hub", key: `h:${root}`, id: root, name: deviceName(root), state: hubDown(root) ? "offline" : "behind",
        total: devices.length, devices, area: areaOf(root), integration: integrationName(platformOf(own)),
        entities: sorted((own?.down || []).map((e) => entityIssue(e, `h:${root}/`))),
        since: earliest([...devices.map((d) => d.since), ...(own?.down.length ? [sinceOf(own.down)] : [])]) });
    }
    for (const [id, r] of per) if (r.down.length && !consumed.has(id)) issues.push(deviceIssue(id));
    issues.push(...loose.map((id) => entityIssue(id)));
  }
  // the biggest trouble first: hubs, then devices (down before partial), then loose entities
  const rank = (i) => (i.kind === "hub" ? 0 : i.kind === "device" ? (i.state === "down" ? 1 : 2) : 3);
  issues.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  let tracked = 0, down = 0;
  for (const id of per.keys()) { tracked++; if (isDown(id)) down++; }
  return { issues, devices: { total: tracked, down } };
}

// Watchman's sensors: their state is the count, their `entities` / `services` attribute
// lists what's missing and in which file.
function watchmanRows(hass, opts) {
  let total = 0;
  const rows = [];
  for (const id of opts.watchman) {
    const st = hass.states[id];
    if (!st) continue;
    total += parseInt(st.state, 10) || 0;
    for (const item of st.attributes.entities || st.attributes.services || []) {
      const occ = item.occurrences || "";
      rows.push({
        key: `${id}:${item.id}:${rows.length}`, entity: item.id, name: item.id,
        secondary: occ ? occ.split("/").pop().split(":")[0] : "", tooltip: occ,
        icon: item.state ? (WATCHMAN_ICON[item.state] || "mdi:cloud-question") : "mdi:cloud-alert", alert: true,
      });
    }
  }
  return { total, rows };
}

// Everything at once. `total` is what the home card's cog shows: the offline issues
// (a hub, a device or a loose entity is one each), the low batteries and Watchman's count.
function healthSummary(hass, cfg) {
  const opts = healthOptions(cfg);
  const battery = batteryRows(hass, opts);
  const offline = offlineIssues(hass, opts);
  const watchman = watchmanRows(hass, opts);
  const low = battery.filter((b) => b.alert).length;
  return {
    opts, battery, offline: offline.issues, watchman: watchman.rows,
    counts: { battery: low, unavailable: offline.issues.length, watchman: watchman.total },
    stats: { devices: offline.devices, batteries: { count: battery.length, lowest: battery.length ? battery[0].num : null } },
    total: low + offline.issues.length + watchman.total,
  };
}

// When Watchman last checked the configuration: its "last parse" timestamp sensor, found
// through the registry (an entity of the watchman integration with a timestamp state,
// preferring the one named for the parse), or the one config names, or none (false).
function watchmanLastRun(hass, cfg = {}) {
  if (cfg.watchman_last_run === false) return null;
  if (typeof cfg.watchman_last_run === "string") return hass.states[cfg.watchman_last_run] ? cfg.watchman_last_run : null;
  if (!hass.entities) return null;
  const found = Object.values(hass.entities)
    .filter((e) => e.platform === "watchman" && hass.states[e.entity_id]?.attributes.device_class === "timestamp")
    .map((e) => e.entity_id);
  const named = (re) => found.find((id) => re.test(hass.entities[id].translation_key || "") || re.test(hass.states[id].attributes.friendly_name || ""));
  return named(/parse/i) || named(/updat/i) || found[0] || null;
}
