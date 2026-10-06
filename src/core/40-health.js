// ---------------------------------------------------------------------------------------
// core/health: what needs attention. savvy-system-health-card lists these, and savvy-home-header-card's
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
//                       none: one issue per entity. device: one per device (offline when half
//                       or more of its entities are unavailable, partial when fewer are). hub:
//                       a hub whose devices are offline (a Zigbee bridge, a coordinator) is one
//                       issue, and so is an integration that failed or whose devices are mostly
//                       offline. integration > hub > device > entity, nothing counted twice.
//   group_min           how many devices a hub or an integration needs to roll up (default 3)
//   ignore              known problems: { entities: [...], devices: [device ids] } (or one list of both).
//                       They leave every count and list, and wait under "Known"
//   dismiss             false hides the dismiss buttons (what was dismissed stays dismissed: core/dismiss)
//
// A Watchman item whose entity belongs to a device that is already an issue (or is ignored) is not a
// second problem: it is folded into that device's row and counts once. Only what nothing else explains
// stays Watchman's own.
// ---------------------------------------------------------------------------------------

const HEALTH_DEFAULTS = { battery_threshold: 20, exclude_platforms: ["mobile_app"], watchman: [], group_by: "hub", group_min: 3 };
const GROUP_MODES = ["hub", "device", "none"];
const WATCHMAN_ICON = { missing: "mdi:cloud-alert", unavail: "mdi:cloud-off-outline" };

// `ignore` as { entities, devices }, or as one list: an id with a dot is an entity, the rest are devices
function ignoreSets(raw) {
  const list = Array.isArray(raw) ? raw : null;
  const ents = list ? list.filter((x) => String(x).includes(".")) : [].concat(raw?.entities || []);
  const devs = list ? list.filter((x) => !String(x).includes(".")) : [].concat(raw?.devices || []);
  return { entities: new Set(ents.filter(Boolean)), devices: new Set(devs.filter(Boolean)) };
}
const isIgnored = (hass, opts, id) => opts.ignore.entities.has(id) || opts.ignore.devices.has(hass.entities?.[id]?.device_id);

