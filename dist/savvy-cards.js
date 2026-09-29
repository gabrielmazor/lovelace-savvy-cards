/*! Savvy Cards v0.0.1 | MIT License | built from src/ by build.mjs, do not edit */
(() => {
"use strict";
const SAVVY_VERSION = "0.0.1";

// ===== core/00-base.js =====
// ---------------------------------------------------------------------------------------
// core/base: springs, the shared animation clock, write-through DOM helpers, and the
// small utilities every card uses. Everything in src/core is joined into one scope by
// build.mjs; each card gets its own inner scope on top of it.
// ---------------------------------------------------------------------------------------

const TAU = Math.PI * 2;
const STEP = 1 / 240;        // fixed physics substep: identical motion at 60Hz and 120Hz
const SLOP = 10;             // px of travel before a press becomes a drag or a scroll
const HOLD_MS = 500;
const DOUBLE_MS = 250;
const DECEL = 0.998;         // scroll-style deceleration for momentum projection

// The tuning table (CARD-DESIGN.md 2.2): damping 1 = no overshoot, response in seconds.
const MOTION = {
  press:    { response: 0.12, damping: 1 },
  release:  { response: 0.3,  damping: 0.82 },
  pop:      { response: 0.34, damping: 0.58 },
  hold:     { response: 0.5,  damping: 1 },
  page:     { response: 0.42, damping: 0.86 },
  pill:     { response: 0.34, damping: 0.82 },
  ui:       { response: 0.4,  damping: 1 },
  text:     { response: 0.5,  damping: 1 },
  value:    { response: 0.34, damping: 1 },
  tint:     { response: 0.6,  damping: 1 },
  sheetIn:  { response: 0.38, damping: 0.82 },
  sheetOut: { response: 0.24, damping: 1 },
  graph:    { response: 0.7,  damping: 1 },
  scrub:    { response: 0.1,  damping: 1 },
  spin:     { response: 1.6,  damping: 1 },
  bloom:    { response: 1.3,  damping: 1 },
};

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
// progressive resistance past a boundary: real things slow before they stop
const rubber = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));
const project = (v) => (v / 1000) * DECEL / (1 - DECEL);

// Fold case, underscores, dashes and extra spaces so config and options can be written
// freely: "Movie Time", "movie_time" and "movie time" are the same key.
const norm = (v) => String(v ?? "").toLowerCase().replace(/[\s_-]+/g, " ").trim();
const keyed = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [norm(k), v]));
const title = (v) => String(v ?? "").replace(/[_-]+/g, " ").replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const slug = (v) => String(v).replace(/[^a-z0-9]+/gi, "_");
const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

class Spring {
  constructor(value, motion, group, eps = 1e-3) {
    this.x = this.target = value;
    this.v = 0;
    this.group = group;
    this.eps = eps;
    this.tune(motion);
  }
  tune({ response, damping }) {
    const w = TAU / response;
    this.k = w * w;
    this.c = 2 * damping * w;
    return this;
  }
  to(target, motion) {
    this.target = target;
    if (motion) this.tune(motion);
    return this;
  }
  snap(value = this.target) {
    this.x = this.target = value;
    this.v = 0;
    return this;
  }
  kick(dv, keep = 1) {
    this.v = this.v * keep + dv;
    return this;
  }
  step(dt) {
    for (let t = dt; t > 1e-6; t -= STEP) {
      const h = Math.min(t, STEP);
      this.v += (-this.k * (this.x - this.target) - this.c * this.v) * h;
      this.x += this.v * h;
    }
    if (this.idle) this.snap();
  }
  get idle() {
    return Math.abs(this.x - this.target) < this.eps && Math.abs(this.v) < this.eps * 8;
  }
}

// A critically damped spring kicked from rest rises and fades by itself
// (CARD-DESIGN.md 2.3): solve for the kick that peaks where we want.
const bloom = (spring, peak, motion = MOTION.bloom) => {
  spring.to(0, motion);
  const w = TAU / motion.response;
  spring.kick(peak * w * Math.E * (1 - clamp(spring.x / peak)), 0.3);
};

// One requestAnimationFrame loop for every card on the page. A job returns false to
// unsubscribe; the loop stops entirely when nothing is left.
const Clock = {
  jobs: new Set(),
  raf: 0,
  last: 0,
  add(job) {
    this.jobs.add(job);
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(clockTick);
    }
  },
  remove(job) { this.jobs.delete(job); },
};
function clockTick(now) {
  const dt = clamp((now - Clock.last) / 1000, 0, 0.05);   // a stalled tab resumes calmly
  Clock.last = now;
  for (const job of Clock.jobs) if (!job(now, dt)) Clock.jobs.delete(job);
  Clock.raf = Clock.jobs.size ? requestAnimationFrame(clockTick) : 0;
}

const MQ = {
  reduced: window.matchMedia("(prefers-reduced-motion: reduce)"),
  contrast: window.matchMedia("(prefers-contrast: more)"),
};

// Write-through caches: a DOM write only happens when the value actually changed.
const put = (el, prop, val) => {
  if (!el) return;
  const cache = el.__css || (el.__css = {});
  if (cache[prop] === val) return;
  cache[prop] = val;
  if (prop.startsWith("--")) el.style.setProperty(prop, val);
  else el.style[prop] = val;
};
const attr = (el, name, val) => {
  if (!el) return;
  const cache = el.__attr || (el.__attr = {});
  if (cache[name] === val) return;
  cache[name] = val;
  if (val === null || val === undefined || val === false) el.removeAttribute(name);
  else el.setAttribute(name, val === true ? "" : val);
};
const text = (el, val) => {
  if (!el || el.__text === val) return;
  el.__text = val;
  el.textContent = val;
};

// The companion apps turn this into a real haptic; elsewhere it's a no-op.
const haptic = (type) => window.dispatchEvent(new CustomEvent("haptic", { detail: type }));

const moreInfo = (host, entityId) => {
  if (!entityId) return;
  host.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
};

const navigate = (path, replace = false) => {
  if (!path) return;
  const url = path.startsWith("/") ? path : `${location.pathname.replace(/\/[^/]*$/, "")}/${path}`;
  history[replace ? "replaceState" : "pushState"](null, "", url);
  window.dispatchEvent(new CustomEvent("location-changed", { bubbles: true, composed: true, detail: { replace } }));
};

// Focus rings are for keyboard users only (CARD-DESIGN.md 12): touch browsers treat a
// tapped role="button" as :focus-visible. The flag is mirrored onto each card's host as
// [kbd], and stylesheets draw rings only under :host([kbd]).
let lastInputKeyboard = false;
const NAV_KEYS = new Set(["Tab", "Enter", " ", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);
window.addEventListener("keydown", (e) => { if (NAV_KEYS.has(e.key)) lastInputKeyboard = true; }, true);
window.addEventListener("pointerdown", () => { lastInputKeyboard = false; }, true);
const watchKeyboard = (host) => {
  const sync = () => host.toggleAttribute("kbd", lastInputKeyboard);
  host.addEventListener("focusin", sync);
  host.addEventListener("keydown", sync);
  host.addEventListener("pointerdown", sync);
};

// The CSS every card shares: host basics, the card surface, focus rings.
const BASE_CSS = `
  :host { display: block; -webkit-tap-highlight-color: transparent; }
  [hidden] { display: none !important; }
  button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0;
    cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent; }
  ha-card {
    --radius: var(--ha-card-border-radius, 18px);
    --pad: 14px;
    --well: color-mix(in oklab, var(--primary-text-color) 6%, transparent);
    --line: color-mix(in oklab, var(--primary-text-color) 9%, transparent);
    --accent: 88 142 233;
    --lvl-good: #4CAF50;
    --lvl-warn: #E8A33D;
    --lvl-bad: #E06666;
    position: relative; box-sizing: border-box;
    border-radius: var(--radius);
    border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--line));
    background: var(--ha-card-background, var(--card-background-color));
    box-shadow: var(--ha-card-box-shadow, none);
    color: var(--primary-text-color);
    font-family: var(--savvy-font-family, system-ui, -apple-system, BlinkMacSystemFont,
      "Segoe UI Variable Text", "Segoe UI", Roboto, sans-serif);
    font-variant-numeric: tabular-nums;
    -webkit-font-smoothing: antialiased;
    isolation: isolate;
    container-type: inline-size;
    transition: background-color 240ms ease, border-color 240ms ease;
  }
  @supports (corner-shape: squircle) {
    ha-card { corner-shape: squircle; border-radius: calc(var(--radius) * 1.7); }
  }
  :host([dark]) ha-card::after {
    content: ""; position: absolute; inset: 0; z-index: 9; border-radius: inherit; corner-shape: inherit;
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.05); pointer-events: none;
  }
  :host(:not([kbd])) :focus { outline: none; }
  :host([kbd]) :focus-visible { outline: 2px solid rgb(var(--accent)); outline-offset: 2px; border-radius: 10px; }
  @media (prefers-contrast: more) { ha-card { border-width: 1.5px; } }
  @media (prefers-reduced-motion: reduce) { ha-card { transition: none; } }
`;

// Registers a card for HA's card picker. Every Savvy card goes through this so the
// picker shows them together, with previews.
const registerCard = (type, cls, name, description) => {
  if (!customElements.get(type)) customElements.define(type, cls);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === type)) {
    window.customCards.push({ type, name: `Savvy ${name}`, description, preview: true });
  }
};

