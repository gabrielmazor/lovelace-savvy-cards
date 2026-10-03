// ---------------------------------------------------------------------------------------
// core/aggregate: one item per room for the sensors of a kind. With `aggregate` on, every
// presence (motion, occupancy) sensor an area has is hidden from discovery and replaced by one
// stand-in: occupied if any of them is, since the first of those that are on came on (or, when
// all are clear, the last change). A card that discovers by area then shows the room once. What
// the user pins or names (`entities`, an explicit sensor) is never merged, and neither is what
// the ignore lists leave out.
//
//   aggregate: true                      presence only
//   aggregate: [presence, door, window]  those kinds
//   kinds: presence, door, window, leak, smoke, gas
// ---------------------------------------------------------------------------------------

const AGG_KINDS = {
  presence: { dc: ["occupancy", "motion", "presence"], as: "occupancy", label: "presence" },
  door: { dc: ["door", "garage_door", "opening"], as: "door", label: "doors" },
  window: { dc: ["window"], as: "window", label: "windows" },
  leak: { dc: ["moisture"], as: "moisture", label: "leak" },
  smoke: { dc: ["smoke"], as: "smoke", label: "smoke" },
  gas: { dc: ["gas", "carbon_monoxide"], as: "gas", label: "gas" },
};
const AGG_TARGET = new Map();      // a stand-in's id -> the member a tap should open
const AGG_PREFIX = "binary_sensor.savvy_agg_";
const aggKinds = (v) => (v === true ? ["presence"] : [].concat(v || []).filter((k) => AGG_KINDS[k]));

const aggEntries = new WeakMap();  // hass.entities -> { sig, entities }: the derived registry keeps its identity while nothing changes

function aggregateHass(hass, { kinds, exclude = [], excludeAreas = [] } = {}) {
  const ks = aggKinds(kinds);
  if (!ks.length || !hass?.entities || !hass.states) return hass;
  const skip = new Set(exclude), skipAreas = new Set(excludeAreas);
  const groups = new Map();       // `${area}|${kind}` -> member ids
  for (const id in hass.entities) {
    if (!id.startsWith("binary_sensor.") || skip.has(id)) continue;
    const e = hass.entities[id];
    const st = hass.states[id];
    if (!st || !discoverable(e)) continue;
    const area = e.area_id || hass.devices?.[e.device_id]?.area_id;
    if (!area || skipAreas.has(area)) continue;
    const dc = st.attributes.device_class;
    for (const k of ks) if (AGG_KINDS[k].dc.includes(dc)) { const g = `${area}|${k}`; (groups.get(g) || groups.set(g, []).get(g)).push(id); break; }
  }
  const merged = [...groups].filter(([, ids]) => ids.length >= 2).map(([g, ids]) => ({ area: g.split("|")[0], kind: g.split("|")[1], ids: ids.sort() }));
  if (!merged.length) return hass;
  const sig = merged.map((m) => `${m.area}|${m.kind}|${m.ids.join(",")}`).sort().join(";");
  const states = { ...hass.states };
  let cached = aggEntries.get(hass.entities);
  const build = !cached || cached.sig !== sig;
  const entities = build ? { ...hass.entities } : cached.entities;
  for (const m of merged) {
    const id = `${AGG_PREFIX}${m.kind}_${m.area}`;
    const k = AGG_KINDS[m.kind];
    const members = m.ids.map((i) => hass.states[i]);
    const on = m.ids.filter((i) => hass.states[i].state === "on");
    const time = (s) => Date.parse(s.last_changed);
    const times = (on.length ? on.map((i) => hass.states[i]) : members).map(time).filter(Number.isFinite);
    const at = times.length ? (on.length ? Math.min(...times) : Math.max(...times)) : Date.now();
    const dead = members.every((s) => s.state === "unavailable" || s.state === "unknown");
    states[id] = { entity_id: id, state: on.length ? "on" : dead ? "unavailable" : "off",
      last_changed: new Date(at).toISOString(), last_updated: new Date(at).toISOString(),
      attributes: { friendly_name: `${areaInfo(hass, m.area).name} ${title(k.label)}`, device_class: k.as, savvy_members: m.ids, savvy_area: m.area } };
    AGG_TARGET.set(id, on[0] || m.ids[0]);
    if (build) {
      entities[id] = { entity_id: id, area_id: m.area, device_id: null, platform: "savvy", entity_category: null, hidden: false, hidden_by: null, disabled_by: null };
      for (const i of m.ids) entities[i] = { ...hass.entities[i], hidden_by: "savvy" };
    }
  }
  if (build) aggEntries.set(hass.entities, { sig, entities });
  return { ...hass, states, entities };
}
