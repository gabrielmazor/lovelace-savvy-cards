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

// ===== cards/health.js =====
(() => {
// savvy-health-card: what in the house needs attention, with a count pill.
//
// By default it lists everything (source: all), grouped: Watchman issues (when its sensors
// are given), unavailable entities, low batteries. Or one source on its own. The pill's
// number is exactly what savvy-home-card's cog shows: both read core/health.
//
//   type: custom:savvy-health-card
//   source: all | watchman | unavailable | battery
//   battery_threshold: 20        exclude_platforms: [mobile_app]
//   watchman: [sensor.watchman_missing_entities, sensor.watchman_missing_actions]
//   warn_above: 6  max_rows: 7   title: …
//   action: { label: Generate report, tap_action: { action: perform-action, perform_action: watchman.report } }

const SOURCES = {
  all: { title: "Health", noun: "ISSUE", nouns: "ISSUES" },
  watchman: { title: "Watchman report", noun: "ISSUE", nouns: "ISSUES" },
  unavailable: { title: "Unavailable", noun: "UNAVAILABLE", nouns: "UNAVAILABLE" },
  battery: { title: "Batteries", noun: "LOW", nouns: "LOW" },
};
const GROUP_TITLE = { watchman: "Watchman", unavailable: "Unavailable", battery: "Low batteries" };

const STYLE = `${BASE_CSS}
  ha-card { display: flex; flex-direction: column; gap: 10px; padding: var(--pad); overflow: hidden; --lvl: var(--secondary-text-color); }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .name { font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pill { flex: none; display: inline-flex; align-items: center; height: 22px; padding: 0 9px; border-radius: 11px;
    background: color-mix(in oklab, var(--lvl) 16%, transparent); color: color-mix(in oklab, var(--lvl) 78%, var(--primary-text-color));
    font-size: 11px; line-height: 14px; font-weight: 650; letter-spacing: 0.02em; white-space: nowrap; text-transform: uppercase; }
  .empty { display: flex; align-items: center; gap: 8px; padding: 2px 0; color: var(--secondary-text-color); font-size: 12.5px; line-height: 16px; font-weight: 500; }
  .empty ha-icon { --mdc-icon-size: 17px; display: flex; color: var(--lvl-good); }
  .rows { display: flex; flex-direction: column; max-height: calc(var(--max-rows, 7) * 38px); overflow-y: auto; overscroll-behavior-y: contain;
    scrollbar-width: none; margin: 0 -4px; padding: 0 4px; }
  .rows::-webkit-scrollbar { display: none; }
  .rows[data-overflow] { -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 22px), transparent 100%);
    mask-image: linear-gradient(to bottom, #000 calc(100% - 22px), transparent 100%); }
  .group { flex: none; margin: 8px 4px 2px; font-size: 11px; line-height: 14px; font-weight: 650; letter-spacing: 0.04em;
    text-transform: uppercase; color: var(--secondary-text-color); }
  .group:first-child { margin-top: 0; }
  .row { flex: none; display: flex; align-items: center; gap: 9px; min-height: 38px; padding: 3px 4px; border-radius: 10px; text-align: start; transform-origin: 0 50%; }
  .row[role="button"] { cursor: pointer; }
  .row[data-group-start] { border-top: 1px solid var(--line); margin-top: 2px; padding-top: 5px; }
  .row[data-dim] { opacity: 0.55; }
  .row .disc { flex: none; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--well); color: var(--secondary-text-color); }
  .row .disc ha-icon { --mdc-icon-size: 15px; display: flex; }
  .row[data-alert] .disc { background: color-mix(in oklab, var(--lvl-bad) 18%, transparent); color: var(--lvl-bad); }
  .row .col { min-width: 0; flex: 1; display: flex; flex-direction: column; }
  .row .n { font-size: 12.5px; line-height: 16px; font-weight: 600; letter-spacing: -0.006em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .s { font-size: 10.5px; line-height: 13px; font-weight: 500; letter-spacing: 0.006em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .v { flex: none; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--secondary-text-color); }
  .action { flex: none; display: flex; align-items: center; justify-content: center; gap: 6px; height: 34px; margin-top: 2px; border-radius: 11px;
    background: color-mix(in oklab, rgb(var(--accent)) 16%, transparent); color: rgb(var(--accent));
    font-size: 12.5px; line-height: 16px; font-weight: 650; letter-spacing: -0.006em; transform-origin: 50% 50%; }
  @media (prefers-contrast: more) { .row .s { color: var(--primary-text-color); opacity: 0.8; } }
  @container (max-width: 260px) { .row .s { display: none; } }
`;

class SavvyHealthCard extends HTMLElement {
  static getStubConfig() { return {}; }
  static getConfigElement() { return document.createElement(EDITOR); }

  constructor() {
    super();
    watchKeyboard(this);
    this._job = (now, dt) => this._frame(dt);
    this._rows = new Map();
  }

  setConfig(config) {
    const source = config?.source || "all";
    if (!SOURCES[source]) throw new Error(`savvy-health-card: "source" must be one of ${Object.keys(SOURCES).join(", ")}`);
    // the pre-Savvy names still work: threshold, and entities for the watchman source
    const watchman = config.watchman ?? (source === "watchman" ? config.entities : undefined);
    if (source === "watchman" && !(watchman || []).length) throw new Error('savvy-health-card: the "watchman" source needs its sensors in "watchman"');
    this._config = { warn_above: 6, max_rows: 7, ...config, source,
      battery_threshold: config.battery_threshold ?? config.threshold, watchman };
    if (this._root) { this._build(); if (this._hass) this._update(); }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._root) this._build();
    this._update();
  }

  connectedCallback() { this._wake(); }
  disconnectedCallback() { Clock.remove(this._job); this._ro?.disconnect(); }
  getCardSize() { return 3; }
  getGridOptions() { return { columns: 6, min_columns: 4, rows: "auto" }; }

  _build() {
    this._root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._springs = [];
    this._pressNodes = [];
    this._rows.clear();
    this._root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="head"><span class="name" id="name"></span><span class="pill" id="pill"></span></div>
        <div class="empty" id="empty" hidden><ha-icon icon="mdi:check-circle-outline"></ha-icon><span>All good</span></div>
        <div class="rows" id="rows"></div>
        <button class="action" id="action" hidden></button>
      </ha-card>`;
    const $ = (id) => this._root.getElementById(id);
    this._el = { card: this._root.querySelector("ha-card"), name: $("name"), pill: $("pill"), empty: $("empty"), rows: $("rows"), action: $("action") };
    const c = this._config;
    put(this._el.rows, "--max-rows", c.max_rows);
    text(this._el.name, c.title || SOURCES[c.source].title);
    if (c.action) {
      this._el.action.hidden = false;
      text(this._el.action, c.action.label || "Run");
      this._pressable(this._el.action, () => {
        const a = c.action;
        // the pre-Savvy shape { label, service, data, target } still works
        const act = a.tap_action || (a.service ? { action: "perform-action", perform_action: a.service, data: a.data, target: a.target } : null);
        haptic("medium");
        runAction(this, this._hass, act, {});
      });
    }
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => this._fit());
    this._ro.observe(this._el.rows);
  }

  _pressable(el, onTap) {
    const spring = new Spring(0, MOTION.press, `p${this._springs.length}`);
    this._springs.push(spring);
    this._pressNodes.push(el);
    el.__spring = spring;
    bindPress(el, { spring, wake: () => this._wake(), onTap, haptic: null });
  }

  // The rows for this card's source; the pill counts exactly what the home cog counts.
  _compute() {
    const c = this._config, sum = healthSummary(this._hass, c);
    const src = c.source;
    if (src === "watchman") return { total: sum.counts.watchman, rows: sum.watchman };
    if (src === "unavailable") return { total: sum.counts.unavailable, rows: sum.unavailable };
    if (src === "battery") return { total: sum.counts.battery, rows: c.show_all_batteries === false ? sum.battery.filter((r) => r.alert) : sum.battery };
    const rows = [];
    for (const key of ["watchman", "unavailable", "battery"]) {
      const list = key === "battery" ? sum.battery.filter((r) => r.alert) : sum[key];
      if (!list.length) continue;
      rows.push({ key: `g:${key}`, group: `${GROUP_TITLE[key]} · ${sum.counts[key]}` });
      rows.push(...list.map((r) => ({ ...r, groupStart: false, dim: false })));
    }
    return { total: sum.total, rows };
  }

  _update() {
    const h = this._hass, c = this._config;
    if (!h || !this._root) return;
    this._reduced = MQ.reduced.matches;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    const { total, rows } = this._compute();
    const label = SOURCES[c.source];
    const lvl = total === 0 ? "var(--lvl-good)" : total < c.warn_above ? "var(--lvl-warn)" : "var(--lvl-bad)";
    put(this._el.card, "--lvl", lvl);
    text(this._el.pill, total === 0 ? "All good" : `${total} ${total === 1 ? label.noun : label.nouns}`);
    attr(this._el.card, "aria-label", `${c.title || label.title}, ${total === 0 ? "all good" : `${total} ${label.nouns.toLowerCase()}`}`);
    this._el.empty.hidden = rows.length > 0;
    this._el.rows.hidden = rows.length === 0;
    this._renderRows(rows);
    this._wake();
  }

  _renderRows(rows) {
    const box = this._el.rows, seen = new Set();
    for (const r of rows) {
      seen.add(r.key);
      let node = this._rows.get(r.key);
      if (!node) {
        node = document.createElement("div");
        if (r.group) node.className = "group";
        else {
          node.className = "row";
          node.innerHTML = `<span class="disc"><ha-icon></ha-icon></span><span class="col"><span class="n"></span><span class="s"></span></span><span class="v" hidden></span>`;
          node.__el = { icon: node.querySelector("ha-icon"), n: node.querySelector(".n"), s: node.querySelector(".s"), v: node.querySelector(".v") };
          node.__enter = new Spring(0, MOTION.ui, `row:${r.key}`).to(1, MOTION.ui);
          this._springs.push(node.__enter);
        }
        this._rows.set(r.key, node);
      }
      if (r.group) { text(node, r.group); box.appendChild(node); continue; }
      attr(node.__el.icon, "icon", r.icon);
      text(node.__el.n, r.name);
      text(node.__el.s, r.secondary || "");
      node.__el.s.hidden = !r.secondary;
      node.__el.v.hidden = !r.value;
      if (r.value) text(node.__el.v, r.value);
      attr(node, "title", r.tooltip || null);
      attr(node, "data-alert", r.alert);
      attr(node, "data-dim", r.dim);
      attr(node, "data-group-start", r.groupStart);
      if (r.entity && this._hass.states[r.entity] && !node.__wired) {
        node.__wired = true;
        attr(node, "role", "button");
        attr(node, "tabindex", "0");
        this._pressable(node, () => moreInfo(this, r.entity));
      }
      box.appendChild(node);
    }
    for (const [key, node] of this._rows) {
      if (seen.has(key)) continue;
      for (const s of [node.__enter, node.__spring]) { const i = this._springs.indexOf(s); if (i >= 0) this._springs.splice(i, 1); }
      const p = this._pressNodes.indexOf(node);
      if (p >= 0) this._pressNodes.splice(p, 1);
      node.remove();
      this._rows.delete(key);
    }
    this._fit();
  }

  _fit() {
    const el = this._el?.rows;
    if (el) attr(el, "data-overflow", el.scrollHeight > el.clientHeight + 1);
  }

  _wake() { if (this._root && this.isConnected) Clock.add(this._job); }

  _frame(dt) {
    const dirty = new Set();
    for (const s of this._springs) {
      if (s.idle) continue;
      if (this._reduced) s.snap(); else s.step(dt);
      dirty.add(s.group);
    }
    if (!dirty.size) return false;
    this._paint(dirty);
    return true;
  }

  _paint(dirty) {
    const red = this._reduced;
    for (const node of this._pressNodes) {
      const s = node.__spring;
      if (!s || !dirty.has(s.group)) continue;
      const p = s.x;
      put(node, "transform", red || Math.abs(p) < 1e-4 ? "" : `scale(${(1 - 0.04 * p).toFixed(4)})`);
      put(node, "opacity", Math.abs(p) > 1e-3 ? (1 - (red ? 0.2 : 0.1) * clamp(p)).toFixed(3) : "");
    }
    for (const [key, node] of this._rows) {
      const s = node.__enter;
      if (!s || !dirty.has(`row:${key}`)) continue;
      const v = clamp(s.x);
      put(node, "opacity", v > 0.999 ? "" : v.toFixed(3));
      put(node, "translate", red || v > 0.999 ? "" : `0 ${((1 - v) * 4).toFixed(2)}px`);
    }
  }
}

const EDITOR = defineEditor("savvy-health-card", (hass, c) => [
  S.select("source", "What to list", [
    { value: "all", label: "Everything (Watchman, unavailable, low batteries)" },
    { value: "battery", label: "Batteries" }, { value: "unavailable", label: "Unavailable entities" }, { value: "watchman", label: "Watchman report" },
  ]),
  S.text("title", "Title"),
  S.grid(S.number("battery_threshold", "Low battery below", 1, 100, 1, "%"), S.number("warn_above", "Red from", 1, 99)),
  S.number("max_rows", "Rows before scrolling", 3, 30),
  { name: "exclude_platforms", label: "Ignore integrations", helper: "By integration, e.g. mobile_app for phones.",
    selector: { select: { multiple: true, custom_value: true, options: ["mobile_app"] } } },
  { name: "watchman", label: "Watchman sensors", helper: "Watchman's missing-entities and missing-actions sensors.",
    selector: { entity: { multiple: true, domain: "sensor" } } },
  ...(c.source === "battery" ? [S.bool("show_all_batteries", "Show every battery", "Low ones first, the rest dimmed.")] : []),
  // nested under `action`: ha-form's expandable with a name keeps its fields in that key
  { type: "expandable", name: "action", title: "Footer button", schema: [
    { name: "label", label: "Label", selector: { text: {} } },
    { name: "tap_action", label: "When pressed", selector: { ui_action: {} } },
  ] },
]);

registerCard("savvy-health-card", SavvyHealthCard, "Health",
  "What needs attention: unavailable entities, low batteries and Watchman issues, with a count.");
})();

// ===== cards/vacuum.js =====
(() => {
// savvy-vacuum-card: any robot vacuum, deepest for Roborock. Everything is discovered from
// the vacuum's device by translation_key: live job, map, rooms (cleaned in the order you
// pick), app routines, modes, dock and consumables. `layout: compact` is one row: battery
// ring, status and a start/pause button (hold it to send the vacuum home).
//
//   type: custom:savvy-vacuum-card
//   entity: vacuum.robot            (the only required key)


const PREDICT_MS = 5000;
const TICK_MS = 30000;

const MOTION = {
  press:    { response: 0.12, damping: 1 },
  release:  { response: 0.3,  damping: 0.82 },
  hold:     { response: 0.5,  damping: 1 },
  pop:      { response: 0.34, damping: 0.58 },
  ui:       { response: 0.4,  damping: 1 },
  text:     { response: 0.5,  damping: 1 },
  ring:     { response: 0.7,  damping: 1 },
  sheetIn:  { response: 0.38, damping: 0.82 },
  sheetOut: { response: 0.24, damping: 1 },
};

const COLORS = { accent: "#5BA3D9", warn: "#E8A33D", alert: "#E06666", good: "#4CAF50" };

// ---------- what the device's entities mean (translation_key, or the id suffix) ----------
const ONE = {
  status: ["sensor", "status"], battery: ["sensor", "battery"], charging: ["binary_sensor", "charging"],
  progress: ["sensor", "clean_percent"], cleanTime: ["sensor", "cleaning_time"], cleanArea: ["sensor", "cleaning_area"],
  vacError: ["sensor", "vacuum_error"], dockError: ["sensor", "dock_error"],
  lastStart: ["sensor", "last_clean_start"], lastEnd: ["sensor", "last_clean_end"],
  totalTime: ["sensor", "total_cleaning_time"], totalArea: ["sensor", "total_cleaning_area"], totalCount: ["sensor", "total_cleaning_count"],
  mopDryLeft: ["sensor", "mop_drying_remaining_time"], selectedMap: ["select", "selected_map"],
};
// binary "problem" sensors: on = needs attention
const ALERTS = {
  water_shortage: ["Water shortage", "mdi:water-off"],
  clean_box_empty: ["Clean water tank empty", "mdi:water-remove-outline"],
  dirty_box_full: ["Dirty water tank full", "mdi:water-alert"],
  clean_fluid_empty: ["Cleaning fluid empty", "mdi:bottle-tonic-outline"],
  detergent_empty: ["Detergent empty", "mdi:bottle-tonic-outline"],
  softener_empty: ["Softener empty", "mdi:bottle-tonic-outline"],
};
// readouts about the dock and what's attached
const DOCK_INFO = {
  mop_attached: ["Mop", "mdi:water", "Attached", "Detached"],
  water_box_attached: ["Water tank", "mdi:cup-water", "Attached", "Detached"],
  mop_drying_status: ["Mop drying", "mdi:fan", "Drying", "Idle"],
};
// dock switches that *do* something (empty, wash, dry); settings switches go under Care
const DOCK_ACTIONS = {
  dust_emptying: ["Empty bin", "mdi:delete-empty"],
  mop_washing: ["Wash mop", "mdi:water-sync"],
  mop_drying: ["Dry mop", "mdi:fan"],
};
const SETTINGS = {
  dnd_switch: ["Do not disturb", "mdi:minus-circle-outline"],
  child_lock: ["Child lock", "mdi:lock-outline"],
  status_indicator: ["Status light", "mdi:led-on"],
};
// rated life in hours: Roborock's published defaults, overridable per part in config
const CONSUMABLES = {
  main_brush_time_left: ["Main brush", 300, "mdi:brush"],
  side_brush_time_left: ["Side brush", 200, "mdi:broom"],
  filter_time_left: ["Filter", 150, "mdi:air-filter"],
  sensor_time_left: ["Sensors", 30, "mdi:eye-outline"],
  strainer_time_left: ["Dock strainer", 150, "mdi:filter-outline"],
  cleaning_brush_time_left: ["Dock brush", 300, "mdi:brush"],
};
const MODE_ICONS = {
  fan_speed: "mdi:fan", mop_mode: "mdi:water-sync", mop_intensity: "mdi:water", water_box_mode: "mdi:water",
  water_flow: "mdi:water", dust_collection_mode: "mdi:delete-empty", cleaning_route: "mdi:routes", cleaning_mode: "mdi:broom",
};
const MODE_NAMES = {
  fan_speed: "Suction", mop_mode: "Mop route", mop_intensity: "Water", water_box_mode: "Water", water_flow: "Water",
  dust_collection_mode: "Auto-empty", cleaning_route: "Route", cleaning_mode: "Mode",
};
const FEAT = { PAUSE: 4, STOP: 8, RETURN_HOME: 16, FAN_SPEED: 32, LOCATE: 512, CLEAN_SPOT: 1024, START: 8192, CLEAN_AREA: 16384 };
const NO_ERROR = new Set(["none", "ok", "no_error", "normal", "0", "unknown", "unavailable", ""]);

const num = (st) => (st && !isOff(st) ? parseFloat(st.state) : NaN);

// a duration sensor's value in hours, whatever unit HA shows it in
const toHours = (st) => {
  const v = num(st);
  if (!Number.isFinite(v)) return NaN;
  const u = String(st.attributes.unit_of_measurement || "h").toLowerCase();
  if (u === "s") return v / 3600;
  if (u === "min") return v / 60;
  if (u === "d") return v * 24;
  return v;
};
const toSeconds = (st) => toHours(st) * 3600;
const hm = (sec) => {
  if (!Number.isFinite(sec)) return "—";
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
};
const hoursLeft = (h) => {
  if (!Number.isFinite(h)) return "—";
  if (h <= 0) return "Replace";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min left`;
  if (h < 48) return `${Math.round(h)} h left`;
  return `${Math.round(h / 24)} d left`;
};
const dayTime = (t, lang) => {
  const d = new Date(t), now = new Date();
  const hm2 = d.toLocaleTimeString(lang || undefined, { hour: "2-digit", minute: "2-digit" });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return `Today ${hm2}`;
  if (d.toDateString() === y.toDateString()) return `Yesterday ${hm2}`;
  return `${d.toLocaleDateString(lang || undefined, { weekday: "short", day: "numeric", month: "short" })} ${hm2}`;
};
// a routine's icon from its name: mop, vacuum, both, deep, quick
const routineIcon = (name) => {
  const n = String(name).toLowerCase();
  const vac = /vac|sweep|suck/.test(n), mop = /mop|wash|wet/.test(n);
  if (vac && mop) return "mdi:robot-vacuum-variant";
  if (/deep|intens/.test(n) && mop) return "mdi:water-plus";
  if (mop) return "mdi:water";
  if (/quick|fast|express/.test(n)) return "mdi:lightning-bolt";
  if (vac) return "mdi:robot-vacuum";
  return "mdi:play-circle-outline";
};

const STYLE = `
/* tokens live on :host, not ha-card: the popup renders outside ha-card and must
   inherit the same palette */
:host {
  display: block; -webkit-tap-highlight-color: transparent;
  --radius: var(--ha-card-border-radius, 18px);
  --well: color-mix(in oklab, var(--primary-text-color) 6%, transparent);
  --line: color-mix(in oklab, var(--primary-text-color) 9%, transparent);
  --acc: var(--savvy-vacuum-accent, ${COLORS.accent});
  --warn-c: ${COLORS.warn};
  --alert-c: ${COLORS.alert};
  --accent: 91 163 217;
}
[hidden] { display: none !important; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; }

ha-card {
  --radius: var(--ha-card-border-radius, 18px);
  --pad: 14px;
  --well: color-mix(in oklab, var(--primary-text-color) 6%, transparent);
  --line: color-mix(in oklab, var(--primary-text-color) 9%, transparent);
  --acc: var(--savvy-vacuum-accent, ${COLORS.accent});
  --warn-c: ${COLORS.warn};
  --alert-c: ${COLORS.alert};
  --accent: 91 163 217;
  position: relative; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 12px;
  padding: var(--pad);
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
:host([compact]) ha-card { --pad: 12px; gap: 8px; }
@supports (corner-shape: squircle) {
  ha-card { corner-shape: squircle; border-radius: calc(var(--radius) * 1.7); }
}
:host([dark]) ha-card::after {
  content: ""; position: absolute; inset: 0; z-index: 9; border-radius: inherit; corner-shape: inherit;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.05); pointer-events: none;
}
ha-icon, ha-state-icon { display: flex; align-items: center; justify-content: center; line-height: 0; }

.cap { font-size: 11px; line-height: 13px; font-weight: 650; letter-spacing: 0.05em; text-transform: uppercase; color: var(--secondary-text-color); }
.sec { display: flex; flex-direction: column; gap: 8px; }
.sec-head { display: flex; align-items: center; gap: 8px; min-height: 16px; }
.sec-head .cap { flex: 1; }
.sec-head .aside { font-size: 12px; line-height: 16px; font-weight: 500; color: var(--secondary-text-color); }

/* ---------- alert banner ---------- */
.banner {
  --c: var(--alert-c);
  display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 13px;
  background: color-mix(in oklab, var(--c) 15%, transparent); color: var(--c);
  --mdc-icon-size: 20px; cursor: pointer; transform-origin: 50% 50%;
}
.banner[data-level="warn"] { --c: var(--warn-c); }
.banner .bt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.banner .b1 { font-size: 14px; line-height: 17px; font-weight: 650; letter-spacing: -0.012em; }
.banner .b2 { font-size: 12px; line-height: 16px; font-weight: 500; opacity: 0.85; }

/* ---------- hero ---------- */
.hero { display: flex; align-items: center; gap: 14px; min-width: 0; }
:host([compact]) .hero { gap: 11px; }
.ring { position: relative; flex: none; width: 64px; height: 64px; cursor: pointer; }
:host([compact]) .ring { width: 46px; height: 46px; }
.ring > svg { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
.ring .track { fill: none; stroke: var(--well); stroke-width: 3.2; }
.ring .fill { fill: none; stroke: var(--ring-c, var(--acc)); stroke-width: 3.2; stroke-linecap: round; }
.ring .bot {
  position: absolute; inset: 7px; border-radius: 50%; display: grid; place-items: center;
  --mdc-icon-size: 28px; color: color-mix(in oklab, var(--acc) calc(var(--act, 0) * 100%), var(--primary-text-color));
  background: color-mix(in oklab, var(--acc) calc(var(--act, 0) * 14%), var(--well));
}
:host([compact]) .ring .bot { inset: 5px; --mdc-icon-size: 20px; }
.ring .bolt {
  position: absolute; right: -2px; bottom: -2px; width: 20px; height: 20px; border-radius: 50%;
  display: grid; place-items: center; --mdc-icon-size: 13px; color: var(--acc);
  background: var(--card-background-color, #fff); box-shadow: 0 0 0 1.5px var(--card-background-color, #fff), inset 0 0 0 20px var(--well);
}
:host([compact]) .ring .bolt { width: 17px; height: 17px; --mdc-icon-size: 11px; }
.who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; cursor: pointer; }
.name { font-size: 18px; line-height: 23px; font-weight: 650; letter-spacing: -0.022em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
:host([compact]) .name { font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; }
.status { display: flex; gap: 5px; min-width: 0; font-size: 13px; line-height: 17px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; }
:host([compact]) .status { font-size: 12.5px; line-height: 16px; }
.status .s1 { font-weight: 600; color: var(--primary-text-color); overflow: hidden; text-overflow: ellipsis; }
.status .s2 { overflow: hidden; text-overflow: ellipsis; }
.status .s2:empty { display: none; }
.status .s2::before { content: "· "; }
.status[data-level="alert"] .s1 { color: var(--alert-c); }
.status[data-level="warn"] .s1 { color: var(--warn-c); }
.meta { display: flex; gap: 5px; min-width: 0; font-size: 12px; line-height: 16px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; }
.meta .batt { font-weight: 650; flex: none; }
.meta .batt[data-level="warn"] { color: var(--warn-c); }
.meta .batt[data-level="alert"] { color: var(--alert-c); }
.meta .stats { overflow: hidden; text-overflow: ellipsis; }
.meta .stats:empty { display: none; }
.meta .batt:not(:empty) + .stats:not(:empty)::before { content: "· "; }

.prog { height: 4px; border-radius: 2px; background: var(--well); overflow: hidden; }
.prog i { display: block; height: 100%; width: 100%; background: var(--acc); border-radius: inherit; transform-origin: 0 50%; }
:host([compact]) .prog { height: 3px; margin-top: -2px; }

/* ---------- buttons ---------- */
.primary {
  --hold: 0;
  position: relative; overflow: hidden; flex: none; height: 38px; padding: 0 16px 0 12px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center; gap: 7px;
  background: var(--acc); color: #fff; --mdc-icon-size: 19px;
  font-size: 13.5px; line-height: 16px; font-weight: 650; letter-spacing: -0.008em; white-space: nowrap;
  transform-origin: 50% 50%;
}
.primary::before { content: ""; position: absolute; inset: 0; background: rgb(255 255 255 / 0.22); transform-origin: 0 50%; transform: scaleX(var(--hold)); pointer-events: none; }
.primary > * { position: relative; }
.primary[data-kind="quiet"] { background: var(--well); color: var(--primary-text-color); }
.primary[data-kind="quiet"]::before { background: color-mix(in oklab, var(--primary-text-color) 10%, transparent); }
.primary[disabled] { opacity: 0.45; cursor: default; }
:host([compact]) .primary { height: 34px; padding: 0 13px 0 10px; font-size: 13px; }

.controls { display: flex; gap: 6px; }
.controls .primary { flex: 1 1 auto; }
.ctl {
  --hold: 0;
  position: relative; overflow: hidden; flex: none; width: 44px; height: 38px; border-radius: 12px;
  display: grid; place-items: center; background: var(--well); --mdc-icon-size: 20px; transform-origin: 50% 50%;
}
.ctl::before { content: ""; position: absolute; inset: 0; background: color-mix(in oklab, var(--alert-c) 30%, transparent); transform-origin: 0 50%; transform: scaleX(var(--hold)); pointer-events: none; }
.ctl > * { position: relative; }
.ctl[disabled] { opacity: 0.35; cursor: default; }

/* ---------- map ---------- */
.map { position: relative; border-radius: 14px; overflow: hidden; background: var(--well); cursor: zoom-in; transform-origin: 50% 50%; }
.map img { display: block; width: 100%; height: auto; max-height: var(--map-max, 420px); object-fit: contain; }
.map .none { padding: 30px 12px; text-align: center; font-size: 12px; color: var(--secondary-text-color); }

/* ---------- chips (rooms, maps, dock actions, settings) ---------- */
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  --on: 0; --c: var(--acc);
  position: relative; display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px 0 9px; border-radius: 11px;
  background: color-mix(in oklab, var(--c) calc(var(--on) * 16%), var(--well));
  font-size: 12.5px; line-height: 16px; font-weight: 600; letter-spacing: -0.006em; white-space: nowrap;
  color: color-mix(in oklab, var(--primary-text-color) calc(62% + var(--on) * 38%), transparent);
  --mdc-icon-size: 17px; transform-origin: 50% 50%;
}
.chip ha-icon { color: color-mix(in oklab, var(--c) calc(var(--on) * 100%), var(--secondary-text-color)); }
.chip .ord {
  min-width: 18px; height: 18px; border-radius: 9px; display: grid; place-items: center; margin-inline-start: -2px;
  font-size: 11px; font-weight: 700; color: #fff; background: var(--c);
}
.chip[data-off] { opacity: 0.45; }
.rooms-go { display: flex; gap: 6px; align-items: center; }
.rooms-go .primary { flex: 1; }
.rooms-go .clear { height: 38px; padding: 0 12px; border-radius: 12px; background: var(--well); font-size: 13px; font-weight: 600; transform-origin: 50% 50%; }
.hint { font-size: 12px; line-height: 16px; font-weight: 500; color: var(--secondary-text-color); }

/* ---------- routines: one row, masked when it overflows ---------- */
.routines {
  display: flex; gap: 6px; min-width: 0; overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain;
  padding: 3px; margin: -3px;
}
.routines::-webkit-scrollbar { display: none; }
.routines[data-overflow] { mask-image: linear-gradient(to left, transparent 0, #000 26px); -webkit-mask-image: linear-gradient(to left, transparent 0, #000 26px); }
.rt {
  --on: 0;
  flex: 1 0 auto; display: flex; align-items: center; justify-content: center; gap: 7px; height: 38px; padding: 0 13px 0 10px; border-radius: 12px;
  background: color-mix(in oklab, var(--acc) calc(var(--on) * 18%), var(--well)); white-space: nowrap; transform-origin: 50% 50%;
  font-size: 13px; line-height: 16px; font-weight: 600; letter-spacing: -0.006em; --mdc-icon-size: 18px;
}
.rt ha-icon { color: var(--acc); }
.rt[data-off] { opacity: 0.45; }

/* ---------- summary tiles: each opens its popup ---------- */
.hub { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
@container (min-width: 640px) { .hub { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
#inlineMap:empty { display: none; }
.tile {
  display: flex; align-items: center; gap: 9px; padding: 9px 10px; border-radius: 13px; background: var(--well); text-align: start;
  min-width: 0; --mdc-icon-size: 18px; transform-origin: 50% 50%;
}
.tile > ha-icon { flex: none; width: 30px; height: 30px; border-radius: 10px; background: color-mix(in oklab, var(--primary-text-color) 7%, transparent); color: var(--secondary-text-color); }
.tile .tt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.tile .tc { font-size: 11px; line-height: 13px; font-weight: 550; color: var(--secondary-text-color); }
.tile .tv { font-size: 13px; line-height: 17px; font-weight: 650; letter-spacing: -0.008em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tile[data-level="warn"] > ha-icon { background: color-mix(in oklab, var(--warn-c) 18%, transparent); color: var(--warn-c); }
.tile[data-level="warn"] .tv { color: var(--warn-c); }
.tile[data-level="alert"] > ha-icon { background: color-mix(in oklab, var(--alert-c) 18%, transparent); color: var(--alert-c); }
.tile[data-level="alert"] .tv { color: var(--alert-c); }
.tile[data-level="accent"] > ha-icon { background: color-mix(in oklab, var(--acc) 18%, transparent); color: var(--acc); }

/* ---------- modes (in their popup): tap-once option chips ---------- */
.mgroups { display: flex; flex-direction: column; gap: 12px; }
.mgroup { display: flex; flex-direction: column; gap: 7px; }

/* ---------- dock readouts ---------- */
.dock { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 6px; }
.dk { --c: var(--primary-text-color); display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 12px; background: var(--well); min-width: 0; --mdc-icon-size: 17px; cursor: pointer; transform-origin: 50% 50%; }
.dk ha-icon { color: var(--secondary-text-color); flex: none; }
.dk .dt { display: flex; flex-direction: column; min-width: 0; }
.dk .dv { font-size: 13px; line-height: 16px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dk .dc { font-size: 11px; line-height: 13px; font-weight: 550; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dk[data-level="warn"] { background: color-mix(in oklab, var(--warn-c) 14%, transparent); }
.dk[data-level="warn"] ha-icon, .dk[data-level="warn"] .dv { color: var(--warn-c); }

/* ---------- maintenance ---------- */
.parts { display: flex; flex-direction: column; gap: 4px; }
.part { display: grid; grid-template-columns: auto 1fr auto; align-items: center; column-gap: 10px; row-gap: 5px; padding: 8px 10px; border-radius: 12px; background: var(--well); cursor: pointer; transform-origin: 50% 50%; }
.part ha-icon { --mdc-icon-size: 17px; color: var(--secondary-text-color); grid-row: span 2; }
.part .pn { font-size: 13px; line-height: 16px; font-weight: 600; }
.part .pl { font-size: 12px; line-height: 16px; font-weight: 600; color: var(--secondary-text-color); text-align: end; }
.part .pb { grid-column: 2 / 4; height: 4px; border-radius: 2px; background: color-mix(in oklab, var(--primary-text-color) 8%, transparent); overflow: hidden; }
.part .pb i { display: block; height: 100%; border-radius: inherit; background: color-mix(in oklab, var(--primary-text-color) 45%, transparent); transform-origin: 0 50%; }
.part[data-level="warn"] .pl { color: var(--warn-c); }
.part[data-level="warn"] .pb i { background: var(--warn-c); }
.part[data-level="alert"] .pl { color: var(--alert-c); }
.part[data-level="alert"] .pb i { background: var(--alert-c); }
.totals { display: flex; flex-wrap: wrap; gap: 4px 14px; padding: 2px 2px 0; font-size: 12px; line-height: 16px; font-weight: 500; color: var(--secondary-text-color); }
.totals b { font-weight: 650; color: var(--primary-text-color); }

/* ---------- popup (CARD-DESIGN.md 8): outside ha-card, position: fixed ---------- */
.dscrim { position: fixed; inset: 0; z-index: 998; background: rgb(0 0 0 / 0.45); opacity: 0; }
.dlg {
  position: fixed; z-index: 999; box-sizing: border-box; display: flex; flex-direction: column;
  left: 50%; top: 50%; width: min(460px, calc(100vw - 32px)); max-height: min(640px, calc(100vh - 48px));
  border-radius: 22px; overflow: hidden; opacity: 0;
  background: var(--ha-card-background, var(--card-background-color, #fff)); color: var(--primary-text-color);
  box-shadow: 0 18px 50px rgb(0 0 0 / 0.35), 0 0 0 0.5px var(--line);
  font-family: var(--savvy-font-family, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", Roboto, sans-serif);
  font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased;
}
@supports (corner-shape: squircle) { .dlg { corner-shape: squircle; border-radius: 36px; } }
/* phones: a bottom sheet you can reach with a thumb */
.dlg[data-sheet] { left: 0; right: 0; top: auto; bottom: 0; width: auto; max-height: 85vh; border-radius: 22px 22px 0 0; padding-bottom: env(safe-area-inset-bottom); }
.dlg .grab { align-self: center; width: 36px; height: 5px; border-radius: 3px; margin: 7px 0 -3px; background: color-mix(in oklab, var(--primary-text-color) 20%, transparent); }
.dlg:not([data-sheet]) .grab { display: none; }
.dh { display: flex; align-items: center; gap: 8px; padding: 14px 12px 8px 18px; }
.dh .dt { flex: 1; font-size: 18px; line-height: 23px; font-weight: 650; letter-spacing: -0.022em; }
.dh .dx { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: var(--well); --mdc-icon-size: 18px; transform-origin: 50% 50%; }
.db { overflow: auto; overscroll-behavior: contain; padding: 4px 18px 18px; display: flex; flex-direction: column; gap: 12px; }
.db .map img { max-height: 70vh; }

:host(:not([kbd])) :focus { outline: none; }
:host([kbd]) :focus-visible { outline: 2px solid rgb(var(--accent)); outline-offset: 2px; }
@media (prefers-contrast: more) {
  ha-card { border-width: 1.5px; }
  .status, .meta, .cap, .hint, .totals, .tile .tc, .dk .dc { color: var(--primary-text-color); opacity: 0.85; }
}
@media (prefers-reduced-motion: reduce) { ha-card { transition: none; } }

@container (max-width: 340px) {
  .ring { width: 54px; height: 54px; }
  .name { font-size: 16px; line-height: 21px; }
  .ctl { width: 38px; }
  .primary .pl { display: none; }
  .controls .primary .pl { display: inline; }
}
@container (max-width: 280px) {
  :host([compact]) .primary .pl { display: none; }
  :host([compact]) .primary { padding: 0 10px; }
}
`;

class VacuumCard extends HTMLElement {
  static getConfigElement() { return document.createElement(EDITOR); }

  static getStubConfig(hass) {
    const v = Object.keys(hass?.states || {}).find((id) => id.startsWith("vacuum."));
    return { entity: v || "vacuum.example" };
  }

  constructor() {
    super();
    watchKeyboard(this);
    this._job = (now, dt) => this._frame(now, dt);
    this._onscreen = true;
    this._expect = null;          // { state, until, label } optimistic vacuum activity
    this._expectSw = new Map();   // switch/select id -> { state, until }
    this._running = new Map();    // routine id -> until (optimistic "Starting…")
    this._picked = [];            // selected room ids, in cleaning order
    this._rooms = null;           // { mode: "area"|"segment"|"none", list: [{id, name, icon}] }
  }

  setConfig(config) {
    if (!config?.entity || !String(config.entity).startsWith("vacuum.")) {
      throw new Error("savvy-vacuum-card: \"entity\" must be a vacuum entity");
    }
    // layout: compact is the one-row version (the pre-Savvy compact: true still works)
    this._compact = config.layout === "compact" || config.compact === true;
    // an editor dropdown can't say false: "off" means the same
    config = { ...config };
    for (const k of ["map", "rooms", "routines", "modes", "dock", "maintenance", "stats"]) if (config[k] === "off") config[k] = false;
    this._config = { battery_warn: 20, battery_critical: 10, map: true, rooms: "auto", routines: "auto",
      modes: "auto", dock: "auto", maintenance: "auto", stats: "auto", ...config };
    this._disc = null;
    if (this._root) {
      this._build();
      if (this._hass) this._update();
    }
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (!this._root) this._build();
    this._update();
    if (first && !this._compact) this._loadRooms();
  }

  connectedCallback() {
    this._observe();
    this._ticker = this._ticker || setInterval(() => { if (this._onscreen && this._hass) this._update(); }, TICK_MS);
    this._wake();
  }
  disconnectedCallback() {
    Clock.remove(this._job);
    this._io?.disconnect();
    this._ro?.disconnect();
    clearInterval(this._ticker);
    this._ticker = 0;
    this._closeDialog(true);
    this._finishClosing();
  }

  getCardSize() { return this._compact ? 1 : 5; }
  getGridOptions() {
    return this._compact ? { columns: 12, min_columns: 6, rows: "auto" } : { columns: 12, min_columns: 6, rows: "auto" };
  }

  // ---------- discovery ----------
  // Every entity on the vacuum's device, grouped by what it means. Cached against the
  // registry objects' identity, which only change on config edits.
  _discover() {
    const h = this._hass, c = this._config;
    if (this._disc && this._discReg === h.entities && this._discDev === h.devices) return this._disc;
    this._discReg = h.entities;
    this._discDev = h.devices;
    const vac = c.entity, dev = h.entities?.[vac]?.device_id;
    const exclude = new Set([].concat(c.exclude || []));
    const out = { one: {}, alerts: [], dockInfo: [], dockActions: [], settings: [], consumables: [], routines: [], selects: [], images: [], problems: [] };
    const ids = [];
    if (dev) for (const id in h.entities) {
      const e = h.entities[id];
      if (e.device_id !== dev || id === vac || e.hidden || e.disabled_by || exclude.has(id)) continue;
      ids.push(id);
    }
    const keyOf = (id) => {
      const e = h.entities[id], tk = e?.translation_key;
      if (tk) return tk;
      // older cores: fall back to the id suffix
      const all = [...Object.values(ONE).map((x) => x[1]), ...Object.keys(ALERTS), ...Object.keys(DOCK_INFO),
        ...Object.keys(DOCK_ACTIONS), ...Object.keys(SETTINGS), ...Object.keys(CONSUMABLES), ...Object.keys(MODE_NAMES)];
      return all.find((k) => id.endsWith(`_${k}`)) || null;
    };
    for (const id of ids) {
      const [domain] = id.split("."), e = h.entities[id], key = keyOf(id);
      const hit = Object.entries(ONE).find(([, [d, k]]) => d === domain && k === key);
      if (hit && !out.one[hit[0]]) { out.one[hit[0]] = id; continue; }
      if (domain === "sensor" && !out.one.battery && h.states[id]?.attributes.device_class === "battery") { out.one.battery = id; continue; }
      if (domain === "binary_sensor" && ALERTS[key]) { out.alerts.push({ id, key }); continue; }
      if (domain === "binary_sensor" && DOCK_INFO[key]) { out.dockInfo.push({ id, key }); continue; }
      if (domain === "binary_sensor" && h.states[id]?.attributes.device_class === "problem") { out.alerts.push({ id, key: key || id }); continue; }
      if (domain === "switch" && DOCK_ACTIONS[key]) { out.dockActions.push({ id, key }); continue; }
      if (domain === "switch" && (SETTINGS[key] || e.entity_category === "config")) { out.settings.push({ id, key }); continue; }
      if (domain === "sensor" && (CONSUMABLES[key] || /_time_left$|_remaining$|consumable/.test(key || ""))
        && key !== "mop_drying_remaining_time") { out.consumables.push({ id, key }); continue; }
      if (domain === "select") { out.selects.push({ id, key }); continue; }
      if (domain === "image") { out.images.push(id); continue; }
      // a Roborock routine: a button with no translation_key and no category
      if (domain === "button" && !e.translation_key && !e.entity_category && !/reset|consumable/.test(id)) {
        out.routines.push(id);
        continue;
      }
    }
    if (!out.one.battery && h.states[vac]?.attributes.battery_level != null) out.one.batteryAttr = true;
    this._disc = out;
    return out;
  }

  _feat(bit) { return !!((this._hass.states[this._config.entity]?.attributes.supported_features || 0) & bit); }

  // Rooms: HA areas mapped to the vacuum's segments when configured, otherwise the
  // robot's own segments. Read once (and on registry changes), never per frame.
  async _loadRooms() {
    const h = this._hass, c = this._config;
    if (c.rooms === false || this._roomsLoading) return;
    this._roomsLoading = true;
    let list = null, mode = "none";
    try {
      const entry = await h.callWS({ type: "config/entity_registry/get", entity_id: c.entity });
      const mapping = entry?.options?.vacuum?.area_mapping;
      if (mapping && Object.keys(mapping).length && this._feat(FEAT.CLEAN_AREA)) {
        mode = "area";
        list = Object.keys(mapping).filter((a) => mapping[a]?.length).map((a) => ({
          id: a, name: h.areas?.[a]?.name || title(a), icon: h.areas?.[a]?.icon || "mdi:texture-box",
        }));
      }
    } catch (err) { /* older core or no permission: try segments */ }
    if (!list) {
      try {
        const res = await h.callWS({ type: "vacuum/get_segments", entity_id: c.entity });
        const segs = res?.segments || [];
        if (segs.length) {
          mode = "segment";
          list = segs.map((s) => ({ id: String(s.id), name: s.name || `Room ${s.id}`, icon: "mdi:texture-box", group: s.group }));
        }
      } catch (err) { /* not supported */ }
    }
    if (list && Array.isArray(c.rooms)) {
      const want = c.rooms.map((r) => (typeof r === "object" ? r : { id: r }));
      list = want.map((w) => {
        const found = list.find((r) => r.id === w.id || r.id === w.area || r.name.toLowerCase() === String(w.id).toLowerCase());
        return found ? { ...found, ...(w.name ? { name: w.name } : {}), ...(w.icon ? { icon: w.icon } : {}) } : null;
      }).filter(Boolean);
    } else if (list && mode === "area") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    this._rooms = { mode, list: list || [] };
    this._roomsLoading = false;
    this._update();
  }

  // ---------- build ----------
  _build() {
    this._root = this._shadow || (this._shadow = this.attachShadow({ mode: "open" }));
    this._closeDialog(true);
    this._finishClosing();
    this._springs = [];
    this._pressNodes = [];
    this.toggleAttribute("compact", this._compact);
    this._root.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="banner" id="banner" role="button" tabindex="0" hidden>
          <ha-icon id="bIcon"></ha-icon><span class="bt"><span class="b1" id="b1"></span><span class="b2" id="b2"></span></span>
        </div>
        <div class="hero">
          <div class="ring" id="ring" role="button" tabindex="0">
            <svg viewBox="0 0 40 40" aria-hidden="true"><circle class="track" cx="20" cy="20" r="18"></circle>
              <circle class="fill" id="rfill" cx="20" cy="20" r="18" pathLength="100" stroke-dasharray="100 100" stroke-dashoffset="100"></circle></svg>
            <span class="bot"><ha-icon icon="mdi:robot-vacuum"></ha-icon></span>
            <span class="bolt" id="bolt" hidden><ha-icon icon="mdi:lightning-bolt"></ha-icon></span>
          </div>
          <div class="who" id="who" role="button" tabindex="0">
            <span class="name" id="name"></span>
            <span class="status" id="status"><span class="s1" id="s1"></span><span class="s2" id="s2"></span></span>
            <span class="meta" id="meta"><span class="batt" id="batt"></span><span class="stats" id="stats"></span></span>
          </div>
          <button class="primary" id="mainBtn" ${this._compact ? "" : "hidden"}><ha-icon id="mainIcon"></ha-icon><span class="pl" id="mainLabel"></span></button>
        </div>
        <div class="prog" id="prog" hidden><i id="progFill"></i></div>
        ${this._compact ? "" : `
        <div class="controls" id="controls">
          <button class="primary" id="ctlMain"><ha-icon id="ctlMainIcon"></ha-icon><span class="pl" id="ctlMainLabel"></span></button>
          <button class="ctl" id="ctlDock" aria-label="Return to dock"><ha-icon icon="mdi:home-import-outline"></ha-icon></button>
          <button class="ctl" id="ctlStop" aria-label="Stop (hold)"><ha-icon icon="mdi:stop"></ha-icon></button>
          <button class="ctl" id="ctlLocate" aria-label="Locate"><ha-icon icon="mdi:map-marker-question-outline"></ha-icon></button>
          <button class="ctl" id="ctlMap" aria-label="Map" hidden><ha-icon icon="mdi:map-outline"></ha-icon></button>
        </div>
        <div id="inlineMap"></div>
        <div class="routines" id="routines" role="group" aria-label="Routines"></div>
        <div class="hub" id="hub"></div>
        <div id="holder" hidden>
          <div class="sec" id="mapSec" hidden>
            <div class="chips" id="maps" hidden></div>
            <div class="map" id="map" role="button" tabindex="0" aria-label="Map, open in Home Assistant"><img id="mapImg" alt=""></div>
          </div>
          <div class="sec" id="roomSec" hidden>
            <span class="hint" id="roomAside"></span>
            <div class="chips" id="rooms"></div>
            <div class="rooms-go" id="roomsGo" hidden>
              <button class="primary" id="roomsBtn"><ha-icon icon="mdi:play"></ha-icon><span class="pl" id="roomsLabel"></span></button>
              <button class="clear" id="roomsClear">Clear</button>
            </div>
            <span class="hint" id="roomHint" hidden></span>
            <div class="chips" id="roomExtras" hidden></div>
          </div>
          <div class="sec" id="modeSec" hidden><div class="mgroups" id="modes"></div></div>
          <div class="sec" id="dockSec" hidden>
            <div class="dock" id="dock"></div>
            <div class="chips" id="dockActs" hidden></div>
          </div>
          <div class="sec" id="careSec" hidden>
            <div class="parts" id="parts"></div>
            <div class="chips" id="settings" hidden></div>
            <div class="totals" id="totals" hidden></div>
          </div>
        </div>`}
      </ha-card>`;
    const $ = (id) => this._root.getElementById(id);
    this._el = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (o[k] = $(k))) });
    this._el.card = this._root.querySelector("ha-card");

    this._ringS = new Spring(0, MOTION.ring, "ring");
    this._actS = new Spring(0, MOTION.ui, "ring");
    this._progS = new Spring(0, MOTION.ring, "prog");
    this._springs.push(this._ringS, this._actS, this._progS);
    this._first = true;
    this._nodes = new Map();

    const openInfo = () => this._moreInfo(this._config.entity);
    this._press(this._el.ring, openInfo, { haptic: null });
    this._press(this._el.who, () => (this._config.navigation_path ? this._navigate(this._config.navigation_path) : openInfo()), { haptic: null });
    this._press(this._el.banner, () => this._moreInfo(this._bannerEntity || this._config.entity), { haptic: null });
    if (this._compact) {
      this._hold(this._el.mainBtn, { onTap: () => this._primary(), onHold: () => this._secondary() });
    } else {
      this._hold(this._el.ctlMain, { onTap: () => this._primary() });
      this._press(this._el.ctlDock, () => this._call("return_to_base", "returning", "Returning"));
      this._hold(this._el.ctlStop, { onHold: () => this._call("stop", "idle", "Stopping"), onTap: () => this._flash("Hold to stop") });
      this._press(this._el.ctlLocate, () => this._call("locate"));
      this._press(this._el.ctlMap, () => this._openDialog("map", this._el.ctlMap), { haptic: null });
      this._press(this._el.map, () => this._moreInfo(this._mapEntity));
      this._hold(this._el.roomsBtn, { onHold: () => this._cleanRooms(), onTap: () => this._flash("Hold to start", true) });
      this._press(this._el.roomsClear, () => { this._picked = []; this._haptic("selection"); this._update(); }, { haptic: null });
    }

    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => this._fitRow());
    this._ro.observe(this._el.card);
    this._observe();
  }

  _observe() {
    if (!this._root || !this.isConnected) return;
    this._io = this._io || new IntersectionObserver(([e]) => {
      this._onscreen = e.isIntersecting;
      if (this._onscreen) { this._paint(null); this._wake(); }
    });
    this._io.disconnect();
    this._io.observe(this);
  }

  // ---------- gestures ----------
  // Feedback on pointer-down, commit on release; a press that travels is a scroll.
  _press(el, onTap, { haptic = "light" } = {}) {
    const spring = new Spring(0, MOTION.press, `p${this._springs.length}`);
    this._springs.push(spring);
    this._pressNodes.push(el);
    el.__spring = spring;
    let origin = null, armed = false, swallow = false;
    const settle = (motion) => { origin = null; spring.to(0, motion); this._wake(); };
    el.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      origin = [e.clientX, e.clientY];
      armed = true; swallow = false;
      spring.to(1, MOTION.press);
      this._wake();
    });
    el.addEventListener("pointermove", (e) => {
      if (!origin || Math.hypot(e.clientX - origin[0], e.clientY - origin[1]) < SLOP) return;
      swallow = true;
      settle(MOTION.release);
    });
    el.addEventListener("pointerup", () => origin && settle(MOTION.release));
    for (const t of ["pointercancel", "pointerleave"]) {
      el.addEventListener(t, () => { if (origin) { swallow = true; settle(MOTION.release); } });
    }
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const ok = (armed || e.detail === 0) && !swallow;
      armed = false; swallow = false;
      if (!ok || el.disabled) return;
      if (haptic) this._haptic(haptic);
      onTap(e);
    });
    if (el.tagName !== "BUTTON") {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); }
      });
    }
    return spring;
  }

  // Hold for anything that starts or ends a whole job from a list (CARD-DESIGN.md
  // 3.1): the button fills for the whole 500ms so the wait is legible, commits with
  // a medium haptic and a pop. A plain tap runs onTap (or nothing).
  _hold(el, { onHold, onTap }) {
    const sink = new Spring(0, MOTION.hold, `h${this._springs.length}`);
    const press = new Spring(0, MOTION.press, `h${this._springs.length}`);
    this._springs.push(sink, press);
    el.__hold = sink;
    el.__spring = press;
    this._pressNodes.push(el);
    let origin = null, timer = 0, fired = false, swallow = false;
    const reset = (motion = MOTION.release) => {
      clearTimeout(timer);
      origin = null;
      press.to(0, motion);
      sink.to(0, MOTION.ui);
      this._wake();
    };
    el.addEventListener("pointerdown", (e) => {
      if (e.button > 0 || el.disabled) return;
      origin = [e.clientX, e.clientY];
      fired = false; swallow = false;
      press.to(1, MOTION.press);
      if (onHold) {
        sink.to(1, { response: HOLD_MS / 1000 * 1.1, damping: 1 });
        timer = setTimeout(() => {
          fired = true;
          this._haptic("medium");
          press.to(0, MOTION.pop);
          press.v = -6;
          sink.snap(0);
          origin = null;
          onHold();
          this._wake();
        }, HOLD_MS);
      }
      this._wake();
    });
    el.addEventListener("pointermove", (e) => {
      if (!origin || Math.hypot(e.clientX - origin[0], e.clientY - origin[1]) < SLOP) return;
      swallow = true;
      reset();
    });
    el.addEventListener("pointerup", () => { if (origin) reset(); });
    for (const t of ["pointercancel", "pointerleave"]) el.addEventListener(t, () => { if (origin) { swallow = true; reset(); } });
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (el.disabled) return;
      // keyboard / screen reader: Enter commits the hold action directly
      if (e.detail === 0) { (onHold || onTap)?.(); return; }
      if (fired || swallow) { fired = false; swallow = false; return; }
      if (onTap) { this._haptic("light"); onTap(); }
    });
  }

  _flash(msg, inRooms = false) {
    if (inRooms && this._dialog?.kind === "rooms") {
      text(this._el.roomAside, msg);
      clearTimeout(this._asideT);
      this._asideT = setTimeout(() => this._update(), 1600);
      this._asideUntil = Date.now() + 1600;
      return;
    }
    this._flashMsg = msg;
    this._flashUntil = Date.now() + 1600;
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => this._update(), 1650);
    this._update();
  }

  // ---------- actions ----------
  _activity() {
    const st = this._hass.states[this._config.entity];
    const real = st?.state;
    if (this._expect) {
      if (Date.now() > this._expect.until || real === this._expect.state) this._expect = null;
      else return this._expect.state;
    }
    return real;
  }

  _call(service, expect, label, data = {}) {
    const h = this._hass, st = h.states[this._config.entity];
    this._flashUntil = 0;
    if (!st || st.state === "unavailable") return;
    h.callService("vacuum", service, data, { entity_id: this._config.entity });
    if (expect) this._expect = { state: expect, label, until: Date.now() + PREDICT_MS };
    setTimeout(() => this._update(), PREDICT_MS + 50);
    this._update();
  }

  // Start runs the configured start (Gabriel: the "Vacuum" routine button) or
  // vacuum.start; a paused job always *resumes* with vacuum.start, never a new routine.
  _start() {
    const h = this._hass, s = this._config.start;
    this._flashUntil = 0;
    if (s && typeof s === "string" && !s.startsWith("vacuum.")) {
      const [d] = s.split(".");
      if (!h.states[s]) return this._call("start", "cleaning", "Starting");
      h.callService(d, d === "script" || d === "scene" ? "turn_on" : "press", {}, { entity_id: s });
      this._expect = { state: "cleaning", label: "Starting", until: Date.now() + PREDICT_MS * 2 };
      setTimeout(() => this._update(), PREDICT_MS * 2 + 50);
      return this._update();
    }
    this._call("start", "cleaning", "Starting");
  }

  _primaryKind() {
    const a = this._activity();
    if (a === "cleaning") return this._feat(FEAT.PAUSE) ? "pause" : "stop";
    if (a === "paused") return "resume";
    if (a === "returning") return this._feat(FEAT.PAUSE) ? "pause" : "stop";
    return "start";
  }

  _primary() {
    const k = this._primaryKind();
    if (k === "pause") return this._call("pause", "paused", "Pausing");
    if (k === "stop") return this._call("stop", "idle", "Stopping");
    if (k === "resume") return this._call("start", "cleaning", "Resuming");
    this._start();
  }

  // mini: hold the main button to send it home (or stop when it's already there)
  _secondary() {
    const a = this._activity();
    if (a === "docked") return this._flash("Already docked");
    this._call("return_to_base", "returning", "Returning");
  }

  _cleanRooms() {
    const h = this._hass, ids = [...this._picked], r = this._rooms;
    if (!ids.length || !r) return;
    this._flashUntil = 0;
    if (r.mode === "area") {
      h.callService("vacuum", "clean_area", { cleaning_area_id: ids }, { entity_id: this._config.entity });
    } else {
      // Roborock's own segment command; the robot cleans in the order given
      h.callService("vacuum", "send_command", {
        command: "app_segment_clean",
        params: [{ segments: ids.map((x) => (Number.isFinite(+x) ? +x : x)), repeat: 1 }],
      }, { entity_id: this._config.entity });
    }
    this._expect = { state: "cleaning", label: `Cleaning ${ids.length} room${ids.length > 1 ? "s" : ""}`, until: Date.now() + PREDICT_MS * 2 };
    this._picked = [];
    // back to the card, where the status now says what's happening
    this._closeDialog();
    setTimeout(() => this._update(), PREDICT_MS * 2 + 50);
    this._update();
  }

  _runRoutine(id) {
    const st = this._hass.states[id];
    if (!st || st.state === "unavailable") return;
    this._flashUntil = 0;
    this._hass.callService("button", "press", {}, { entity_id: id });
    this._running.set(id, Date.now() + PREDICT_MS * 2);
    this._expect = { state: "cleaning", label: "Starting", until: Date.now() + PREDICT_MS * 2 };
    setTimeout(() => this._update(), PREDICT_MS * 2 + 50);
    this._update();
  }

  _toggleSwitch(id) {
    const h = this._hass, st = h.states[id];
    if (!st || isOff(st)) return;
    const on = this._swOn(id);
    h.callService("switch", "toggle", {}, { entity_id: id });
    this._expectSw.set(id, { state: on ? "off" : "on", until: Date.now() + PREDICT_MS });
    setTimeout(() => this._update(), PREDICT_MS + 50);
    this._update();
  }
  _swOn(id) {
    const st = this._hass.states[id], exp = this._expectSw.get(id);
    if (exp) {
      if (Date.now() > exp.until || st?.state === exp.state) this._expectSw.delete(id);
      else return exp.state === "on";
    }
    return st?.state === "on";
  }

  // ---------- update ----------
  _update() {
    const h = this._hass;
    if (!h || !this._root) return;
    this._reduced = MQ.reduced.matches;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    const d = this._discover();
    this._renderHero(d);
    if (!this._compact) {
      this._renderBanner(d);
      this._renderControls();
      this._renderMap(d);
      this._renderRooms();
      this._renderRoutines(d);
      this._renderModes(d);
      this._renderDock(d);
      this._renderCare(d);
      this._renderHub(d);
    }
    if (this._first) { this._first = false; requestAnimationFrame(() => this._paint(null)); }
    this._wake();
  }

  _battery(d) {
    const h = this._hass, c = this._config;
    if (d.one.battery) return num(h.states[d.one.battery]);
    return parseFloat(h.states[c.entity]?.attributes.battery_level);
  }

  _problems(d) {
    const h = this._hass, out = [];
    for (const k of ["vacError", "dockError"]) {
      const id = d.one[k], st = h.states[id];
      if (st && !NO_ERROR.has(String(st.state).toLowerCase())) {
        let w; try { w = h.formatEntityState(st); } catch (err) { w = title(st.state); }
        out.push({ level: "alert", icon: "mdi:alert-circle", text: w, sub: k === "dockError" ? "Dock error" : "Vacuum error", id });
      }
    }
    const vs = h.states[this._config.entity];
    if (vs?.state === "error" && !out.length) out.push({ level: "alert", icon: "mdi:alert-circle", text: "Needs attention", sub: "Vacuum error", id: this._config.entity });
    for (const a of d.alerts) {
      const st = h.states[a.id];
      if (st?.state === "on") {
        const [name, icon] = ALERTS[a.key] || [st.attributes.friendly_name || title(a.key), "mdi:alert"];
        out.push({ level: "warn", icon, text: name, sub: "Dock", id: a.id });
      }
    }
    return out;
  }

  _renderHero(d) {
    const h = this._hass, c = this._config, el = this._el, st = h.states[c.entity];
    const act = this._activity();
    const off = !st || st.state === "unavailable";
    text(el.name, c.name || st?.attributes.friendly_name || "Vacuum");

    // the rich status sensor says what's really happening ("Washing the mop")
    let s1;
    const flashing = this._flashUntil && Date.now() < this._flashUntil;
    if (flashing) s1 = this._flashMsg;
    else if (off) s1 = st ? "Unavailable" : "Not found";
    else if (this._expect) s1 = `${this._expect.label}…`;
    else {
      const rich = h.states[d.one.status];
      try { s1 = rich && !isOff(rich) ? h.formatEntityState(rich) : h.formatEntityState(st); }
      catch (err) { s1 = title(rich?.state || st.state); }
    }
    const cleaning = act === "cleaning";
    const pct = num(h.states[d.one.progress]);
    let s2 = "";
    if (!off && !this._expect && !flashing) {
      if (cleaning && Number.isFinite(pct)) s2 = `${Math.round(pct)}%`;
      else if (st) {
        const t = Date.parse(st.last_changed);
        s2 = act === "docked" ? "" : since(t, true);
      }
    }
    const problems = off ? [] : this._problems(d);
    const worst = problems.find((p) => p.level === "alert") || problems[0];
    attr(el.status, "data-level", worst && !this._expect ? worst.level : null);
    if (worst && this._compact && !this._expect && !flashing) { s1 = worst.text; s2 = ""; }
    text(el.s1, s1);
    text(el.s2, s2);

    const batt = this._battery(d);
    const charging = d.one.charging ? h.states[d.one.charging]?.state === "on" : act === "docked" && batt < 100;
    const lvl = !Number.isFinite(batt) ? null : batt <= c.battery_critical ? "alert" : batt <= c.battery_warn ? "warn" : null;
    text(el.batt, Number.isFinite(batt) ? `${Math.round(batt)}%${charging ? " charging" : ""}` : "");
    attr(el.batt, "data-level", lvl);
    el.meta.hidden = this._compact;
    put(el.ring, "--ring-c", lvl === "alert" ? "var(--alert-c)" : lvl === "warn" ? "var(--warn-c)" : "var(--acc)");
    el.bolt.hidden = !charging;
    this._ringS.to(Number.isFinite(batt) ? clamp(batt / 100) : 0, MOTION.ring);
    this._actS.to(cleaning || act === "returning" ? 1 : 0, MOTION.ui);
    attr(el.ring, "aria-label", `${el.name.textContent}, battery ${Number.isFinite(batt) ? Math.round(batt) + "%" : "unknown"}`);
    attr(el.who, "aria-label", `${el.name.textContent}, ${s1}${s2 ? `, ${s2}` : ""}`);

    el.prog.hidden = !(cleaning && Number.isFinite(pct));
    this._progS.to(Number.isFinite(pct) ? clamp(pct / 100) : 0, MOTION.ring);

    if (this._compact) {
      const kind = this._primaryKind();
      const [icon, label, quiet] = {
        start: ["mdi:play", "Start", false], pause: ["mdi:pause", "Pause", true],
        resume: ["mdi:play", "Resume", false], stop: ["mdi:stop", "Stop", true],
      }[kind];
      attr(el.mainIcon, "icon", icon);
      text(el.mainLabel, label);
      attr(el.mainBtn, "data-kind", quiet ? "quiet" : null);
      attr(el.mainBtn, "aria-label", `${label}${kind !== "start" ? "; hold to send it home" : "; hold to send it home"}`);
      el.mainBtn.disabled = off;
    } else {
      // one quiet line: the running job's time and area, or when the last one finished
      let stats = "";
      if (c.stats !== false) {
        const time = toSeconds(h.states[d.one.cleanTime]), area = num(h.states[d.one.cleanArea]);
        const areaU = h.states[d.one.cleanArea]?.attributes.unit_of_measurement || "m²";
        const job = [Number.isFinite(time) ? hm(time) : null, Number.isFinite(area) ? `${Math.round(area)} ${areaU}` : null].filter(Boolean).join(" · ");
        if (cleaning || act === "paused" || act === "returning") stats = job;
        else {
          const t1 = Date.parse(h.states[d.one.lastEnd]?.state), t0 = Date.parse(h.states[d.one.lastStart]?.state);
          const t = Number.isFinite(t1) ? t1 : t0;
          if (Number.isFinite(t)) stats = `Last clean ${dayTime(t, h.locale?.language).replace(/^(Today|Yesterday)/, (m) => m.toLowerCase())}${job ? ` · ${job}` : ""}`;
        }
      }
      text(el.stats, stats);
      attr(el.stats, "title", stats || null);
    }
  }

  _renderBanner(d) {
    const el = this._el, st = this._hass.states[this._config.entity];
    const problems = !st || st.state === "unavailable" ? [] : this._problems(d);
    const p = problems.find((x) => x.level === "alert") || problems[0];
    el.banner.hidden = !p;
    if (!p) { this._bannerEntity = null; return; }
    this._bannerEntity = p.id;
    attr(el.banner, "data-level", p.level);
    attr(el.bIcon, "icon", p.icon);
    text(el.b1, p.text);
    text(el.b2, `${p.sub}${problems.length > 1 ? ` · +${problems.length - 1} more` : ""} · tap for details`);
    attr(el.banner, "aria-label", `${p.text}. ${p.sub}.`);
  }

  _renderControls() {
    const el = this._el, st = this._hass.states[this._config.entity];
    const off = !st || st.state === "unavailable";
    const kind = this._primaryKind(), a = this._activity();
    const [icon, label, quiet] = {
      start: ["mdi:play", this._config.start_name || "Start", false], pause: ["mdi:pause", "Pause", true],
      resume: ["mdi:play", "Resume", false], stop: ["mdi:stop", "Stop", true],
    }[kind];
    attr(el.ctlMainIcon, "icon", icon);
    text(el.ctlMainLabel, label);
    attr(el.ctlMain, "data-kind", quiet ? "quiet" : null);
    el.ctlMain.disabled = off;
    el.ctlDock.hidden = !this._feat(FEAT.RETURN_HOME);
    el.ctlDock.disabled = off || a === "docked" || a === "returning";
    el.ctlStop.hidden = !this._feat(FEAT.STOP) || kind === "stop";
    el.ctlStop.disabled = off || !["cleaning", "paused", "returning"].includes(a);
    el.ctlLocate.hidden = !this._feat(FEAT.LOCATE);
    el.ctlLocate.disabled = off;
  }

  _renderMap(d) {
    const h = this._hass, c = this._config, el = this._el;
    let id = null;
    if (c.map === false) id = null;
    else if (typeof c.map === "string" && c.map.includes(".")) id = c.map;   // an image/camera entity
    else {
      // the image for the selected map when there are several
      const sel = h.states[d.one.selectedMap]?.state;
      id = d.images.find((i) => sel && (h.states[i]?.attributes.friendly_name || "").toLowerCase().endsWith(String(sel).toLowerCase()))
        || d.images[0] || null;
    }
    const st = id ? h.states[id] : null;
    this._mapEntity = id;
    el.mapSec.hidden = !st;
    // map: true/"popup" -> a Map button opens it; "inline" -> in the card; false -> nothing
    const inline = c.map === "inline";
    el.ctlMap.hidden = !st || inline;
    if (inline && st && el.mapSec.parentElement !== el.inlineMap) el.inlineMap.appendChild(el.mapSec);
    if (!st) return;
    const pic = st.attributes.entity_picture;
    if (pic && el.mapImg.__src !== pic) { el.mapImg.__src = pic; el.mapImg.src = pic; }
    if (c.map_max_height) put(el.map, "--map-max", `${c.map_max_height}px`);
    // map picker, only when the vacuum knows several maps
    const selId = d.one.selectedMap, sel = h.states[selId];
    const opts = sel?.attributes.options || [];
    el.maps.hidden = opts.length < 2;
    if (opts.length > 1) {
      this._chipList(el.maps, opts.map((o) => ({
        key: `map:${o}`, icon: "mdi:map-outline", label: this._fmtOption(sel, o), on: sel.state === o,
        tap: () => this._selectOption(selId, o),
      })));
    }
  }

  _renderRooms() {
    const el = this._el, r = this._rooms, c = this._config;
    el.roomSec.hidden = c.rooms === false || !r || (!r.list.length && r.mode === "none" && !this._feat(FEAT.CLEAN_AREA));
    if (el.roomSec.hidden) return;
    if (!r.list.length) {
      el.roomHint.hidden = false;
      text(el.roomHint, "No rooms yet. Map the vacuum's rooms to your areas in its entity settings (Areas), then they'll appear here.");
      el.rooms.hidden = true;
      el.roomAside.hidden = true;
      el.roomsGo.hidden = true;
      return;
    }
    el.roomHint.hidden = true;
    el.rooms.hidden = false;
    el.roomAside.hidden = false;
    this._picked = this._picked.filter((id) => r.list.some((x) => x.id === id));
    const off = this._hass.states[c.entity]?.state === "unavailable";
    this._chipList(el.rooms, r.list.map((room) => {
      const n = this._picked.indexOf(room.id);
      return {
        key: `room:${room.id}`, icon: room.icon, label: room.name, on: n >= 0, order: n >= 0 ? n + 1 : null, off,
        pressed: n >= 0,
        tap: () => {
          const i = this._picked.indexOf(room.id);
          if (i >= 0) this._picked.splice(i, 1); else this._picked.push(room.id);
          this._haptic("selection");
          this._update();
        },
      };
    }), { haptic: null });
    const n = this._picked.length;
    el.roomsGo.hidden = !n;
    text(el.roomsLabel, `Clean ${n} room${n === 1 ? "" : "s"} · hold`);
    attr(el.roomsBtn, "aria-label", `Clean ${n} room${n === 1 ? "" : "s"} in the order picked. Hold to start.`);
    el.roomsBtn.disabled = off;
    if (!this._asideUntil || Date.now() > this._asideUntil) text(el.roomAside, n ? "Cleaned in the order you picked" : "Tap rooms in the order to clean them");
    const spot = this._feat(FEAT.CLEAN_SPOT);
    el.roomExtras.hidden = !spot;
    if (spot) this._chipList(el.roomExtras, [{ key: "spot", icon: "mdi:target", label: "Spot clean here", off, tap: () => { this._call("clean_spot", "cleaning", "Spot cleaning"); this._closeDialog(); } }]);
  }

  _renderRoutines(d) {
    const h = this._hass, c = this._config, el = this._el;
    let list = [];
    if (c.routines === false) list = [];
    else if (Array.isArray(c.routines)) list = c.routines.map((r) => (typeof r === "string" ? { entity: r } : r)).filter((r) => r.entity);
    else list = d.routines.map((id) => ({ entity: id }));
    el.routines.hidden = !list.length;
    if (!list.length) return;
    const box = el.routines, seen = new Set();
    const names = this._routineNames(list);
    for (const r of list) {
      const key = `rt:${r.entity}`;
      seen.add(key);
      let node = this._nodes.get(key);
      if (!node) {
        node = document.createElement("button");
        node.className = "rt";
        node.innerHTML = `<ha-icon></ha-icon><span class="rn"></span>`;
        this._press(node, () => this._runRoutine(node.__id));
        node.__on = new Spring(0, MOTION.ui, key);
        this._springs.push(node.__on);
        this._nodes.set(key, node);
      }
      node.__id = r.entity;
      box.appendChild(node);
      const st = h.states[r.entity];
      const name = r.name || names.get(r.entity);
      // "Starting…" lives in the hero's status; the routine just lights up meanwhile
      const running = (this._running.get(r.entity) || 0) > Date.now();
      attr(node.querySelector("ha-icon"), "icon", r.icon || routineIcon(name));
      text(node.querySelector(".rn"), name);
      attr(node, "data-off", !st || st.state === "unavailable" ? "" : null);
      attr(node, "aria-label", `Start routine: ${name}`);
      node.__on.to(running ? 1 : 0, MOTION.ui);
    }
    this._prune(box, seen, "rt:");
    this._fitRow();
  }

  _fitRow() {
    const row = this._el?.routines;
    if (!row || row.hidden) return;
    row.toggleAttribute("data-overflow", row.scrollWidth > row.clientWidth + 1);
  }

  // Routine buttons are named "<device> <routine>" ("S8 MaxV Ultra Vacuum & Mop").
  // Drop the device's own name, then any leading words every routine shares, so
  // the tiles say "Vacuum", "Mop", "Vacuum & Mop".
  _routineNames(list) {
    const h = this._hass, out = new Map();
    const dev = h.devices?.[h.entities?.[this._config.entity]?.device_id];
    const prefixes = [dev?.name_by_user, dev?.name, h.states[this._config.entity]?.attributes.friendly_name].filter(Boolean);
    const raw = list.map((r) => {
      let n = h.states[r.entity]?.attributes.friendly_name || title(r.entity.split(".")[1]);
      for (const p of prefixes) if (n.toLowerCase().startsWith(`${p.toLowerCase()} `)) { n = n.slice(p.length + 1); break; }
      return [r.entity, n.split(/\s+/)];
    });
    if (raw.length > 1) {
      let k = 0;
      const minLen = Math.min(...raw.map(([, w]) => w.length));
      while (k < minLen - 1 && raw.every(([, w]) => w[k].toLowerCase() === raw[0][1][k].toLowerCase())) k++;
      // one shared word ("Morning clean" / "Morning mop") is meaning, not a device name
      if (k < 2) k = 0;
      for (const [id, w] of raw) out.set(id, w.slice(k).join(" "));
    } else for (const [id, w] of raw) out.set(id, w.join(" "));
    return out;
  }

  _fmtOption(st, o) {
    try { return this._hass.formatEntityState(st, o); } catch (err) { return title(o); }
  }

  _modes(d) {
    const h = this._hass, c = this._config, vs = h.states[c.entity], out = [];
    if (c.modes === false) return out;
    if (this._feat(FEAT.FAN_SPEED) && vs?.attributes.fan_speed_list?.length) {
      const fmt = (v) => {
        try { return h.formatEntityAttributeValue ? h.formatEntityAttributeValue(vs, "fan_speed", v) : title(v); }
        catch (err) { return title(v); }
      };
      const exp = this._expectSw.get("fan_speed");
      let value = vs.attributes.fan_speed;
      if (exp) { if (Date.now() > exp.until || value === exp.state) this._expectSw.delete("fan_speed"); else value = exp.state; }
      out.push({
        key: "fan_speed", name: MODE_NAMES.fan_speed, value, label: fmt(value), options: vs.attributes.fan_speed_list.map((v) => [v, fmt(v)]),
        pick: (v) => {
          h.callService("vacuum", "set_fan_speed", { fan_speed: v }, { entity_id: c.entity });
          this._expectSw.set("fan_speed", { state: v, until: Date.now() + PREDICT_MS });
          setTimeout(() => this._update(), PREDICT_MS + 50);
          this._update();
        },
        off: vs.state === "unavailable",
      });
    }
    const skip = new Set(["selected_map", ...[].concat(c.hide_modes || [])]);
    const vname = (vs?.attributes.friendly_name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const s of d.selects) {
      if (skip.has(s.key) || skip.has(s.id)) continue;
      const st = h.states[s.id];
      if (!st) continue;
      const exp = this._expectSw.get(s.id);
      let value = st.state;
      if (exp) { if (Date.now() > exp.until || st.state === exp.state) this._expectSw.delete(s.id); else value = exp.state; }
      out.push({
        key: s.id, name: MODE_NAMES[s.key] || (st.attributes.friendly_name || "").replace(new RegExp(`^${vname}\\s+`, "i"), "") || title(s.key),
        value, label: this._fmtOption(st, value), options: (st.attributes.options || []).map((o) => [o, this._fmtOption(st, o)]),
        pick: (v) => this._selectOption(s.id, v), off: isOff(st),
      });
    }
    return out;
  }

  _renderModes(d) {
    const el = this._el, modes = this._modes(d);
    this._modeList = modes;
    el.modeSec.hidden = !modes.length;
    const box = el.modes, seen = new Set();
    for (const m of modes) {
      const key = `mg:${m.key}`;
      seen.add(key);
      let node = this._nodes.get(key);
      if (!node) {
        node = document.createElement("div");
        node.className = "mgroup";
        const chipsId = `mgc-${m.key.replace(/[^a-z0-9]+/gi, "_")}`;
        node.innerHTML = `<span class="cap"></span><div class="chips" id="${chipsId}" role="radiogroup"></div>`;
        this._nodes.set(key, node);
      }
      box.appendChild(node);
      text(node.querySelector(".cap"), m.name);
      const chips = node.querySelector(".chips");
      attr(chips, "aria-label", m.name);
      this._chipList(chips, m.options.map(([v, label]) => ({
        key: v, icon: v === m.value ? "mdi:check" : null, label, on: v === m.value, pressed: v === m.value, off: m.off,
        tap: () => { if (v !== m.value) m.pick(v); },
      })), { haptic: "selection" });
    }
    this._prune(box, seen, "mg:");
  }

  _selectOption(id, option) {
    const st = this._hass.states[id];
    if (!st || isOff(st)) return;
    this._flashUntil = 0;
    this._hass.callService("select", "select_option", { option }, { entity_id: id });
    this._expectSw.set(id, { state: option, until: Date.now() + PREDICT_MS });
    setTimeout(() => this._update(), PREDICT_MS + 50);
    this._update();
  }

  _renderDock(d) {
    const h = this._hass, c = this._config, el = this._el;
    if (c.dock === false) { el.dockSec.hidden = true; return; }
    const items = [];
    for (const a of d.alerts) {
      const st = h.states[a.id];
      if (!st) continue;
      const [name, icon] = ALERTS[a.key] || [st.attributes.friendly_name || title(a.key), "mdi:alert-outline"];
      const short = { water_shortage: "Water", clean_box_empty: "Clean water", dirty_box_full: "Dirty water",
        clean_fluid_empty: "Cleaning fluid", detergent_empty: "Detergent", softener_empty: "Softener" }[a.key] || name;
      const bad = st.state === "on";
      const word = isOff(st) ? "—" : bad ? ({ dirty_box_full: "Full", water_shortage: "Low" }[a.key] || "Empty") : "OK";
      items.push({ key: a.id, icon, value: word, caption: short, level: bad ? "warn" : null });
    }
    for (const x of d.dockInfo) {
      const st = h.states[x.id];
      if (!st) continue;
      const [name, icon, onW, offW] = DOCK_INFO[x.key];
      let value = isOff(st) ? "—" : st.state === "on" ? onW : offW;
      if (x.key === "mop_drying_status" && st.state === "on" && d.one.mopDryLeft) {
        const left = toSeconds(h.states[d.one.mopDryLeft]);
        if (Number.isFinite(left) && left > 0) value = `${hm(left)} left`;
      }
      items.push({ key: x.id, icon, value, caption: name });
    }
    const acts = d.dockActions.map((a) => ({
      key: `act:${a.id}`, icon: DOCK_ACTIONS[a.key][1], label: DOCK_ACTIONS[a.key][0], on: this._swOn(a.id),
      pressed: this._swOn(a.id), off: isOff(h.states[a.id]), tap: () => this._toggleSwitch(a.id),
    }));
    el.dockSec.hidden = !items.length && !acts.length;
    const low = items.find((it) => it.level === "warn");
    const drying = items.find((it) => it.caption === "Mop drying" && /left|Drying/.test(it.value));
    const busy = acts.find((a) => a.on);
    this._dockSummary = low ? { value: `${low.caption} ${low.value.toLowerCase()}`, level: "warn" }
      : busy ? { value: `${busy.label}…`, level: "accent" }
      : drying ? { value: `Drying · ${drying.value.replace(/ left$/, "")}`, level: null }
      : { value: "All OK", level: null };
    const box = el.dock, seen = new Set();
    for (const it of items) {
      const key = `dk:${it.key}`;
      seen.add(key);
      let node = this._nodes.get(key);
      if (!node) {
        node = document.createElement("div");
        node.className = "dk";
        node.innerHTML = `<ha-icon></ha-icon><span class="dt"><span class="dv"></span><span class="dc"></span></span>`;
        attr(node, "role", "button");
        attr(node, "tabindex", "0");
        this._press(node, () => this._moreInfo(node.__id), { haptic: null });
        this._nodes.set(key, node);
      }
      node.__id = it.key;
      box.appendChild(node);
      attr(node.querySelector("ha-icon"), "icon", it.icon);
      text(node.querySelector(".dv"), it.value);
      text(node.querySelector(".dc"), it.caption);
      attr(node, "data-level", it.level);
      attr(node, "aria-label", `${it.caption}: ${it.value}`);
    }
    this._prune(box, seen, "dk:");
    el.dockActs.hidden = !acts.length;
    this._chipList(el.dockActs, acts);
  }

  _renderCare(d) {
    const h = this._hass, c = this._config, el = this._el;
    const parts = [];
    if (c.maintenance !== false) {
      const over = typeof c.maintenance === "object" ? c.maintenance : {};
      for (const p of d.consumables) {
        const st = h.states[p.id];
        if (!st) continue;
        const [name, life, icon] = CONSUMABLES[p.key] || [(st.attributes.friendly_name || title(p.key)).replace(/ time left$/i, ""), null, "mdi:cog-outline"];
        const o = over[p.key] || {};
        const left = toHours(st);
        const rated = o.life_hours ?? life;
        const frac = Number.isFinite(left) && rated ? clamp(left / rated) : null;
        const level = Number.isFinite(left) && left <= 0 ? "alert" : frac != null && frac < 0.1 ? "warn" : null;
        parts.push({ id: p.id, name: o.name || name, icon: o.icon || icon, left, frac, level });
      }
    }
    const settings = d.settings.map((s) => {
      const [name, icon] = SETTINGS[s.key] || [(h.states[s.id]?.attributes.friendly_name || title(s.key)), "mdi:toggle-switch-outline"];
      return { key: `set:${s.id}`, icon, label: name, on: this._swOn(s.id), pressed: this._swOn(s.id), off: isOff(h.states[s.id]), tap: () => this._toggleSwitch(s.id) };
    });
    const tc = num(h.states[d.one.totalCount]), tt = toHours(h.states[d.one.totalTime]), ta = num(h.states[d.one.totalArea]);
    const hasTotals = c.stats !== false && (Number.isFinite(tc) || Number.isFinite(tt) || Number.isFinite(ta));
    el.careSec.hidden = !parts.length && !settings.length && !hasTotals;
    if (el.careSec.hidden) return;

    // the tile names the most urgent part; otherwise the one wearing out soonest
    const needs = parts.filter((p) => p.level);
    const worst = needs.find((p) => p.level === "alert") || needs[0];
    const soonest = [...parts].filter((p) => p.frac != null).sort((a, b) => a.frac - b.frac)[0];
    this._careSummary = worst ? { value: `${worst.name} · ${hoursLeft(worst.left)}`, level: worst.level }
      : parts.length ? { value: soonest ? `All OK · ${soonest.name} ${Math.round(soonest.frac * 100)}%` : "All OK", level: null }
      : { value: settings.length ? `${settings.length} settings` : "Totals", level: null };

    const box = el.parts, seen = new Set();
    for (const p of parts) {
      const key = `part:${p.id}`;
      seen.add(key);
      let node = this._nodes.get(key);
      if (!node) {
        node = document.createElement("div");
        node.className = "part";
        node.innerHTML = `<ha-icon></ha-icon><span class="pn"></span><span class="pl"></span><span class="pb"><i></i></span>`;
        attr(node, "role", "button");
        attr(node, "tabindex", "0");
        this._press(node, () => this._moreInfo(node.__id), { haptic: null });
        node.__bar = new Spring(0, MOTION.ring, key);
        this._springs.push(node.__bar);
        this._nodes.set(key, node);
      }
      node.__id = p.id;
      box.appendChild(node);
      attr(node.querySelector("ha-icon"), "icon", p.icon);
      text(node.querySelector(".pn"), p.name);
      text(node.querySelector(".pl"), hoursLeft(p.left));
      attr(node, "data-level", p.level);
      node.querySelector(".pb").hidden = p.frac == null;
      node.__bar.to(p.frac ?? 0, MOTION.ring);
      attr(node, "aria-label", `${p.name}: ${hoursLeft(p.left)}${p.frac != null ? `, ${Math.round(p.frac * 100)}% of its life` : ""}`);
    }
    this._prune(box, seen, "part:");
    el.settings.hidden = !settings.length;
    this._chipList(el.settings, settings);
    el.totals.hidden = !hasTotals;
    if (hasTotals) {
      const areaU = h.states[d.one.totalArea]?.attributes.unit_of_measurement || "m²";
      const bits = [];
      if (Number.isFinite(tc)) bits.push(`<span><b>${Math.round(tc).toLocaleString()}</b> cleans</span>`);
      if (Number.isFinite(tt)) bits.push(`<span><b>${Math.round(tt).toLocaleString()}</b> h</span>`);
      if (Number.isFinite(ta)) bits.push(`<span><b>${Math.round(ta).toLocaleString()}</b> ${esc(areaU)}</span>`);
      const html = bits.join("");
      if (el.totals.__html !== html) { el.totals.__html = html; el.totals.innerHTML = html; }
    }
  }

  // a keyed row of chips; each chip keeps its node and springs across updates
  _chipList(box, items, { haptic = "light" } = {}) {
    const seen = new Set(), prefix = `${box.id}|`;
    for (const it of items) {
      const key = prefix + it.key;
      seen.add(key);
      let node = this._nodes.get(key);
      if (!node) {
        node = document.createElement("button");
        node.className = "chip";
        node.innerHTML = `<ha-icon></ha-icon><span class="cl"></span>`;
        this._press(node, () => node.__tap?.(), { haptic });
        node.__on = new Spring(0, MOTION.ui, key);
        this._springs.push(node.__on);
        this._nodes.set(key, node);
      }
      node.__tap = it.tap;
      box.appendChild(node);
      const ic = node.querySelector("ha-icon");
      ic.hidden = !it.icon;
      if (it.icon) attr(ic, "icon", it.icon);
      text(node.querySelector(".cl"), it.label);
      let ord = node.querySelector(".ord");
      if (it.order) {
        if (!ord) { ord = document.createElement("span"); ord.className = "ord"; node.prepend(ord); }
        text(ord, String(it.order));
      } else if (ord) ord.remove();
      attr(node, "data-off", it.off ? "" : null);
      node.disabled = !!it.off;
      attr(node, "aria-pressed", it.pressed != null ? String(!!it.pressed) : null);
      attr(node, "aria-label", `${it.label}${it.order ? `, number ${it.order}` : ""}`);
      node.__on.to(it.on ? 1 : 0, MOTION.ui);
    }
    this._prune(box, seen, prefix);
  }

  _prune(box, seen, prefix) {
    for (const [key, node] of this._nodes) {
      if (!key.startsWith(prefix) || seen.has(key)) continue;
      for (const s of [node.__on, node.__bar, node.__spring]) {
        const i = this._springs.indexOf(s);
        if (i >= 0) this._springs.splice(i, 1);
      }
      const p = this._pressNodes.indexOf(node);
      if (p >= 0) this._pressNodes.splice(p, 1);
      node.remove();
      this._nodes.delete(key);
    }
  }

  // ---------- summary tiles ----------
  _renderHub() {
    const el = this._el, tiles = [];
    const r = this._rooms, n = this._picked.length;
    if (!el.roomSec.hidden) {
      tiles.push({ kind: "rooms", icon: "mdi:floor-plan", cap: "Rooms",
        value: !r?.list.length ? "Set up" : n ? `${n} picked` : `${r.list.length} rooms`, level: n ? "accent" : null });
    }
    if (!el.modeSec.hidden) {
      const ml = this._modeList || [];
      tiles.push({ kind: "modes", icon: "mdi:tune-variant", cap: "Modes", value: ml.slice(0, 2).map((m) => m.label).join(" · ") || "—" });
    }
    if (!el.dockSec.hidden) tiles.push({ kind: "dock", icon: "mdi:home-variant-outline", cap: "Dock", ...(this._dockSummary || { value: "—" }) });
    if (!el.careSec.hidden) tiles.push({ kind: "care", icon: "mdi:wrench-outline", cap: "Care", ...(this._careSummary || { value: "—" }) });
    el.hub.hidden = !tiles.length;
    const seen = new Set();
    for (const t of tiles) {
      const key = `hub:${t.kind}`;
      seen.add(key);
      let node = this._nodes.get(key);
      if (!node) {
        node = document.createElement("button");
        node.className = "tile";
        node.innerHTML = `<ha-icon></ha-icon><span class="tt"><span class="tc"></span><span class="tv"></span></span>`;
        attr(node, "aria-haspopup", "dialog");
        this._press(node, () => this._openDialog(t.kind, node), { haptic: null });
        this._nodes.set(key, node);
      }
      el.hub.appendChild(node);
      attr(node.querySelector("ha-icon"), "icon", t.icon);
      text(node.querySelector(".tc"), t.cap);
      text(node.querySelector(".tv"), t.value);
      attr(node, "data-level", t.level || null);
      attr(node, "aria-label", `${t.cap}: ${t.value}. Open`);
    }
    this._prune(el.hub, seen, "hub:");
  }

  // ---------- popup (CARD-DESIGN.md 8) ----------
  // The section itself moves into the popup and back, so it keeps updating live from
  // hass while open, with no second copy of any render code.
  _openDialog(kind, anchor) {
    const secs = { rooms: "roomSec", modes: "modeSec", dock: "dockSec", care: "careSec", map: "mapSec" };
    const titles = { rooms: "Rooms", modes: "Modes", dock: "Dock", care: "Care", map: "Map" };
    const sec = this._el[secs[kind]];
    if (!sec) return;
    this._closeDialog(true);
    this._finishClosing();
    this._haptic("selection");
    const scrim = document.createElement("div");
    scrim.className = "dscrim";
    const dlg = document.createElement("div");
    dlg.className = "dlg";
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("aria-modal", "true");
    dlg.setAttribute("aria-label", titles[kind]);
    dlg.innerHTML = `<span class="grab" aria-hidden="true"></span>
      <div class="dh"><span class="dt">${titles[kind]}</span><button class="dx" aria-label="Close"><ha-icon icon="mdi:close"></ha-icon></button></div>
      <div class="db"></div>`;
    const body = dlg.querySelector(".db");
    body.appendChild(sec);
    // outside ha-card: its container-type would clip a fixed popup taller than the card
    this._root.append(scrim, dlg);
    const place = () => dlg.toggleAttribute("data-sheet", window.innerWidth < 600);
    place();
    const open = new Spring(0, MOTION.sheetIn, "dlg");
    open.to(1, MOTION.sheetIn);
    this._springs.push(open);
    const close = () => this._closeDialog();
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    dlg.querySelector(".dx").addEventListener("click", (e) => { e.stopPropagation(); close(); });
    // deferred a frame so the opening tap doesn't close it straight away
    requestAnimationFrame(() => scrim.addEventListener("pointerdown", close));
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    this._dialog = { kind, sec, scrim, dlg, open, anchor, off: () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
    } };
    this._update();
    dlg.querySelector(".dx").focus({ preventScroll: true });
    this._paint(new Set(["dlg"]));
    this._wake();
  }

  _finishClosing() {
    const c = this._closing;
    if (!c) return;
    this._closing = null;
    this._returnSection(c);
    c.dlg.remove();
    c.scrim.remove();
    const i = this._springs.indexOf(c.open);
    if (i >= 0) this._springs.splice(i, 1);
  }

  _returnSection(d) {
    // the map may live inline; everything else goes back to the hidden holder
    const home = d.kind === "map" && this._config.map === "inline" ? this._el.inlineMap : this._el.holder;
    if (d.sec.parentElement !== home) home.appendChild(d.sec);
  }

  _closeDialog(now = false) {
    const d = this._dialog;
    if (!d) return;
    this._dialog = null;
    d.off();
    d.anchor?.focus?.({ preventScroll: true });
    if (now || !this.isConnected) {
      this._returnSection(d);
      d.dlg.remove();
      d.scrim.remove();
      const i = this._springs.indexOf(d.open);
      if (i >= 0) this._springs.splice(i, 1);
      return;
    }
    d.closing = true;
    d.scrim.style.pointerEvents = "none";
    d.open.to(0, MOTION.sheetOut);
    this._finishClosing();
    this._closing = d;
    this._wake();
  }

  // ---------- helpers ----------
  _navigate(path) {
    if (!path) return;
    history.pushState(null, "", path.startsWith("/") ? path : `${location.pathname.replace(/\/[^/]*$/, "")}/${path}`);
    window.dispatchEvent(new CustomEvent("location-changed", { bubbles: true, composed: true }));
  }
  _moreInfo(entityId) {
    if (!entityId || !this._hass?.states[entityId]) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }
  _haptic(type) { window.dispatchEvent(new CustomEvent("haptic", { detail: type })); }

  // ---------- frame ----------
  _wake() { if (this._root && this.isConnected) Clock.add(this._job); }

  _frame(now, dt) {
    const dirty = new Set();
    for (const s of this._springs) {
      if (s.idle) continue;
      // the popup's open/close is the one motion kept under reduced motion (12)
      if (this._reduced && s.group !== "dlg") s.snap();
      else s.step(dt);
      dirty.add(s.group);
    }
    if (!dirty.size) return false;
    if (this._onscreen || dirty.has("dlg")) this._paint(dirty);
    return true;
  }

  _paint(dirty) {
    if (!this._el) return;
    const all = !dirty, red = this._reduced, el = this._el;
    for (const node of this._pressNodes) {
      const s = node.__spring, hs = node.__hold;
      if (s && (all || dirty.has(s.group))) {
        const p = s.x;
        if (red) put(node, "opacity", Math.abs(p) < 1e-4 ? "" : (1 - 0.25 * clamp(p)).toFixed(3));
        else put(node, "transform", Math.abs(p) < 1e-4 ? "" : `scale(${(1 - 0.04 * p).toFixed(4)})`);
      }
      if (hs && (all || dirty.has(hs.group))) put(node, "--hold", clamp(hs.x).toFixed(3));
    }
    if (all || dirty.has("ring")) {
      put(el.rfill, "stroke-dashoffset", (100 - clamp(this._ringS.x) * 100).toFixed(2));
      put(el.ring, "--act", clamp(this._actS.x).toFixed(3));
    }
    if (all || dirty.has("prog")) put(el.progFill, "transform", `scaleX(${clamp(this._progS.x).toFixed(4)})`);
    for (const [key, node] of this._nodes) {
      if (node.__on && (all || dirty.has(key))) put(node, "--on", clamp(node.__on.x).toFixed(3));
      if (node.__bar && (all || dirty.has(key))) put(node.querySelector(".pb i"), "transform", `scaleX(${clamp(node.__bar.x).toFixed(4)})`);
    }
    const dl = this._dialog || this._closing;
    if (dl && (all || dirty.has("dlg"))) {
      const v = dl.open.x, sheet = dl.dlg.hasAttribute("data-sheet");
      put(dl.scrim, "opacity", clamp(v).toFixed(3));
      put(dl.dlg, "opacity", clamp(v * 1.6).toFixed(3));
      put(dl.dlg, "transform", sheet ? `translateY(${((1 - v) * 60).toFixed(2)}px)`
        : `translate(-50%, calc(-50% + ${((1 - v) * 18).toFixed(2)}px)) scale(${(0.97 + 0.03 * v).toFixed(4)})`);
      if (dl.closing && v < 0.02 && dl.open.idle) this._finishClosing();
    }
  }
}

const EDITOR = defineEditor("savvy-vacuum-card", () => {
  const part = (name, label, helper) => ({ name, label, helper, selector: { select: { mode: "dropdown", options: [
    { value: "auto", label: "Automatic" }, { value: "off", label: "Hidden" }] } } });
  return [
    S.entity("entity", "Vacuum", "vacuum"),
    S.grid(S.text("name", "Name"), S.select("layout", "Layout", [{ value: "full", label: "Full" }, { value: "compact", label: "Compact (one row)" }])),
    S.entity("start", "What Start runs", null, { helper: "A button, script or scene (e.g. an app routine). Empty: the vacuum's own start. Resume after a pause is always a real resume." }),
    S.grid(S.text("start_name", "Start label"), S.text("navigation_path", "Tap the name to open")),
    S.section("Parts", [
      { name: "map", label: "Map", helper: "Popup adds a Map button; inline shows it in the card. Or pick an image/camera entity.",
        selector: { select: { mode: "dropdown", custom_value: true, options: [
          { value: "popup", label: "Popup (a Map button)" }, { value: "inline", label: "In the card" }, { value: "off", label: "Hidden" }] } } },
      S.number("map_max_height", "Map height cap", 120, 1200, 10, "px"),
      part("rooms", "Rooms", "Your areas when mapped, else the robot's own rooms. A custom list is YAML: rooms: [kitchen, …]"),
      part("routines", "Routines", "Your app routines. A custom list is YAML: routines: [{entity, name, icon}]"),
      part("modes", "Modes"), part("dock", "Dock"), part("maintenance", "Maintenance"), part("stats", "Statistics"),
      { name: "hide_modes", label: "Hide these modes", selector: { select: { multiple: true, custom_value: true, options: [] } } },
      { name: "exclude", label: "Leave these entities out", selector: { entity: { multiple: true } } },
    ]),
    S.grid(S.number("battery_warn", "Battery amber below", 1, 100, 1, "%"), S.number("battery_critical", "Battery red below", 1, 100, 1, "%")),
  ];
});

registerCard("savvy-vacuum-card", VacuumCard, "Vacuum",
  "Any robot vacuum: live job, map, rooms in order, routines, modes, dock and maintenance, found from the device.");
})();

console.info(`%c SAVVY CARDS %c ${SAVVY_VERSION} `, "color:#fff;background:#588ee9;font-weight:700;border-radius:4px 0 0 4px;padding:2px 4px",
  "color:#588ee9;background:transparent;border:1px solid #588ee9;border-radius:0 4px 4px 0;padding:1px 4px");
})();