// ===== core/10-format.js =====
// ---------------------------------------------------------------------------------------
// core/format: durations, relative and absolute times, numbers.
// ---------------------------------------------------------------------------------------

const langOf = (hass) => hass?.locale?.language || undefined;

// "4 min", "1 h 20 min", "5 h", "3 d". Whole minutes only: a glance needs "about when",
// and seconds would make the text churn.
function duration(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 60) return `${Math.max(1, m)} min`;
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 6 && mm) return `${h} h ${mm} min`;
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

// Active things say how long they've been going ("for 12 min"); idle things say when
// they stopped ("12 min ago").
function since(t, active, now = Date.now()) {
  if (!Number.isFinite(t)) return "";
  const d = now - t;
  if (d < 60000) return "just now";
  return active ? `for ${duration(d)}` : `${duration(d)} ago`;
}

// "3 days ago" for timestamp states.
const RTF_UNITS = [
  ["year", 31557600000], ["month", 2629800000], ["week", 604800000],
  ["day", 86400000], ["hour", 3600000], ["minute", 60000],
];
const rtfCache = new Map();
function relativeTime(t, lang) {
  if (!Number.isFinite(t)) return null;
  const diff = t - Date.now();
  if (Math.abs(diff) < 45000) return "just now";
  const key = lang || "en";
  let rtf = rtfCache.get(key);
  if (!rtf) {
    try { rtf = new Intl.RelativeTimeFormat(key, { numeric: "auto" }); } catch (err) { rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" }); }
    rtfCache.set(key, rtf);
  }
  for (const [unit, ms] of RTF_UNITS) if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  return rtf.format(Math.round(diff / 60000), "minute");
}

const fmtDate = (t, opts, lang) => {
  try { return new Intl.DateTimeFormat(lang, opts).format(t); } catch (err) { return new Date(t).toLocaleString(); }
};

// Absolute time for a tooltip next to a relative one.
const clockTime = (t, lang) => fmtDate(t, { weekday: "short", hour: "2-digit", minute: "2-digit" }, lang);

// Axis labels for a chart spanning `span` ms: times for a day or two, weekdays for a few
// days, dates past a week.
function axisLabel(t, span, lang) {
  const hours = span / 3600000;
  const opts = hours > 168 ? { month: "short", day: "numeric" }
    : hours > 48 ? { weekday: "short" } : { hour: "numeric", minute: "2-digit" };
  return fmtDate(t, opts, lang);
}

// A moment under a scrub cursor: the weekday only when it isn't today; dates past a week.
function momentLabel(t, span, lang) {
  const hours = span / 3600000;
  const today = new Date(t).toDateString() === new Date().toDateString();
  const opts = hours > 31 * 24 ? { month: "short", day: "numeric" }
    : hours > 168 ? { month: "short", day: "numeric", hour: "numeric" }
    : today ? { hour: "numeric", minute: "2-digit" } : { weekday: "short", hour: "numeric", minute: "2-digit" };
  return fmtDate(t, opts, lang);
}

// Fewer decimals as numbers grow: 1234, 56.7, 8.91.
function fmtNumber(v) {
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return Number(v.toFixed(digits)).toString();
}

// "22.5 °C" style: units that attach (°, %) hug the number, others get a space.
const withUnit = (n, unit) => (!unit ? n : /^[°%]/.test(unit) ? `${n}${unit}` : `${n} ${unit}`);

// HA's own formatting when it has it, a title-cased state otherwise.
function stateText(hass, st) {
  if (!st) return "Not found";
  try { return hass.formatEntityState ? hass.formatEntityState(st) : title(st.state); } catch (err) { return title(st.state); }
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
// A timestamp by device_class, or by shape: some integrations don't expose device_class,
// and parseFloat("2026-09-26T…") would otherwise read the year as a number.
const isTimestamp = (st) => !!st && (st.attributes.device_class === "timestamp" || st.attributes.device_class === "date"
  || ISO_TIMESTAMP.test(st.state || ""));

// ===== core/20-registry.js =====
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

// ===== core/30-history.js =====
// ---------------------------------------------------------------------------------------
// core/history: state history, long-term statistics, and the chart helpers built on them.
// Rows always come back normalized to { s, lu } (state, last-updated in seconds).
// ---------------------------------------------------------------------------------------

const LONG_RANGE_H = 7 * 24;   // past a week: statistics, since the recorder keeps ~10 days

const rowTime = (r) => {
  const lu = r.lu ?? r.last_updated ?? r.last_changed;
  return typeof lu === "number" ? lu * 1000 : Date.parse(lu);
};

function normalizeRows(raw) {
  const out = {};
  for (const id in raw || {}) {
    out[id] = (raw[id] || []).map((r) => ({ s: r.s ?? r.state, lu: r.lu ?? r.last_updated ?? r.last_changed }));
  }
  return out;
}

// WS history with the REST fallback older cores need.
async function fetchHistory(hass, ids, hours) {
  if (!ids?.length) return {};
  const now = Date.now(), start = new Date(now - hours * 3600000);
  try {
    return normalizeRows(await hass.callWS({
      type: "history/history_during_period",
      start_time: start.toISOString(), end_time: new Date(now).toISOString(),
      entity_ids: ids, minimal_response: true, no_attributes: true, significant_changes_only: false,
    }));
  } catch (err) {
    const path = `history/period/${start.toISOString()}?filter_entity_id=${encodeURIComponent(ids.join(","))}&minimal_response&no_attributes`;
    const list = await hass.callApi("GET", path);
    const raw = {};
    for (const arr of list || []) if (arr?.length) raw[arr[0].entity_id] = arr;
    return normalizeRows(raw);
  }
}

// One attribute's history (a climate entity's current_temperature, say), as { s, lu }
// rows. Attributes only come with the full response, so this is for one entity at a time.
async function fetchAttributeHistory(hass, id, attribute, hours) {
  const now = Date.now(), start = new Date(now - hours * 3600000);
  const raw = await hass.callWS({
    type: "history/history_during_period",
    start_time: start.toISOString(), end_time: new Date(now).toISOString(),
    entity_ids: [id], minimal_response: false, no_attributes: false, significant_changes_only: false,
  });
  let last = null;
  return (raw?.[id] || []).map((r) => {
    const a = r.a || r.attributes;
    if (a && a[attribute] != null) last = a[attribute];
    return { s: last, lu: r.lu ?? r.last_updated ?? r.last_changed };
  }).filter((r) => r.s != null);
}

// Up to a week: state history. Longer: long-term statistics (hourly, daily past a month),
// which HA keeps forever for any sensor with a state_class; a sensor without them falls
// back to whatever state history the recorder still has.
async function fetchRange(hass, ids, hours) {
  if (hours <= LONG_RANGE_H) return fetchHistory(hass, ids, hours);
  const end = Date.now(), start = end - hours * 3600000;
  let stats = {};
  try {
    stats = await hass.callWS({
      type: "recorder/statistics_during_period",
      start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(),
      statistic_ids: ids, period: hours > 31 * 24 ? "day" : "hour", types: ["mean", "state"],
    }) || {};
  } catch (err) { /* older core, or no recorder: history below */ }
  const out = {}, missing = [];
  for (const id of ids) {
    const rows = (stats[id] || []).map((r) => ({
      s: r.mean ?? r.state,
      lu: (typeof r.start === "number" ? r.start : Date.parse(r.start)) / 1000,
    })).filter((r) => r.s != null && Number.isFinite(r.lu));
    if (rows.length) out[id] = rows;
    else missing.push(id);
  }
  if (missing.length) Object.assign(out, await fetchHistory(hass, missing, hours));
  return out;
}

// Numeric rows to points, with the live value appended so a line always reaches now.
function numericPoints(rows, liveState, end = Date.now()) {
  const pts = [];
  for (const r of rows || []) {
    const v = parseFloat(r.s), t = rowTime(r);
    if (Number.isFinite(v) && Number.isFinite(t)) pts.push({ t, v });
  }
  const live = parseFloat(liveState);
  if (Number.isFinite(live)) pts.push({ t: end, v: live });
  return pts;
}

// On/off runs clamped to [start, end]: [{ t0, t1, state }].
function stateRuns(rows, start, end, live) {
  const runs = [];
  for (const r of rows || []) {
    const t = rowTime(r), state = r.s;
    if (!Number.isFinite(t)) continue;
    const prev = runs[runs.length - 1];
    if (prev && prev.state === state) continue;
    const t0 = clamp(t, start, end);
    if (prev) prev.t1 = t0;
    runs.push({ t0, t1: end, state });
  }
  const last = runs[runs.length - 1];
  if (last && live && last.state !== live.state) {
    const lc = Date.parse(live.last_changed);
    const t0 = clamp(Number.isFinite(lc) ? lc : end, last.t0, end);
    last.t1 = t0;
    runs.push({ t0, t1: end, state: live.state });
  }
  return runs.filter((r) => r.t1 > r.t0);
}

// Even buckets, averaged, holding the last value across gaps: keeps the line honest and
// the path short enough to redraw cheaply.
function resample(points, start, end, buckets = 120) {
  points.sort((a, b) => a.t - b.t);
  const width = (end - start) / buckets;
  const sums = new Float64Array(buckets), counts = new Float64Array(buckets);
  let carry = null;
  for (const p of points) {
    if (p.t < start) { carry = p; continue; }
    const i = clamp(Math.floor((p.t - start) / width), 0, buckets - 1);
    sums[i] += p.v;
    counts[i]++;
  }
  const out = [];
  let held = carry ? carry.v : null;
  for (let i = 0; i < buckets; i++) {
    if (counts[i]) held = sums[i] / counts[i];
    if (held == null) continue;
    out.push({ t: start + (i + 0.5) * width, v: held });
  }
  return out;
}

// min / max / average of a series, with where the extremes fall.
function seriesStats(points) {
  const vals = points.map((p) => p.v);
  const min = Math.min(...vals), max = Math.max(...vals);
  return {
    min, max, avg: vals.reduce((a, b) => a + b, 0) / vals.length, last: vals[vals.length - 1],
    minAt: points[vals.indexOf(min)], maxAt: points[vals.indexOf(max)],
  };
}

// Catmull-Rom through the samples, converted to cubic beziers.
function linePath(pts) {
  const f = (v) => v.toFixed(2);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} `
      + `${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

// ===== core/40-health.js =====
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

// ===== core/50-palette.js =====
// ---------------------------------------------------------------------------------------
// core/palette: HA's named colours, and the mode dictionary that gives every option of a
// mode / scene select an icon and a colour without any configuration.
// ---------------------------------------------------------------------------------------

// HA's own named colours, as its themes define them; the hex is the fallback when a theme
// doesn't. `color: blue` in config becomes var(--blue-color, #2196f3).
const HA_COLORS = {
  red: "#f44336", pink: "#e91e63", purple: "#926bc7", "deep-purple": "#6e41ab", indigo: "#3f51b5",
  blue: "#2196f3", "light-blue": "#03a9f4", cyan: "#00bcd4", teal: "#009688", green: "#4caf50",
  "light-green": "#8bc34a", lime: "#cddc39", yellow: "#ffeb3b", amber: "#ffc107", orange: "#ff9800",
  "deep-orange": "#ff6f22", brown: "#795548", grey: "#9e9e9e", "blue-grey": "#607d8b",
};
const colorOf = (c) => {
  if (!c) return "";
  const k = String(c).toLowerCase().replace(/[\s_]+/g, "-");
  return HA_COLORS[k] ? `var(--${k}-color, ${HA_COLORS[k]})` : c;
};

// The mode dictionary. Each entry: keywords, an MDI icon, a colour. Colours are grouped by
// meaning (CARD-DESIGN.md 5.3): warm for daytime and food, cool for night and sleep,
// violet for screens, green for company, red for away, and no colour at all for the
// resting states (sync, auto, normal), which keep the theme's text colour.
// Matching (modeLook): case, spaces, underscores and plurals are ignored, and the longest
// keyword found wins, so "Movie Night" is a movie, not a night.
const MODE_DICTIONARY = [
  // ---- resting / control
  [["sync", "synced", "follow", "follow house", "default"], "mdi:sync", ""],
  [["auto", "automatic", "normal", "standard", "regular"], "mdi:autorenew", ""],
  [["basic", "simple"], "mdi:home-outline", "#8FA3B8"],
  [["manual", "override", "hand"], "mdi:hand-back-right-outline", "#4FB3A5"],
  [["off", "disabled", "none", "idle"], "mdi:power", "#8A9099"],
  [["eco", "economy", "energy saving", "saving", "green"], "mdi:leaf", "#6FBF73"],
  [["boost", "turbo", "max", "maximum", "full"], "mdi:rocket-launch-outline", "#E8934A"],
  [["silent", "mute", "muted", "quiet", "do not disturb", "dnd"], "mdi:volume-off", "#7F8CA3"],
  [["holiday", "vacation", "trip", "travel", "travelling", "traveling"], "mdi:airplane", "#E06666"],
  [["test", "testing", "debug", "maintenance", "service"], "mdi:wrench-outline", "#8FA3B8"],
  // ---- time of day
  [["morning", "sunrise", "dawn", "wake", "wake up", "waking", "breakfast time"], "mdi:weather-sunset-up", "#F5C04D"],
  [["daytime", "day", "day time", "noon", "midday", "afternoon", "sunny", "bright day"], "mdi:white-balance-sunny", "#F5B83D"],
  [["evening", "sunset", "dusk", "golden hour", "twilight"], "mdi:weather-sunset", "#F2915E"],
  [["night", "nighttime", "night time", "late", "late night", "midnight", "moon"], "mdi:weather-night", "#4F8FE0"],
  // ---- sleep and rest
  [["sleep", "sleeping", "asleep", "bedtime", "bed time", "bed", "goodnight", "good night"], "mdi:sleep", "#7B6FE0"],
  [["nap", "napping", "siesta", "rest", "resting", "lie down"], "mdi:power-sleep", "#8F84E8"],
  [["baby", "baby sleep", "nursery", "kids sleep", "kid sleep"], "mdi:baby-face-outline", "#9A8FE8"],
  [["night light", "nightlight", "night lamp"], "mdi:lightbulb-night-outline", "#5E7FD6"],
  // ---- presence
  [["home", "at home", "someone home", "occupied", "present", "arrive", "arriving", "welcome"], "mdi:home", "#6FA8DC"],
  [["away", "out", "leave", "leaving", "left", "nobody home", "empty", "gone", "absent"], "mdi:home-export-outline", "#E06666"],
  [["guest", "guests", "visitor", "visitors", "company", "hosting"], "mdi:account-group-outline", "#5FBF8A"],
  [["party", "celebration", "celebrate", "birthday", "friends", "gathering", "fiesta"], "mdi:party-popper", "#E36AB5"],
  [["pet", "pets", "dog", "cat", "pet mode"], "mdi:paw", "#C4A57B"],
  [["security", "secure", "armed", "alarm", "lockdown", "protect"], "mdi:shield-home-outline", "#D9534F"],
  // ---- food
  [["cooking", "cook", "kitchen", "baking", "bake", "prep", "meal prep"], "mdi:silverware-fork-knife", "#E8934A"],
  [["dinner", "dining", "lunch", "breakfast", "brunch", "eating", "meal", "supper"], "mdi:food", "#E0A65A"],
  [["coffee", "tea", "cafe"], "mdi:coffee-outline", "#B98552"],
  [["drinks", "cocktail", "cocktails", "wine", "bar", "happy hour"], "mdi:glass-cocktail", "#D0679A"],
  // ---- work and study
  [["work", "working", "office", "home office", "wfh", "work from home", "busy"], "mdi:briefcase-outline", "#5B8DB8"],
  [["focus", "focus time", "concentrate", "concentration", "deep work", "productive"], "mdi:head-cog-outline", "#3FB6C9"],
  [["meeting", "in a meeting", "call", "video call", "zoom", "conference", "on call"], "mdi:account-voice", "#C4566E"],
  [["study", "studying", "homework", "school", "learning", "exam"], "mdi:school-outline", "#6A8FD9"],
  [["reading", "read", "book", "books", "library"], "mdi:book-open-page-variant-outline", "#B7925C"],
  [["writing", "write", "journal", "creative", "art", "drawing", "painting", "craft", "crafts"], "mdi:palette-outline", "#C98BD9"],
  // ---- screens and sound
  [["tv", "watching tv", "television", "watching", "show", "shows", "series", "binge"], "mdi:television-play", "#5BA3D9"],
  [["movie", "movies", "movie time", "watching movie", "cinema", "film", "theater", "theatre", "home theater", "netflix"], "mdi:movie-open", "#9B7BD9"],
  [["gaming", "game", "games", "playstation", "xbox", "nintendo", "switch", "console", "esports"], "mdi:gamepad-variant", "#A8C74F"],
  [["music", "listening", "spotify", "playlist", "concert", "dj", "karaoke", "dance", "dancing"], "mdi:music", "#D97FB8"],
  [["podcast", "radio", "audiobook"], "mdi:podcast", "#C77FB0"],
  [["sport", "sports", "match", "football", "soccer", "basketball", "game day"], "mdi:soccer", "#6DBA6A"],
  // ---- wellness
  [["workout", "exercise", "gym", "training", "fitness", "cardio", "running", "run"], "mdi:dumbbell", "#E57A5A"],
  [["yoga", "stretch", "stretching", "pilates"], "mdi:yoga", "#8CC7A1"],
  [["meditate", "meditation", "mindful", "mindfulness", "breathe", "calm", "zen"], "mdi:meditation", "#7FB3A6"],
  [["bath", "bathing", "shower", "spa", "sauna", "hot tub", "jacuzzi"], "mdi:shower-head", "#5FA8E0"],
  [["getting ready", "dress", "dressing", "makeup", "get ready"], "mdi:hanger", "#D98FA8"],
  // ---- chores
  [["cleaning", "clean", "tidy", "tidying", "housework", "chores"], "mdi:broom", "#7CC4B5"],
  [["vacuum", "vacuuming", "robot", "mopping", "mop"], "mdi:robot-vacuum", "#7CB9C4"],
  [["laundry", "washing", "wash", "dryer", "ironing"], "mdi:washing-machine", "#72A7D8"],
  [["gardening", "garden", "plants", "watering", "yard", "lawn"], "mdi:flower-outline", "#7DBF63"],
  // ---- ambience
  [["relax", "relaxing", "relaxed", "chill", "chilling", "chillout", "lounge", "unwind", "lazy"], "mdi:sofa-outline", "#C4A57B"],
  [["cozy", "cosy", "warm", "hygge", "fireplace", "candle", "candles"], "mdi:fireplace", "#E39A5C"],
  [["romantic", "romance", "date", "date night", "love", "intimate"], "mdi:heart-outline", "#E0677F"],
  [["bright", "full bright", "all lights", "daylight", "concentrate light"], "mdi:brightness-7", "#F2C94C"],
  [["dim", "dimmed", "low light", "soft", "soft light", "ambient", "ambience", "mood", "moody"], "mdi:brightness-4", "#B79CD9"],
  [["dark", "lights off", "blackout", "all off"], "mdi:lightbulb-off-outline", "#7F8CA3"],
  [["colorful", "colourful", "rainbow", "disco", "rgb"], "mdi:palette", "#D97FB8"],
  [["christmas", "xmas", "holiday lights", "festive", "hanukkah", "halloween", "easter"], "mdi:pine-tree", "#5FAF6A"],
  // ---- family
  [["kids", "kid", "children", "family", "family time", "play", "playtime", "toys"], "mdi:human-male-female-child", "#F0A05A"],
];

// keyword -> [icon, colour], built once; each keyword also indexed by its singular
const MODE_INDEX = (() => {
  const m = new Map();
  for (const [words, icon, color] of MODE_DICTIONARY) {
    for (const w of words) {
      const k = norm(w);
      if (!m.has(k)) m.set(k, { icon, color, len: k.length });
    }
  }
  return m;
})();
const singular = (w) => {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;       // parties -> party
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
};

// The look of one option: { icon, color }. Config overrides (keyed loosely) win; then the
// exact phrase; then the longest dictionary keyword found inside the option.
function modeLook(option, overrides = {}) {
  const o = norm(option);
  const icons = overrides.icons || {}, colors = overrides.colors || {};
  const hit = (() => {
    const exact = MODE_INDEX.get(o) || MODE_INDEX.get(o.split(" ").map(singular).join(" "));
    if (exact) return exact;
    const words = o.split(" ");
    let best = null;
    for (let i = 0; i < words.length; i++) {
      for (let j = words.length; j > i; j--) {
        const phrase = words.slice(i, j).join(" ");
        const e = MODE_INDEX.get(phrase) || MODE_INDEX.get(words.slice(i, j).map(singular).join(" "));
        if (e && (!best || e.len > best.len)) best = e;
      }
    }
    return best;
  })();
  return {
    icon: icons[o] || hit?.icon || "mdi:shape-outline",
    color: colors[o] !== undefined ? colorOf(colors[o]) : (hit?.color ?? ""),
  };
}

// ===== core/60-actions.js =====
// ---------------------------------------------------------------------------------------
// core/actions: tap / hold / double-tap in Home Assistant's standard action format, plus
// Savvy's own `list` (the popup of the entities a chip stands for), and the press gesture.
//
//   tap_action: { action: toggle | more-info | navigate | url | perform-action |
//                         call-service | list | none, navigation_path, url_path,
//                 perform_action, data, target, confirmation }
// A bare string ("toggle") is accepted as { action: "toggle" }.
// ---------------------------------------------------------------------------------------

const PRESSES = new Set(["button", "input_button"]);
const TURN_ON = new Set(["script", "scene"]);

const asAction = (a) => (typeof a === "string" ? { action: a } : a || null);

// What a tap does when config says nothing: toggles toggle, buttons press, scripts and
// scenes run, everything else opens more-info.
function defaultTapAction(entity) {
  const d = domainOf(entity);
  if (PRESSES.has(d)) return { action: "perform-action", perform_action: `${d}.press`, target: { entity_id: entity } };
  if (TURN_ON.has(d)) return { action: "perform-action", perform_action: `${d}.turn_on`, target: { entity_id: entity } };
  if (["light", "switch", "input_boolean", "fan", "siren", "automation", "humidifier"].includes(d)) return { action: "toggle" };
  return { action: "more-info" };
}

// Toggle the way each domain actually toggles.
function toggleEntity(hass, id) {
  const d = domainOf(id), st = hass.states[id];
  if (d === "lock") return hass.callService("lock", st?.state === "locked" ? "unlock" : "lock", {}, { entity_id: id });
  if (PRESSES.has(d)) return hass.callService(d, "press", {}, { entity_id: id });
  if (TURN_ON.has(d)) return hass.callService(d, "turn_on", {}, { entity_id: id });
  if (["light", "switch", "input_boolean", "fan", "siren", "automation", "cover", "humidifier", "media_player", "climate", "valve"].includes(d)) {
    return hass.callService(d, "toggle", {}, { entity_id: id });
  }
  return hass.callService("homeassistant", "toggle", {}, { entity_id: id });
}

// Run an action. ctx: { entity, list } where list() opens the chip's entity popup.
function runAction(host, hass, action, ctx = {}) {
  const a = asAction(action);
  if (!a || a.action === "none") return false;
  if (a.confirmation) {
    const t = typeof a.confirmation === "object" && a.confirmation.text ? a.confirmation.text : "Are you sure?";
    if (!window.confirm(t)) return false;
  }
  const entity = a.entity || ctx.entity;
  switch (a.action) {
    case "more-info": moreInfo(host, entity); return true;
    case "toggle": if (entity) toggleEntity(hass, entity); return true;
    case "navigate": navigate(a.navigation_path, a.navigation_replace); return true;
    case "url": if (a.url_path) window.open(a.url_path, a.new_tab === false ? "_self" : "_blank"); return true;
    case "list": if (ctx.list) ctx.list(); return true;
    case "perform-action":
    case "call-service": {
      const svc = a.perform_action || a.service;
      if (!svc) return false;
      const [domain, service] = svc.split(".");
      hass.callService(domain, service, a.data || a.service_data || {}, a.target);
      return true;
    }
    case "fire-dom-event":
      host.dispatchEvent(new CustomEvent("ll-custom", { detail: a, bubbles: true, composed: true }));
      return true;
    default: return false;
  }
}

// The press gesture (CARD-DESIGN.md 3.1): feedback on pointer-down, commit on release; a
// press that travels is a scroll; a hold commits at 500ms with a medium haptic; a
// double-tap only costs a delay where one is configured. `spring` (optional) is driven
// 0 -> 1 while pressed; the card paints it. Returns the spring.
function bindPress(el, { spring, wake, onTap, onHold, onDouble, haptic: tapHaptic = "light" } = {}) {
  let origin = null, armed = false, swallow = false, holdTimer = 0, tapTimer = 0, taps = 0;
  const settle = (motion) => {
    clearTimeout(holdTimer);
    origin = null;
    if (spring) { spring.to(0, motion); wake?.(); }
  };
  el.addEventListener("pointerdown", (e) => {
    if (e.button > 0 || el.hasAttribute("disabled")) return;
    origin = [e.clientX, e.clientY];
    armed = true; swallow = false;
    if (spring) { spring.to(1, onHold ? MOTION.hold : MOTION.press); wake?.(); }
    if (onHold) holdTimer = setTimeout(() => {
      swallow = true;
      settle(MOTION.pop);
      haptic("medium");
      onHold();
    }, HOLD_MS);
  });
  el.addEventListener("pointermove", (e) => {
    if (!origin || Math.hypot(e.clientX - origin[0], e.clientY - origin[1]) < SLOP) return;
    swallow = true;
    settle(MOTION.release);
  });
  el.addEventListener("pointerup", () => origin && settle(MOTION.release));
  for (const t of ["pointercancel", "pointerleave"]) el.addEventListener(t, () => { if (origin) { swallow = true; settle(MOTION.release); } });
  el.addEventListener("contextmenu", (e) => { if (onHold) e.preventDefault(); });
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    const ok = (armed || e.detail === 0) && !swallow;
    armed = false; swallow = false;
    if (!ok) return;
    if (!onDouble) { if (tapHaptic) haptic(tapHaptic); onTap?.(); return; }
    taps++;
    clearTimeout(tapTimer);
    if (taps >= 2) { taps = 0; haptic("medium"); onDouble(); return; }
    tapTimer = setTimeout(() => { taps = 0; if (tapHaptic) haptic(tapHaptic); onTap?.(); }, DOUBLE_MS);
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); }
  });
  // a gesture that turned into something else (a scrub) must not also fire the tap
  if (spring) spring.swallow = () => { swallow = true; settle(MOTION.release); };
  return spring;
}

