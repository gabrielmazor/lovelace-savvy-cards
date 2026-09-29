/*! Savvy Cards v0.2.1 | MIT License | built from src/ by build.mjs, do not edit */
(() => {
"use strict";
const SAVVY_VERSION = "0.2.1";

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

// ===== core/25-rooms.js =====
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
const isGroup = (st) => Array.isArray(st?.attributes.entity_id);

// The badge row for an area: [{ key, entity, ids, kind, on, pinned, cfg }]
// opts.idle: every kind the area has, active or not (the room card's full sensor row)
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
    if (!active && !kind.always && !opts.idle) continue;
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
const houseOf = (hass, domain) => houseEntities(hass, { inArea: true })
  .filter((id) => domainOf(id) === domain && !isGroup(hass.states[id]));

function houseLights(hass) {
  const all = houseOf(hass, "light");
  return { all, on: all.filter((id) => hass.states[id].state === "on") };
}
function housePlaying(hass) {
  const all = houseOf(hass, "media_player");
  return { all, on: all.filter((id) => hass.states[id].state === "playing") };
}

// The average indoor temperature: climate units' own readings, else the temperature
// sensors assigned to an area. -> { value, unit, ids, running: [climates blowing] }
function houseTemperature(hass) {
  const inside = houseEntities(hass, { inArea: true });
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

// Security: the alarm panel when there is one; otherwise what's open or unlocked.
// -> { entity, state, open: [ids], ids: [everything relevant] }
function houseSecurity(hass) {
  const inside = houseEntities(hass);
  const alarm = inside.find((id) => domainOf(id) === "alarm_control_panel") || null;
  const locks = inside.filter((id) => domainOf(id) === "lock");
  const openings = pick(hass, houseEntities(hass, { inArea: true }), { domains: "binary_sensor", deviceClasses: ["door", "window", "garage_door", "opening"] });
  const open = [...locks, ...openings].filter((id) => isActive(hass.states[id]));
  return { entity: alarm, open, ids: [...(alarm ? [alarm] : []), ...locks, ...openings] };
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
  // only keys aimed at this element: a focused child with its own press handles its own
  el.addEventListener("keydown", (e) => {
    if (e.target !== el && e.composedPath()[0] !== el) return;
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

// ===== core/75-mode.js =====
// ---------------------------------------------------------------------------------------
// core/mode: the mode chip every card shares. `mode:` names any input_select or select
// (a house mode, a room's scene); it's never guessed. Each option gets its icon and colour
// from the mode dictionary (core/palette), overridable with mode_icons / mode_colors.
// Tapping the chip opens a picker that grows out of it, one row per option.
// ---------------------------------------------------------------------------------------

const SWAP_OUT = { response: 0.14, damping: 1 };
const SWAP_IN = { response: 0.32, damping: 1 };

// Everything a card shows about its mode. -> null when there's no such entity.
function modeInfo(hass, id, cfg = {}) {
  const st = id && hass.states[id];
  if (!st) return null;
  const looks = { icons: keyed(cfg.mode_icons), colors: keyed(cfg.mode_colors) };
  const label = (value) => {
    if (hass.formatEntityState) { try { return hass.formatEntityState(st, value); } catch (err) { /* older core */ } }
    return title(value);
  };
  const options = (st.attributes.options || []).map((o) => ({ value: o, label: label(o), ...modeLook(o, looks) }));
  return { entity: id, st, value: st.state, label: label(st.state), ...modeLook(st.state, looks), options };
}

const selectOption = (hass, id, option) => {
  const d = domainOf(id);
  hass.callService(d === "select" ? "select" : "input_select", "select_option", { option }, { entity_id: id });
};

// A value that changes by lifting the old one away and bringing the new one in. The card
// steps `spring` with its others and calls paint() each frame.
class Swap {
  constructor(el, apply, group = "swap") {
    this.el = el;
    this.apply = apply;
    this.spring = new Spring(1, SWAP_IN, group);
    this.value = undefined;
    this.pending = undefined;
  }
  set(value) {
    if (this.value === undefined) { this.value = value; this.apply(value); return; }
    if (value === this.value) { this.pending = undefined; this.spring.to(1, SWAP_IN); return; }
    if (value === this.pending) return;
    this.pending = value;
    this.spring.to(0, SWAP_OUT);
  }
  paint(reduced) {
    if (this.pending !== undefined && this.spring.x < 0.06) {
      this.value = this.pending;
      this.pending = undefined;
      this.apply(this.value);
      this.spring.to(1, SWAP_IN);
    }
    const s = clamp(this.spring.x);
    put(this.el, "opacity", s > 0.999 ? "" : s.toFixed(3));
    put(this.el, "transform", reduced || s > 0.999 ? "" : `translateY(${((this.pending !== undefined ? -1 : 1) * (1 - s) * 4).toFixed(2)}px)`);
  }
}

const PICKER_CSS = `
  .sv-pick-scrim { position: fixed; inset: 0; z-index: 996; }
  .sv-pick {
    --line: color-mix(in oklab, var(--primary-text-color) 9%, transparent);
    position: fixed; z-index: 997; box-sizing: border-box;
    padding: 8px; border-radius: 16px;
    background: color-mix(in oklab, var(--primary-text-color) 7%, var(--card-background-color, #fff));
    color: var(--primary-text-color);
    box-shadow: 0 12px 34px rgb(0 0 0 / 0.26), 0 0 0 0.5px var(--line);
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px;
    transform-origin: var(--ox, 50%) 0; opacity: 0;
    font-family: var(--savvy-font-family, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", Roboto, sans-serif);
    -webkit-font-smoothing: antialiased; user-select: none; -webkit-user-select: none;
  }
  .sv-pick[data-wide] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .sv-pick[data-wider] { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .sv-pick[data-up] { transform-origin: var(--ox, 50%) 100%; }
  .sv-pick .cap { grid-column: 1 / -1; padding: 2px 4px 3px; font-size: 10.5px; line-height: 13px; font-weight: 650;
    letter-spacing: 0.05em; text-transform: uppercase; color: var(--secondary-text-color); opacity: 0.8; }
  .sv-opt { display: flex; align-items: center; gap: 8px; min-width: 0; height: 38px; padding: 0 10px; border-radius: 11px;
    color: var(--secondary-text-color); font: inherit; font-size: 13px; line-height: 16px; font-weight: 550; letter-spacing: -0.004em;
    background: none; border: 0; margin: 0; cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent; text-align: start; }
  .sv-opt ha-icon { --mdc-icon-size: 18px; flex: none; display: flex; color: var(--oc, var(--secondary-text-color)); }
  .sv-opt span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sv-opt[data-sel] { background: color-mix(in oklab, var(--oc, var(--primary-text-color)) 16%, transparent); color: var(--oc, var(--primary-text-color)); }
  @media (hover: hover) { .sv-opt:not([data-sel]):hover { background: color-mix(in oklab, var(--primary-text-color) 6%, transparent); } }
  :host([kbd]) .sv-opt:focus-visible { outline: 2px solid var(--oc, rgb(88 142 233)); outline-offset: 1px; }
`;

// The picker: anchored to the chip that opened it, as wide as the card, closed by a pick,
// a tap outside, Escape, or anything that moves the page.
class ModePicker {
  constructor(host, { onPick } = {}) {
    this.host = host;
    this.onPick = onPick;
    const root = host.shadowRoot;
    if (!root.__savvyPickCss) {
      const style = document.createElement("style");
      style.textContent = PICKER_CSS;
      root.appendChild(style);
      root.__savvyPickCss = style;
    }
    this.scrim = document.createElement("div");
    this.scrim.className = "sv-pick-scrim";
    this.el = document.createElement("div");
    this.el.className = "sv-pick";
    this.el.setAttribute("role", "listbox");
    this.el.innerHTML = `<span class="cap"></span>`;
    this.cap = this.el.firstChild;
    this.rows = new Map();
    this.spring = new Spring(0, MOTION.sheetIn, "picker", 0.002);
    this.press = [];
    this.job = (now, dt) => this.frame(dt);
    this.isOpen = false;
  }

  open(anchor, bounds, info, caption) {
    if (this.isOpen || !info) return;
    this.isOpen = true;
    this.anchor = anchor;
    this.host.shadowRoot.append(this.scrim, this.el);
    this.render(info, caption);
    this.place(anchor, bounds);
    this.returnTo = anchor;
    this.onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(); } };
    this.onMove = () => this.close();
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("scroll", this.onMove, true);
    window.addEventListener("resize", this.onMove);
    // a frame later, so the tap that opened it doesn't close it
    requestAnimationFrame(() => { if (this.isOpen) this.scrim.addEventListener("pointerdown", this.onScrim = (e) => { e.stopPropagation(); this.close(); }); });
    attr(anchor, "aria-expanded", "true");
    this.spring.to(1, MOTION.sheetIn);
    haptic("light");
    Clock.add(this.job);
    (this.el.querySelector(".sv-opt[data-sel]") || this.el.querySelector(".sv-opt"))?.focus({ preventScroll: true });
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("scroll", this.onMove, true);
    window.removeEventListener("resize", this.onMove);
    this.scrim.removeEventListener("pointerdown", this.onScrim);
    this.scrim.remove();
    attr(this.anchor, "aria-expanded", "false");
    if (this.host.shadowRoot.activeElement && this.el.contains(this.host.shadowRoot.activeElement)) this.returnTo?.focus?.({ preventScroll: true });
    this.spring.to(0, MOTION.sheetOut);
    if (MQ.reduced.matches || !this.host.isConnected) { this.spring.snap(0); this.frame(0); }
    else Clock.add(this.job);
  }

  // Width follows the card; it opens below the chip, or above it near the bottom of the screen.
  place(anchor, bounds) {
    const a = anchor.getBoundingClientRect(), b = (bounds || anchor).getBoundingClientRect();
    const width = Math.max(200, Math.min(520, b.width - 8));
    let left = Math.max(b.left + 4, Math.min(a.left + a.width / 2 - width / 2, b.right - width - 4));
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    put(this.el, "width", `${Math.round(width)}px`);
    put(this.el, "left", `${Math.round(left)}px`);
    put(this.el, "--ox", `${Math.round(a.left + a.width / 2 - left)}px`);
    this.el.toggleAttribute("data-wide", width >= 330 && width < 450);
    this.el.toggleAttribute("data-wider", width >= 450);
    const h = this.el.getBoundingClientRect().height;
    const up = a.bottom + 6 + h > window.innerHeight - 8 && a.top - 6 - h > 8;
    this.el.toggleAttribute("data-up", up);
    put(this.el, "top", `${Math.round(up ? a.top - 6 - h : a.bottom + 6)}px`);
  }

  // live: the selection follows the entity while it's open
  render(info, caption) {
    if (!info) return this.close();
    this.info = info;
    this.cap.hidden = !caption;
    text(this.cap, caption || "");
    const keep = new Set();
    for (const o of info.options) {
      keep.add(o.value);
      let row = this.rows.get(o.value);
      if (!row) {
        row = document.createElement("button");
        row.className = "sv-opt";
        row.setAttribute("role", "option");
        row.innerHTML = "<ha-icon></ha-icon><span></span>";
        const spring = new Spring(0, MOTION.press, "pick-press");
        row.__spring = spring;
        this.press.push(row);
        bindPress(row, { spring, wake: () => Clock.add(this.job), onTap: () => this.pick(o.value), haptic: null });
        this.rows.set(o.value, row);
      }
      const sel = o.value === info.value;
      put(row, "--oc", o.color || "");
      attr(row.querySelector("ha-icon"), "icon", o.icon);
      text(row.querySelector("span"), o.label);
      attr(row, "data-sel", sel);
      attr(row, "aria-selected", sel ? "true" : "false");
      this.el.appendChild(row);
    }
    for (const [k, row] of this.rows) if (!keep.has(k)) { row.remove(); this.rows.delete(k); }
  }

  pick(value) {
    const info = this.info;
    this.close();
    if (!info || info.value === value) return;
    haptic("light");
    this.onPick?.(info.entity, value);
  }

  frame(dt) {
    const s = this.spring, red = MQ.reduced.matches;
    let busy = false;
    for (const sp of [s, ...this.press.map((r) => r.__spring)]) {
      if (sp.idle) continue;
      if (red) sp.snap(); else sp.step(dt);
      busy = true;
    }
    const v = clamp(s.x);
    put(this.el, "opacity", v.toFixed(3));
    put(this.el, "pointer-events", this.isOpen ? "auto" : "none");
    put(this.el, "transform", red ? "" : `scale(${(0.92 + 0.08 * v).toFixed(4)}) translateY(${((1 - v) * (this.el.hasAttribute("data-up") ? 6 : -6)).toFixed(2)}px)`);
    for (const row of this.press) {
      const p = row.__spring.x;
      put(row, "transform", red || Math.abs(p) < 1e-4 ? "" : `scale(${(1 - 0.05 * p).toFixed(4)})`);
    }
    if (!this.isOpen && v < 0.01) { this.el.remove(); return false; }
    return busy;
  }
}

// ===== core/80-card.js =====
// ---------------------------------------------------------------------------------------
// core/card: the frame the home, room, heading and tile cards share. Springs, the press
// feedback every tappable thing gets, spinning fan icons, and the entity-list popup, so a
// card only writes what it shows.
//
//   this._spring(value, motion, group, eps)   a spring the card's frame loop steps
//   this._pressable(el, handlers, depth)      tap / hold / double-tap with press feedback
//   this._chipActions(el, getCtx, defaults)   the same, from a chip's action config
//   this._spinner(key, el)                    a rotating icon; set .s.to(turnsPerSecond)
//   this._showList(title, ids, color, from)   the popup of the entities a chip stands for
//   _paint(dirty, all)                        the card's own painting, after the shared part
// ---------------------------------------------------------------------------------------

class SavvyCard extends HTMLElement {
  constructor() {
    super();
    watchKeyboard(this);
    this._job = (now, dt) => this._frame(now, dt);
    this._resetMotion();
  }

  _resetMotion() {
    this._springs = [];
    this._pressNodes = [];
    this._spins = new Map();
  }

  _spring(value, motion, group, eps) {
    const s = new Spring(value, motion, group, eps);
    this._springs.push(s);
    return s;
  }

  _pressable(el, handlers = {}, depth = 0.06) {
    const spring = this._spring(0, MOTION.press, `p${this._springs.length}`);
    el.__spring = spring;
    el.__depth = depth;
    this._pressNodes.push(el);
    bindPress(el, { spring, wake: () => this._wake(), ...handlers });
    return spring;
  }

  // getCtx() -> { config, entity, list }: the chip's action config and what `list` opens
  _chipActions(el, getCtx, defaults = {}, depth = 0.06) {
    const spring = this._spring(0, MOTION.press, `p${this._springs.length}`);
    el.__spring = spring;
    el.__depth = depth;
    this._pressNodes.push(el);
    bindActions(this, el, () => ({ hass: this._hass, ...getCtx() }), { spring, wake: () => this._wake(), defaults });
    return spring;
  }

  _spinner(key, el) {
    let spin = this._spins.get(key);
    if (!spin) {
      spin = { s: this._spring(0, MOTION.spin, `spin:${key}`, 1e-4), angle: 0, el };
      this._spins.set(key, spin);
    }
    spin.el = el;
    return spin;
  }

  _showList(heading, ids, color, from) {
    if (!this._list) this._list = new EntityListSheet(this, { title: heading });
    this._list.sheet.setTitle(heading);
    this._list.color = color;
    this._list.show(this._hass, ids, from);
  }

  _wake() { if (this.shadowRoot && this.isConnected) Clock.add(this._job); }

  disconnectedCallback() {
    Clock.remove(this._job);
    this._picker?.close();
    this._ro?.disconnect();
  }

  _frame(now, dt) {
    const dirty = new Set(), red = MQ.reduced.matches;
    for (const s of this._springs) {
      if (s.idle) continue;
      if (red) s.snap(); else s.step(dt);
      dirty.add(s.group);
    }
    for (const [key, spin] of this._spins) {
      if (spin.s.x < 1e-4) continue;
      spin.angle = (spin.angle + spin.s.x * 360 * dt) % 360;
      dirty.add(`spin:${key}`);
    }
    if (!dirty.size) return false;
    this._paintAll(dirty);
    return true;
  }

  _paintAll(dirty) {
    const all = !dirty, red = MQ.reduced.matches;
    for (const node of this._pressNodes) {
      const s = node.__spring;
      if (!s || (!all && !dirty.has(s.group))) continue;
      const p = s.x;
      put(node, "transform", red || Math.abs(p) < 1e-4 ? "" : `scale(${(1 - node.__depth * p).toFixed(4)})`);
      put(node, "opacity", Math.abs(p) > 1e-3 ? (1 - (red ? 0.25 : 0.12) * clamp(p)).toFixed(3) : "");
    }
    for (const [key, spin] of this._spins) {
      if ((!all && !dirty.has(`spin:${key}`)) || !spin.el) continue;
      put(spin.el, "transform", spin.angle ? `rotate(${spin.angle.toFixed(1)}deg)` : "");
    }
    this._paint?.(dirty, all, red);
  }
}

// The mode chip's gestures, the same on every card: tap opens the picker, hold opens
// more-info. `card._modeInfo()` returns the current modeInfo.
function wireModeChip(card, chip, bounds, caption) {
  card._picker = card._picker || new ModePicker(card, { onPick: (id, v) => selectOption(card._hass, id, v) });
  card._pressable(chip, {
    onTap: () => { const info = card._modeInfo(); if (info?.options.length) card._picker.open(chip, bounds(), info, caption()); },
    onHold: () => moreInfo(card, card._modeInfo()?.entity),
  });
  attr(chip, "aria-haspopup", "listbox");
  attr(chip, "aria-expanded", "false");
}

// ---- the header and chip rows the home and room cards share

const HEADER_CSS = `
  ha-card { --mode: var(--secondary-text-color); display: flex; flex-direction: column; gap: 12px; padding: var(--pad); overflow: hidden;
    user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
  .top { display: flex; align-items: center; gap: 8px; }
  .glyph { flex: none; position: relative; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 13px;
    background: var(--well); color: var(--secondary-text-color); }
  .glyph ha-icon { --mdc-icon-size: 19px; display: flex; }
  .glyph[data-alert] { background: color-mix(in oklab, var(--ac) 18%, transparent); color: var(--ac); }
  .count { position: absolute; top: -4px; inset-inline-end: -4px; min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box;
    border-radius: 8px; background: var(--ac); color: #fff; font-size: 10.5px; line-height: 16px; font-weight: 700; text-align: center;
    box-shadow: 0 0 0 2px var(--ha-card-background, var(--card-background-color)); }
  .pill { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: flex-start; gap: 9px; height: 44px; padding: 0 13px; border-radius: 13px;
    background: color-mix(in oklab, var(--mode) 14%, transparent); color: color-mix(in oklab, var(--mode) 72%, var(--primary-text-color));
    font-size: 13.5px; line-height: 17px; font-weight: 600; letter-spacing: -0.008em; }
  .pill ha-icon { --mdc-icon-size: 18px; flex: none; display: flex; }
  .pill .col { min-width: 0; display: flex; flex-direction: column; align-items: flex-start; }
  .pill .pre { font-size: 10.5px; line-height: 13px; font-weight: 500; letter-spacing: 0.012em; color: var(--secondary-text-color); white-space: nowrap; }
  .pill .swap { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
  .pill .val { font-size: 15px; line-height: 19px; font-weight: 650; letter-spacing: -0.012em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .spacer { flex: 1; }
  /* a readout, not a panel */
  .wx { flex: none; display: flex; align-items: center; gap: 5px; height: 44px; padding: 0 12px 0 10px; border-radius: 13px;
    background: var(--well); color: var(--secondary-text-color); }
  .wx ha-icon, .wx ha-state-icon { --mdc-icon-size: 19px; display: flex; }
  .wx .deg { font-size: 13.5px; line-height: 17px; font-weight: 650; letter-spacing: -0.012em; color: var(--primary-text-color); }
  :host([kbd]) :focus-visible { outline-color: color-mix(in oklab, var(--mode) 80%, var(--primary-text-color)); }
`;

const CHIP_ROW_CSS = `
  /* one row always: the chips share the width, and slide when there isn't enough of it */
  .chips { display: flex; gap: 8px; margin: 0 -2px; padding: 0 2px; overflow-x: auto; overscroll-behavior-x: contain; touch-action: pan-x;
    scrollbar-width: none; scroll-snap-type: x proximity; }
  .chips::-webkit-scrollbar { display: none; }
  .chips[data-overflow] { -webkit-mask-image: linear-gradient(to left, transparent 0, #000 26px); mask-image: linear-gradient(to left, transparent 0, #000 26px); }
  /* no plate: the disc carries the colour, the text sits beside it. The dim lives on .body,
     so a state's opacity and the press feedback's never fight over one node. */
  .chip { flex: none; scroll-snap-align: start; padding: 2px 4px; border-radius: 13px; text-align: start; }
  .chip .body { display: flex; align-items: center; gap: 9px; }
  .chip .disc { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%;
    background: color-mix(in oklab, var(--tc) 18%, transparent); color: var(--tc); }
  .chip .disc ha-icon, .chip .disc ha-state-icon { --mdc-icon-size: 17px; display: flex; }
  .chip .col { display: flex; flex-direction: column; }
  .chip .v { font-size: 12.5px; line-height: 16px; font-weight: 650; letter-spacing: -0.01em; white-space: nowrap; }
  .chip .k { font-size: 10.5px; line-height: 13px; font-weight: 500; letter-spacing: 0.012em; color: var(--secondary-text-color); white-space: nowrap; }
  .chips[data-icon-only] { gap: 4px; }
  .chips[data-icon-only] .chip { padding: 2px; }
  /* navigation chips: a plate per room, no colour disc */
  .chips.nav .chip { background: var(--well); border-radius: 12px; padding: 4px 12px 4px 4px; }
  .chips.nav .chip .body { gap: 5px; }
  .chips.nav .chip .disc { width: auto; height: auto; min-width: 26px; border-radius: 0; background: none; color: var(--secondary-text-color); }
  .sep { height: 1px; margin: 1px 0; background: var(--line); }
  @media (prefers-contrast: more) { .chip .k { color: var(--primary-text-color); } }
`;

// A row of chips. items: [{ key, icon (null: the entity's state icon), stateObj, color, dim,
// value, caption, aria, spin: turns/s or 0, config (actions), entity, defaults, list() }]
SavvyCard.prototype._chipRow = function (row, items, { iconOnly = false } = {}) {
  row.__nodes = row.__nodes || new Map();
  attr(row, "data-icon-only", iconOnly);
  const seen = new Set();
  for (const item of items) {
    seen.add(item.key);
    let node = row.__nodes.get(item.key);
    const wantState = !item.icon;
    if (node && node.__state !== wantState) { node.remove(); row.__nodes.delete(item.key); node = null; }
    if (!node) {
      node = document.createElement("button");
      node.className = "chip";
      node.__state = wantState;
      node.innerHTML = `<span class="body"><span class="disc">${wantState ? "<ha-state-icon></ha-state-icon>" : "<ha-icon></ha-icon>"}</span>
        <span class="col"><span class="v"></span><span class="k"></span></span></span>`;
      node.__icon = node.querySelector(".disc > *");
      node.__item = item;     // bindActions reads it while wiring
      const cur = () => node.__item;
      this._chipActions(node, () => ({ config: cur().config || {}, entity: cur().entity, list: () => cur().list?.(node) }),
        { get tap() { return cur().defaults?.tap; }, get hold() { return cur().defaults?.hold; }, get double_tap() { return cur().defaults?.double_tap; } });
      row.__nodes.set(item.key, node);
    }
    node.__item = item;
    put(node, "--tc", item.color || "var(--primary-text-color)");
    put(node.querySelector(".body"), "opacity", item.dim ? (MQ.contrast.matches ? "0.7" : "0.45") : "");
    if (wantState) {
      if (node.__icon.stateObj !== item.stateObj) { node.__icon.hass = this._hass; node.__icon.stateObj = item.stateObj; }
    } else attr(node.__icon, "icon", item.icon);
    const col = node.querySelector(".col");
    col.hidden = iconOnly;
    text(node.querySelector(".v"), item.value ?? "");
    const k = node.querySelector(".k");
    k.hidden = !item.caption;
    text(k, item.caption || "");
    attr(node, "aria-label", item.aria || [item.caption, item.value].filter(Boolean).join(", "));
    if (item.spin !== undefined) {
      const spin = this._spinner(`${row.id}:${item.key}`, node.__icon);
      spin.s.to(MQ.reduced.matches ? 0 : item.spin || 0);
      if (MQ.reduced.matches) spin.s.snap();
    }
    row.appendChild(node);      // keeps the DOM in the items' order
  }
  for (const [key, node] of row.__nodes) {
    if (seen.has(key)) continue;
    node.remove();
    row.__nodes.delete(key);
    const i = this._pressNodes.indexOf(node);
    if (i >= 0) this._pressNodes.splice(i, 1);
  }
  row.hidden = !items.length;
  this._fitRow(row);
};

SavvyCard.prototype._fitRow = function (row) {
  if (row && !row.hidden) row.toggleAttribute("data-overflow", row.scrollWidth > row.clientWidth + 1);
};

// The mode pill of the home and room cards: icon, value and a caption under it.
SavvyCard.prototype._renderPill = function (info, caption) {
  const el = this._el;
  el.pill.hidden = !info;
  if (!info) return;
  put(el.card, "--mode", info.color || "var(--secondary-text-color)");
  attr(el.pill, "aria-label", `${caption || "Mode"} ${info.label}`);
  el.pill.disabled = !info.options.length;
  el.pre.hidden = !caption;
  text(el.pre, caption || "");
  this._swap.set(info.value);
};

// A chip from the one chip spec: { entity, name, icon, color, show_state, navigation_path,
// tap_action, hold_action, double_tap_action, spin }. The state is the value, the name
// the caption under it; with show_state: false the name alone.
function chipItem(hass, x, i) {
  const st = x.entity ? hass.states[x.entity] : null;
  const name = x.name || (st ? shortName(hass, x.entity) : x.entity ? title(x.entity.split(".")[1]) : "");
  const showState = x.show_state !== false && !!x.entity;
  const value = showState ? (st ? stateText(hass, st) : "Unavailable") : name;
  const spinning = x.spin === "climate" ? houseTemperature(hass).running.length > 0
    : x.spin === true ? climateRunning(st) || isActive(st) : false;
  return {
    key: `c${i}:${x.entity || x.name || ""}`, icon: x.icon ? x.icon : st ? null : "mdi:gesture-tap", stateObj: st, entity: x.entity,
    color: colorOf(x.color) || "var(--primary-text-color)", value, caption: showState ? name : "",
    spin: x.spin ? (spinning ? SPIN.medium : 0) : undefined,
    config: { ...x, tap_action: x.tap_action ?? (x.navigation_path ? { action: "navigate", navigation_path: x.navigation_path } : undefined) },
    defaults: { tap: x.entity ? defaultTapAction(x.entity) : null, hold: x.entity ? { action: "more-info" } : null },
  };
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
  // HA answers every config-changed with setConfig. When that's our own change coming
  // back, nothing is rebuilt: rebuilding replaces the field being typed in, and the cursor
  // is lost after every character (most visibly in Safari).
  setConfig(config) {
    const same = this._config && JSON.stringify(cleanConfig({ ...config })) === JSON.stringify(this._config);
    this._config = same ? this._config : { ...config };
    if (!same) this._render();
  }
  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) ensureHaForm().then(() => this._render());
    for (const f of this.shadowRoot.querySelectorAll("ha-form")) f.hass = hass;
    for (const l of this.shadowRoot.querySelectorAll("savvy-list-editor")) l.hass = hass;
  }
  _shown() {
    const d = { ...this._config };
    for (const [k, v] of this._defaults || []) if (d[k] === undefined) d[k] = v;
    return d;
  }

  // Cards override: returns the schema for the current config (may depend on hass, e.g.
  // climate lists the area's climate entities).
  schema() { return []; }

  _emit(config) {
    // an option equal to its default is left out, so the YAML stays as short as the choices
    const out = { ...config };
    for (const [k, v] of this._defaults || []) if (out[k] === v) delete out[k];
    this._config = cleanConfig(out);
    // HA answers config-changed with setConfig, but the forms mustn't show stale values
    // meanwhile (or where nothing answers)
    const shown = this._shown(), shownKey = JSON.stringify(shown);
    for (const f of this.shadowRoot.querySelectorAll("ha-form")) {
      if (f.__dataKey !== shownKey) { f.__dataKey = shownKey; f.data = shown; }
    }
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
  }

  _render() {
    if (!this._config) return;
    const root = this.shadowRoot;
    if (!root.__style) { root.__style = document.createElement("style"); root.__style.textContent = EDITOR_CSS; root.appendChild(root.__style); }
    let wrap = root.querySelector(".sv-ed");
    if (!wrap) { wrap = document.createElement("div"); wrap.className = "sv-ed"; root.appendChild(wrap); }
    const schema = this.schema(this._hass, this._config) || [];
    // defaults (schema entries with `default`) show in the form while the option is unset
    this._defaults = new Map();
    const collect = (list) => list.forEach((e) => { if (e.name && e.default !== undefined) this._defaults.set(e.name, e.default); if (e.schema && !e.name) collect(e.schema); });
    collect(schema.filter((e) => e.type !== "list"));
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
        // a new schema array makes ha-form rebuild its fields: only hand it one when the
        // schema really changed (by content; functions don't count)
        const schemaKey = JSON.stringify(g);
        if (node.__schemaKey !== schemaKey) { node.__schemaKey = schemaKey; node.schema = g; }
        const data = this._shown(), dataKey = JSON.stringify(data);
        if (node.__dataKey !== dataKey) { node.__dataKey = dataKey; node.data = data; }
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
        node.setup(g, this._config[g.name], this._config);
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
  // spec.initial(hass, config): what to show while the option is unset (lights-card's order
  // starts as the discovered order, so reordering works from the first touch)
  setup(spec, items, config) {
    const given = [].concat(items || []);
    const next = given.length || !spec.initial ? given : [].concat(spec.initial(this._hass, config || {}) || []);
    // unchanged items: keep the rows (and whatever field in them has the cursor)
    const key = JSON.stringify([spec.name, spec.label, next]);
    if (this._spec && key === this._key) return;
    this._key = key;
    this._spec = spec;
    this._items = next;
    this._render();
  }
  // what the list last sent: its echo back through setup() changes nothing
  _sent() { this._key = JSON.stringify([this._spec.name, this._spec.label, this._items]); }
  _emit() {
    this._sent();
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
          this._sent();
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
  bool: (name, label, helper, dflt) => ({ name, label, helper, selector: { boolean: {} }, ...(dflt !== undefined ? { default: dflt } : {}) }),
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

// The mode chip's options: the entity, then an icon and a colour for each of its options
// (found from the mode dictionary until set).
const modeSchema = (hass, c, { name = "mode", label = "Mode", helper } = {}) => {
  const opts = (hass && c[name] && hass.states[c[name]]?.attributes.options) || [];
  return [
    { name, label, helper: helper || "Any input_select or select: a house mode, a room's scenes. Tapping the chip lists its options.",
      selector: { entity: { domain: ["input_select", "select"] } } },
    { name: "mode_label", label: "Mode caption", selector: { text: {} } },
    ...(opts.length ? [
      { type: "expandable", name: "mode_icons", title: "Mode icons", schema: opts.map((o) => ({ name: o, label: o, selector: { icon: { placeholder: modeLook(o).icon } } })) },
      { type: "expandable", name: "mode_colors", title: "Mode colours", schema: opts.map((o) => ({ name: o, label: o, helper: modeLook(o).color || "No colour", selector: { text: {} } })) },
    ] : []),
  ];
};

// The badge row: pinned entities, then what the area has.
const badgeSchema = ({ pinnedLabel = "Pinned", pinnedHelp = "Always shown, first and in this order: a lights helper, presence, a door." } = {}) => [
  S.chips("entities", pinnedLabel, pinnedHelp),
  S.bool("auto_discover", "Also show what the area has", "Presence and doors always; media, locks, climate, fans, covers, windows, leaks and alarms while active.", true),
  { name: "exclude_kinds", label: "Don't discover", selector: { select: { multiple: true, options: BADGE_KINDS.map((k) => ({ value: k.key, label: k.name })) } } },
  { name: "include", label: "Also discover", helper: "Entities to treat as if they were in this area (a lock with no area).", selector: { entity: { multiple: true } } },
  { name: "exclude", label: "Never show", selector: { entity: { multiple: true } } },
];

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
    roomBadges, roomTemperature, areaLights, houseLights, housePlaying, houseTemperature, houseSecurity, modeInfo, legacyBadges,
  };
}

// ===== cards/climate.js =====
(() => {
// savvy-climate-card: an A/C or thermostat. The target on a bar you drag sideways, the
// modes, the fan, the room's readings, and (swipe left) a history chart with the unit's
// on/off band. Point it at an area: it finds the climate entity there; its temperature and
// humidity come from the unit itself unless you give sensors.
//
//   type: custom:savvy-climate-card
//   area: living_room                (or entity: climate.x)
//   temperature: sensor.x  humidity: sensor.y  weather: weather.home   (all optional)
//   timer: { entity: timer.x, select: input_select.y }   chips: [...]

const SCRUB_SLOP = 6;
const SCRUB_DWELL = 140;
const BAND_H = 7;            // the A/C state strip under the chart
const BAND_GAP = 9;     // press and dwell on the chart to scrub; move sooner to page

const MOTION = {
  press:   { response: 0.12, damping: 1 },
  release: { response: 0.3,  damping: 0.82 },
  pop:     { response: 0.34, damping: 0.58 },
  hold:    { response: 0.5,  damping: 1 },
  page:    { response: 0.42, damping: 0.86 },   // flicked, so a little overshoot is right
  pill:    { response: 0.34, damping: 0.82 },   // the segmented control's sliding pill
  ui:      { response: 0.4,  damping: 1 },
  text:    { response: 0.5,  damping: 1 },
  value:   { response: 0.34, damping: 1 },      // target temperature catching up to the drag
  graph:   { response: 0.7,  damping: 1 },      // a new series drawing itself in
  scrub:   { response: 0.1,  damping: 1 },
};



// value to color, interpolated between stops so a rising temperature shifts smoothly
const TEMP_SCALE = [
  { value: 18, color: "#4F93DE" },
  { value: 22, color: "#4FB3C9" },
  { value: 25, color: "#7FC47A" },
  { value: 28, color: "#E8B44F" },
  { value: 31, color: "#EE8247" },
  { value: 34, color: "#E8484F" },
];
const HUMIDITY_COLOR = "#4FB8C9";

const HVAC = {
  off:       { icon: "mdi:power", color: null },
  cool:      { icon: "mdi:snowflake", color: "#4FA8E8" },
  heat:      { icon: "mdi:fire", color: "#F08A3C" },
  heat_cool: { icon: "mdi:sun-snowflake-variant", color: "#8FBF6A" },
  auto:      { icon: "mdi:thermostat-auto", color: "#8FBF6A" },
  dry:       { icon: "mdi:water-percent", color: "#D9A441" },
  fan_only:  { icon: "mdi:fan", color: "#57B8FF" },
};
const ACTION_VERB = {
  cooling: "Cooling", heating: "Heating", drying: "Drying",
  fan: "Fan running", idle: "Idle", off: "Off", preheating: "Preheating",
};

let paint2d;
const toRgb = (css) => {
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(css).trim());
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, "$&$&") : hex[1];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  paint2d = paint2d || document.createElement("canvas").getContext("2d");
  paint2d.fillStyle = "#000";
  paint2d.fillStyle = css;
  const out = paint2d.fillStyle;
  if (out[0] === "#") return toRgb(out);
  const n = out.match(/[\d.]+/g);
  return n ? n.slice(0, 3).map(Number) : [128, 128, 128];
};
const rgbStr = (rgb) => `rgb(${rgb.map((v) => Math.round(v)).join(" ")})`;

const scaleColor = (scale, value) => {
  if (!Number.isFinite(value)) return scale[0].rgb;
  if (value <= scale[0].value) return scale[0].rgb;
  const last = scale[scale.length - 1];
  if (value >= last.value) return last.rgb;
  for (let i = 1; i < scale.length; i++) {
    const a = scale[i - 1], b = scale[i];
    if (value > b.value) continue;
    const t = (value - a.value) / (b.value - a.value);
    return [0, 1, 2].map((k) => lerp(a.rgb[k], b.rgb[k], t));
  }
  return last.rgb;
};
const prepScale = (stops) => stops
  .map((s) => ({ value: Number(s.value), rgb: toRgb(s.color) }))
  .filter((s) => Number.isFinite(s.value))
  .sort((a, b) => a.value - b.value);

// ---------- look ----------

const STYLE = `
  :host { display: block; -webkit-tap-highlight-color: transparent; }
  [hidden] { display: none !important; }
  button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0;
    cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent; }

  ha-card {
    --radius: var(--ha-card-border-radius, 18px);
    --pad: 16px;
    --accent: 90 169 224;
    --line: color-mix(in oklab, var(--primary-text-color) 9%, transparent);
    --well: color-mix(in oklab, var(--primary-text-color) 6%, transparent);
    position: relative;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    border-radius: var(--radius);
    border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--line));
    background: var(--ha-card-background, var(--card-background-color));
    box-shadow: var(--ha-card-box-shadow, none);
    color: var(--primary-text-color);
    font-family: var(--savvy-font-family, system-ui, -apple-system, BlinkMacSystemFont,
      "Segoe UI Variable Text", "Segoe UI", Roboto, sans-serif);
    font-variant-numeric: tabular-nums;
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
    isolation: isolate;
    container-type: inline-size;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    /* ha-card ships "transition: all", which would drag every spring frame behind */
    transition: background-color 240ms ease, border-color 240ms ease;
  }
  @supports (corner-shape: squircle) {
    ha-card { corner-shape: squircle; border-radius: calc(var(--radius) * 1.7); }
  }
  :host([dark]) ha-card::after {
    content: ""; position: absolute; inset: 0; z-index: 5;
    border-radius: inherit; corner-shape: inherit;
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.05);
    pointer-events: none;
  }

  /* the pager: two pages side by side, the card shows one at a time */
  .pager { position: relative; overflow: hidden; }
  .track { display: flex; align-items: stretch; width: 200%; }
  .page { width: 50%; box-sizing: border-box; display: flex; flex-direction: column; padding: var(--pad); }
  .page + .page { border-inline-start: 1px solid transparent; }

  /* ---- header ---- */
  header { display: flex; align-items: flex-start; gap: 12px; }
  .titles { flex: 1; min-width: 0; }
  .name {
    display: block; font-size: 15px; line-height: 20px; font-weight: 600;
    letter-spacing: -0.014em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .status {
    display: block; font-size: 13px; line-height: 18px; font-weight: 500; letter-spacing: -0.003em;
    color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .status b { font-weight: 600; color: rgb(var(--accent)); }

  .power {
    flex: none; display: grid; place-items: center;
    width: 38px; height: 38px; border-radius: 12px;
    background: var(--well); color: var(--secondary-text-color);
  }
  .power[data-on] { background: rgb(var(--accent) / 0.16); color: rgb(var(--accent)); }
  .power ha-icon { --mdc-icon-size: 21px; display: flex; }

  /* ---- target temperature ---- */
  .hero { display: flex; align-items: flex-end; gap: 12px; margin-top: 14px; }
  .readout { flex: 1; min-width: 0; display: flex; align-items: flex-start; }
  .value {
    font-size: 52px; line-height: 0.92; font-weight: 600; letter-spacing: -0.035em;
    color: rgb(var(--accent));
  }
  .unit {
    font-size: 23px; line-height: 1; font-weight: 550; letter-spacing: -0.01em;
    color: rgb(var(--accent) / 0.55); margin: 2px 0 0 2px;
  }
  .steppers { flex: none; display: flex; gap: 8px; padding-bottom: 3px; }
  .step { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 13px; background: var(--well); }
  .step ha-icon { --mdc-icon-size: 22px; display: flex; }
  .step[disabled] { opacity: 0.34; cursor: default; }

  /* the bar is the control: grab it anywhere, it thickens under the finger */
  .slider { position: relative; height: 34px; margin: 12px -2px 0; padding: 0 2px; touch-action: pan-y; cursor: grab; }
  .slider:active { cursor: grabbing; }
  .bar {
    position: absolute; left: 2px; right: 2px; top: 50%; height: 12px; margin-top: -6px;
    border-radius: 99px; background: var(--well); overflow: hidden;
    transform-origin: 50% 50%;
  }
  .fill { position: absolute; inset: 0; transform-origin: 0 50%; border-radius: 99px; }
  .ticks { position: absolute; left: 2px; right: 2px; top: 50%; height: 12px; margin-top: -6px; pointer-events: none; }
  .now {
    position: absolute; top: 50%; width: 3px; height: 16px; margin: -8px 0 0 -1.5px;
    border-radius: 2px; background: var(--primary-text-color); opacity: 0.5;
    box-shadow: 0 0 0 2px var(--ha-card-background, var(--card-background-color));
  }
  .bounds {
    display: flex; justify-content: space-between;
    margin-top: 6px; font-size: 11px; line-height: 14px; font-weight: 500; letter-spacing: 0.01em;
    color: var(--secondary-text-color); opacity: 0.75;
  }

  /* ---- readouts ---- */
  .stats { display: flex; gap: 8px; margin-top: 14px; }
  .stat {
    flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px;
    padding: 9px 10px; border-radius: 14px; background: var(--well);
  }
  .stat ha-icon, .stat ha-state-icon { --mdc-icon-size: 20px; flex: none; display: flex; color: var(--sc, var(--secondary-text-color)); }
  .stat .col { min-width: 0; display: flex; flex-direction: column; }
  .stat .v { font-size: 14px; line-height: 17px; font-weight: 600; letter-spacing: -0.012em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .stat .k { font-size: 11px; line-height: 14px; font-weight: 500; letter-spacing: 0.006em;
    color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* ---- segmented control ---- */
  /* very narrow cards drop the readout labels: the icons already say what they are */
  @container (max-width: 300px) {
    .stat .k { display: none; }
    .stat { padding: 10px; }
  }

  .segmented {
    position: relative; display: flex; gap: 2px; margin-top: 12px;
    padding: 3px; border-radius: 14px; background: var(--well);
  }
  .pill {
    position: absolute; top: 3px; bottom: 3px; left: 0; border-radius: 11px;
    background: var(--ha-card-background, var(--card-background-color));
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.14), 0 0 0 0.5px rgb(0 0 0 / 0.04);
  }
  :host([dark]) .pill { background: color-mix(in oklab, var(--primary-text-color) 14%, transparent); box-shadow: none; }
  /* the mode pill carries the selected mode's own colour, the same signal the text/icon
     already show, instead of a plain neutral background; off has no colour (see HVAC),
     so nothing reads as "selected" at all - no tint, no plate, no shadow */
  .modes .pill[data-colored] {
    background: color-mix(in oklab, var(--sc) 22%, var(--ha-card-background, var(--card-background-color)));
  }
  .modes .pill:not([data-colored]) { background: transparent; box-shadow: none; }
  .seg {
    position: relative; flex: 1; min-width: 0; height: 34px;
    display: flex; align-items: center; justify-content: center; gap: 6px;
    border-radius: 11px; color: var(--secondary-text-color);
    font-size: 13px; line-height: 16px; font-weight: 550; letter-spacing: -0.004em;
  }
  .seg ha-icon { --mdc-icon-size: 18px; display: flex; }
  .seg span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .seg[data-sel] { color: var(--sc, var(--primary-text-color)); }
  /* narrow cards drop the mode labels and keep the icons; the range labels always stay */
  @container (max-width: 340px) { .modes .seg span { display: none; } }

  /* ---- action row ---- */
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .act {
    display: inline-flex; align-items: center; gap: 7px; min-width: 0; height: 34px;
    padding: 0 12px; border-radius: 12px; background: var(--well);
    font-size: 13px; line-height: 16px; font-weight: 550; letter-spacing: -0.004em;
    color: var(--secondary-text-color);
  }
  .act ha-icon, .act ha-state-icon { --mdc-icon-size: 18px; flex: none; display: flex; color: var(--ac, inherit); }
  .act span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .act[data-on] { background: color-mix(in oklab, var(--ac) 16%, transparent); color: var(--ac); }

  /* ---- history page ---- */
  .page.history { padding-bottom: 10px; }
  .legend { display: flex; gap: 8px; align-items: flex-start; }
  .key { display: flex; flex-direction: column; gap: 1px; min-width: 0; padding: 0 2px; }
  .key .v { font-size: 17px; line-height: 21px; font-weight: 600; letter-spacing: -0.02em; color: var(--kc); }
  .key .k { display: flex; align-items: center; gap: 5px; font-size: 11px; line-height: 14px;
    font-weight: 550; letter-spacing: 0.008em; color: var(--secondary-text-color);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .key .k em { font-style: normal; }
  .key .k i { flex: none; width: 7px; height: 7px; border-radius: 2px; background: var(--kc); }
  .key[data-off] { opacity: 0.38; }
  .legend .spacer { flex: 1; }
  .ranges { flex: none; display: flex; gap: 2px; padding: 3px; border-radius: 11px; background: var(--well); }
  .ranges .seg { height: 24px; padding: 0 9px; font-size: 11.5px; border-radius: 8px; flex: none; }
  .ranges .pill { top: 3px; bottom: 3px; border-radius: 8px; }

  .chart { position: relative; flex: 1; min-height: 118px; margin-top: 10px; touch-action: pan-y; }
  .chart svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  .empty {
    position: absolute; inset: 0; display: grid; place-items: center; text-align: center;
    font-size: 12.5px; font-weight: 500; color: var(--secondary-text-color); padding: 0 24px;
  }
  .cursor { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--primary-text-color); opacity: 0; }
  .bubble {
    position: absolute; top: -2px; transform: translateX(-50%);
    display: flex; gap: 8px; align-items: center; padding: 4px 8px; border-radius: 9px;
    background: color-mix(in oklab, var(--primary-text-color) 10%, var(--ha-card-background, var(--card-background-color)));
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.16);
    font-size: 11.5px; line-height: 15px; font-weight: 600; letter-spacing: -0.004em;
    white-space: nowrap; opacity: 0; pointer-events: none;
  }
  .bubble .t { color: var(--secondary-text-color); font-weight: 550; }
  .axis {
    display: flex; justify-content: space-between; margin-top: 6px;
    font-size: 10.5px; line-height: 13px; font-weight: 500; letter-spacing: 0.01em;
    color: var(--secondary-text-color); opacity: 0.8;
  }

  /* ---- compact ---- */
  /* One row of controls. The target sits between its steppers, the mode row carries
     Off so the power button is redundant, and the history page is never built. */
  ha-card[data-compact] { --pad: 12px; }
  ha-card[data-compact] header { align-items: center; gap: 10px; }
  ha-card[data-compact] .name { font-size: 14px; line-height: 18px; }
  ha-card[data-compact] .status { font-size: 12px; line-height: 16px; }
  ha-card[data-compact] .hero { flex: none; margin: 0; align-items: center; gap: 6px; }
  ha-card[data-compact] .steppers { display: contents; }
  ha-card[data-compact] .step { order: 1; width: 32px; height: 32px; border-radius: 10px; padding: 0; }
  ha-card[data-compact] #minus { order: -1; }
  ha-card[data-compact] .step ha-icon { --mdc-icon-size: 19px; }
  ha-card[data-compact] .readout { flex: none; justify-content: center; min-width: 58px; }
  ha-card[data-compact] .value { font-size: 25px; line-height: 1; letter-spacing: -0.022em; }
  ha-card[data-compact] .unit { font-size: 13px; margin: 1px 0 0 1px; }
  ha-card[data-compact] .power { width: 32px; height: 32px; border-radius: 10px; }
  ha-card[data-compact] .power ha-icon { --mdc-icon-size: 18px; }
  ha-card[data-compact] .slider { height: 22px; margin: 9px -2px 0; }
  ha-card[data-compact] .bar, ha-card[data-compact] .ticks { height: 8px; margin-top: -4px; }
  ha-card[data-compact] .now { height: 13px; margin-top: -6.5px; }
  ha-card[data-compact] .segmented { margin-top: 9px; }
  ha-card[data-compact] .seg { height: 30px; font-size: 12.5px; }
  ha-card[data-compact] .seg ha-icon { --mdc-icon-size: 17px; }
  ha-card[data-compact] .actions { margin-top: 8px; }
  ha-card[data-compact] .act { height: 30px; font-size: 12.5px; padding: 0 10px; }
  /* too narrow for one line: the title keeps the row and the target control drops below it */
  @container (max-width: 320px) {
    ha-card[data-compact] header { flex-wrap: wrap; row-gap: 9px; }
    ha-card[data-compact] .titles { flex: 1 0 100%; }
    ha-card[data-compact] .hero { flex: 1; justify-content: space-between; }
    ha-card[data-compact] .readout { flex: 1; }
  }
  @container (max-width: 260px) { ha-card[data-compact] .seg span { display: none; } }

  /* ---- pager dots ---- */
  .dots { display: flex; justify-content: center; gap: 7px; padding: 0 0 10px; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--primary-text-color); opacity: 0.22; }
  .dot[data-sel] { opacity: 0.75; }

  /* an entity that is not reporting shows its controls, greyed and inert */
  ha-card[data-dead] .hero, ha-card[data-dead] .slider,
  ha-card[data-dead] .bounds, ha-card[data-dead] .modes { opacity: 0.38; pointer-events: none; }
  ha-card[data-dead] .power { opacity: 0.38; cursor: default; }

  :host(:not([kbd])) :focus { outline: none; }
  :host([kbd]) :focus-visible { outline: 2px solid rgb(var(--accent)); outline-offset: 2px; border-radius: 10px; }

  @media (prefers-contrast: more) {
    ha-card { border-color: color-mix(in oklab, var(--primary-text-color) 40%, transparent); }
    .status, .stat .k, .bounds, .axis, .key .k { color: var(--primary-text-color); }
  }
  @media (prefers-reduced-motion: reduce) { ha-card { transition: none; } }
`;

class ClimateCard extends HTMLElement {
  static getConfigElement() { return document.createElement(EDITOR); }
  static getStubConfig(hass) {
    const id = Object.keys(hass?.states || {}).find((e) => e.startsWith("climate."));
    const area = id && entityArea(hass, id);
    if (area) return { area };
    if (id) return { entity: id };
    return { area: Object.keys(hass?.areas || {})[0] || "" };
  }

  constructor() {
    super();
    watchKeyboard(this);
    this._job = (now, dt) => this._frame(now, dt);
    this._onscreen = true;
    this._series = [];
    this._page = 0;
  }

  setConfig(config) {
    if (config?.entity && !String(config.entity).startsWith("climate.")) {
      throw new Error("savvy-climate-card: \"entity\" must be a climate entity");
    }
    if (!config?.entity && !config?.area) throw new Error("savvy-climate-card: set an area, or a climate entity");
    const h = config.history || {};
    const t = typeof config.timer === "string" ? { entity: config.timer } : config.timer;
    this._compact = config.layout === "compact" || config.compact === true;
    this._given = config;
    this._config = {
      fan_control: !this._compact,
      ...config,
      // the one chip spec; the pre-Savvy `buttons` are chips
      chips: [].concat(config.chips || config.buttons || []),
      timer: t || null,
      tap_action: this._compact ? "more-info" : "none",
      history: { hours: 24, ranges: [6, 24, 72], show_state: true, ...h },
    };
    this._ranges = [].concat(this._config.history.ranges).map(Number).filter(Boolean);
    if (!this._ranges.includes(Number(this._config.history.hours))) {
      this._ranges = [Number(this._config.history.hours)];
    }
    this._hours = Number(this._config.history.hours);
    this._scale = prepScale(config.temperature_scale || TEMP_SCALE);
    this._humColor = toRgb(config.humidity_color || HUMIDITY_COLOR);
    this._raw = null;
    this._histKey = null;
    // the card editor calls setConfig repeatedly on a live element: rebuild in place, after
    // resolving the area's unit again (the same path as a state update)
    if (this._root) {
      this._stale = true;
      if (this._hass) { this.hass = this._hass; this._loadHistory(true); }
    }
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._config) return;
    // area: the area's climate entity (the first by name; the editor lets you choose)
    if (!this._given.entity) {
      const found = areaClimates(hass, this._given.area)[0] || null;
      if (found !== this._config.entity) { this._config.entity = found; this._stale = true; }
    }
    if (!this._config.entity) return this._renderMissing();
    if (!this._root || this._missing || this._stale) { this._missing = false; this._stale = false; this._build(); }
    this._update();
    if (first) this._loadHistory();
  }

  _renderMissing() {
    this._missing = true;
    this._root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._root.innerHTML = `<style>${BASE_CSS} ha-card { padding: 16px; font-size: 13px; color: var(--secondary-text-color); }</style>
      <ha-card>No climate device in ${esc(areaInfo(this._hass, this._given.area).name)}.</ha-card>`;
  }

  connectedCallback() { this._observe(); this._wake(); }
  disconnectedCallback() {
    Clock.remove(this._job);
    this._io?.disconnect();
    this._ro?.disconnect();
    clearInterval(this._poll);
    clearInterval(this._tick);
    clearTimeout(this._sendTimer);
  }

  getCardSize() { return this._compact ? 2 : 6; }
  getGridOptions() {
    return this._compact
      ? { columns: 12, min_columns: 6, rows: 2, min_rows: 2 }
      : { columns: 12, min_columns: 6 };
  }

  // ---------- build ----------
  _build() {
    this._root = this._shadow || (this._shadow = this.attachShadow({ mode: "open" }));
    clearInterval(this._tick);
    this._tick = 0;
    const c = this._config;
    this._first = true;
    this._springs = [];
    const S = (v, motion, group, eps) => {
      const s = new Spring(v, motion, group, eps);
      this._springs.push(s);
      return s;
    };

    const seg = (cls) => `<div class="segmented ${cls}"><span class="pill"></span></div>`;
    const COMPACT_HIDE = this._compact ? " hidden" : "";
    this._root.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="pager" id="pager">
          <div class="track" id="track">
            <section class="page controls" id="p0">
              <header>
                <div class="titles">
                  <span class="name" id="name"></span>
                  <span class="status" id="status"></span>
                </div>
                <button class="power" id="power" aria-label="Power"><ha-icon icon="mdi:power"></ha-icon></button>
              </header>
              <div class="hero">
                <div class="readout" id="readout">
                  <span class="value" id="value"></span><span class="unit" id="unit"></span>
                </div>
                <div class="steppers">
                  <button class="step" id="minus" aria-label="Lower target"><ha-icon icon="mdi:minus"></ha-icon></button>
                  <button class="step" id="plus" aria-label="Raise target"><ha-icon icon="mdi:plus"></ha-icon></button>
                </div>
              </div>
              <div class="slider" id="slider" role="slider" tabindex="0">
                <div class="bar" id="bar"><span class="fill" id="fill"></span></div>
                <div class="ticks"><span class="now" id="now" hidden></span></div>
              </div>
              <div class="bounds"><span id="lo"></span><span id="hi"></span></div>
              <div class="stats" id="stats"></div>
              ${seg("modes")}
              <div class="actions" id="actions"></div>
            </section>
            <section class="page history" id="p1"${COMPACT_HIDE}>
              <div class="legend" id="legend">
                <span class="spacer"></span>
                ${seg("ranges")}
              </div>
              <div class="chart" id="chart">
                <svg id="svg" focusable="false" aria-hidden="true"></svg>
                <span class="cursor" id="cursor"></span>
                <span class="bubble" id="bubble"></span>
                <span class="empty" id="empty" hidden></span>
              </div>
              <div class="axis"><span id="ax0"></span><span id="ax1"></span><span id="ax2"></span></div>
            </section>
          </div>
        </div>
        <div class="dots" id="dots"></div>
      </ha-card>`;

    if (this._compact) {
      // the target control joins the title row; nothing below it but modes
      const header = this._root.querySelector("header");
      header.insertBefore(this._root.getElementById("readout").parentElement, header.lastElementChild);
      this._root.getElementById("dots").hidden = true;
      this._root.querySelector(".bounds").hidden = true;
      this._root.getElementById("stats").hidden = true;
      this._root.querySelector("ha-card").setAttribute("data-compact", "");
    }
    const $ = (id) => this._root.getElementById(id);
    this._el = {
      card: this._root.querySelector("ha-card"), pager: $("pager"), track: $("track"),
      p0: $("p0"), p1: $("p1"), name: $("name"), status: $("status"), power: $("power"),
      readout: $("readout"), value: $("value"), unit: $("unit"), minus: $("minus"), plus: $("plus"),
      slider: $("slider"), bar: $("bar"), fill: $("fill"), now: $("now"), lo: $("lo"), hi: $("hi"),
      stats: $("stats"), modes: this._root.querySelector(".modes"), actions: $("actions"),
      legend: $("legend"), ranges: this._root.querySelector(".ranges"), chart: $("chart"),
      svg: $("svg"), cursor: $("cursor"), bubble: $("bubble"), empty: $("empty"),
      ax: [$("ax0"), $("ax1"), $("ax2")], dots: $("dots"),
    };

    this._sp = {
      page: S(0, MOTION.page, "page", 1e-4),
      power: S(0, MOTION.press, "power"),
      minus: S(0, MOTION.press, "step"),
      plus: S(0, MOTION.press, "step"),
      target: S(0, MOTION.value, "target", 0.002),
      grab: S(0, MOTION.ui, "target"),
      modeX: S(0, MOTION.pill, "modes", 0.02),
      modeW: S(0, MOTION.pill, "modes", 0.02),
      rangeX: S(0, MOTION.pill, "ranges", 0.02),
      rangeW: S(0, MOTION.pill, "ranges", 0.02),
      reveal: S(0, MOTION.graph, "chart", 0.002),
      scrub: S(0, MOTION.scrub, "chart", 0.002),
      scrubX: S(0, MOTION.scrub, "chart", 0.05),
    };

    // two dots, tap to jump
    for (let i = 0; this._compact ? false : i < 2; i++) {
      const dot = document.createElement("button");
      dot.className = "dot";
      dot.setAttribute("aria-label", i ? "History" : "Controls");
      dot.addEventListener("click", () => this._goto(i));
      this._el.dots.appendChild(dot);
    }

    this._pressable(this._el.power, this._sp.power, () => this._togglePower());
    this._pressable(this._el.minus, this._sp.minus, () => this._nudge(-1));
    this._pressable(this._el.plus, this._sp.plus, () => this._nudge(1));
    if (!this._compact) this._swipe();
    this._sliderGesture();
    this._cardTap();
    this._scrubGesture();
    this._el.slider.addEventListener("keydown", (e) => {
      const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      this._nudge(d);
    });

    this._observe();
  }

  _observe() {
    if (!this._root || !this.isConnected) return;
    this._io = this._io || new IntersectionObserver(([e]) => {
      this._onscreen = e.isIntersecting;
      if (this._onscreen) { this._measure(); this._wake(); }
    });
    this._ro = this._ro || new ResizeObserver(() => { this._measure(); this._wake(); });
    this._io.disconnect(); this._ro.disconnect();
    this._io.observe(this);
    this._ro.observe(this._el.pager);
    clearInterval(this._poll);
    // history only refreshes while the card can actually be seen
    this._poll = setInterval(() => { if (this._onscreen) this._loadHistory(); }, 300000);
  }

  _measure() {
    const el = this._el;
    if (!el) return;
    this._W = el.pager.clientWidth;
    const chart = el.chart.getBoundingClientRect();
    this._cw = chart.width;
    this._ch = chart.height;
    this._segGeom(el.modes, this._sp.modeX, this._sp.modeW, this._modeIdx);
    this._segGeom(el.ranges, this._sp.rangeX, this._sp.rangeW, this._rangeIdx);
    this._chartDirty = true;
  }

  _segGeom(root, sx, sw, idx) {
    const segs = root.querySelectorAll(".seg");
    const sel = segs[idx];
    if (!sel) { sw.snap(0); return; }
    const x = sel.offsetLeft, w = sel.offsetWidth;
    if (this._first || sw.x === 0) { sx.snap(x); sw.snap(w); }
    else { sx.to(x); sw.to(w); }
  }

  // ---------- gestures ----------

  // Tapping the card body opens the entity, the way the old chip card did. A press that
  // travels is a drag or a swipe, and anything that lands on a control belongs to it.
  _cardTap() {
    const card = this._el.card;
    const CONTROLS = ["slider", "step", "power", "seg", "act", "stat", "key", "dot", "ranges"];
    let armed = false, origin = null;
    card.addEventListener("pointerdown", (e) => {
      armed = e.button === 0;
      origin = [e.clientX, e.clientY];
    }, true);
    card.addEventListener("pointermove", (e) => {
      if (!armed || !origin) return;
      if (Math.hypot(e.clientX - origin[0], e.clientY - origin[1]) > SLOP) armed = false;
    }, true);
    card.addEventListener("click", (e) => {
      const ok = armed;
      armed = false;
      if (!ok || this._config.tap_action !== "more-info") return;
      const path = e.composedPath();
      if (path.some((n) => n.classList && CONTROLS.some((c) => n.classList.contains(c)))) return;
      this._moreInfo(this._config.entity);
    });
  }

  // Feedback lands on pointer-down and commits on release; dragging away cancels.
  _pressable(el, spring, onTap, hold) {
    let origin = null, armed = false, swallow = false, timer = 0;
    const settle = (motion) => {
      clearTimeout(timer);
      origin = null;
      spring.to(0, motion);
      this._wake();
    };
    el.addEventListener("pointerdown", (e) => {
      if (e.button > 0 || el.hasAttribute("disabled")) return;
      origin = [e.clientX, e.clientY];
      armed = true; swallow = false;
      spring.to(1, hold ? MOTION.hold : MOTION.press);
      this._wake();
      if (hold) timer = setTimeout(() => {
        swallow = true;
        settle(MOTION.pop);
        this._haptic("medium");
        hold();
      }, HOLD_MS);
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
    el.addEventListener("contextmenu", (e) => hold && e.preventDefault());
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const ok = (armed || e.detail === 0) && !swallow;
      armed = false; swallow = false;
      if (ok) onTap();
    });
  }

  // Horizontal swipe between pages. Vertical intent is released back to the page
  // so the dashboard still scrolls; past the ends the track resists instead of stopping.
  _swipe() {
    const sp = this._sp.page;
    let id = null, x0 = 0, y0 = 0, base = 0, axis = 0, hist = [];
    const el = this._el.pager;
    el.addEventListener("pointerdown", (e) => {
      if (e.button > 0 || id !== null || this._dragging) return;
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; axis = 0;
      base = sp.x;
      hist = [[performance.now(), 0]];
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerId !== id) return;
      if (this._dragging) { id = null; sp.to(this._page, MOTION.page); return; }
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (!axis) {
        if (Math.hypot(dx, dy) < SLOP) return;
        axis = Math.abs(dx) > Math.abs(dy) ? 1 : -1;
        if (axis < 0) { id = null; return; }        // vertical: let the page scroll
        el.setPointerCapture(e.pointerId);
      }
      const W = this._W || 1;
      let x = base - dx / W;
      if (x < 0) x = -rubber(-x, 1);
      else if (x > 1) x = 1 + rubber(x - 1, 1);
      sp.snap(x);                                    // 1:1 with the finger
      const t = performance.now();
      hist.push([t, x]);
      while (hist.length > 5) hist.shift();
      this._wake();
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      if (!axis || axis < 0) return;
      const [t0, p0] = hist[0], t1 = performance.now();
      const v = t1 > t0 ? (sp.x - p0) / ((t1 - t0) / 1000) : 0;
      // land where the flick is going, not where the finger left off
      const target = clamp(Math.round(clamp(sp.x + project(v * 1000) / 1000, -0.4, 1.4)), 0, 1);
      if (target !== this._page) this._haptic("light");
      this._page = target;
      sp.to(target, MOTION.page).kick(v - sp.v, 0);   // hand off the release velocity
      this._syncPage();
      this._wake();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  _goto(page) {
    if (page === this._page) return;
    this._page = page;
    this._sp.page.to(page, MOTION.page);
    this._syncPage();
    this._haptic("light");
    this._wake();
  }

  _syncPage() {
    if (this._compact) return;
    const dots = this._el.dots.children;
    for (let i = 0; i < dots.length; i++) attr(dots[i], "data-sel", i === this._page ? "" : null);
    attr(this._el.p0, "aria-hidden", this._page === 0 ? "false" : "true");
    attr(this._el.p1, "aria-hidden", this._page === 1 ? "false" : "true");
    if (this._page === 1) this._loadHistory();
  }

  // The bar is the control, but only once a drag is clearly sideways: a press alone, or
  // a finger on its way to scrolling the page, never moves the target (CARD-DESIGN.md
  // 3.1). Once engaged the target follows the finger 1:1 from where it was; there's no
  // thumb to aim at, so it never jumps to wherever the finger happened to land.
  _sliderGesture() {
    const el = this._el.slider, sp = this._sp.target;
    let id = null, x0 = 0, y0 = 0, xs = 0, from = 0, live = false, last = null;
    const valueAt = (clientX) => {
      const w = Math.max(1, el.getBoundingClientRect().width - 4);
      return clamp(from + ((clientX - xs) / w) * (this._max - this._min), this._min, this._max);
    };
    el.addEventListener("pointerdown", (e) => {
      if (e.button > 0 || !this._climate || this._el.readout.hidden) return;
      e.stopPropagation();                 // the pager never gets a gesture that starts here
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; live = false;
      // captured from the start, so the release is always seen here even if the finger
      // wanders off; native vertical scrolling still wins (touch-action: pan-y)
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* already lifted */ }
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerId !== id) return;
      if (!e.buttons && e.pointerType === "mouse") { id = null; return; }   // released elsewhere
      if (!live) {
        const dx = e.clientX - x0, dy = e.clientY - y0;
        if (Math.hypot(dx, dy) < SLOP) return;
        if (Math.abs(dy) >= Math.abs(dx)) { id = null; return; }   // vertical: the page scrolls
        live = true;
        this._dragging = true;
        this._sp.grab.to(1);
        xs = e.clientX;
        from = clamp(this._pendTarget ?? sp.x, this._min, this._max);
        last = this._snapStep(from);
      }
      const v = valueAt(e.clientX);
      sp.snap(v);
      const stepped = this._snapStep(v);
      if (stepped !== last) {            // one tick of feedback per step crossed
        last = stepped;
        this._pendTarget = stepped;
        this._haptic("selection");
        this._send(stepped, true);
      }
      this._wake();
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      if (!live) return;                   // a tap, or a press that never became a drag
      live = false;
      this._dragging = false;
      this._sp.grab.to(0);
      const stepped = this._snapStep(sp.x);
      this._pendTarget = stepped;
      sp.to(stepped, MOTION.value);      // settle onto the exact step
      this._send(stepped);
      this._wake();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  // Scrubbing the chart: the readout follows the finger, and lifting returns to now.
  _scrubGesture() {
    const el = this._el.chart;
    let id = null, x0 = 0, y0 = 0, live = false, timer = 0;
    const engage = (e) => {
      live = true;
      clearTimeout(timer);
      el.setPointerCapture(e.pointerId);
      this._dragging = true;
      this._haptic("selection");
      this._sp.scrub.to(1);
      this._track(e);
    };
    el.addEventListener("pointerdown", (e) => {
      if (e.button > 0 || !this._series.length) return;
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; live = false;
      const r = el.getBoundingClientRect();
      this._sp.scrubX.snap(clamp(e.clientX - r.left, 0, r.width));
      timer = setTimeout(() => { if (id === e.pointerId) engage(e); }, SCRUB_DWELL);
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerId !== id) return;
      if (!live) {
        // moved before the dwell elapsed: this is a swipe, let the pager have it
        if (Math.hypot(e.clientX - x0, e.clientY - y0) < SCRUB_SLOP) return;
        clearTimeout(timer);
        id = null;
        return;
      }
      this._track(e);
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      clearTimeout(timer);
      if (!live) return;
      live = false;
      this._dragging = false;
      this._sp.scrub.to(0);
      this._chartDirty = true;
      this._wake();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  _track(e) {
    const r = this._el.chart.getBoundingClientRect();
    this._sp.scrubX.to(clamp(e.clientX - r.left, 0, r.width));
    this._chartDirty = true;
    this._wake();
  }

  // ---------- actions ----------
  _snapStep(v) {
    const s = this._step || 0.5;
    return clamp(Math.round(v / s) * s, this._min, this._max);
  }

  _nudge(dir) {
    if (!this._climate || this._el.readout.hidden) return;
    const next = this._snapStep((this._pendTarget ?? this._sp.target.x) + dir * (this._step || 0.5));
    if (next === this._pendTarget) return;
    this._pendTarget = next;
    this._sp.target.to(next, MOTION.value);
    this._haptic("selection");
    this._send(next);
    this._wake();
  }

  // While dragging, calls are throttled so the A/C is not spammed; the release always lands.
  _send(temperature, throttle = false) {
    this._queued = temperature;
    if (throttle) {
      if (this._sendTimer) return;
      this._sendTimer = setTimeout(() => { this._sendTimer = 0; this._flush(); }, 400);
      return;
    }
    clearTimeout(this._sendTimer);
    this._sendTimer = 0;
    this._flush();
  }

  _flush() {
    if (this._queued == null) return;
    this._hass.callService("climate", "set_temperature",
      { temperature: this._queued }, { entity_id: this._config.entity });
    this._queued = null;
  }

  _togglePower() {
    const st = this._climate;
    if (!st || this._el.card.hasAttribute("data-dead")) return;
    const off = st.state === "off";
    const back = this._config.default_hvac_mode || this._lastOn || this._modes.find((m) => m !== "off") || "cool";
    this._haptic("light");
    this._hass.callService("climate", "set_hvac_mode",
      { hvac_mode: off ? back : "off" }, { entity_id: this._config.entity });
  }

  _setMode(mode) {
    if (mode === this._climate?.state) return;
    this._haptic("light");
    this._hass.callService("climate", "set_hvac_mode", { hvac_mode: mode }, { entity_id: this._config.entity });
  }

  _cycleFan() {
    const st = this._climate, modes = st?.attributes.fan_modes;
    if (!modes?.length) return;
    const next = modes[(modes.indexOf(st.attributes.fan_mode) + 1) % modes.length];
    this._haptic("selection");
    this._hass.callService("climate", "set_fan_mode", { fan_mode: next }, { entity_id: this._config.entity });
  }

  // tapping steps the duration selector, exactly as the old chip did
  _bumpTimer(t) {
    this._haptic("selection");
    if (t.select) {
      return this._hass.callService("input_select", "select_next",
        { cycle: true }, { entity_id: t.cfg.select });
    }
    this._moreInfo(t.cfg.entity);
  }

  _moreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", {
      detail: { entityId }, bubbles: true, composed: true,
    }));
  }

  _haptic(type) {
    window.dispatchEvent(new CustomEvent("haptic", { detail: type }));
  }

  // ---------- state ----------
  // a sensor's reading, else the unit's own attribute (in `fallbackUnit`: °C / % …)
  _num(entityId, attrFallback, fallbackUnit = this._unit) {
    const st = entityId && this._hass.states[entityId];
    if (st) {
      const v = parseFloat(st.state);
      if (Number.isFinite(v)) return { v, unit: st.attributes.unit_of_measurement || "", st };
    }
    if (attrFallback != null && Number.isFinite(attrFallback)) return { v: attrFallback, unit: fallbackUnit, st: null };
    return null;
  }

  _fmt(v, digits = 1) {
    return Number(v).toFixed(digits);
  }

  _update() {
    const h = this._hass, c = this._config, el = this._el;
    if (!h || !this._root) return;
    this._reduced = MQ.reduced.matches;
    this.toggleAttribute("dark", !!h.themes?.darkMode);

    const st = h.states[c.entity];
    this._climate = st;
    const a = st?.attributes || {};
    this._unit = h.config?.unit_system?.temperature || "\u00B0C";
    this._min = Number.isFinite(a.min_temp) ? a.min_temp : 16;
    this._max = Number.isFinite(a.max_temp) ? a.max_temp : 30;
    this._step = Number(a.target_temp_step) || (this._unit.includes("F") ? 1 : 0.5);
    this._modes = (c.hvac_modes || a.hvac_modes || ["off"]).filter((m) => m);
    if (st && st.state !== "off" && st.state !== "unavailable") this._lastOn = st.state;

    const dead = !st || st.state === "unavailable" || st.state === "unknown";
    const on = st && !dead && st.state !== "off";
    this._running = !!on;
    this._el.card.toggleAttribute("data-dead", dead);
    const accent = on ? toRgb(HVAC[st.state]?.color || "#5AA9E0") : toRgb("#9AA0A6");
    put(el.card, "--accent", accent.map(Math.round).join(" "));

    text(el.name, c.name || a.friendly_name || title(c.entity.split(".")[1]));
    el.power.hidden = this._compact && this._modes.some((m) => m === "off");
    attr(el.power, "data-on", on ? "" : null);
    attr(el.power, "aria-pressed", on ? "true" : "false");

    // status line: what it is doing right now, then where it is doing it from
    const room = this._num(c.temperature, a.current_temperature);
    const verb = dead ? (st ? "Unavailable" : "Entity not found")
      : a.hvac_action ? ACTION_VERB[a.hvac_action] || title(a.hvac_action)
      : on ? this._label(st.state) : "Off";
    const bits = [`<b>${verb}</b>`];
    if (room) bits.push(this._compact ? `${this._fmt(room.v)}\u00B0` : `${this._fmt(room.v)}${this._unit} now`);
    if (this._compact) {
      // no readout row down here, so the humidity rides along with the temperature
      const hum = this._num(c.humidity, a.current_humidity);
      if (hum) bits.push(`${this._fmt(hum.v, 0)}%`);
    }
    const html = bits.join(" \u00B7 ");
    if (el.status.__html !== html) { el.status.__html = html; el.status.innerHTML = html; }

    // target temperature: the drag owns the value until the user lets go
    const target = Number(a.temperature);
    const known = Number.isFinite(target) && !dead;
    el.readout.hidden = !known;
    if (known) {
      if (this._pendTarget != null && Math.abs(this._pendTarget - target) < 1e-6) this._pendTarget = null;
      if (!this._dragging && this._pendTarget == null) {
        if (this._first) this._sp.target.snap(target);
        else this._sp.target.to(target, MOTION.value);
      }
      text(el.unit, "\u00B0");
    }
    attr(el.minus, "disabled", dead || (known && target <= this._min) ? "" : null);
    attr(el.plus, "disabled", dead || (known && target >= this._max) ? "" : null);
    attr(el.power, "disabled", dead ? "" : null);
    attr(el.slider, "aria-disabled", dead ? "true" : "false");
    text(el.lo, `${this._fmt(this._min, 0)}${this._unit}`);
    text(el.hi, `${this._fmt(this._max, 0)}${this._unit}`);
    el.slider.setAttribute("aria-valuemin", this._min);
    el.slider.setAttribute("aria-valuemax", this._max);
    if (known) el.slider.setAttribute("aria-valuenow", target);

    // the room's own temperature, marked on the bar
    this._roomV = room ? room.v : null;
    el.now.hidden = !room;

    if (!this._compact) this._stats(room);
    this._segments();
    this._actions();
    if (!this._compact) this._legend();

    if (this._first) {
      this._first = false;
      this._syncPage();
      requestAnimationFrame(() => { this._measure(); this._paint(performance.now(), null); });
    }
    this._wake();
  }

  _rowOf(parent, key, cls, html) {
    const cache = parent.__rows || (parent.__rows = new Map());
    let el = cache.get(key);
    if (!el) {
      el = document.createElement("button");
      el.className = cls;
      el.innerHTML = html;
      cache.set(key, el);
      parent.appendChild(el);
    }
    return el;
  }

  _stats(room) {
    const c = this._config, h = this._hass, el = this._el.stats;
    const want = [];
    if (room) {
      want.push({
        key: "temp", icon: "mdi:thermometer", entity: c.temperature,
        color: rgbStr(scaleColor(this._scale, room.v)),
        v: `${this._fmt(room.v)}${room.unit || this._unit}`, k: c.temperature_name || "Temperature",
      });
    }
    const hum = this._num(c.humidity, h.states[c.entity]?.attributes.current_humidity, "%");
    if (hum) {
      want.push({
        key: "hum", icon: "mdi:water-percent", entity: c.humidity, color: rgbStr(this._humColor),
        v: `${this._fmt(hum.v, 0)}${hum.unit || "%"}`, k: c.humidity_name || "Humidity",
      });
    }
    const w = c.weather && h.states[c.weather];
    if (w) {
      const t = w.attributes.temperature;
      want.push({
        key: "weather", entity: c.weather, weather: w, color: "",
        v: Number.isFinite(t) ? `${this._fmt(t, 0)}${w.attributes.temperature_unit || this._unit}` : "-",
        k: h.formatEntityState ? h.formatEntityState(w) : title(w.state),
      });
    }
    for (const s of want) {
      const item = this._rowOf(el, s.key, "stat",
        `${s.weather ? "<ha-state-icon></ha-state-icon>" : `<ha-icon icon="${s.icon}"></ha-icon>`}
         <span class="col"><span class="v"></span><span class="k"></span></span>`);
      if (!item.__wired) {
        item.__wired = true;
        this._pressable(item, new Spring(0, MOTION.press, "x"), () => this._moreInfo(item.__entity));
      }
      item.__entity = s.entity;
      put(item, "--sc", s.color);
      text(item.querySelector(".v"), s.v);
      text(item.querySelector(".k"), s.k);
      if (s.weather) {
        const icon = item.querySelector("ha-state-icon");
        if (icon.stateObj !== s.weather) { icon.hass = h; icon.stateObj = s.weather; }
      }
    }
    const keys = new Set(want.map((s) => s.key));
    for (const [key, node] of el.__rows || []) node.hidden = !keys.has(key);
    el.hidden = !want.length;
  }

  _segments() {
    const el = this._el.modes, st = this._climate;
    let selColor = null;
    this._modes.forEach((mode, i) => {
      const meta = HVAC[mode] || {};
      const seg = this._rowOf(el, mode, "seg",
        `<ha-icon icon="${meta.icon || "mdi:circle-outline"}"></ha-icon><span></span>`);
      if (!seg.__wired) {
        seg.__wired = true;
        this._pressable(seg, new Spring(0, MOTION.press, "x"), () => this._setMode(mode));
      }
      text(seg.querySelector("span"), this._label(mode));
      attr(seg, "aria-pressed", st?.state === mode ? "true" : "false");
      const sel = st?.state === mode;
      attr(seg, "data-sel", sel ? "" : null);
      put(seg, "--sc", sel && meta.color ? meta.color : "");
      if (sel) { this._modeIdx = i; selColor = meta.color || null; }
    });
    // the pill picks up the same colour as the selected segment's text/icon, so the
    // background and the colour agree; off (HVAC.off.color is null) gets no pill at all
    const pill = el.querySelector(".pill");
    put(pill, "--sc", selColor || "");
    pill.toggleAttribute("data-colored", !!selColor);
    this._segGeom(el, this._sp.modeX, this._sp.modeW, this._modeIdx);

    // history ranges
    const r = this._el.ranges;
    this._ranges.forEach((hours, i) => {
      const seg = this._rowOf(r, String(hours), "seg", "<span></span>");
      if (!seg.__wired) {
        seg.__wired = true;
        this._pressable(seg, new Spring(0, MOTION.press, "x"), () => {
          if (this._hours === hours) return;
          this._hours = hours;
          this._haptic("selection");
          this._segments();
          this._loadHistory(true);
        });
      }
      text(seg.querySelector("span"), hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`);
      const sel = this._hours === hours;
      attr(seg, "data-sel", sel ? "" : null);
      if (sel) this._rangeIdx = i;
    });
    this._segGeom(r, this._sp.rangeX, this._sp.rangeW, this._rangeIdx);
    r.hidden = this._ranges.length < 2;
  }

  _label(mode) {
    const st = this._climate;
    if (st && this._hass.formatEntityState) {
      try { return this._hass.formatEntityState(st, mode); } catch (err) { /* older core */ }
    }
    return title(mode);
  }

  // A running timer reads as a countdown; an idle one reads as the duration it is armed with.
  _timer() {
    const cfg = this._config.timer;
    if (!cfg?.entity) return null;
    const h = this._hass, st = h.states[cfg.entity];
    if (!st) return null;
    const select = cfg.select && h.states[cfg.select];
    const running = st.state === "active";
    const paused = st.state === "paused";
    let label = cfg.name || "Timer";
    if (running) {
      const finish = Date.parse(st.attributes.finishes_at);
      const left = Math.max(0, finish - Date.now());
      const hrs = Math.floor(left / 3600000), min = Math.floor((left % 3600000) / 60000);
      // under an hour the minutes matter; over it, hours and minutes do
      label = hrs > 0 ? `off in ${hrs}:${String(min).padStart(2, "0")}`
        : left >= 60000 ? `off in ${min}m`
        : `off in ${Math.ceil(left / 1000)}s`;
    } else if (paused) {
      label = "Paused";
    } else if (select) {
      label = h.formatEntityState ? h.formatEntityState(select) : title(select.state);
    }
    return { st, cfg, select, running: running || paused, label };
  }

  // one ticking clock, and only while a timer is actually counting down on screen
  _syncTick(active) {
    if (active === !!this._tick) return;
    clearInterval(this._tick);
    this._tick = active ? setInterval(() => {
      if (!this._onscreen) return;
      const t = this._timer();
      const chip = this._el.actions.__rows?.get("timer");
      if (t && chip) text(chip.querySelector("span"), t.label);
    }, 1000) : 0;
  }

  _actions() {
    const el = this._el.actions, h = this._hass, st = this._climate;
    const items = [];
    const timer = this._timer();
    this._syncTick(!!timer && timer.st.state === "active");
    if (this._config.fan_control && st?.attributes.fan_modes?.length) {
      items.push({
        key: "fan", icon: "mdi:fan", color: "#57B8FF",
        label: title(st.attributes.fan_mode || "Fan"),
        on: false, tap: () => this._cycleFan(), hold: () => this._moreInfo(this._config.entity),
      });
    }
    if (timer) {
      items.push({
        key: "timer", entity: timer.cfg.entity, state: timer.st,
        icon: timer.cfg.icon || (timer.running ? "mdi:timer" : "mdi:timer-outline"),
        color: timer.cfg.color || "#E8A33D",
        label: timer.label, on: timer.running,
        tap: () => this._bumpTimer(timer), hold: () => this._moreInfo(timer.cfg.entity),
      });
    }
    for (const b of this._config.chips) {
      const cfg = typeof b === "string" ? { entity: b } : b;
      const s = h.states[cfg.entity];
      if (!s) continue;
      // the one chip spec: tap / hold actions, defaults by domain (a button presses)
      const legacy = cfg.tap_action === "press" ? defaultTapAction(cfg.entity) : cfg.tap_action;
      items.push({
        key: cfg.entity, entity: cfg.entity, state: s, icon: cfg.icon, color: colorOf(cfg.color) || "#5AA9E0",
        label: cfg.name || s.attributes.friendly_name || title(cfg.entity.split(".")[1]),
        on: ["on", "open", "home", "playing"].includes(s.state),
        tap: () => { haptic("light"); runAction(this, h, legacy || defaultTapAction(cfg.entity), { entity: cfg.entity }); },
        hold: () => runAction(this, h, cfg.hold_action || { action: "more-info" }, { entity: cfg.entity }),
      });
    }
    for (const it of items) {
      const act = this._rowOf(el, it.key, "act",
        `${it.icon ? `<ha-icon icon="${it.icon}"></ha-icon>` : "<ha-state-icon></ha-state-icon>"}<span></span>`);
      if (!act.__wired) {
        act.__wired = true;
        this._pressable(act, new Spring(0, MOTION.press, "x"), () => act.__tap(), () => act.__hold());
      }
      act.__tap = it.tap; act.__hold = it.hold;
      put(act, "--ac", it.color);
      attr(act, "data-on", it.on ? "" : null);
      text(act.querySelector("span"), it.label);
      const icon = act.querySelector("ha-state-icon");
      if (icon && icon.stateObj !== it.state) { icon.hass = h; icon.stateObj = it.state; }
    }
    const keys = new Set(items.map((i) => i.key));
    for (const [key, node] of el.__rows || []) node.hidden = !keys.has(key);
    el.hidden = !items.length;
  }

  // ---------- history ----------
  // The chart's lines: the configured sensors, else the A/C's own current temperature and
  // humidity (read from its attribute history, as "attr:<attribute>").
  _historyIds() {
    const c = this._config, a = this._hass.states[c.entity]?.attributes || {};
    if (c.history.entities) return [].concat(c.history.entities).filter((id) => this._hass.states[id]);
    const ids = [];
    if (c.temperature && this._hass.states[c.temperature]) ids.push(c.temperature);
    else if (a.current_temperature != null) ids.push("attr:current_temperature");
    if (c.humidity && this._hass.states[c.humidity]) ids.push(c.humidity);
    else if (!c.humidity && a.current_humidity != null) ids.push("attr:current_humidity");
    return ids;
  }

  _stateIds() {
    const c = this._config;
    if (!c.history.show_state) return [];
    return [].concat(c.history.state_entity || c.entity).filter((id) => this._hass.states[id]);
  }

  async _loadHistory(force = false) {
    if (this._compact) return;
    const ids = this._historyIds().concat(this._stateIds());
    if (!ids.length) { this._series = []; this._bands = null; this._chartDirty = true; this._wake(); return; }
    const key = `${ids.join(",")}|${this._hours}`;
    const now = Date.now();
    if (!force && this._histKey === key && now - (this._histAt || 0) < 60000) return;
    this._histKey = key;
    this._histAt = now;
    if (this._loading) return;
    this._loading = true;
    try {
      const real = ids.filter((id) => !id.startsWith("attr:"));
      const raw = real.length ? await fetchHistory(this._hass, real, this._hours) : {};
      for (const id of ids.filter((x) => x.startsWith("attr:"))) {
        raw[id] = await fetchAttributeHistory(this._hass, this._config.entity, id.slice(5), this._hours);
      }
      this._raw = raw;
      this._buildSeries();
      this._error = null;
    } catch (err) {
      this._error = "History is unavailable. The recorder may not be keeping these entities.";
      this._series = [];
    }
    this._loading = false;
    this._chartDirty = true;
    this._sp.reveal.snap(0);
    this._sp.reveal.to(1, MOTION.graph);
    this._legend();
    this._wake();
  }

  // The A/C's own history is not a number, so it becomes a band of runs under the chart.
  _buildBands() {
    const id = this._stateIds()[0];
    const rows = id && this._raw?.[id];
    if (!rows?.length) { this._bands = null; return; }
    const [start, end] = this._span;
    const runs = [];
    for (const r of rows) {
      const state = r.s ?? r.state;
      const lu = r.lu ?? r.last_updated ?? r.last_changed;
      const t = typeof lu === "number" ? lu * 1000 : Date.parse(lu);
      if (!Number.isFinite(t)) continue;
      const prev = runs[runs.length - 1];
      if (prev && prev.state === state) continue;
      const t0 = clamp(t, start, end);
      if (prev) prev.t1 = t0;
      runs.push({ t0, t1: end, state });
    }
    const live = this._hass.states[id]?.state;
    const last = runs[runs.length - 1];
    if (last && live && last.state !== live) {
      last.t1 = end;
      runs.push({ t0: end, t1: end, state: live });
    }
    this._bands = {
      id,
      runs: runs.filter((r) => r.t1 > r.t0),
      hidden: this._hidden?.has(id) || false,
      state: live,
      color: rgbStr(toRgb(HVAC[live]?.color || "#8A9099")),
    };
  }

  _buildSeries() {
    const c = this._config, h = this._hass;
    const ids = this._historyIds();
    const end = Date.now(), start = end - this._hours * 3600000;
    const out = [];
    ids.forEach((id, i) => {
      const rows = this._raw?.[id] || [];
      const pts = [];
      for (const r of rows) {
        const v = parseFloat(r.s ?? r.state);
        const lu = r.lu ?? r.last_updated ?? r.last_changed;
        const t = typeof lu === "number" ? lu * 1000 : Date.parse(lu);
        if (Number.isFinite(v) && Number.isFinite(t)) pts.push({ t, v });
      }
      // append the live value so the line always runs up to now
      const live = id.startsWith("attr:") ? parseFloat(h.states[c.entity]?.attributes[id.slice(5)]) : parseFloat(h.states[id]?.state);
      if (Number.isFinite(live)) pts.push({ t: end, v: live });
      if (pts.length < 2) return;
      const isHum = id === c.humidity || /humidity/.test(id);
      out.push({
        id,
        name: isHum ? (c.humidity_name || "Humidity") : (c.temperature_name || "Temperature"),
        unit: h.states[id]?.attributes.unit_of_measurement || (isHum ? "%" : this._unit),
        digits: isHum ? 0 : 1,
        kind: isHum ? "humidity" : "temperature",
        points: this._resample(pts, start, end),
        hidden: this._hidden?.has(id) || false,
      });
    });
    for (const s of out) {
      const vals = s.points.map((p) => p.v);
      s.min = Math.min(...vals);
      s.max = Math.max(...vals);
      s.avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      s.last = vals[vals.length - 1];
      s.minAt = s.points[vals.indexOf(s.min)];
      s.maxAt = s.points[vals.indexOf(s.max)];
      s.color = s.kind === "humidity" ? rgbStr(this._humColor) : rgbStr(scaleColor(this._scale, s.last));
    }
    this._series = out;
    this._span = [start, end];
    this._buildBands();
  }

  // even buckets, averaged: keeps the line honest and the path short enough to redraw cheaply
  _resample(points, start, end, buckets = 120) {
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
      if (held == null) continue;       // nothing recorded yet at this point in time
      out.push({ t: start + (i + 0.5) * width, v: held });
    }
    return out;
  }

  _legend() {
    const el = this._el.legend;
    const band = this._bands;
    if (band) {
      const key = this._rowOf(el, band.id, "key",
        `<span class="v"></span><span class="k"><i></i><em></em></span>`);
      if (!key.__wired) {
        key.__wired = true;
        key.style.order = "-1";
        this._pressable(key, new Spring(0, MOTION.press, "x"), () => this._toggleSeries(band.id));
      }
      put(key, "--kc", band.color);
      attr(key, "data-off", band.hidden ? "" : null);
      text(key.querySelector("em"), this._config.state_name || "A/C");
      text(key.querySelector(".v"), this._label(band.state));
    }
    for (const s of this._series) {
      const key = this._rowOf(el, s.id, "key",
        `<span class="v"></span><span class="k"><i></i><em></em></span>`);
      if (!key.__wired) {
        key.__wired = true;
        key.style.order = "-1";
        this._pressable(key, new Spring(0, MOTION.press, "x"), () => this._toggleSeries(s.id));
      }
      key.__series = s;
      put(key, "--kc", s.color);
      attr(key, "data-off", s.hidden ? "" : null);
      text(key.querySelector("em"), s.name);
      this._legendValue(key, s, null);
    }
    const keys = new Set(this._series.map((s) => s.id));
    if (band) keys.add(band.id);
    for (const [key, node] of el.__rows || []) node.hidden = !keys.has(key);
  }

  _legendValue(key, s, at) {
    const p = at != null ? s.points[at] : null;
    const v = p ? p.v : s.last;
    text(key.querySelector(".v"), `${this._fmt(v, s.digits)}${s.unit}`);
  }

  _toggleSeries(id) {
    this._hidden = this._hidden || new Set();
    const isBand = this._bands?.id === id;
    if (this._hidden.has(id)) this._hidden.delete(id);
    else if (isBand || this._series.filter((s) => !s.hidden).length > 1) this._hidden.add(id);
    else return;                       // never hide the last visible line
    for (const s of this._series) s.hidden = this._hidden.has(s.id);
    if (this._bands) this._bands.hidden = this._hidden.has(this._bands.id);
    this._haptic("selection");
    this._legend();
    this._chartDirty = true;
    this._wake();
  }

  // ---------- frames ----------
  _wake() { if (this._root && this.isConnected) Clock.add(this._job); }

  _frame(now, dt) {
    const dirty = new Set();
    const still = this._reduced && !this._dragging;
    for (const s of this._springs) {
      if (s.idle) continue;
      if (still) s.snap();               // jump to the end state instead of travelling
      else s.step(dt);
      dirty.add(s.group);
    }
    if (this._chartDirty) { dirty.add("chart"); this._chartDirty = false; }
    if (!dirty.size) return false;
    this._paint(now, dirty);
    return true;
  }

  _paint(now, dirty) {
    const all = !dirty, sp = this._sp, el = this._el, red = this._reduced;

    if (all || dirty.has("page")) {
      const W = this._W || el.pager.clientWidth || 1;
      put(el.track, "transform", `translate3d(${(-sp.page.x * W).toFixed(2)}px,0,0)`);
      // the page being left dims slightly, so depth reads even without a shadow
      const away = Math.abs(sp.page.x);
      put(el.p0, "opacity", away > 0.002 ? (1 - 0.55 * clamp(away)).toFixed(3) : "");
      put(el.p1, "opacity", away < 0.998 ? (0.45 + 0.55 * clamp(away)).toFixed(3) : "");
    }
    if (all || dirty.has("power")) this._press(el.power, sp.power.x, 0.06, red);
    if (all || dirty.has("step")) {
      this._press(el.minus, sp.minus.x, 0.1, red);
      this._press(el.plus, sp.plus.x, 0.1, red);
    }
    if (all || dirty.has("target")) this._paintTarget(red);
    if (all || dirty.has("modes")) this._paintPill(el.modes, sp.modeX, sp.modeW);
    if (all || dirty.has("ranges")) this._paintPill(el.ranges, sp.rangeX, sp.rangeW);
    if (all || dirty.has("chart")) this._paintChart();
  }

  _press(el, p, depth, red) {
    put(el, "transform", red || Math.abs(p) < 1e-4 ? "" : `scale(${(1 - depth * p).toFixed(4)})`);
    put(el, "opacity", red && p > 1e-3 ? (1 - 0.2 * p).toFixed(3) : "");
  }

  _paintPill(root, sx, sw) {
    const pill = root.querySelector(".pill");
    if (!pill) return;
    const w = Math.max(0, sw.x);
    put(pill, "opacity", w < 1 ? "0" : "");
    put(pill, "width", `${w.toFixed(2)}px`);
    put(pill, "transform", `translate3d(${sx.x.toFixed(2)}px,0,0)`);
  }

  _paintTarget(red) {
    const sp = this._sp, el = this._el;
    const v = clamp(sp.target.x, this._min, this._max);
    text(el.value, this._fmt(v, this._step >= 1 ? 0 : 1));

    const t = (v - this._min) / Math.max(1e-6, this._max - this._min);
    put(el.fill, "transform", `scaleX(${t.toFixed(4)})`);
    let c = scaleColor(this._scale, v);
    if (!this._running) {
      const grey = (c[0] + c[1] + c[2]) / 3;
      c = c.map((x) => lerp(grey, x, 0.32));       // set, but nothing is running
    }
    put(el.fill, "background",
      `linear-gradient(90deg, ${rgbStr(c.map((x) => lerp(x, 255, 0.28)))}, ${rgbStr(c)})`);

    // the bar thickens under the finger, the way iOS sliders do
    const g = clamp(sp.grab.x);
    put(el.bar, "transform", red ? "" : `scaleY(${(1 + 0.5 * g).toFixed(3)})`);
    put(el.value, "transform", red ? "" : `scale(${(1 + 0.02 * g).toFixed(4)})`);
    put(el.value, "transformOrigin", "0% 60%");

    if (this._roomV != null) {
      const rt = clamp((this._roomV - this._min) / Math.max(1e-6, this._max - this._min));
      put(el.now, "left", `${(rt * 100).toFixed(2)}%`);
    }
  }

  // ---------- chart ----------
  _setMarkers(html) {
    const svg = this._el.svg;
    if (svg.__markers === html) return;
    svg.__markers = html;
    let g = this._root.getElementById("markers");
    if (!g) {
      g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.id = "markers";
      svg.appendChild(g);
    }
    g.innerHTML = html;
  }

  _clock(t) {
    const d = new Date(t);
    const opts = this._hours > 48
      ? { weekday: "short" }
      : { hour: "numeric", minute: "2-digit" };
    try { return new Intl.DateTimeFormat(this._hass.locale?.language || undefined, opts).format(d); }
    catch (err) { return d.toLocaleTimeString(); }
  }

  _paintChart() {
    const el = this._el, W = this._cw, H = this._ch;
    const visible = this._series.filter((s) => !s.hidden && s.points.length > 1);
    el.empty.hidden = !!visible.length;
    if (!visible.length) {
      text(el.empty, this._error || (this._loading ? "Loading history" : "No history yet"));
      if (el.svg.__key !== "empty") { el.svg.__key = "empty"; el.svg.innerHTML = ""; }
      put(el.cursor, "opacity", "0");
      put(el.bubble, "opacity", "0");
      return;
    }
    if (!W || !H) return;

    const band = this._bands && !this._bands.hidden && this._bands.runs.length ? this._bands : null;
    const PT = 16, PB = 8 + (band ? BAND_H + BAND_GAP : 0);   // extrema labels, then the state band
    const [t0, t1] = this._span;
    const xOf = (t) => ((t - t0) / Math.max(1, t1 - t0)) * W;
    const geom = visible.map((s) => {
      const pad = Math.max((s.max - s.min) * 0.16, s.kind === "humidity" ? 2 : 0.4);
      const lo = s.min - pad, hi = s.max + pad;
      const yOf = (v) => PT + (1 - (v - lo) / Math.max(1e-6, hi - lo)) * (H - PT - PB);
      return { s, lo, hi, yOf, pts: s.points.map((p) => [xOf(p.t), yOf(p.v)]) };
    });
    this._geom = geom;

    const f = (v) => v.toFixed(2);
    // Catmull-Rom through the samples, converted to cubic beziers
    const linePath = (pts) => {
      let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
        d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} `
          + `${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
      }
      return d;
    };

    // the band sits on its own baseline under the lines, off states left as gaps
    let pre = "";
    if (band) {
      const y = H - BAND_H;
      pre += `<rect x="0" y="${f(y)}" width="${f(W)}" height="${f(BAND_H)}" rx="${f(BAND_H / 2)}"
        fill="currentColor" fill-opacity="0.07"></rect>`;
      for (const run of band.runs) {
        const meta = HVAC[run.state];
        if (!meta?.color) continue;                // off, unavailable: nothing to draw
        const x = xOf(run.t0), w = Math.max(2.5, xOf(run.t1) - x);
        pre += `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(BAND_H)}"
          rx="${f(BAND_H / 2)}" fill="${meta.color}" fill-opacity="0.92" clip-path="url(#reveal)"></rect>`;
      }
    }

    let defs = `<clipPath id="reveal"><rect id="revealRect" x="0" y="0" width="${f(W)}" height="${f(H + 4)}"></rect></clipPath>`;
    let body = "";
    geom.forEach((g, i) => {
      const { s, pts, lo, hi, yOf } = g;
      const d = linePath(pts);
      const primary = i === 0;
      if (s.kind === "temperature") {
        // one gradient, read down the value axis, shared by the line and its fill
        const stops = this._scale.map((st) => {
          const off = clamp((hi - st.value) / Math.max(1e-6, hi - lo));
          return { off, color: rgbStr(st.rgb) };
        }).sort((a, b) => a.off - b.off);
        if (!stops.length || stops[0].off > 0) stops.unshift({ off: 0, color: rgbStr(scaleColor(this._scale, hi)) });
        if (stops[stops.length - 1].off < 1) stops.push({ off: 1, color: rgbStr(scaleColor(this._scale, lo)) });
        defs += `<linearGradient id="g${i}" x1="0" y1="0" x2="0" y2="1">${
          stops.map((st) => `<stop offset="${f(st.off)}" stop-color="${st.color}"></stop>`).join("")}</linearGradient>`;
        defs += `<linearGradient id="f${i}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity="0.26"></stop>
          <stop offset="1" stop-color="#fff" stop-opacity="0"></stop></linearGradient>`;
        defs += `<mask id="m${i}"><rect x="0" y="0" width="${f(W)}" height="${f(H)}" fill="url(#f${i})"></rect></mask>`;
        body += `<path d="${d} L${f(W)} ${f(H + 4)} L0 ${f(H + 4)} Z" fill="url(#g${i})" mask="url(#m${i})" clip-path="url(#reveal)"></path>`;
      }
      const stroke = s.kind === "temperature" ? `url(#g${i})` : s.color;
      body += `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${primary ? 2.75 : 2}"
        stroke-linecap="round" stroke-linejoin="round" opacity="${primary ? 1 : 0.62}" clip-path="url(#reveal)"></path>`;

      if (primary) {
        const avgY = yOf(s.avg);
        body += `<line x1="0" y1="${f(avgY)}" x2="${f(W)}" y2="${f(avgY)}" stroke="currentColor"
          stroke-opacity="0.2" stroke-width="1" stroke-dasharray="2 4" clip-path="url(#reveal)"></line>`;
        for (const ex of [{ p: s.maxAt, v: s.max, up: true }, { p: s.minAt, v: s.min, up: false }]) {
          if (!ex.p) continue;
          const x = clamp(xOf(ex.p.t), 22, W - 22), y = yOf(ex.v);
          body += `<circle cx="${f(xOf(ex.p.t))}" cy="${f(y)}" r="2.75" fill="${s.color}"></circle>
            <text x="${f(x)}" y="${f(ex.up ? y - 8 : y + 15)}" text-anchor="middle" fill="currentColor"
              fill-opacity="0.55" font-size="10.5" font-weight="600">${this._fmt(ex.v, s.digits)}${s.unit}</text>`;
        }
      }
    });

    body = pre + body;
    const key = defs + body;
    if (el.svg.__key !== key) {
      el.svg.__key = key;
      el.svg.setAttribute("viewBox", `0 0 ${f(W)} ${f(H)}`);
      el.svg.innerHTML = `<defs>${defs}</defs>${body}`;
      el.svg.__markers = null;
    }
    const rect = this._root.getElementById("revealRect");
    if (rect) attr(rect, "width", f(Math.max(0.01, this._sp.reveal.x * W)));

    text(el.ax[0], this._clock(t0));
    text(el.ax[1], this._clock((t0 + t1) / 2));
    text(el.ax[2], "Now");

    // scrub readout
    const s = clamp(this._sp.scrub.x);
    put(el.cursor, "opacity", s < 1e-3 ? "0" : (s * 0.35).toFixed(3));
    put(el.bubble, "opacity", s < 1e-3 ? "0" : s.toFixed(3));
    if (s > 1e-3) {
      const x = clamp(this._sp.scrubX.x, 0, W);
      const idx = geom.map((g) => {
        let best = 0, bd = Infinity;
        g.pts.forEach((p, i) => { const d = Math.abs(p[0] - x); if (d < bd) { bd = d; best = i; } });
        return best;
      });
      put(el.cursor, "transform", `translateX(${f(x)}px)`);
      const dots = geom.map((g, i) => {
        const p = g.pts[idx[i]];
        return `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="4" fill="${g.s.color}"></circle>`
          + `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="7.5" fill="${g.s.color}" fill-opacity="0.2"></circle>`;
      }).join("");
      this._setMarkers(dots);
      const at = geom[0].s.points[idx[0]];
      const parts = [`<span class="t">${this._clock(at.t)}</span>`];
      if (band) {
        const t = t0 + (x / Math.max(1, W)) * (t1 - t0);
        const run = band.runs.find((r) => t >= r.t0 && t <= r.t1) || band.runs[band.runs.length - 1];
        const meta = HVAC[run.state];
        parts.push(`<span style="color:${meta?.color || "var(--secondary-text-color)"}">${
          this._label(run.state)}</span>`);
      }
      geom.forEach((g, i) => {
        const p = g.s.points[idx[i]];
        parts.push(`<span style="color:${g.s.color}">${this._fmt(p.v, g.s.digits)}${g.s.unit}</span>`);
        const kb = el.legend.__rows?.get(g.s.id);
        if (kb) this._legendValue(kb, g.s, idx[i]);
      });
      const html = parts.join("");
      if (el.bubble.__html !== html) { el.bubble.__html = html; el.bubble.innerHTML = html; }
      const bw = el.bubble.offsetWidth || 0;
      put(el.bubble, "left", `${f(clamp(x, bw / 2 + 2, Math.max(bw / 2 + 2, W - bw / 2 - 2)))}px`);
    } else if (el.bubble.__html) {
      this._setMarkers("");
      for (const g of geom) {
        const kb = el.legend.__rows?.get(g.s.id);
        if (kb) this._legendValue(kb, g.s, null);
      }
    }
  }
}