const healthOptions = (cfg = {}) => ({
  ignore: ignoreSets(cfg.ignore),
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
    if (isIgnored(hass, opts, id)) continue;
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

// What Home Assistant says about each integration's config entry (setup failed, retrying...).
// config_entries/get is asynchronous and, on most cores, admin-only: the answer is kept for a
// minute, a refusal is not asked again for ten, and without it the integration rows are inferred
// from the devices alone.
const CONFIG_ENTRY_FAILED = { setup_error: "failed to set up", setup_retry: "retrying setup", failed_unload: "failed to unload", migration_error: "migration failed" };
const entryStore = { map: new Map(), next: 0, pending: false, listeners: new Set(), fast: false };
function refreshConfigEntries(hass, force = false) {
  if (!hass?.callWS || entryStore.pending || (!force && Date.now() < entryStore.next)) return;
  entryStore.pending = true;
  Promise.resolve().then(() => hass.callWS({ type: "config_entries/get" })).then((list) => {
    const map = new Map();
    for (const e of Array.isArray(list) ? list : []) map.set(e.entry_id, { domain: e.domain, title: e.title, state: e.state, disabled: !!e.disabled_by });
    const changed = JSON.stringify([...map]) !== JSON.stringify([...entryStore.map]);
    entryStore.map = map;
    entryStore.next = Date.now() + (entryStore.fast ? 4000 : 60000);   // asked often while something is still starting
    if (changed) entryStore.listeners.forEach((fn) => fn());
  }).catch(() => { entryStore.next = Date.now() + (entryStore.fast ? 4000 : 600000); }).finally(() => { entryStore.pending = false; });
}
// Is Home Assistant, or one of its integrations, still coming up? Real signals, not a timer: the connection
// itself, the core's own state (the one behind the "Home Assistant is starting" notice), and any integration
// whose setup is still in progress. Null when everything is up, or `startup_wait: false`.
function startupInfo(hass, cfg = {}) {
  entryStore.fast = false;
  if (!hass || cfg.startup_wait === false) return null;
  let info = null;
  if (hass.connected === false) info = { phase: "connecting", text: "Reconnecting to Home Assistant…", detail: "The connection dropped. Offline devices are not counted until it is back." };
  else if (hass.config?.state && hass.config.state !== "RUNNING") info = { phase: "starting", text: "Home Assistant is starting…", detail: "Not everything is available yet. Offline devices are not counted while it starts." };
  else {
    const loading = [...new Set([...entryStore.map.values()].filter((e) => e.state === "setup_in_progress" && !e.disabled).map((e) => integrationName(e.domain) || e.title))];
    if (loading.length) info = { phase: "integrations", text: "Loading integrations…", detail: `${loading.slice(0, 6).join(", ")}${loading.length > 6 ? ` and ${loading.length - 6} more` : ""}` };
  }
  entryStore.fast = !!info;
  return info;
}
const resetConfigEntries = () => { entryStore.map = new Map(); entryStore.next = 0; entryStore.pending = false; };

// What is offline, as a short list of issues. An unavailable entity is an issue by itself
// only when it belongs to no device; otherwise its device is the issue. A device is offline
// when half or more of its entities are unavailable (when a Zigbee bridge stops, devices keep
// an entity or two that never goes unavailable), partial when fewer are. A hub (a Zigbee
// bridge, a coordinator, any device other devices are attached to through `via_device_id`)
// that is offline, or whose every device is, takes the devices behind it with it: one issue.
// An integration whose config entry failed, or whose devices are mostly offline with no hub
// to blame, is one issue too. All pure: the registry and the states in, a tree of issues out.
function offlineIssues(hass, opts) {
  const skip = new Set(opts.exclude_platforms);
  const registry = hass.devices || {};
  const per = new Map();            // device id -> { all, down: [entity ids], conn: [connectivity entity ids], platforms }
  const loose = [];                 // unavailable entities with no (known) device
  const downEntities = [];          // every unavailable entity, for group_by: none
  const knownDev = new Map(), knownLoose = [];   // what the user has snoozed, and is down
  for (const id in hass.states) {
    const reg = hass.entities?.[id];
    if (reg && (reg.hidden || reg.hidden_by || reg.disabled_by || skip.has(reg.platform))) continue;
    const st = hass.states[id];
    const down = st.state === "unavailable";
    if (isIgnored(hass, opts, id)) {
      // a snoozed device waits as the device; a snoozed entity of a device that isn't, as the entity
      if (down) { const d = reg?.device_id && opts.ignore.devices.has(reg.device_id) && registry[reg.device_id] ? reg.device_id : null; if (d) (knownDev.get(d) || knownDev.set(d, []).get(d)).push(id); else knownLoose.push(id); }
      continue;
    }
    if (down) downEntities.push(id);
    const dev = reg?.device_id && registry[reg.device_id] ? reg.device_id : null;
    if (!dev) { if (down) loose.push(id); continue; }
    let rec = per.get(dev);
    if (!rec) per.set(dev, rec = { all: [], down: [], conn: [], platforms: {} });
    rec.all.push(id);
    if (down) rec.down.push(id);
    if (st.attributes.device_class === "connectivity" && id.startsWith("binary_sensor.")) rec.conn.push(id);
    if (reg.platform) rec.platforms[reg.platform] = (rec.platforms[reg.platform] || 0) + 1;
  }

  const nameOf = (id) => hass.states[id]?.attributes.friendly_name || title(id.split(".")[1] || id);
  const earliest = (times) => { const t = times.filter(Number.isFinite); return t.length ? Math.min(...t) : NaN; };
  const sinceOf = (ids) => earliest(ids.map((id) => Date.parse(hass.states[id]?.last_changed)));
  const entityIssue = (id, parent = "") => ({ kind: "entity", key: `${parent}e:${id}`, id, entity: id, name: nameOf(id), since: sinceOf([id]) });
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  const sorted = (list) => list.sort(byName);
  const deviceName = (id) => registry[id]?.name_by_user || registry[id]?.name || id;
  const areaOf = (id) => { const a = registry[id]?.area_id; return a ? hass.areas?.[a]?.name || title(a.replace(/_/g, " ")) : ""; };
  const known = {
    devices: [...knownDev].map(([id, ids]) => ({ kind: "known", key: `k:d:${id}`, id, name: deviceName(id), since: sinceOf(ids), total: ids.length, area: areaOf(id) })).sort(byName),
    entities: knownLoose.map((id) => ({ kind: "known", key: `k:e:${id}`, id, entity: id, name: nameOf(id), since: sinceOf([id]) })).sort(byName),
    refs: 0,
  };
  const platformOf = (rec) => Object.entries(rec?.platforms || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || "";

  const offline = (id) => { const r = per.get(id); return !!r && r.all.length > 0 && r.down.length * 2 >= r.all.length; };
  const anyDown = (id) => (per.get(id)?.down.length || 0) > 0;
  const connOff = (id) => (per.get(id)?.conn || []).some((e) => hass.states[e].state === "off");
  const deviceIssue = (id, parent = "") => {
    const r = per.get(id), d = registry[id];
    return { kind: "device", key: `${parent}d:${id}`, id, name: deviceName(id), state: offline(id) ? "down" : "partial",
      total: r.all.length, down: r.down.length, since: sinceOf(r.down), area: areaOf(id), integration: integrationName(platformOf(r)),
      manufacturer: d?.manufacturer || "", model: d?.model || "",
      entities: sorted(r.down.map((e) => entityIssue(e, `${parent}d:${id}/`))) };
  };

  let issues = [];
  if (opts.group_by === "none") {
    issues = downEntities.map((id) => entityIssue(id));
  } else {
    const consumed = new Set();
    const hubs = [];
    if (opts.group_by === "hub") {
      const kids = new Map();       // hub id -> the devices (with entities) attached to it
      for (const id of per.keys()) {
        const via = registry[id]?.via_device_id;
        if (via && via !== id) (kids.get(via) || kids.set(via, []).get(via)).push(id);
      }
      // offline by itself (or its connectivity entity says off); or no entities of its own and
      // half of what's behind it is offline
      const hubOffline = (hub) => {
        const k = kids.get(hub) || [], own = per.get(hub);
        if (own?.all.length) return own.down.length * 2 >= own.all.length || connOff(hub);
        return k.length > 0 && k.filter(offline).length * 2 >= k.length;
      };
      // or up, with at least group_min devices behind it and every one of them offline
      const rolls = (hub) => hubOffline(hub) || ((kids.get(hub)?.length || 0) >= opts.group_min && kids.get(hub).every(offline));
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
      const behind = new Map();     // root -> the devices with anything unavailable that end up under it
      for (const id of per.keys()) {
        if (!anyDown(id)) continue;
        const root = rootOf(id);
        if (root !== id) (behind.get(root) || behind.set(root, []).get(root)).push(id);
      }
      for (const [root, list] of behind) {
        if (list.length < opts.group_min) continue;
        list.forEach((id) => consumed.add(id));
        consumed.add(root);
        const own = per.get(root);
        const devices = sorted(list.map((id) => deviceIssue(id, `h:${root}/`)));
        const ownIds = [...(own?.down || []), ...(own?.conn || []).filter((e) => hass.states[e].state === "off" && !own.down.includes(e))];
        hubs.push({ kind: "hub", key: `h:${root}`, id: root, name: deviceName(root), state: hubOffline(root) ? "offline" : "behind",
          total: devices.length, devices, area: areaOf(root), integration: integrationName(platformOf(own)),
          entities: sorted(ownIds.map((e) => entityIssue(e, `h:${root}/`))),
          since: earliest([...devices.map((d) => d.since), ...(own?.down.length ? [sinceOf(own.down)] : [])]) });
      }
      issues.push(...hubs);

      // integrations: a config entry that failed, or most of whose devices (the ones no hub
      // explains) are offline
      const entryOf = (id) => registry[id]?.primary_config_entry || registry[id]?.config_entries?.[0] || null;
      const groups = new Map();     // key -> { entry, platform, devices: tracked, members }
      for (const id of per.keys()) {
        if (consumed.has(id)) continue;
        const entry = entryOf(id), platform = platformOf(per.get(id));
        const key = entry ? `e:${entry}` : platform ? `p:${platform}` : null;
        if (!key) continue;
        let g = groups.get(key);
        if (!g) groups.set(key, g = { key, entry, platform, devices: [] });
        g.devices.push(id);
      }
      const entryName = (g, info) => integrationName(info?.domain || g.platform) || info?.title || "Integration";
      const made = [];
      const failedEntries = new Map([...entryStore.map].filter(([, e]) => CONFIG_ENTRY_FAILED[e.state] && !e.disabled && !skip.has(e.domain)));
      const seenKeys = new Set();
      for (const g of groups.values()) {
        const info = g.entry ? entryStore.map.get(g.entry) : null;
        const failed = g.entry && failedEntries.has(g.entry) ? info.state : null;
        const off = g.devices.filter(offline);
        const rolled = failed || (off.length >= opts.group_min && off.length * 2 >= g.devices.length);
        if (!rolled) continue;
        seenKeys.add(g.entry);
        const members = g.devices.filter(anyDown);
        made.push({ g, info, failed, members });
      }
      for (const [entry, info] of failedEntries) {      // failed, with no device of it in sight
        if (seenKeys.has(entry)) continue;
        made.push({ g: { key: `e:${entry}`, entry, platform: info.domain, devices: [] }, info, failed: info.state, members: [] });
      }
      for (const { g, info, failed, members } of made) {
        members.forEach((id) => consumed.add(id));
        const devices = sorted(members.map((id) => deviceIssue(id, `i:${g.key}/`)));
        // a hub of the same failed integration belongs inside it, not beside it
        const inside = failed ? hubs.filter((h) => entryOf(h.id) === g.entry) : [];
        for (const h of inside) { issues.splice(issues.indexOf(h), 1); devices.push(h); }
        issues.push({ kind: "integration", key: `i:${g.key}`, id: g.key, domain: info?.domain || g.platform, name: entryName(g, info), state: failed ? "failed" : "offline",
          label: failed ? CONFIG_ENTRY_FAILED[failed] : "", total: devices.length, devices, entities: [],
          since: earliest(devices.map((d) => d.since)) });
      }
      const names = new Map();
      for (const i of issues) if (i.kind === "integration") names.set(i.name, (names.get(i.name) || 0) + 1);
      for (const i of issues) {
        if (i.kind !== "integration" || names.get(i.name) < 2) continue;
        const title = entryStore.map.get(i.id.slice(2))?.title;
        if (title) i.name = `${i.name} (${title})`;
      }
    }
    for (const [id, r] of per) if (r.down.length && !consumed.has(id)) issues.push(deviceIssue(id));
    issues.push(...loose.map((id) => entityIssue(id)));
  }
  // the biggest trouble first: integrations, hubs, devices (offline before partial), loose entities
  const rank = (i) => (i.kind === "integration" ? 0 : i.kind === "hub" ? 1 : i.kind === "device" ? (i.state === "down" ? 2 : 3) : 4);
  issues.sort((a, b) => rank(a) - rank(b) || byName(a, b));
  let tracked = 0, down = 0;
  for (const id of per.keys()) { tracked++; if (offline(id)) down++; }
  return { issues, devices: { total: tracked, down }, known };
}

// Watchman's sensors: their state is the count, their `entities` / `services` attribute
// lists what's missing and in which file.
function watchmanRows(hass, opts) {
  let total = 0;
  const rows = [], kinds = { entities: 0, actions: 0 };
  for (const id of opts.watchman) {
    const st = hass.states[id];
    if (!st) continue;
    const n = parseInt(st.state, 10) || 0;
    total += n;
    // the missing-actions sensor lists `services`; the missing-entities one lists `entities`
    const actions = st.attributes.entities === undefined && st.attributes.services !== undefined ? true : st.attributes.entities !== undefined ? false : /action|service/i.test(id);
    kinds[actions ? "actions" : "entities"] += n;
    for (const item of st.attributes.entities || st.attributes.services || []) {
      const occ = item.occurrences || "";
      rows.push({
        key: `${id}:${item.id}:${rows.length}`, entity: item.id, name: item.id,
        secondary: occ ? occ.split("/").pop().split(":")[0] : "", tooltip: occ,
        icon: item.state ? (WATCHMAN_ICON[item.state] || "mdi:cloud-question") : "mdi:cloud-alert", alert: true, actions,
      });
    }
  }
  return { total, rows, kinds };
}

// Which Watchman items an offline issue already explains (the entity's device is in the tree, or is
// snoozed). Those are counted on the issue, as "N dashboard references broken", and leave Watchman's list.
function explainWatchman(hass, opts, issues, known, rows) {
  const dev = new Map(), ent = new Map();
  const visit = (node, parents) => {
    const here = [...parents, node];
    if (node.kind === "device" || node.kind === "hub") dev.set(node.id, here);
    if (node.kind === "entity") ent.set(node.entity, here);
    for (const e of node.entities || []) visit(e, here);
    for (const d of node.devices || []) visit(d, here);
  };
  issues.forEach((i) => visit(i, []));
  const keep = [], gone = [];
  for (const r of rows) {
    const d = hass.entities?.[r.entity]?.device_id;
    // a snoozed problem takes its Watchman items with it; otherwise the device (or entity) that is down explains them
    const hit = isIgnored(hass, opts, r.entity) ? null : (d && dev.get(d)) || ent.get(r.entity) || null;
    if (hit) { for (const n of hit) n.refs = (n.refs || 0) + 1; r.explainedBy = hit[0].key; }
    else if (isIgnored(hass, opts, r.entity)) { r.explainedBy = "known"; known.refs++; }
    (r.explainedBy ? gone : keep).push(r);
  }
  return { keep, gone };
}

// still failing? (for pruning what a person dismissed): an unavailable entity, a connectivity sensor that
// reads off, or an issue that is still in the list. A member that is gone from Home Assistant is fine.
const stillDown = (hass, id, keys) => {
  if (id.startsWith("issue:")) return keys.has(id.slice(6));
  const st = hass.states[id];
  return !!st && (st.state === "unavailable" || (st.attributes.device_class === "connectivity" && st.state === "off"));
};
// the failing entities an issue is made of (an integration that failed with no device of it in sight stands for itself)
const issueMembers = (is) => {
  const out = [];
  const walk = (n) => { if (n.kind === "entity") out.push(n.entity); (n.entities || []).forEach(walk); (n.devices || []).forEach(walk); };
  walk(is);
  return out.length ? [...new Set(out)] : [`issue:${is.key}`];
};

// Everything at once. `total` is what the home card's cog shows: the offline issues
// (a hub, a device or a loose entity is one each), the low batteries and Watchman's count,
// less what this person has dismissed (core/dismiss), which is listed under `dismissed`.
function healthSummary(hass, cfg) {
  const opts = healthOptions(cfg);
  const battery = batteryRows(hass, opts);
  const offline = offlineIssues(hass, opts);
  const watchman = watchmanRows(hass, opts);
  const { keep, gone } = explainWatchman(hass, opts, offline.issues, offline.known, watchman.rows);

  // what has recovered since it was dismissed is forgotten, so it returns if it breaks again
  const keys = new Set(offline.issues.map((i) => i.key));
  if (dismissStore.entries.size && Object.keys(hass.states || {}).length) {
    const lowNow = new Map(battery.map((b) => [b.entity, b.alert]));
    const watchOk = opts.watchman.length > 0 && opts.watchman.every((id) => hass.states[id]);
    const listed = new Set(watchman.rows.map((r) => r.entity));
    dismissPrune(hass, (kind, m) => {
      if (kind === "off") return stillDown(hass, m, keys);
      if (kind === "bat") return lowNow.has(m) ? lowNow.get(m) : !!hass.states[m] && hass.states[m].state === "unavailable";
      return watchOk ? listed.has(m) : true;
    });
  }
  const dv = dismissView();
  const covered = (set, members) => set.size > 0 && members.length > 0 && members.every((m) => set.has(m));
  for (const is of offline.issues) { is.members = issueMembers(is); is.dismissId = `off:${is.key}`; }
  for (const b of battery) { b.members = [b.entity]; b.dismissId = `bat:${b.entity}`; }
  for (const r of watchman.rows) { r.members = [r.entity]; r.dismissId = `wat:${r.entity}`; }

  const offLive = offline.issues.filter((i) => !covered(dv.off, i.members));
  const offAside = offline.issues.filter((i) => covered(dv.off, i.members));
  const batLive = battery.filter((b) => !(b.alert && dv.bat.has(b.entity)));
  const batAside = battery.filter((b) => b.alert && dv.bat.has(b.entity));
  const watLive = keep.filter((r) => !dv.wat.has(r.entity));
  const watAside = keep.filter((r) => dv.wat.has(r.entity));

  const low = batLive.filter((b) => b.alert).length;
  // what is left of Watchman's count once the items the offline issues explain, and the dismissed ones, are taken out
  const left = Math.max(0, watchman.total - gone.length - watAside.length);
  const kinds = { entities: Math.max(0, watchman.kinds.entities - gone.length - watAside.filter((r) => !r.actions).length),
    actions: Math.max(0, watchman.kinds.actions - watAside.filter((r) => r.actions).length) };
  const dismissedCount = offAside.length + batAside.length + watAside.length;
  return {
    opts, battery: batLive, offline: offLive, watchman: watLive, watchmanExplained: gone, known: offline.known,
    dismissed: { offline: offAside, battery: batAside, watchman: watAside, count: dismissedCount },
    counts: { battery: low, unavailable: offLive.length, watchman: left, watchmanAll: watchman.total, watchmanExplained: gone.length, watchmanKinds: kinds, watchmanAllKinds: watchman.kinds,
      known: offline.known.devices.length + offline.known.entities.length, dismissed: dismissedCount,
      dismissedBy: { unavailable: offAside.length, battery: batAside.length, watchman: watAside.length } },
    stats: { devices: offline.devices, batteries: { count: battery.length, lowest: battery.length ? battery[0].num : null } },
    total: low + offLive.length + left,
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