// Wires tap/hold/double-tap of an element to action configs, with the chip's defaults.
function bindActions(host, el, getCtx, { spring, wake, defaults = {} } = {}) {
  const act = (kind) => () => {
    const ctx = getCtx();
    const cfg = ctx.config || {};
    const action = cfg[`${kind}_action`] !== undefined ? cfg[`${kind}_action`] : defaults[kind];
    runAction(host, ctx.hass, action, ctx);
  };
  const has = (kind) => {
    const cfg = getCtx().config || {};
    const a = asAction(cfg[`${kind}_action`] !== undefined ? cfg[`${kind}_action`] : defaults[kind]);
    return !!a && a.action !== "none";
  };
  // hold and double-tap only cost something (a sink, a delay) where they're configured;
  // cards rebuild on setConfig, so reading the config once here is enough
  return bindPress(el, {
    spring, wake,
    onTap: act("tap"),
    onHold: has("hold") ? act("hold") : null,
    onDouble: has("double_tap") ? act("double_tap") : null,
  });
}

// ===== core/70-sheet.js =====
// ---------------------------------------------------------------------------------------
// core/sheet: the popup (CARD-DESIGN.md 8). A centred panel on wide screens, a bottom sheet
// under 600px. Rendered in the card's shadow root but outside ha-card (its container-type
// would clip a fixed popup), so it carries its own colour tokens. Closes on the close
// button, a tap outside or Escape, and returns focus to whatever opened it.
// ---------------------------------------------------------------------------------------