// the climate entities of an area, by name
function areaClimates(hass, area) {
  if (!hass || !area) return [];
  return pick(hass, areaEntities(hass, area), { domains: "climate" })
    .sort((a, b) => (hass.states[a].attributes.friendly_name || a).localeCompare(hass.states[b].attributes.friendly_name || b));
}

const EDITOR = defineEditor("savvy-climate-card", (hass, c) => {
  const found = hass && c.area ? areaClimates(hass, c.area) : [];
  const ent = hass?.states[c.entity || found[0]];
  const modes = ent?.attributes.hvac_modes || ["off", "cool", "heat", "fan_only", "dry", "heat_cool", "auto"];
  return [
    S.area(),
    // with several units in the area, choose one here; one alone is picked by itself
    found.length > 1
      ? { name: "entity", label: "Which unit", selector: { select: { mode: "dropdown", options: found.map((id) => ({ value: id, label: hass.states[id].attributes.friendly_name || id })) } } }
      : S.entity("entity", "Climate entity (instead of the area)", "climate"),
    S.grid(S.text("name", "Name"), S.select("layout", "Layout", [{ value: "full", label: "Full" }, { value: "compact", label: "Compact" }])),
    { name: "hvac_modes", label: "Modes to show", helper: "In this order. Empty: all the unit's modes.", selector: { select: { multiple: true, mode: "list", options: modes } } },
    S.grid(S.select("default_hvac_mode", "Power button turns on", modes.filter((m) => m !== "off")), S.bool("fan_control", "Fan button", null, true)),
    S.section("Readings", [
      S.entity("temperature", "Temperature sensor", "sensor", { helper: "Empty: the unit's own reading." }),
      S.entity("humidity", "Humidity sensor", "sensor", { helper: "Empty: the unit's own reading." }),
      S.entity("weather", "Outdoor weather", "weather"),
      S.grid(S.text("temperature_name", "Temperature label"), S.text("humidity_name", "Humidity label")),
    ]),
    { type: "expandable", name: "timer", title: "Timer", schema: [
      { name: "entity", label: "Timer", selector: { entity: { domain: "timer" } } },
      { name: "select", label: "Duration list (tap steps through it)", selector: { entity: { domain: "input_select" } } },
    ] },
    { type: "expandable", name: "history", title: "History (swipe left)", schema: [
      { name: "hours", label: "Opens on (hours)", selector: { number: { min: 1, max: 720, mode: "box" } } },
      { name: "show_state", label: "On/off band under the chart", selector: { boolean: {} } },
    ] },
    S.grid(S.text("state_name", "On/off band label"), S.text("humidity_color", "Humidity colour")),
    S.chips(),
  ];
});

