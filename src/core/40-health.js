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
// ---------------------------------------------------------------------------------------

const HEALTH_DEFAULTS = { battery_threshold: 20, exclude_platforms: ["mobile_app"], watchman: [] };
const WATCHMAN_ICON = { missing: "mdi:cloud-alert", unavail: "mdi:cloud-off-outline" };

const healthOptions = (cfg = {}) => ({
  battery_threshold: Number(cfg.battery_threshold ?? HEALTH_DEFAULTS.battery_threshold),
  exclude_platforms: [].concat(cfg.exclude_platforms ?? HEALTH_DEFAULTS.exclude_platforms),
  watchman: [].concat(cfg.watchman || []).filter(Boolean),
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
    key: b.id, entity: b.id, name: b.name, value: `${Math.round(b.value)}%`,
    icon: b.low ? "mdi:battery-alert" : "mdi:battery-medium",
    alert: b.low, dim: !b.low, groupStart: i > 0 && b.low !== list[i - 1].low,
  }));
}

function unavailableRows(hass, opts) {
  const skip = new Set(opts.exclude_platforms);
  const rows = [];
  for (const id in hass.states) {
    const st = hass.states[id];
    if (st.state !== "unavailable") continue;
    const reg = hass.entities?.[id];
    if (reg && (reg.hidden || reg.hidden_by || skip.has(reg.platform))) continue;
    rows.push({
      key: id, entity: id, name: st.attributes.friendly_name || title(id.split(".")[1] || id),
      secondary: id, icon: "mdi:alert-circle-outline", alert: true,
    });
  }
  return rows;
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

// Everything at once. `total` is what the home card's cog shows.
function healthSummary(hass, cfg) {
  const opts = healthOptions(cfg);
  const battery = batteryRows(hass, opts);
  const unavailable = unavailableRows(hass, opts);
  const watchman = watchmanRows(hass, opts);
  const low = battery.filter((b) => b.alert).length;
  return {
    opts, battery, unavailable, watchman: watchman.rows,
    counts: { battery: low, unavailable: unavailable.length, watchman: watchman.total },
    total: low + unavailable.length + watchman.total,
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