const SHEET_CSS = `
  .sv-scrim { position: fixed; inset: 0; z-index: 998; background: rgb(0 0 0 / 0.45); opacity: 0; }
  .sv-sheet {
    --well: color-mix(in oklab, var(--primary-text-color) 6%, transparent);
    --line: color-mix(in oklab, var(--primary-text-color) 9%, transparent);
    --accent: 88 142 233;
    position: fixed; z-index: 999; box-sizing: border-box; display: flex; flex-direction: column;
    left: 50%; top: 50%; width: min(460px, calc(100vw - 32px)); max-height: min(640px, calc(100vh - 48px));
    border-radius: 22px; overflow: hidden; opacity: 0;
    background: var(--ha-card-background, var(--card-background-color, #fff)); color: var(--primary-text-color);
    box-shadow: 0 18px 50px rgb(0 0 0 / 0.35), 0 0 0 0.5px var(--line);
    font-family: var(--savvy-font-family, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", Roboto, sans-serif);
    font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased;
  }
  .sv-sheet[data-wide] { width: min(560px, calc(100vw - 32px)); max-height: min(720px, calc(100vh - 48px)); }
  @supports (corner-shape: squircle) { .sv-sheet { corner-shape: squircle; border-radius: 36px; } }
  .sv-sheet[data-bottom] { left: 0; right: 0; top: auto; bottom: 0; width: auto; max-height: 85vh;
    border-radius: 22px 22px 0 0; padding-bottom: env(safe-area-inset-bottom); }
  .sv-grab { align-self: center; width: 36px; height: 5px; border-radius: 3px; margin: 7px 0 -3px;
    background: color-mix(in oklab, var(--primary-text-color) 20%, transparent); }
  .sv-sheet:not([data-bottom]) .sv-grab { display: none; }
  .sv-head { display: flex; align-items: center; gap: 8px; padding: 14px 12px 8px 18px; }
  .sv-title { flex: 1; min-width: 0; font-size: 18px; line-height: 23px; font-weight: 650; letter-spacing: -0.022em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sv-close { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center;
    background: var(--well); --mdc-icon-size: 18px; flex: none; }
  .sv-body { overflow: auto; overscroll-behavior: contain; padding: 4px 16px 18px; display: flex; flex-direction: column;
    gap: 10px; container-type: inline-size; }

  /* the entity list: one row per entity, live */
  .sv-rows { display: flex; flex-direction: column; gap: 4px; }
  .sv-row { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 6px 8px 6px 6px; border-radius: 14px;
    cursor: pointer; }
  .sv-row:hover { background: var(--well); }
  .sv-ic { flex: none; width: 36px; height: 36px; border-radius: 11px; display: grid; place-items: center;
    background: var(--well); color: var(--secondary-text-color); --mdc-icon-size: 20px; }
  .sv-row[data-on] .sv-ic { color: var(--row-c, rgb(var(--accent))); background: color-mix(in oklab, var(--row-c, rgb(var(--accent))) 16%, transparent); }
  .sv-row[data-off] { opacity: 0.55; }
  .sv-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .sv-name { font-size: 14px; line-height: 18px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sv-sub { font-size: 12px; line-height: 16px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sv-val { flex: none; font-size: 13px; font-weight: 600; color: var(--secondary-text-color); }
  .sv-tog { flex: none; width: 44px; height: 26px; border-radius: 13px; background: var(--well); position: relative; }
  .sv-tog::after { content: ""; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%;
    background: var(--card-background-color, #fff); box-shadow: 0 1px 3px rgb(0 0 0 / 0.25); transform: translateX(var(--tx, 0px)); }
  .sv-tog[data-on] { background: var(--row-c, rgb(var(--accent))); --tx: 18px; }
  .sv-empty { padding: 18px 8px; text-align: center; font-size: 13px; color: var(--secondary-text-color); }
  .sv-group { margin: 8px 6px 2px; font-size: 11.5px; line-height: 14px; font-weight: 650; letter-spacing: 0.04em;
    text-transform: uppercase; color: var(--secondary-text-color); }
`;