registerCard("savvy-climate-card", ClimateCard, "Climate",
  "An A/C or thermostat: drag the target, pick the mode, and swipe for its history. Finds the room's unit for you.");
})();

// ===== cards/heading.js =====
(() => {
// savvy-heading-card: the first card in a room's section. The room's name and icon (from
// the area), its mode, its temperature, and a row of badges for what's going on in it:
// pinned entities first, then what the area has (presence and doors always, the rest while
// active). A heading, not a panel: no plate unless `filled: true`.
//
//   type: custom:savvy-heading-card
//   area: living_room            name / icon: from the area
//   navigation_path: /lovelace/living-room      (or tap_action on the title)
//   mode: input_select.living_room_mode
//   entities: [binary_sensor.front_door]        auto_discover: true
//   temperature: sensor.x | false               heading_style: title | subtitle

const BADGE_W = 30;          // icon plus spacing

const STYLE = `${BASE_CSS}
  ha-card { --mode: var(--secondary-text-color); display: block; background: none; border: 0; box-shadow: none;
    padding: 6px 4px 2px; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
  ha-card::after { display: none; }
  ha-card[data-filled] { padding: 12px 14px; border-radius: var(--radius);
    border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--line));
    background: var(--ha-card-background, var(--card-background-color)); box-shadow: var(--ha-card-box-shadow, none); }
  @supports (corner-shape: squircle) { ha-card[data-filled] { corner-shape: squircle; border-radius: calc(var(--radius) * 1.7); } }

  .row { display: flex; align-items: center; gap: 10px; min-width: 0; max-width: 100%; }
  .title { display: inline-flex; align-items: center; gap: 8px; min-width: 0; flex: 0 1 auto; max-width: 58%;
    padding: 2px 4px; margin: -2px -4px; border-radius: 9px; transform-origin: 0 50%; cursor: default; }
  .title[data-act] { cursor: pointer; }
  .title ha-icon { --mdc-icon-size: 20px; flex: none; display: flex; color: var(--secondary-text-color); }
  .title .n { min-width: 0; font-size: 20px; line-height: 26px; font-weight: 650; letter-spacing: -0.022em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ha-card[data-style="subtitle"] .title .n { font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.014em; }
  ha-card[data-style="subtitle"] .title ha-icon { --mdc-icon-size: 17px; }

  /* the mode chip: the overview pill, compressed to one line */
  .mode { flex: none; display: inline-flex; align-items: center; gap: 5px; min-width: 0; height: 26px; padding: 0 7px 0 6px; border-radius: 9px;
    background: color-mix(in oklab, var(--mode) 15%, transparent); color: color-mix(in oklab, var(--mode) 74%, var(--primary-text-color));
    font-size: 12px; line-height: 15px; font-weight: 600; letter-spacing: -0.004em; }
  .mode:not([data-c]) { background: var(--well); color: var(--secondary-text-color); }
  .mode ha-icon { --mdc-icon-size: 15px; flex: none; display: flex; }
  .mode .chev { --mdc-icon-size: 13px; opacity: 0.55; margin-inline-start: -2px; }
  .mode .swap { display: inline-flex; align-items: center; gap: 5px; min-width: 0; }
  .mode .swap span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @container (max-width: 300px) { .mode .swap span { display: none; } }

  /* Right-aligned while everything fits; once it doesn't, the row scrolls from the start
     (flex-end in a scroll container leaves the first items unreachable) and rests at the end. */
  .badges { position: relative; flex: 1 1 0; min-width: 34px; display: flex; align-items: center; justify-content: flex-end;
    height: 28px; padding: 6px 0; margin: -6px 0; overflow: hidden; }
  .badges[data-overflow] { justify-content: flex-start; overflow-x: auto; overscroll-behavior-x: contain; touch-action: pan-x;
    scrollbar-width: none; -webkit-mask-image: linear-gradient(to right, transparent 0, #000 26px); mask-image: linear-gradient(to right, transparent 0, #000 26px); }
  .badges::-webkit-scrollbar { display: none; }
  .badge { position: relative; flex: none; width: 0; height: 28px; outline: none; }
  .chip { position: absolute; top: 0; inset-inline-start: 0; width: 28px; height: 28px; border-radius: 50%;
    display: grid; place-items: center; color: var(--secondary-text-color); opacity: 0; }
  .chip::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: color-mix(in oklab, var(--bc) 22%, transparent); opacity: 0; }
  .badge[data-critical] .chip::before { opacity: var(--on, 0); }
  .chip ha-icon, .chip ha-state-icon { --mdc-icon-size: 19px; position: relative; display: flex; }
  :host([kbd]) .badge:focus-visible .chip { box-shadow: 0 0 0 2px var(--bc); }

  /* the temperature is a reading, so it keeps its number */
  .temp { flex: none; display: inline-flex; align-items: center; gap: 4px; padding: 2px 5px; margin-inline-end: 2px; border-radius: 8px;
    color: var(--secondary-text-color); font-size: 12.5px; line-height: 16px; font-weight: 600; letter-spacing: -0.006em; }
  .temp ha-icon { --mdc-icon-size: 17px; display: flex; color: var(--tc, var(--secondary-text-color)); }
  :host([kbd]) :focus-visible { outline-color: color-mix(in oklab, var(--mode) 80%, var(--primary-text-color)); }
  @media (prefers-contrast: more) { .temp { color: var(--primary-text-color); } }
`;

// A reading worth noticing warms up; a comfortable one stays quiet.
const tempColor = (t) => {
  const c = /F/.test(t.unit) ? (t.value - 32) * 5 / 9 : t.value;
  return c >= 30 ? "#EE7B4D" : c >= 26 ? "#E8B44F" : c <= 18 ? "#4F93DE" : "";
};
const tempText = (t) => `${t.value.toFixed(1)}${t.unit.includes("°") ? "°" : ` ${t.unit}`}`;

class SavvyHeadingCard extends SavvyCard {
  static getStubConfig(hass) {
    const a = allAreas(hass).find((x) => areaEntities(hass, x.id).length);
    return a ? { area: a.id } : { name: "Heading" };
  }
  static getConfigElement() { return document.createElement(EDITOR); }

  setConfig(config) {
    if (!config || (!config.area && !config.name && !config.heading)) throw new Error("savvy-heading-card: set an area (or a name)");
    this._config = legacyBadges({ heading_style: "title", ...config, name: config.name || config.heading });
    if (this.shadowRoot && this._el) { this._build(); if (this._hass) this._update(); }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._el) this._build();
    this._update();
    this._list?.render(hass);
    if (this._picker?.isOpen) this._picker.render(this._modeInfo(), this._caption());
  }

  connectedCallback() { this._observe(); this._wake(); }
  getCardSize() { return 1; }
  getGridOptions() { return { columns: 12, rows: "auto", min_columns: 4 }; }

  _modeInfo() { return this._hass && modeInfo(this._hass, this._config.mode, this._config); }
  _caption() { return this._config.mode_label ?? "Mode"; }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._resetMotion();
    this._picker?.close();
    this._picker = null;
    this._first = true;
    this._lastWidth = 0;
    this._badges = new Map();
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="row">
          <div class="title" id="title"><ha-icon id="icon" hidden></ha-icon><span class="n" id="name"></span></div>
          <button class="mode" id="mode" hidden>
            <span class="swap" id="modeSwap"><ha-icon id="modeIcon"></ha-icon><span id="modeText"></span></span>
            <ha-icon class="chev" icon="mdi:chevron-down"></ha-icon>
          </button>
          <div class="badges" id="badges"><span class="temp" id="temp" role="button" tabindex="0" hidden><ha-icon icon="mdi:thermometer"></ha-icon><span id="tempText"></span></span></div>
        </div>
      </ha-card>`;
    const $ = (id) => root.getElementById(id);
    this._el = { card: root.querySelector("ha-card"), title: $("title"), icon: $("icon"), name: $("name"), mode: $("mode"),
      modeSwap: $("modeSwap"), modeIcon: $("modeIcon"), modeText: $("modeText"), badges: $("badges"), temp: $("temp"), tempText: $("tempText") };
    const c = this._config, el = this._el;
    attr(el.card, "data-style", c.heading_style === "subtitle" ? "subtitle" : "title");
    attr(el.card, "data-filled", !!c.filled);

    // the title: navigates (navigation_path) or whatever tap_action says
    const tap = c.tap_action || (c.navigation_path ? { action: "navigate", navigation_path: c.navigation_path } : null);
    if (tap || c.hold_action) {
      attr(el.title, "data-act", true);
      attr(el.title, "role", "button");
      attr(el.title, "tabindex", "0");
      this._chipActions(el.title, () => ({ config: { tap_action: tap, hold_action: c.hold_action, double_tap_action: c.double_tap_action } }), {}, 0.04);
    }

    this._swap = new Swap(el.modeSwap, (v) => {
      const info = this._modeInfo();
      text(el.modeText, info?.label || v);
      attr(el.modeIcon, "icon", info?.icon);
    }, "mode");
    this._springs.push(this._swap.spring);
    wireModeChip(this, el.mode, () => el.card, () => this._caption());
    this._pressable(el.temp, { onTap: () => moreInfo(this, this._temp?.entity) });
    this._observe();
  }

  _observe() {
    if (!this._el || !this.isConnected) return;
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => { this._fitBadges(); this._wake(); });
    this._ro.observe(this._el.badges);
  }

  _update() {
    const h = this._hass, c = this._config, el = this._el;
    if (!h || !el) return;
    const area = c.area ? areaInfo(h, c.area) : null;
    text(el.name, c.name || area?.name || "");
    const icon = c.icon ?? area?.icon;
    el.icon.hidden = !icon;
    if (icon) attr(el.icon, "icon", icon);
    attr(el.title, "aria-label", c.name || area?.name);

    // mode
    const info = this._modeInfo();
    el.mode.hidden = !info;
    if (info) {
      put(el.card, "--mode", info.color || "var(--secondary-text-color)");
      attr(el.mode, "data-c", !!info.color);
      attr(el.mode, "aria-label", `${this._caption()} ${info.label}`);
      el.mode.disabled = !info.options.length;
      this._swap.set(info.value);
    }

    // temperature
    const t = roomTemperature(h, c.area, c);
    this._temp = t;
    el.temp.hidden = !t;
    if (t) {
      text(el.tempText, tempText(t));
      put(el.temp, "--tc", tempColor(t) || "var(--secondary-text-color)");
      attr(el.temp, "aria-label", `Temperature ${t.value.toFixed(1)} ${t.unit}`);
    }

    this._renderBadges();
    if (this._first) {
      this._first = false;
      this._paintAll(null);
      requestAnimationFrame(() => this._fitBadges());
    }
    this._wake();
  }

  _renderBadges() {
    const h = this._hass, list = roomBadges(h, this._config.area, this._config);
    const seen = new Set(), red = MQ.reduced.matches;
    for (const b of list) {
      seen.add(b.key);
      let item = this._badges.get(b.key);
      const look = badgeLook(b);
      if (!item) {
        const node = document.createElement("span");
        node.className = "badge";
        node.setAttribute("role", "button");
        node.innerHTML = `<span class="chip">${look.icon ? "<ha-icon></ha-icon>" : "<ha-state-icon></ha-state-icon>"}</span>`;
        item = { el: node, chip: node.querySelector(".chip"), icon: node.querySelector("ha-icon, ha-state-icon"),
          shown: this._spring(0, MOTION.ui, `badge:${b.key}`, 0.002), on: this._spring(0, MOTION.ui, `badge:${b.key}`, 0.002) };
        item.b = b;
        this._chipActions(node, () => ({ config: item.b.cfg, entity: item.b.entity,
          list: () => this._showList(item.b.kind?.name || shortName(h, item.b.entity), item.b.ids, badgeLook(item.b).color, node) }), badgeDefaults(b), 0.12);
        this._badges.set(b.key, item);
      }
      item.b = b;
      const st = h.states[b.entity];
      if (look.icon) attr(item.icon, "icon", look.icon);
      else if (item.icon.stateObj !== st) { item.icon.hass = h; item.icon.stateObj = st; }
      put(item.el, "--bc", look.color || "var(--primary-text-color)");
      attr(item.el, "data-critical", look.critical);
      attr(item.el, "aria-label", `${b.cfg.name || shortName(h, b.entity, this._config.area)}, ${stateText(h, st)}`);
      if (look.spin) {
        const spin = this._spinner(b.key, item.icon);
        spin.s.to(b.on && climateRunning(st) && !red ? fanRate(st) : 0);
        if (red) spin.s.snap();
      }
      if (item.shown.target !== 1) this._rowDirty = true;
      item.shown.to(1);
      item.on.to(b.on ? 1 : 0);
      if (this._first || red) { item.shown.snap(); item.on.snap(); }
      item.el.tabIndex = 0;
      attr(item.el, "aria-hidden", "false");
    }
    for (const [key, item] of this._badges) {
      if (seen.has(key)) continue;
      if (item.shown.target !== 0) this._rowDirty = true;
      item.shown.to(0);
      item.on.to(0);
      if (red) { item.shown.snap(); item.on.snap(); }
      this._spins.get(key)?.s.to(0);
      item.el.tabIndex = -1;
      attr(item.el, "aria-hidden", "true");
    }
    // DOM order follows the list: the temperature, pinned, then kinds in reading order
    const want = [this._el.temp, ...list.map((b) => this._badges.get(b.key).el)];
    const leaving = [...this._badges.values()].filter((i) => !seen.has(i.b.key)).map((i) => i.el);
    const kids = [...this._el.badges.children];
    if (want.some((n, i) => kids[i] !== n)) for (const n of [...want, ...leaving]) this._el.badges.appendChild(n);
  }

  _fitBadges() {
    const row = this._el?.badges;
    if (!row) return;
    // right-aligned content that overflows spills off the start, where no scroll area
    // exists, so scrollWidth can't be trusted: add the children up
    let content = 0;
    for (const child of row.children) {
      if (child.hidden) continue;
      const cs = getComputedStyle(child);
      content += child.getBoundingClientRect().width + (parseFloat(cs.marginInlineStart) || 0) + (parseFloat(cs.marginInlineEnd) || 0);
    }
    const over = content > row.clientWidth + 1;
    row.toggleAttribute("data-overflow", over);
    if (over && Math.abs(this._lastWidth - content) > 1) {
      const go = () => { row.scrollLeft = row.scrollWidth; };
      requestAnimationFrame(go);
      clearTimeout(this._pinTimer);
      this._pinTimer = setTimeout(go, 180);
    }
    this._lastWidth = over ? content : 0;
  }

  _paint(dirty, all, red) {
    if (all || dirty.has("mode")) this._swap.paint(red);
    const idle = MQ.contrast.matches ? 0.7 : 0.45;
    for (const [key, item] of this._badges) {
      if (!all && !dirty.has(`badge:${key}`)) continue;
      const shown = clamp(item.shown.x), on = clamp(item.on.x);
      // joining: visible early; leaving: transparent while it travels
      const vis = item.shown.target === 1 ? Math.sqrt(shown) : shown * shown;
      put(item.el, "width", `${(shown * BADGE_W).toFixed(2)}px`);
      put(item.chip, "opacity", (vis * (idle + (1 - idle) * on)).toFixed(3));
      put(item.chip, "transform", red ? "" : `scale(${(0.6 + 0.4 * shown).toFixed(4)})`);
      put(item.chip, "--on", on.toFixed(3));
      put(item.chip, "color", on > 1e-3 ? `color-mix(in oklab, var(--bc) ${(on * 100).toFixed(1)}%, var(--secondary-text-color))` : "");
    }
    if (this._rowDirty && [...this._badges.values()].every((i) => i.shown.idle)) {
      this._rowDirty = false;
      this._fitBadges();
    }
  }
}

// ---------- editor ----------
const EDITOR = defineEditor("savvy-heading-card", (hass, c) => [
  S.area(),
  S.grid(S.text("name", "Name"), S.icon("icon", "Icon")),
  { name: "navigation_path", label: "Tapping the name opens", helper: "A dashboard path, e.g. /lovelace/living-room. Or set a tap action below.", selector: { text: {} } },
  S.grid(S.select("heading_style", "Style", [{ value: "title", label: "Title" }, { value: "subtitle", label: "Subtitle" }]),
    S.bool("filled", "On a card background", null, false)),
  ...modeSchema(hass, c),
  { name: "temperature", label: "Temperature", helper: "Found from the area (a temperature sensor, else its climate unit). Pick another to override.",
    selector: { entity: { domain: ["sensor", "climate"] } } },
  ...badgeSchema(),
  S.section("Title actions", [S.action("tap_action", "Tap"), S.action("hold_action", "Hold")]),
]);

registerCard("savvy-heading-card", SavvyHeadingCard, "Heading",
  "A room's section heading: its name, mode, temperature and live status badges.");
})();

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
  .titles { display: flex; flex-direction: column; min-width: 0; }
  .when { font-size: 11.5px; line-height: 15px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .group { display: flex; align-items: baseline; gap: 6px; }
  .group .gs[data-ok] { color: var(--lvl-good); }
  .group .gw { margin-inline-start: auto; font-weight: 500; letter-spacing: 0; text-transform: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
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

  connectedCallback() {
    this._wake();
    this._ticker = this._ticker || setInterval(() => this._tickWhen(), 30000);
  }
  disconnectedCallback() { Clock.remove(this._job); this._ro?.disconnect(); clearInterval(this._ticker); this._ticker = 0; }

  // "Checked 2 h ago": under the title for the Watchman source, on its group in "all"
  _tickWhen() {
    if (!this._el) return;
    const st = this._lastRun && this._hass?.states[this._lastRun];
    const t = st ? Date.parse(st.state) : NaN;
    const words = Number.isFinite(t) ? `Checked ${since(t, false)}` : "";
    const tip = Number.isFinite(t) ? clockTime(t, langOf(this._hass)) : null;
    const under = this._config.source === "watchman";
    this._el.when.hidden = !under || !words;
    text(this._el.when, under ? words : "");
    attr(this._el.when, "title", under ? tip : null);
    for (const node of this._rows.values()) {
      if (!node.__lastRun) continue;
      text(node.querySelector(".gw"), words);
      attr(node.querySelector(".gw"), "title", tip);
    }
  }
  getCardSize() { return 3; }
  getGridOptions() { return { columns: 6, min_columns: 4, rows: "auto" }; }

  _build() {
    this._root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._springs = [];
    this._pressNodes = [];
    this._rows.clear();
    this._root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="head"><span class="titles"><span class="name" id="name"></span><span class="when" id="when" hidden></span></span><span class="pill" id="pill"></span></div>
        <div class="empty" id="empty" hidden><ha-icon icon="mdi:check-circle-outline"></ha-icon><span>All good</span></div>
        <div class="rows" id="rows"></div>
        <button class="action" id="action" hidden></button>
      </ha-card>`;
    const $ = (id) => this._root.getElementById(id);
    this._el = { card: this._root.querySelector("ha-card"), name: $("name"), when: $("when"), pill: $("pill"), empty: $("empty"), rows: $("rows"), action: $("action") };
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
    // every category shows, with its count or All good (Watchman when its sensors are set)
    const rows = [];
    for (const key of ["watchman", "unavailable", "battery"]) {
      if (key === "watchman" && !sum.opts.watchman.length) continue;
      const list = key === "battery" ? sum.battery.filter((r) => r.alert) : sum[key];
      rows.push({ key: `g:${key}`, group: GROUP_TITLE[key], count: sum.counts[key], lastRun: key === "watchman" });
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
    this._lastRun = c.source === "all" || c.source === "watchman" ? watchmanLastRun(h, c) : null;
    this._renderRows(rows);
    this._tickWhen();     // after the rows: the Watchman group shows it too
    this._wake();
  }

  _renderRows(rows) {
    const box = this._el.rows, seen = new Set();
    for (const r of rows) {
      seen.add(r.key);
      let node = this._rows.get(r.key);
      if (!node) {
        node = document.createElement("div");
        if (r.group) {
          node.className = "group";
          node.innerHTML = `<span class="gt"></span><span class="gs"></span><span class="gw"></span>`;
        }
        else {
          node.className = "row";
          node.innerHTML = `<span class="disc"><ha-icon></ha-icon></span><span class="col"><span class="n"></span><span class="s"></span></span><span class="v" hidden></span>`;
          node.__el = { icon: node.querySelector("ha-icon"), n: node.querySelector(".n"), s: node.querySelector(".s"), v: node.querySelector(".v") };
          node.__enter = new Spring(0, MOTION.ui, `row:${r.key}`).to(1, MOTION.ui);
          this._springs.push(node.__enter);
        }
        this._rows.set(r.key, node);
      }
      if (r.group) {
        text(node.querySelector(".gt"), r.group);
        text(node.querySelector(".gs"), r.count ? `· ${r.count}` : "· All good");
        attr(node.querySelector(".gs"), "data-ok", !r.count);
        node.__lastRun = r.lastRun;
        box.appendChild(node);
        continue;
      }
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
  { name: "watchman_last_run", label: "Watchman's last-run sensor", helper: "Found automatically (Watchman's last parse). Pick another to override.",
    selector: { entity: { domain: "sensor", device_class: "timestamp" } } },
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

// ===== cards/home.js =====
(() => {
// savvy-home-card: the header at the top of the home dashboard. Two big chips on top, the
// house's mode (tap to change it) and its health (the cog, with a count); the weather; and
// four chips that count by themselves, no helpers needed: lights on, the average indoor
// temperature, what's playing, and security. Hold any of them for the entities behind it.
//
//   type: custom:savvy-home-card
//   mode: input_select.house_mode                   (never guessed; hidden when unset)
//   weather: auto | weather.home | false
//   health: { navigation_path: /lovelace/admin, watchman: [...], battery_threshold: 20 } | false
//   lights / climate / media / security: false | { entity, name, icon, color, tap_action, hold_action }
//   chips: [...]                                     your own, after the four

const STYLE = `${BASE_CSS}${HEADER_CSS}${CHIP_ROW_CSS}
  .health-sheet savvy-health-card { --ha-card-border-width: 0px; --ha-card-background: transparent; --ha-card-box-shadow: none; margin: -14px -14px 0; }
`;

// The four chips: how each counts, and its look.
const AUTO = {
  lights: { name: "Lights", icon: "mdi:lightbulb", color: "#F5B83D" },
  climate: { name: "Climate", icon: "mdi:fan", color: "#7FC4E8" },
  media: { name: "Media", icon: "mdi:multimedia", color: "#C98BD9" },
  security: { name: "Security", icon: "mdi:shield-home", color: "#E6C48F" },
};

class SavvyHomeCard extends SavvyCard {
  // the mode is never guessed: its options (and their icons in the editor) only appear
  // once an input_select is chosen
  static getStubConfig() { return {}; }
  static getConfigElement() { return document.createElement(EDITOR); }

  setConfig(config) {
    const c = { mode_label: "Home mode", ...config };
    // the pre-Savvy names: home_mode, weather as { entity }, admin, tiles
    c.mode = config.mode ?? config.home_mode;
    if (config.weather && typeof config.weather === "object") c.weather = config.weather.entity;
    if (config.show_home === false) c.home_path = null;
    if (config.health === undefined && config.admin) {
      const a = config.admin;
      c.health = { navigation_path: a.path, watchman: a.watchman ?? a.entities, battery_threshold: a.battery_threshold,
        exclude_platforms: a.exclude_platforms, warn_above: a.warn_above };
    }
    if (config.tiles) {
      c.chips = [...[].concat(config.tiles).map((t) => (typeof t === "string" ? { entity: t } : t)), ...asItems(config.chips)];
      for (const k of Object.keys(AUTO)) if (config[k] === undefined) c[k] = false;
    }
    this._config = c;
    if (this._el) { this._build(); if (this._hass) this._update(); }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._el) this._build();
    this._update();
    this._list?.render(hass);
    if (this._healthCard) this._healthCard.hass = hass;
    if (this._picker?.isOpen) this._picker.render(this._modeInfo(), this._config.mode_label);
  }

  connectedCallback() { this._observe(); this._wake(); }
  getCardSize() { return 2; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: "auto" }; }

  _modeInfo() { return this._hass && modeInfo(this._hass, this._config.mode, this._config); }
  _healthCfg() { const hc = this._config.health; return hc === false ? null : hc || {}; }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._resetMotion();
    this._picker?.close();
    this._picker = null;
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="top">
          <button class="glyph" id="home" aria-label="Home" hidden><ha-icon icon="mdi:home"></ha-icon></button>
          <button class="pill" id="pill" hidden>
            <span class="swap" id="swap"><ha-icon id="pillIcon"></ha-icon><span class="col"><span class="val" id="val"></span><span class="pre" id="pre"></span></span></span>
          </button>
          <span class="spacer" id="spacer"></span>
          <button class="wx" id="weather" hidden><ha-state-icon id="wicon"></ha-state-icon><span class="deg" id="wtemp"></span></button>
          <button class="glyph" id="health" aria-label="System health" hidden><ha-icon icon="mdi:cog"></ha-icon><span class="count" id="count" hidden></span></button>
        </div>
        <div class="chips" id="chips"></div>
      </ha-card>`;
    const $ = (id) => root.getElementById(id);
    this._el = { card: root.querySelector("ha-card"), home: $("home"), pill: $("pill"), swap: $("swap"), pillIcon: $("pillIcon"), val: $("val"), pre: $("pre"),
      spacer: $("spacer"), weather: $("weather"), wicon: $("wicon"), wtemp: $("wtemp"), health: $("health"), count: $("count"), chips: $("chips") };
    const el = this._el;
    this._swap = new Swap(el.swap, (v) => {
      const info = this._modeInfo();
      text(el.val, info?.label || v);
      attr(el.pillIcon, "icon", info?.icon);
    }, "pill");
    this._springs.push(this._swap.spring);
    this._pressable(el.home, { onTap: () => navigate(this._config.home_path) });
    wireModeChip(this, el.pill, () => el.card, () => this._config.mode_label);
    this._pressable(el.weather, { onTap: () => moreInfo(this, this._weather) });
    // the cog: tap goes to its page (or lists what needs attention), hold always lists
    const hc = this._healthCfg() || {};
    this._chipActions(el.health, () => ({ config: { tap_action: hc.tap_action, hold_action: hc.hold_action }, list: () => this._showHealth() }),
      { tap: hc.navigation_path ? { action: "navigate", navigation_path: hc.navigation_path } : { action: "list" }, hold: { action: "list" } });
    this._observe();
  }

  _observe() {
    if (!this._el || !this.isConnected) return;
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => this._fitRow(this._el.chips));
    this._ro.observe(this._el.chips);
  }

  // The same list savvy-health-card shows, with the same options: its count is the cog's.
  _showHealth() {
    if (!this._healthSheet) {
      this._healthSheet = new Sheet(this, { title: "Health", onClose: () => { this._healthCard?.remove(); this._healthCard = null; } });
      this._healthSheet.el.classList.add("health-sheet");
    }
    const card = document.createElement("savvy-health-card");
    const { navigation_path, tap_action, hold_action, ...opts } = this._healthCfg() || {};
    card.setConfig({ ...opts, source: "all", max_rows: 30, title: " " });
    this._healthSheet.body.replaceChildren(card);
    card.hass = this._hass;
    this._healthCard = card;
    this._healthSheet.open(this._el.health);
  }

  _update() {
    const h = this._hass, c = this._config, el = this._el;
    if (!h || !el) return;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    el.home.hidden = !c.home_path;
    const info = this._modeInfo();
    this._renderPill(info, c.mode_label);
    el.spacer.hidden = !!info;
    this._renderWeather();
    this._renderHealth();
    this._renderChips();
    this._wake();
  }

  _renderWeather() {
    const h = this._hass, w = this._config.weather, el = this._el;
    const id = w === false ? null : typeof w === "string" && w !== "auto" ? w : Object.keys(h.states).find((x) => x.startsWith("weather."));
    const st = id && h.states[id];
    this._weather = st ? id : null;
    el.weather.hidden = !st;
    if (!st) return;
    if (el.wicon.stateObj !== st) { el.wicon.hass = h; el.wicon.stateObj = st; }
    const t = Number(st.attributes.temperature);
    text(el.wtemp, Number.isFinite(t) ? `${Math.round(t)}°` : "–");
    const cond = stateText(h, st);
    attr(el.weather, "aria-label", Number.isFinite(t) ? `Weather, ${cond}, ${Math.round(t)} degrees` : `Weather, ${cond}`);
  }

  // Exactly what savvy-health-card counts: Watchman, unavailable, low batteries.
  _renderHealth() {
    const hc = this._healthCfg(), el = this._el;
    el.health.hidden = !hc;
    if (!hc) return;
    const h = this._hass;
    if (this._sumFor !== h.states || this._sumReg !== h.entities) {
      this._sumFor = h.states;
      this._sumReg = h.entities;
      this._sum = healthSummary(h, hc);
    }
    const total = this._sum.total, warn = hc.warn_above ?? 6;
    put(el.health, "--ac", total === 0 ? "var(--secondary-text-color)" : total < warn ? "var(--lvl-warn)" : "var(--lvl-bad)");
    attr(el.health, "data-alert", total > 0);
    el.count.hidden = !total;
    text(el.count, String(total));
    attr(el.health, "aria-label", total ? `System health, ${total} need attention` : "System health, all good");
  }

  // The four that count by themselves (each can be false, or point at an entity), then yours.
  _renderChips() {
    const h = this._hass, c = this._config;
    const items = [];
    for (const key of Object.keys(AUTO)) {
      const cfg = c[key];
      if (cfg === false || cfg?.hide) continue;
      items.push(this._auto(key, cfg && typeof cfg === "object" ? cfg : typeof cfg === "string" ? { entity: cfg } : {}));
    }
    asItems(c.chips).forEach((x, i) => items.push(chipItem(h, x, i)));
    this._chipRow(this._el.chips, items);
  }

  _auto(key, cfg) {
    const h = this._hass, base = AUTO[key];
    const own = cfg.entity && h.states[cfg.entity];
    let value, ids, spin, listTitle = cfg.name || base.name;
    if (key === "lights") {
      const l = houseLights(h);
      value = l.on.length ? `${l.on.length} on` : "Off";
      ids = l.on.length ? l.on : l.all;
      listTitle = l.on.length ? "Lights on" : "Lights";
    } else if (key === "media") {
      const m = housePlaying(h);
      value = m.on.length ? `${m.on.length} playing` : "Idle";
      ids = m.on.length ? m.on : m.all;
    } else if (key === "climate") {
      const t = houseTemperature(h);
      value = t.value == null ? "–" : `${t.value.toFixed(1)}${t.unit}`;
      ids = t.ids;
      spin = t.running.length ? fanRate(h.states[t.running[0]]) : 0;
    } else {
      const s = houseSecurity(h);
      value = s.entity ? stateText(h, h.states[s.entity]) : s.open.length ? `${s.open.length} open` : "Secure";
      ids = s.open.length ? [...(s.entity ? [s.entity] : []), ...s.open] : s.ids;
    }
    if (own) value = stateText(h, own);
    const snapshot = [...ids];     // what was counted when opened: turning one off keeps its row
    return {
      key, icon: cfg.icon || base.icon, entity: cfg.entity, color: colorOf(cfg.color) || base.color,
      value, caption: cfg.name || base.name, aria: `${cfg.name || base.name}, ${value}`,
      spin: key === "climate" ? spin : undefined,
      config: { ...cfg, tap_action: cfg.tap_action ?? (cfg.navigation_path ? { action: "navigate", navigation_path: cfg.navigation_path } : undefined) },
      defaults: { tap: { action: "list" }, hold: { action: "list" } },
      list: (from) => this._showList(listTitle, snapshot, cfg.color ? colorOf(cfg.color) : base.color, from),
    };
  }

  _paint(dirty, all, red) {
    if (all || dirty.has("pill")) this._swap.paint(red);
  }
}

// ---------- editor ----------
const autoSection = (key, what) => ({ type: "expandable", name: key, title: `${AUTO[key].name} chip`, schema: [
  { name: "hide", label: "Hide this chip", selector: { boolean: {} } },
  { name: "entity", label: "Show this entity instead", helper: `Empty: ${what}`, selector: { entity: {} } },
  { type: "grid", name: "", schema: [{ name: "name", label: "Name", selector: { text: {} } }, { name: "icon", label: "Icon", selector: { icon: { placeholder: AUTO[key].icon } } }] },
  { name: "color", label: "Colour", selector: { text: {} } },
  { name: "tap_action", label: "Tap (default: list them)", selector: { ui_action: {} } },
  { name: "hold_action", label: "Hold (default: list them)", selector: { ui_action: {} } },
] });

const EDITOR = defineEditor("savvy-home-card", (hass, c) => [
  ...modeSchema(hass, c, { helper: "The house mode: any input_select or select. Never guessed; empty hides the chip." }),
  { name: "home_path", label: "Home button opens", helper: "A dashboard path; empty hides the button.", selector: { text: {} } },
  { name: "weather", label: "Weather", helper: "Empty: the first weather entity.", selector: { entity: { domain: "weather" } } },
  { type: "expandable", name: "health", title: "Health cog", schema: [
    { name: "navigation_path", label: "Tapping opens", helper: "E.g. your admin page. Empty: tapping lists what needs attention (hold always does).", selector: { text: {} } },
    { name: "watchman", label: "Watchman sensors", selector: { entity: { multiple: true, domain: "sensor" } } },
    { type: "grid", name: "", schema: [
      { name: "battery_threshold", label: "Low battery below", selector: { number: { min: 1, max: 100, mode: "box", unit_of_measurement: "%" } } },
      { name: "warn_above", label: "Red from", selector: { number: { min: 1, max: 99, mode: "box" } } },
    ] },
    { name: "exclude_platforms", label: "Ignore integrations", selector: { select: { multiple: true, custom_value: true, options: ["mobile_app"] } } },
  ] },
  autoSection("lights", "counts the lights that are on."),
  autoSection("climate", "the average indoor temperature."),
  autoSection("media", "counts what's playing."),
  autoSection("security", "the alarm panel; with none, what's open or unlocked."),
  S.chips("chips", "Your chips", "After the four."),
]);

registerCard("savvy-home-card", SavvyHomeCard, "Home",
  "The home dashboard's header: the house mode, health, weather, and chips that count lights, climate, media and security by themselves.");
})();

// ===== cards/lights.js =====
(() => {
// savvy-lights-card: every light in a room (or several), found from the area registry,
// each with only the controls it supports: a toggle; a brightness bar; a swatch that opens
// warmth, colour and saturation. Order them in the editor; featured lights get wide tiles.
// The header pill is the room's all-on/off, or any entity of yours in its place.
//
//   type: custom:savvy-lights-card
//   area: living_room               (or areas: [...], or lights: [...])
//   toggle: { entity: input_boolean.room_lights }   show_toggle: true
//   featured: [light.ceiling]   order: [...]   exclude: [...]   chips: [...]



const WRITE_THROTTLE = 400;    // ms between service calls while dragging

const MOTION = {
  press:    { response: 0.12, damping: 1 },
  release:  { response: 0.3,  damping: 0.82 },
  pop:      { response: 0.34, damping: 0.58 },
  hold:     { response: 0.5,  damping: 1 },
  ui:       { response: 0.4,  damping: 1 },
  value:    { response: 0.34, damping: 1 },
  grab:     { response: 0.4,  damping: 1 },
  sheetIn:  { response: 0.38, damping: 0.82 },
  sheetOut: { response: 0.24, damping: 1 },
  tint:     { response: 0.55, damping: 1 },
};


// Light capabilities, read from the entity rather than assumed.
const DIMMABLE = new Set(["brightness", "color_temp", "hs", "xy", "rgb", "rgbw", "rgbww", "white"]);
const HUE_MODES = new Set(["hs", "xy", "rgb", "rgbw", "rgbww"]);
const modesOf = (st) => new Set(st?.attributes.supported_color_modes || []);
const canDim = (st) => [...modesOf(st)].some((m) => DIMMABLE.has(m));
const canTemp = (st) => modesOf(st).has("color_temp");
const canColor = (st) => [...modesOf(st)].some((m) => HUE_MODES.has(m));

// Kelvin to a believable screen colour, so the warmth slider looks like what it does.
const kelvinRgb = (k) => {
  const t = clamp(k, 1500, 8000) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.47 * Math.log(t) - 161.12;
    b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  } else {
    r = 329.7 * Math.pow(t - 60, -0.1332);
    g = 288.12 * Math.pow(t - 60, -0.0755);
    b = 255;
  }
  return [r, g, b].map((v) => Math.round(clamp(v, 0, 255)));
};

const hsRgb = (h, s, v = 1) => {
  h = ((h % 360) + 360) % 360;
  s = clamp(s);
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [f(5), f(3), f(1)];
};

const rgbHs = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, max ? d / max : 0];
};

const rgbStr = (rgb) => `rgb(${rgb.map((v) => Math.round(clamp(v, 0, 255))).join(" ")})`;

// Pull a bulb colour into a band that stays legible on both themes.
const legible = ([r, g, b]) => {
  const [h, s] = rgbHs([r, g, b]);
  if (s < 0.12) return null;
  return hsRgb(h, clamp(s, 0.42, 0.95), 0.98);
};


const STYLE = `
:host { display: block; -webkit-tap-highlight-color: transparent; }
[hidden] { display: none !important; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0;
  cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent; }

ha-card {
  --radius: var(--ha-card-border-radius, 18px);
  --pad: 14px;
  --amber: 245 184 61;
  --well: color-mix(in oklab, var(--primary-text-color) 6%, transparent);
  --line: color-mix(in oklab, var(--primary-text-color) 9%, transparent);
  position: relative;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
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
  overflow: hidden;
  isolation: isolate;
  container-type: inline-size;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  transition: background-color 240ms ease, border-color 240ms ease;
}
@supports (corner-shape: squircle) {
  ha-card { corner-shape: squircle; border-radius: calc(var(--radius) * 1.7); }
}
:host([dark]) ha-card::after {
  content: ""; position: absolute; inset: 0; z-index: 9;
  border-radius: inherit; corner-shape: inherit;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.05);
  pointer-events: none;
}

/* ---- header ---- */
header { display: flex; align-items: center; gap: 10px; min-width: 0; }
.titles { flex: 1; min-width: 0; }
.name { display: block; font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.014em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.count { display: block; font-size: 12.5px; line-height: 17px; font-weight: 500;
  color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.master {
  flex: none; display: inline-flex; align-items: center; gap: 7px; height: 34px;
  padding: 0 12px 0 10px; border-radius: 12px; background: var(--well);
  color: var(--secondary-text-color);
  font-size: 13px; line-height: 16px; font-weight: 550; letter-spacing: -0.004em;
}
.master ha-icon { --mdc-icon-size: 18px; display: flex; }
.master[data-on] { background: rgb(var(--amber) / 0.16); color: rgb(var(--amber)); }

/* ---- the lights ---- */
.grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
@container (min-width: 480px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (min-width: 900px) { .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }

.light {
  position: relative; overflow: hidden;
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px; border-radius: 15px;
  background: var(--well);
}
/* --lit only rises above 0 when color_background: true is set (see _light()); a tile
   otherwise looks identical on and off, so a room full of lit lights stays calm */
.light::before {
  content: ""; position: absolute; inset: 0; border-radius: inherit;
  background: rgb(var(--bg, var(--amber)) / 0.14);
  opacity: var(--lit, 0); pointer-events: none;
}
.head { position: relative; display: flex; align-items: center; gap: 10px; min-width: 0; }
.orb {
  flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 12px;
  background: color-mix(in oklab, var(--primary-text-color) 8%, transparent);
  color: var(--secondary-text-color);
}
.orb[data-on] { background: rgb(var(--lc, var(--amber)) / 0.22); color: rgb(var(--lc, var(--amber))); }
.orb ha-icon, .orb ha-state-icon { --mdc-icon-size: 20px; display: flex; }
.meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.meta .n { font-size: 13.5px; line-height: 17px; font-weight: 600; letter-spacing: -0.01em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta .d { font-size: 11.5px; line-height: 15px; font-weight: 500; color: var(--secondary-text-color);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.swatch {
  flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 10px;
  background: color-mix(in oklab, var(--primary-text-color) 8%, transparent);
}
.swatch i {
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--sw, rgb(var(--amber)));
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.14);
}

.power {
  flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 10px;
  background: color-mix(in oklab, var(--primary-text-color) 8%, transparent);
  color: var(--secondary-text-color);
}
.power[data-on] { background: rgb(var(--lc, var(--amber)) / 0.22); color: rgb(var(--lc, var(--amber))); }
.power ha-icon { --mdc-icon-size: 18px; display: flex; }

/* ---- compact: the light, its name and its state, and nothing else ---- */
ha-card[data-compact] .light { padding: 8px 10px; border-radius: 13px; }
ha-card[data-compact] .orb { width: 32px; height: 32px; border-radius: 10px; }
ha-card[data-compact] .orb ha-icon, ha-card[data-compact] .orb ha-state-icon { --mdc-icon-size: 18px; }
ha-card[data-compact] .meta .n { font-size: 13px; line-height: 16px; }
ha-card[data-compact] .meta .d { font-size: 11px; line-height: 14px; }
ha-card[data-compact] .grid { gap: 6px; }

/* ---- sliders ---- */
.slider { position: relative; height: 28px; touch-action: pan-y; cursor: grab; }
.slider:active { cursor: grabbing; }
.track {
  position: absolute; left: 0; right: 0; top: 50%; height: 10px; margin-top: -5px;
  border-radius: 99px; background: color-mix(in oklab, var(--primary-text-color) 10%, transparent);
  overflow: hidden; transform-origin: 50% 50%;
}
.fill { position: absolute; inset: 0; border-radius: 99px; transform-origin: 0 50%;
  background: linear-gradient(90deg, rgb(var(--lc, var(--amber)) / 0.5), rgb(var(--lc, var(--amber)))); }
.knob {
  position: absolute; top: 50%; width: 3px; height: 16px; margin: -8px 0 0 -1.5px;
  border-radius: 2px; background: #fff; opacity: 0.9;
  box-shadow: 0 0 3px rgb(0 0 0 / 0.3);
}
.row { display: flex; align-items: center; gap: 10px; }
.row .slider { flex: 1; }
.pct { flex: none; min-width: 34px; text-align: end; font-size: 12px; line-height: 16px;
  font-weight: 600; letter-spacing: -0.004em; color: var(--secondary-text-color); }

/* the gradient tracks say what they do before you touch them */
.grad .track { background: var(--grad); }
.grad .fill { display: none; }

/* ---- chips ---- */
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  display: inline-flex; align-items: center; gap: 7px; min-width: 0; height: 34px;
  padding: 0 12px; border-radius: 12px; background: var(--well);
  font-size: 13px; line-height: 16px; font-weight: 550; letter-spacing: -0.004em;
  color: var(--secondary-text-color);
}
.chip ha-icon, .chip ha-state-icon { --mdc-icon-size: 18px; flex: none; display: flex; color: var(--cc, inherit); }
.chip span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chip[data-on] { background: color-mix(in oklab, var(--cc) 16%, transparent); color: var(--cc); }

.empty { padding: 6px 2px; font-size: 12.5px; font-weight: 500; color: var(--secondary-text-color); }

/* ---- colour sheet ---- */
.scrim { position: fixed; inset: 0; z-index: 6; opacity: 0; pointer-events: none; }
.scrim[data-open] { pointer-events: auto; }
.sheet {
  position: fixed; z-index: 7;
  display: flex; flex-direction: column; gap: 10px;
  padding: 12px; border-radius: 18px;
  background: color-mix(in oklab, var(--primary-text-color) 7%, var(--card-background-color));
  box-shadow: 0 14px 38px rgb(0 0 0 / 0.28), 0 0 0 0.5px var(--line);
  transform-origin: var(--ox, 50%) 0;
  opacity: 0; pointer-events: none;
}
.sheet[data-open] { pointer-events: auto; }
.sheet .cap {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  font-size: 10.5px; line-height: 13px; font-weight: 650; letter-spacing: 0.05em;
  text-transform: uppercase; color: var(--secondary-text-color);
}
.sheet .cap b { font-weight: 650; letter-spacing: 0; text-transform: none; font-size: 12px;
  color: var(--primary-text-color); }
.presets { display: flex; gap: 8px; flex-wrap: wrap; }
.preset {
  width: 30px; height: 30px; border-radius: 50%; background: var(--pc);
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.16);
}
.preset[data-sel] { box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.16), 0 0 0 2px var(--pc); }

:host(:not([kbd])) :focus { outline: none; }
:host([kbd]) :focus-visible { outline: 2px solid rgb(var(--amber)); outline-offset: 2px; border-radius: 10px; }

@media (prefers-contrast: more) {
  ha-card { border-color: color-mix(in oklab, var(--primary-text-color) 40%, transparent); }
  .meta .d, .pct, .count { color: var(--primary-text-color); }
}
@media (prefers-reduced-motion: reduce) { ha-card { transition: none; } }
`;

// Presets worth a tap: a warm-to-cool spread, then a few saturated colours.
const PRESETS = [
  { kelvin: 2200 }, { kelvin: 2700 }, { kelvin: 4000 }, { kelvin: 6000 },
  { hs: [0, 0.85] }, { hs: [35, 0.9] }, { hs: [120, 0.7] }, { hs: [210, 0.85] }, { hs: [280, 0.75] },
];

class LightsCard extends HTMLElement {
  // the first area that has lights, so the card picker shows a real room
  static getStubConfig(hass) {
    for (const a of allAreas(hass)) if (pick(hass, areaEntities(hass, a.id), { domains: "light" }).length) return { area: a.id };
    const light = Object.keys(hass?.states || {}).find((e) => e.startsWith("light."));
    return light ? { lights: [light] } : {};
  }
  static getConfigElement() { return document.createElement(EDITOR); }

  constructor() {
    super();
    watchKeyboard(this);
    this._job = (now, dt) => this._frame(now, dt);
    this._onscreen = true;
    this._bars = new Map();
    this._timers = new Map();
  }

  setConfig(config) {
    const areas = [].concat(config.area || config.areas || []).filter(Boolean);
    if (!areas.length && !config.lights?.length) {
      throw new Error("savvy-lights-card: set an area, or list lights explicitly");
    }
    this._compact = config.layout === "compact" || config.compact === true;
    // The header pill: the built-in all-lights toggle, or an entity of your own in it
    // (toggle.entity). The pre-Savvy `master` is that entity.
    const legacy = typeof config.master === "string" ? { entity: config.master } : config.master;
    const toggle = { ...(legacy || {}), ...(typeof config.toggle === "string" ? { entity: config.toggle } : config.toggle || {}) };
    // featured lights get the wide tiles; the pre-Savvy `main` is one
    const featured = [].concat(config.featured || config.main || []);
    // bottom chips; the pre-Savvy `buttons` are chips
    const chips = [].concat(config.chips || config.buttons || []);
    this._config = { ...config, areas, toggle, featured, chips,
      order: [].concat(config.order || (config.main || config.side ? [config.main, config.side].filter(Boolean) : [])) };
    this._reg = null;
    if (this._root) {
      this._build();
      if (this._hass) this._update();
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._root) this._build();
    this._update();
  }

  connectedCallback() { this._observe(); this._wake(); }
  disconnectedCallback() {
    Clock.remove(this._job);
    clearTimeout(this._tapTimer);
    this._io?.disconnect();
    this._watchOutside(false);
    for (const t of this._timers.values()) clearTimeout(t);
  }

  getCardSize() { return this._compact ? 2 : 4; }
  getGridOptions() { return { columns: 12, min_columns: 6 }; }

  // ---------- which lights, in what order ----------
  // A light may be listed as a bare id or as an object with its own options.
  _opts(id) {
    const list = [].concat(this._config.lights || []);
    const found = list.find((l) => typeof l === "object" && l.entity === id);
    return found || {};
  }

  _discover() {
    const h = this._hass, c = this._config;
    if (c.lights?.length) {
      return [].concat(c.lights)
        .map((l) => (typeof l === "string" ? l : l.entity))
        .filter((id) => id && h.states[id]);
    }
    if (!c.areas.length || !h.entities) return [];
    this._found = c.areas.flatMap((a) => pick(h, areaEntities(h, a), { domains: "light" }));
    const exclude = new Set([].concat(c.exclude || []));
    return this._found.filter((id) => !exclude.has(id) && h.states[id]);
  }

  // An explicit order leads; then featured lights; then the rest by name. Anything the
  // order doesn't mention keeps its natural place behind it.
  _ordered() {
    const c = this._config, h = this._hass;
    const ids = this._discover();
    const rank = new Map(c.order.map((id, i) => [id, i]));
    const feat = new Set(c.featured);
    const weight = (id) => {
      if (rank.has(id)) return rank.get(id) - 1000;
      if (feat.has(id)) return -1;
      return 0;
    };
    const label = (id) => (h.states[id]?.attributes.friendly_name || id).toLowerCase();
    return ids.slice().sort((a, b) => weight(a) - weight(b) || label(a).localeCompare(label(b)));
  }

  _level(st) {
    if (!st || st.state !== "on") return 0;
    const b = Number(st.attributes.brightness);
    return Number.isFinite(b) ? clamp(b / 255) : 1;
  }

  // The colour a lit lamp is actually showing, pulled into a legible band.
  _lightRgb(st) {
    if (!st || st.state !== "on") return null;
    const mode = st.attributes.color_mode;
    if (HUE_MODES.has(mode) && st.attributes.rgb_color) {
      return legible(st.attributes.rgb_color) || kelvinRgb(3000);
    }
    if (mode === "color_temp") {
      const k = Number(st.attributes.color_temp_kelvin);
      if (Number.isFinite(k)) return kelvinRgb(k);
    }
    return null;
  }

  _kelvinRange(st) {
    const a = st?.attributes || {};
    const lo = Number(a.min_color_temp_kelvin) || 2000;
    const hi = Number(a.max_color_temp_kelvin) || 6500;
    return [lo, Math.max(lo + 100, hi)];
  }

  // ---------- build ----------
  _build() {
    this._root = this._shadow || (this._shadow = this.attachShadow({ mode: "open" }));
    this._first = true;
    this._springs = [];
    this._pressNodes = [];
    this._bars = new Map();
    this._open = null;

    this._root.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <header id="header">
          <div class="titles">
            <span class="name" id="title"></span>
            <span class="count" id="count"></span>
          </div>
          <button class="master" id="master">
            <ha-icon id="masterIcon" icon="mdi:lightbulb-group"></ha-icon><span id="masterText"></span>
          </button>
        </header>
        <div class="grid" id="grid"></div>
        <div class="empty" id="empty" hidden>No lights found in this area.</div>
        <div class="chips" id="chips" hidden></div>
      </ha-card>
      <span class="scrim" id="scrim"></span>
      <div class="sheet" id="sheet">
        <div class="cap"><b id="sheetName"></b><span id="sheetMode"></span></div>
        <div class="row grad" id="tempRow">
          <div class="slider" id="tempSlider" role="slider" tabindex="0" aria-label="Warmth">
            <div class="track" id="tempTrack"><span class="fill"></span></div><span class="knob" id="tempKnob"></span>
          </div>
          <span class="pct" id="tempPct"></span>
        </div>
        <div class="row grad" id="hueRow">
          <div class="slider" id="hueSlider" role="slider" tabindex="0" aria-label="Colour">
            <div class="track" id="hueTrack"><span class="fill"></span></div><span class="knob" id="hueKnob"></span>
          </div>
          <span class="pct" id="huePct"></span>
        </div>
        <div class="row grad" id="satRow">
          <div class="slider" id="satSlider" role="slider" tabindex="0" aria-label="Saturation">
            <div class="track" id="satTrack"><span class="fill"></span></div><span class="knob" id="satKnob"></span>
          </div>
          <span class="pct" id="satPct"></span>
        </div>
        <div class="presets" id="presets"></div>
      </div>`;

    const $ = (id) => this._root.getElementById(id);
    this._el = {
      card: this._root.querySelector("ha-card"), header: $("header"), title: $("title"),
      count: $("count"), master: $("master"), masterIcon: $("masterIcon"), masterText: $("masterText"),
      grid: $("grid"), empty: $("empty"), chips: $("chips"),
      scrim: $("scrim"), sheet: $("sheet"), sheetName: $("sheetName"), sheetMode: $("sheetMode"),
      tempRow: $("tempRow"), tempSlider: $("tempSlider"), tempTrack: $("tempTrack"), tempKnob: $("tempKnob"), tempPct: $("tempPct"),
      hueRow: $("hueRow"), hueSlider: $("hueSlider"), hueTrack: $("hueTrack"), hueKnob: $("hueKnob"), huePct: $("huePct"),
      satRow: $("satRow"), satSlider: $("satSlider"), satTrack: $("satTrack"), satKnob: $("satKnob"), satPct: $("satPct"),
      presets: $("presets"),
    };

    this._sp = { sheet: this._spring(0, MOTION.sheetIn, "sheet", 0.002) };

    this._press(this._el.master, () => this._masterTap(), () => this._masterHold());
    this._el.scrim.addEventListener("pointerdown", (e) => { e.stopPropagation(); this._closeSheet(); });
    this._root.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this._open) { e.stopPropagation(); this._closeSheet(); }
    });

    // the three sheet sliders write to whichever light is open
    this._sheetBar("temp", this._el.tempSlider, {
      read: () => {
        const st = this._openState(), [lo, hi] = this._kelvinRange(st);
        const k = Number(st?.attributes.color_temp_kelvin) || lo;
        return clamp((k - lo) / (hi - lo));
      },
      write: (v) => {
        const st = this._openState(), [lo, hi] = this._kelvinRange(st);
        this._call("turn_on", { color_temp_kelvin: Math.round(lerp(lo, hi, v)) });
      },
    });
    this._sheetBar("hue", this._el.hueSlider, {
      read: () => (this._hsOf()[0] || 0) / 360,
      write: (v) => this._call("turn_on", { hs_color: [Math.round(v * 360) % 360, Math.round(this._hsOf()[1] * 100) || 100] }),
    });
    this._sheetBar("sat", this._el.satSlider, {
      read: () => this._hsOf()[1],
      write: (v) => this._call("turn_on", { hs_color: [Math.round(this._hsOf()[0]), Math.round(clamp(v, 0.05, 1) * 100)] }),
    });

    for (let i = 0; i < PRESETS.length; i++) {
      const p = PRESETS[i];
      const btn = document.createElement("button");
      btn.className = "preset";
      btn.style.setProperty("--pc", rgbStr(p.kelvin ? kelvinRgb(p.kelvin) : hsRgb(p.hs[0], p.hs[1])));
      btn.setAttribute("aria-label", p.kelvin ? `${p.kelvin} kelvin` : `Colour ${p.hs[0]} degrees`);
      this._press(btn, () => this._applyPreset(p));
      this._el.presets.appendChild(btn);
    }

    this._observe();
  }

  _spring(v, motion, group, eps) {
    const s = new Spring(v, motion, group, eps);
    this._springs.push(s);
    return s;
  }

  _observe() {
    if (!this._root || !this.isConnected) return;
    this._io = this._io || new IntersectionObserver(([e]) => {
      this._onscreen = e.isIntersecting;
      if (this._onscreen) this._wake();
    });
    this._io.disconnect();
    this._io.observe(this);
  }

  // Feedback on pointer-down, commit on release; a press that travels is a scroll.
  _press(el, onTap, hold) {
    const spring = this._spring(0, MOTION.press, `p${this._springs.length}`);
    this._pressNodes.push(el);
    el.__spring = spring;
    let origin = null, armed = false, swallow = false, timer = 0;
    const settle = (motion) => {
      clearTimeout(timer);
      origin = null;
      spring.to(0, motion);
      this._wake();
    };
    el.addEventListener("pointerdown", (e) => {
      if (e.button > 0 || el.hasAttribute("disabled")) return;
      origin = [e.clientX, e.clientY];
      armed = true; swallow = false;
      spring.to(1, hold ? MOTION.hold : MOTION.press);
      this._wake();
      if (hold) timer = setTimeout(() => {
        swallow = true;
        settle(MOTION.pop);
        this._haptic("medium");
        hold();
      }, HOLD_MS);
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
    el.addEventListener("contextmenu", (e) => hold && e.preventDefault());
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const ok = (armed || e.detail === 0) && !swallow;
      armed = false; swallow = false;
      if (ok) onTap();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      onTap();
    });
  }

  // A slider that tracks the finger 1:1 and settles onto its own value on release.
  _bar(key, el, io) {
    const group = `bar:${key}`;
    const bar = {
      el, io,
      value: this._spring(0, MOTION.value, group, 0.002),
      grab: this._spring(0, MOTION.grab, group),
      dragging: false, pending: null, last: -1,
    };
    this._bars.set(key, bar);
    let id = null;
    const at = (clientX) => {
      const r = el.getBoundingClientRect();
      return clamp((clientX - r.left) / Math.max(1, r.width));
    };
    const set = (v, throttle) => {
      bar.pending = v;
      bar.value.snap(v);
      const notch = Math.round(v * 10);
      if (notch !== bar.last) { bar.last = notch; this._haptic("selection"); }
      this._send(bar, v, throttle);
      this._wake();
    };
    el.addEventListener("pointerdown", (e) => {
      if (e.button > 0 || el.hasAttribute("disabled")) return;
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      id = e.pointerId;
      bar.dragging = true;
      bar.grab.to(1);
      set(at(e.clientX), true);
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerId !== id) return;
      set(at(e.clientX), true);
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      bar.dragging = false;
      bar.grab.to(0);
      this._send(bar, bar.value.x);
      this._wake();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("keydown", (e) => {
      const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      set(clamp(bar.value.target + d * 0.05), false);
    });
    return bar;
  }

  _sheetBar(key, el, io) { return this._bar(`sheet:${key}`, el, io); }

  // Writes are throttled while dragging; the release always lands.
  _send(bar, v, throttle = false) {
    bar.queued = v;
    if (throttle) {
      if (this._timers.get(bar)) return;
      this._timers.set(bar, setTimeout(() => {
        this._timers.delete(bar);
        this._flush(bar);
      }, WRITE_THROTTLE));
      return;
    }
    clearTimeout(this._timers.get(bar));
    this._timers.delete(bar);
    this._flush(bar);
  }

  _flush(bar) {
    if (bar.queued == null) return;
    bar.io.write(bar.queued);
    bar.queued = null;
  }

  // ---------- actions ----------
  _service(service, data, entity) {
    this._hass.callService("light", service, data || {}, { entity_id: entity });
  }

  _call(service, data) {
    if (this._open) this._service(service, data, this._open);
  }

  _openState() { return this._open ? this._hass.states[this._open] : null; }

  _hsOf() {
    const st = this._openState();
    const hs = st?.attributes.hs_color;
    if (Array.isArray(hs)) return [hs[0], clamp(hs[1] / 100)];
    const rgb = st?.attributes.rgb_color;
    return rgb ? rgbHs(rgb) : [40, 0.8];
  }

  _toggle(id) {
    this._haptic("light");
    const power = this._opts(id).power;
    if (power) return this._hass.callService(power.split(".")[0], "toggle", {}, { entity_id: power });
    this._service("toggle", {}, id);
  }

  // Is this lamp on? Its own switch decides when it has one.
  _isOn(id) {
    const power = this._opts(id).power;
    if (power) return this._hass.states[power]?.state === "on";
    return this._hass.states[id]?.state === "on";
  }

  // The header pill. Built in: a tap is all on or all off. With an entity in it
  // (toggle.entity): a tap toggles that entity and a double tap forces every light off,
  // unless toggle.tap_action / double_tap_action say otherwise (CARD-DESIGN.md 9).
  _masterTap() {
    const t = this._config.toggle, entity = t.entity;
    if (!entity && !t.tap_action) return this._toggleAll();
    const tap = () => {
      this._haptic("light");
      runAction(this, this._hass, t.tap_action || { action: "toggle" }, { entity, list: () => this._listLights() });
    };
    const double = t.double_tap_action ? () => runAction(this, this._hass, t.double_tap_action, { entity }) : () => this._allOff();
    if (t.double_tap_action?.action === "none") return tap();
    if (this._tapTimer) {
      clearTimeout(this._tapTimer);
      this._tapTimer = 0;
      this._haptic("medium");
      double();
      return;
    }
    this._tapTimer = setTimeout(() => { this._tapTimer = 0; tap(); }, 250);
  }

  // hold: toggle.hold_action, else more-info on the pill's entity, else the list of lights
  _masterHold() {
    const t = this._config.toggle;
    if (t.hold_action) return runAction(this, this._hass, t.hold_action, { entity: t.entity, list: () => this._listLights() });
    if (t.entity) return this._moreInfo(t.entity);
    this._listLights();
  }

  _listLights() {
    this._list = this._list || new EntityListSheet(this, { title: "Lights", color: "#F5B83D" });
    this._list.show(this._hass, () => this._ids || [], this._el.master);
  }

  _allOff() {
    const ids = this._ids || [];
    this._haptic("medium");
    if (ids.length) this._service("turn_off", {}, ids);
  }

  _toggleAll() {
    const ids = this._ids || [];
    if (!ids.length) return;
    const anyOn = ids.some((id) => this._isOn(id));
    this._haptic("light");
    this._service(anyOn ? "turn_off" : "turn_on", {}, ids);
  }

  _applyPreset(p) {
    if (!this._open) return;
    this._haptic("light");
    this._call("turn_on", p.kelvin ? { color_temp_kelvin: p.kelvin }
      : { hs_color: [p.hs[0], Math.round(p.hs[1] * 100)] });
  }

  _navigate(path) {
    history.pushState(null, "", path.startsWith("/") ? path
      : `${location.pathname.replace(/\/[^/]*$/, "")}/${path}`);
    window.dispatchEvent(new CustomEvent("location-changed", { bubbles: true, composed: true }));
  }

  _moreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", {
      detail: { entityId }, bubbles: true, composed: true,
    }));
  }

  _haptic(type) { window.dispatchEvent(new CustomEvent("haptic", { detail: type })); }

  // ---------- the colour sheet ----------
  // Anchored to the swatch that opened it; it shows only the controls that light has.
  _openSheet(id, anchor) {
    const st = this._hass.states[id];
    if (!st) return;
    this._open = id;
    this._anchor = anchor;
    this._el.tempRow.hidden = !canTemp(st);
    this._el.hueRow.hidden = !canColor(st);
    this._el.satRow.hidden = !canColor(st);
    this._el.presets.hidden = !(canTemp(st) || canColor(st));
    this._sheetContent();
    this._placeSheet();
    this._watchOutside(true);
    this._haptic("light");
    this._sp.sheet.to(1, MOTION.sheetIn);
    attr(this._el.sheet, "data-open", "");
    attr(this._el.scrim, "data-open", "");
    this._wake();
  }

  _closeSheet() {
    if (!this._open) return;
    this._open = null;
    this._watchOutside(false);
    this._haptic("selection");
    this._sp.sheet.to(0, MOTION.sheetOut);
    attr(this._el.sheet, "data-open", null);
    attr(this._el.scrim, "data-open", null);
    this._wake();
  }

  _placeSheet() {
    const a = this._anchor?.getBoundingClientRect();
    const card = this._el.card.getBoundingClientRect();
    const sheet = this._el.sheet;
    const width = Math.max(240, Math.min(360, card.width - 16));
    let left = (a ? a.left + a.width / 2 : card.left + card.width / 2) - width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    put(sheet, "width", `${Math.round(width)}px`);
    put(sheet, "left", `${Math.round(left)}px`);
    put(sheet, "top", `${Math.round((a ? a.bottom : card.top) + 8)}px`);
    put(sheet, "--ox", `${Math.round((a ? a.left + a.width / 2 : left + width / 2) - left)}px`);
  }

  _watchOutside(on) {
    if (on === !!this._outside) return;
    if (!on) {
      window.removeEventListener("scroll", this._outside, true);
      window.removeEventListener("resize", this._outside);
      document.removeEventListener("pointerdown", this._outsideTap, true);
      this._outside = null;
      return;
    }
    this._outside = () => this._closeSheet();
    this._outsideTap = (e) => {
      if (!e.composedPath().includes(this._el.sheet)) this._closeSheet();
    };
    window.addEventListener("scroll", this._outside, true);
    window.addEventListener("resize", this._outside);
    requestAnimationFrame(() => {
      if (this._open) document.addEventListener("pointerdown", this._outsideTap, true);
    });
  }

  _sheetContent() {
    const el = this._el, st = this._openState();
    if (!st) return;
    text(el.sheetName, st.attributes.friendly_name || title(this._open.split(".")[1]));
    const mode = st.attributes.color_mode;
    text(el.sheetMode, HUE_MODES.has(mode) ? "Colour" : mode === "color_temp" ? "Warmth" : "Light");

    if (!el.tempRow.hidden) {
      const [lo, hi] = this._kelvinRange(st);
      const stops = [];
      for (let i = 0; i <= 6; i++) stops.push(rgbStr(kelvinRgb(lerp(lo, hi, i / 6))));
      put(el.tempTrack, "--grad", `linear-gradient(90deg, ${stops.join(",")})`);
      const k = Number(st.attributes.color_temp_kelvin);
      text(el.tempPct, Number.isFinite(k) ? `${Math.round(k)}K` : "-");
      this._syncBar("sheet:temp");
    }
    if (!el.hueRow.hidden) {
      const stops = [];
      for (let i = 0; i <= 12; i++) stops.push(rgbStr(hsRgb(i * 30, 1)));
      put(el.hueTrack, "--grad", `linear-gradient(90deg, ${stops.join(",")})`);
      const [h, s] = this._hsOf();
      text(el.huePct, `${Math.round(h)}\u00B0`);
      text(el.satPct, `${Math.round(s * 100)}%`);
      put(el.satTrack, "--grad",
        `linear-gradient(90deg, ${rgbStr(hsRgb(h, 0))}, ${rgbStr(hsRgb(h, 1))})`);
      this._syncBar("sheet:hue");
      this._syncBar("sheet:sat");
    }
    for (let i = 0; i < this._el.presets.children.length; i++) {
      const p = PRESETS[i], node = this._el.presets.children[i];
      const sel = p.kelvin
        ? mode === "color_temp" && Math.abs((st.attributes.color_temp_kelvin || 0) - p.kelvin) < 150
        : HUE_MODES.has(mode) && Math.abs(this._hsOf()[0] - p.hs[0]) < 12;
      attr(node, "data-sel", sel ? "" : null);
      node.hidden = p.kelvin ? el.tempRow.hidden : el.hueRow.hidden;
    }
  }

  _syncBar(key) {
    const bar = this._bars.get(key);
    if (!bar || bar.dragging) return;
    const v = clamp(bar.io.read());
    if (bar.pending != null && Math.abs(bar.pending - v) < 0.03) bar.pending = null;
    if (bar.pending == null) bar.value.to(v);
  }

  // ---------- update ----------
  _update() {
    const h = this._hass, c = this._config, el = this._el;
    if (!h || !this._root) return;
    this._reduced = MQ.reduced.matches;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    el.card.toggleAttribute("data-compact", this._compact);
    const cols = Number(c.columns);
    put(el.grid, "gridTemplateColumns", cols > 0 ? `repeat(${cols}, minmax(0, 1fr))` : "");

    const ids = this._ordered();
    this._ids = ids;
    el.empty.hidden = ids.length > 0;

    const on = ids.filter((id) => this._isOn(id)).length;
    el.header.hidden = c.show_header === false;
    text(el.title, c.title || (c.areas.length === 1 ? areaInfo(h, c.areas[0]).name : "Lights"));
    text(el.count, ids.length ? (on ? `${on} of ${ids.length} on` : "All off") : "");

    el.master.hidden = c.show_toggle === false;
    const master = c.toggle.entity && h.states[c.toggle.entity];
    const lit = master ? master.state === "on" : on > 0;
    attr(el.master, "data-on", lit ? "" : null);
    // the pill says what the room's lights ARE doing, not what tapping it would do
    text(el.masterText, c.toggle.name || (lit ? "Lights on" : "Lights off"));
    attr(el.masterIcon, "icon", c.toggle.icon || (lit ? "mdi:toggle-switch" : "mdi:toggle-switch-off"));
    attr(el.master, "aria-label", master
      ? `Room lights ${master.state}. Double tap to turn every light off.`
      : (on ? "Turn all lights off" : "Turn all lights on"));
    this._list?.render(h);

    for (const id of ids) this._light(id);
    // keep the DOM in the configured order, and retire anything no longer here
    const want = new Set(ids);
    for (const [key, node] of el.grid.__rows || []) {
      node.hidden = !want.has(node.__entity);
      if (!want.has(node.__entity)) this._bars.delete(key);
    }
    ids.forEach((id, i) => {
      const node = el.grid.__rows.get(slug(id));
      if (node && el.grid.children[i] !== node) el.grid.insertBefore(node, el.grid.children[i] || null);
    });

    this._chips();
    if (this._open) this._sheetContent();

    if (this._first) {
      this._first = false;
      this._paint(performance.now(), null);
    }
    this._wake();
  }

  _light(id) {
    const h = this._hass, el = this._el, key = slug(id);
    const st = h.states[id];
    const cache = el.grid.__rows || (el.grid.__rows = new Map());
    let node = cache.get(key);
    if (!node) {
      node = document.createElement("div");
      node.className = "light";
      node.__entity = id;
      node.innerHTML = `
        <div class="head">
          <button class="orb"><ha-state-icon></ha-state-icon></button>
          <button class="meta" style="text-align:start"><span class="n"></span><span class="d"></span></button>
          <button class="swatch" hidden><i></i></button>
          <button class="power" hidden><ha-icon icon="mdi:power"></ha-icon></button>
        </div>
        <div class="row bright" hidden>
          <div class="slider" role="slider" tabindex="0" aria-label="Brightness">
            <div class="track"><span class="fill"></span></div><span class="knob"></span>
          </div>
          <span class="pct"></span>
        </div>`;
      cache.set(key, node);
      el.grid.appendChild(node);
      const orb = node.querySelector(".orb");
      this._press(orb, () => this._toggle(id), () => this._moreInfo(id));
      this._press(node.querySelector(".meta"), () => this._moreInfo(id));
      const swatch = node.querySelector(".swatch");
      this._press(swatch, () => this._openSheet(id, swatch));
      this._press(node.querySelector(".power"), () => this._toggle(id));
      node.__lit = this._spring(0, MOTION.tint, `l:${key}`);
    }

    const opts = this._opts(id);
    const dim = canDim(st) && !this._compact, colour = (canTemp(st) || canColor(st)) && !this._compact;
    const dead = !st || ["unavailable", "unknown"].includes(st.state);
    const on = this._isOn(id);
    const level = this._level(st);

    attr(node, "data-unavailable", dead ? "" : null);
    attr(node.querySelector(".orb"), "data-on", on ? "" : null);
    const icon = node.querySelector("ha-state-icon");
    if (icon.stateObj !== st) { icon.hass = h; icon.stateObj = st; }
    text(node.querySelector(".n"), this._stripRoomPrefix(st?.attributes.friendly_name || title(id.split(".")[1]), id));
    text(node.querySelector(".d"), this._subtitle(st, { dead, on }));

    const rgb = this._lightRgb(st);
    put(node, "--lc", rgb ? rgb.map(Math.round).join(" ") : "var(--amber)");
    put(node, "--bg", rgb ? rgb.map(Math.round).join(" ") : "var(--amber)");
    // the tile-wide background wash is opt-in (color_background: true); a room full
    // of lit tiles otherwise reads as visual noise, so a tile stays exactly as it
    // looks when off unless the user asks for the colour wash
    node.__lit.to(on && !dead && this._config.color_background ? 1 : 0);
    if (this._first || this._reduced) node.__lit.snap();

    const power = node.querySelector(".power");
    power.hidden = !(opts.power || this._config.power_button) || dead;
    if (!power.hidden) {
      attr(power, "data-on", on ? "" : null);
      attr(power, "aria-label", `Turn ${st?.attributes.friendly_name || "light"} ${on ? "off" : "on"}`);
    }

    const swatch = node.querySelector(".swatch");
    swatch.hidden = !colour || dead;
    if (!swatch.hidden) {
      put(swatch, "--sw", rgb ? rgbStr(rgb) : "rgb(var(--amber))");
      attr(swatch, "aria-label", "Colour and warmth");
    }

    const row = node.querySelector(".bright");
    row.hidden = !dim || dead;
    if (!row.hidden) {
      let bar = this._bars.get(key);
      if (!bar) {
        bar = this._bar(key, node.querySelector(".slider"), {
          read: () => this._level(this._hass.states[id]),
          // dragging a dark lamp is how you turn it on, at the level you chose
          write: (v) => this._service("turn_on", { brightness_pct: Math.max(1, Math.round(v * 100)) }, id),
        });
      }
      if (bar.pending != null && Math.abs(bar.pending - level) < 0.03) bar.pending = null;
      if (!bar.dragging && bar.pending == null) {
        if (this._first) bar.value.snap(level);
        else bar.value.to(level);
      }
      const slider = node.querySelector(".slider");
      attr(slider, "aria-valuenow", Math.round(level * 100));
      attr(slider, "aria-valuemin", "0");
      attr(slider, "aria-valuemax", "100");
      // the subtitle already says the brightness now; showing it a second
      // time next to the slider would be redundant
      row.querySelector(".pct").hidden = true;
    }
    // featured lights get the wider tile: the ones you reach for
    const wide = !this._compact && Number(this._config.columns) !== 1 && this._config.featured.includes(id);
    attr(node, "data-wide", wide ? "" : null);
  }

  // Each light's own actual area (from the registry, not the card's cosmetic `title`,
  // which might say something entirely different) says what prefix to strip, so a
  // tile doesn't repeat its room ("Main Light", not "Living Room Main Light") even
  // when the card's title doesn't match the room, or when an explicit `lights:` list
  // mixes lights from several areas. Falls back to the card's own `area:` config only
  // when the entity isn't in the registry at all. Only when it's actually a leading
  // match, case-insensitively, and never down to nothing.
  _lightArea(id) {
    const h = this._hass, ent = h.entities?.[id];
    if (!ent) return null;
    return ent.area_id || h.devices?.[ent.device_id]?.area_id || null;
  }

  _stripRoomPrefix(name, id) {
    const area = this._lightArea(id) || this._config.areas[0];
    const room = area ? areaInfo(this._hass, area).name : "";
    if (!room) return name;
    const re = new RegExp(`^${room.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i");
    const stripped = name.replace(re, "");
    return stripped || name;
  }

  // The line under the name: what this lamp is doing. A light with brightness shows
  // it (the one thing the tile doesn't already say elsewhere); a plain relay with no
  // brightness attribute just says "On".
  _subtitle(st, { dead, on }) {
    if (dead) return "Unavailable";
    if (!on) return "Off";
    if (this._config.state_detail === false) return "On";
    const b = Number(st.attributes.brightness);
    return Number.isFinite(b) ? `${Math.round(clamp(b / 255) * 100)}%` : "On";
  }

  _chips() {
    const el = this._el.chips, h = this._hass;
    const list = this._config.chips;
    const cache = el.__rows || (el.__rows = new Map());
    for (const raw of list) {
      const cfg = typeof raw === "string" ? { entity: raw } : raw;
      const key = cfg.entity || cfg.navigation_path || cfg.name;
      const st = cfg.entity && h.states[cfg.entity];
      if (cfg.entity && !st && !cfg.navigation_path) continue;
      let chip = cache.get(key);
      if (!chip) {
        chip = document.createElement("button");
        chip.className = "chip";
        chip.innerHTML = `${cfg.icon ? "<ha-icon></ha-icon>" : "<ha-state-icon></ha-state-icon>"}<span></span>`;
        cache.set(key, chip);
        el.appendChild(chip);
        this._press(chip, () => chip.__act(), () => chip.__hold());
      }
      // the one chip spec: tap / hold actions, defaults by domain (a navigation chip navigates)
      chip.__act = () => runAction(this, h, cfg.tap_action || (cfg.navigation_path ? { action: "navigate", navigation_path: cfg.navigation_path }
        : cfg.entity ? defaultTapAction(cfg.entity) : null), { entity: cfg.entity });
      chip.__hold = () => runAction(this, h, cfg.hold_action || (cfg.entity ? { action: "more-info" } : null), { entity: cfg.entity });
      put(chip, "--cc", colorOf(cfg.color) || "rgb(var(--amber))");
      attr(chip, "data-on", st && ["on", "home", "open", "playing"].includes(st.state) ? "" : null);
      text(chip.querySelector("span"), cfg.name || st?.attributes.friendly_name || title(String(key).split(".").pop()));
      const sIcon = chip.querySelector("ha-state-icon");
      if (sIcon && sIcon.stateObj !== st) { sIcon.hass = h; sIcon.stateObj = st; }
      const iIcon = chip.querySelector("ha-icon");
      if (iIcon) attr(iIcon, "icon", cfg.icon);
    }
    const keys = new Set(list.map((raw) => {
      const cfg = typeof raw === "string" ? { entity: raw } : raw;
      return cfg.entity || cfg.navigation_path || cfg.name;
    }));
    for (const [key, node] of cache) node.hidden = !keys.has(key);
    el.hidden = !list.length;
  }

  // ---------- frames ----------
  _wake() { if (this._root && this.isConnected) Clock.add(this._job); }

  _frame(now, dt) {
    const dirty = new Set();
    const still = this._reduced && !this._anyDragging();
    for (const s of this._springs) {
      if (s.idle) continue;
      if (still && s.group !== "sheet") s.snap();
      else s.step(dt);
      dirty.add(s.group);
    }
    if (!dirty.size) return false;
    this._paint(now, dirty);
    return true;
  }

  _anyDragging() {
    for (const bar of this._bars.values()) if (bar.dragging) return true;
    return false;
  }

  _paint(now, dirty) {
    const all = !dirty, el = this._el, red = this._reduced;

    for (const node of this._pressNodes) {
      const s = node.__spring;
      if (!s || (!all && !dirty.has(s.group))) continue;
      const p = s.x;
      put(node, "transform", red || Math.abs(p) < 1e-4 ? "" : `scale(${(1 - 0.06 * p).toFixed(4)})`);
      put(node, "opacity", Math.abs(p) > 1e-3 ? (1 - (red ? 0.25 : 0.12) * clamp(p)).toFixed(3) : "");
    }

    for (const [, node] of el.grid.__rows || []) {
      const s = node.__lit;
      if (!s || (!all && !dirty.has(s.group))) continue;
      put(node, "--lit", clamp(s.x).toFixed(3));
    }

    for (const [, bar] of this._bars) {
      if (!all && !dirty.has(bar.value.group)) continue;
      const v = clamp(bar.value.x), g = clamp(bar.grab.x);
      const track = bar.el.querySelector(".track");
      const fill = bar.el.querySelector(".fill");
      const knob = bar.el.querySelector(".knob");
      if (fill) put(fill, "transform", `scaleX(${v.toFixed(4)})`);
      if (track) put(track, "transform", red ? "" : `scaleY(${(1 + 0.45 * g).toFixed(3)})`);
      if (knob) put(knob, "left", `${(v * 100).toFixed(2)}%`);
      const pct = bar.el.parentElement?.querySelector(".pct");
      if (pct && bar.el.classList.contains("slider") && !bar.el.closest(".grad")) {
        text(pct, `${Math.round(v * 100)}%`);
      }
    }

    if (all || dirty.has("sheet")) {
      const v = clamp(this._sp.sheet.x);
      put(el.scrim, "opacity", v.toFixed(3));
      put(el.sheet, "opacity", v.toFixed(3));
      put(el.sheet, "transform", red ? ""
        : `scale(${(0.92 + 0.08 * v).toFixed(4)}) translateY(${((1 - v) * -6).toFixed(2)}px)`);
    }
  }
}

// ---------- editor ----------
const lightsOf = (hass, c) => {
  const areas = [].concat(c.area || c.areas || []).filter(Boolean);
  if (c.lights?.length) return [].concat(c.lights).map((l) => (typeof l === "string" ? l : l.entity));
  const skip = new Set([].concat(c.exclude || []));
  const ids = areas.flatMap((a) => pick(hass, areaEntities(hass, a), { domains: "light" })).filter((id) => !skip.has(id));
  return ids.sort((a, b) => (hass.states[a]?.attributes.friendly_name || a).localeCompare(hass.states[b]?.attributes.friendly_name || b));
};

const EDITOR = defineEditor("savvy-lights-card", (hass, c) => [
  { name: "area", label: "Area", helper: "Every light in these areas is shown. Pick several for one card across rooms.", selector: { area: { multiple: true } } },
  S.grid(S.text("title", "Title"), S.select("layout", "Layout", [{ value: "full", label: "Full" }, { value: "compact", label: "Compact" }])),
  S.grid(S.bool("show_header", "Show the header", null, true), S.bool("show_toggle", "Show the on/off pill", null, true)),
  { type: "expandable", name: "toggle", title: "On/off pill", schema: [
    { name: "entity", label: "Entity in the pill", helper: "Empty: the pill turns this card's lights on and off. An entity (e.g. a room helper): tap toggles it, double tap turns every light off.", selector: { entity: {} } },
    { type: "grid", name: "", schema: [{ name: "name", label: "Name", selector: { text: {} } }, { name: "icon", label: "Icon", selector: { icon: {} } }] },
    { name: "tap_action", label: "Tap", selector: { ui_action: {} } },
    { name: "double_tap_action", label: "Double tap", selector: { ui_action: {} } },
    { name: "hold_action", label: "Hold", selector: { ui_action: {} } },
  ] },
  { name: "order", label: "Order", type: "list", helper: "Drag order with the arrows. Lights not listed follow, by name.",
    initial: (h, cfg) => (h ? lightsOf(h, cfg) : []), add: { selector: { entity: { domain: "light" } }, label: "Add a light" } },
  { name: "featured", label: "Featured (wide tiles)", selector: { entity: { domain: "light", multiple: true } } },
  { name: "exclude", label: "Leave out", selector: { entity: { domain: "light", multiple: true } } },
  S.grid(S.number("columns", "Columns", 1, 6), S.bool("power_button", "Power button on every tile", null, false)),
  S.grid(S.bool("state_detail", "Show brightness under the name", null, true), S.bool("color_background", "Tint lit tiles", null, false)),
  { name: "lights", label: "Lights (instead of the area)", type: "list", helper: "Only these lights, in this order. `power`: a smart plug a light sits behind.",
    item: [{ name: "entity", label: "Light", selector: { entity: { domain: "light" } } }, { name: "power", label: "Behind this plug", selector: { entity: { domain: "switch" } } }],
    add: { selector: { entity: { domain: "light" } }, label: "Add a light" } },
  S.chips(),
]);

registerCard("savvy-lights-card", LightsCard, "Lights",
  "Every light in a room, found for you, each with only the controls it supports. Reorder in the editor.");
})();

// ===== cards/room.js =====
(() => {
// savvy-room-card: the header at the top of a room's own page. The room's mode (tap to
// change it) and temperature; a row of what the room has, pinned entities first, then
// everything the area has, on or off (dimmed when idle); your own chips; and a row to
// jump to every other room.
//
//   type: custom:savvy-room-card
//   area: living_room
//   mode: input_select.living_room_mode      home_path: /lovelace/home
//   entities: [input_boolean.living_room_lights, …]     auto_discover: true
//   chips: [...]                              room_path: /lovelace/{slug}

const STYLE = `${BASE_CSS}${HEADER_CSS}${CHIP_ROW_CSS}`;

class SavvyRoomCard extends SavvyCard {
  static getStubConfig(hass) {
    const a = allAreas(hass).find((x) => areaEntities(hass, x.id).length);
    return a ? { area: a.id } : {};
  }
  static getConfigElement() { return document.createElement(EDITOR); }

  setConfig(config) {
    if (!config?.area) throw new Error("savvy-room-card: set an area");
    const c = legacyBadges({ mode_label: "Room mode", ...config });
    if (config.sensor_icons_only !== undefined && c.icons_only === undefined) c.icons_only = config.sensor_icons_only;
    c.room_order = config.room_order ?? config.order;
    if (config.tiles && !config.chips) c.chips = config.tiles;
    this._config = c;
    if (this._el) { this._build(); if (this._hass) this._update(); }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._el) this._build();
    this._update();
    this._list?.render(hass);
    if (this._picker?.isOpen) this._picker.render(this._modeInfo(), this._config.mode_label);
  }

  connectedCallback() { this._observe(); this._wake(); }
  getCardSize() { return 3; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: "auto" }; }

  _modeInfo() { return this._hass && modeInfo(this._hass, this._config.mode, this._config); }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._resetMotion();
    this._picker?.close();
    this._picker = null;
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="top">
          <button class="glyph" id="home" aria-label="Home" hidden><ha-icon icon="mdi:home"></ha-icon></button>
          <button class="pill" id="pill" hidden>
            <span class="swap" id="swap"><ha-icon id="pillIcon"></ha-icon><span class="col"><span class="val" id="val"></span><span class="pre" id="pre"></span></span></span>
          </button>
          <span class="spacer" id="spacer"></span>
          <button class="wx" id="temp" hidden><ha-icon icon="mdi:thermometer"></ha-icon><span class="deg" id="deg"></span></button>
        </div>
        <div class="chips" id="sensors"></div>
        <div class="chips" id="chips" hidden></div>
        <div class="sep" id="sep"></div>
        <div class="chips nav" id="rooms"></div>
      </ha-card>`;
    const $ = (id) => root.getElementById(id);
    this._el = { card: root.querySelector("ha-card"), home: $("home"), pill: $("pill"), swap: $("swap"), pillIcon: $("pillIcon"), val: $("val"), pre: $("pre"),
      spacer: $("spacer"), temp: $("temp"), deg: $("deg"), sensors: $("sensors"), chips: $("chips"), sep: $("sep"), rooms: $("rooms") };
    const el = this._el;
    this._swap = new Swap(el.swap, (v) => {
      const info = this._modeInfo();
      text(el.val, info?.label || v);
      attr(el.pillIcon, "icon", info?.icon);
    }, "pill");
    this._springs.push(this._swap.spring);
    this._pressable(el.home, { onTap: () => navigate(this._config.home_path) });
    wireModeChip(this, el.pill, () => el.card, () => this._config.mode_label);
    this._pressable(el.temp, { onTap: () => moreInfo(this, this._temp?.entity) });
    this._observe();
  }

  _observe() {
    if (!this._el || !this.isConnected) return;
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => { for (const r of [this._el.sensors, this._el.chips, this._el.rooms]) this._fitRow(r); });
    for (const r of [this._el.sensors, this._el.chips, this._el.rooms]) this._ro.observe(r);
  }

  _update() {
    const h = this._hass, c = this._config, el = this._el;
    if (!h || !el) return;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    el.home.hidden = !c.home_path;
    const info = this._modeInfo();
    this._renderPill(info, c.mode_label);
    el.spacer.hidden = !!info;

    const t = roomTemperature(h, c.area, c);
    this._temp = t;
    el.temp.hidden = !t;
    if (t) {
      text(el.deg, `${t.value.toFixed(1)}${t.unit.includes("°") ? t.unit : ` ${t.unit}`}`);
      attr(el.temp, "aria-label", `Temperature ${t.value.toFixed(1)} ${t.unit}`);
    }

    this._sensors();
    this._customChips();
    this._rooms();
    this._wake();
  }

  // Everything the room has, on or off: active ones in their colour, idle ones dimmed.
  _sensors() {
    const h = this._hass, c = this._config;
    const items = roomBadges(h, c.area, c, { idle: true }).map((b) => {
      const look = badgeLook(b), st = h.states[b.entity];
      const caption = b.cfg.name || b.kind?.name || shortName(h, b.entity, c.area);
      const value = stateText(h, st);
      return {
        key: b.key, icon: look.icon, stateObj: st, entity: b.entity,
        color: b.on ? (look.color || "var(--primary-text-color)") : "var(--secondary-text-color)",
        dim: !b.on, value, caption, aria: `${caption}, ${value}`,
        spin: look.spin ? (b.on && climateRunning(st) ? fanRate(st) : 0) : undefined,
        config: b.cfg, defaults: badgeDefaults(b),
        list: (from) => this._showList(caption, b.ids, look.color, from),
      };
    });
    this._chipRow(this._el.sensors, items, { iconOnly: !!c.icons_only });
  }

  _customChips() {
    const h = this._hass;
    const items = asItems(this._config.chips).map((x, i) => chipItem(h, x, i));
    this._chipRow(this._el.chips, items);
  }

  // Every other room, each a way there. Shown when rooms have somewhere to go: room_path
  // ("/lovelace/{slug}": {area} is the area id, {slug} the same with dashes), or a room's own.
  _rooms() {
    const h = this._hass, c = this._config;
    const overrides = new Map([].concat(c.rooms || []).filter((r) => r && typeof r === "object" && r.area).map((r) => [r.area, r]));
    const skip = new Set([c.area, ...[].concat(c.exclude_rooms || [])]);
    const rank = new Map([].concat(c.room_order || []).map((a, i) => [a, i]));
    const items = [];
    if (c.rooms !== false) {
      const areas = allAreas(h).filter((a) => !skip.has(a.id) && (areaEntities(h, a.id).length || overrides.has(a.id)));
      areas.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || (overrides.get(a.id)?.name || a.name).localeCompare(overrides.get(b.id)?.name || b.name));
      for (const a of areas) {
        const o = overrides.get(a.id) || {};
        const path = o.navigation_path || (c.room_path ? c.room_path.replace(/\{area\}/g, a.id).replace(/\{slug\}/g, a.id.replace(/_/g, "-")) : null);
        if (!path) continue;
        const name = o.name || a.name;
        items.push({ key: a.id, icon: o.icon || a.icon || "mdi:home-outline", value: name, aria: name,
          config: { tap_action: { action: "navigate", navigation_path: path } } });
      }
    }
    this._el.sep.hidden = !items.length;
    this._chipRow(this._el.rooms, items);
  }

  _paint(dirty, all, red) {
    if (all || dirty.has("pill")) this._swap.paint(red);
  }
}

// ---------- editor ----------
const areasOf = (hass, c) => allAreas(hass).filter((a) => a.id !== c.area && areaEntities(hass, a.id).length).map((a) => a.id);

const EDITOR = defineEditor("savvy-room-card", (hass, c) => [
  S.area(),
  ...modeSchema(hass, c, { helper: "The room's mode or scenes: any input_select or select." }),
  { name: "home_path", label: "Home button opens", helper: "A dashboard path; empty hides the button.", selector: { text: {} } },
  { name: "temperature", label: "Temperature", helper: "Found from the area. Pick another to override.", selector: { entity: { domain: ["sensor", "climate"] } } },
  ...badgeSchema({ pinnedHelp: "Always shown first, in this order: a lights helper, presence, a door. The rest of the room follows." }),
  S.bool("icons_only", "Icons only", "Just the coloured icons, no names or states.", false),
  S.chips("chips", "Chips", "Your own chips, in a row under the room's."),
  { name: "room_path", label: "Rooms row: each room opens", helper: "E.g. /lovelace/{slug} ({area}: the area id, {slug}: with dashes). Empty hides the row.", selector: { text: {} } },
  { name: "room_order", label: "Rooms order", type: "list", helper: "Rooms listed first, in this order; the rest follow by name.",
    initial: (h, cfg) => (h ? areasOf(h, cfg) : []), add: { selector: { area: {} }, label: "Add a room" },
    summary: (a, h) => ({ title: areaInfo(h, a).name, sub: a }) },
  { name: "exclude_rooms", label: "Rooms to leave out", selector: { area: { multiple: true } } },
]);