const SHEET_STYLE_KEY = "__savvySheetCss";

class Sheet {
  // host: the card element (its shadow root holds the sheet). opts: { title, wide, onClose }
  constructor(host, { title: heading = "", wide = false, onClose } = {}) {
    this.host = host;
    this.onClose = onClose;
    const root = host.shadowRoot;
    if (!root[SHEET_STYLE_KEY]) {
      const style = document.createElement("style");
      style.textContent = SHEET_CSS;
      root.appendChild(style);
      root[SHEET_STYLE_KEY] = style;
    }
    this.scrim = document.createElement("div");
    this.scrim.className = "sv-scrim";
    this.el = document.createElement("div");
    this.el.className = "sv-sheet";
    this.el.toggleAttribute("data-wide", wide);
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-modal", "true");
    this.el.setAttribute("aria-label", heading);
    this.el.innerHTML = `<span class="sv-grab" aria-hidden="true"></span>
      <div class="sv-head"><span class="sv-title"></span><button class="sv-close" aria-label="Close"><ha-icon icon="mdi:close"></ha-icon></button></div>
      <div class="sv-body"></div>`;
    this.el.querySelector(".sv-title").textContent = heading;
    this.body = this.el.querySelector(".sv-body");
    this.spring = new Spring(0, MOTION.sheetIn, "sheet");
    this.job = (now, dt) => this.frame(false, dt);
    this.returnTo = null;
  }

  setTitle(t) { text(this.el.querySelector(".sv-title"), t); this.el.setAttribute("aria-label", t); }

  open(returnTo) {
    this.returnTo = returnTo || this.host.shadowRoot.activeElement || null;
    this.host.shadowRoot.append(this.scrim, this.el);
    this.place = () => this.el.toggleAttribute("data-bottom", window.innerWidth < 600);
    this.place();
    this.onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(); } };
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("resize", this.place);
    this.el.querySelector(".sv-close").addEventListener("click", (e) => { e.stopPropagation(); this.close(); });
    // a frame later, so the tap that opened it doesn't close it straight away
    requestAnimationFrame(() => this.scrim.addEventListener("pointerdown", () => this.close()));
    this.isOpen = true;
    this.closing = false;
    this.spring.snap(0).to(1, MOTION.sheetIn);
    haptic("selection");
    this.el.querySelector(".sv-close").focus({ preventScroll: true });
    this.frame(true);
    Clock.add(this.job);
    return this;
  }

  close(now = false) {
    if (!this.isOpen) return;
    this.isOpen = false;
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("resize", this.place);
    this.returnTo?.focus?.({ preventScroll: true });
    if (now || !this.host.isConnected || MQ.reduced.matches) return this.remove();
    this.closing = true;
    this.scrim.style.pointerEvents = "none";
    this.spring.to(0, MOTION.sheetOut);
    Clock.add(this.job);
  }

  remove() {
    Clock.remove(this.job);
    this.scrim.remove();
    this.el.remove();
    this.closing = false;
    this.onClose?.();
  }

  frame(force = false, dt = 1 / 60) {
    const s = this.spring;
    if (!force) { if (MQ.reduced.matches) s.snap(); else s.step(dt); }
    const v = s.x, bottom = this.el.hasAttribute("data-bottom");
    put(this.scrim, "opacity", clamp(v).toFixed(3));
    put(this.el, "opacity", clamp(v * 1.6).toFixed(3));
    put(this.el, "transform", bottom ? `translateY(${((1 - v) * 60).toFixed(2)}px)`
      : `translate(-50%, calc(-50% + ${((1 - v) * 18).toFixed(2)}px)) scale(${(0.97 + 0.03 * v).toFixed(4)})`);
    if (this.closing && v < 0.02 && s.idle) { this.remove(); return false; }
    return !s.idle;
  }
}

// The popup a group chip opens: the entities it counts, live, each with its own control.
// Row tap opens more-info; the switch on toggleable rows toggles.
class EntityListSheet {
  constructor(host, { title: heading, color } = {}) {
    this.host = host;
    this.color = color;
    this.sheet = new Sheet(host, { title: heading, onClose: () => { this.open = false; } });
    this.rows = document.createElement("div");
    this.rows.className = "sv-rows";
    this.sheet.body.appendChild(this.rows);
  }

  show(hass, ids, returnTo) {
    this.ids = ids;
    this.open = true;
    this.render(hass);
    this.sheet.open(returnTo);
  }

  // cards call this from their hass setter while it's open, so rows stay live
  render(hass) {
    if (!this.open) return;
    this.hass = hass;
    const ids = (typeof this.ids === "function" ? this.ids(hass) : this.ids) || [];
    const box = this.rows;
    box.__rows = box.__rows || new Map();
    const seen = new Set();
    if (!ids.length) {
      if (!box.__empty) { box.__empty = document.createElement("div"); box.__empty.className = "sv-empty"; box.__empty.textContent = "Nothing right now."; }
      box.appendChild(box.__empty);
    } else box.__empty?.remove();
    for (const id of ids) {
      seen.add(id);
      let row = box.__rows.get(id);
      if (!row) {
        row = document.createElement("div");
        row.className = "sv-row";
        row.setAttribute("role", "button");
        row.setAttribute("tabindex", "0");
        row.innerHTML = `<span class="sv-ic"><ha-state-icon></ha-state-icon></span>
          <span class="sv-txt"><span class="sv-name"></span><span class="sv-sub"></span></span>
          <span class="sv-val"></span><button class="sv-tog" hidden></button>`;
        row.__icon = row.querySelector("ha-state-icon");
        row.__tog = row.querySelector(".sv-tog");
        bindPress(row, { onTap: () => moreInfo(this.host, id), haptic: null });
        bindPress(row.__tog, { onTap: () => toggleEntity(this.hass, id) });
        box.__rows.set(id, row);
      }
      const st = hass.states[id];
      const on = isActive(st);
      if (this.color) put(row, "--row-c", colorOf(this.color));
      attr(row, "data-on", on);
      attr(row, "data-off", !st || isOff(st));
      if (st && row.__icon.stateObj !== st) { row.__icon.hass = hass; row.__icon.stateObj = st; }
      text(row.querySelector(".sv-name"), shortName(hass, id, null));
      const area = entityArea(hass, id);
      text(row.querySelector(".sv-sub"), area ? areaInfo(hass, area).name : "");
      const toggleable = ["light", "switch", "input_boolean", "fan", "lock", "cover", "media_player", "climate", "siren", "humidifier"].includes(domainOf(id));
      row.__tog.hidden = !toggleable || !st || isOff(st);
      attr(row.__tog, "data-on", on);
      attr(row.__tog, "aria-label", on ? "Turn off" : "Turn on");
      text(row.querySelector(".sv-val"), toggleable ? "" : stateText(hass, st));
      box.appendChild(row);   // keeps DOM order equal to the ids' order
    }
    for (const [id, row] of box.__rows) if (!seen.has(id)) { row.remove(); box.__rows.delete(id); }
  }
}