registerCard("savvy-room-card", SavvyRoomCard, "Room",
  "A room page's header: its mode, temperature, everything it has, and the way to every other room.");
})();

// ===== cards/tile.js =====
(() => {
// savvy-room-tile: a room at a glance. The icon sits in a small liquid drop that fills
// with the room's light: brighter as its lights are brighter, tinted by the first coloured
// bulb, wobbling like water when a light switches. Below, the room's badges.
//
// Everything comes from the area: its lights (the drop), its temperature, its badges.
//   type: custom:savvy-room-tile
//   area: kitchen
//   navigation_path: /lovelace/kitchen     tap: go there (else: list the room's lights)
//   double tap: the room's lights on/off   hold: list the room's lights
//   mode: input_select.kitchen_mode        toggle: input_boolean.kitchen_lights (optional)
//   lights / count / color_lights: overrides    entities / auto_discover: the badges
//
// The drop's outline is a circle plus three lobes (2, 3 and 4 around the rim), each its
// own spring; like a real droplet the higher lobes ring faster and settle sooner.

const HUE_MODES = new Set(["hs", "xy", "rgb", "rgbw", "rgbww"]);
const PREDICT_MS = 1500;     // how long an optimistic switch waits for HA to agree
const TILE_BADGE = 30;
const TILE_MOTION = {
  light: { response: 0.75, damping: 1 },
  wander: { response: 1.4, damping: 1 },
  bloomOn: { response: 1.3, damping: 1 },
  bloomOff: { response: 1.0, damping: 1 },
  halo: { response: 0.9, damping: 1 },
  swell: { response: 0.55, damping: 0.45 },
  text: { response: 0.55, damping: 1 },
};
// Rayleigh drop: lobe k rings at roughly sqrt(k(k-1)(k+2)) and loses energy faster as k grows
const DROP = [
  { k: 2, response: 0.74, damping: 0.3, kick: 0.8, wander: 0.034 },
  { k: 3, response: 0.38, damping: 0.4, kick: 0.72, wander: 0.017 },
  { k: 4, response: 0.25, damping: 0.52, kick: 0.5, wander: 0 },
];
// liquid material per theme: [base, extra at full brightness]
const LIQUID = {
  dark: { core: [0.26, 0.5], rim: [0.14, 0.26], sheen: 1, icon: 76, spill: 0.85 },
  light: { core: [0.22, 0.38], rim: [0.12, 0.22], sheen: 0.5, icon: 58, spill: 0.45 },
};
const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (v) => { v = clamp(v); return v * v * (3 - 2 * v); };
const scaleBy = (x, depth) => (Math.abs(x) < 1e-4 ? "" : `scale(${(1 - depth * x).toFixed(4)})`);

let paint2d;
const toRgb = (css) => {
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(css).trim());
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, "$&$&") : hex[1];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  paint2d = paint2d || document.createElement("canvas").getContext("2d");
  paint2d.fillStyle = "#000";
  paint2d.fillStyle = css;
  const out = paint2d.fillStyle;
  if (out[0] === "#") return toRgb(out);
  const n = out.match(/[\d.]+/g);
  return n ? n.slice(0, 3).map(Number) : [245, 184, 61];
};
// Pull a bulb colour into a band that reads as light on both themes; near-white isn't a
// colour choice, so it returns null and the card's tint wins.
const legible = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  if (s < 0.12) return null;
  let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  const S2 = clamp(s, 0.45, 1), L = clamp(l, 0.5, 0.72);
  const a = S2 * Math.min(L, 1 - L);
  const f = (n) => { const k = (n + hue / 30) % 12; return Math.round((L - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255); };
  return [f(0), f(8), f(4)];
};