// ===== core/90-editor.js =====
// ---------------------------------------------------------------------------------------
// core/editor: the visual editor every card gets. A card describes its options as a schema;
// scalar options render through HA's own <ha-form> (native look, standard selectors),
// list options through <savvy-list-editor> (add, remove, reorder, a sub-form per item).
//
// A card's editor:
//   class LightsEditor extends SavvyEditor {
//     schema(hass, config) { return [ ...ha-form schema entries..., { name: "chips", type: "list", ... } ] }
//   }
// Schema entries are HA's ha-form format, plus two Savvy extras:
//   { name, type: "list", label, item: [sub-schema], add: { selector }, summary(item) }
//   label / helper on any entry (turned into computeLabel / computeHelper)
// ---------------------------------------------------------------------------------------

// ha-form is only loaded once some HA editor has been opened. Creating an entities card's
// editor forces it, the way custom cards commonly do.
let formReady = null;
const ensureHaForm = () => formReady || (formReady = (async () => {
  if (customElements.get("ha-form") && customElements.get("ha-entity-picker")) return;
  try {
    const helpers = await window.loadCardHelpers?.();
    const card = await helpers?.createCardElement({ type: "entities", entities: [] });
    await card?.constructor?.getConfigElement?.();
  } catch (err) { /* the editor falls back to YAML in the card editor */ }
})());

const EDITOR_CSS = `
  :host { display: block; }
  .sv-ed { display: flex; flex-direction: column; gap: 16px; }
  .sv-section { display: flex; flex-direction: column; gap: 8px; }
  .sv-label { font-size: 14px; font-weight: 500; color: var(--primary-text-color); }
  .sv-help { font-size: 12px; color: var(--secondary-text-color); margin-top: -4px; }
  .sv-item { border: 1px solid var(--divider-color, rgba(0,0,0,.12)); border-radius: 12px; overflow: hidden; }
  .sv-item-head { display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 12px; min-height: 40px; }
  .sv-item-head .t { flex: 1; min-width: 0; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sv-item-head .t small { color: var(--secondary-text-color); margin-inline-start: 6px; }
  .sv-item-body { padding: 4px 12px 12px; border-top: 1px solid var(--divider-color, rgba(0,0,0,.12)); }
  .sv-ibtn { width: 32px; height: 32px; border: 0; border-radius: 8px; background: none; color: var(--secondary-text-color);
    display: grid; place-items: center; cursor: pointer; --mdc-icon-size: 20px; }
  .sv-ibtn:hover { background: color-mix(in oklab, var(--primary-text-color) 8%, transparent); }
  .sv-ibtn[disabled] { opacity: 0.3; cursor: default; }
  .sv-add { display: flex; gap: 8px; align-items: center; }
  .sv-add > * { flex: 1; }
  .sv-empty { font-size: 13px; color: var(--secondary-text-color); padding: 4px 2px; }
`;

// Drop keys the user cleared, so the YAML stays as short as the choices made.
const cleanConfig = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === "" || v === null) continue;
    if (Array.isArray(v) && !v.length) continue;
    out[k] = v;
  }
  return out;
};

class SavvyEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._open = new Set();
  }
  setConfig(config) {
    this._config = { ...config };
    this._render();
  }
  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) ensureHaForm().then(() => this._render());
    for (const f of this.shadowRoot.querySelectorAll("ha-form")) f.hass = hass;
    for (const l of this.shadowRoot.querySelectorAll("savvy-list-editor")) l.hass = hass;
  }
  // Cards override: returns the schema for the current config (may depend on hass, e.g.
  // climate lists the area's climate entities).
  schema() { return []; }

  _emit(config) {
    this._config = cleanConfig(config);
    // HA answers config-changed with setConfig, but the forms mustn't show stale values
    // meanwhile (or where nothing answers)
    for (const f of this.shadowRoot.querySelectorAll("ha-form")) f.data = this._config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
  }

  _render() {
    if (!this._config) return;
    const root = this.shadowRoot;
    if (!root.__style) { root.__style = document.createElement("style"); root.__style.textContent = EDITOR_CSS; root.appendChild(root.__style); }
    let wrap = root.querySelector(".sv-ed");
    if (!wrap) { wrap = document.createElement("div"); wrap.className = "sv-ed"; root.appendChild(wrap); }
    const schema = this.schema(this._hass, this._config) || [];
    // consecutive scalar entries share one ha-form; each list gets its own editor
    const groups = [];
    for (const entry of schema) {
      if (entry.type === "list") groups.push(entry);
      else if (groups.length && Array.isArray(groups[groups.length - 1])) groups[groups.length - 1].push(entry);
      else groups.push([entry]);
    }
    const nodes = [];
    groups.forEach((g, i) => {
      const key = Array.isArray(g) ? `form:${i}` : `list:${g.name}`;
      let node = wrap.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (Array.isArray(g)) {
        if (!node) {
          node = document.createElement("ha-form");
          node.dataset.key = key;
          node.addEventListener("value-changed", (e) => {
            e.stopPropagation();
            this._emit({ ...this._config, ...e.detail.value });
          });
        }
        const labels = new Map(), helps = new Map();
        const walk = (list) => list.forEach((s) => {
          if (s.name && s.label) labels.set(s.name, s.label);
          if (s.name && s.helper) helps.set(s.name, s.helper);
          if (s.schema) walk(s.schema);
        });
        walk(g);
        node.computeLabel = (s) => labels.get(s.name) || title(s.name);
        node.computeHelper = (s) => helps.get(s.name) || "";
        node.schema = g;
        node.data = this._config;
        node.hass = this._hass;
      } else {
        if (!node) {
          node = document.createElement("savvy-list-editor");
          node.dataset.key = key;
          node.addEventListener("list-changed", (e) => {
            e.stopPropagation();
            this._emit({ ...this._config, [g.name]: e.detail.items });
          });
        }
        node.hass = this._hass;
        node.setup(g, this._config[g.name]);
      }
      nodes.push(node);
    });
    for (const n of [...wrap.children]) if (!nodes.includes(n)) n.remove();
    nodes.forEach((n) => wrap.appendChild(n));
  }
}

// An ordered list of items (strings or objects): add, remove, reorder, edit one at a time.
class SavvyListEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._openIdx = -1;
  }
  set hass(h) {
    this._hass = h;
    for (const f of this.shadowRoot.querySelectorAll("ha-form, ha-entity-picker, ha-selector")) f.hass = h;
  }
  setup(spec, items) {
    this._spec = spec;
    this._items = [].concat(items || []);
    this._render();
  }
  _emit() {
    // a copy: listeners keep what they were given, later edits don't rewrite it
    this.dispatchEvent(new CustomEvent("list-changed", { detail: { items: [...this._items] }, bubbles: true, composed: true }));
    this._render();
  }
  _summary(item) {
    if (this._spec.summary) return this._spec.summary(item, this._hass);
    const o = typeof item === "string" ? { entity: item } : item;
    const st = o.entity && this._hass?.states[o.entity];
    return { title: o.name || st?.attributes.friendly_name || o.entity || o.navigation_path || "Item", sub: o.entity || "" };
  }
  _render() {
    const root = this.shadowRoot, spec = this._spec;
    if (!spec) return;
    root.innerHTML = `<style>${EDITOR_CSS}</style>
      <div class="sv-section">
        <div class="sv-label"></div>${spec.helper ? '<div class="sv-help"></div>' : ""}
        <div class="sv-list"></div>
        <div class="sv-add"></div>
      </div>`;
    root.querySelector(".sv-label").textContent = spec.label || title(spec.name);
    if (spec.helper) root.querySelector(".sv-help").textContent = spec.helper;
    const list = root.querySelector(".sv-list");
    if (!this._items.length) {
      const e = document.createElement("div");
      e.className = "sv-empty";
      e.textContent = spec.empty || "Nothing added.";
      list.appendChild(e);
    }
    this._items.forEach((item, i) => {
      const row = document.createElement("div");
      row.className = "sv-item";
      const s = this._summary(item);
      row.innerHTML = `<div class="sv-item-head"><span class="t"></span>
        <button class="sv-ibtn" data-a="up" aria-label="Move up"><ha-icon icon="mdi:arrow-up"></ha-icon></button>
        <button class="sv-ibtn" data-a="down" aria-label="Move down"><ha-icon icon="mdi:arrow-down"></ha-icon></button>
        ${spec.item ? '<button class="sv-ibtn" data-a="edit" aria-label="Edit"><ha-icon icon="mdi:pencil"></ha-icon></button>' : ""}
        <button class="sv-ibtn" data-a="remove" aria-label="Remove"><ha-icon icon="mdi:close"></ha-icon></button></div>`;
      const t = row.querySelector(".t");
      t.textContent = s.title;
      if (s.sub && s.sub !== s.title) { const sm = document.createElement("small"); sm.textContent = s.sub; t.appendChild(sm); }
      row.querySelector('[data-a="up"]').disabled = i === 0;
      row.querySelector('[data-a="down"]').disabled = i === this._items.length - 1;
      row.querySelector(".sv-item-head").addEventListener("click", (e) => {
        const a = e.target.closest("[data-a]")?.dataset.a;
        if (!a) return;
        if (a === "up" && i > 0) [this._items[i - 1], this._items[i]] = [this._items[i], this._items[i - 1]];
        else if (a === "down" && i < this._items.length - 1) [this._items[i + 1], this._items[i]] = [this._items[i], this._items[i + 1]];
        else if (a === "remove") { this._items.splice(i, 1); if (this._openIdx === i) this._openIdx = -1; }
        else if (a === "edit") { this._openIdx = this._openIdx === i ? -1 : i; this._render(); return; }
        this._emit();
      });
      if (spec.item && this._openIdx === i) {
        const body = document.createElement("div");
        body.className = "sv-item-body";
        const form = document.createElement("ha-form");
        const obj = typeof item === "string" ? { entity: item } : item;
        form.schema = spec.item;
        form.data = obj;
        form.hass = this._hass;
        form.computeLabel = (sch) => sch.label || title(sch.name);
        form.addEventListener("value-changed", (e) => {
          e.stopPropagation();
          this._items[i] = cleanConfig(e.detail.value);
          this.dispatchEvent(new CustomEvent("list-changed", { detail: { items: [...this._items] }, bubbles: true, composed: true }));
        });
        body.appendChild(form);
        row.appendChild(body);
      }
      list.appendChild(row);
    });
    // add: an entity picker (or whatever selector the spec asks for)
    const add = root.querySelector(".sv-add");
    const picker = document.createElement("ha-selector");
    picker.hass = this._hass;
    picker.selector = spec.add?.selector || { entity: {} };
    picker.label = spec.add?.label || "Add";
    picker.value = "";
    picker.addEventListener("value-changed", (e) => {
      const v = e.detail.value;
      if (!v) return;
      this._items.push(spec.add?.make ? spec.add.make(v) : (spec.item ? { entity: v } : v));
      this._emit();
    });
    add.appendChild(picker);
  }
}
if (!customElements.get("savvy-list-editor")) customElements.define("savvy-list-editor", SavvyListEditor);

// Defines `<type>-editor` for a card from a schema function.
const defineEditor = (type, schemaFn) => {
  const name = `${type}-editor`;
  if (!customElements.get(name)) {
    customElements.define(name, class extends SavvyEditor { schema(hass, config) { return schemaFn(hass, config); } });
  }
  return name;
};

// Schema snippets every card reuses.
const S = {
  area: (name = "area", label = "Area") => ({ name, label, selector: { area: {} } }),
  entity: (name, label, domain, extra = {}) => ({ name, label, selector: { entity: domain ? { domain } : {} }, ...extra }),
  bool: (name, label, helper) => ({ name, label, helper, selector: { boolean: {} } }),
  text: (name, label, helper) => ({ name, label, helper, selector: { text: {} } }),
  icon: (name = "icon", label = "Icon") => ({ name, label, selector: { icon: {} } }),
  number: (name, label, min, max, step = 1, unit) => ({ name, label, selector: { number: { min, max, step, mode: "box", unit_of_measurement: unit } } }),
  select: (name, label, options) => ({ name, label, selector: { select: { mode: "dropdown", options } } }),
  action: (name, label) => ({ name, label, selector: { ui_action: {} } }),
  color: (name = "color", label = "Colour") => ({ name, label, selector: { text: {} }, helper: "An HA colour name (blue, amber…) or a hex like #F5B83D" }),
  grid: (...schema) => ({ type: "grid", name: "", schema }),
  section: (label, schema, expanded = false) => ({ type: "expandable", name: "", title: label, expanded, schema }),
  // the one chip spec, as a list editor
  chips: (name = "chips", label = "Chips", helper = "Extra entities shown as chips, each with its own actions.") => ({
    name, label, helper, type: "list",
    item: [
      { name: "entity", label: "Entity", selector: { entity: {} } },
      { type: "grid", name: "", schema: [
        { name: "name", label: "Name", selector: { text: {} } },
        { name: "icon", label: "Icon", selector: { icon: {} } },
      ] },
      { name: "color", label: "Colour", selector: { text: {} } },
      { name: "show_state", label: "Show state", selector: { boolean: {} } },
      { name: "tap_action", label: "Tap", selector: { ui_action: {} } },
      { name: "hold_action", label: "Hold", selector: { ui_action: {} } },
    ],
  }),
};

// ===== core/99-test-hook.js =====
// ---------------------------------------------------------------------------------------
// core/test-hook: test pages set window.__SAVVY_TEST__ before loading the bundle to reach
// core functions directly. Real dashboards never set it, so nothing is exposed there.
// ---------------------------------------------------------------------------------------
if (window.__SAVVY_TEST__) {
  window.__savvy = {
    Spring, Clock, MOTION, norm, title, modeLook, MODE_DICTIONARY, colorOf,
    healthSummary, healthOptions, areaEntities, houseEntities, pick, rankBy, entityArea, shortName, asItems,
    isActive, isOff, runAction, defaultTapAction, toggleEntity, bindPress, bindActions,
    duration, since, relativeTime, axisLabel, momentLabel, fmtNumber, withUnit, isTimestamp,
    fetchHistory, fetchRange, fetchAttributeHistory, resample, seriesStats, stateRuns, numericPoints, linePath,
    Sheet, EntityListSheet, SavvyEditor, defineEditor, S, version: SAVVY_VERSION,
  };
}

console.info(`%c SAVVY CARDS %c ${SAVVY_VERSION} `, "color:#fff;background:#588ee9;font-weight:700;border-radius:4px 0 0 4px;padding:2px 4px",
  "color:#588ee9;background:transparent;border:1px solid #588ee9;border-radius:0 4px 4px 0;padding:1px 4px");
})();