const STYLE = `${BASE_CSS}
  ha-card { --well: 42px; --gap: 12px; --chip: 28px; --tint: 245 184 61;
    display: flex; flex-direction: column; gap: 4px; padding: var(--pad); overflow: hidden; cursor: pointer;
    user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: manipulation; outline: none; }
  :host([dark]) ha-card::after { z-index: 2; }
  @media (hover: hover) { ha-card:hover { background: color-mix(in oklab, var(--primary-text-color) 2.5%, var(--ha-card-background, var(--card-background-color))); } }
  :host([kbd]) ha-card:focus-visible { outline: 2px solid rgb(var(--tint)); outline-offset: 2px; }

  /* light spilling from the drop into the card; only ever seen when a switch happens */
  .spill { position: absolute; z-index: 0; inset-inline-start: calc(var(--pad) + var(--well) / 2); top: calc(var(--pad) + var(--well) / 2);
    width: 320px; height: 320px; margin: -160px 0 0 -160px; border-radius: 50%; pointer-events: none; opacity: 0;
    background: radial-gradient(closest-side, rgb(var(--tint) / 0.9), rgb(var(--tint) / 0.42) 13%, rgb(var(--tint) / 0.16) 30%, rgb(var(--tint) / 0.05) 54%, rgb(var(--tint) / 0)); }
  :host([dark]) .spill { mix-blend-mode: plus-lighter; }
  .top { position: relative; z-index: 1; display: flex; align-items: center; gap: var(--gap); min-width: 0; }
  .well { position: relative; flex: none; width: var(--well); height: var(--well); display: grid; place-items: center; }
  .well > svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  :host([dark]) .well > svg { mix-blend-mode: plus-lighter; }
  .well ha-icon { --mdc-icon-size: 22px; position: relative; display: flex; color: var(--icon, var(--secondary-text-color)); }
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .name { font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.016em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* the secondary line: the mode carries the colour, the temperature stays quiet */
  .sub { display: flex; align-items: center; gap: 12px; min-width: 0; font-size: 12.5px; line-height: 18px; }
  .sub > [role="button"] { display: inline-flex; align-items: center; min-width: 0; padding: 3px 5px; margin: -3px -5px; border-radius: 7px; outline: none; transform-origin: 20% 50%; }
  :host([kbd]) .sub > [role="button"]:focus-visible { box-shadow: 0 0 0 2px rgb(var(--tint)); }
  .swap { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
  .dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--mode); }
  .mode:not([data-c]) .dot { display: none; }
  .label { font-weight: 500; letter-spacing: -0.004em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mode[data-c] .label { color: color-mix(in oklab, var(--mode) 64%, var(--primary-text-color)); }
  .temp { flex: none; color: var(--secondary-text-color); letter-spacing: 0; }

  /* breathing room so halos aren't cut off */
  .badges { position: relative; z-index: 1; display: flex; align-items: center; height: var(--chip); padding: 8px; margin: -8px; margin-inline-start: -13px; overflow: hidden; }
  .badges[data-overflow] { -webkit-mask-image: linear-gradient(to left, transparent 8px, #000 40px); mask-image: linear-gradient(to left, transparent 8px, #000 40px); }
  @container (min-width: 300px) { .badges { padding-inline-start: calc(8px + var(--well) + var(--gap)); } }
  .badge { position: relative; flex: none; width: 0; height: var(--chip); outline: none; }
  .chip { position: absolute; top: 0; inset-inline-start: 0; width: var(--chip); height: var(--chip); border-radius: 50%;
    display: grid; place-items: center; color: var(--secondary-text-color); opacity: 0; }
  .chip::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: color-mix(in oklab, var(--bc) 22%, transparent); opacity: 0; }
  .badge[data-critical] .chip::before { opacity: var(--on, 0); }
  :host([kbd]) .badge:focus-visible .chip { box-shadow: 0 0 0 2px rgb(var(--tint)); }
  .chip ha-icon, .chip ha-state-icon { --mdc-icon-size: 18px; position: relative; display: flex; }
  .halo { position: absolute; top: 50%; inset-inline-start: calc(var(--chip) / 2); width: 60px; height: 60px; margin: -30px 0 0 -30px;
    border-radius: 50%; pointer-events: none; opacity: 0; background: radial-gradient(closest-side, color-mix(in oklab, var(--bc) 42%, transparent), transparent); }
  @media (prefers-contrast: more) { .temp { color: var(--primary-text-color); } }
`;

class SavvyRoomTile extends SavvyCard {
  static getStubConfig(hass) {
    const a = allAreas(hass).find((x) => areaLights(hass, x.id).length) || allAreas(hass)[0];
    return a ? { area: a.id } : {};
  }
  static getConfigElement() { return document.createElement(EDITOR); }

  constructor() {
    super();
    this._onscreen = true;
    this._painted = 0;
  }

  setConfig(config) {
    if (!config || (!config.area && !config.name)) throw new Error("savvy-room-tile: set an area");
    // pre-Savvy keys: light_group / light_counter / color_light / light_state
    const c = legacyBadges({ tint: LIGHT_COLOR, ...config });
    c.lights = config.lights ?? config.light_group;
    c.count = config.count ?? config.light_counter;
    c.color_lights = config.color_lights ?? config.color_light;
    c.toggle = config.toggle ?? config.light_state;
    this._config = c;
    this._baseTint = toRgb(colorOf(c.tint).replace(/^var\(--[^,]+,\s*([^)]+)\)$/, "$1"));
    if (this._el) { this._build(); if (this._hass) this._update(); }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._el) this._build();
    this._update();
    this._list?.render(hass);
  }

  connectedCallback() { this._observe(); this._wake(); }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._io?.disconnect();
    clearTimeout(this._optTimer);
  }
  getCardSize() { return 2; }
  getGridOptions() { return { columns: 6, rows: 2, min_rows: 2, max_rows: 2 }; }

  _modeInfo() { return this._hass && modeInfo(this._hass, this._config.mode, this._config); }

  _lights() {
    const c = this._config, h = this._hass;
    if (c.lights) return asItems(c.lights).map((i) => i.entity).filter((id) => h.states[id]);
    return c.area ? areaLights(h, c.area) : [];
  }

  // tap: the room's page if there is one, else its lights; double tap: lights on/off;
  // hold: the lights, each with its switch
  _actions() {
    const c = this._config;
    return {
      tap_action: c.tap_action || (c.navigation_path ? { action: "navigate", navigation_path: c.navigation_path } : { action: "list" }),
      double_tap_action: c.double_tap_action || { action: "savvy-lights" },
      hold_action: c.hold_action || { action: "list" },
    };
  }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._resetMotion();
    this._first = true;
    this._prev = {};
    this._optimistic = null;
    this._predicted = null;
    this._hadTemp = false;
    this._badges = new Map();
    // each tile wanders on its own clock so a dashboard never moves in lockstep
    this._seed = DROP.map(() => [rand(0, TAU), rand(0, TAU), rand(8, 12), rand(10, 15)]);
    this._X = new Float32Array(18);
    this._Y = new Float32Array(18);
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card tabindex="0" role="button">
        <span class="spill" id="spill" aria-hidden="true"></span>
        <div class="top">
          <div class="well" aria-hidden="true">
            <svg viewBox="0 0 100 100" focusable="false">
              <defs>
                <radialGradient id="liquid-fill" cx="50%" cy="46%" r="60%"><stop id="core" offset="0"></stop><stop id="rim" offset="1"></stop></radialGradient>
                <radialGradient id="sheen-fill" cx="50%" cy="8%" r="42%"><stop offset="0" stop-color="#fff" stop-opacity="0.14"></stop><stop offset="1" stop-color="#fff" stop-opacity="0"></stop></radialGradient>
              </defs>
              <path id="liquid" fill="url(#liquid-fill)"></path><path id="sheen" fill="url(#sheen-fill)" opacity="0"></path>
            </svg>
            <ha-icon id="icon"></ha-icon>
          </div>
          <div class="main">
            <span class="name" id="name"></span>
            <div class="sub">
              <span class="mode" id="mode" role="button" tabindex="0" hidden><span class="swap" id="swap"><i class="dot"></i><span class="label" id="label"></span></span></span>
              <span class="temp" id="temp" role="button" tabindex="0" hidden></span>
            </div>
          </div>
        </div>
        <div class="badges" id="badges"></div>
      </ha-card>`;
    const $ = (id) => root.getElementById(id);
    const card = root.querySelector("ha-card");
    this._el = { card, spill: $("spill"), liquid: $("liquid"), sheen: $("sheen"), core: $("core"), rim: $("rim"), icon: $("icon"),
      name: $("name"), mode: $("mode"), swap: $("swap"), label: $("label"), temp: $("temp"), badges: $("badges") };

    const [r, g, b] = this._baseTint;
    const L = TILE_MOTION;
    this._sp = {
      temp: this._spring(0, L.text, "temp", 0.002),
      intensity: this._spring(0, L.light, "liquid"),
      r: this._spring(r, L.light, "liquid", 0.3), g: this._spring(g, L.light, "liquid", 0.3), b: this._spring(b, L.light, "liquid", 0.3),
      glow: this._spring(0, L.bloomOn, "liquid"),
      scale: this._spring(0, L.swell, "liquid", 5e-4),
      wander: this._spring(0, L.wander, "liquid"),
      drop: DROP.map((d) => ({ a: this._spring(0, d, "liquid", 5e-4), b: this._spring(0, d, "liquid", 5e-4) })),
    };

    // the card: its actions, with the lights toggle as a Savvy action of its own
    const ctx = () => ({ config: this._actions(), entity: this._config.toggle || this._lights()[0],
      list: () => this._showList(this._name(), this._lights(), `rgb(${this._tint().join(" ")})`, card) });
    const spring = this._spring(0, MOTION.press, "card");
    card.__spring = spring;
    card.__depth = 0.02;
    this._pressNodes.push(card);
    const act = (kind) => () => {
      const a = asAction(this._actions()[`${kind}_action`]);
      if (a?.action === "savvy-lights") return this._toggleLights();
      runAction(this, this._hass, a, ctx());
    };
    bindPress(card, { spring, wake: () => this._wake(), onTap: act("tap"), onHold: act("hold"),
      onDouble: asAction(this._actions().double_tap_action)?.action === "none" ? null : act("double_tap") });

    // the secondary line: tap does the card's tap, hold opens the entity behind it
    const line = (node, entity) => {
      node.addEventListener("pointerdown", (e) => e.stopPropagation());     // never also presses the card
      this._pressable(node, { onTap: act("tap"), onHold: () => moreInfo(this, entity()) }, 0.08);
    };
    line(this._el.mode, () => this._config.mode);
    line(this._el.temp, () => this._temp?.entity);
    this._swap = new Swap(this._el.swap, (v) => {
      const info = this._modeInfo();
      text(this._el.label, info?.label || v);
      put(this._el.mode, "--mode", info?.color || "");
      attr(this._el.mode, "data-c", !!info?.color);
    }, "mode");
    this._springs.push(this._swap.spring);
    this._observe();
  }

  _observe() {
    if (!this._el || !this.isConnected) return;
    this._io?.disconnect();
    this._io = new IntersectionObserver(([e]) => { this._onscreen = e.isIntersecting; if (this._onscreen) this._wake(); });
    this._io.observe(this);
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => this._fitBadges());
    this._ro.observe(this._el.badges);
  }

  _name() {
    const c = this._config;
    return c.name || (c.area ? areaInfo(this._hass, c.area).name : "Room");
  }

  // The room's lights, on or off. With a toggle entity (a helper wired to your own
  // automations) that's what switches; otherwise the lights themselves: any on -> all off.
  // The card answers first (the drop reacts now), then HA confirms or the guess expires.
  _toggleLights() {
    const c = this._config, h = this._hass;
    const lights = this._lights();
    let from;
    if (c.toggle && h.states[c.toggle]) {
      from = h.states[c.toggle].state === "on";
      toggleEntity(h, c.toggle);
    } else {
      if (!lights.length) return;
      from = lights.some((id) => h.states[id].state === "on");
      h.callService("light", from ? "turn_off" : "turn_on", {}, { entity_id: lights });
    }
    haptic("light");
    const dir = from ? -1 : 1;
    this._optimistic = { from, dir };
    clearTimeout(this._optTimer);
    this._optTimer = setTimeout(() => { this._optimistic = null; this._update(); }, PREDICT_MS * 2);
    this._switched(dir);
    this._predicted = { dir, t: performance.now() };
    this._update();
  }

  _isOn() {
    const c = this._config, h = this._hass;
    if (c.toggle && h.states[c.toggle]) return h.states[c.toggle].state === "on";
    return this._lights().some((id) => h.states[id].state === "on");
  }

  _count() {
    const h = this._hass, s = this._config.count && h.states[this._config.count];
    if (s) { const m = s.state.match(/\d+/); return m ? parseInt(m[0], 10) : 0; }
    return this._lights().filter((id) => h.states[id].state === "on").length;
  }

  _tint() {
    const h = this._hass;
    const ids = this._config.color_lights ? asItems(this._config.color_lights).map((i) => i.entity) : this._lights();
    for (const id of ids) {
      const st = h.states[id];
      if (!st || st.state !== "on" || !HUE_MODES.has(st.attributes.color_mode)) continue;
      const rgb = st.attributes.rgb_color && legible(st.attributes.rgb_color);
      if (rgb) return rgb;
    }
    return this._baseTint;
  }

  _update() {
    const h = this._hass, c = this._config, el = this._el;
    if (!h || !el) return;
    this._reduced = MQ.reduced.matches;
    this._dark = !!h.themes?.darkMode;
    this.toggleAttribute("dark", this._dark);
    const area = c.area ? areaInfo(h, c.area) : null;
    text(el.name, this._name());
    attr(el.icon, "icon", c.icon || area?.icon || "mdi:home-outline");
    attr(el.card, "aria-label", this._name());

    const info = this._modeInfo();
    el.mode.hidden = !info;
    if (info) { attr(el.mode, "aria-label", `${info.label} mode`); this._swap.set(info.value); }

    const t = roomTemperature(h, c.area, c);
    this._temp = t;
    el.temp.hidden = !t;
    if (t) {
      this._unit = t.unit.includes("°") ? "°" : ` ${t.unit}`;
      attr(el.temp, "aria-label", `Temperature ${t.value.toFixed(1)} ${t.unit}`);
      if (!this._hadTemp || this._reduced) this._sp.temp.snap(t.value); else this._sp.temp.to(t.value);
    }
    this._hadTemp = !!t;

    this._light();
    this._renderBadges();
    if (this._first) {
      this._first = false;
      this._paintAll(null);
      this._fitBadges();
    }
    this._wake();
  }

  _light() {
    const h = this._hass, c = this._config, sp = this._sp;
    const hasToggle = !!(c.toggle && h.states[c.toggle]);
    const stateOn = this._isOn();
    const count = this._count();
    let sum = 0, lit = 0;
    for (const id of this._lights()) {
      const st = h.states[id];
      if (st.state !== "on") continue;
      lit++;
      sum += (st.attributes.brightness ?? 255) / 255;
    }
    const lum = lit ? sum / lit : 0;
    // with a toggle entity, lights on while it's off read as "partly lit"
    const mode = stateOn ? "on" : hasToggle && (count > 0 || lum > 0) ? "partial" : "off";
    const level = lum > 0 ? lum : mode === "on" ? 0.6 : 0.35;

    const opt = this._optimistic;
    if (opt && stateOn !== opt.from) { this._optimistic = null; clearTimeout(this._optTimer); }
    const shown = this._optimistic ? (this._optimistic.dir > 0 ? "on" : "off") : mode;
    let I = 0;
    if (shown === "on") I = 0.5 + 0.5 * level;
    else if (shown === "partial") I = 0.18 + 0.22 * level;
    this._level = shown === "off" ? 0 : level;

    // a dark drop has no colour to travel from, so a new tint lands instantly
    if (shown !== "off") {
      const tint = this._tint();
      const jump = this._first || sp.intensity.x < 0.03;
      [sp.r, sp.g, sp.b].forEach((s, i) => (jump ? s.snap(tint[i]) : s.to(tint[i])));
    }
    if (this._first) sp.intensity.snap(this._reduced ? I : 0);    // the room's light comes up once, on load
    sp.intensity.to(I);
    sp.wander.to(shown !== "off" && !this._reduced ? 1 : 0);
    if (this._reduced) sp.wander.snap();

    // every light switch: a bulb joining or leaving, or the room switch flipping
    const prev = this._prev;
    if (prev.count !== undefined) {
      let dir = 0;
      if (count !== prev.count) dir = count > prev.count ? 1 : -1;
      else if ((prev.mode === "on") !== (mode === "on")) dir = mode === "on" ? 1 : -1;
      if (dir) this._switched(dir);
    }
    prev.count = count;
    prev.mode = mode;
  }

  _switched(dir) {
    const p = this._predicted;
    this._predicted = null;
    if (p && p.dir === dir && performance.now() - p.t < PREDICT_MS) return;     // already played it
    const sp = this._sp, up = dir > 0;
    bloom(sp.glow, up ? 0.5 + 0.45 * this._level : 0.26, up ? TILE_MOTION.bloomOn : TILE_MOTION.bloomOff);
    if (!this._reduced) {
      // on swells outward, off draws in; the lobes get a fresh random shape every time
      sp.scale.kick(up ? 0.9 : -0.7, 0.3);
      sp.drop.forEach((m, i) => {
        const amp = rand(0.55, 1) * DROP[i].kick * (up ? 1 : 0.8), phi = rand(0, TAU);
        m.a.kick(amp * Math.cos(phi), 0.3);
        m.b.kick(amp * Math.sin(phi), 0.3);
      });
    }
    this._wake();
  }

  _renderBadges() {
    const h = this._hass, c = this._config, list = roomBadges(h, c.area, c);
    const seen = new Set(), red = this._reduced, first = this._first;
    for (const b of list) {
      seen.add(b.key);
      const look = badgeLook(b);
      // the room's own lights toggle glows in the drop's colour
      const isToggle = b.entity === c.toggle;
      const color = !b.cfg.color && (isToggle || look.color === LIGHT_COLOR) ? "rgb(var(--tint))" : look.color;
      let item = this._badges.get(b.key);
      if (!item) {
        const node = document.createElement("span");
        node.className = "badge";
        node.setAttribute("role", "button");
        node.innerHTML = `<span class="halo"></span><span class="chip">${look.icon ? "<ha-icon></ha-icon>" : "<ha-state-icon></ha-state-icon>"}</span>`;
        const group = `badge:${b.key}`;
        item = { el: node, chip: node.querySelector(".chip"), halo: node.querySelector(".halo"), icon: node.querySelector("ha-icon, ha-state-icon"),
          shown: this._spring(0, MOTION.ui, group, 0.002), on: this._spring(0, MOTION.ui, group, 0.002),
          glow: this._spring(0, TILE_MOTION.halo, group), press: this._spring(0, MOTION.press, group), b };
        // a badge tap is its own: it never also taps the card
        node.addEventListener("pointerdown", (e) => e.stopPropagation());
        const act = (kind) => () => {
          const cur = item.b, cfgA = cur.cfg[`${kind}_action`];
          // the room's toggle, tapped: the same optimistic switch as the card's double tap
          if (kind === "tap" && cur.entity === this._config.toggle && cfgA === undefined) return this._toggleLights();
          runAction(this, this._hass, cfgA !== undefined ? cfgA : badgeDefaults(cur)[kind], { entity: cur.entity,
            list: () => this._showList(cur.kind?.name || shortName(this._hass, cur.entity), cur.ids, badgeLook(cur).color, node) });
        };
        bindPress(node, { spring: item.press, wake: () => this._wake(), onTap: act("tap"), onHold: act("hold") });
        this._badges.set(b.key, item);
      }
      item.b = b;
      const st = h.states[b.entity];
      let on = b.on;
      if (isToggle && this._optimistic) on = this._optimistic.dir > 0;
      if (look.icon) attr(item.icon, "icon", look.icon);
      else if (item.icon.stateObj !== st) { item.icon.hass = h; item.icon.stateObj = st; }
      put(item.el, "--bc", color || "var(--primary-text-color)");
      attr(item.el, "data-critical", look.critical);
      attr(item.el, "aria-label", `${b.cfg.name || shortName(h, b.entity, c.area)}, ${stateText(h, st)}`);
      const wasShown = item.shown.target === 1, wasOn = item.on.target === 1;
      if (!wasShown) this._rowDirty = true;
      item.shown.to(1);
      item.on.to(on ? 1 : 0);
      if (first) { item.shown.snap(); item.on.snap(); } else if (red) item.shown.snap();
      // a soft bloom when something joins the row or wakes up; never on first paint
      if (!first && !red && (!wasShown || (on && !wasOn))) bloom(item.glow, 0.8, TILE_MOTION.halo);
      if (look.spin) {
        const spin = this._spinner(b.key, item.icon);
        spin.s.to(on && climateRunning(st) && !red ? fanRate(st) : 0);
        if (red) spin.s.snap();
      }
      item.el.tabIndex = 0;
      attr(item.el, "aria-hidden", "false");
    }
    for (const [key, item] of this._badges) {
      if (seen.has(key)) continue;
      if (item.shown.target !== 0) this._rowDirty = true;
      item.shown.to(0);
      item.on.to(0);
      if (red) item.shown.snap();
      this._spins.get(key)?.s.to(0);
      item.el.tabIndex = -1;
      attr(item.el, "aria-hidden", "true");
    }
    const want = list.map((b) => this._badges.get(b.key).el);
    const kids = [...this._el.badges.children];
    if (want.some((n, i) => kids[i] !== n)) {
      for (const n of want) this._el.badges.appendChild(n);
      for (const [key, item] of this._badges) if (!seen.has(key)) this._el.badges.appendChild(item.el);
    }
  }

  _fitBadges() {
    const row = this._el?.badges;
    if (row) row.toggleAttribute("data-overflow", row.scrollWidth > row.clientWidth + 1);
  }

  // Idle drift is sub-pixel per frame: 30fps is indistinguishable, and offscreen it stops.
  _frame(now, dt) {
    const wandering = this._sp && this._sp.wander.x > 1e-3;
    const stepping = this._springs.some((s) => !s.idle) || [...this._spins.values()].some((s) => s.s.x >= 1e-4);
    if (!stepping && wandering) {
      if (!this._onscreen) return false;
      if (now - this._painted < 33) return true;
      this._paintAll(new Set(["liquid"]));
      return true;
    }
    return super._frame(now, dt) || wandering;
  }

  _paint(dirty, all, red) {
    const sp = this._sp, e = this._el;
    this._painted = performance.now();
    if (this._sp.wander.x > 1e-3) dirty?.add("liquid");
    if (all || dirty.has("mode")) this._swap.paint(red);
    if ((all || dirty.has("temp")) && !e.temp.hidden) {
      const n = Math.round(sp.temp.x * 10) / 10;
      text(e.temp, `${(n || 0).toFixed(1)}${this._unit}`);
    }
    if (all || dirty.has("liquid")) this._paintLiquid(performance.now());
    const idle = MQ.contrast.matches ? 0.66 : 0.42;
    for (const [key, item] of this._badges) {
      if (!all && !dirty.has(`badge:${key}`)) continue;
      const shown = clamp(item.shown.x), on = clamp(item.on.x), press = item.press.x, g = Math.max(0, item.glow.x);
      const vis = item.shown.target === 1 ? Math.sqrt(shown) : shown * shown;
      put(item.el, "width", `${(shown * TILE_BADGE).toFixed(2)}px`);
      put(item.chip, "opacity", (vis * lerp(idle, 1, on) * (1 - (red ? 0.3 : 0.06) * clamp(press))).toFixed(3));
      put(item.chip, "transform", red ? "" : `scale(${((0.6 + 0.4 * shown) * (1 - 0.14 * press)).toFixed(4)})`);
      put(item.chip, "--on", on.toFixed(3));
      put(item.chip, "color", on > 1e-3 ? `color-mix(in oklab, var(--bc) ${(on * 100).toFixed(1)}%, var(--secondary-text-color))` : "");
      put(item.halo, "opacity", g.toFixed(3));
      put(item.halo, "transform", g < 1e-3 ? "" : `scale(${(0.5 + 0.7 * Math.min(1, g)).toFixed(3)})`);
    }
    if (this._rowDirty && [...this._badges.values()].every((i) => i.shown.idle)) {
      this._rowDirty = false;
      this._fitBadges();
    }
  }

  _paintLiquid(now) {
    const sp = this._sp, e = this._el, look = this._dark ? LIQUID.dark : LIQUID.light;
    const I = clamp(sp.intensity.x), lit = smooth(I / 0.2);
    const tint = [sp.r.x, sp.g.x, sp.b.x].map((v) => Math.round(clamp(v, 0, 255)));
    put(e.card, "--tint", tint.join(" "));
    // material: neutral still water when dark, tinted light when lit
    const mix = tint.map((v) => Math.round(lerp(127, v, lit))).join(" ");
    attr(e.core, "stop-color", `rgb(${mix})`);
    attr(e.rim, "stop-color", `rgb(${mix})`);
    attr(e.core, "stop-opacity", lerp(0.1, look.core[0] + look.core[1] * I, lit).toFixed(3));
    attr(e.rim, "stop-opacity", lerp(0.1, look.rim[0] + look.rim[1] * I, lit).toFixed(3));
    attr(e.sheen, "opacity", (lit * (0.3 + 0.7 * I) * look.sheen).toFixed(3));
    const pct = Math.round(lit * 50) * 2;
    put(e.icon, "--icon", pct ? `color-mix(in oklab, color-mix(in oklab, rgb(${tint.join(" ")}) ${look.icon}%, var(--primary-text-color)) ${pct}%, var(--secondary-text-color))` : "");
    const swell = sp.scale.x;
    put(e.icon, "transform", Math.abs(swell) < 1e-4 ? "" : `scale(${(1 + swell * 0.6).toFixed(4)})`);
    // the event glow: kicked by a switch, fades by itself
    const g = Math.max(0, sp.glow.x);
    put(e.spill, "opacity", g < 1e-3 ? "0" : (g * look.spill).toFixed(3));
    put(e.spill, "transform", this._reduced || g < 1e-3 ? "" : `scale(${(0.7 + 0.45 * Math.min(1, g)).toFixed(3)})`);
    // outline: circle + lobes (spring motion + slow wander), through a closed Catmull-Rom spline
    const t = now / 1000, W = sp.wander.x, R = 50 * (1 + swell);
    const coef = DROP.map((d, i) => {
      const s = this._seed[i];
      return [d.k, sp.drop[i].a.x + W * d.wander * Math.cos((TAU * t) / s[2] + s[0]), sp.drop[i].b.x + W * d.wander * Math.sin((TAU * t) / s[3] + s[1])];
    });
    const X = this._X, Y = this._Y, N = X.length;
    for (let i = 0; i < N; i++) {
      const th = (i / N) * TAU;
      let r = 1;
      for (const [k, a, b] of coef) r += a * Math.cos(k * th) + b * Math.sin(k * th);
      X[i] = 50 + R * r * Math.cos(th);
      Y[i] = 50 + R * r * Math.sin(th);
    }
    const f = (v) => v.toFixed(2);
    let d = `M${f(X[0])} ${f(Y[0])}`;
    for (let i = 0; i < N; i++) {
      const i0 = (i + N - 1) % N, i2 = (i + 1) % N, i3 = (i + 2) % N;
      d += `C${f(X[i] + (X[i2] - X[i0]) / 6)} ${f(Y[i] + (Y[i2] - Y[i0]) / 6)} ${f(X[i2] - (X[i3] - X[i]) / 6)} ${f(Y[i2] - (Y[i3] - Y[i]) / 6)} ${f(X[i2])} ${f(Y[i2])}`;
    }
    d += "Z";
    attr(e.liquid, "d", d);
    attr(e.sheen, "d", d);
  }
}

// ---------- editor ----------
const EDITOR = defineEditor("savvy-room-tile", (hass, c) => [
  S.area(),
  S.grid(S.text("name", "Name"), S.icon("icon", "Icon")),
  { name: "navigation_path", label: "Tapping opens", helper: "A dashboard path, e.g. /lovelace/kitchen. Empty: tapping lists the room's lights.", selector: { text: {} } },
  ...modeSchema(hass, c),
  { name: "temperature", label: "Temperature", helper: "Found from the area. Pick another to override.", selector: { entity: { domain: ["sensor", "climate"] } } },
  S.section("Lights", [
    { name: "toggle", label: "Lights switch", helper: "Empty: a double tap turns the room's lights off (or on). A helper here is what switches instead.", selector: { entity: {} } },
    { name: "lights", label: "Lights", helper: "Found from the area. Pick to use only these.", selector: { entity: { domain: "light", multiple: true } } },
    { name: "count", label: "Count from", helper: "A sensor with the number of lights on, instead of counting.", selector: { entity: { domain: "sensor" } } },
    { name: "color_lights", label: "Colour from", helper: "Lights whose colour tints the drop. Empty: any of the room's lights.", selector: { entity: { domain: "light", multiple: true } } },
    S.color("tint", "Tint when the lights are white"),
  ]),
  ...badgeSchema(),
  S.section("Actions", [S.action("tap_action", "Tap"), S.action("double_tap_action", "Double tap"), S.action("hold_action", "Hold")]),
]);

registerCard("savvy-room-tile", SavvyRoomTile, "Room tile",
  "A room at a glance: a drop that fills with its light, its mode, temperature and live badges.");
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

  // Start runs the configured start (e.g. an app routine button) or
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
