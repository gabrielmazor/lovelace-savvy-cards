/*! Savvy Cards v0.10.5 | MIT License | built from src/ by build.mjs, do not edit */
(() => {
"use strict";
const SAVVY_VERSION = "0.10.5";

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
// A state attribute that changes colours (data-on, data-level, ...) goes through Motion, which
// slides the colours it changed; the first write to an element is its initial state, not a change.
const attr = (el, name, val) => {
  if (!el) return;
  const cache = el.__attr || (el.__attr = {});
  if (cache[name] === val) return;
  const first = cache[name] === undefined;
  cache[name] = val;
  if (first) Motion.seen(el);
  const apply = () => {
    if (val === null || val === undefined || val === false) el.removeAttribute(name);
    else el.setAttribute(name, val === true ? "" : val);
  };
  if (!first && TINT_ATTRS.has(name) && Motion.can(el)) Motion.change(el, apply);
  else {
    apply();
    if (!first && name === "icon" && Motion.can(el)) Motion.pop(el);
  }
};
// Text is final the moment it is written; when it replaces an earlier value the element rolls
// (Motion.roll), and a count ticks. The first value an element gets never animates.
const text = (el, val) => {
  if (!el || el.__text === val) return;
  const old = el.__text;
  el.__text = val;
  el.textContent = val;
  if (old === undefined) Motion.seen(el);
  else if (Motion.can(el) && Motion.rollable(el)) Motion.roll(el, String(old), String(val));
};

// The companion apps turn this into a real haptic; elsewhere it's a no-op.
const haptic = (type) => window.dispatchEvent(new CustomEvent("haptic", { detail: type }));

const moreInfo = (host, entityId) => {
  if (!entityId) return;
  entityId = AGG_TARGET.get(entityId) || entityId;     // a merged room's stand-in opens the sensor that is on
  host.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
};

// Going to the page that is already open does nothing: pushing the same path makes the
// dashboard rebuild its view, and the page jumps back to the top.
const samePage = (url) => {
  try {
    const to = new URL(url, location.href), here = location;
    const norm = (p) => p.replace(/\/+$/, "") || "/";
    return norm(to.pathname) === norm(here.pathname) && to.search === here.search && (!to.hash || to.hash === here.hash);
  } catch (err) { return false; }
};

const navigate = (path, replace = false) => {
  if (!path) return;
  const url = path.startsWith("/") ? path : `${location.pathname.replace(/\/[^/]*$/, "")}/${path}`;
  if (samePage(url)) return;
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

// The roll: while a value changes, the real text hides and its two pseudo-elements draw the
// old words leaving and the new ones arriving (Motion.roll drives --rl from 0 to 1).
const ROLL_CSS = `
  [data-rolling] { position: relative; color: transparent !important; -webkit-text-fill-color: transparent !important; }
  [data-rolling]::before, [data-rolling]::after { position: absolute; inset: 0; display: block; overflow: inherit; text-overflow: inherit;
    text-align: inherit; white-space: pre; pointer-events: none; color: var(--rl-c); -webkit-text-fill-color: var(--rl-c); }
  [data-rolling]::before { content: attr(data-out); opacity: calc(1 - var(--rl, 1)); translate: 0 calc(var(--rl, 1) * -0.42em); }
  [data-rolling]::after { content: attr(data-in); opacity: var(--rl, 1); translate: 0 calc((1 - var(--rl, 1)) * 0.42em); }
  [data-rolling="tick"]::before { content: none; }
  [data-rolling="tick"]::after { opacity: 1; translate: none; }
`;

// The design language, one set of numbers for every card and popup (docs/DESIGN.md 5):
//   badge   a circle that stands for a thing (a room, a light, a lock, a player): S 28, M 36, L 44
//   control a rounded square you press (power, a swatch, a step, a toolbar button): S 32, L 40
//   tones   off = the well, on = 16% of the state colour, alert = 18% of amber or red
//   glow    a soft corner wash in the state colour, nothing when idle (ha-card::before, --glow 0..1)
// the same three colours as hex, for the places that need a string (and the --lvl-* variables below)
const TONE = { good: "#4CAF50", warn: "#E8A33D", bad: "#E06666" };
const DESIGN_TOKENS = `
    --good-rgb: 76 175 80; --warn-rgb: 232 163 61; --bad-rgb: 224 102 102;
    --b-s: 28px; --b-m: 36px; --b-l: 44px; --c-s: 32px; --c-l: 40px;
    --mix-on: 16%; --mix-alert: 18%;`;
const GLOW_CSS = `
  ha-card::before { content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit; corner-shape: inherit; pointer-events: none;
    background: radial-gradient(140% 110% at 0% 0%, rgb(var(--glow-rgb, var(--accent)) / calc(var(--glow, 0) * 0.1 + var(--pulse, 0) * 0.05)), transparent 66%); }
`;

// The CSS every card shares: host basics, the card surface, focus rings.
const BASE_CSS = `${ROLL_CSS}${GLOW_CSS}
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
    --lvl-good: ${TONE.good};
    --lvl-warn: ${TONE.warn};
    --lvl-bad: ${TONE.bad};
    ${DESIGN_TOKENS}
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
  wireSettings(type, cls);       // fills in what the dashboard's Savvy settings supply (core/settings)
  if (!customElements.get(type)) customElements.define(type, cls);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === type)) {
    window.customCards.push({ type, name: `Savvy ${name}`, description, preview: true });
  }
};

// Puts `node` at `index` in `box` only if it isn't already there. Re-appending every child on
// each state update pulls the element under a finger or a wheel out and back in, which cancels
// a scroll in progress.
const place = (box, node, index) => {
  if (box.children[index] !== node) box.insertBefore(node, box.children[index] || null);
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

// What a chip or badge says. A media player is either playing or not: paused, idle, on,
// standby and off all read "Not playing" (unavailable stays unavailable).
function chipState(hass, st) {
  if (st && String(st.entity_id).startsWith("media_player.") && st.state !== "playing"
    && st.state !== "unavailable" && st.state !== "unknown") return "Not playing";
  return stateText(hass, st);
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
// A timestamp by device_class, or by shape: some integrations don't expose device_class,
// and parseFloat("2026-09-26T…") would otherwise read the year as a number.
const isTimestamp = (st) => !!st && (st.attributes.device_class === "timestamp" || st.attributes.device_class === "date"
  || ISO_TIMESTAMP.test(st.state || ""));

// "1 device", "3 devices"
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

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
  { key: "alarm", name: "Smoke / gas", domain: "binary_sensor", dc: ["smoke", "gas", "carbon_monoxide"], color: TONE.bad, critical: true },
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
  const skip = asItems(cfg.exclude).map((i) => i.entity);
  const ids = areaEntities(hass, area).filter((id) => !skip.includes(id));
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
const entryStore = { map: new Map(), next: 0, pending: false, listeners: new Set() };
function refreshConfigEntries(hass, force = false) {
  if (!hass?.callWS || entryStore.pending || (!force && Date.now() < entryStore.next)) return;
  entryStore.pending = true;
  Promise.resolve().then(() => hass.callWS({ type: "config_entries/get" })).then((list) => {
    const map = new Map();
    for (const e of Array.isArray(list) ? list : []) map.set(e.entry_id, { domain: e.domain, title: e.title, state: e.state, disabled: !!e.disabled_by });
    const changed = JSON.stringify([...map]) !== JSON.stringify([...entryStore.map]);
    entryStore.map = map;
    entryStore.next = Date.now() + 60000;
    if (changed) entryStore.listeners.forEach((fn) => fn());
  }).catch(() => { entryStore.next = Date.now() + 600000; }).finally(() => { entryStore.pending = false; });
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

// ===== core/41-dismiss.js =====
// ---------------------------------------------------------------------------------------
// core/dismiss: what one person has put aside on the health card. A dismissed offline issue,
// low battery or Watchman item leaves every count (the card's, its categories', the home
// cog's) and waits under "Dismissed". It is personal: kept in the user's Home Assistant profile
// (frontend/set_user_data, so it follows them to their other devices, no admin needed) and in
// localStorage when that is not available. The settings' `health.ignore` is the shared, permanent
// list; this one is for one person's "I know, leave me alone".
//
// An entry remembers the entities that were failing when it was set (`members`). An issue is
// dismissed while every one of its failing entities is a member, whatever the card groups them
// into, so a hub dismissed on one card is dismissed on a card that lists its devices too. A member
// that recovers is forgotten, and an issue that grows (a new entity goes down) is not covered any
// more: it comes back by itself.
// ---------------------------------------------------------------------------------------

const DISMISS_KEY = "savvy_dismissed";
const DISMISS_LS = "savvy-dismissed";
const DISMISS_KINDS = ["off", "bat", "wat"];
const dismissStore = { entries: new Map(), version: 0, listeners: new Set(), local: false, remote: null, loading: false };

// the cards hear about it a moment later, never from inside the summary that pruned
const dismissChanged = () => {
  dismissStore.version++;
  Promise.resolve().then(() => dismissStore.listeners.forEach((fn) => { try { fn(); } catch (err) { /* a card that went away */ } }));
};
const dismissList = () => [...dismissStore.entries.values()].map((e) => ({ id: e.id, kind: e.kind, name: e.name, members: e.members }));
const dismissLoad = (list) => {
  dismissStore.entries = new Map((Array.isArray(list) ? list : [])
    .filter((e) => e && typeof e.id === "string" && DISMISS_KINDS.includes(e.kind) && Array.isArray(e.members) && e.members.length)
    .map((e) => [e.id, { id: e.id, kind: e.kind, name: String(e.name || ""), members: e.members.map(String) }]));
};
const dismissSave = (hass) => {
  const list = dismissList();
  try { localStorage.setItem(DISMISS_LS, JSON.stringify(list)); } catch (err) { /* storage blocked: the profile copy still works */ }
  if (hass?.callWS && dismissStore.remote !== false) {
    Promise.resolve().then(() => hass.callWS({ type: "frontend/set_user_data", key: DISMISS_KEY, value: list })).catch(() => {});
  }
};

// Read what is kept: localStorage at once, the profile as soon as Home Assistant answers (once; a refusal is not asked again).
function ensureDismissed(hass) {
  const S = dismissStore;
  if (!S.local) {
    S.local = true;
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(DISMISS_LS) || "[]"); } catch (err) { saved = []; }
    if (Array.isArray(saved) && saved.length) { dismissLoad(saved); dismissChanged(); }
  }
  if (!hass?.callWS || S.loading || S.remote !== null) return;
  S.loading = true;
  Promise.resolve().then(() => hass.callWS({ type: "frontend/get_user_data", key: DISMISS_KEY })).then((res) => {
    S.remote = true;
    const value = res?.value;
    if (Array.isArray(value)) {
      dismissLoad(value);
      try { localStorage.setItem(DISMISS_LS, JSON.stringify(dismissList())); } catch (err) { /* ignore */ }
      dismissChanged();
    } else if (S.entries.size) dismissSave(hass);
  }).catch(() => { S.remote = false; }).finally(() => { S.loading = false; });
}

function dismissAdd(hass, entry) {
  dismissStore.entries.set(entry.id, { id: entry.id, kind: entry.kind, name: String(entry.name || ""), members: [...new Set(entry.members.map(String))] });
  dismissSave(hass);
  dismissChanged();
}

// bring back every entry of that kind that shares a member with these
function dismissRestore(hass, kind, members) {
  const want = new Set(members);
  let any = false;
  for (const [id, e] of dismissStore.entries) {
    if (e.kind === kind && e.members.some((m) => want.has(m))) { dismissStore.entries.delete(id); any = true; }
  }
  if (!any) return;
  dismissSave(hass);
  dismissChanged();
}

// drop the members that are fine again (`still(kind, member)` says whether one still needs attention)
function dismissPrune(hass, still) {
  let any = false;
  for (const [id, e] of dismissStore.entries) {
    const keep = e.members.filter((m) => still(e.kind, m) !== false);
    if (keep.length === e.members.length) continue;
    any = true;
    if (keep.length) e.members = keep; else dismissStore.entries.delete(id);
  }
  if (!any) return;
  dismissSave(hass);
  dismissChanged();
}

// the entities each kind covers right now
function dismissView() {
  const view = { off: new Set(), bat: new Set(), wat: new Set(), size: dismissStore.entries.size };
  for (const e of dismissStore.entries.values()) e.members.forEach((m) => view[e.kind].add(m));
  return view;
}

const resetDismissed = () => {
  Object.assign(dismissStore, { entries: new Map(), version: 0, local: false, remote: null, loading: false });
  try { localStorage.removeItem(DISMISS_LS); } catch (err) { /* ignore */ }
  dismissChanged();
};

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

// Any CSS colour (hex, rgb(), a name) as [r, g, b]; a colour the browser cannot read is amber.
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

// ===== core/55-icons.js =====
// ---------------------------------------------------------------------------------------
// core/icons: the icon of an entity, decided here, never by Home Assistant's own state-icon element.
// That element falls back to a bookmark whenever it can't resolve an icon (translations that
// load late, custom integrations, domains it doesn't know), so every Savvy card draws its
// entity icons itself, with a plain <ha-icon>:
//   1. the entity's own `icon` attribute      2. its registry icon
//   3. our table by domain, device class and state      4. a neutral question mark
// <savvy-state-icon> is the drop-in for it: set .hass and .stateObj and it draws the icon.
// ---------------------------------------------------------------------------------------

const NEUTRAL_ICON = "mdi:help-circle-outline";

const BINARY_ICONS = {
  battery: ["mdi:battery-alert", "mdi:battery"], battery_charging: ["mdi:battery-charging", "mdi:battery"],
  carbon_monoxide: ["mdi:smoke-detector-alert", "mdi:smoke-detector"], cold: ["mdi:snowflake", "mdi:thermometer"],
  connectivity: ["mdi:check-network-outline", "mdi:close-network-outline"], door: ["mdi:door-open", "mdi:door-closed"],
  garage_door: ["mdi:garage-open", "mdi:garage"], gas: ["mdi:alert-circle", "mdi:check-circle"],
  heat: ["mdi:fire", "mdi:thermometer"], light: ["mdi:brightness-7", "mdi:brightness-5"],
  lock: ["mdi:lock-open", "mdi:lock"], moisture: ["mdi:water-alert", "mdi:water-off"],
  motion: ["mdi:motion-sensor", "mdi:motion-sensor-off"], moving: ["mdi:arrow-right", "mdi:octagon"],
  occupancy: ["mdi:home", "mdi:home-outline"], opening: ["mdi:square-outline", "mdi:square"],
  plug: ["mdi:power-plug", "mdi:power-plug-off"], power: ["mdi:power-plug", "mdi:power-plug-off"],
  presence: ["mdi:home", "mdi:home-outline"], problem: ["mdi:alert-circle", "mdi:check-circle"],
  running: ["mdi:play", "mdi:stop"], safety: ["mdi:alert-circle", "mdi:check-circle"],
  smoke: ["mdi:smoke-detector-variant-alert", "mdi:smoke-detector-variant"], sound: ["mdi:music-note", "mdi:music-note-off"],
  tamper: ["mdi:alert-circle", "mdi:check-circle"], update: ["mdi:package-up", "mdi:package"],
  vibration: ["mdi:vibrate", "mdi:crop-portrait"], window: ["mdi:window-open", "mdi:window-closed"],
};

const SENSOR_ICONS = {
  apparent_power: "mdi:flash", aqi: "mdi:air-filter", atmospheric_pressure: "mdi:gauge", battery: "mdi:battery",
  carbon_dioxide: "mdi:molecule-co2", carbon_monoxide: "mdi:molecule-co", current: "mdi:current-ac", data_rate: "mdi:transmission-tower",
  data_size: "mdi:database", date: "mdi:calendar", distance: "mdi:ruler", duration: "mdi:timer-outline", energy: "mdi:lightning-bolt",
  enum: "mdi:format-list-bulleted", frequency: "mdi:sine-wave", gas: "mdi:gas-burner", humidity: "mdi:water-percent",
  illuminance: "mdi:brightness-5", irradiance: "mdi:sun-wireless", moisture: "mdi:water-percent", monetary: "mdi:cash",
  nitrogen_dioxide: "mdi:molecule", ozone: "mdi:molecule", ph: "mdi:ph", pm1: "mdi:air-filter", pm10: "mdi:air-filter",
  pm25: "mdi:air-filter", power: "mdi:flash", power_factor: "mdi:angle-acute", precipitation: "mdi:weather-rainy",
  precipitation_intensity: "mdi:weather-pouring", pressure: "mdi:gauge", reactive_power: "mdi:flash", signal_strength: "mdi:wifi",
  sound_pressure: "mdi:ear-hearing", speed: "mdi:speedometer", sulphur_dioxide: "mdi:molecule", temperature: "mdi:thermometer",
  timestamp: "mdi:clock-outline", volatile_organic_compounds: "mdi:molecule", voltage: "mdi:sine-wave", volume: "mdi:car-coolant-level",
  water: "mdi:water", weight: "mdi:weight", wind_speed: "mdi:weather-windy",
};

const WEATHER_ICONS = {
  "clear-night": "mdi:weather-night", cloudy: "mdi:weather-cloudy", exceptional: "mdi:alert-circle-outline", fog: "mdi:weather-fog",
  hail: "mdi:weather-hail", lightning: "mdi:weather-lightning", "lightning-rainy": "mdi:weather-lightning-rainy",
  partlycloudy: "mdi:weather-partly-cloudy", pouring: "mdi:weather-pouring", rainy: "mdi:weather-rainy", snowy: "mdi:weather-snowy",
  "snowy-rainy": "mdi:weather-snowy-rainy", sunny: "mdi:weather-sunny", windy: "mdi:weather-windy", "windy-variant": "mdi:weather-windy-variant",
};

// a battery level, in the ten steps MDI has
const batteryLevelIcon = (v) => {
  if (!Number.isFinite(v)) return "mdi:battery";
  if (v >= 95) return "mdi:battery";
  if (v < 5) return "mdi:battery-outline";
  return `mdi:battery-${Math.min(90, Math.max(10, Math.round(v / 10) * 10))}`;
};

// the table: what an entity looks like when nothing more specific names its icon
function fallbackIcon(domain, dc, state, st) {
  const on = state === "on", off = state === "off" || state === "unavailable";
  const open = state === "open" || state === "opening" || state === "closing";
  switch (domain) {
    case "binary_sensor": { const pair = BINARY_ICONS[dc]; return pair ? pair[on ? 0 : 1] : on ? "mdi:checkbox-marked-circle" : "mdi:radiobox-blank"; }
    case "sensor": return dc === "battery" ? batteryLevelIcon(parseFloat(state)) : SENSOR_ICONS[dc] || "mdi:eye";
    case "light": return st?.attributes?.entity_id ? (on ? "mdi:lightbulb-group" : "mdi:lightbulb-group-outline") : on ? "mdi:lightbulb" : "mdi:lightbulb-outline";
    case "switch": return dc === "outlet" ? (on ? "mdi:power-plug" : "mdi:power-plug-off") : on ? "mdi:toggle-switch-variant" : "mdi:toggle-switch-variant-off";
    case "input_boolean": return on ? "mdi:toggle-switch-variant" : "mdi:toggle-switch-variant-off";
    case "fan": return off ? "mdi:fan-off" : "mdi:fan";
    case "lock":
      if (state === "locked") return "mdi:lock";
      if (state === "jammed") return "mdi:lock-alert";
      if (state === "locking" || state === "unlocking") return "mdi:lock-clock";
      if (state === "open" || state === "opening") return "mdi:door-open";
      return "mdi:lock-open-variant";
    case "cover": {
      const o = open && state !== "closing";
      if (dc === "garage") return o ? "mdi:garage-open" : "mdi:garage";
      if (dc === "door") return o ? "mdi:door-open" : "mdi:door-closed";
      if (dc === "gate") return o ? "mdi:gate-open" : "mdi:gate";
      if (dc === "window") return o ? "mdi:window-open" : "mdi:window-closed";
      if (dc === "curtain") return o ? "mdi:curtains" : "mdi:curtains-closed";
      if (["blind", "shade", "awning"].includes(dc)) return o ? "mdi:blinds-open" : "mdi:blinds";
      if (dc === "damper") return o ? "mdi:circle" : "mdi:circle-slice-8";
      return o ? "mdi:window-shutter-open" : "mdi:window-shutter";
    }
    case "media_player":
      if (dc === "tv") return off ? "mdi:television-off" : "mdi:television";
      if (dc === "speaker") return off ? "mdi:speaker-off" : "mdi:speaker";
      if (dc === "receiver") return off ? "mdi:audio-video-off" : "mdi:audio-video";
      return off ? "mdi:cast-off" : state === "playing" || state === "paused" ? "mdi:cast-connected" : "mdi:cast";
    case "climate":
      return { heat: "mdi:fire", cool: "mdi:snowflake", fan_only: "mdi:fan", dry: "mdi:water-percent", heat_cool: "mdi:sun-snowflake-variant", auto: "mdi:thermostat-auto" }[state] || "mdi:thermostat";
    case "vacuum": return state === "error" ? "mdi:robot-vacuum-alert" : "mdi:robot-vacuum";
    case "lawn_mower": return "mdi:robot-mower";
    case "alarm_control_panel":
      return { disarmed: "mdi:shield-off", armed_home: "mdi:shield-home", armed_away: "mdi:shield-lock", armed_night: "mdi:shield-moon",
        armed_vacation: "mdi:shield-airplane", armed_custom_bypass: "mdi:security", triggered: "mdi:bell-ring", arming: "mdi:shield-sync", pending: "mdi:shield-sync", disarming: "mdi:shield-sync" }[state] || "mdi:shield";
    case "button": case "input_button": return "mdi:gesture-tap-button";
    case "script": return "mdi:script-text-outline";
    case "scene": return "mdi:palette";
    case "automation": return on ? "mdi:robot" : "mdi:robot-off";
    case "person": return state === "home" ? "mdi:account" : "mdi:account-arrow-right";
    case "device_tracker": return state === "home" ? "mdi:account" : "mdi:account-arrow-right";
    case "camera": return "mdi:video";
    case "humidifier": return off ? "mdi:air-humidifier-off" : "mdi:air-humidifier";
    case "water_heater": return off ? "mdi:water-boiler-off" : "mdi:water-boiler";
    case "valve": return state === "closed" || state === "closing" ? "mdi:valve-closed" : "mdi:valve-open";
    case "siren": return on ? "mdi:bullhorn" : "mdi:bullhorn-outline";
    case "remote": return "mdi:remote";
    case "update": return on ? "mdi:package-up" : "mdi:package";
    case "number": case "input_number": return "mdi:ray-vertex";
    case "select": case "input_select": return "mdi:format-list-bulleted";
    case "text": case "input_text": return "mdi:form-textbox";
    case "datetime": case "input_datetime": return dc === "date" ? "mdi:calendar" : "mdi:calendar-clock";
    case "date": case "calendar": case "schedule": return "mdi:calendar";
    case "time": return "mdi:clock-outline";
    case "timer": return "mdi:timer-outline";
    case "counter": return "mdi:counter";
    case "event": return "mdi:gesture-double-tap";
    case "image": return "mdi:image";
    case "todo": return "mdi:clipboard-list";
    case "weather": return WEATHER_ICONS[state] || "mdi:weather-partly-cloudy";
    case "sun": return state === "below_horizon" ? "mdi:weather-night" : "mdi:white-balance-sunny";
    case "zone": return "mdi:map-marker-radius";
    case "geo_location": return "mdi:map-marker";
    case "proximity": return "mdi:map-marker-distance";
    case "group": return "mdi:google-circles-communities";
    case "air_quality": return "mdi:air-filter";
    case "tts": return "mdi:account-voice";
    case "stt": return "mdi:microphone-message";
    case "conversation": return "mdi:forum-outline";
    case "assist_satellite": return "mdi:comment-processing";
    case "wake_word": return "mdi:chat-sleep";
    case "notify": return "mdi:message-text";
    case "persistent_notification": return "mdi:bell";
    case "alert": return "mdi:alert";
    case "plant": return "mdi:flower";
    default: return NEUTRAL_ICON;
  }
}

// The icon for an entity, by id and state.
function entityIcon(hass, id, st) {
  st = st || hass?.states?.[id];
  const own = st?.attributes?.icon;
  if (own) return own;
  const reg = hass?.entities?.[id]?.icon;
  if (reg) return reg;
  return fallbackIcon(domainOf(id), st?.attributes?.device_class, st?.state, st);
}

// Set .hass and .stateObj, and it draws a plain <ha-icon> for the entity.
class SavvyStateIcon extends HTMLElement {
  set hass(h) { this._h = h; this._paint(); }
  set stateObj(st) { this._st = st; this._paint(); }
  get stateObj() { return this._st; }
  _paint() {
    const st = this._st;
    if (!st) return;
    if (!this._ic) { this._ic = document.createElement("ha-icon"); this.appendChild(this._ic); }
    const icon = entityIcon(this._h, st.entity_id, st);
    if (this._ic.getAttribute("icon") !== icon) {
      const had = this._ic.hasAttribute("icon");
      this._ic.setAttribute("icon", icon);
      if (had && Motion.can(this._ic)) Motion.pop(this._ic);     // an icon that swaps pops
    }
  }
}
if (!customElements.get("savvy-state-icon")) customElements.define("savvy-state-icon", SavvyStateIcon);

// ===== core/56-motion.js =====
// ---------------------------------------------------------------------------------------
// core/motion: the rule is that anything that changes state in front of you moves there
// with a spring, and every one of those moves can be interrupted. Four pieces, built once:
//
//   Tint     a colour that changes (on / off, idle / alert) slides from the old one to the
//            new one. Hooked into attr(): when a state attribute flips, every colour under
//            that element is measured before and after, and the difference is animated.
//   Roll     text that changes slides and fades; a count ticks through its numbers. Hooked
//            into text(). The real text is always final at once (so reading it never sees
//            a half-way value); the motion is drawn by the element's pseudo-elements.
//   Appear   Motion.flip(box, fn): rows, badges, chips and tiles that come, go or move
//            inside a container slide to their places; the ones that leave fade out where
//            they were.
//   Cascade  changes that land together ripple with a small stagger instead of all at once.
//
// Nothing here animates a card's first paint, an element's first value, a hidden card or
// anything while reduced motion is on; the shared clock sleeps when nothing is moving.
// ---------------------------------------------------------------------------------------

// state attributes whose flip changes colours (layout flags such as data-open stay out)
const TINT_ATTRS = new Set(["data-on", "data-off", "data-sel", "data-level", "data-live", "data-alert", "data-warn",
  "data-critical", "data-armed", "data-playing", "data-running", "data-unavailable", "data-missing", "data-triggered",
  "data-active", "data-lit", "data-dim", "data-bad", "data-kind", "data-mode", "data-c", "data-k", "data-soft", "data-solo",
  "data-pick", "data-busy", "data-flash", "data-filled", "data-nostate"]);
const TINT_PROPS = ["color", "background-color", "border-top-color", "fill", "stroke"];
const COLOR_FN = /^(rgb|rgba|color|oklab|oklch|lab|lch|hsl|hwb)\(/i;
const STAGGER_GAP = 0.04;      // s between neighbours of a cascade
const STAGGER_CAP = 0.35;      // s: no cascade runs longer than this
const ROLL_MIN_GAP = 250;      // ms: a value that changes every frame (a drag) never rolls
const NUM_RE = /-?\d+(?:\.\d+)?/;
const FLIP_MAX = 120;         // children: a longer list just updates (measuring it every update costs more than it gives)

MOTION.blend = { response: 0.3, damping: 1 };
MOTION.roll = { response: 0.4, damping: 1 };
MOTION.flip = { response: 0.5, damping: 0.88 };
MOTION.leave = { response: 0.32, damping: 1 };

class MotionAnim {
  constructor(from, to, motion, delay, paint, end) {
    this.s = new Spring(from, motion, "motion", 2e-3).to(to);
    this.delay = delay || 0;
    this.paint = paint;
    this.end = end;
    this.dead = false;
    paint(from);
  }
}

function motionJob(now, dt) {
  for (const a of Motion.anims) {
    if (a.dead) { Motion.anims.delete(a); continue; }
    let step = dt;
    if (a.delay > 0) {
      a.delay -= dt;
      if (a.delay > 0) continue;
      step = -a.delay;
      a.delay = 0;
    }
    a.s.step(step);
    if (a.s.idle) {
      a.s.snap();
      a.paint(a.s.x);
      Motion.anims.delete(a);
      a.end?.();
    } else a.paint(a.s.x);
  }
  return Motion.anims.size > 0;
}

const Motion = {
  anims: new Set(),
  stag: 0,
  stagQueued: false,

  start(anim) {
    this.anims.add(anim);
    Clock.add(motionJob);
    return anim;
  },
  // true while anything is still moving (tests wait on it)
  busy() { return this.anims.size > 0; },

  // A card is ready to animate two frames after its first write: what lands while it is being
  // built is its first paint, not a change.
  seen(el) {
    const root = el.getRootNode();
    if (root.__mReady === undefined) {
      root.__mReady = false;
      requestAnimationFrame(() => requestAnimationFrame(() => { root.__mReady = true; }));
    }
    return root;
  },

  // may this element animate at all? Not before its card has settled, not hidden, not reduced.
  can(el) {
    if (!el || MQ.reduced.matches || !el.isConnected || document.hidden) return false;
    return this.seen(el).__mReady === true;
  },

  // the n-th change in the same tick starts n gaps later, up to the cap
  stagger() {
    const i = this.stag++;
    if (!this.stagQueued) {
      this.stagQueued = true;
      queueMicrotask(() => { this.stag = 0; this.stagQueued = false; });
    }
    return Math.min(i * STAGGER_GAP, STAGGER_CAP);
  },

  // ---------- Tint ----------
  // Runs `apply` (a state attribute write) and animates every colour it changed beneath el.
  change(el, apply) {
    const els = tintScan(el), before = tintRead(els);
    apply();
    tintDiff(els, before);
  },

  // ---------- Glow ----------
  // The card's state colour in its corner (ha-card::before reads --glow-rgb and --glow). Pass the
  // colour and a level 0..1, or no colour for nothing. Colour and strength move together; a glow
  // coming from nothing takes its colour at once and only grows. Interruptible: a new target
  // starts from what is on screen.
  glow(el, rgb, level = 1) {
    if (!el) return;
    const g = el.__gl || (el.__gl = { c: (rgb || [128, 128, 128]).slice(), a: 0, to: null, anim: null });
    const to = { c: rgb ? rgb.map(Number) : g.to ? g.to.c : g.c, a: rgb ? clamp(level) : 0 };
    if (g.to && g.to.a === to.a && g.to.c.every((v, i) => v === to.c[i])) return;
    g.to = to;
    const from = { c: g.c.slice(), a: g.a };
    if (g.anim) g.anim.dead = true;
    const paint = (x) => {
      g.a = from.a + (to.a - from.a) * x;
      g.c = from.a < 0.02 ? to.c.slice() : from.c.map((v, i) => v + (to.c[i] - v) * x);
      el.style.setProperty("--glow", g.a.toFixed(3));
      el.style.setProperty("--glow-rgb", g.c.map(Math.round).join(" "));
    };
    if (!this.can(el)) { g.anim = null; paint(1); return; }
    g.anim = this.start(new MotionAnim(0, 1, MOTION.blend, 0, paint, () => { g.anim = null; }));
  },

  // ---------- Roll ----------
  rollable(el) { return !el.hasAttribute("data-noroll"); },

  roll(el, old, val) {
    const now = performance.now();
    if (el.__mr) this.endRoll(el);
    const tooSoon = el.__mrT && now - el.__mrT < ROLL_MIN_GAP;
    el.__mrT = now;
    if (tooSoon || old === val || !el.getClientRects().length) return;
    const tick = tickParts(old, val);
    el.style.setProperty("--rl-c", getComputedStyle(el).color);
    el.setAttribute("data-rolling", tick ? "tick" : "slide");
    el.setAttribute("data-out", old);
    el.setAttribute("data-in", tick ? old : val);
    el.style.setProperty("--rl", "0");
    el.__mr = this.start(new MotionAnim(0, 1, tick ? MOTION.value : MOTION.roll, 0, (x) => {
      if (tick) el.setAttribute("data-in", tick.sa.replace("#", (tick.na + (tick.nb - tick.na) * clamp(x)).toFixed(tick.dec)));
      else el.style.setProperty("--rl", x.toFixed(3));
    }, () => this.endRoll(el)));
  },
  endRoll(el) {
    if (el.__mr) el.__mr.dead = true;
    el.__mr = null;
    el.removeAttribute("data-rolling");
    el.removeAttribute("data-out");
    el.removeAttribute("data-in");
    el.style.removeProperty("--rl");
    el.style.removeProperty("--rl-c");
  },

  // ---------- Appear ----------
  // Run `fn` (which adds, removes and reorders the children of `boxes`) and animate the
  // outcome: movers slide from where they were, newcomers grow in, leavers fade out in place.
  flip(boxes, fn) {
    const list = [].concat(boxes).filter(Boolean);
    if (!list.length || !this.can(list[0]) || list.reduce((n, b) => n + b.children.length, 0) > FLIP_MAX) return fn();
    const snap = list.map((box) => {
      const rects = new Map();
      for (const k of box.children) if (!k.__ghost) rects.set(k, k.getBoundingClientRect());
      return { box, rects, boxRect: box.getBoundingClientRect() };
    });
    if (!snap.some((s) => s.rects.size)) return fn();     // the first population is not an event
    fn();
    for (const { box, rects, boxRect } of snap) {
      const kids = [...box.children].filter((k) => !k.__ghost);
      for (const k of kids) { if (k.__mf) { k.__mf.dead = true; k.__mf = null; } put(k, "translate", ""); }
      const gone = [...rects.keys()].filter((k) => !kids.includes(k) && !k.isConnected);
      for (const k of kids) {
        const r0 = rects.get(k);
        if (!r0) { if (!k.__enter) this.enter(k); continue; }
        const r1 = k.getBoundingClientRect();
        const dx = r0.left - r1.left, dy = r0.top - r1.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
        k.__mf = this.start(new MotionAnim(1, 0, MOTION.flip, 0, (t) => put(k, "translate", t < 0.002 ? "" : `${(dx * t).toFixed(2)}px ${(dy * t).toFixed(2)}px`),
          () => { k.__mf = null; }));
      }
      if (gone.length) {
        if (getComputedStyle(box).position === "static") box.style.position = "relative";
        for (const k of gone) this.leave(box, k, rects.get(k), boxRect);
      }
    }
  },

  // a node that was just added grows and fades in
  enter(k, delay = this.stagger()) {
    if (k.__me) k.__me.dead = true;
    k.__me = this.start(new MotionAnim(0, 1, MOTION.flip, delay, (t) => {
      put(k, "filter", t > 0.995 ? "" : `opacity(${clamp(t).toFixed(3)})`);
      put(k, "scale", t > 0.995 ? "" : (0.9 + 0.1 * t).toFixed(4));
    }, () => { k.__me = null; }));
  },

  // a node that was just removed stays, absolutely placed where it was, and fades away
  leave(box, k, r0, boxRect) {
    if (!r0 || !r0.width || !r0.height) return;
    k.__ghost = true;
    k.style.cssText += `;position:absolute;margin:0;pointer-events:none;box-sizing:border-box;`
      + `left:${(r0.left - boxRect.left + box.scrollLeft - box.clientLeft).toFixed(1)}px;`
      + `top:${(r0.top - boxRect.top + box.scrollTop - box.clientTop).toFixed(1)}px;`
      + `width:${r0.width.toFixed(1)}px;height:${r0.height.toFixed(1)}px`;
    k.removeAttribute("hidden");
    box.appendChild(k);
    this.start(new MotionAnim(1, 0, MOTION.leave, 0, (t) => {
      put(k, "filter", `opacity(${clamp(t).toFixed(3)})`);
      put(k, "scale", (0.92 + 0.08 * t).toFixed(4));
    }, () => k.remove()));
  },

  // ---------- single values ----------
  // A colour held in a custom property (--tc, --lvl, --mode) slides to its new value.
  tintVar(el, prop, val) {
    const st = el.__tv || (el.__tv = {});
    const rec = st[prop];
    if (!rec) { st[prop] = { to: val, cur: val }; this.seen(el); put(el, prop, val); return; }
    if (rec.to === val) return;
    const from = rec.cur;
    rec.to = val;
    if (!val || !from || !this.can(el) || !el.getClientRects().length) { rec.cur = val; if (rec.anim) rec.anim.dead = true; put(el, prop, val); return; }
    if (rec.anim) rec.anim.dead = true;
    rec.anim = this.start(new MotionAnim(0, 1, MOTION.blend, this.stagger(), (t) => {
      rec.cur = t >= 0.998 ? val : `color-mix(in oklab, ${val} ${(t * 100).toFixed(1)}%, ${from})`;
      put(el, prop, rec.cur);
    }, () => { rec.anim = null; rec.cur = val; put(el, prop, val); }));
  },

  // A number held in a style property (a dimmed row's opacity) eases to its new value. Dimming
  // uses filter: opacity() so it never fights a press feedback that owns the opacity property.
  fadeTo(el, target) {
    const rec = el.__tf || (el.__tf = { to: undefined, x: target });
    if (rec.to === target) return;
    const first = rec.to === undefined;
    rec.to = target;
    if (first) this.seen(el);
    if (first || !this.can(el)) { rec.x = target; if (rec.anim) rec.anim.dead = true; put(el, "filter", target >= 1 ? "" : `opacity(${target})`); return; }
    const from = rec.x;
    if (rec.anim) rec.anim.dead = true;
    rec.anim = this.start(new MotionAnim(from, target, MOTION.ui, 0, (x) => {
      rec.x = x;
      put(el, "filter", x >= 0.999 ? "" : `opacity(${clamp(x).toFixed(3)})`);
    }, () => { rec.anim = null; }));
  },

  // A 0..1 position held in a custom property (a switch knob) rolls to its new value with a
  // springy settle. The first write is immediate.
  tweenVar(el, prop, target, motion = MOTION.pill) {
    const key = `__tw${prop}`;
    const rec = el[key] || (el[key] = { to: undefined, x: target });
    if (rec.to === target) return;
    const first = rec.to === undefined;
    rec.to = target;
    if (first) this.seen(el);
    if (first || !this.can(el)) { rec.x = target; if (rec.anim) rec.anim.dead = true; put(el, prop, String(target)); return; }
    if (rec.anim) rec.anim.dead = true;
    const sp = rec.anim ? rec.anim.s : null;
    rec.anim = this.start(new MotionAnim(rec.x, target, motion, 0, (x) => { rec.x = x; put(el, prop, x.toFixed(4)); }, () => { rec.anim = null; }));
    if (sp) rec.anim.s.v = sp.v;     // keep the velocity of the move it interrupted
  },

  // an icon that was swapped pops: a dip and a springy return
  pop(el) {
    if (el.__mp) el.__mp.dead = true;
    el.__mp = this.start(new MotionAnim(0, 1, MOTION.pop, 0, (t) => put(el, "scale", Math.abs(t - 1) < 0.002 ? "" : (0.62 + 0.38 * t).toFixed(4)), () => { el.__mp = null; }));
  },

  // A control that comes and goes pops in and fades out (it keeps its place while it leaves).
  show(el, on) {
    if (!el) return;
    if (!on) {
      if (el.hidden || el.__ms === false) return;
      if (!this.can(el) || !el.getClientRects().length) { el.hidden = true; return; }
      el.__ms = false;
      if (el.__msa) el.__msa.dead = true;
      el.__msa = this.start(new MotionAnim(1, 0, MOTION.leave, 0, (t) => {
        put(el, "filter", `opacity(${clamp(t).toFixed(3)})`);
        put(el, "scale", (0.88 + 0.12 * t).toFixed(4));
      }, () => { el.__msa = null; el.__ms = undefined; el.hidden = true; put(el, "filter", ""); put(el, "scale", ""); }));
      return;
    }
    if (el.__msa) { el.__msa.dead = true; el.__msa = null; el.__ms = undefined; put(el, "filter", ""); put(el, "scale", ""); }
    if (!el.hidden) return;
    el.hidden = false;
    if (this.can(el) && el.getClientRects().length) this.enter(el, 0);
  },

  // A block (a banner, a section) opens and closes in height; its neighbours slide with it.
  reveal(el, on) {
    if (!el) return;
    const open = !el.hidden && el.__mh !== false;
    if (on === open) return;
    if (el.__mha) el.__mha.dead = true;
    if (!this.can(el) || (!on && !el.getClientRects().length)) { el.__mh = undefined; el.hidden = !on; put(el, "height", ""); put(el, "overflow", ""); return; }
    let full;
    if (on) { el.hidden = false; el.__mh = undefined; full = el.scrollHeight; }
    else { full = el.getBoundingClientRect().height; el.__mh = false; }
    if (!full) { el.hidden = !on; el.__mh = undefined; return; }
    const from = on ? 0 : (el.__mhx ?? full);
    put(el, "overflow", "hidden");
    el.__mha = this.start(new MotionAnim(from / full, on ? 1 : 0, MOTION.flip, 0, (t) => {
      el.__mhx = t * full;
      put(el, "height", t >= 0.999 && on ? "" : `${Math.max(0, t * full).toFixed(1)}px`);
      put(el, "filter", t >= 0.999 && on ? "" : `opacity(${clamp(t).toFixed(3)})`);
    }, () => { el.__mha = null; el.__mhx = undefined; put(el, "overflow", ""); put(el, "height", ""); put(el, "filter", ""); if (!on) { el.hidden = true; el.__mh = undefined; } }));
  },
};

// ---------- Tint internals ----------
function tintScan(el) {
  const out = [el];
  if (el.childElementCount) {
    const d = el.querySelectorAll("*");
    if (d.length <= 80) for (const x of d) out.push(x);
  }
  return out;
}

function tintRead(els) {
  return els.map((e) => {
    const cs = getComputedStyle(e), v = {};
    for (const p of TINT_PROPS) v[p] = cs.getPropertyValue(p);
    return v;
  });
}

// Everything under one element moves together: every running override is dropped first and
// every target read before any animation starts (a child must not read its parent's half-way
// colour as its target), and the whole group shares one start, so a tile's background, its
// icon box and its icon never drift apart.
function tintDiff(els, before) {
  for (const e of els) {
    const mt = e.__mt;
    if (mt) for (const p in mt) { mt[p].dead = true; e.style.removeProperty(p); delete mt[p]; }   // read the CSS target, not our override
  }
  const after = els.map((e) => {
    const cs = getComputedStyle(e), v = {};
    for (const p of TINT_PROPS) v[p] = cs.getPropertyValue(p);
    return v;
  });
  let delay = null;
  els.forEach((e, i) => {
    for (const p of TINT_PROPS) {
      if (e.style.getPropertyValue(p)) continue;         // a card writes this one itself
      const a = before[i][p], b = after[i][p];
      if (a === b || !COLOR_FN.test(a) || !COLOR_FN.test(b)) continue;
      if (delay === null) delay = Motion.stagger();
      const anim = Motion.start(new MotionAnim(0, 1, MOTION.blend, delay, (t) => {
        e.style.setProperty(p, t >= 0.998 ? b : `color-mix(in oklab, ${b} ${(t * 100).toFixed(1)}%, ${a})`);
      }, () => { e.style.removeProperty(p); if (e.__mt?.[p] === anim) delete e.__mt[p]; }));
      (e.__mt || (e.__mt = {}))[p] = anim;
    }
  });
}

// "3 of 6 on" -> "2 of 6 on": the same words around a different number ticks
function tickParts(a, b) {
  const ma = NUM_RE.exec(a), mb = NUM_RE.exec(b);
  if (!ma || !mb) return null;
  const sa = a.replace(NUM_RE, "#");
  if (sa !== b.replace(NUM_RE, "#")) return null;
  const na = Number(ma[0]), nb = Number(mb[0]);
  if (na === nb || !Number.isFinite(na) || !Number.isFinite(nb)) return null;
  const dec = Math.max((ma[0].split(".")[1] || "").length, (mb[0].split(".")[1] || "").length);
  return { sa, na, nb, dec };
}

// the card's state glow, unless the card (or the Savvy settings) turned it off
const stateGlow = (config, el, rgb, level = 1) => Motion.glow(el, config && config.state_glow === false ? null : rgb, level);

// ===== core/57-aggregate.js =====
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

// The page a chip leads to: its navigation_path, else the page its tap or hold action navigates to.
function pageTarget(cfg = {}) {
  if (cfg.navigation_path) return cfg.navigation_path;
  for (const k of ["tap_action", "hold_action"]) {
    const a = asAction(cfg[k]);
    if (a?.action === "navigate" && a.navigation_path) return a.navigation_path;
  }
  return null;
}

// The popup's pinned page button for a chip config: popup_button: false hides it, popup_label
// words it ("Open lights"), and without a target page there's no button. `byDefault: false`
// would show it only when popup_button is true.
function pageButton(cfg = {}, noun = "", { byDefault = true } = {}) {
  const on = cfg.popup_button === undefined ? byDefault : cfg.popup_button !== false;
  const path = on ? pageTarget(cfg) : null;
  if (!path) return null;
  return { label: cfg.popup_label || `Open ${String(noun).toLowerCase()}`.trim(), onTap: () => navigate(path) };
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
    ${DESIGN_TOKENS}
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
  .sv-close { width: var(--c-s); height: var(--c-s); border-radius: 11px; display: grid; place-items: center;
    background: var(--well); --mdc-icon-size: 18px; flex: none; }
  .sv-body { overflow: auto; overscroll-behavior: contain; padding: 4px 16px 18px; display: flex; flex-direction: column;
    gap: 10px; container-type: inline-size; }

  /* the entity list: one row per entity, live */
  .sv-rows { display: flex; flex-direction: column; gap: 2px; }
  .sv-ic { flex: none; width: var(--b-m); height: var(--b-m); border-radius: 50%; display: grid; place-items: center;
    background: var(--well); color: var(--secondary-text-color); --mdc-icon-size: 20px; }
  .sv-row[data-on] .sv-ic { color: var(--row-c, rgb(var(--accent))); background: color-mix(in oklab, var(--row-c, rgb(var(--accent))) var(--mix-on), transparent); }
  .sv-row[data-alert] .sv-ic { color: rgb(var(--bad-rgb)); background: color-mix(in oklab, rgb(var(--bad-rgb)) var(--mix-alert), transparent); }
  .sv-row[data-alert] .sv-val { color: rgb(var(--bad-rgb)); }
  .sv-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .sv-name { font-size: 14px; line-height: 18px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sv-sub { font-size: 12px; line-height: 15px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sv-sub:empty { display: none; }
  .sv-val { flex: none; font-size: 13px; font-weight: 600; color: var(--secondary-text-color); }
  .sv-val:empty { display: none; }
  /* the switch: a 38 x 22 track and an 18 knob, 2 px of track all round, whatever the pixel ratio */
  .sv-tog { flex: none; display: block; position: relative; width: 38px; height: 22px; border-radius: 11px; background: var(--well); }
  .sv-tog-k { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; box-sizing: border-box;
    background: var(--card-background-color, #fff); box-shadow: 0 1px 3px rgb(0 0 0 / 0.25); translate: calc(var(--p, 0) * 16px) 0; }
  .sv-tog[data-on] { background: var(--row-c, rgb(var(--accent))); }
  .sv-empty { padding: 18px 8px; text-align: center; font-size: 13px; color: var(--secondary-text-color); }
  .sv-group { margin: 8px 6px 2px; font-size: 11.5px; line-height: 14px; font-weight: 650; letter-spacing: 0.04em;
    text-transform: uppercase; color: var(--secondary-text-color); }
  :host([kbd]) .sv-go:focus-visible { outline: 2px solid var(--go-c, rgb(var(--accent))); outline-offset: 2px; }
  .sv-scrim { touch-action: none; }
  /* the popup's pinned page button: below the list, always in reach */
  .sv-foot { flex: none; padding: 2px 16px 16px; }
  .sv-sheet[data-bottom] .sv-foot { padding-bottom: 12px; }
  .sv-go { display: flex; align-items: center; gap: 10px; width: 100%; box-sizing: border-box; height: var(--c-l); padding: 0 14px 0 16px;
    border: 0; margin: 0; border-radius: 13px; font: inherit; font-size: 14px; line-height: 18px; font-weight: 650; letter-spacing: -0.01em;
    text-align: start; cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent;
    color: var(--go-c, rgb(var(--accent))); background: color-mix(in oklab, var(--go-c, rgb(var(--accent))) 15%, transparent); }
  .sv-go span { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sv-go ha-icon { --mdc-icon-size: 20px; flex: none; display: flex; }
  @media (hover: hover) { .sv-go:hover { background: color-mix(in oklab, var(--go-c, rgb(var(--accent))) 22%, transparent); } }
  @media (prefers-contrast: more) { .sv-go { box-shadow: inset 0 0 0 1.5px currentColor; } }
  /* the home card's health list, inside a popup */
  .sv-sheet savvy-system-health-card { --ha-card-border-width: 0px; --ha-card-background: transparent; --ha-card-box-shadow: none; margin: -14px -14px 0; }
`;

// Popups live in one layer at the top of the page, not inside the card: dashboards wrap
// cards in containers (transforms, containment) that would clip a "full screen" layer to
// the card, so a tap or scroll outside the popup would reach the page instead of closing it.
let portalEl = null;
function portalRoot() {
  if (!portalEl || !portalEl.isConnected) {
    portalEl = document.createElement("div");
    portalEl.className = "savvy-portal";
    const root = portalEl.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = ROLL_CSS + SHEET_CSS + ROWS_CSS + PICKER_CSS;
    root.appendChild(style);
    watchKeyboard(portalEl);
    document.body.appendChild(portalEl);
  }
  return portalEl.shadowRoot;
}

// While a popup is open the page underneath stays put: a press on the backdrop closes it
// (and goes no further), a scroll on the backdrop closes it without scrolling, and a
// scroll inside the popup never carries on into the page.
function guardBackdrop(scrim, panel, close, bodySel = ".sv-body") {
  const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };
  scrim.addEventListener("pointerdown", (e) => { swallow(e); close(); });
  for (const t of ["click", "pointerup", "contextmenu"]) scrim.addEventListener(t, swallow);
  for (const t of ["wheel", "touchmove"]) scrim.addEventListener(t, (e) => { swallow(e); close(); }, { passive: false });
  const stuck = (e) => {
    const box = e.composedPath().find((n) => n.matches?.(bodySel));
    if (!box || box.scrollHeight <= box.clientHeight + 1) { e.preventDefault(); return; }
    // at an end, a wheel that would go further is kept in
    if (e.type === "wheel" && ((e.deltaY < 0 && box.scrollTop <= 0) || (e.deltaY > 0 && box.scrollTop + box.clientHeight >= box.scrollHeight - 1))) e.preventDefault();
  };
  panel.addEventListener("wheel", stuck, { passive: false });
  panel.addEventListener("touchmove", stuck, { passive: false });
}

class Sheet {
  // host: the card element (its shadow root holds the sheet). opts: { title, wide, onClose }
  constructor(host, { title: heading = "", wide = false, onClose } = {}) {
    this.host = host;
    this.onClose = onClose;
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
    guardBackdrop(this.scrim, this.el, () => this.close());
    this.el.querySelector(".sv-close").addEventListener("click", (e) => { e.stopPropagation(); this.close(); });
  }

  setTitle(t) { text(this.el.querySelector(".sv-title"), t); this.el.setAttribute("aria-label", t); }

  // A button pinned under the body: { label, onTap, icon?, color? }, or null for none. A tap
  // closes the popup first, then runs onTap (a page change, say).
  setFooter(spec) {
    this.foot?.remove();
    this.foot = null;
    this.footSpring = null;
    if (!spec) return;
    const foot = document.createElement("div");
    foot.className = "sv-foot";
    const go = document.createElement("button");
    go.className = "sv-go";
    go.innerHTML = '<ha-icon></ha-icon><span></span><ha-icon icon="mdi:chevron-right"></ha-icon>';
    attr(go.firstElementChild, "icon", spec.icon || "mdi:arrow-top-right");
    text(go.querySelector("span"), spec.label);
    if (spec.color) put(go, "--go-c", spec.color);
    this.footSpring = new Spring(0, MOTION.press, "foot");
    go.__spring = this.footSpring;
    bindPress(go, { spring: this.footSpring, wake: () => Clock.add(this.job), onTap: () => { this.close(); spec.onTap(); } });
    foot.appendChild(go);
    this.el.appendChild(foot);
    this.foot = foot;
  }

  open(returnTo) {
    this.returnTo = returnTo || this.host.shadowRoot?.activeElement || null;
    portalRoot().append(this.scrim, this.el);
    this.place = () => this.el.toggleAttribute("data-bottom", window.innerWidth < 600);
    this.place();
    this.onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(); } };
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("resize", this.place);
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
    // the backdrop stays until the popup has gone: the rest of that tap lands on it
    this.closing = true;
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
    let busy = !s.idle;
    const f = this.footSpring;
    if (f && !f.idle) {
      if (MQ.reduced.matches) f.snap(); else f.step(dt);
      const go = this.foot?.firstElementChild;
      if (go) {
        put(go, "transform", MQ.reduced.matches || Math.abs(f.x) < 1e-4 ? "" : `scale(${(1 - 0.03 * f.x).toFixed(4)})`);
        put(go, "opacity", Math.abs(f.x) > 1e-3 ? (1 - 0.1 * clamp(f.x)).toFixed(3) : "");
      }
      busy = true;
    }
    if (this.closing && v < 0.02) { this.remove(); return false; }     // gone: the backdrop goes too
    return busy;
  }
}

// The popup a group chip opens: the entities it counts, live. Each row is one line: the entity,
// its main control on the right (a switch, play / pause, a target stepper...) and, when it has
// more, a chevron that opens one extra line (core/rows.js says what each kind puts where). One
// extra line is open at a time. The row's name area opens more-info.
//   show(hass, ids, returnTo, { sort: "room" | "recent", order: [area ids], toggle: false, storeKey, pinned: [ids], bulk: "lights" | ... | "auto" })
// sort groups the rows under room headings, or lists them by latest change; the toggle at the
// top lets the user switch, and remembers the choice per storeKey. pinned ids stay first. bulk
// puts a button next to the toggle that acts on exactly the listed entities (All off, Pause all, Lock all).
class EntityListSheet {
  constructor(host, { title: heading, color } = {}) {
    this.host = host;
    this.color = color;
    this.sheet = new Sheet(host, { title: heading, onClose: () => { this.open = false; } });
    this.kit = new RowKit(() => Clock.add(this.ctlJob));
    this.ctlJob = (now, dt) => {
      if (!this.open) return false;
      let busy = this.kit.step(dt);
      for (const row of this.rows.__rows?.values() || []) if (row.__kit.step(dt)) busy = true;
      return busy;
    };
    // A/C rows show a fan that turns while the unit runs
    this.spinJob = (now, dt) => {
      if (!this.open) return false;
      let busy = false;
      for (const row of this.rows.__rows?.values() || []) {
        const sp = row.__spin;
        if (!sp) continue;
        if (!sp.idle) { if (MQ.reduced.matches) sp.snap(); else sp.step(dt); }
        if (sp.x > 1e-4) {
          row.__angle = (row.__angle + sp.x * 360 * dt) % 360;
          busy = true;
        }
        // a fan that winds down stops where it is, never jumps back
        put(row.__icon, "transform", row.__angle ? `rotate(${row.__angle.toFixed(1)}deg)` : "");
        if (!sp.idle) busy = true;
      }
      return busy;
    };
    this.rows = document.createElement("div");
    this.rows.className = "sv-rows";
    this.sheet.body.appendChild(this.rows);
    this.opts = {};
    this.sort = null;
    this.openId = null;
    this.curIds = [];
  }

  show(hass, ids, returnTo, opts = {}) {
    this.ids = ids;
    this.opts = opts || {};
    this.sort = null;
    this.openId = null;
    for (const row of this.rows.__rows?.values() || []) { row.__exp.snap(0); row.__chev && attr(row.__chev, "aria-expanded", "false"); attr(row, "data-open", false); }
    if (this.opts.sort) {
      this.sort = this.opts.sort;
      if (this.opts.toggle !== false && this.opts.storeKey) {
        try {
          const v = localStorage.getItem(`savvy-sort:${this.opts.storeKey}`);
          if (v === "room" || v === "recent") this.sort = v;
        } catch (err) { /* private window: the default it is */ }
      }
    }
    this.tools(!!this.opts.sort && this.opts.toggle !== false, !!this.opts.bulk);
    this.open = true;
    this.render(hass);
    this.sheet.open(returnTo);
  }

  // the top of the list: "Room | Recent", and the bulk action beside it
  tools(wantSort, wantBulk) {
    if (!wantSort && !wantBulk) { if (this.toolsEl) this.toolsEl.hidden = true; return; }
    if (!this.toolsEl) {
      this.toolsEl = document.createElement("div");
      this.toolsEl.className = "sv-tools";
      this.sheet.body.insertBefore(this.toolsEl, this.rows);
    }
    this.toolsEl.hidden = false;
    attr(this.toolsEl, "data-solo", !wantSort);
    if (wantSort && !this.seg) {
      this.seg = new Seg(this.kit, { label: "Sort by", items: [{ value: "room", label: "Room", icon: "mdi:floor-plan" }, { value: "recent", label: "Recent", icon: "mdi:clock-outline" }],
        onPick: (v) => this.setSort(v) });
      this.toolsEl.prepend(this.seg.el);
    }
    if (this.seg) { this.seg.el.hidden = !wantSort; if (wantSort) this.seg.setValue(this.sort, true); }
    if (wantBulk && !this.bulkBtn) {
      const b = this.bulkBtn = document.createElement("button");
      b.className = "sv-bulk";
      b.innerHTML = "<ha-icon></ha-icon><span></span>";
      this.kit.press(b, () => this.runBulk(), { depth: 0.06, haptic: "medium" });
      this.toolsEl.appendChild(b);
    }
    if (this.bulkBtn) this.bulkBtn.hidden = !wantBulk;
  }

  bulkKind() {
    const b = this.opts.bulk;
    if (!b) return null;
    return b === "auto" ? bulkKindOf(this.curIds) : BULK[b] ? b : null;
  }

  runBulk() {
    const kind = this.bulkKind();
    if (!kind) return;
    const targets = bulkTargets(kind, this.curIds, this.hass);
    if (!targets.length) return;
    this.hass.callService(BULK[kind].domain, BULK[kind].service, {}, { entity_id: targets });
  }

  syncBulk() {
    const b = this.bulkBtn;
    if (!b || b.hidden) return;
    const kind = this.bulkKind();
    b.hidden = !kind;
    if (!kind) return;
    const targets = bulkTargets(kind, this.curIds, this.hass);
    text(b.querySelector("span"), BULK[kind].label);
    attr(b.querySelector("ha-icon"), "icon", BULK[kind].icon);
    attr(b, "disabled", !targets.length);
    attr(b, "aria-label", `${BULK[kind].label}${targets.length ? `, ${targets.length}` : ""}`);
  }

  setSort(v) {
    if (v === this.sort) return;
    this.sort = v;
    this.seg?.setValue(v);
    if (this.opts.storeKey) { try { localStorage.setItem(`savvy-sort:${this.opts.storeKey}`, v); } catch (err) { /* not stored */ } }
    haptic("selection");
    this.render(this.hass);
  }

  // one extra line open at a time
  toggleRow(id) {
    this.openId = this.openId === id ? null : id;
    for (const [rid, row] of this.rows.__rows || []) this.syncOpen(rid, row);
    haptic("selection");
    Clock.add(this.ctlJob);
    const row = this.rows.__rows?.get(this.openId);
    if (row) setTimeout(() => row.scrollIntoView?.({ block: "nearest", behavior: MQ.reduced.matches ? "auto" : "smooth" }), 120);
  }

  syncOpen(id, row) {
    const open = this.openId === id && row.__hasExtra && !row.__fixed;
    row.__exp.to(open ? 1 : 0, MOTION.ui);
    attr(row.__chev, "aria-expanded", String(open));
    attr(row.__chev, "aria-label", open ? "Fewer controls" : "More controls");
    attr(row, "data-open", open);
  }

  // the extra line's height and the chevron, from the row's spring
  paintOpen(row) {
    if (row.__fixed) return false;
    const sp = row.__exp, p = clamp(sp.x);
    const show = row.__hasExtra && (sp.target === 1 || p > 0.001);
    if (row.__ctl.hidden === show) row.__ctl.hidden = !show;
    if (show) {
      const settled = sp.idle && sp.target === 1;
      put(row.__ctl, "height", settled ? "" : `${(p * row.__ctlIn.offsetHeight).toFixed(1)}px`);
      put(row.__ctl, "opacity", p.toFixed(3));
    }
    attr(row.__ctl, "inert", !(sp.target === 1));
    put(row.__chev, "transform", p > 0.001 ? `rotate(${(180 * p).toFixed(1)}deg)` : "");
    return !sp.idle;
  }

  makeRow(id) {
    const d = domainOf(id);
    const row = document.createElement("div");
    row.className = "sv-row";
    row.dataset.kind = d;
    row.dataset.id = id;
    const fan = d === "climate";
    row.innerHTML = `<div class="sv-line1">
        <div class="sv-main" role="button" tabindex="0">
          <span class="sv-ic">${fan ? '<ha-icon icon="mdi:fan"></ha-icon>' : "<savvy-state-icon></savvy-state-icon>"}</span>
          <span class="sv-txt"><span class="sv-name"></span><span class="sv-sub"></span></span>
        </div>
        <span class="sv-val"></span>
        <div class="sv-act"><button class="sv-tog" hidden><i class="sv-tog-k"></i></button></div>
        <button class="sv-chev" data-none aria-expanded="false" aria-label="More controls"><ha-icon icon="mdi:chevron-down"></ha-icon></button>
      </div>
      <div class="sv-ctl" hidden><div class="sv-ctl-in"></div></div>`;
    row.__main = row.querySelector(".sv-main");
    row.__ic = row.querySelector(".sv-ic");
    row.__icon = row.querySelector(".sv-ic > *");
    row.__act = row.querySelector(".sv-act");
    row.__ctl = row.querySelector(".sv-ctl");
    row.__ctlIn = row.querySelector(".sv-ctl-in");
    row.__chev = row.querySelector(".sv-chev");
    row.__tog = row.querySelector(".sv-tog");
    if (fan) { row.__spin = new Spring(0, MOTION.spin, "spin", 1e-4); row.__angle = 0; }
    row.__kit = new RowKit(() => Clock.add(this.ctlJob));
    row.__exp = row.__kit.spring(0, MOTION.ui, 0.002);
    row.__kit.paints.push(() => this.paintOpen(row));
    const kind = ROW_KINDS[d];
    if (kind) {
      row.__ctrl = kind.build({ id, kit: row.__kit, host: this.host, hass: () => this.hass, refresh: () => this.render(this.hass),
        row, line: row.querySelector(".sv-line1"), handle: row.querySelector(".sv-ic"), text: row.querySelector(".sv-txt") });
      row.__fixed = !!row.__ctrl.fixed;
      if (row.__ctrl.main) row.__act.appendChild(row.__ctrl.main);
      if (row.__ctrl.extra) row.__ctlIn.appendChild(row.__ctrl.extra);
    }
    bindPress(row.__main, { onTap: () => moreInfo(this.host, id), haptic: null });
    bindPress(row.__tog, { onTap: () => toggleEntity(this.hass, id) });
    row.__kit.press(row.__chev, () => this.toggleRow(id), { depth: 0.1, haptic: null });
    return row;
  }

  // cards call this from their hass setter while it's open, so rows stay live
  render(hass) {
    if (!this.open) return;
    Motion.flip(this.rows, () => this.renderNow(hass));
  }

  renderNow(hass) {
    this.hass = hass;
    const ids = (typeof this.ids === "function" ? this.ids(hass) : this.ids) || [];
    this.curIds = ids;
    this.syncBulk();
    const box = this.rows;
    box.__rows = box.__rows || new Map();
    box.__heads = box.__heads || new Map();
    const seen = new Set(), seenHeads = new Set();
    let at = 0;
    if (!ids.length) {
      if (!box.__empty) { box.__empty = document.createElement("div"); box.__empty.className = "sv-empty"; box.__empty.textContent = "Nothing right now."; }
      box.appendChild(box.__empty);
    } else box.__empty?.remove();
    for (const item of sortRows(hass, ids, { sort: this.sort, pinned: this.opts.pinned, order: this.opts.order })) {
      if (item.head) {
        let head = box.__heads.get(item.head.key);
        if (!head) { head = document.createElement("div"); head.className = "sv-group"; box.__heads.set(item.head.key, head); }
        text(head, item.head.label);
        seenHeads.add(item.head.key);
        place(box, head, at++);
        continue;
      }
      const id = item.id;
      seen.add(id);
      let row = box.__rows.get(id);
      if (!row) { row = this.makeRow(id); box.__rows.set(id, row); }
      const d = domainOf(id), st = hass.states[id];
      const on = isActive(st);
      if (this.color) put(row, "--row-c", colorOf(this.color));
      attr(row, "data-on", on);
      attr(row, "data-off", !st || isOff(st));
      attr(row.__main, "data-on", on);
      if (row.__spin) {
        row.__spin.to(climateRunning(st) && !MQ.reduced.matches ? fanRate(st) : 0);
        if (!row.__spin.idle || row.__spin.x > 1e-4) Clock.add(this.spinJob);
      } else if (st && row.__icon && row.__icon.stateObj !== st) { row.__icon.hass = hass; row.__icon.stateObj = st; }
      text(row.querySelector(".sv-name"), shortName(hass, id, null));
      const res = (st && row.__ctrl?.update(st, hass)) || {};
      attr(row, "data-alert", !!res.alert);
      this.art(row, res.art);
      const area = entityArea(hass, id);
      const t = Date.parse(st?.last_changed);
      const parts = [];
      if (res.sub) parts.push(res.sub);
      if ((this.sort === "recent" || res.timed) && Number.isFinite(t)) parts.push(since(t, false));
      if (this.sort !== "room" && area) parts.push(areaInfo(hass, area).name);
      text(row.querySelector(".sv-sub"), parts.join(" · "));
      // the extra line: always there for a lock's track, else behind the chevron
      row.__hasExtra = !!res.extra;
      if (row.__fixed) {
        row.__ctl.hidden = !res.extra;
        put(row.__ctl, "height", "");
        put(row.__ctl, "opacity", "");
        attr(row.__chev, "data-none", true);
      } else {
        if (this.openId === id && !res.extra) this.openId = null;
        attr(row.__chev, "data-none", !res.extra);
        this.syncOpen(id, row);
      }
      const switchable = TOGGLE_DOMAINS.has(d);
      row.__tog.hidden = !switchable || !st || isOff(st);
      attr(row.__tog, "data-on", on);
      Motion.tweenVar(row.__tog, "--p", on ? 1 : 0);
      attr(row.__tog, "aria-label", on ? "Turn off" : "Turn on");
      text(row.querySelector(".sv-val"), res.val || (switchable || ROW_KINDS[d] ? "" : stateText(hass, st)));
      place(box, row, at++);   // keeps DOM order equal to the order
    }
    for (const [id, row] of box.__rows) if (!seen.has(id)) { row.__kit.dispose(); row.remove(); box.__rows.delete(id); }
    for (const [key, head] of box.__heads) if (!seenHeads.has(key)) { head.remove(); box.__heads.delete(key); }
    Clock.add(this.ctlJob);
  }

  // what's playing replaces the icon in its tile
  art(row, url) {
    let img = row.__art;
    if (!url) { if (img) img.hidden = true; attr(row.__ic, "data-art", false); if (row.__icon) row.__icon.hidden = false; return; }
    if (!img) { img = row.__art = document.createElement("img"); img.className = "sv-art"; img.alt = ""; row.__ic.appendChild(img); }
    if (img.__src !== url) { img.__src = url; img.src = url; }
    img.hidden = false;
    attr(row.__ic, "data-art", true);
    row.__icon.hidden = true;
  }
}

// ===== core/71-controls.js =====
// ---------------------------------------------------------------------------------------
// core/controls: the small controls a popup row is built from (CARD-DESIGN.md 3): press
// buttons, a bar that only moves on a sideways drag, a segmented control, a - / + stepper
// and the lock slide. Each one owns its springs through a RowKit, which the popup's clock
// job steps and paints, so a row never needs its own animation loop.
// ---------------------------------------------------------------------------------------

const CTL_PREDICT_MS = 1500;   // an optimistic value waits this long for HA to agree
const CTL_WRITE_MS = 140;      // a drag sends at most this often; the release always lands
const LOCK_END = 0.96;         // where the finger's travel counts as the end of the track
const LOCK_HOLD_MS = 500;      // how long the end of the lock track must be held to open
const LOCK_COLORS = [[76, 175, 80], [232, 163, 61], [224, 102, 102]];   // locked, unlocked, open
const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

// The lock handle's stylesheet, shared by the popup rows and the lock card: the lock's own icon is the
// handle, its row the track.
const LOCK_SLIDE_CSS = `/* the lock slide: the icon is the handle, the row is the track */
  .sv-sl { position: relative; --lk: 76 175 80; --gh: 0; }
  .sv-sl-ov { position: absolute; inset: 0; border-radius: inherit; overflow: hidden; pointer-events: none; z-index: 0; }
  .sv-sl-ov::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: rgb(var(--lk) / 0.1); opacity: var(--gh);
    box-shadow: inset 0 0 0 1px rgb(var(--lk) / 0.32); }
  .sv-sl-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: rgb(var(--lk) / 0.24); opacity: var(--gh); }
  .sv-sl[data-rtl] .sv-sl-fill { left: auto; right: 0; }
  .sv-sl-g { position: absolute; top: 0; bottom: 0; display: flex; align-items: center; font-size: 12px; line-height: 16px; font-weight: 650; letter-spacing: -0.004em;
    color: rgb(var(--lk)); opacity: var(--gh); white-space: nowrap; }
  .sv-sl-hint { position: absolute; top: 0; bottom: 0; inset-inline-end: 12px; display: flex; align-items: center; color: rgb(var(--lk)); --mdc-icon-size: 18px;
    opacity: calc(0.5 * (1 - var(--gh))); pointer-events: none; }
  .sv-sl-hint[data-inline] { position: static; flex: none; margin-inline-start: auto; }
  .sv-sl-hint ha-icon { display: flex; }
  .sv-sl-fade { opacity: calc(1 - var(--gh) * 0.92); }
  .sv-sl[aria-disabled="true"] .sv-sl-hint { display: none; }
  .sv-sl-handle { position: relative; z-index: 3; touch-action: pan-y; cursor: grab; user-select: none; -webkit-user-select: none; will-change: transform; outline: none; --ring: 0; --breath: 0; --cov: 0; }
  .sv-sl[data-drag] .sv-sl-handle { cursor: grabbing; }
  .sv-sl-handle::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: rgb(var(--lk)); opacity: var(--cov);
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.3); pointer-events: none; }
  .sv-sl-handle::after { content: ""; position: absolute; inset: -4px; border-radius: inherit; border: 2px solid rgb(var(--lk)); opacity: calc(var(--breath) * 0.7);
    transform: scale(calc(1 + var(--breath) * 0.18)); pointer-events: none; }
  .sv-sl-handle > :not(.sv-sl-ring):not(.sv-sl-ic) { opacity: calc(1 - var(--cov)); }
  .sv-sl-ic { position: absolute; inset: 0; display: grid; place-items: center; color: #fff; opacity: var(--cov); pointer-events: none; }
  .sv-sl-ic ha-icon { position: absolute; display: flex; }
  .sv-sl-ring { position: absolute; inset: -4px; width: calc(100% + 8px); height: calc(100% + 8px); transform: rotate(-90deg); opacity: var(--ring); pointer-events: none; }
  .sv-sl-ring circle { fill: none; stroke: #fff; stroke-width: 3; stroke-linecap: round; stroke-dasharray: 125.7; stroke-dashoffset: 125.7; }
  .sv-sl[data-armed] .sv-sl-handle::before { box-shadow: 0 0 0 4px rgb(var(--lk) / 0.35), 0 2px 8px rgb(0 0 0 / 0.3); }
  .sv-sl[data-bad] { --lk: 224 102 102 !important; }
  @media (prefers-contrast: more) { .sv-sl-ov::before { box-shadow: inset 0 0 0 1.5px rgb(var(--lk)); } }`;

// The springs and press feedback of one row's controls.
class RowKit {
  constructor(wake) {
    this.wake = wake;
    this.springs = [];
    this.presses = [];
    this.paints = [];
  }
  spring(value, motion, eps) {
    const s = new Spring(value, motion, "k", eps);
    this.springs.push(s);
    return s;
  }
  // tap (and optionally hold) with the shared press feedback
  press(el, onTap, { onHold, depth = 0.08, haptic: tap = "light" } = {}) {
    const spring = this.spring(0, MOTION.press);
    el.__spring = spring;
    el.__depth = depth;
    this.presses.push(el);
    bindPress(el, { spring, wake: this.wake, onTap, onHold, haptic: tap });
    return spring;
  }
  // steps every spring and paints; true while something still moves
  step(dt) {
    const red = MQ.reduced.matches;
    let busy = false;
    for (const s of this.springs) {
      if (s.idle) continue;
      if (red) s.snap(); else s.step(dt);
      if (!s.idle) busy = true;
    }
    for (const el of this.presses) {
      const p = el.__spring.x;
      put(el, "transform", red || Math.abs(p) < 1e-4 ? "" : `scale(${(1 - el.__depth * p).toFixed(4)})`);
      put(el, "opacity", Math.abs(p) > 1e-3 ? (1 - (red ? 0.25 : 0.12) * clamp(p)).toFixed(3) : "");
    }
    for (const paint of this.paints) if (paint(dt)) busy = true;
    return busy;
  }
  // a row that goes away takes its timers with it
  dispose() { for (const fn of this.disposers || []) fn(); }
  onDispose(fn) { (this.disposers || (this.disposers = [])).push(fn); }
}

// A round icon button: transport, power, mute, the - and + of a stepper.
function iconButton(kit, { icon, label, onTap, solid = false, cls = "" }) {
  const btn = document.createElement("button");
  btn.className = `sv-btn ${cls}`.trim();
  if (solid) btn.dataset.solid = "";
  btn.innerHTML = "<ha-icon></ha-icon>";
  btn.__icon = btn.firstElementChild;
  attr(btn.__icon, "icon", icon);
  attr(btn, "aria-label", label);
  kit.press(btn, onTap, { depth: solid ? 0.06 : 0.1 });
  btn.setIcon = (name) => attr(btn.__icon, "icon", name);
  return btn;
}

// A bar that only moves once a drag is clearly sideways, so a press, or a finger on its way
// to scrolling the page, never changes anything; then the level follows the finger 1:1 from
// where it was (CARD-DESIGN.md 3.1). onChange(level 0..1, final).
class SideBar {
  constructor(kit, { label, onChange, step = 0.05 }) {
    this.kit = kit;
    this.onChange = onChange;
    this.step = step;
    const el = this.el = document.createElement("div");
    el.className = "sv-bar";
    el.setAttribute("role", "slider");
    el.tabIndex = 0;
    el.setAttribute("aria-label", label);
    el.setAttribute("aria-valuemin", "0");
    el.setAttribute("aria-valuemax", "100");
    el.innerHTML = '<span class="sv-bar-fill"></span>';
    this.fill = el.firstElementChild;
    this.value = kit.spring(0, MOTION.value, 0.002);
    this.grab = kit.spring(0, { response: 0.4, damping: 1 });
    this.level = 0;
    this.pending = null;
    this.pendingAt = 0;
    this.dragging = false;
    this.queued = null;
    this.timer = 0;
    this.last = 0;
    kit.paints.push(() => this.paint());
    kit.onDispose(() => { clearTimeout(this.timer); clearTimeout(this.expiry); });
    this.wire();
  }

  paint() {
    put(this.fill, "transform", `scaleX(${clamp(this.value.x).toFixed(4)})`);
    put(this.el, "--grab", clamp(this.grab.x).toFixed(3));
    return false;
  }

  // Home Assistant's level; a guess of our own holds until it agrees or expires
  setLevel(v, snap = false) {
    this.level = v;
    attr(this.el, "aria-valuenow", String(Math.round(v * 100)));
    if (this.dragging) return;
    if (this.pending != null && (Math.abs(this.pending - v) < 0.02 || Date.now() - this.pendingAt > CTL_PREDICT_MS)) this.pending = null;
    if (this.pending != null) return;
    if (snap) this.value.snap(v); else this.value.to(v);
    this.kit.wake();
  }

  guess(v) {
    this.pending = v;
    this.pendingAt = Date.now();
    clearTimeout(this.expiry);
    this.expiry = setTimeout(() => { this.pending = null; this.value.to(this.level); this.kit.wake(); }, CTL_PREDICT_MS + 50);
  }

  send(v, throttle) {
    this.queued = v;
    if (throttle) {
      if (this.timer) return;
      this.timer = setTimeout(() => { this.timer = 0; this.flush(); }, CTL_WRITE_MS);
      return;
    }
    clearTimeout(this.timer);
    this.timer = 0;
    this.flush();
  }
  flush() {
    if (this.queued == null) return;
    const v = this.queued;
    this.queued = null;
    this.onChange(v);
  }

  nudge(d) {
    const v = clamp((this.pending ?? this.value.target) + d * this.step);
    this.guess(v);
    this.value.to(v);
    haptic("selection");
    this.send(v, false);
    this.kit.wake();
  }

  wire() {
    const el = this.el;
    let id = null, x0 = 0, y0 = 0, xs = 0, from = 0, live = false;
    const at = (x) => clamp(from + (x - xs) / Math.max(1, el.getBoundingClientRect().width));
    el.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      e.stopPropagation();
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; live = false;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* already lifted */ }
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerId !== id) return;
      if (!e.buttons && e.pointerType === "mouse") { id = null; return; }
      if (!live) {
        const dx = e.clientX - x0, dy = e.clientY - y0;
        if (Math.hypot(dx, dy) < SLOP) return;
        if (Math.abs(dy) >= Math.abs(dx)) { id = null; return; }   // vertical: the page scrolls
        live = true;
        this.dragging = true;
        this.grab.to(1);
        xs = e.clientX;
        from = clamp(this.pending ?? this.value.x);
        this.last = Math.round(from * 10);
      }
      const v = at(e.clientX);
      this.value.snap(v);
      this.guess(v);
      const notch = Math.round(v * 10);
      if (notch !== this.last) { this.last = notch; haptic("selection"); }
      this.send(v, true);
      this.kit.wake();
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      if (!live) return;
      live = false;
      this.dragging = false;
      this.grab.to(0);
      this.send(this.value.x, false);
      this.kit.wake();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("click", (e) => e.stopPropagation());
    el.addEventListener("keydown", (e) => {
      const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      this.nudge(d);
    });
  }
}

// A segmented control: equal segments and a pill that slides between them on a spring.
// items: [{ value, label, icon }]; setValue(null) leaves none picked.
class Seg {
  constructor(kit, { items, label, onPick }) {
    this.kit = kit;
    this.items = items;
    this.onPick = onPick;
    const el = this.el = document.createElement("div");
    el.className = "sv-seg";
    el.setAttribute("role", "radiogroup");
    el.setAttribute("aria-label", label);
    el.style.setProperty("--n", String(items.length));
    el.innerHTML = '<span class="sv-seg-pill"></span>';
    this.pill = el.firstElementChild;
    this.buttons = items.map((it, i) => {
      const b = document.createElement("button");
      b.className = "sv-seg-b";
      b.setAttribute("role", "radio");
      b.dataset.v = String(it.value);
      b.innerHTML = `${it.icon ? "<ha-icon></ha-icon>" : ""}<span></span>`;
      if (it.icon) attr(b.querySelector("ha-icon"), "icon", it.icon);
      text(b.querySelector("span"), it.label);
      kit.press(b, () => this.onPick(it.value), { depth: 0.04 });
      el.appendChild(b);
      return b;
    });
    this.idx = kit.spring(0, MOTION.pill, 0.002);
    this.shown = kit.spring(0, MOTION.ui, 0.002);
    this.value = undefined;
    kit.paints.push(() => this.paint());
  }
  setValue(v, snap = false) {
    if (v === this.value && !snap) return;
    this.value = v;
    const i = this.items.findIndex((it) => it.value === v);
    this.buttons.forEach((b, k) => { attr(b, "aria-checked", String(k === i)); attr(b, "data-on", k === i); });
    this.shown.to(i < 0 ? 0 : 1);
    if (i >= 0) { if (snap || this.shown.x < 0.01) this.idx.snap(i); else this.idx.to(i); }
    if (snap) this.shown.snap();
    this.kit.wake();
  }
  paint() {
    put(this.pill, "--i", this.idx.x.toFixed(3));
    put(this.pill, "opacity", clamp(this.shown.x).toFixed(3));
    return false;
  }
}

// - value +: the target of a climate unit. Taps step it; the service call waits until the
// stepping stops, so three taps are one write.
class Stepper {
  constructor(kit, { label, onChange, compact = false }) {
    this.kit = kit;
    this.onChange = onChange;
    const el = this.el = document.createElement("div");
    el.className = "sv-step";
    if (compact) el.dataset.compact = "";
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", label);
    this.down = iconButton(kit, { icon: "mdi:minus", label: `${label} down`, onTap: () => this.bump(-1) });
    this.up = iconButton(kit, { icon: "mdi:plus", label: `${label} up`, onTap: () => this.bump(1) });
    this.val = document.createElement("span");
    this.val.className = "sv-step-v";
    el.append(this.down, this.val, this.up);
    this.cfg = { value: 0, min: 0, max: 100, step: 1, unit: "" };
    this.pending = null;
    this.timer = 0;
    kit.onDispose(() => clearTimeout(this.timer));
  }
  fmt(v) { return `${v.toFixed(this.cfg.step < 1 ? 1 : 0)}${this.cfg.unit}`; }
  set(cfg) {
    this.cfg = cfg;
    if (this.pending != null && (Math.abs(this.pending - cfg.value) < 1e-6 || Date.now() - this.pendingAt > CTL_PREDICT_MS + 600)) this.pending = null;
    const shown = this.pending ?? cfg.value;
    text(this.val, this.fmt(shown));
    attr(this.down, "disabled", shown <= cfg.min + 1e-9);
    attr(this.up, "disabled", shown >= cfg.max - 1e-9);
  }
  bump(d) {
    const { value, min, max, step } = this.cfg;
    const v = clamp((this.pending ?? value) + d * step, min, max);
    this.pending = Math.round(v / step) * step;
    this.pendingAt = Date.now();
    this.set(this.cfg);
    haptic("selection");
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = 0; this.onChange(this.pending); }, 450);
  }
}

// Lock, unlock, open, with the lock's own icon as the handle. It rests at the start of its row; drag it
// across and the row becomes the track. Past the first stop it does the opposite of what the lock is
// now (unlock when locked, lock when not); a lock that can open has a second stop at the end that has
// to be held until a ring fills, then released, before the latch opens. A tap on the handle only
// nudges it, to show that it slides. The handle always comes back to the start; the icon and the
// colour say what the lock is.
class LockSlide {
  constructor(kit, { host, handle, label, canOpen, onLock, onUnlock, onOpen, hintHost = null, fade = [] }) {
    this.kit = kit;
    this.host = host;
    this.handle = handle;
    this.canOpen = canOpen;
    this.onLock = onLock;
    this.onUnlock = onUnlock;
    this.onOpen = onOpen;
    this.onWords = null;                        // the row calls this to say its subtitle changed
    this.u = 0.5;                               // where the first stop sits when there are two
    host.classList.add("sv-sl");
    host.dataset.stops = canOpen ? "3" : "2";
    handle.classList.add("sv-sl-handle");
    handle.setAttribute("role", "slider");
    handle.tabIndex = 0;
    handle.setAttribute("aria-label", label);
    handle.setAttribute("aria-valuemin", "0");
    handle.setAttribute("aria-valuemax", canOpen ? "2" : "1");
    host.insertAdjacentHTML("afterbegin", `<span class="sv-sl-ov" aria-hidden="true"><span class="sv-sl-fill"></span><span class="sv-sl-g g1"></span><span class="sv-sl-g g2"></span></span>`);
    this.fill = host.querySelector(".sv-sl-fill");
    this.g1 = host.querySelector(".sv-sl-g.g1");
    this.g2 = host.querySelector(".sv-sl-g.g2");
    const hint = document.createElement("span");
    hint.className = "sv-sl-hint";
    hint.setAttribute("aria-hidden", "true");
    hint.innerHTML = '<ha-icon icon="mdi:chevron-double-right"></ha-icon>';
    if (hintHost) { hint.dataset.inline = ""; hintHost.appendChild(hint); } else host.appendChild(hint);
    for (const f of fade) f.classList.add("sv-sl-fade");
    handle.insertAdjacentHTML("beforeend", `<svg class="sv-sl-ring" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="20"></circle></svg>
      <span class="sv-sl-ic"><ha-icon class="i0"></ha-icon><ha-icon class="i1"></ha-icon><ha-icon class="i2"></ha-icon></span>`);
    this.ring = handle.querySelector(".sv-sl-ring circle");
    this.icons = [handle.querySelector(".i0"), handle.querySelector(".i1"), handle.querySelector(".i2")];
    attr(this.icons[0], "icon", "mdi:lock");
    attr(this.icons[1], "icon", "mdi:lock-open-variant");
    attr(this.icons[2], "icon", "mdi:door-open");
    this.x = kit.spring(0, { response: 0.3, damping: 0.74 }, 0.001);   // the handle's place, as a share of the travel
    this.cv = kit.spring(0, MOTION.ui, 0.002);                           // how far the handle has become a knob
    this.gh = kit.spring(0, MOTION.ui, 0.002);                           // how visible the track is
    this.pulse = 0;
    this.W = 0; this.T = 1; this.H = 0; this.L = 0; this.tx = 0; this.dir = 1;
    this.state = "unknown";
    this.pend = null;                           // { stop, at }: what we asked for
    this.rest = 0;                              // 0 locked, 1 unlocked, 2 open (what the lock is, or is about to be)
    this.drag = null;
    this.holdFrom = 0;
    this.armed = false;
    this.timers = [];
    this.later = [];
    kit.paints.push((dt) => this.paint(dt));
    kit.onDispose(() => { this.clearTimers(); for (const t of this.later) clearTimeout(t); });
    if (typeof ResizeObserver === "function") {
      this.ro = new ResizeObserver(() => { this.measure(); kit.wake(); });
      this.ro.observe(host);
      kit.onDispose(() => this.ro.disconnect());
    }
    this.wire();
  }

  get el() { return this.handle; }
  get openZone() { return this.canOpen && this.rest !== 2; }
  get target() { return this.rest === 0 ? 1 : 0; }
  clearTimers() { for (const t of this.timers) clearTimeout(t); this.timers = []; }

  // the track is the host's width less the handle and the room round it
  measure() {
    const r = this.host.getBoundingClientRect(), hr = this.handle.getBoundingClientRect();
    if (!r.width || !hr.width) return;
    this.dir = getComputedStyle(this.host).direction === "rtl" ? -1 : 1;
    this.host.toggleAttribute("data-rtl", this.dir === -1);
    this.W = r.width;
    this.H = hr.width;
    this.L = this.dir === 1 ? hr.left - r.left - this.tx : r.right - hr.right + this.tx;
    this.T = Math.max(1, this.W - this.H - 2 * this.L);
  }
  // the knob sits where the finger is, but past the first stop it lags and then arrives: heavy. The
  // end is the finger's last 4%: a drag only counts from where it became clearly sideways.
  mapFinger(f) {
    if (!this.openZone || f <= this.u) return f;
    const t = clamp((f - this.u) / (LOCK_END - this.u));
    return this.u + (1 - this.u) * Math.pow(t, 1.8);
  }

  get disabled() { return this.state === "unavailable" || this.state === "unknown"; }
  get transitional() { return ["locking", "unlocking", "opening"].includes(this.state) || !!this.pend; }

  // HA's state each render; an optimistic stop holds until HA agrees or it expires
  setState(state, snap = false) {
    this.state = state;
    const truth = state === "locked" || state === "locking" ? 0 : state === "open" || state === "opening" ? 2 : 1;
    const now = Date.now();
    if (this.pend && (this.pend.stop === truth || (now - this.pend.at > (this.pend.ttl ?? CTL_PREDICT_MS) && !["locking", "unlocking", "opening"].includes(state)))) this.pend = null;
    let stop = this.pend ? this.pend.stop : truth;
    if (!this.canOpen && stop === 2) stop = 1;
    this.rest = stop;
    attr(this.handle, "aria-valuenow", String(stop));
    attr(this.handle, "aria-valuetext", ["Locked", "Unlocked", "Open"][stop]);
    attr(this.host, "data-bad", state === "jammed");
    attr(this.host, "aria-disabled", this.disabled ? "true" : null);
    attr(this.host, "data-busy", this.transitional);
    if (!this.drag) { if (snap) this.x.snap(0); else this.x.to(0); }
    this.cv.to(this.drag || this.pend || this.armed ? 1 : 0);
    text(this.g1, this.openZone ? (this.target === 1 ? "Unlock" : "Lock") : "");
    text(this.g2, this.openZone ? "Open" : this.target === 1 ? "Unlock" : "Lock");
    this.kit.wake();
  }

  // what the row says under the name
  get words() {
    if (this.pend) return this.pend.stop === 0 ? "Locking…" : this.pend.stop === 1 ? "Unlocking…" : "Opening…";
    return { locked: "Locked", unlocked: "Unlocked", locking: "Locking…", unlocking: "Unlocking…", opening: "Opening…", open: "Open", jammed: "Jammed" }[this.state] || title(this.state);
  }

  // the track's colour where the handle sits: from what the lock is, to what the slide would make it, to red
  colorAt(x) {
    const u = this.u, cur = this.rest, tgt = this.target;
    if (this.openZone) return x <= u ? mixRgb(LOCK_COLORS[cur], LOCK_COLORS[tgt], u ? x / u : 1) : mixRgb(LOCK_COLORS[tgt], LOCK_COLORS[2], clamp((x - u) / (1 - u)));
    return mixRgb(LOCK_COLORS[cur], LOCK_COLORS[tgt], clamp(x));
  }

  paint(dt) {
    if (!this.W) this.measure();
    const x = clamp(this.x.x, 0, 1.04), u = this.u, cv = clamp(this.cv.x), gh = clamp(this.gh.x);
    this.tx = this.dir * x * this.T;
    put(this.handle, "transform", Math.abs(this.tx) < 0.01 ? "" : `translateX(${this.tx.toFixed(2)}px)`);
    put(this.host, "--lk", (this.pend ? LOCK_COLORS[this.pend.stop] : this.colorAt(x)).join(" "));
    put(this.host, "--gh", gh.toFixed(3));
    put(this.handle, "--cov", cv.toFixed(3));
    // the fill reaches the handle's far edge; the ghosts name the stops ahead of it
    put(this.fill, "width", `${(x * this.T + this.H + this.L).toFixed(1)}px`);
    const edge = this.L + this.H + 8;
    if (this.openZone) put(this.g1, this.dir === 1 ? "left" : "right", `${(edge + u * this.T).toFixed(1)}px`);
    put(this.g2, this.dir === 1 ? "right" : "left", `${edge.toFixed(1)}px`);
    put(this.g1, this.dir === 1 ? "right" : "left", "auto");
    put(this.g2, this.dir === 1 ? "left" : "right", "auto");
    put(this.g1, "opacity", this.openZone ? (gh * clamp(1 - (x - u) * 5)).toFixed(3) : "0");
    // the icon crossfades between the stops it sits between: what the lock is, what the slide makes it, open
    const w = [0, 0, 0];
    if (this.pend) w[this.pend.stop] = 1;
    else {
      const pts = this.openZone ? [[0, this.rest], [u, this.target], [1, 2]] : [[0, this.rest], [1, this.target]];
      if (x >= pts[pts.length - 1][0]) w[pts[pts.length - 1][1]] = 1;
      else for (let k = 0; k < pts.length - 1; k++) {
        if (x >= pts[k][0] && x <= pts[k + 1][0]) { const t = (x - pts[k][0]) / (pts[k + 1][0] - pts[k][0]); w[pts[k][1]] += 1 - t; w[pts[k + 1][1]] += t; }
      }
    }
    this.icons.forEach((ic, i) => {
      put(ic, "opacity", w[i].toFixed(3));
      put(ic, "transform", `scale(${(0.7 + 0.3 * w[i]).toFixed(3)})`);
    });
    // the hold ring, from the clock so reduced motion keeps it
    let busy = false;
    let p = 0;
    if (this.holdFrom && !this.armed) { p = clamp((performance.now() - this.holdFrom) / LOCK_HOLD_MS); busy = true; }
    else if (this.armed) p = 1;
    put(this.ring, "strokeDashoffset", (125.7 * (1 - p)).toFixed(2));
    put(this.handle, "--ring", p > 0 ? "1" : "0");
    attr(this.host, "data-armed", this.armed);
    // a handle waiting on HA breathes
    if (this.transitional && !MQ.reduced.matches) {
      this.pulse += (dt || 0) * 5;
      put(this.handle, "--breath", (0.5 + 0.5 * Math.sin(this.pulse)).toFixed(3));
      busy = true;
    } else put(this.handle, "--breath", "0");
    return busy;
  }

  // ---- gestures
  wire() {
    const el = this.handle;
    let id = null, x0 = 0, y0 = 0, xs = 0, from = 0, moved = false;
    el.addEventListener("pointerdown", (e) => {
      if (e.button > 0 || this.disabled) return;
      e.stopPropagation();
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; moved = false;
      this.drag = null;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* already lifted */ }
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerId !== id) return;
      if (!e.buttons && e.pointerType === "mouse") { id = null; return; }
      if (!this.drag) {
        const dx = (e.clientX - x0) * this.dir, dy = e.clientY - y0;
        if (Math.hypot(dx, dy) < SLOP) return;
        if (Math.abs(dy) >= Math.abs(dx)) { id = null; return; }   // vertical: the page scrolls
        this.measure();
        moved = true;
        // relative: the finger moves the handle from wherever it was
        const cur = this.x.x, f0 = this.openZone && cur > this.u ? this.u + (LOCK_END - this.u) * Math.pow((cur - this.u) / (1 - this.u), 1 / 1.8) : cur;
        from = f0; xs = x0;                     // the handle stays under the finger that grabbed it
        this.drag = { f: f0 };
        this.last = 0;
        this.host.dataset.drag = "";
        this.gh.to(1);
        this.cv.to(1);
      }
      const f = clamp(from + ((e.clientX - xs) * this.dir) / this.T);
      this.drag.f = f;
      this.x.snap(this.mapFinger(f));
      const notch = this.openZone ? (f > this.u ? 2 : f > this.u / 2 ? 1 : 0) : (f > 0.6 ? 1 : 0);
      if (notch !== this.last) { this.last = notch; haptic("selection"); }
      this.zone(f >= LOCK_END);
      this.kit.wake();
    });
    const endDrag = () => { delete this.host.dataset.drag; this.gh.to(0); };
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      if (!this.drag) { if (!moved && e.type === "pointerup") this.nudge(); return; }
      const f = this.drag.f, armed = this.armed;
      this.drag = null;
      endDrag();
      this.zone(false);
      this.release(f, armed);
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", (e) => {
      if (e.pointerId === id && this.drag) { id = null; this.drag = null; endDrag(); this.zone(false); this.x.to(0); this.cv.to(this.pend ? 1 : 0); this.kit.wake(); }
    });
    el.addEventListener("click", (e) => e.stopPropagation());

    // keyboard: arrows lock and unlock; Open needs Enter or Space held for the same half second
    let keyHold = false;
    el.addEventListener("keydown", (e) => {
      if (this.disabled) return;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); if (this.rest === 0) this.commit(1); return; }
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); if (this.rest >= 1) this.commit(0); return; }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault(); e.stopPropagation();
        if (e.repeat || keyHold) return;
        if (this.rest === 0 || !this.openZone) { this.commit(this.target); return; }
        keyHold = true;
        this.x.to(1);
        this.cv.to(1);
        this.gh.to(1);
        this.zone(true);
        this.kit.wake();
      }
    });
    el.addEventListener("keyup", (e) => {
      if (!keyHold || (e.key !== "Enter" && e.key !== " ")) return;
      e.stopPropagation();
      keyHold = false;
      const armed = this.armed;
      this.zone(false);
      this.gh.to(0);
      if (armed) this.release(1, true); else { this.x.to(0); this.cv.to(this.pend ? 1 : 0); this.kit.wake(); }
    });
    el.addEventListener("blur", () => { if (keyHold) { keyHold = false; this.zone(false); this.x.to(0); this.gh.to(0); this.cv.to(this.pend ? 1 : 0); this.kit.wake(); } });
  }

  // a tap only shows that it slides
  nudge() {
    if (this.disabled || MQ.reduced.matches) return;
    haptic("light");
    this.x.to(0.09);
    this.later.push(setTimeout(() => { if (!this.drag) { this.x.to(0); this.kit.wake(); } }, 130));
    this.kit.wake();
  }

  // the end of the track: entering it starts the ring; a half second later it arms
  zone(inside) {
    if (!this.openZone) return;
    if (inside && !this.holdFrom) {
      this.holdFrom = performance.now();
      this.clearTimers();
      const red = MQ.reduced.matches;
      if (!red) {
        haptic("selection");
        this.timers.push(setTimeout(() => haptic("light"), LOCK_HOLD_MS * 0.35), setTimeout(() => haptic("light"), LOCK_HOLD_MS * 0.7));
      }
      this.timers.push(setTimeout(() => { this.armed = true; haptic("medium"); this.kit.wake(); }, LOCK_HOLD_MS));
      this.kit.wake();
    } else if (!inside && this.holdFrom) {
      this.holdFrom = 0;
      this.armed = false;
      this.clearTimers();
      this.kit.wake();
    }
  }

  // the finger lets go at share f of the travel
  release(f, armed) {
    if (armed && this.openZone) {
      this.armed = false;
      this.holdFrom = 0;
      // the latch shows for a moment, then the handle is back and the lock is what it was
      this.pend = { stop: 2, at: Date.now(), ttl: 700 };
      haptic("success");
      this.x.to(0);
      this.onOpen();
      this.setState(this.state);
      this.onWords?.();
      this.recheck(750);
      this.kit.wake();
      return;
    }
    this.armed = false;
    this.holdFrom = 0;
    // past the first stop does the opposite of what the lock is; letting go in the end zone early, or short of the stop, does nothing
    const fire = this.openZone ? 0.4 : 0.6;
    if (f >= fire && !(this.openZone && f >= LOCK_END)) this.commit(this.target);
    else { this.x.to(0); this.cv.to(this.pend ? 1 : 0); this.kit.wake(); }
  }

  // ask HA for a stop it isn't in; the handle goes back to the start
  commit(stop) {
    if (stop !== this.rest) {
      this.pend = { stop, at: Date.now() };
      haptic("light");
      if (stop === 0) this.onLock(); else if (stop === 1) this.onUnlock();
      this.setState(this.state);
      this.onWords?.();
      this.recheck(CTL_PREDICT_MS + 60);
    }
    this.x.to(0);
    this.kit.wake();
  }

  // HA may never answer (or answer with the state it was already in): look again when the guess is stale
  recheck(ms) {
    this.later.push(setTimeout(() => { this.setState(this.state); this.onWords?.(); }, ms));
  }
}

// ===== core/72-rows.js =====
// ---------------------------------------------------------------------------------------
// core/rows: what a popup row controls, by domain. A lock gets its track; a media player
// its transport and volume; a climate unit its target and modes; a light a brightness bar;
// a cover its buttons; an alarm panel its arm modes. Everything else is a switch or just
// its state. Each kind builds its controls once per row and updates them from the state.
//
//   ROW_KINDS[domain] = { build(ctx) -> { main?, extra?, fixed?, update(st, hass) -> { extra, sub, val, timed, art } } }
//   main: the control on the row's line (a play button, a stepper); extra: one more line under it,
//   opened by the row's chevron (or always there, when `fixed`: the lock's track).
//   ctx: { id, kit, host, hass() }
// ---------------------------------------------------------------------------------------

const feature = (st, bit) => ((st?.attributes.supported_features || 0) & bit) === bit;
const TOGGLE_DOMAINS = new Set(["light", "switch", "input_boolean", "fan", "siren", "humidifier"]);
const call = (ctx, domain, service, data) => ctx.hass().callService(domain, service, data || {}, { entity_id: ctx.id });
const div = (cls) => { const d = document.createElement("div"); d.className = cls; return d; };
const dimmable = (st) => {
  const modes = st.attributes.supported_color_modes;
  return Array.isArray(modes) ? modes.some((m) => ["brightness", "color_temp", "hs", "xy", "rgb", "rgbw", "rgbww", "white"].includes(m)) : st.attributes.brightness != null;
};

const ROW_KINDS = {};

// ---- binary sensors: read-only. Presence and motion say when it last changed; a tripped
// leak / smoke / gas / CO sensor is red.
ROW_KINDS.binary_sensor = {
  build(ctx) {
    // a room's merged sensors: the row's chevron lists the sensors behind it, read only
    const merged = !!ctx.hass().states[ctx.id]?.attributes.savvy_members;
    const extra = merged ? div("sv-xline sv-agg") : null;
    const lines = new Map();
    return {
      extra,
      update(st, hass) {
        const dc = st.attributes.device_class;
        const unavailable = st.state === "unavailable" || st.state === "unknown";
        if (extra) {
          const ids = st.attributes.savvy_members || [];
          ids.forEach((id, i) => {
            let l = lines.get(id);
            if (!l) {
              l = div("sv-agg-l");
              l.setAttribute("role", "button");
              l.tabIndex = 0;
              l.innerHTML = '<span class="n"></span><span class="s"></span>';
              l.onclick = () => moreInfo(ctx.host, id);
              l.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); moreInfo(ctx.host, id); } };
              lines.set(id, l);
            }
            const m = hass.states[id];
            text(l.querySelector(".n"), shortName(hass, id, null));
            const t = Date.parse(m?.last_changed);
            text(l.querySelector(".s"), [m ? stateText(hass, m) : "", Number.isFinite(t) ? since(t, false) : ""].filter(Boolean).join(" · "));
            attr(l, "data-on", m?.state === "on");
            place(extra, l, i);
          });
          for (const [id, l] of lines) if (!ids.includes(id)) { l.remove(); lines.delete(id); }
        }
        return { val: stateText(hass, st), timed: !unavailable && (merged || PRESENCE_CLASSES.includes(dc)), extra: merged,
          sub: merged ? plural(st.attributes.savvy_members.length, "sensor", "sensors") : undefined,
          alert: !unavailable && SAFETY_CLASSES.includes(dc) && st.state === "on" };
      },
    };
  },
};

// ---- media players: play / pause (power when off) on the line; the rest on the extra line
ROW_KINDS.media_player = {
  build(ctx) {
    const { kit } = ctx;
    const powerTap = () => { const s = ctx.hass().states[ctx.id]?.state; call(ctx, "media_player", ["off", "standby"].includes(s) ? "turn_on" : "turn_off"); };
    const main = div("sv-act-in");
    const mainPower = iconButton(kit, { icon: "mdi:power", label: "Power", onTap: powerTap });
    const play = iconButton(kit, { icon: "mdi:play", label: "Play", solid: true, cls: "sv-play", onTap: () => {
      const s = ctx.hass().states[ctx.id]?.state;
      call(ctx, "media_player", s === "idle" ? "media_play" : "media_play_pause");
    } });
    main.append(play, mainPower);
    const extra = div("sv-xline sv-ctl-media");
    const power = iconButton(kit, { icon: "mdi:power", label: "Power", onTap: powerTap });
    const prev = iconButton(kit, { icon: "mdi:skip-previous", label: "Previous", onTap: () => call(ctx, "media_player", "media_previous_track") });
    const next = iconButton(kit, { icon: "mdi:skip-next", label: "Next", onTap: () => call(ctx, "media_player", "media_next_track") });
    const mute = iconButton(kit, { icon: "mdi:volume-high", label: "Mute", onTap: () => {
      const st = ctx.hass().states[ctx.id];
      call(ctx, "media_player", "volume_mute", { is_volume_muted: !st?.attributes.is_volume_muted });
    } });
    const bar = new SideBar(kit, { label: "Volume", onChange: (v) => call(ctx, "media_player", "volume_set", { volume_level: Math.round(v * 100) / 100 }) });
    const down = iconButton(kit, { icon: "mdi:minus", label: "Volume down", onTap: () => bar.nudge(-1) });
    const up = iconButton(kit, { icon: "mdi:plus", label: "Volume up", onTap: () => bar.nudge(1) });
    const pct = document.createElement("span");
    pct.className = "sv-pct";
    const vol = div("sv-volg");
    vol.append(down, bar.el, up, pct);
    extra.append(prev, next, mute, vol, power);
    let first = true;
    return {
      main, extra,
      update(st) {
        const s = st.state, f = (bit) => feature(st, bit);
        const off = ["off", "unavailable", "unknown", "standby"].includes(s);
        const active = ["playing", "paused", "buffering"].includes(s);
        const canPower = (f(128) || f(256)) && s !== "unavailable";
        mainPower.hidden = !(off && canPower);
        play.hidden = !((active && (f(1) || f(16384))) || (s === "idle" && f(16384)));
        play.setIcon(s === "playing" || s === "buffering" ? "mdi:pause" : "mdi:play");
        attr(play, "aria-label", s === "playing" ? "Pause" : "Play");
        power.hidden = !(canPower && !off);
        attr(power, "data-on", !off);
        prev.hidden = !(active && f(16));
        next.hidden = !(active && f(32));
        mute.hidden = !(active && f(8));
        const muted = !!st.attributes.is_volume_muted;
        mute.setIcon(muted ? "mdi:volume-off" : "mdi:volume-high");
        attr(mute, "data-on", muted);
        vol.hidden = !(active && f(4));
        const level = clamp(Number(st.attributes.volume_level) || 0);
        bar.setLevel(level, first);
        text(pct, `${Math.round((bar.pending ?? level) * 100)}%`);
        first = false;
        const title = [st.attributes.media_title, st.attributes.media_artist].filter(Boolean).join(" · ");
        return {
          extra: [power, prev, next, mute].some((b) => !b.hidden) || !vol.hidden,
          sub: active ? title || st.attributes.source || null : null,
          art: active ? st.attributes.entity_picture_local || st.attributes.entity_picture || null : null,
        };
      },
    };
  },
};

// ---- climate: a - target + stepper on the line (power when off); the modes on the extra line
// Off is a power control, so it comes last in a list of modes
const offLast = (modes) => [...modes.filter((m) => m !== "off"), ...modes.filter((m) => m === "off")];
const HVAC_ORDER = ["off", "cool", "heat", "heat_cool", "auto", "dry", "fan_only"];
const HVAC_LOOK = {
  off: ["Off", "mdi:power"], cool: ["Cool", "mdi:snowflake"], heat: ["Heat", "mdi:fire"], heat_cool: ["Heat/Cool", "mdi:sun-snowflake-variant"],
  auto: ["Auto", "mdi:thermostat-auto"], dry: ["Dry", "mdi:water-percent"], fan_only: ["Fan", "mdi:fan"],
};
ROW_KINDS.climate = {
  build(ctx) {
    const { kit } = ctx;
    const main = div("sv-act-in");
    const power = iconButton(kit, { icon: "mdi:power", label: "Turn on", onTap: () => {
      const cur = ctx.hass().states[ctx.id];
      if (feature(cur, 128)) return call(ctx, "climate", "turn_on");
      const m = HVAC_ORDER.find((x) => x !== "off" && (cur?.attributes.hvac_modes || []).includes(x));
      if (m) call(ctx, "climate", "set_hvac_mode", { hvac_mode: m });
    } });
    const step = new Stepper(kit, { label: "Target temperature", compact: true, onChange: (v) => call(ctx, "climate", "set_temperature", { temperature: v }) });
    main.append(step.el, power);
    const extra = div("sv-xline sv-ctl-climate");
    let seg = null, segKey = "";
    return {
      main, extra,
      update(st, hass) {
        const a = st.attributes, unit = hass.config?.unit_system?.temperature || "°C";
        const target = Number(a.temperature);
        const hasTarget = a.temperature != null && Number.isFinite(target);
        const off = st.state === "off";
        power.hidden = !off;
        step.el.hidden = off || !hasTarget || st.state === "unavailable";
        if (!step.el.hidden) {
          step.set({ value: target, min: Number.isFinite(a.min_temp) ? a.min_temp : 7, max: Number.isFinite(a.max_temp) ? a.max_temp : 35,
            step: Number(a.target_temp_step) || (unit.includes("F") ? 1 : 0.5), unit: "°" });
        }
        const have = a.hvac_modes || [];
        // Off, Cool and Heat first, then whatever else the unit has, while there's room for it
        const modes = offLast(HVAC_ORDER.filter((m) => have.includes(m)).slice(0, 4));
        const key = modes.join();
        if (key !== segKey) {
          seg?.el.remove();
          segKey = key;
          seg = modes.length > 1 ? new Seg(kit, { label: "Mode", items: modes.map((m) => ({ value: m, label: HVAC_LOOK[m][0], icon: HVAC_LOOK[m][1] })),
            onPick: (m) => { if (m !== ctx.hass().states[ctx.id]?.state) call(ctx, "climate", "set_hvac_mode", { hvac_mode: m }); } }) : null;
          if (seg) extra.appendChild(seg.el);
          seg?.setValue(st.state, true);
        }
        seg?.setValue(st.state);
        const cur = Number(a.current_temperature);
        const action = a.hvac_action && !["off", "idle"].includes(a.hvac_action) ? title(a.hvac_action) : null;
        const lead = action || (HVAC_LOOK[st.state]?.[0] ?? title(st.state));
        const range = !hasTarget && Number.isFinite(Number(a.target_temp_low)) && Number.isFinite(Number(a.target_temp_high)) && !off
          ? `${Number(a.target_temp_low)}–${Number(a.target_temp_high)}°` : null;
        return { extra: !!seg && st.state !== "unavailable", sub: [lead, Number.isFinite(cur) ? `${cur.toFixed(1)}° now` : null].filter(Boolean).join(" · "), val: range };
      },
    };
  },
};

// ---- lights: the switch on the line; a brightness bar on the extra line
ROW_KINDS.light = {
  build(ctx) {
    const { kit } = ctx;
    const extra = div("sv-xline sv-ctl-light");
    const bar = new SideBar(kit, { label: "Brightness", onChange: (v) => call(ctx, "light", "turn_on", { brightness_pct: Math.max(1, Math.round(v * 100)) }) });
    const pct = document.createElement("span");
    pct.className = "sv-pct";
    extra.append(bar.el, pct);
    let first = true;
    return {
      extra,
      update(st) {
        const on = st.state === "on" && dimmable(st);
        const level = clamp((Number(st.attributes.brightness) || 0) / 255);
        if (on) bar.setLevel(level, first);
        text(pct, `${Math.round((bar.pending ?? level) * 100)}%`);
        first = !on;
        return { extra: on, sub: on ? `${Math.round(level * 100)}%` : null };
      },
    };
  },
};

// ---- covers: open / close (stop while it moves) on the line; stop and a position bar below
ROW_KINDS.cover = {
  build(ctx) {
    const { kit } = ctx;
    const main = div("sv-act-in");
    const go = iconButton(kit, { icon: "mdi:arrow-up", label: "Open", onTap: () => {
      call(ctx, "cover", go.__mode === "stop" ? "stop_cover" : go.__mode === "close" ? "close_cover" : "open_cover");
    } });
    go.__mode = "open";
    main.appendChild(go);
    const extra = div("sv-xline sv-ctl-cover");
    const stop = iconButton(kit, { icon: "mdi:stop", label: "Stop", onTap: () => call(ctx, "cover", "stop_cover") });
    const bar = new SideBar(kit, { label: "Position", onChange: (v) => call(ctx, "cover", "set_cover_position", { position: Math.round(v * 100) }) });
    const pct = document.createElement("span");
    pct.className = "sv-pct";
    extra.append(stop, bar.el, pct);
    let first = true;
    return {
      main, extra,
      update(st) {
        const sf = st.attributes.supported_features ?? 11;
        const moving = st.state === "opening" || st.state === "closing";
        const mode = moving && (sf & 8) ? "stop" : st.state === "closed" ? "open" : "close";
        go.__mode = mode;
        go.setIcon({ open: "mdi:arrow-up", close: "mdi:arrow-down", stop: "mdi:stop" }[mode]);
        attr(go, "aria-label", { open: "Open", close: "Close", stop: "Stop" }[mode]);
        go.hidden = st.state === "unavailable" || (mode === "open" && !(sf & 1)) || (mode === "close" && !(sf & 2));
        stop.hidden = !(sf & 8);
        const pos = Number(st.attributes.current_position);
        const hasPos = !!(sf & 4) && Number.isFinite(pos);
        bar.el.hidden = pct.hidden = !hasPos;
        if (hasPos) { bar.setLevel(clamp(pos / 100), first); text(pct, `${Math.round((bar.pending ?? pos / 100) * 100)}%`); first = false; }
        const words = title(st.state);
        return { extra: st.state !== "unavailable" && (!stop.hidden || hasPos), sub: Number.isFinite(pos) ? `${words} · ${Math.round(pos)}%` : words };
      },
    };
  },
};

// ---- alarm panels: the state on the line; arm modes below; disarming (and a code) is the more-info dialog's job
const ARM = [["home", "Home", 1, "mdi:shield-home"], ["away", "Away", 2, "mdi:shield-lock"], ["night", "Night", 4, "mdi:shield-moon"], ["vacation", "Vacation", 32, "mdi:shield-airplane"]];
ROW_KINDS.alarm_control_panel = {
  build(ctx) {
    const { kit } = ctx;
    const main = div("sv-act-in");
    const pill = document.createElement("button");
    pill.className = "sv-pillbtn sv-state";
    pill.innerHTML = "<span></span>";
    attr(pill, "aria-label", "Open alarm panel");
    kit.press(pill, () => moreInfo(ctx.host, ctx.id), { depth: 0.05 });
    main.appendChild(pill);
    const extra = div("sv-xline sv-ctl-alarm");
    const disarm = iconButton(kit, { icon: "mdi:shield-off", label: "Disarm", onTap: () => moreInfo(ctx.host, ctx.id) });
    extra.appendChild(disarm);
    let seg = null, segKey = "";
    return {
      main, extra,
      update(st) {
        const a = st.attributes, sf = a.supported_features ?? 7;
        const modes = ARM.filter((m) => sf & m[2]);
        const key = modes.map((m) => m[0]).join();
        if (key !== segKey) {
          seg?.el.remove();
          segKey = key;
          seg = modes.length ? new Seg(kit, { label: "Arm mode", items: modes.map((m) => ({ value: m[0], label: m[1], icon: m[3] })), onPick: (m) => {
            const cur = ctx.hass().states[ctx.id];
            if (cur?.state === `armed_${m}`) return;
            const needsCode = cur?.attributes.code_format != null && cur.attributes.code_arm_required !== false;
            if (needsCode) moreInfo(ctx.host, ctx.id);
            else call(ctx, "alarm_control_panel", `alarm_arm_${m}`);
          } }) : null;
          if (seg) extra.insertBefore(seg.el, disarm);
          seg?.setValue(undefined, true);
        }
        const armed = /^armed_(.+)$/.exec(st.state);
        seg?.setValue(armed && modes.some((m) => m[0] === armed[1]) ? armed[1] : null);
        disarm.hidden = st.state === "disarmed" || st.state === "unavailable";
        const words = stateText(ctx.hass(), st);
        text(pill.firstElementChild, words);
        attr(pill, "data-armed", armed || st.state === "triggered" || st.state === "arming" || st.state === "pending");
        return { extra: st.state !== "unavailable" && (modes.length > 0 || !disarm.hidden), sub: null };
      },
    };
  },
};

// ---- fans: the switch on the line; a speed bar on the extra line
ROW_KINDS.fan = {
  build(ctx) {
    const { kit } = ctx;
    const extra = div("sv-xline sv-ctl-fan");
    const bar = new SideBar(kit, { label: "Speed", step: 0.1, onChange: (v) => call(ctx, "fan", "set_percentage", { percentage: Math.max(1, Math.round(v * 100)) }) });
    const pct = document.createElement("span");
    pct.className = "sv-pct";
    extra.append(bar.el, pct);
    let first = true;
    return {
      extra,
      update(st) {
        const p = Number(st.attributes.percentage);
        const on = st.state === "on" && st.attributes.percentage != null && Number.isFinite(p);
        if (on) bar.setLevel(clamp(p / 100), first);
        if (on) text(pct, `${Math.round((bar.pending ?? p / 100) * 100)}%`);
        first = !on;
        return { extra: on, sub: on ? `${Math.round(p)}%` : null };
      },
    };
  },
};

// ---- locks: the row's own icon is the handle you slide across the row
ROW_KINDS.lock = {
  build(ctx) {
    const { kit } = ctx;
    const slide = new LockSlide(kit, {
      host: ctx.line, handle: ctx.handle, label: "Lock", canOpen: feature(ctx.hass().states[ctx.id], 1), fade: [ctx.text],
      onLock: () => call(ctx, "lock", "lock"), onUnlock: () => call(ctx, "lock", "unlock"), onOpen: () => call(ctx, "lock", "open"),
    });
    slide.onWords = () => ctx.refresh?.();
    let first = true;
    return {
      track: slide, slide,
      update(st) {
        slide.setState(st.state, first);
        first = false;
        return { sub: slide.words, timed: true };
      },
    };
  },
};

// ---- bulk actions: what the popup's top button does to everything it lists
const BULK = {
  lights: { label: "All off", icon: "mdi:lightbulb-off-outline", domain: "light", service: "turn_off", needs: (st) => st.state === "on" },
  climate: { label: "All off", icon: "mdi:power", domain: "climate", service: "turn_off", needs: (st) => !["off", "unavailable", "unknown"].includes(st.state) },
  media: { label: "Pause all", icon: "mdi:pause", domain: "media_player", service: "media_pause", needs: (st) => st.state === "playing" },
  security: { label: "Lock all", icon: "mdi:lock", domain: "lock", service: "lock", needs: (st) => !["locked", "locking", "jammed", "unavailable", "unknown"].includes(st.state) },
};
// the kind of bulk action a list's entities all agree on (a popup that doesn't name one), or null
function bulkKindOf(ids) {
  const doms = new Set(ids.map(domainOf));
  if (doms.size !== 1) return null;
  const d = [...doms][0];
  return Object.keys(BULK).find((k) => BULK[k].domain === d) || null;
}
// exactly the listed entities of the kind's domain that still need it
const bulkTargets = (kind, ids, hass) => ids.filter((id) => domainOf(id) === BULK[kind].domain && hass.states[id] && BULK[kind].needs(hass.states[id]));

// ---- sorting: by room (headings), by recent change (flat), or as given
// `order`: area ids listed first, in this order; the rest follow by name, and "No room" is always last
function sortRows(hass, ids, { sort, pinned = [], order = [] } = {}) {
  const out = [];
  if (!sort) return ids.map((id) => ({ id }));
  const pin = new Set(pinned);
  for (const id of pinned) if (ids.includes(id)) out.push({ id });
  const rest = ids.filter((id) => !pin.has(id));
  const nameOf = (id) => hass.states[id]?.attributes.friendly_name || id;
  const changed = (id) => Date.parse(hass.states[id]?.last_changed) || 0;
  if (sort === "recent") {
    rest.sort((a, b) => changed(b) - changed(a) || nameOf(a).localeCompare(nameOf(b)));
    for (const id of rest) out.push({ id });
    return out;
  }
  const groups = new Map();
  for (const id of rest) {
    const area = entityArea(hass, id) || "";
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(id);
  }
  const label = (area) => (area ? areaInfo(hass, area).name : "No room");
  const rank = new Map([].concat(order || []).map((a, i) => [a, i]));
  const keys = [...groups.keys()].sort((a, b) => (!a) - (!b) || (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || label(a).localeCompare(label(b)));
  for (const area of keys) {
    out.push({ head: { key: area || "_none", label: label(area) } });
    const list = groups.get(area).sort((a, b) => (isActive(hass.states[b]) - isActive(hass.states[a])) || nameOf(a).localeCompare(nameOf(b)));
    for (const id of list) out.push({ id });
  }
  return out;
}

const ROWS_CSS = `
  .sv-sheet [hidden] { display: none !important; }
  /* every button in a popup starts from nothing: the browser's border and padding would push anything drawn inside it off centre */
  :where(.sv-sheet, .sv-scrim) button { appearance: none; -webkit-appearance: none; border: 0; margin: 0; padding: 0; background: none; box-sizing: border-box;
    font: inherit; color: inherit; cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent; }
  .sv-btn, .sv-seg-b, .sv-pillbtn, .sv-bulk, .sv-chev { cursor: pointer; }
  /* a row: one line; its chevron opens one more */
  .sv-row { display: flex; flex-direction: column; border-radius: 14px; }
  .sv-line1 { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 3px 4px 3px 4px; border-radius: 14px; }
  .sv-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; min-height: 38px; border-radius: 12px; cursor: pointer; outline: none; }
  .sv-main:hover { background: var(--well); }
  .sv-row[data-off] .sv-main, .sv-row[data-off] .sv-val { opacity: 0.55; }
  .sv-act { flex: none; display: flex; align-items: center; gap: 6px; }
  .sv-act:empty { display: none; }
  .sv-act-in { display: flex; align-items: center; gap: 6px; }
  .sv-chev { flex: none; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 9px; color: var(--secondary-text-color); --mdc-icon-size: 20px; }
  .sv-chev ha-icon { display: flex; }
  .sv-chev[data-none] { visibility: hidden; pointer-events: none; }
  .sv-row[data-open] .sv-chev { color: var(--primary-text-color); background: var(--well); }
  .sv-art { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; display: block; }
  .sv-ic[data-art] { overflow: hidden; padding: 0; }
  /* the extra line: one row of controls, opened with a spring */
  .sv-ctl { overflow: hidden; }
  .sv-ctl-in { padding: 2px 6px 8px 50px; }
  @container (max-width: 380px) { .sv-ctl-in { padding-inline-start: 6px; } }
  .sv-xline { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .sv-xline .sv-btn { width: var(--c-s); height: var(--c-s); border-radius: 11px; --mdc-icon-size: 18px; }
  .sv-xline .sv-seg { flex: 1; }
  .sv-xline.sv-agg { flex-direction: column; align-items: stretch; gap: 2px; padding: 0 6px 6px 48px; }
  .sv-agg-l { display: flex; justify-content: space-between; gap: 10px; padding: 6px 8px; border-radius: 10px; font-size: 12.5px; line-height: 16px; color: var(--secondary-text-color); cursor: pointer; outline: none; }
  .sv-agg-l .n { min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sv-agg-l[data-on] .n { color: var(--primary-text-color); }
  @media (hover: hover) { .sv-agg-l:hover { background: var(--well); } }
  .sv-volg { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; }
  @container (max-width: 330px) { .sv-volg .sv-btn, .sv-volg .sv-pct { display: none; } }
  .sv-spacer { flex: 1; }
  .sv-cap { flex: 1; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--secondary-text-color); }
  .sv-pct { flex: none; min-width: 34px; text-align: end; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--secondary-text-color); }
  /* round buttons */
  .sv-btn { flex: none; display: grid; place-items: center; width: var(--c-s); height: var(--c-s); border-radius: 11px; background: var(--well);
    color: var(--primary-text-color); --mdc-icon-size: 19px; }
  .sv-btn ha-icon { display: flex; }
  .sv-btn[data-on] { color: var(--row-c, rgb(var(--accent))); background: color-mix(in oklab, var(--row-c, rgb(var(--accent))) 16%, transparent); }
  .sv-btn[data-solid] { width: 34px; border-radius: 50%; background: var(--row-c, rgb(var(--accent))); color: #fff; --mdc-icon-size: 20px; }
  .sv-xline .sv-btn[data-solid] { width: 32px; border-radius: 50%; }
  .sv-btn[disabled] { opacity: 0.35; cursor: default; }
  :host([kbd]) .sv-btn:focus-visible, :host([kbd]) .sv-seg-b:focus-visible, :host([kbd]) .sv-bar:focus-visible, :host([kbd]) .sv-sl-handle:focus-visible, :host([kbd]) .sv-pillbtn:focus-visible, :host([kbd]) .sv-main:focus-visible,
    :host([kbd]) .sv-chev:focus-visible, :host([kbd]) .sv-bulk:focus-visible, :host([kbd]) .sv-tog:focus-visible
    { outline: 2px solid var(--row-c, rgb(var(--accent))); outline-offset: 2px; }
  /* the bar: a pill that only moves on a sideways drag */
  .sv-bar { position: relative; flex: 1; min-width: 60px; height: 30px; border-radius: 99px; overflow: hidden; background: var(--well);
    touch-action: pan-y; cursor: grab; outline: none; }
  .sv-bar:active { cursor: grabbing; }
  .sv-bar-fill { position: absolute; inset: 0; border-radius: 99px; transform-origin: 0 50%; transform: scaleX(0);
    background: linear-gradient(90deg, color-mix(in oklab, var(--row-c, rgb(var(--accent))) 55%, transparent), var(--row-c, rgb(var(--accent)))); }
  /* segmented control */
  .sv-seg { position: relative; display: grid; grid-template-columns: repeat(var(--n), 1fr); padding: 3px; border-radius: 13px; background: var(--well); min-width: 0; }
  .sv-seg-pill { position: absolute; top: 3px; bottom: 3px; left: 3px; width: calc((100% - 6px) / var(--n)); border-radius: 10px;
    background: var(--card-background-color, #fff); box-shadow: 0 1px 4px rgb(0 0 0 / 0.22);
    transform: translateX(calc(var(--i, 0) * 100%)); }
  .sv-seg-b { position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; gap: 5px; min-width: 0; height: 32px; padding: 0 4px;
    border-radius: 10px; font-size: 12.5px; line-height: 16px; font-weight: 600; color: var(--secondary-text-color); --mdc-icon-size: 16px; }
  .sv-seg-b ha-icon { display: flex; flex: none; }
  .sv-seg-b span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sv-seg-b[data-on] { color: var(--row-c, rgb(var(--accent))); }
  /* stepper */
  .sv-step { flex: none; display: flex; align-items: center; gap: 6px; }
  .sv-step-v { min-width: 52px; text-align: center; font-size: 16px; line-height: 20px; font-weight: 650; letter-spacing: -0.01em; }
  .sv-step[data-compact] { gap: 2px; }
  .sv-step[data-compact] .sv-btn { --mdc-icon-size: 17px; }
  .sv-step[data-compact] .sv-step-v { min-width: 42px; font-size: 14px; line-height: 18px; }
  .sv-pillbtn { flex: none; display: inline-flex; align-items: center; gap: 6px; height: var(--c-l); padding: 0 12px; border-radius: 13px; background: var(--well);
    font-size: 12.5px; font-weight: 600; color: var(--primary-text-color); --mdc-icon-size: 17px; }
  .sv-pillbtn ha-icon { display: flex; }
  .sv-pillbtn.sv-state { height: var(--c-s); padding: 0 10px; border-radius: 16px; font-size: 12px; max-width: 132px; }
  .sv-pillbtn.sv-state span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sv-pillbtn.sv-state[data-armed] { color: var(--row-c, rgb(var(--accent))); background: color-mix(in oklab, var(--row-c, rgb(var(--accent))) var(--mix-on), transparent); }
  /* the top of a popup's list: the sort toggle and the bulk action */
  .sv-tools { display: flex; align-items: center; gap: 8px; }
  .sv-tools .sv-seg { flex: 1; min-width: 0; }
  .sv-tools .sv-seg-b { height: 28px; }
  .sv-bulk { flex: none; display: inline-flex; align-items: center; gap: 5px; height: var(--c-s); padding: 0 12px; border-radius: 11px; background: var(--well);
    font-size: 12.5px; line-height: 16px; font-weight: 650; color: var(--primary-text-color); --mdc-icon-size: 16px; white-space: nowrap; }
  .sv-bulk ha-icon { display: flex; }
  .sv-bulk[disabled] { opacity: 0.4; cursor: default; }
  .sv-tools[data-solo] .sv-bulk { margin-inline-start: auto; }
  ${LOCK_SLIDE_CSS}
  .sv-row[data-kind="lock"] .sv-line1 { padding: 3px 4px; border-radius: 22px; min-height: 46px; }
  .sv-row[data-kind="lock"] .sv-main:hover { background: none; }
  @media (prefers-contrast: more) { .sv-seg { box-shadow: inset 0 0 0 1px currentColor; } }
`;

// ===== core/75-mode.js =====
// ---------------------------------------------------------------------------------------
// core/mode: the control chip every header card shares. `control:` names any entity (a house
// mode, a room's scenes, a scene button, a switch). Its behaviour follows its domain:
//   select / input_select   tap opens a picker, one row per option, each with an icon and a
//                           colour from the mode dictionary (core/palette), overridable with
//                           mode_icons / mode_colors; hold opens more-info
//   button, script, scene   tap runs it
//   switch, input_boolean   tap toggles it
//   anything else           tap opens more-info
// tap_action / hold_action / double_tap_action override any of that, in Home Assistant's
// standard action format. It is never guessed: no `control`, no chip.
// ---------------------------------------------------------------------------------------

const SWAP_OUT = { response: 0.14, damping: 1 };
const SWAP_IN = { response: 0.32, damping: 1 };

const SELECTS = new Set(["select", "input_select"]);
const NO_STATE = new Set(["button", "input_button", "script", "scene"]);
const CONTROL_ICON = { button: "mdi:gesture-tap-button", input_button: "mdi:gesture-tap-button", script: "mdi:script-text-outline", scene: "mdi:palette-outline",
  switch: "mdi:toggle-switch-outline", input_boolean: "mdi:toggle-switch-outline", light: "mdi:lightbulb-outline" };

// `control` is an entity id, or { entity, name, icon, color, tap_action, hold_action,
// double_tap_action }; the flat control_tap_action ... keys say the same (the editor writes them).
function controlOf(cfg = {}) {
  const raw = cfg.control;
  const o = typeof raw === "string" ? { entity: raw } : { ...(raw || {}) };
  for (const k of ["name", "icon", "color", "tap_action", "hold_action", "double_tap_action"]) {
    if (o[k] === undefined && cfg[`control_${k}`] !== undefined) o[k] = cfg[`control_${k}`];
  }
  return o;
}

// Everything a card shows about its control. -> null when there's no such entity.
function modeInfo(hass, id, cfg = {}) {
  const st = id && hass.states[id];
  if (!st) return null;
  const ctl = controlOf(cfg);
  const label = (value) => {
    if (hass.formatEntityState) { try { return hass.formatEntityState(st, value); } catch (err) { /* older core */ } }
    return title(value);
  };
  if (!SELECTS.has(domainOf(id))) {
    const name = ctl.name || st.attributes.friendly_name || title(id.split(".")[1] || id);
    const d = domainOf(id), quiet = NO_STATE.has(d);
    return { entity: id, st, kind: "control", value: quiet ? id : st.state, label: quiet ? name : label(st.state), caption: quiet ? "" : name,
      icon: ctl.icon || st.attributes.icon || CONTROL_ICON[d] || "mdi:gesture-tap", color: colorOf(ctl.color) || "", options: [] };
  }
  const looks = { icons: keyed(cfg.mode_icons), colors: keyed(cfg.mode_colors) };
  const options = (st.attributes.options || []).map((o) => ({ value: o, label: label(o), ...modeLook(o, looks) }));
  return { entity: id, st, kind: "select", value: st.state, label: label(st.state), ...modeLook(st.state, looks), options };
}

// What sits under the value: a select's caption ("Home mode"), a control's own name.
const modeCaption = (info, configured) => (info?.kind === "control" ? info.caption : configured);

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
    guardBackdrop(this.scrim, this.el, () => this.close());
  }

  open(anchor, bounds, info, caption) {
    if (this.isOpen || !info) return;
    this.isOpen = true;
    this.anchor = anchor;
    portalRoot().append(this.scrim, this.el);
    this.render(info, caption);
    this.place(anchor, bounds);
    this.returnTo = anchor;
    this.onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(); } };
    this.onMove = () => this.close();
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("resize", this.onMove);
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
    window.removeEventListener("resize", this.onMove);
    attr(this.anchor, "aria-expanded", "false");
    const active = portalRoot().activeElement;
    if (active && this.el.contains(active)) this.returnTo?.focus?.({ preventScroll: true });
    this.spring.to(0, MOTION.sheetOut);
    if (MQ.reduced.matches || !this.host.isConnected) { this.spring.snap(0); this.frame(0); this.scrim.remove(); }
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
    // the backdrop goes with the picker, so the rest of the closing tap lands on it
    if (!this.isOpen && v < 0.01) { this.el.remove(); this.scrim.remove(); return false; }
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
//   this._showList(title, ids, color, from, footer, opts)   the popup of the entities a chip stands for,
//                                              with an optional pinned page button; opts: { sort, order, toggle, storeKey, pinned }
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

  _showList(heading, ids, color, from, footer = null, opts = {}) {
    if (!this._list) this._list = new EntityListSheet(this, { title: heading });
    this._list.sheet.setTitle(heading);
    this._list.sheet.setFooter(footer);
    this._list.color = color;
    this._list.show(this._hass, ids, from, opts);
  }

  _wake() { if (this.shadowRoot && this.isConnected) Clock.add(this._job); }

  disconnectedCallback() {
    Clock.remove(this._job);
    // popups live at page level: they go when their card does
    this._picker?.close();
    this._list?.sheet.close(true);
    this._healthSheet?.close(true);
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

// The control chip's gestures, the same on every card: a select's tap opens the picker, any
// other entity's tap does what its domain does (a button presses, a switch toggles, the
// rest open more-info), hold opens more-info, and tap_action / hold_action /
// double_tap_action override all of it. `card._modeInfo()` returns the current modeInfo.
function wireModeChip(card, chip, bounds, caption) {
  card._picker = card._picker || new ModePicker(card, { onPick: (id, v) => selectOption(card._hass, id, v) });
  const run = (kind) => () => {
    const info = card._modeInfo();
    if (!info) return;
    const set = controlOf(card._config)[`${kind}_action`], ctx = { entity: info.entity };
    if (set !== undefined) { runAction(card, card._hass, set, ctx); return; }
    if (kind === "tap") {
      if (info.options.length) card._picker.open(chip, bounds(), info, caption());
      else if (info.kind === "control") runAction(card, card._hass, defaultTapAction(info.entity), ctx);
    } else if (kind === "hold") moreInfo(card, info.entity);
  };
  card._pressable(chip, { onTap: run("tap"), onHold: run("hold"), onDouble: controlOf(card._config).double_tap_action ? run("double_tap") : null });
}

// The chip's accessibility state follows what it does now: only a select has a popup.
function syncModeChip(chip, info) {
  const picker = !!info?.options?.length;
  attr(chip, "aria-haspopup", picker ? "listbox" : null);
  if (!picker) chip.removeAttribute("aria-expanded");
  else if (!chip.hasAttribute("aria-expanded")) attr(chip, "aria-expanded", "false");
}

// ---- the header and chip rows the home and room cards share

const HEADER_CSS = `
  ha-card { --mode: var(--secondary-text-color); display: flex; flex-direction: column; gap: 12px; padding: var(--pad); overflow: hidden;
    user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
  .top { display: flex; align-items: center; gap: 8px; }
  .glyph { flex: none; position: relative; display: grid; place-items: center; width: var(--c-l); height: var(--c-l); border-radius: 13px;
    background: var(--well); color: var(--secondary-text-color); }
  .glyph ha-icon { --mdc-icon-size: 19px; display: flex; }
  .glyph[data-alert] { background: color-mix(in oklab, var(--ac) var(--mix-alert), transparent); color: var(--ac); }
  .count { position: absolute; top: -4px; inset-inline-end: -4px; min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box;
    border-radius: 8px; background: var(--ac); color: #fff; font-size: 10.5px; line-height: 16px; font-weight: 700; text-align: center;
    box-shadow: 0 0 0 2px var(--ha-card-background, var(--card-background-color)); }
  .pill { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: flex-start; gap: 9px; height: var(--c-l); padding: 0 13px; border-radius: 13px;
    background: color-mix(in oklab, var(--mode) 14%, transparent); color: color-mix(in oklab, var(--mode) 72%, var(--primary-text-color));
    font-size: 13.5px; line-height: 17px; font-weight: 600; letter-spacing: -0.008em; }
  .pill ha-icon { --mdc-icon-size: 18px; flex: none; display: flex; }
  .pill .col { min-width: 0; display: flex; flex-direction: column; align-items: flex-start; }
  .pill .pre { font-size: 10.5px; line-height: 13px; font-weight: 500; letter-spacing: 0.012em; color: var(--secondary-text-color); white-space: nowrap; }
  .pill .swap { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
  .pill .val { font-size: 15px; line-height: 19px; font-weight: 650; letter-spacing: -0.012em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .spacer { flex: 1; }
  /* a readout, not a panel */
  .wx { flex: none; display: flex; align-items: center; gap: 5px; height: var(--c-l); padding: 0 12px 0 10px; border-radius: 13px;
    background: var(--well); color: var(--secondary-text-color); }
  .wx ha-icon, .wx savvy-state-icon { --mdc-icon-size: 19px; display: flex; }
  .wx .deg { font-size: 13.5px; line-height: 17px; font-weight: 650; letter-spacing: -0.012em; color: var(--primary-text-color); }
  :host([kbd]) :focus-visible { outline-color: color-mix(in oklab, var(--mode) 80%, var(--primary-text-color)); }
`;

const CHIP_ROW_CSS = `
  /* one row always: the chips share the width, and slide when there isn't enough of it */
  .chips { display: flex; gap: 8px; margin: 0 -2px; padding: 0 2px; overflow-x: auto; overscroll-behavior-x: contain; touch-action: pan-x pan-y;
    scrollbar-width: none; scroll-snap-type: x proximity; }
  .chips::-webkit-scrollbar { display: none; }
  .chips[data-overflow] { -webkit-mask-image: linear-gradient(to left, transparent 0, #000 26px); mask-image: linear-gradient(to left, transparent 0, #000 26px); }
  /* no plate: the disc carries the colour, the text sits beside it. The dim lives on .body,
     so a state's opacity and the press feedback's never fight over one node. */
  .chip { flex: none; scroll-snap-align: start; padding: 2px 4px; border-radius: 13px; text-align: start; }
  .chip .body { display: flex; align-items: center; gap: 9px; }
  .chip .disc { flex: none; display: grid; place-items: center; width: var(--b-s); height: var(--b-s); border-radius: 50%;
    background: color-mix(in oklab, var(--tc) var(--mix-on), transparent); color: var(--tc); }
  .chip .disc ha-icon, .chip .disc savvy-state-icon { --mdc-icon-size: 16px; display: flex; }
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
SavvyCard.prototype._chipRow = function (row, items, opts = {}) {
  row.__nodes = row.__nodes || new Map();
  Motion.flip(row, () => this._chipRowNow(row, items, opts));
};

SavvyCard.prototype._chipRowNow = function (row, items, { iconOnly = false } = {}) {
  attr(row, "data-icon-only", iconOnly);
  const seen = new Set();
  let at = 0;
  for (const item of items) {
    seen.add(item.key);
    let node = row.__nodes.get(item.key);
    const wantState = !item.icon;
    if (node && node.__state !== wantState) { node.remove(); row.__nodes.delete(item.key); node = null; }
    if (!node) {
      node = document.createElement("button");
      node.className = "chip";
      node.__state = wantState;
      node.innerHTML = `<span class="body"><span class="disc">${wantState ? "<savvy-state-icon></savvy-state-icon>" : "<ha-icon></ha-icon>"}</span>
        <span class="col"><span class="v"></span><span class="k"></span></span></span>`;
      node.__icon = node.querySelector(".disc > *");
      node.__item = item;     // bindActions reads it while wiring
      const cur = () => node.__item;
      this._chipActions(node, () => ({ config: cur().config || {}, entity: cur().entity, list: () => cur().list?.(node) }),
        { get tap() { return cur().defaults?.tap; }, get hold() { return cur().defaults?.hold; }, get double_tap() { return cur().defaults?.double_tap; } });
      row.__nodes.set(item.key, node);
    }
    node.__item = item;
    Motion.tintVar(node, "--tc", item.color || "var(--primary-text-color)");
    Motion.fadeTo(node.querySelector(".body"), item.dim ? (MQ.contrast.matches ? 0.7 : 0.45) : 1);
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
    place(row, node, at++);      // keeps the DOM in the items' order, moving nothing that is already there
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

// The control pill of the house and room headers: icon, value and a caption under it.
SavvyCard.prototype._renderPill = function (info, caption) {
  const el = this._el;
  el.pill.hidden = !info;
  if (!info) return;
  Motion.tintVar(el.card, "--mode", info.color || "var(--secondary-text-color)");
  caption = modeCaption(info, caption);
  attr(el.pill, "aria-label", [caption, info.label].filter(Boolean).join(" "));
  el.pill.disabled = info.kind === "select" && !info.options.length;
  syncModeChip(el.pill, info);
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
  const value = showState ? (st ? chipState(hass, st) : "Unavailable") : name;
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

// ===== core/81-title.js =====
// ---------------------------------------------------------------------------------------
// core/title: an optional title and an optional link on every card.
//
//   title_path   a page. Off unless set. With it, the card's title text (and only that text:
//                never the header, the icon or anything around it) is a link to the page.
//   title        text for a card that shows no name or title of its own: a slim line at the
//                top of the card. A card that already shows a name makes that name the link
//                and takes `title` as another way to write it.
//
//   titlePathOf(config)                         the page, or null
//   linkTitle(root, el, path, bind)             `el` is the card's own title text; bind(el, onTap)
//                                               is how that card makes something pressable
//   mountTitleLine(root, frame, config, bind)   the slim line, first in the card's frame
// ---------------------------------------------------------------------------------------

const TITLE_CSS = `
  [data-tlink] { display: block; flex: 0 1 auto !important; width: fit-content; max-width: 100%; box-sizing: border-box;
    margin-inline-end: auto !important; padding: 4px 3px; margin-block: -4px; margin-inline-start: -3px; border-radius: 7px;
    cursor: pointer; outline: none; touch-action: manipulation; -webkit-tap-highlight-color: transparent;
    transition: color 160ms ease; }
  @media (hover: hover) { [data-tlink]:hover { color: color-mix(in oklab, rgb(var(--accent, 88 142 233)) 82%, var(--primary-text-color)); } }
  :host([kbd]) [data-tlink]:focus-visible { box-shadow: 0 0 0 2px rgb(var(--accent, 88 142 233)); }
  .sv-ttl { display: flex; min-width: 0; font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; color: var(--primary-text-color); }
  .sv-ttl-t { display: block; min-width: 0; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;

const titlePathOf = (c) => (typeof c?.title_path === "string" && c.title_path.trim() ? c.title_path.trim() : null);

function ensureTitleStyle(root) {
  if (!root || root.querySelector("style[data-title]")) return;
  const s = document.createElement("style");
  s.setAttribute("data-title", "");
  s.textContent = TITLE_CSS;
  root.appendChild(s);
}

function linkTitle(root, el, path, bind) {
  if (!el) return;
  const on = !!path;
  el.__tpath = on ? path : null;
  if (on) ensureTitleStyle(root);
  attr(el, "data-tlink", on ? "" : null);
  attr(el, "role", on ? "link" : null);
  attr(el, "tabindex", on ? "0" : null);
  if (on && !el.__tbound) {
    el.__tbound = true;
    // pressing the words is not pressing whatever the words sit in
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    bind(el, () => { if (el.__tpath) navigate(el.__tpath); });
  }
}

function mountTitleLine(root, frame, c, bind) {
  if (!frame) return null;
  frame.querySelector(":scope > .sv-ttl")?.remove();
  const t = String(c?.title ?? "").trim();
  if (!t) return null;
  ensureTitleStyle(root);
  const line = document.createElement("div");
  line.className = "sv-ttl";
  const span = document.createElement("span");
  span.className = "sv-ttl-t";
  span.textContent = t;
  line.appendChild(span);
  frame.insertBefore(line, frame.firstChild);
  linkTitle(root, span, titlePathOf(c), bind);
  return line;
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
  .sv-prefill { align-self: flex-start; padding: 8px 14px; border: 0; border-radius: 10px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
    color: var(--primary-color, #58a6ff); background: color-mix(in oklab, var(--primary-color, #58a6ff) 12%, transparent); }
  .sv-inherit { border-radius: 12px; padding: 10px 12px; background: color-mix(in oklab, var(--primary-color, #58a6ff) 9%, transparent); }
  .sv-inherit .h { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--primary-text-color); --mdc-icon-size: 18px; }
  .sv-inherit .l { display: flex; gap: 6px; font-size: 12.5px; line-height: 18px; color: var(--secondary-text-color); margin-top: 2px; }
  .sv-inherit .l b { flex: none; font-weight: 600; color: var(--primary-text-color); }
  .sv-inherit .l span { min-width: 0; overflow-wrap: anywhere; }
  .sv-inherit .l i { font-style: normal; opacity: 0.7; }
  .sv-inherit .l { align-items: baseline; }
  .sv-inherit .unlink { flex: none; margin-inline-start: auto; padding: 2px 10px; border: 0; border-radius: 8px; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
    color: var(--primary-color, #58a6ff); background: color-mix(in oklab, var(--primary-color, #58a6ff) 14%, transparent); }
  .sv-inherit .n { font-size: 11.5px; color: var(--secondary-text-color); margin-top: 6px; }
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
  // the card this edits (defineEditor sets it): what the Savvy settings give it is listed at the top
  get cardType() { return null; }
  connectedCallback() { this._unsub = SettingsStore.subscribe(() => this._renderInherit()); }
  disconnectedCallback() { this._unsub?.(); this._unsub = null; }
  _renderInherit() {
    const wrap = this.shadowRoot.querySelector(".sv-ed");
    if (!wrap || !this._config) return;
    const type = this.cardType;
    const list = type ? resolveSettings(type, this._config, SettingsStore.settings).inherited : [];
    let box = wrap.querySelector(".sv-inherit");
    if (!list.length) { box?.remove(); return; }
    if (!box) {
      box = document.createElement("div");
      box.className = "sv-inherit";
      box.innerHTML = '<div class="h"><ha-icon icon="mdi:cog-sync-outline"></ha-icon><span></span></div><div class="rows"></div><div class="n">Set a value on this card to override it.</div>';
      wrap.insertBefore(box, wrap.firstChild);
    }
    // what is not from the settings card is found on the dashboard itself
    box.querySelector(".h span").textContent = list.every((i) => i.unlink || i.from === AUTO) ? "Found on the dashboard" : "From Savvy settings";
    const key = JSON.stringify(list);
    if (box.__key === key) return;
    box.__key = key;
    const rows = box.querySelector(".rows");
    rows.replaceChildren(...list.map((i) => {
      const row = document.createElement("div");
      row.className = "l";
      const b = document.createElement("b"), v = document.createElement("span"), f = document.createElement("i");
      b.textContent = i.label;
      v.textContent = i.value;
      f.textContent = ` (${i.from})`;
      v.appendChild(f);
      row.append(b, v);
      // a value read from another card can be taken over: it is copied here and no longer follows
      if (i.unlink) {
        const u = document.createElement("button");
        u.type = "button";
        u.className = "unlink";
        u.textContent = "Unlink";
        u.addEventListener("click", () => { this._emit({ ...this._config, [i.path]: i.raw }); this._render(); });
        row.appendChild(u);
      }
      return row;
    }));
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

  // cards can tidy what the form wrote before it is saved (see defineEditor)
  tidy(config) { return config; }

  _emit(config) {
    // an option equal to its default is left out, so the YAML stays as short as the choices
    const out = this.tidy({ ...config });
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
    const keep = wrap.querySelector(".sv-inherit");
    for (const n of [...wrap.children]) if (!nodes.includes(n) && n !== keep) n.remove();
    nodes.forEach((n) => wrap.appendChild(n));
    this._renderInherit();
    const box = wrap.querySelector(".sv-inherit");
    if (box && wrap.firstChild !== box) wrap.insertBefore(box, wrap.firstChild);
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
    // a list with presets (thresholds: temperature) may hold the preset's name instead of items
    const preset = typeof items === "string" && spec.presets?.includes(items) ? items : "";
    if (preset) items = [];
    const given = [].concat(items || []);
    const next = given.length || !spec.initial ? given : [].concat(spec.initial(this._hass, config || {}) || []);
    // unchanged items: keep the rows (and whatever field in them has the cursor)
    const key = JSON.stringify([spec.name, spec.label, next, preset]);
    if (this._spec && key === this._key) return;
    this._key = key;
    this._spec = spec;
    this._items = next;
    this._preset = preset;
    this._render();
  }
  // what the list last sent: its echo back through setup() changes nothing
  _sent() { this._key = JSON.stringify([this._spec.name, this._spec.label, this._items, this._preset || ""]); }
  _value() { return this._preset ? this._preset : [...this._items]; }
  _emit() {
    this._sent();
    // a copy: listeners keep what they were given, later edits don't rewrite it
    this.dispatchEvent(new CustomEvent("list-changed", { detail: { items: this._value() }, bubbles: true, composed: true }));
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
    if (spec.presets) {
      const pf = document.createElement("ha-form");
      pf.schema = [{ name: "preset", label: spec.presetLabel || "Preset", selector: { select: { mode: "dropdown", options: [{ value: "none", label: "None, my own" }, ...spec.presets.map((v) => ({ value: v, label: title(v) }))] } } }];
      pf.data = { preset: this._preset || "none" };
      pf.hass = this._hass;
      pf.computeLabel = (sch) => sch.label;
      pf.addEventListener("value-changed", (e) => {
        e.stopPropagation();
        const v = e.detail.value.preset;
        this._preset = v && v !== "none" ? v : "";
        this._emit();
      });
      root.querySelector(".sv-section").insertBefore(pf, list);
      if (this._preset) { list.hidden = true; root.querySelector(".sv-add").hidden = true; return; }
    }
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
        const scalars = spec.item.filter((e) => e.type !== "list"), nested = spec.item.filter((e) => e.type === "list");
        form.schema = scalars;
        form.data = obj;
        form.hass = this._hass;
        form.computeLabel = (sch) => sch.label || title(sch.name);
        const helps = new Map(scalars.filter((e) => e.name && e.helper).map((e) => [e.name, e.helper]));
        form.computeHelper = (sch) => helps.get(sch.name) || "";
        const send = () => this.dispatchEvent(new CustomEvent("list-changed", { detail: { items: [...this._items] }, bubbles: true, composed: true }));
        form.addEventListener("value-changed", (e) => {
          e.stopPropagation();
          this._items[i] = cleanConfig({ ...(typeof this._items[i] === "object" ? this._items[i] : obj), ...e.detail.value });
          this._sent();
          send();
        });
        body.appendChild(form);
        for (const entry of nested) {
          const ne = document.createElement("savvy-list-editor");
          ne.hass = this._hass;
          ne.setup(entry, obj[entry.name], obj);
          ne.addEventListener("list-changed", (e) => {
            e.stopPropagation();
            this._items[i] = cleanConfig({ ...(typeof this._items[i] === "object" ? this._items[i] : obj), [entry.name]: e.detail.items });
            this._sent();
            send();
          });
          body.appendChild(ne);
        }
        row.appendChild(body);
        list.appendChild(row);
        return;
      }
      list.appendChild(row);
    });
    // add: an entity picker (or whatever selector the spec asks for)
    const add = root.querySelector(".sv-add");
    if (spec.addButton) {
      const b = document.createElement("button");
      b.className = "sv-prefill";
      b.textContent = spec.addButton.label || "Add";
      b.addEventListener("click", () => { this._items.push(spec.addButton.make(this._items)); this._openIdx = this._items.length - 1; this._emit(); });
      add.appendChild(b);
      return;
    }
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
// the cards with a state they can glow in (the shared option, last in their form)
const GLOW_CARDS = new Set(["savvy-lights-card", "savvy-climate-card", "savvy-media-card", "savvy-vacuum-card", "savvy-entity-card", "savvy-lock-card",
  "savvy-room-tile", "savvy-room-activity-card", "savvy-system-health-card"]);
const GLOW_FIELD = { name: "state_glow", label: "State glow", helper: "A soft glow in the card's corner in what it is doing. Off keeps the card plain.", selector: { boolean: {} }, default: true };

const defineEditor = (type, schemaFn, tidy) => {
  const name = `${type}-editor`;
  if (!customElements.get(name)) {
    customElements.define(name, class extends SavvyEditor {
      get cardType() { return type; }
      schema(hass, config) { const s = schemaFn(hass, config); return GLOW_CARDS.has(type) ? [...s, GLOW_FIELD] : s; }
      tidy(config) { return tidy ? tidy(config) : config; }
    });
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
  action: (name, label, helper) => ({ name, label, ...(helper ? { helper } : {}), selector: { ui_action: {} } }),
  // HA's own page picker: every dashboard and view, or a path typed in
  nav: (name, label, helper) => ({ name, label, helper, selector: { navigation: {} } }),
  // the title and its link, on every card: the name a card already shows becomes the link; a card with no name gets a title line
  titleLink: (what = "name") => ({ name: "title_path", label: "Title link", helper: `Tapping the ${what} opens this page. Off by default.`, selector: { navigation: {} } }),
  titleLine: () => ({ name: "title", label: "Title", helper: "A line at the top of the card. Empty: none.", selector: { text: {} } }),
  color: (name = "color", label = "Colour") => ({ name, label, selector: { text: {} }, helper: "An HA colour name (blue, amber…) or a hex like #F5B83D" }),
  grid: (...schema) => ({ type: "grid", name: "", schema }),
  section: (label, schema, expanded = false) => ({ type: "expandable", name: "", title: label, expanded, schema }),
  // the one chip spec, as a list editor
  chips: (name = "chips", label = "Custom chips", helper = "Extra entities shown as chips, each with its own actions.") => ({
    name, label, helper, type: "list",
    item: [
      { name: "entity", label: "Entity", selector: { entity: {} } },
      { type: "grid", name: "", schema: [
        { name: "name", label: "Name", selector: { text: {} } },
        { name: "icon", label: "Icon", selector: { icon: {} } },
      ] },
      { name: "color", label: "Colour", selector: { text: {} } },
      { name: "show_state", label: "Show state", selector: { boolean: {} } },
      { name: "tap_action", label: "Tap action", selector: { ui_action: {} } },
      { name: "hold_action", label: "Hold action", selector: { ui_action: {} } },
    ],
  }),
};

// The control's options: the entity, then an icon and a colour for each of its options
// (found from the mode dictionary until set).
const modeSchema = (hass, c, { helper, actions = true } = {}) => {
  const id = controlOf(c).entity;
  const opts = (hass && id && hass.states[id]?.attributes.options) || [];
  return [
    { name: "control", label: "Control", helper: helper || "A select (a house mode, a room's scenes) opens a picker. A button, script or scene runs, a switch toggles, anything else opens more-info.",
      selector: { entity: {} } },
    { name: "mode_label", label: "Caption", helper: "Under a select's value.", selector: { text: {} } },
    ...(actions ? [{ type: "expandable", name: "", title: "Control actions", schema: [
      S.action("control_tap_action", "Tap action"), S.action("control_hold_action", "Hold action"), S.action("control_double_tap_action", "Double tap action"),
    ] }] : []),
    ...(opts.length ? [
      { type: "expandable", name: "mode_icons", title: "Option icons", schema: opts.map((o) => ({ name: o, label: o, selector: { icon: { placeholder: modeLook(o).icon } } })) },
      { type: "expandable", name: "mode_colors", title: "Option colours", schema: opts.map((o) => ({ name: o, label: o, helper: modeLook(o).color || "No colour", selector: { text: {} } })) },
    ] : []),
  ];
};

// The badge row: pinned entities, then what the area has.
const badgeSchema = ({ pinnedLabel = "Pinned", pinnedHelp = "Always shown, first and in this order: a lights helper, presence, a door." } = {}) => [
  S.chips("entities", pinnedLabel, pinnedHelp),
  S.bool("auto_discover", "Auto discover", "Presence and doors always; media, locks, climate, fans, covers, windows, leaks and alarms while active.", true),
  { name: "exclude_kinds", label: "Hide kinds", selector: { select: { multiple: true, options: BADGE_KINDS.map((k) => ({ value: k.key, label: k.name })) } } },
  { name: "include", label: "Include", helper: "Entities to treat as if they were in this area (a lock with no area).", selector: { entity: { multiple: true } } },
  { name: "exclude", label: "Exclude", selector: { entity: { multiple: true } } },
];

// ===== core/95-settings.js =====
// ---------------------------------------------------------------------------------------
// core/settings: the pages, entities and helpers a dashboard repeats on every card, set once
// in a `custom:savvy-settings-card` and picked up by every Savvy card on the dashboard.
//
//   precedence: the card's own config  >  rooms.<area>  >  global settings  >  auto-discovery
//   A value the card sets itself (even `false`) is never replaced. Lists (ignored entities,
//   a room's include / exclude) add to the card's own; a card can switch that off with `false`.
//
// Settings are found by reading the dashboard's own config (`lovelace/config`), so a card on
// any view gets them without the settings card being on its page. The last answer is kept in
// localStorage per dashboard, so repeat loads need no round trip and nothing flashes.
// The settings card on the page publishes its config as it is edited: cards follow live.
// One declarative table (SETTINGS_RULES) says what each card takes; a new key is one line.
// ---------------------------------------------------------------------------------------

const SETTINGS_TYPE = "custom:savvy-settings-card";
const SETTINGS_REFRESH_MS = 5 * 60 * 1000;
const SETTINGS_SECTIONS = ["pages", "house", "health", "ignore", "rooms", "design"];

// What a card can keep from people who are not administrators: the health cog in the home header, and
// the count badge on it. Everyone sees everything unless it is listed. A card can only hide itself: it
// cannot lock a page. A user Home Assistant does not describe (no `hass.user`) counts as an administrator.
const ADMIN_ITEMS = ["health_cog", "health_badges"];
const isAdminUser = (hass) => hass?.user?.is_admin !== false;
function adminOnlyItems(v) {
  if (v === true) return new Set(ADMIN_ITEMS);
  if (!v) return new Set();
  const list = Array.isArray(v) ? v : typeof v === "object" ? Object.keys(v).filter((k) => v[k]) : [v];
  return new Set(list.filter((k) => ADMIN_ITEMS.includes(k)));
}
const hiddenFromUser = (hass, config, item) => !isAdminUser(hass) && adminOnlyItems(config?.admin_only).has(item);

// ---- the table -------------------------------------------------------------------------

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const navTo = (path) => (path ? { action: "navigate", navigation_path: path } : undefined);
const pagePattern = (pattern, x) => (pattern ? String(pattern).replace(/\{area\}/g, x.area || "").replace(/\{slug\}/g, x.slug || "") : undefined);
// a room's own value, else nothing: the source says which room
const room = (key) => (s, c, x) => (x.room?.[key] != null && x.room[key] !== "" ? { v: x.room[key], src: `rooms.${x.area}` } : undefined);
const AUTO = "found automatically";
// a page the settings name; else the dashboard's own view of that name; `false` says there is none
const pageFor = (kind) => (s) => {
  const own = s.pages?.[kind];
  if (own) return { v: own, src: "pages" };
  if (own === false) return undefined;
  const v = SettingsStore.autoPage(kind);
  return v ? { v, src: AUTO } : undefined;
};
const roomPage = (s, c, x) => {
  if (!x.area) return undefined;
  if (x.room?.page) return { v: x.room.page, src: `rooms.${x.area}` };
  const v = pagePattern(s.pages?.room, x);
  if (v) return { v, src: "pages.room" };
  if (s.pages?.room === false) return undefined;
  const a = SettingsStore.autoRoom(x.area);
  return a ? { v: a, src: AUTO } : undefined;
};
const roomPattern = (s) => {
  if (s.pages?.room) return { v: s.pages.room, src: "pages" };
  if (s.pages?.room === false) return undefined;
  const v = SettingsStore.autoRoomPattern();
  return v ? { v, src: AUTO } : undefined;
};
// a card with no order of its own takes the first card of its kind for the same room that has one
const ORDER_CARDS = { "custom:savvy-lights-card": { label: "Lights card", legacy: ["main", "side", "master"] } };
const followOrder = (type) => (s, c, x) => {
  if (!x.area || c.sync_order === false || ORDER_CARDS[type].legacy.some((k) => c[k] !== undefined)) return undefined;
  const m = SettingsStore.orderFor(type, x.area);
  if (!m) return undefined;
  return { v: m.order, src: `read from the ${ORDER_CARDS[type].label} on ${m.where}${m.count > 1 ? `, the first of ${m.count}` : ""}`, unlink: true };
};
const glob = (section, key) => (s) => s[section]?.[key];
// what a room card leaves out: the room's own `exclude` and the global ignore list, one list
const roomExclude = (s, c, x) => {
  if (!x.area) return undefined;                       // a plain title has nothing to discover
  const own = x.room?.exclude, ign = s.ignore?.entities;
  const v = [...asList(own), ...asList(ign)].filter((e) => e != null && e !== "");
  if (!v.length) return undefined;
  return { v, src: asList(ign).length ? "ignore" : `rooms.${x.area}` };
};

const HEALTH_KEYS = [
  ["watchman", "Watchman sensors"], ["battery_threshold", "Battery alert"], ["warn_above", "Red threshold"],
  ["exclude_platforms", "Ignored integrations"], ["group_by", "Grouping"], ["group_min", "Hub threshold"], ["watchman_last_run", "Watchman last run"],
];
const healthRules = (prefix = "") => HEALTH_KEYS.map(([k, label]) => ({ path: `${prefix}${k}`, label, get: glob("health", k), src: "health" }));
// known problems: the settings' list adds to the card's own (devices by id, entities by id)
const knownRules = (prefix = "") => ["entities", "devices"].map((k) => ({ path: `${prefix}ignore.${k}`, label: "Known problems", kind: "union", src: "health",
  get: (s) => (Array.isArray(s.health?.ignore) ? s.health.ignore.filter((x) => (k === "entities") === String(x).includes(".")) : s.health?.ignore?.[k]) }));

// the state glow is on unless the settings turn it off for every card
const glowRule = { path: "state_glow", label: "State glow", get: (s) => (s.design?.state_glow === false ? false : undefined), src: "design" };

const HOME_CHIPS = ["lights", "climate", "media", "security"];

// Each rule fills `path` of the card's config when the card hasn't set it.
//   kind "union": the settings' list is added to the card's own (unless the card says false)
//   kind "pin":   the room's light helper is pinned first in the badge row
const SETTINGS_RULES = {
  "savvy-home-header-card": [
    { path: "aggregate", label: "Aggregate sensors", get: (s) => s.aggregate, src: "aggregate" },
    { path: "admin_only", label: "Admin only", get: (s) => s.admin_only, src: "admin_only" },
    { path: "control", label: "Control", get: glob("house", "control"), src: "house" },
    { path: "weather", label: "Weather", get: glob("house", "weather"), src: "house" },
    { path: "home_path", label: "Home button", get: glob("pages", "home"), src: "pages" },
    ...HOME_CHIPS.flatMap((k) => [
      { path: `${k}.navigation_path`, label: `${cap(k)} page`, get: pageFor(k) },
      // a tap goes to the page and the hold lists, unless the chip already has gestures of its own
      { path: `${k}.tap_action`, label: `${cap(k)} tap`, src: "house",
        get: (s, c) => (s.house?.tap === "navigate" && c[k]?.hold_action === undefined ? navTo(c[k]?.navigation_path ?? pageFor(k)(s)?.v) : undefined) },
      { path: `${k}.exclude`, label: `${cap(k)} ignored`, kind: "union", get: (s) => s.ignore?.entities, src: "ignore" },
      { path: `${k}.exclude_areas`, label: `${cap(k)} ignored rooms`, kind: "union", get: (s) => s.ignore?.areas, src: "ignore" },
      // the card's own room_order covers all four chips; the settings' order fills in under both
      { path: `${k}.room_order`, label: `${cap(k)} room order`, get: (s, c) => (c.room_order !== undefined ? undefined : s.room_order), src: "room_order" },
    ]),
    { path: "security.entity", label: "Security entity", get: glob("house", "security"), src: "house" },
    { path: "health.navigation_path", label: "Health page", get: (s) => s.pages?.health, src: "pages" },
    { path: "health.tap_action", label: "Health tap", src: "house",
      get: (s, c) => (s.house?.tap === "navigate" && c.health?.hold_action === undefined ? navTo(c.health?.navigation_path ?? s.pages?.health) : undefined) },
    ...healthRules("health."),
    ...knownRules("health."),
  ],
  "savvy-system-health-card": [glowRule, ...healthRules(), ...knownRules()],
  "savvy-room-header-card": [
    { path: "aggregate", label: "Aggregate sensors", get: (s) => s.aggregate, src: "aggregate" },
    { path: "control", label: "Control", get: room("control") },
    { path: "temperature", label: "Temperature", get: room("temperature") },
    { path: "include", label: "Include", kind: "union", get: room("include") },
    { path: "exclude", label: "Exclude", kind: "union", get: roomExclude },
    { path: "home_path", label: "Home button", get: glob("pages", "home"), src: "pages" },
    { path: "room_path", label: "Room pages", get: roomPattern },
    // the card's own `order` (the pre-Savvy name) counts as its own
    { path: "room_order", label: "Room order", get: (s, c) => (c.order !== undefined ? undefined : s.room_order), src: "room_order" },
  ],
  "savvy-section-title-card": [
    { path: "aggregate", label: "Aggregate sensors", get: (s) => s.aggregate, src: "aggregate" },
    { path: "name", label: "Name", get: room("name") },
    { path: "icon", label: "Icon", get: room("icon") },
    { path: "control", label: "Control", get: room("control") },
    { path: "temperature", label: "Temperature", get: room("temperature") },
    { path: "include", label: "Include", kind: "union", get: room("include") },
    { path: "exclude", label: "Exclude", kind: "union", get: roomExclude },
    { path: "navigation_path", label: "Target page", get: roomPage },
  ],
  "savvy-room-tile": [
    glowRule,
    { path: "aggregate", label: "Aggregate sensors", get: (s) => s.aggregate, src: "aggregate" },
    { path: "name", label: "Name", get: room("name") },
    { path: "icon", label: "Icon", get: room("icon") },
    { path: "control", label: "Control", get: room("control") },
    { path: "temperature", label: "Temperature", get: room("temperature") },
    { path: "toggle", label: "Light helper", get: (s, c, x) => (c.light_state !== undefined ? undefined : room("light_state")(s, c, x)) },
    { path: "entities", label: "Light badge", kind: "pin", get: room("light_state") },
    { path: "exclude", label: "Exclude", kind: "union", get: roomExclude },
    { path: "navigation_path", label: "Target page", get: roomPage },
  ],
  "savvy-lights-card": [
    glowRule,
    { path: "order", label: "Order", get: followOrder("custom:savvy-lights-card") },
    { path: "exclude", label: "Ignored", kind: "union", get: (s) => s.ignore?.entities, src: "ignore" },
    { path: "toggle", label: "Light helper",
      get: (s, c, x) => {
        if (c.toggle !== undefined || c.master !== undefined) return undefined;
        const r = room("light_state")(s, c, x);
        return r ? { v: { entity: r.v }, src: r.src } : undefined;
      } },
  ],
  "savvy-scene-card": [
    glowRule,
    { path: "exclude", label: "Ignored", kind: "union", get: (s) => s.ignore?.entities, src: "ignore" },
  ],
  "savvy-vacuum-card": [
    glowRule,
    { path: "exclude", label: "Ignored", kind: "union", get: (s) => s.ignore?.entities, src: "ignore" },
  ],
  "savvy-climate-card": [
    glowRule,
    { path: "temperature", label: "Temperature", get: room("temperature") },
    { path: "humidity", label: "Humidity", get: room("humidity") },
  ],
  "savvy-room-activity-card": [
    glowRule,
    { path: "aggregate", label: "Aggregate sensors", get: (s) => s.aggregate, src: "aggregate" },
    { path: "include", label: "Include", kind: "union", get: room("include") },
    { path: "exclude", label: "Exclude", kind: "union", get: roomExclude },
  ],
  "savvy-entity-card": [glowRule],
  "savvy-media-card": [glowRule],
  "savvy-lock-card": [
    glowRule,
    // with no lock named, the settings' security entity is the lock to show
    { path: "entity", label: "Lock", src: "house",
      get: (s, c) => (c.entity !== undefined || c.entities !== undefined || c.area !== undefined || c.areas !== undefined || domainOf(s.house?.security) !== "lock" ? undefined : s.house.security) },
    { path: "include", label: "Include", kind: "union", get: room("include") },
    { path: "exclude", label: "Exclude", kind: "union", get: roomExclude },
  ],
};

// ---- the resolver -----------------------------------------------------------------------

const getPath = (o, p) => p.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
// copy-on-write: only the objects along `p` are copied
function setPath(o, p, v) {
  const ks = p.split("."), root = { ...o };
  let cur = root;
  for (let i = 0; i < ks.length - 1; i++) {
    const next = cur[ks[i]];
    cur[ks[i]] = next && typeof next === "object" ? { ...next } : {};
    cur = cur[ks[i]];
  }
  cur[ks[ks.length - 1]] = v;
  return root;
}
// `lights: false` (or any non-object) below a path: nothing is inherited under it
const blockedPath = (o, p) => {
  const ks = p.split(".");
  let cur = o;
  for (let i = 0; i < ks.length - 1; i++) {
    cur = cur?.[ks[i]];
    if (cur == null) return false;
    if (typeof cur !== "object") return true;
  }
  return false;
};
const asList = (v) => (v == null || v === false ? [] : [].concat(v));
const sameItem = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const unionOf = (add, own) => {
  const out = [...asList(own)];
  for (const v of asList(add)) if (!out.some((o) => sameItem(o, v))) out.unshift(v);
  return out;
};

// The area a card is about, when it is about exactly one.
function settingsArea(cfg, s) {
  let a = cfg.area ?? cfg.areas;
  if (Array.isArray(a)) a = a.length === 1 ? a[0] : null;
  if (typeof a !== "string" || !a) return {};
  return { area: a, slug: a.replace(/_/g, "-"), room: s.rooms?.[a] || null };
}

const showValue = (v) => {
  if (Array.isArray(v)) return v.map(showValue).join(", ");
  if (v && typeof v === "object") return v.action ? `${v.action}${v.navigation_path ? ` to ${v.navigation_path}` : ""}` : v.entity ? v.entity : JSON.stringify(v);
  return String(v);
};

// resolveSettings(type, cfg, settings) -> { config, inherited: [{ path, label, value, from }] }
function resolveSettings(type, cfg, settings) {
  const rules = SETTINGS_RULES[type];
  if (!rules || !cfg || typeof cfg !== "object") return { config: cfg, inherited: [] };
  settings = settings || {};         // the dashboard's own pages and orders count even with no settings card
  const x = settingsArea(cfg, settings);
  let out = cfg;
  const inherited = [];
  for (const r of rules) {
    const got = r.get(settings, cfg, x);
    if (got === undefined || got === null) continue;
    const { v, src, unlink } = typeof got === "object" && !Array.isArray(got) && "v" in got ? got : { v: got, src: r.src };
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
    if (blockedPath(cfg, r.path)) continue;
    const own = getPath(cfg, r.path);
    if (r.kind === "union") {
      if (own === false) continue;
      const merged = unionOf(v, own);
      if (merged.length === asList(own).length) continue;
      out = setPath(out, r.path, merged);
    } else if (r.kind === "pin") {
      if (own === false) continue;
      const have = asList(own);
      if (have.some((e) => (e && e.entity) === v || e === v)) continue;
      out = setPath(out, r.path, [{ entity: v, name: "Light", icon: "mdi:light-switch" }, ...have]);
    } else {
      if (own !== undefined && own !== null) continue;
      out = setPath(out, r.path, v);
    }
    inherited.push({ path: r.path, label: r.label, value: showValue(v), from: src, ...(unlink ? { unlink: true, raw: v } : {}) });
  }
  return { config: out, inherited };
}

// ---- the store --------------------------------------------------------------------------

// the dashboard this page belongs to: /lovelace/home is the default dashboard (url_path null)
function dashboardPath() {
  const seg = (location.pathname || "").split("/").filter(Boolean)[0];
  return !seg || seg === "lovelace" ? null : seg;
}

function findSettingsCards(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => findSettingsCards(n, out));
  else if (node && typeof node === "object") {
    if (node.type === SETTINGS_TYPE) out.push(node);
    else for (const v of Object.values(node)) if (v && typeof v === "object") findSettingsCards(v, out);
  }
  return out;
}

// only the known sections, and only what is filled in
function normalizeSettings(config) {
  if (!config || typeof config !== "object") return null;
  const out = {};
  for (const k of SETTINGS_SECTIONS) {
    const v = config[k];
    if (v && typeof v === "object" && Object.keys(v).length) out[k] = v;
  }
  // one room order for every card that lists rooms
  if (Array.isArray(config.room_order)) {
    const order = config.room_order.filter((a) => typeof a === "string" && a);
    if (order.length) out.room_order = order;
  }
  // which kinds of sensor each room shows once (true: presence)
  const agg = aggKinds(config.aggregate);
  if (agg.length) out.aggregate = agg;
  // what only administrators see (true: everything that can be kept)
  const admin = [...adminOnlyItems(config.admin_only)];
  if (admin.length) out.admin_only = admin;
  return Object.keys(out).length ? out : null;
}

// ---- what the dashboard itself says: its views, and the orders its cards were given -----------

const slugOf = (v) => String(v ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
const DOMAIN_PAGES = { lights: ["lights", "lighting", "light"], climate: ["climate"], media: ["media"], security: ["security"] };

// the dashboard's views that can be opened by name
function collectViews(conf) {
  return (Array.isArray(conf?.views) ? conf.views : [])
    .filter((v) => v && typeof v.path === "string" && v.path)
    .map((v) => ({ path: v.path, title: typeof v.title === "string" ? v.title : "" }));
}

// the one view a name belongs to: by its path first, else by its title. Two different views: no guess.
function findView(views, names) {
  const want = new Set(names.map(slugOf).filter(Boolean));
  if (!want.size) return null;
  for (const by of ["path", "title"]) {
    const hit = [...new Set(views.filter((v) => want.has(slugOf(v[by]))).map((v) => v.path))];
    if (hit.length === 1) return hit[0];
    if (hit.length > 1) return null;
  }
  return null;
}
const viewUrl = (path) => `/${(location.pathname || "").split("/").filter(Boolean)[0] || "lovelace"}/${path}`;

// per card kind and room, the first card (in the dashboard's own order) that has an order of its own
function collectOrders(conf) {
  const out = {};
  (Array.isArray(conf?.views) ? conf.views : []).forEach((view, vi) => {
    const where = view?.title || view?.path || `view ${vi + 1}`;
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      const o = ORDER_CARDS[node.type];
      if (o && Array.isArray(node.order) && node.order.length) {
        let a = node.area ?? node.areas;
        if (Array.isArray(a)) a = a.length === 1 ? a[0] : null;
        if (typeof a === "string" && a) {
          const key = `${node.type}|${a}`;
          if (out[key]) out[key].count++;
          else out[key] = { order: node.order.filter((e) => typeof e === "string"), where, count: 1 };
        }
      }
      for (const v of Object.values(node)) if (v && typeof v === "object") walk(v);
    };
    walk(view);
  });
  return out;
}

// how many values are set: what the settings card reports as "defaults"
function countDefaults(s) {
  let n = 0;
  const walk = (v) => {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) return;
    if (v && typeof v === "object" && !Array.isArray(v)) Object.values(v).forEach(walk);
    else n++;
  };
  walk(s);
  return n;
}

const SettingsStore = {
  settings: null,
  found: 0,
  views: [],            // the dashboard's views with a path
  orders: {},           // `type|area` -> the first card's order
  live: null,           // the settings card on this page that publishes while it is edited
  hass: null,
  cards: new Set(),
  subs: new Set(),
  _path: undefined,
  _fetched: false,
  _fetchedAt: 0,
  _seeing: false,
  _tick: 0,

  _key: () => `savvy:settings:${dashboardPath() || "default"}`,
  _readCache() {
    try {
      const v = JSON.parse(localStorage.getItem(this._key()) || "null");
      return v && typeof v === "object" ? v : null;
    } catch (err) { return null; }
  },
  _writeCache() {
    try {
      if (this.settings || this.views.length || Object.keys(this.orders).length) {
        localStorage.setItem(this._key(), JSON.stringify({ settings: this.settings, found: this.found, views: this.views, orders: this.orders }));
      } else localStorage.removeItem(this._key());
    } catch (err) { /* storage can be blocked: the cards still work from the fetch */ }
  },

  // the page can move between dashboards without a reload: follow it
  _sync() {
    const p = dashboardPath();
    if (this._path === p) return;
    this._path = p;
    this._fetched = false;
    this.live = null;
    const c = this._readCache();
    this.settings = c?.settings || null;
    this.found = c?.found || 0;
    this.views = Array.isArray(c?.views) ? c.views : [];
    this.orders = c?.orders && typeof c.orders === "object" ? c.orders : {};
  },

  // what the dashboard says about itself changed: its views and the orders its cards hold
  setDashboard(views, orders) {
    if (JSON.stringify(views) === JSON.stringify(this.views) && JSON.stringify(orders) === JSON.stringify(this.orders)) return false;
    this.views = views;
    this.orders = orders;
    return true;
  },

  // pages found by name, for the cards that would otherwise need them written down
  autoPage(kind) {
    const p = DOMAIN_PAGES[kind] && findView(this.views, DOMAIN_PAGES[kind]);
    return p ? viewUrl(p) : undefined;
  },
  autoRoom(area) {
    const p = findView(this.views, [area, this.hass?.areas?.[area]?.name]);
    return p ? viewUrl(p) : undefined;
  },
  // `/lovelace/{slug}` when the dashboard's views carry the rooms' names (with dashes, else with underscores)
  autoRoomPattern() {
    const ids = Object.keys(this.hass?.areas || {});
    if (!ids.length || !this.views.length) return undefined;
    const paths = new Set(this.views.map((v) => v.path));
    const dashed = ids.filter((a) => paths.has(a.replace(/_/g, "-"))).length, plain = ids.filter((a) => a.includes("_") && paths.has(a)).length;
    const base = viewUrl("").replace(/\/$/, "");
    if (dashed >= plain && dashed > 0) return `${base}/{slug}`;
    return plain > 0 ? `${base}/{area}` : undefined;
  },
  orderFor(type, area) { return this.orders[`${type}|${area}`] || null; },
  // every page this dashboard gave a name to: what the settings card lists
  autoPages() {
    const out = {};
    for (const k of Object.keys(DOMAIN_PAGES)) { const v = this.autoPage(k); if (v) out[k] = v; }
    const room = this.autoRoomPattern();
    if (room) out.room = room;
    return out;
  },

  subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); },
  _emit() {
    for (const fn of [...this.subs]) { try { fn(); } catch (err) { /* a listener must not break the others */ } }
  },
  _changed() {
    this._emit();
    for (const card of [...this.cards]) {
      if (!card.isConnected) { this.cards.delete(card); continue; }
      card._onSettings?.();
    }
    this._statsSoon();
  },
  // the settings card's counts follow what cards inherit; coalesced
  _statsSoon() {
    if (this._tick) return;
    this._tick = setTimeout(() => { this._tick = 0; this._emit(); }, 0);
  },

  set(next, found) {
    const same = JSON.stringify(next) === JSON.stringify(this.settings);
    this.found = found ?? this.found;
    if (same) return;
    this.settings = next;
    this._writeCache();
    this._changed();
  },

  // a card on this page: remembered so a change reaches it, and counted
  register(card) {
    this._sync();
    this.cards.add(card);
  },
  consumers() {
    let n = 0;
    for (const card of this.cards) if (card.isConnected && card._inherited?.length) n++;
    return n;
  },
  stats() { return { defaults: countDefaults(this.settings), consumers: this.consumers(), found: this.found }; },

  // the settings card on the page says what it holds, edited or not
  publish(card, config) {
    this._sync();
    this.live = card;
    this.set(normalizeSettings(config), Math.max(this.found, 1));
  },
  unpublish(card) {
    if (this.live !== card) return;
    this.live = null;
    this._fetch();
  },

  // every card hands over hass; the dashboard is read once per page load
  load(hass) {
    this._sync();
    this.hass = hass;
    if (this._fetched || !hass?.callWS) return;
    this._fetched = true;
    this._fetch().then(() => this._watch());
  },
  async _fetch() {
    const hass = this.hass;
    if (!hass?.callWS) return;
    let conf;
    try { conf = await hass.callWS({ type: "lovelace/config", url_path: dashboardPath() }); }
    catch (err) { return; }                   // no access, or not a dashboard: keep what we have
    if (!conf || typeof conf !== "object") return;
    this._fetchedAt = Date.now();
    const cards = findSettingsCards(conf);
    const dash = this.setDashboard(collectViews(conf), collectOrders(conf));
    // the settings card on this page is the freshest source while it is there
    if (this.live) {
      this.found = Math.max(cards.length, 1);
      if (dash) { this._writeCache(); this._changed(); } else this._statsSoon();
      return;
    }
    this.set(normalizeSettings(cards[0]), cards.length);
    if (dash) { this._writeCache(); this._changed(); }
    this._statsSoon();
  },
  _watch() {
    if (this._seeing || typeof document === "undefined") return;
    this._seeing = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && Date.now() - this._fetchedAt > SETTINGS_REFRESH_MS) this._fetch();
    });
  },

  // test pages reset it between runs
  reset() {
    this.settings = null; this.found = 0; this.views = []; this.orders = {}; this.live = null; this.hass = null; this.cards.clear(); this.subs.clear();
    this._path = undefined; this._fetched = false; this._fetchedAt = 0;
  },
};

// Every card with rules goes through here (registerCard): its setConfig receives the card's
// config with the settings filled in, and a change in the settings re-runs it, only when
// what the card would see really changed.
// A card with `aggregate` sees each room's sensors of those kinds once. What it leaves out
// (`exclude`, a chip's `exclude`, ignored rooms) is never merged.
function aggregateFor(config, hass) {
  if (!config?.aggregate) return hass;
  const chips = ["lights", "climate", "media", "security"].map((k) => config[k]).filter((c) => c && typeof c === "object");
  const list = (key) => [config[key], ...chips.map((c) => c[key])].flatMap((x) => asItems(x).map((i) => i.entity || i)).filter((x) => typeof x === "string");
  return aggregateHass(hass, { kinds: config.aggregate, exclude: list("exclude"), excludeAreas: list("exclude_areas") });
}

function wireSettings(type, cls) {
  if (!SETTINGS_RULES[type] || cls.prototype.__settingsWired) return;
  const proto = cls.prototype, original = proto.setConfig;
  proto.__settingsWired = true;
  proto.setConfig = function (config) {
    SettingsStore.register(this);
    this._rawConfig = config;
    const r = resolveSettings(type, config, SettingsStore.settings);
    this._inherited = r.inherited;
    this._appliedKey = JSON.stringify(r.config);
    const out = original.call(this, r.config);
    SettingsStore._statsSoon();
    return out;
  };
  proto._onSettings = function () {
    if (!this._rawConfig) return;
    const r = resolveSettings(type, this._rawConfig, SettingsStore.settings);
    this._inherited = r.inherited;
    const key = JSON.stringify(r.config);
    if (key === this._appliedKey) return;
    this._appliedKey = key;
    original.call(this, r.config);
    if (this.__rawHass) this.hass = this.__rawHass;
  };
  const d = Object.getOwnPropertyDescriptor(proto, "hass");
  if (d?.set) {
    Object.defineProperty(proto, "hass", { ...d, set(v) {
      SettingsStore.load(v);
      this.__rawHass = v;
      d.set.call(this, aggregateFor(this._config, v));
    } });
  }
}

// ===== core/99-test-hook.js =====
// ---------------------------------------------------------------------------------------
// core/test-hook: test pages set window.__SAVVY_TEST__ before loading the bundle to reach
// core functions directly. Real dashboards never set it, so nothing is exposed there.
// ---------------------------------------------------------------------------------------
if (window.__SAVVY_TEST__) {
  window.__savvy = {
    Spring, Clock, MOTION, Motion, attr, text, put, place, norm, title, modeLook, MODE_DICTIONARY, colorOf,
    healthSummary, healthOptions, dismissStore, ensureDismissed, resetDismissed, dismissAdd, dismissRestore, isAdminUser, adminOnlyItems, hiddenFromUser, refreshConfigEntries, resetConfigEntries, areaEntities, houseEntities, pick, rankBy, entityArea, shortName, asItems,
    isActive, isOff, runAction, defaultTapAction, toggleEntity, bindPress, bindActions,
    duration, since, relativeTime, axisLabel, momentLabel, fmtNumber, withUnit, isTimestamp,
    fetchHistory, fetchRange, fetchAttributeHistory, resample, seriesStats, stateRuns, numericPoints, linePath,
    entityIcon, fallbackIcon, NEUTRAL_ICON, offLast, Sheet, EntityListSheet, SavvyEditor, defineEditor, S, version: SAVVY_VERSION,
    SettingsStore, SETTINGS_RULES, resolveSettings, findSettingsCards, normalizeSettings, countDefaults, dashboardPath, SavvyCard, roomBadges, roomTemperature, areaLights, houseLights, housePlaying, houseTemperature, houseSecurity, ignoring, sortRows, RowKit, SideBar, Seg, Stepper, LockSlide, aggregateHass, aggKinds, AGG_TARGET, ROW_KINDS, modeInfo, legacyBadges, chipState, portalRoot, navigate, samePage, securityAlertWord,
  };
}

// ===== cards/camera.js =====
(() => {
// savvy-camera-card: live cameras, and Frigate's recordings when the cameras come from it.
//
// Layout follows the card's width (a camera per ~380px, or `columns:`):
//   pager   one camera at a time, swipe between them; playback keeps its moment when you
//           swipe, so the same second can be seen from another angle
//   grid    every camera side by side, all live; playback is synced: the timeline, a
//           review, play / pause and the seek bar drive every camera at once
//
// `area` finds the room's cameras (or list them in `cameras`). Frigate turns itself on
// when the cameras come from the Frigate integration (`frigate: false` turns it off,
// `frigate: { instance: … }` names another instance). Through Home Assistant's own APIs:
//   reviews    frigate/reviews/get (alerts, detections), else frigate/events/get
//   activity   frigate/recordings/get: every segment's motion score is the activity graph
//   playback   Frigate's HLS playlist where the browser plays HLS (Safari, iOS), else the
//              MP4 the integration cuts; URLs signed with auth/sign_path
//
//   type: custom:savvy-camera-card
//   area: living_room                 recordings: popup | inline | false
//   audio_button: false               hides the speaker button (shown only when the stream has sound; always starts muted)

const DAY = 86400;
const TILE_MIN = 380;         // px of card width per camera before the grid adds a column
const REFRESH_MS = 60000;     // today's reviews/activity, while on screen
const SUMMARY_MS = 600000;
const SIGN_TTL = 3600;
const PAD_S = 3;              // seconds of context either side of a review
const DRIFT_S = 0.45;         // synced playback: re-align a camera further off than this
const BUCKETS = 288;          // activity graph: 5-minute buckets

const MOTION = {
  press:   { response: 0.12, damping: 1 },
  release: { response: 0.3,  damping: 0.82 },
  ui:      { response: 0.4,  damping: 1 },
  pager:   { response: 0.42, damping: 0.86 },
  pill:    { response: 0.34, damping: 0.82 },
  scrub:   { response: 0.1,  damping: 1 },
  drag:    { response: 0.34, damping: 1 },
  graph:   { response: 0.7,  damping: 1 },
  sheetIn:  { response: 0.38, damping: 0.82 },
  sheetOut: { response: 0.24, damping: 1 },
};

const COLORS = { live: TONE.bad, alert: TONE.bad, detection: TONE.warn };

const LABEL_ICONS = {
  person: "mdi:account", car: "mdi:car", motorcycle: "mdi:motorbike", bicycle: "mdi:bicycle",
  dog: "mdi:dog", cat: "mdi:cat", bird: "mdi:bird", package: "mdi:package-variant-closed",
  face: "mdi:face-recognition", license_plate: "mdi:card-text-outline", speech: "mdi:account-voice",
};



const pad2 = (n) => String(n).padStart(2, "0");
const hhmm = (s) => { const d = new Date(s * 1000); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const mmss = (s) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${pad2(m)}:${pad2(x)}` : `${m}:${pad2(x)}`;
};
const span = (s) => {
  const m = Math.round(s / 60);
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
};
const dayStart = (offset) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offset);
  return d.getTime() / 1000;
};
const ymd = (s) => { const d = new Date(s * 1000); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const nowS = () => Date.now() / 1000;
const parseWS = (r) => (typeof r === "string" ? JSON.parse(r) : r) || [];

const STYLE = `
:host {
  display: block; -webkit-tap-highlight-color: transparent;
  /* repeated here from ha-card so the recordings popup, which lives outside it, matches */
  --well: color-mix(in oklab, var(--primary-text-color) 6%, transparent);
  --line: color-mix(in oklab, var(--primary-text-color) 9%, transparent);
  --live: ${COLORS.live};
  --alert-c: ${COLORS.alert};
  --det-c: ${COLORS.detection};
  --accent: 88 142 233;
}
[hidden] { display: none !important; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; }

ha-card {
  --radius: var(--ha-card-border-radius, 18px);
  --pad: 12px;
  --well: color-mix(in oklab, var(--primary-text-color) 6%, transparent);
  --line: color-mix(in oklab, var(--primary-text-color) 9%, transparent);
  --live: ${COLORS.live};
  --alert-c: ${COLORS.alert};
  --det-c: ${COLORS.detection};
  --accent: 88 142 233;
  position: relative;
  box-sizing: border-box;
  display: flex; flex-direction: column; gap: 10px;
  padding: var(--pad);
  border-radius: var(--radius);
  border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--line));
  background: var(--ha-card-background, var(--card-background-color));
  box-shadow: var(--ha-card-box-shadow, none);
  color: var(--primary-text-color);
  font-family: var(--camera-card-font-family, system-ui, -apple-system, BlinkMacSystemFont,
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
  content: ""; position: absolute; inset: 0; z-index: 9;
  border-radius: inherit; corner-shape: inherit;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.05);
  pointer-events: none;
}

/* ---------- stage: pager (one camera) or grid (all cameras) ---------- */
.stage { position: relative; user-select: none; -webkit-user-select: none; }
:host(:not([grid])) .stage {
  overflow: hidden; border-radius: calc(var(--radius) * 0.72); aspect-ratio: var(--ar, 16 / 9);
  background: #000; touch-action: pan-y;
}
:host(:not([grid])) .track { position: absolute; inset: 0; display: flex; will-change: transform; }
:host(:not([grid])) .tile { flex: 0 0 100%; height: 100%; }
:host([grid]) .stage { display: flex; flex-direction: column; gap: 8px; }
:host([grid]) .track { display: grid; grid-template-columns: repeat(var(--cols, 2), minmax(0, 1fr)); gap: 8px; }
:host([grid]) .tile { aspect-ratio: var(--ar, 16 / 9); border-radius: calc(var(--radius) * 0.72); }
@supports (corner-shape: squircle) {
  :host(:not([grid])) .stage, :host([grid]) .tile { corner-shape: squircle; border-radius: calc(var(--radius) * 1.2); }
}

.tile { position: relative; overflow: hidden; background: #111; color: #fff; transform-origin: 50% 50%; }
.tile img.still, .tile .live, .tile ha-camera-stream {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block;
}
.tile ha-camera-stream { --video-max-height: 100%; }
.tile .ph {
  position: absolute; inset: 0; display: grid; place-items: center; gap: 6px; align-content: center;
  color: rgb(255 255 255 / 0.55); font-size: 12px; font-weight: 550; --mdc-icon-size: 28px;
}
.player { position: absolute; inset: 0; background: #000; }
.player video { width: 100%; height: 100%; object-fit: contain; display: block; }

.shade-top, .shade-bot { position: absolute; left: 0; right: 0; pointer-events: none; }
.shade-top { top: 0; height: 64px; background: linear-gradient(rgb(0 0 0 / 0.45), transparent); }
.shade-bot { bottom: 0; height: 84px; background: linear-gradient(transparent, rgb(0 0 0 / 0.62)); }

.tl-row { position: absolute; top: 10px; left: 10px; right: 10px; display: flex; align-items: center; gap: 6px; pointer-events: none; }
.badge {
  display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px; border-radius: 8px;
  background: rgb(0 0 0 / 0.42); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  font-size: 11px; line-height: 13px; font-weight: 650; letter-spacing: 0.05em; text-transform: uppercase;
  white-space: nowrap; --mdc-icon-size: 14px; min-width: 0;
}
.badge .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--live); box-shadow: 0 0 0 3px rgb(224 102 102 / 0.28); flex: none; }
.badge .pi { display: none; }
.badge[data-mode="play"] { text-transform: none; letter-spacing: -0.003em; font-size: 12px; padding-left: 6px; }
.badge[data-mode="play"] .pi { display: flex; }
.badge[data-mode="play"] .dot { display: none; }
.det { background: color-mix(in oklab, var(--det-c) 78%, black); }
.spacer { flex: 1; }

.bot-row {
  position: absolute; left: 12px; right: 8px; bottom: 9px; display: flex; align-items: flex-end; gap: 8px;
  pointer-events: none;
}
.who { flex: 1; min-width: 0; display: flex; flex-direction: column; text-shadow: 0 1px 2px rgb(0 0 0 / 0.4); }
.who b { font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.who span { font-size: 12px; line-height: 16px; font-weight: 500; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
:host(:not([grid])) .tile[data-playing] .bot-row { display: none; }
.dots { position: absolute; left: 50%; top: 19px; transform: translateX(-50%); display: flex; gap: 5px; pointer-events: none; }
.dots i { width: 6px; height: 6px; border-radius: 50%; background: rgb(255 255 255 / 0.4); }
.dots i[data-on] { background: #fff; }
:host([grid]) .dots, :host([playing]) .dots { display: none; }
.iconbtn[hidden] { display: none; }
.iconbtn {
  pointer-events: auto; width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center;
  background: rgb(0 0 0 / 0.38); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  --mdc-icon-size: 19px; color: #fff; flex: none; transform-origin: 50% 50%;
}

.msg {
  position: absolute; inset: 0; display: grid; place-items: center; align-content: center; gap: 8px;
  text-align: center; padding: 14px 16px 56px; font-size: 13px; line-height: 17px; font-weight: 550; color: rgb(255 255 255 / 0.88);
  background: rgb(0 0 0 / 0.55); --mdc-icon-size: 26px;
}
:host([grid]) .msg { padding-bottom: 14px; }
.msg .mt { max-width: 34ch; }
.msgd { max-width: 44ch; font-size: 11px; line-height: 14px; font-weight: 500; color: rgb(255 255 255 / 0.6);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; user-select: text; -webkit-user-select: text; }

/* playback controls: overlaid in the pager, their own row under the grid */
.ctrl {
  position: absolute; left: 8px; right: 8px; bottom: 8px; height: 40px; box-sizing: border-box; z-index: 2;
  display: flex; align-items: center; gap: 8px; padding: 0 6px 0 4px; border-radius: 13px; color: #fff;
  background: rgb(0 0 0 / 0.5); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
}
:host([grid]) .ctrl { position: static; background: var(--well); color: var(--primary-text-color); backdrop-filter: none; -webkit-backdrop-filter: none; }
.snd[data-on] { background: rgb(255 255 255 / 0.24); }
.ctrl .snd[data-on] { background: color-mix(in oklab, currentColor 16%, transparent); }
.ctrl .iconbtn { background: none; backdrop-filter: none; -webkit-backdrop-filter: none; width: 32px; height: 32px; color: inherit; }
.bar { position: relative; flex: 1; height: 28px; display: flex; align-items: center; cursor: pointer; touch-action: none; }
.bar .rail { position: absolute; left: 0; right: 0; height: 4px; border-radius: 2px; background: color-mix(in oklab, currentColor 25%, transparent); overflow: hidden; }
.bar .fill { position: absolute; left: 0; top: 0; bottom: 0; width: 100%; background: currentColor; transform-origin: 0 50%; }
.bar .knob { position: absolute; left: 0; width: 12px; height: 12px; margin-left: -6px; border-radius: 50%; background: currentColor; box-shadow: 0 1px 3px rgb(0 0 0 / 0.4); }
.ctime { font-size: 12px; line-height: 16px; font-weight: 600; white-space: nowrap; min-width: 34px; text-align: end; }
.sync { font-size: 11px; line-height: 13px; font-weight: 650; letter-spacing: 0.05em; text-transform: uppercase; opacity: 0.7; white-space: nowrap; }
.livebtn {
  height: 28px; padding: 0 10px; border-radius: 9px; display: flex; align-items: center; gap: 6px;
  background: color-mix(in oklab, currentColor 16%, transparent); font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
  pointer-events: auto; transform-origin: 50% 50%; flex: none;
}
.livebtn .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--live); }

/* ---------- camera picker (pager only) ---------- */
.pills { position: relative; display: flex; gap: 2px; padding: 3px; border-radius: 13px; background: var(--well); }
:host([grid]) .pills { display: none; }
.pills .ind {
  position: absolute; top: 3px; bottom: 3px; left: 0; border-radius: 10px; pointer-events: none;
  background: var(--card-background-color, #fff);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.12), 0 0 0 0.5px var(--line);
}
:host([dark]) .pills .ind { background: color-mix(in oklab, var(--primary-text-color) 14%, transparent); box-shadow: none; }
.pill {
  position: relative; flex: 1 1 0; min-width: 0; height: 30px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  font-size: 12.5px; line-height: 16px; font-weight: 600; letter-spacing: -0.006em;
  color: var(--secondary-text-color); --mdc-icon-size: 16px; white-space: nowrap;
}
.pill span { overflow: hidden; text-overflow: ellipsis; }
.pill[aria-selected="true"] { color: var(--primary-text-color); }

/* ---------- timeline ---------- */
.tlhead { display: flex; align-items: center; gap: 4px; min-width: 0; }
.step {
  width: 30px; height: 30px; border-radius: 10px; display: grid; place-items: center;
  --mdc-icon-size: 20px; color: var(--primary-text-color); transform-origin: 50% 50%;
}
.step[disabled] { opacity: 0.3; cursor: default; }
.dayname { font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; min-width: 0; white-space: nowrap; }
.daysum { flex: 1; text-align: end; font-size: 12px; line-height: 16px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.tl { position: relative; height: 44px; cursor: pointer; touch-action: none; border-radius: 11px; background: var(--well); outline-offset: 2px; }
.tl .hours { position: absolute; inset: 0; display: flex; border-radius: inherit; overflow: hidden; }
.tl .hours i { flex: 1; border-inline-start: 1px solid color-mix(in oklab, var(--primary-text-color) 5%, transparent); }
.tl .hours i:first-child { border: 0; }
.tl .hours i[data-norec] {
  background: repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in oklab, var(--primary-text-color) 7%, transparent) 4px 5px);
}
.tl .act { position: absolute; left: 0; right: 0; bottom: 0; height: 100%; width: 100%; border-radius: 0 0 11px 11px; overflow: hidden; pointer-events: none; }
.tl .act path { fill: color-mix(in oklab, var(--primary-text-color) 22%, transparent); }
.tl .future { position: absolute; top: 0; bottom: 0; right: 0; border-radius: 0 11px 11px 0;
  background: var(--card-background-color, transparent); opacity: 0.55; }
.tl .marks { position: absolute; inset: 6px 0 auto; height: 10px; }
.tl .mk { position: absolute; top: 0; height: 10px; min-width: 4px; margin-left: -2px; border-radius: 3px; background: var(--det-c); }
.tl .mk[data-sev="alert"] { background: var(--alert-c); }
.tl .mk[data-dim] { opacity: 0.2; }
.tl .ph { position: absolute; top: -3px; bottom: -3px; left: 0; width: 2px; margin-left: -1px; border-radius: 1px; background: var(--primary-text-color); pointer-events: none; opacity: 0; }
.tl .now { position: absolute; top: 4px; bottom: 4px; width: 2px; margin-left: -1px; border-radius: 1px; background: var(--live); pointer-events: none; }
.tl .bubble {
  position: absolute; bottom: calc(100% + 6px); left: 0; transform: translateX(-50%);
  padding: 3px 8px; border-radius: 8px; white-space: nowrap; pointer-events: none; opacity: 0;
  font-size: 12px; line-height: 16px; font-weight: 650;
  background: color-mix(in oklab, var(--card-background-color, canvas) 80%, var(--primary-text-color) 20%);
  box-shadow: 0 2px 6px rgb(0 0 0 / 0.2);
}
.axis { display: flex; justify-content: space-between; margin-top: -6px; padding: 0 2px;
  font-size: 10.5px; line-height: 13px; font-weight: 550; letter-spacing: 0.006em; color: var(--secondary-text-color); }
.axis i { font-style: normal; }
.legend { display: flex; gap: 12px; margin-top: -4px; font-size: 11px; line-height: 13px; font-weight: 550; color: var(--secondary-text-color); }
.legend span { display: flex; align-items: center; gap: 5px; }
.legend i { width: 10px; height: 6px; border-radius: 2px; }
.legend .l-a { background: var(--alert-c); }
.legend .l-d { background: var(--det-c); }
.legend .l-m { background: color-mix(in oklab, var(--primary-text-color) 30%, transparent); }

/* ---------- reviews ---------- */
.filters, .reviews {
  display: flex; gap: 6px; min-width: 0; overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain;
  padding: 3px; margin: -3px;
}
.filters::-webkit-scrollbar, .reviews::-webkit-scrollbar { display: none; }
.filters[data-overflow], .reviews[data-overflow] {
  mask-image: linear-gradient(to left, transparent 0, #000 26px);
  -webkit-mask-image: linear-gradient(to left, transparent 0, #000 26px);
}
.chip {
  flex: none; height: 30px; padding: 0 11px 0 9px; border-radius: 10px; display: flex; align-items: center; gap: 5px;
  background: var(--well); font-size: 12.5px; line-height: 16px; font-weight: 600; letter-spacing: -0.006em;
  color: var(--secondary-text-color); --mdc-icon-size: 16px; white-space: nowrap; transform-origin: 50% 50%;
}
.chip[aria-pressed="true"] { background: color-mix(in oklab, var(--primary-text-color) 14%, transparent); color: var(--primary-text-color); }
.chip .n { font-weight: 500; opacity: 0.7; }

.rv { flex: none; width: 132px; display: flex; flex-direction: column; gap: 5px; text-align: start; transform-origin: 50% 50%; }
.rv .th {
  position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 11px; overflow: hidden;
  background: var(--well); display: grid; place-items: center; --mdc-icon-size: 22px; color: var(--secondary-text-color);
}
.rv .th img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.rv[data-active] .th { box-shadow: 0 0 0 2px var(--primary-text-color); }
.rv .lbl {
  position: absolute; left: 5px; bottom: 5px; height: 20px; padding: 0 6px 0 4px; border-radius: 6px;
  display: flex; align-items: center; gap: 3px; color: #fff; background: rgb(0 0 0 / 0.5);
  font-size: 11px; font-weight: 650; --mdc-icon-size: 13px;
}
.rv .new { position: absolute; top: 6px; right: 6px; width: 8px; height: 8px; border-radius: 50%; background: var(--det-c); box-shadow: 0 0 0 2px rgb(0 0 0 / 0.35); }
.rv[data-sev="alert"] .new { background: var(--alert-c); }
.rv .meta { display: flex; gap: 6px; font-size: 12px; line-height: 16px; font-weight: 600; letter-spacing: -0.003em; min-width: 0; }
.rv .meta .d { font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.note { font-size: 12px; line-height: 16px; font-weight: 500; color: var(--secondary-text-color); padding: 2px; }

:host(:not([kbd])) :focus { outline: none; }
:host([kbd]) :focus-visible { outline: 2px solid rgb(var(--accent)); outline-offset: 2px; }
@media (prefers-contrast: more) {
  ha-card { border-width: 1.5px; }
  .daysum, .axis, .legend, .note, .rv .meta .d { color: var(--primary-text-color); opacity: 0.85; }
}
@media (prefers-reduced-motion: reduce) { ha-card { transition: none; } }

/* ---------- recordings button: the timeline and reviews open from here ---------- */
.recbtn {
  display: flex; align-items: center; gap: 9px; min-width: 0; height: 40px; padding: 0 10px 0 12px;
  border-radius: 12px; background: var(--well); color: var(--primary-text-color);
  font-size: 13.5px; line-height: 17px; font-weight: 600; letter-spacing: -0.008em;
  transform-origin: 50% 50%;
}
.recbtn ha-icon { --mdc-icon-size: 18px; display: flex; flex: none; color: var(--secondary-text-color); }
.recbtn .rl { flex: none; }
.recbtn .rsum {
  flex: 1; min-width: 0; text-align: end; font-size: 12px; font-weight: 500; color: var(--secondary-text-color);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* ---------- popup (CARD-DESIGN.md 8): outside ha-card, position: fixed ---------- */
.dscrim { position: fixed; inset: 0; z-index: 998; background: rgb(0 0 0 / 0.45); opacity: 0; }
.dlg {
  position: fixed; z-index: 999; box-sizing: border-box; display: flex; flex-direction: column;
  left: 50%; top: 50%; width: min(560px, calc(100vw - 32px)); max-height: min(720px, calc(100vh - 48px));
  border-radius: 22px; overflow: hidden; opacity: 0;
  background: var(--ha-card-background, var(--card-background-color, #fff)); color: var(--primary-text-color);
  box-shadow: 0 18px 50px rgb(0 0 0 / 0.35), 0 0 0 0.5px var(--line);
  font-family: var(--camera-card-font-family, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", Roboto, sans-serif);
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
/* its own container, so the card's width breakpoints follow the popup's width */
.db { overflow: auto; overscroll-behavior: contain; padding: 4px 16px 18px; display: flex; flex-direction: column; gap: 10px; container-type: inline-size; }

@container (max-width: 380px) {
  .pill ha-icon { display: none; }
  .rv { width: 116px; }
  .sync { display: none; }
}
@container (max-width: 300px) {
  .who span { display: none; }
  .ctime { display: none; }
  .axis i:nth-child(even) { visibility: hidden; }
}
`;

const TILE_HTML = `
  <img class="still" alt="" hidden>
  <div class="ph" hidden><ha-icon icon="mdi:cctv-off"></ha-icon><span></span></div>
  <div class="player" hidden><video playsinline muted preload="auto"></video></div>
  <div class="shade-top"></div><div class="shade-bot"></div>
  <div class="tl-row">
    <span class="badge"><span class="dot"></span><ha-icon class="pi" icon="mdi:play"></ha-icon><span class="bt">Live</span></span>
    <span class="spacer"></span>
    <span class="badge det" hidden><ha-icon></ha-icon><span></span></span>
  </div>
  <div class="bot-row">
    <span class="who"><b></b><span></span></span>
    <button class="iconbtn snd" aria-label="Unmute" aria-pressed="false" hidden><ha-icon icon="mdi:volume-off"></ha-icon></button>
    <button class="iconbtn fs" aria-label="Full screen"><ha-icon icon="mdi:fullscreen"></ha-icon></button>
  </div>
  <div class="msg" hidden><ha-icon icon="mdi:filmstrip-off"></ha-icon><span class="mt"></span><span class="msgd" hidden></span></div>`;

// the <video> inside Home Assistant's camera player, whose real element sits a few shadow roots down
function deepVideo(node) {
  if (!node) return null;
  if (node.localName === "video") return node;
  for (const k of [node.shadowRoot, ...(node.children || [])]) {
    const v = deepVideo(k);
    if (v) return v;
  }
  return null;
}

class SavvyCameraCard extends HTMLElement {
  static getStubConfig(hass) {
    const a = allAreas(hass).find((x) => areaEntities(hass, x.id).some((id) => domainOf(id) === "camera"));
    if (a) return { area: a.id };
    const cam = Object.keys(hass?.states || {}).find((id) => id.startsWith("camera."));
    return cam ? { cameras: [cam] } : {};
  }
  static getConfigElement() { return document.createElement(EDITOR); }

  constructor() {
    super();
    watchKeyboard(this);
    this._job = (now, dt) => this._frame(now, dt);
    this._onHidden = () => { if (document.hidden) this._muteAll(); };
    this._onscreen = true;
    this._index = 0;
    this._day = 0;
    this._filter = "all";
    this._mode = "live";
    this._cols = 1;
    this._signed = new Map();      // path -> { url, until }
    this._reviews = new Map();     // scope|day -> { at, items, source, error }
    this._summary = new Map();     // cam -> { at, days }
    this._motion = new Map();      // cam|day -> { at, rows: [[start, end, motion]], last }
  }

  setConfig(config) {
    if (!config?.cameras && !config?.entity && !config?.area && !config?.areas) throw new Error('savvy-camera-card: set an "area" (or "cameras")');
    this._given = config;
    this._sig = null;
    if (this._hass) this.hass = this._hass;
  }

  // The cameras (given, else the area's) and whether Frigate is on (given, else found
  // from the cameras' integration). -> true when that changed.
  _resolve(hass) {
    const g = this._given;
    let cams = asItems(g.cameras || g.entity);
    if (!cams.length) {
      cams = [].concat(g.area || g.areas || []).flatMap((a) => pick(hass, areaEntities(hass, a), { domains: "camera" })
        .sort((x, y) => (hass.states[x].attributes.friendly_name || x).localeCompare(hass.states[y].attributes.friendly_name || y))
        .map((entity) => ({ entity, area: a })));
    }
    const found = cams.some((c) => hass.entities?.[c.entity]?.platform === "frigate");
    const fr = g.frigate === false ? false
      : g.frigate && typeof g.frigate === "object" ? { instance: "frigate", ...g.frigate }
      : g.frigate === true || found ? { instance: "frigate" } : false;
    const sig = JSON.stringify([cams, fr, g]);
    if (sig === this._sig) return false;
    this._sig = sig;
    this._config = { days: 7, columns: "auto", ...g, cameras: cams, frigate: fr };
    // recordings: popup (default) | inline (the timeline and reviews in the card) | false
    this._recMode = !fr || g.recordings === false ? false : g.recordings === "inline" ? "inline" : "popup";
    this._index = clamp(this._index || 0, 0, Math.max(0, cams.length - 1));
    return true;
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._given) return;
    const changed = this._resolve(hass);
    if (!this._config.cameras.length) return this._renderMissing();
    if (!this._root || changed || this._missing) { this._missing = false; this._build(); }
    for (const t of this._tiles || []) if (t.liveEl) t.liveEl.hass = hass;
    this._update();
    if (first || changed) this._loadAll();
  }

  _renderMissing() {
    this._missing = true;
    this._root = this.shadowRoot || this.attachShadow({ mode: "open" });
    const where = this._given.area ? ` in ${esc(areaInfo(this._hass, this._given.area).name)}` : "";
    this._root.innerHTML = `<style>${BASE_CSS} ha-card { padding: 16px; font-size: 13px; color: var(--secondary-text-color); }</style><ha-card>No cameras${where}.</ha-card>`;
  }

  connectedCallback() {
    this._observe();
    this._timer = this._timer || setInterval(() => this._refresh(), REFRESH_MS);
    this._soundTimer = this._soundTimer || setInterval(() => this._syncSound(), 1000);
    document.addEventListener("visibilitychange", this._onHidden);
    this._wake();
  }
  disconnectedCallback() {
    clearInterval(this._soundTimer);
    this._soundTimer = 0;
    document.removeEventListener("visibilitychange", this._onHidden);
    Clock.remove(this._job);
    this._io?.disconnect();
    this._ro?.disconnect();
    clearInterval(this._timer);
    this._timer = 0;
    for (const t of this._tiles || []) { this._dropLive(t); this._stopVideo(t); }
    this._closeDialog(true);
    this._finishClosing();
  }

  getCardSize() { return this._recMode === "inline" ? 8 : 5; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: "auto" }; }

  get _grid() { return this._cols > 1; }
  get _cam() { return this._config.cameras[this._index]; }
  // the cameras currently on screen: all of them in the grid, the selected one otherwise
  _active() { return this._grid ? this._config.cameras.map((_, i) => i) : [this._index]; }
  _fcam(cam = this._cam) { return cam.frigate_camera || cam.entity.split(".")[1]; }
  _scope() { return this._active().map((i) => this._fcam(this._config.cameras[i])); }
  _camName(cam) {
    const st = this._hass?.states[cam.entity];
    if (cam.name) return cam.name;
    if (cam.area && this._hass?.areas?.[cam.area]?.name) return this._hass.areas[cam.area].name;
    return st?.attributes.friendly_name || title(cam.entity.split(".")[1]);
  }
  _camByFrigate(name) { return this._config.cameras.find((c) => this._fcam(c) === name); }

  // ---------- build ----------
  _build() {
    this._root = this._shadow || (this._shadow = this.attachShadow({ mode: "open" }));
    for (const t of this._tiles || []) { this._dropLive(t); this._stopVideo(t); }
    this._springs = [];
    this._pressNodes = [];
    const cams = this._config.cameras;
    const fr = !!this._config.frigate;
    const popup = this._recMode === "popup";
    this._closeDialog(true);
    this._finishClosing();
    const ar = String(this._config.aspect_ratio || "16/9").replace(/\s*[/:x]\s*/, " / ");

    this._root.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="stage" id="stage" role="group" aria-roledescription="camera viewer" style="--ar:${ar}">
          <div class="track" id="track">
            ${cams.map((c, i) => `<div class="tile" data-i="${i}">${TILE_HTML}</div>`).join("")}
          </div>
          <span class="dots" id="dots" ${cams.length > 1 ? "" : "hidden"}>${cams.map(() => "<i></i>").join("")}</span>
          <div class="ctrl" id="ctrl" hidden>
            <button class="iconbtn" id="pp" aria-label="Pause"><ha-icon id="ppIcon" icon="mdi:pause"></ha-icon></button>
            <div class="bar" id="bar" role="slider" tabindex="0" aria-label="Playback position">
              <div class="rail"><div class="fill" id="fill"></div></div><div class="knob" id="knob"></div>
            </div>
            <span class="ctime" id="ctime"></span>
            <button class="iconbtn snd" id="snd" aria-label="Unmute" aria-pressed="false" hidden><ha-icon icon="mdi:volume-off"></ha-icon></button>
            <span class="sync" id="sync" hidden>Synced</span>
            <button class="livebtn" id="live"><span class="dot"></span>Live</button>
          </div>
        </div>
        <div class="pills" id="pills" role="tablist" ${cams.length > 1 ? "" : "hidden"}>
          <span class="ind" id="ind"></span>
          ${cams.map((c, i) => `<button class="pill" role="tab" data-i="${i}"><ha-icon></ha-icon><span></span></button>`).join("")}
        </div>
        <button class="recbtn" id="recBtn" aria-haspopup="dialog" ${popup ? "" : "hidden"}>
          <ha-icon icon="mdi:history"></ha-icon><span class="rl">Recordings</span><span class="rsum" id="recSum"></span>
          <ha-icon icon="mdi:chevron-right"></ha-icon>
        </button>
        ${popup ? '<div id="holder" hidden>' : ""}
        <div id="rec" ${this._recMode ? "" : "hidden"} style="display:contents">
          <div class="tlhead">
            <button class="step" id="prev" aria-label="Previous day"><ha-icon icon="mdi:chevron-left"></ha-icon></button>
            <span class="dayname" id="dayname"></span>
            <button class="step" id="next" aria-label="Next day"><ha-icon icon="mdi:chevron-right"></ha-icon></button>
            <span class="daysum" id="daysum"></span>
          </div>
          <div class="tl" id="tl" role="slider" tabindex="0" aria-label="Recording timeline" aria-valuemin="0" aria-valuemax="86400">
            <div class="hours" id="hours">${"<i></i>".repeat(24)}</div>
            <svg class="act" id="act" viewBox="0 0 ${BUCKETS} 100" preserveAspectRatio="none" aria-hidden="true"><path id="actPath" d=""></path></svg>
            <div class="future" id="future"></div>
            <div class="marks" id="marks"></div>
            <div class="now" id="now"></div>
            <div class="ph" id="playhead"></div>
            <div class="bubble" id="bubble"></div>
          </div>
          <div class="axis"><i>00</i><i>06</i><i>12</i><i>18</i><i>24</i></div>
          <div class="legend" id="legend" hidden>
            <span><i class="l-m"></i>Motion</span><span><i class="l-d"></i>Detection</span><span><i class="l-a"></i>Alert</span>
          </div>
          <div class="filters" id="filters"></div>
          <div class="reviews" id="reviews" role="list"></div>
          <div class="note" id="note" hidden></div>
        </div>
        ${popup ? "</div>" : ""}
      </ha-card>`;

    const $ = (id) => this._root.getElementById(id);
    const ids = ["stage", "track", "dots", "ctrl", "pp", "ppIcon", "bar", "fill", "knob", "ctime", "snd", "sync", "live",
      "pills", "ind", "prev", "next", "dayname", "daysum", "tl", "hours", "act", "actPath", "future", "marks",
      "now", "playhead", "bubble", "legend", "filters", "reviews", "note", "rec", "recBtn", "recSum", "holder"];
    this._el = Object.fromEntries(ids.map((id) => [id, $(id)]));
    this._el.card = this._root.querySelector("ha-card");
    // a camera card shows no name of its own (each camera names itself), so a title is its own line, which can link
    mountTitleLine(this._root, this._el.card, this._config, (el, onTap) => this._press(el, onTap, { haptic: null }));
    this._el.pillBtns = [...this._root.querySelectorAll(".pill")];

    this._tiles = [...this._root.querySelectorAll(".tile")].map((node, i) => {
      const q = (s) => node.querySelector(s);
      const t = {
        i, cam: cams[i], node,
        still: q("img.still"), ph: q(".ph"), phText: q(".ph span"), player: q(".player"), video: q("video"),
        badge: q(".badge"), badgeText: q(".badge .bt"), det: q(".det"), detIcon: q(".det ha-icon"), detText: q(".det span"),
        name: q(".who b"), status: q(".who span"), fs: q(".fs"), snd: q(".snd"), sound: false,
        msg: q(".msg"), msgIcon: q(".msg ha-icon"), msgText: q(".msg .mt"), msgDetail: q(".msg .msgd"),
        liveEl: null, liveFor: null,
      };
      this._wireVideo(t);
      this._press(t.fs, () => this._fullscreen(t));
      this._press(t.snd, () => this._setSound(t, !t.sound));
      return t;
    });

    this._pager = new Spring(this._index, MOTION.pager, "pager");
    this._indX = new Spring(0, MOTION.pill, "pill");
    this._indW = new Spring(0, MOTION.pill, "pill");
    this._scrub = new Spring(0, MOTION.scrub, "scrub");
    this._head = new Spring(0, MOTION.drag, "head");
    this._headOn = new Spring(0, MOTION.ui, "head");
    this._actIn = new Spring(0, MOTION.graph, "act");
    this._springs.push(this._pager, this._indX, this._indW, this._scrub, this._head, this._headOn, this._actIn);
    this._pillReady = false;
    this._laidOut = false;

    this._wireStage();
    this._wireTimeline();
    this._wireBar();
    this._el.pillBtns.forEach((b, i) => this._press(b, () => this._select(i)));
    this._press(this._el.prev, () => this._stepDay(1));
    this._press(this._el.next, () => this._stepDay(-1));
    this._press(this._el.live, () => this._goLive());
    this._press(this._el.pp, () => this._togglePlay());
    this._press(this._el.snd, () => { const l = this._lead(); if (l) this._setSound(l, !l.sound); });
    if (popup) this._press(this._el.recBtn, () => this._openRec());

    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => {
      this._layout();
      this._pillReady = false;
      this._fitRows();
      this._renderActivity();
      this._paint(null);
      this._wake();
    });
    this._ro.observe(this._el.card);
    this._ro.observe(this._el.filters);
    this._ro.observe(this._el.reviews);
    this._layout();
    this._observe();
  }

  // One camera per TILE_MIN px of the card's own width, never more than there are
  // cameras. `columns:` forces it (1 = always the pager).
  _layout() {
    const n = this._config.cameras.length;
    const want = this._config.columns;
    const w = this._el.card.clientWidth || 0;
    let cols = want !== "auto" && Number.isFinite(+want) ? clamp(Math.round(+want), 1, n)
      : (w ? clamp(Math.floor((w + 8) / TILE_MIN), 1, n) : 1);
    if (n === 1) cols = 1;
    if (cols === this._cols && this._laidOut) return;
    const was = this._laidOut ? this._grid : null;
    this._laidOut = true;
    this._cols = cols;
    this.toggleAttribute("grid", cols > 1);
    put(this._el.stage, "--cols", String(cols));
    if (was === null || was === this._grid || !this._hass) return;
    // switching pager <-> grid changes which cameras are on screen
    this._filter = "all";
    if (this._mode === "play") this._replayAt(this._leadOffset());
    else this._syncLive();
    this._loadAll();
    this._update();
  }

  _observe() {
    if (!this._root || !this.isConnected) return;
    this._io = this._io || new IntersectionObserver(([e]) => {
      this._onscreen = e.isIntersecting;
      // a stream nobody is looking at is pure load on the Pi and the network
      if (!this._onscreen) for (const t of this._tiles) this._dropLive(t);
      else { this._syncLive(); this._paint(null); this._wake(); this._refresh(); }
    });
    this._io.disconnect();
    this._io.observe(this);
  }

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

  // ---------- stage: pager swipe, taps ----------
  _wireStage() {
    const stage = this._el.stage;
    let start = null, dragging = false, samples = [];
    const onControl = (e) => e.composedPath().some((n) => n.classList?.contains("iconbtn")
      || n.classList?.contains("ctrl") || n.classList?.contains("livebtn"));
    const tileOf = (e) => e.composedPath().find((n) => n.classList?.contains("tile"));

    stage.addEventListener("pointerdown", (e) => {
      if (e.button > 0 || onControl(e)) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId, from: this._pager.x, tile: tileOf(e) };
      dragging = false;
      samples = [[performance.now(), e.clientX]];
    });
    stage.addEventListener("pointermove", (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!dragging) {
        if (Math.hypot(dx, dy) < SLOP) return;
        // vertical intent goes back to the page; the grid has nothing to page
        if (Math.abs(dy) > Math.abs(dx) || this._grid || this._config.cameras.length < 2) { start = null; return; }
        dragging = true;
        try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }
      const W = stage.clientWidth || 1, n = this._config.cameras.length;
      let x = start.from - dx / W;
      if (x < 0) x = -rubber(-x * W, W) / W;
      if (x > n - 1) x = n - 1 + rubber((x - (n - 1)) * W, W) / W;
      this._pager.snap(x);
      samples.push([performance.now(), e.clientX]);
      if (samples.length > 6) samples.shift();
      this._paint(new Set(["pager"]));
    });
    const end = (e) => {
      if (!start || e.pointerId !== start.id) return;
      const was = dragging, tile = start.tile;
      start = null; dragging = false;
      if (!was) {
        if (e.type === "pointerup" && tile) this._tileTap(+tile.dataset.i);
        return;
      }
      const [t0, x0] = samples[0], [t1, x1] = samples[samples.length - 1];
      const v = t1 > t0 ? ((x1 - x0) / (t1 - t0)) * 1000 : 0;
      const W = stage.clientWidth || 1;
      const landing = this._pager.x - project(v) / W;
      const target = clamp(Math.round(landing), Math.max(0, this._index - 1),
        Math.min(this._config.cameras.length - 1, this._index + 1));
      this._pager.v = -v / W;
      this._select(target, { fromSwipe: true });
    };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
    stage.addEventListener("keydown", (e) => {
      if (this._grid || e.target !== stage) return;
      if (e.key === "ArrowRight") { e.preventDefault(); this._select(Math.min(this._index + 1, this._config.cameras.length - 1)); }
      if (e.key === "ArrowLeft") { e.preventDefault(); this._select(Math.max(this._index - 1, 0)); }
    });
    attr(stage, "tabindex", "0");
  }

  _tileTap(i) {
    if (this._mode === "play") return this._togglePlay();
    this._moreInfo(this._config.cameras[i].entity);
  }

  _select(i, { fromSwipe = false } = {}) {
    const changed = i !== this._index;
    const offset = this._mode === "play" ? this._leadOffset() : 0;
    this._index = i;
    this._pager.to(i, MOTION.pager);
    if (changed) {
      this._haptic(fromSwipe ? "light" : "selection");
      this._filter = "all";
      // playback follows you to the other camera at the same moment
      if (this._mode === "play") this._replayAt(offset);
      else this._syncLive();
      this._loadAll();
    }
    this._update();
    this._wake();
  }

  // ---------- live ----------
  // HA lazy-loads its camera player; creating a picture-entity card through the card
  // helpers is the supported way to make sure <ha-camera-stream> gets defined.
  async _ensureStreamElement() {
    if (customElements.get("ha-camera-stream")) return true;
    if (!this._streamLoad && window.loadCardHelpers) {
      this._streamLoad = window.loadCardHelpers()
        .then((helpers) => helpers.createCardElement({ type: "picture-entity", entity: this._cam.entity, camera_view: "live" }))
        .then(() => Promise.race([customElements.whenDefined("ha-camera-stream"), new Promise((r) => setTimeout(r, 4000))]))
        .catch(() => {});
    }
    if (this._streamLoad) await this._streamLoad;
    return !!customElements.get("ha-camera-stream");
  }

  _syncLive() {
    if (!this._root || !this._hass) return;
    const active = new Set(this._active());
    for (const t of this._tiles) {
      const st = this._hass.states[t.cam.entity];
      const want = this._onscreen && this.isConnected && this._mode === "live" && active.has(t.i)
        && st && st.state !== "unavailable";
      if (!want) this._dropLive(t);
      else if (!t.liveEl && !t.liveToken) this._startLive(t, st);
    }
  }

  async _startLive(t, st) {
    t.liveFor = t.cam.entity;
    const token = (t.liveToken = {});
    const stream = await this._ensureStreamElement();
    if (t.liveToken !== token) return;
    // the moment passed (scrolled away, playback started): leave it for the next sync
    if (!this._onscreen || this._mode !== "live") { t.liveToken = null; t.liveFor = null; return; }
    let el;
    if (stream) {
      el = document.createElement("ha-camera-stream");
      el.hass = this._hass;
      el.stateObj = st;
      el.muted = true;
      el.controls = false;
      el.fitMode = "cover";
      el.allowExoPlayer = true;
    } else {
      el = document.createElement("img");
      el.className = "live";
      el.alt = "";
      const refresh = () => {
        const pic = this._hass.states[t.cam.entity]?.attributes.entity_picture;
        if (pic) el.src = `${pic}${pic.includes("?") ? "&" : "?"}t=${Date.now()}`;
      };
      refresh();
      el.__timer = setInterval(refresh, 2000);
    }
    t.liveEl = el;
    t.player.before(el);
  }

  _dropLive(t) {
    t.liveToken = null;
    t.sound = false;
    if (t.liveEl) {
      clearInterval(t.liveEl.__timer);
      t.liveEl.remove();
    }
    t.liveEl = null;
    t.liveFor = null;
  }

  // ---------- sound ----------
  // Every picture starts muted. The speaker button turns one tile's sound on (one tap is the gesture
  // browsers want), one tile at a time, and it goes back to muted whenever the picture restarts, the
  // card leaves the screen, a popup closes or the tab is hidden. It only shows when the stream has sound.
  _voiceOf(t) { return t.playing ? t.video : t.liveEl ? deepVideo(t.liveEl) : null; }

  _hasSound(t) {
    const v = this._voiceOf(t);
    if (!v) return false;
    if (v.audioTracks?.length || v.mozHasAudio === true) return true;
    if (v.srcObject?.getAudioTracks?.().length) return true;
    return (v.webkitAudioDecodedByteCount || 0) > 0;
  }

  _setSound(t, on) {
    on = !!on;
    if (on) for (const o of this._tiles) if (o !== t && o.sound) this._setSound(o, false);
    t.sound = on;
    if (t.liveEl && t.liveEl.localName === "ha-camera-stream") t.liveEl.muted = !on;
    const v = this._voiceOf(t);
    if (v) v.muted = !on;
    this._paintSound();
  }

  _muteAll() { for (const t of this._tiles || []) if (t.sound) this._setSound(t, false); }

  _syncSound() {
    if (!this._el || !this._tiles) return;
    const enabled = this._config.audio_button !== false;
    for (const t of this._tiles) {
      const show = enabled && !t.playing && !!t.liveEl && this._hasSound(t);
      t.snd.hidden = !show;
      if (!show && t.sound && !t.playing) this._setSound(t, false);
    }
    const lead = this._mode === "play" ? this._lead() : null;
    this._el.snd.hidden = !(enabled && lead && this._hasSound(lead));
    if (this._el.snd.hidden && lead?.sound) this._setSound(lead, false);
    this._paintSound();
  }

  _paintSound() {
    if (!this._el || !this._tiles) return;
    const paint = (btn, on) => {
      btn.toggleAttribute("data-on", on);
      attr(btn, "aria-pressed", on ? "true" : "false");
      attr(btn, "aria-label", on ? "Mute" : "Unmute");
      attr(btn.querySelector("ha-icon"), "icon", on ? "mdi:volume-high" : "mdi:volume-off");
    };
    for (const t of this._tiles) paint(t.snd, t.sound);
    paint(this._el.snd, !!this._lead()?.sound);
  }

  // ---------- playback ----------
  _wireVideo(t) {
    const v = t.video;
    for (const ev of ["loadeddata", "playing"]) v.addEventListener(ev, () => this._syncSound());
    v.addEventListener("loadedmetadata", () => {
      if (t.offset > 0 && Number.isFinite(v.duration)) v.currentTime = Math.min(t.offset, Math.max(0, v.duration - 0.5));
      t.offset = 0;
      this._syncPlayer();
    });
    // Frigate cuts/segments on request; a long span can take a few seconds to arrive
    v.addEventListener("loadeddata", () => {
      if (this._mode !== "play") return;
      this._hideMsg(t);
      this._syncPlayer();
    });
    v.addEventListener("timeupdate", () => {
      if (t === this._lead()) this._keepInSync();
      this._syncPlayer();
    });
    for (const ev of ["play", "pause", "ended"]) v.addEventListener(ev, () => this._syncPlayer());
    v.addEventListener("error", () => {
      if (this._mode !== "play" || !v.getAttribute("src") || !t.sources) return;
      const src = t.sources[t.source];
      t.tried.push({ kind: src?.kind, code: v.error?.code ?? null });
      // try the next way of fetching the same footage before giving up
      if (t.source < t.sources.length - 1) return this._loadSource(t, t.source + 1);
      this._diagnose(t, v.getAttribute("src"), v.error);
    });
  }

  _wireBar() {
    // the progress bar owns its horizontal axis (CARD-DESIGN.md 3.2), and the finger
    // owns the position while it's down (4): timeupdates mustn't yank it back
    const bar = this._el.bar;
    let seeking = false;
    const seek = (e) => {
      const r = bar.getBoundingClientRect();
      const f = clamp((e.clientX - r.left) / (r.width || 1));
      this._seekFrac = f;
      this._seekAll(f);
      this._syncPlayer(f);
    };
    bar.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      seeking = true;
      try { bar.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      seek(e);
    });
    bar.addEventListener("pointermove", (e) => { if (seeking) seek(e); });
    for (const ev of ["pointerup", "pointercancel"]) {
      bar.addEventListener(ev, () => {
        if (!seeking) return;
        seeking = false;
        this._seekFrac = null;
        this._syncPlayer();
      });
    }
    bar.addEventListener("keydown", (e) => {
      const lead = this._lead()?.video;
      if (!lead || !Number.isFinite(lead.duration)) return;
      const d = e.key === "ArrowRight" ? 5 : e.key === "ArrowLeft" ? -5 : 0;
      if (!d) return;
      e.preventDefault();
      this._seekAll(clamp((lead.currentTime + d) / lead.duration));
    });
  }

  _playingTiles() { return this._tiles.filter((t) => t.playing); }

  // The tile whose clock the controls show: the first playing camera that has
  // actually loaded, so one camera with no footage can't stall the others.
  _lead() {
    const list = this._playingTiles();
    return list.find((t) => t.video.getAttribute("src") && !t.video.error && t.video.readyState >= 1) || list[0] || null;
  }
  _leadOffset() {
    const v = this._lead()?.video;
    return v && Number.isFinite(v.currentTime) ? v.currentTime : 0;
  }

  _seekAll(f) {
    const lead = this._lead()?.video;
    const dur = lead && Number.isFinite(lead.duration) ? lead.duration : null;
    for (const t of this._playingTiles()) {
      const v = t.video, d = Number.isFinite(v.duration) ? v.duration : dur;
      if (d && !v.error && v.readyState >= 1) v.currentTime = f * d;
    }
  }

  // Every camera plays the same span, so equal offsets are the same moment; nudge
  // back any camera that drifted (buffering, a slower segment) past DRIFT_S.
  _keepInSync() {
    if (this._seekFrac != null) return;
    const lead = this._lead();
    if (!lead) return;
    const t0 = lead.video.currentTime;
    for (const t of this._playingTiles()) {
      if (t === lead) continue;
      const v = t.video;
      if (v.error || v.readyState < 2 || !Number.isFinite(v.duration)) continue;
      if (Math.abs(v.currentTime - t0) > DRIFT_S && t0 < v.duration) v.currentTime = t0;
      if (lead.video.paused !== v.paused && !lead.video.ended) {
        if (lead.video.paused) v.pause(); else v.play?.().catch(() => {});
      }
    }
  }

  async _playSpan(start, end, meta = {}, offset = 0) {
    const fr = this._config.frigate;
    if (!fr) return;
    end = Math.min(end, nowS());
    if (end - start < 2) return this._goLive();
    this._mode = "play";
    this._play = { start, end, ...meta };
    const play = this._play;
    this.toggleAttribute("playing", true);
    const active = new Set(this._active());
    for (const t of this._tiles) {
      this._dropLive(t);
      this._stopVideo(t);
      t.playing = active.has(t.i);
      t.player.hidden = !t.playing;
      attr(t.node, "data-playing", t.playing ? "" : null);
      this._hideMsg(t);
    }
    this._el.ctrl.hidden = false;
    this._el.sync.hidden = this._playingTiles().length < 2;
    this._headOn.to(1, MOTION.ui);
    this._head.snap(clamp(start + offset - dayStart(this._day), 0, DAY));
    const at = hhmm(start + offset + (meta.review && !offset ? PAD_S : 0));
    this._update();
    await Promise.all(this._playingTiles().map((t) => {
      t.offset = offset;
      this._showMsg(t, `Preparing the recording from ${at}…`, { icon: "mdi:progress-clock", loading: true });
      return this._loadTile(t, play);
    }));
    this._wake();
  }

  _replayAt(offset) {
    const p = this._play;
    if (!p) return;
    const { start, end, ...meta } = p;
    this._playSpan(start, end, meta, offset);
  }

  // Two ways to get the same footage out of Frigate, tried in order:
  //   hls   Frigate's VOD playlist, the same thing Frigate's own UI plays. Segmented,
  //         so it needs no byte ranges, and Safari/iOS play H.265 through it. Only
  //         where the browser plays HLS natively.
  //   mp4   one file Frigate cuts on request. Plays anywhere the codec does, but
  //         Safari refuses it for H.265 (hev1 tag, no byte ranges through the proxy).
  async _loadTile(t, play) {
    const fr = this._config.frigate, cam = this._fcam(t.cam);
    const s0 = Math.floor(play.start), s1 = Math.ceil(play.end);
    t.sources = [];
    if (t.video.canPlayType("application/vnd.apple.mpegurl")) {
      t.sources.push({ kind: "hls", path: `/api/frigate/${fr.instance}/vod/${cam}/start/${s0}/end/${s1}/index.m3u8` });
    }
    t.sources.push({ kind: "mp4", path: `/api/frigate/${fr.instance}/recording/${cam}/start/${s0}/end/${s1}` });
    t.tried = [];
    await this._loadSource(t, 0);
  }

  async _loadSource(t, k) {
    const play = this._play, src = t.sources?.[k];
    if (!src) return;
    t.source = k;
    const token = (t.playToken = {});
    let url;
    try { url = await this._sign(src.path); }
    catch (err) { url = null; }
    if (t.playToken !== token || this._play !== play) return;
    if (!url) { this._showMsg(t, "Couldn't open the recording."); return; }
    const v = t.video;
    v.muted = !t.sound;
    v.src = url;
    v.play?.().catch(() => {});
  }

  _playReview(item) {
    if (this._dialog) this._closeDialog();
    this._activeReview = item.id;
    if (item.source === "review" && !item.reviewed) {
      item.reviewed = true;
      this._hass.callWS({ type: "frigate/reviews/viewed", instance_id: this._config.frigate.instance, ids: [item.id] })
        .catch(() => {});
    }
    const label = item.labels[0] ? title(item.labels[0]) : "";
    this._playSpan(item.start - PAD_S, (item.end || nowS()) + PAD_S, { review: item.id, label });
    this._renderReviews();
  }

  // ---------- recordings popup ----------
  // The real #rec node moves into the popup and back, so it keeps updating from hass
  // while open. Outside ha-card: its container-type would clip a fixed popup.
  _openRec() {
    const rec = this._el.rec;
    if (!rec || this._dialog) return;
    this._finishClosing();
    this._haptic("selection");
    const scrim = document.createElement("div");
    scrim.className = "dscrim";
    const dlg = document.createElement("div");
    dlg.className = "dlg";
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("aria-modal", "true");
    dlg.setAttribute("aria-label", "Recordings");
    dlg.innerHTML = `<span class="grab" aria-hidden="true"></span>
      <div class="dh"><span class="dt">Recordings</span><button class="dx" aria-label="Close"><ha-icon icon="mdi:close"></ha-icon></button></div>
      <div class="db"></div>`;
    dlg.querySelector(".db").appendChild(rec);
    this._layer().append(scrim, dlg);
    const place = () => dlg.toggleAttribute("data-sheet", window.innerWidth < 600);
    place();
    const open = new Spring(0, MOTION.sheetIn, "dlg");
    open.to(1, MOTION.sheetIn);
    this._springs.push(open);
    const close = () => this._closeDialog();
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    dlg.querySelector(".dx").addEventListener("click", (e) => { e.stopPropagation(); close(); });
    guardBackdrop(scrim, dlg, close, ".db");
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    this._dialog = { rec, scrim, dlg, open, anchor: this._el.recBtn, off: () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
    } };
    attr(this._el.recBtn, "aria-expanded", "true");
    this._fitRows();
    this._renderActivity();
    dlg.querySelector(".dx").focus({ preventScroll: true });
    this._paint(new Set(["dlg"]));
    this._wake();
  }

  _closeDialog(now = false) {
    this._muteAll();
    const d = this._dialog;
    if (!d) return;
    this._dialog = null;
    d.off();
    if (this._el?.recBtn) attr(this._el.recBtn, "aria-expanded", "false");
    d.anchor?.focus?.({ preventScroll: true });
    if (now || !this.isConnected) {
      this._dropDialog(d);
      return;
    }
    d.closing = true;      // the backdrop stays until it's gone: the rest of that tap lands on it
    d.open.to(0, MOTION.sheetOut);
    this._finishClosing();
    this._closing = d;
    this._wake();
  }

  _finishClosing() {
    const c = this._closing;
    if (!c) return;
    this._closing = null;
    this._dropDialog(c);
  }

  // Popups live at the top of the page, not inside the card: dashboards wrap cards in
  // boxes that would clip a full-screen layer to the card. This card's styles go with it.
  _layer() {
    if (!this._layerEl || !this._layerEl.isConnected) {
      const host = document.createElement("div");
      host.className = "savvy-layer";
      host.attachShadow({ mode: "open" }).innerHTML = `<style>${STYLE}</style>`;
      watchKeyboard(host);
      document.body.appendChild(host);
      this._layerEl = host;
    }
    this._layerEl.toggleAttribute("dark", this.hasAttribute("dark"));
    return this._layerEl.shadowRoot;
  }

  _dropDialog(d) {
    if (this._el?.holder && d.rec.parentElement !== this._el.holder) this._el.holder.appendChild(d.rec);
    d.dlg.remove();
    d.scrim.remove();
    if (this._layerEl && this._layerEl.shadowRoot.children.length <= 1) { this._layerEl.remove(); this._layerEl = null; }
    const i = this._springs.indexOf(d.open);
    if (i >= 0) this._springs.splice(i, 1);
  }

  _goLive() {
    this._seekFrac = null;
    this._mode = "live";
    this._play = null;
    this._activeReview = null;
    this.toggleAttribute("playing", false);
    for (const t of this._tiles) {
      this._stopVideo(t);
      t.playing = false;
      t.player.hidden = true;
      attr(t.node, "data-playing", null);
      this._hideMsg(t);
    }
    this._el.ctrl.hidden = true;
    this._headOn.to(0, MOTION.ui);
    this._syncLive();
    this._update();
    this._renderReviews();
    this._wake();
  }

  _stopVideo(t) {
    t.playToken = null;
    t.sound = false;
    t.video.muted = true;
    t.sources = null;
    const v = t.video;
    v.pause?.();
    if (v.getAttribute("src")) { v.removeAttribute("src"); v.load?.(); }
  }

  _togglePlay() {
    const lead = this._lead()?.video;
    if (!lead) return;
    const resume = lead.paused || lead.ended;
    for (const t of this._playingTiles()) {
      const v = t.video;
      if (v.error || !v.getAttribute("src")) continue;
      if (resume) { if (v.ended) v.currentTime = 0; v.play?.().catch(() => {}); }
      else v.pause();
    }
    this._syncPlayer();
  }

  _syncPlayer(forceFrac) {
    if (this._mode !== "play" || !this._el || !this._play) return;
    const lead = this._lead();
    if (!lead) return;
    const v = lead.video;
    const dur = Number.isFinite(v.duration) ? v.duration : (this._play.end - this._play.start);
    const cur = v.currentTime || 0;
    const f = forceFrac ?? this._seekFrac ?? clamp(dur ? cur / dur : 0);
    put(this._el.fill, "transform", `scaleX(${f.toFixed(4)})`);
    put(this._el.knob, "left", `${(f * 100).toFixed(2)}%`);
    text(this._el.ctime, `${mmss(f * dur)} / ${mmss(dur)}`);
    attr(this._el.bar, "aria-valuenow", String(Math.round(f * dur)));
    attr(this._el.bar, "aria-valuemax", String(Math.round(dur)));
    const paused = v.paused || v.ended;
    attr(this._el.ppIcon, "icon", v.ended ? "mdi:replay" : paused ? "mdi:play" : "mdi:pause");
    attr(this._el.pp, "aria-label", v.ended ? "Replay" : paused ? "Play" : "Pause");
    const at = this._play.start + f * dur;
    this._head.to(clamp(at - dayStart(this._day), 0, DAY), MOTION.drag);
    for (const t of this._playingTiles()) {
      text(t.badgeText, `${hhmm(at)}${this._play.label ? ` · ${this._play.label}` : ""}`);
    }
    this._wake();
  }

  _showMsg(t, msg, { detail = "", icon = "mdi:filmstrip-off", loading = false } = {}) {
    text(t.msgText, msg);
    text(t.msgDetail, detail);
    t.msgDetail.hidden = !detail;
    attr(t.msgIcon, "icon", icon);
    attr(t.msg, "data-loading", loading ? "" : null);
    t.msg.hidden = false;
  }
  _hideMsg(t) {
    t.msg.hidden = true;
    attr(t.msg, "data-loading", null);
  }

  // A <video> error only says "couldn't play". Ask the same signed URL directly for
  // its first bytes to tell apart what actually goes wrong: no footage (404), link
  // refused (401/403), Frigate failed to cut the clip (5xx), or a codec/tag this
  // browser won't decode (H.265 from a camera's main stream is the usual one).
  async _diagnose(t, url, mediaErr) {
    const play = this._play;
    if (!play) return;
    const at = hhmm(play.start + (play.review ? PAD_S : 0));
    const info = { camera: this._fcam(t.cam), path: url.split("?")[0], mediaError: mediaErr?.code ?? null, mediaMessage: mediaErr?.message || "" };
    try {
      const r = await fetch(url, { headers: { Range: "bytes=0-262143" }, cache: "no-store" });
      info.status = r.status;
      info.type = r.headers.get("content-type");
      info.ranges = r.status === 206 ? "ranges" : "no ranges";
      if (r.ok) {
        const bytes = new Uint8Array(await r.arrayBuffer());
        let ascii = "";
        for (let i = 0; i < bytes.length; i++) ascii += bytes[i] > 31 && bytes[i] < 127 ? String.fromCharCode(bytes[i]) : ".";
        info.codec = /hvc1|hev1/.test(ascii) ? "h265" : /avc1|avc3/.test(ascii) ? "h264"
          : /av01/.test(ascii) ? "av1" : /vp09/.test(ascii) ? "vp9" : null;
        // Apple only decodes H.265 in MP4 when the sample entry is tagged hvc1
        info.tag = /hvc1/.test(ascii) ? "hvc1" : /hev1/.test(ascii) ? "hev1" : null;
      } else {
        info.body = (await r.text()).replace(/\s+/g, " ").slice(0, 200);
      }
    } catch (err) {
      info.status = "network";
      info.body = err?.message || String(err);
    }
    if (this._play !== play) return;
    info.tried = (t.tried || []).map((x) => `${x.kind}:${x.code}`).join(" ");
    console.warn("[camera-card] recording playback failed", info);

    const v = t.video;
    const canHevc = !!(v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') || v.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"'));
    const detail = `${info.status}${info.type ? ` · ${info.type}` : ""}${info.codec ? ` · ${info.codec}` : ""}`
      + `${info.tag ? `/${info.tag}` : ""}${info.status === 200 || info.status === 206 ? ` · ${info.ranges}` : ""}`
      + `${info.tried ? ` · tried ${info.tried}` : ""}${info.body ? ` · ${info.body}` : ""}`;
    let msg;
    if (info.status === 404) {
      msg = /no recordings/i.test(info.body || "")
        ? `Frigate has no recording of ${this._camName(t.cam)} at ${at}.`
        : `Frigate didn't find “${info.camera}” recordings at ${at}. If the Frigate camera has a different name, set frigate_camera.`;
    } else if (info.status === 401 || info.status === 403) {
      msg = "Home Assistant refused the recording link. Reload the dashboard and try again.";
    } else if (typeof info.status === "number" && info.status >= 500) {
      msg = `Frigate couldn't prepare the recording from ${at}.`;
    } else if (info.status === "network") {
      msg = "Couldn't reach Home Assistant for the recording.";
    } else if (info.codec === "h265" && !canHevc) {
      msg = "This camera records in H.265, which this browser can't play. Try Safari / the iOS app, or record an H.264 stream in Frigate.";
    } else if (info.codec === "h265" && info.tag === "hev1") {
      msg = "This camera's H.265 recordings are tagged “hev1”, which Apple devices won't play. In Frigate, set ffmpeg: apple_compatibility: true for this camera (applies to new recordings).";
    } else if (info.codec === "h265") {
      msg = "This camera records in H.265; this browser says it supports it but failed to decode it.";
    } else {
      msg = `This browser couldn't play the recording from ${at}.`;
    }
    this._showMsg(t, msg, { detail });
  }

  _fullscreen(t) {
    const target = this._grid ? t.node : this._el.stage;
    const v = t.video;
    if (this._mode === "play" && v.webkitEnterFullscreen && !target.requestFullscreen) return v.webkitEnterFullscreen();
    if (target.requestFullscreen) {
      if (document.fullscreenElement) return document.exitFullscreen?.();
      return target.requestFullscreen().catch(() => this._moreInfo(t.cam.entity));
    }
    this._moreInfo(t.cam.entity);
  }

  // ---------- timeline ----------
  _wireTimeline() {
    const tl = this._el.tl;
    let down = null;
    const secAt = (e) => {
      const r = tl.getBoundingClientRect();
      return clamp((e.clientX - r.left) / (r.width || 1)) * DAY;
    };
    const show = (sec) => {
      const limit = this._day === 0 ? nowS() - dayStart(0) : DAY;
      sec = Math.min(sec, limit);
      this._cursor = sec;
      this._head.to(sec, MOTION.scrub);
      this._headOn.to(1, MOTION.ui);
      this._scrub.to(1, MOTION.scrub);
      const day0 = dayStart(this._day);
      text(this._el.bubble, hhmm(day0 + sec));
      attr(tl, "aria-valuenow", String(Math.round(sec)));
      attr(tl, "aria-valuetext", hhmm(day0 + sec));
      this._wake();
      return sec;
    };
    tl.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      e.stopPropagation();
      down = e.pointerId;
      try { tl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      this._lastDetent = null;
      show(secAt(e));
    });
    tl.addEventListener("pointermove", (e) => {
      if (e.pointerId !== down) return;
      const sec = show(secAt(e));
      const detent = Math.floor(sec / 3600);
      if (this._lastDetent !== null && detent !== this._lastDetent) this._haptic("selection");
      this._lastDetent = detent;
    });
    const up = (e) => {
      if (e.pointerId !== down) return;
      down = null;
      this._scrub.to(0, MOTION.ui);
      if (e.type === "pointerup") this._playAt(this._cursor);
      else if (this._mode !== "play") this._headOn.to(0, MOTION.ui);
      this._wake();
    };
    tl.addEventListener("pointerup", up);
    tl.addEventListener("pointercancel", up);
    tl.addEventListener("keydown", (e) => {
      const base = this._cursor ?? (this._day === 0 ? nowS() - dayStart(0) : DAY / 2);
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        show(clamp(base + (e.key === "ArrowRight" ? 300 : -300), 0, DAY));
        clearTimeout(this._kbTimer);
        this._kbTimer = setTimeout(() => { this._scrub.to(0, MOTION.ui); this._wake(); }, 900);
      }
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this._playAt(base); }
    });
  }

  // A moment on the timeline plays from there, on every camera on screen. Landing on
  // a review plays that review (so it's marked seen and labelled); within a minute
  // of now just means live.
  _playAt(sec) {
    if (sec == null) return;
    if (this._dialog) this._closeDialog();
    const at = dayStart(this._day) + sec;
    this._haptic("light");
    if (nowS() - at < 60) return this._goLive();
    const hit = this._visibleReviews().find((r) => at >= r.start - 5 && at <= (r.end || nowS()) + 5);
    if (hit) return this._playReview(hit);
    this._activeReview = null;
    this._playSpan(at, at + 600, { label: "" });
    this._renderReviews();
  }

  _stepDay(dir) {
    const next = clamp(this._day + dir, 0, this._config.days - 1);
    if (next === this._day) return;
    this._day = next;
    this._cursor = null;
    if (this._mode === "play") this._goLive();
    this._actIn.snap(0);
    this._el.actPath.__d = null;
    this._loadAll();
    this._update();
  }

  // ---------- frigate data ----------
  async _sign(path) {
    const c = this._signed.get(path);
    if (c && c.until > Date.now()) return c.url;
    const res = await this._hass.callWS({ type: "auth/sign_path", path, expires: SIGN_TTL });
    const url = res?.path || path;
    this._signed.set(path, { url, until: Date.now() + (SIGN_TTL - 120) * 1000 });
    return url;
  }

  _refresh() {
    if (!this._onscreen || !this._hass || this._day !== 0) return;
    this._loadAll();
  }

  _loadAll() {
    if (!this._config?.frigate || !this._hass) return;
    this._loadReviews();
    for (const cam of this._scope()) { this._loadSummary(cam); this._loadMotion(cam); }
  }

  _reviewKey() { return `${this._scope().join(",")}|${this._day}|${ymd(dayStart(this._day))}`; }

  async _loadReviews() {
    const fr = this._config.frigate, cams = this._scope(), day = this._day;
    const key = this._reviewKey();
    const have = this._reviews.get(key);
    if (have?.loading) return;
    if (have && (day > 0 || Date.now() - have.at < REFRESH_MS - 1000)) { this._renderRec(); return; }
    this._reviews.set(key, { ...(have || {}), loading: true });
    const after = dayStart(day), before = day === 0 ? nowS() : dayStart(day - 1);
    let items = null, source = null, error = null;
    try {
      const list = parseWS(await this._hass.callWS({
        type: "frigate/reviews/get", instance_id: fr.instance, cameras: cams, after, before, limit: 500,
      }));
      source = "review";
      items = list.map((r) => {
        const cam = r.camera || cams[0];
        const thumb = r.thumb_path && r.thumb_path.includes("/clips/")
          ? `/api/frigate/${fr.instance}/clips/${r.thumb_path.split("/clips/")[1]}`
          : `/api/frigate/${fr.instance}/clips/review/thumb-${cam}-${r.id}.webp`;
        return {
          id: r.id, source, camera: cam, start: r.start_time, end: r.end_time,
          severity: r.severity === "alert" ? "alert" : "detection",
          labels: [...new Set([...(r.data?.objects || []), ...(r.data?.audio || [])].map((l) => String(l).replace(/-verified$/, "")))],
          reviewed: !!r.has_been_reviewed, thumb,
        };
      });
    } catch (err) {
      try {
        const list = parseWS(await this._hass.callWS({
          type: "frigate/events/get", instance_id: fr.instance, cameras: cams,
          after: Math.floor(after), before: Math.ceil(before), limit: 500,
        }));
        source = "event";
        items = list.map((e) => ({
          id: e.id, source, camera: e.camera || cams[0], start: e.start_time, end: e.end_time, severity: "detection",
          labels: e.label ? [e.label] : [], reviewed: true,
          thumb: `/api/frigate/${fr.instance}/notifications/${e.id}/thumbnail.jpg`,
        }));
      } catch (err2) {
        error = err2?.message || String(err2);
      }
    }
    if (!error) console.info(`[savvy-camera-card] ${items.length} ${source === "review" ? "reviews" : "events"} for ${cams.join(", ")} on ${ymd(after)}`);
    this._reviews.set(key, { at: Date.now(), items: (items || []).sort((a, b) => b.start - a.start), source, error });
    if (key === this._reviewKey()) this._renderRec();
  }

  async _loadSummary(cam) {
    const fr = this._config.frigate;
    const have = this._summary.get(cam);
    if (have && (have.loading || Date.now() - have.at < SUMMARY_MS)) return;
    this._summary.set(cam, { ...(have || {}), loading: true });
    let days = null;
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      days = parseWS(await this._hass.callWS({ type: "frigate/recordings/summary", instance_id: fr.instance, camera: cam, timezone: tz }));
    } catch (err) { days = null; }
    this._summary.set(cam, { at: Date.now(), days });
    if (this._scope().includes(cam)) this._renderRec();
  }

  // Every ~10s recording segment carries Frigate's motion score; that's the same
  // signal Frigate's own activity graph is drawn from. Today refreshes incrementally.
  async _loadMotion(cam) {
    const fr = this._config.frigate, day = this._day;
    const key = `${cam}|${ymd(dayStart(day))}`;
    const have = this._motion.get(key);
    if (have?.loading) return;
    if (have && !have.error && (day > 0 || Date.now() - have.at < REFRESH_MS - 1000)) return;
    const after = have?.last && day === 0 ? have.last : dayStart(day);
    const before = day === 0 ? nowS() : dayStart(day - 1);
    this._motion.set(key, { ...(have || { rows: [] }), loading: true });
    let rows = null, error = null;
    try {
      const list = parseWS(await this._hass.callWS({
        type: "frigate/recordings/get", instance_id: fr.instance, camera: cam,
        after: Math.floor(after), before: Math.ceil(before),
      }));
      rows = list.map((r) => [r.start_time, r.end_time, Number(r.motion) || 0]).filter((r) => Number.isFinite(r[0]));
    } catch (err) { error = err?.message || String(err); }
    const merged = rows ? [...(have?.rows || []).filter((r) => r[0] < after), ...rows] : (have?.rows || []);
    const last = merged.length ? merged[merged.length - 1][0] : null;
    this._motion.set(key, { at: Date.now(), rows: merged, last, error: rows ? null : error });
    if (this._scope().includes(cam)) this._renderRec();
  }

  _dayReviews() { return this._reviews.get(this._reviewKey())?.items || []; }

  _visibleReviews() {
    const f = this._filter;
    return this._dayReviews().filter((r) => f === "all" || (f === "alert" ? r.severity === "alert" : r.labels.includes(f)));
  }

  // hours of this day with no recording in any on-screen camera; null = unknown
  _missingHours() {
    const want = ymd(dayStart(this._day));
    let known = false;
    const have = new Set();
    for (const cam of this._scope()) {
      const days = this._summary.get(cam)?.days;
      if (!Array.isArray(days)) continue;
      known = true;
      const d = days.find((x) => x.day === want);
      for (const h of d?.hours || []) if ((h.duration ?? 1) > 0) have.add(parseInt(h.hour, 10));
    }
    if (!known) return null;
    const upto = this._day === 0 ? new Date().getHours() : 23;
    const miss = new Set();
    for (let h = 0; h <= upto; h++) if (!have.has(h)) miss.add(h);
    return miss;
  }

  // motion per 5-minute bucket across the on-screen cameras, plus total seconds
  _activity() {
    const day0 = dayStart(this._day), want = ymd(day0);
    const buckets = new Float64Array(BUCKETS);
    let any = false, seconds = 0, loaded = false;
    for (const cam of this._scope()) {
      const m = this._motion.get(`${cam}|${want}`);
      if (m && !m.loading && !m.error) loaded = true;
      for (const [s, e, v] of m?.rows || []) {
        if (v <= 0) continue;
        const b = Math.floor(((s - day0) / DAY) * BUCKETS);
        if (b < 0 || b >= BUCKETS) continue;
        buckets[b] += v;
        seconds += Math.max(0, (e || s + 10) - s);
        any = true;
      }
      // no segment data: fall back to the hourly motion counts in the summary
      if (!m?.rows?.length) {
        const d = Array.isArray(this._summary.get(cam)?.days) ? this._summary.get(cam).days.find((x) => x.day === want) : null;
        for (const h of d?.hours || []) {
          const v = Number(h.motion) || 0;
          if (v <= 0) continue;
          const hr = parseInt(h.hour, 10), per = BUCKETS / 24;
          for (let k = 0; k < per; k++) buckets[hr * per + k] += v / per;
          any = true;
          loaded = true;
        }
      }
    }
    return { buckets, any, seconds, loaded };
  }

  // ---------- update ----------
  _update() {
    const h = this._hass;
    if (!h || !this._root) return;
    this._reduced = MQ.reduced.matches;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    const cams = this._config.cameras, el = this._el, active = new Set(this._active());

    for (const t of this._tiles) {
      const c = t.cam, st = h.states[c.entity];
      const off = !st || st.state === "unavailable";
      attr(t.node, "aria-hidden", active.has(t.i) ? "false" : "true");
      attr(t.node, "aria-label", `${this._camName(c)}, ${this._mode === "play" && t.playing ? "recording" : off ? "offline" : "live"}`);
      t.ph.hidden = !off;
      if (off) text(t.phText, st ? `${this._camName(c)} is offline` : `${c.entity} not found`);
      const pic = st?.attributes.entity_picture;
      t.still.hidden = off || !pic;
      if (pic && t.still.__pic !== pic) { t.still.__pic = pic; t.still.src = pic; }
      text(t.name, this._camName(c));
      text(t.status, this._roomStatus(c));
      if (this._mode === "live" || !t.playing) {
        attr(t.badge, "data-mode", "live");
        text(t.badgeText, off ? "Offline" : "Live");
      } else attr(t.badge, "data-mode", "play");
      const det = this._detections(c);
      t.det.hidden = !det.length || this._mode !== "live";
      if (det.length) {
        attr(t.detIcon, "icon", LABEL_ICONS[det[0]] || "mdi:motion-sensor");
        text(t.detText, det.map(title).join(" · "));
      }
    }

    cams.forEach((c, i) => {
      const btn = el.pillBtns[i];
      if (btn) {
        attr(btn.querySelector("ha-icon"), "icon", c.icon || h.areas?.[c.area]?.icon || "mdi:cctv");
        text(btn.querySelector("span"), this._camName(c));
        attr(btn, "aria-selected", String(i === this._index));
        attr(btn, "tabindex", i === this._index ? "0" : "-1");
      }
      const dot = el.dots.children[i];
      if (dot) attr(dot, "data-on", i === this._index ? "" : null);
    });

    const pill = el.pillBtns[this._index];
    if (this._pillReady && pill?.offsetWidth) {
      this._indX.to(pill.offsetLeft, MOTION.pill);
      this._indW.to(pill.offsetWidth, MOTION.pill);
    }

    if (this._mode === "live") this._syncLive();
    this._renderRec();
    this._wake();
  }

  // Frigate's own per-camera occupancy sensors, found by registry platform so a room
  // presence sensor that also happens to end in "_occupancy" never counts.
  _detections(cam) {
    const h = this._hass, prefix = `binary_sensor.${this._fcam(cam)}_`, out = [];
    for (const id in h.states) {
      if (!id.startsWith(prefix) || !id.endsWith("_occupancy") || h.states[id].state !== "on") continue;
      const plat = h.entities?.[id]?.platform;
      if (plat && plat !== "frigate") continue;
      if (!plat && !h.entities) continue;
      const label = id.slice(prefix.length, -"_occupancy".length);
      if (label === "all" || !label) continue;
      out.push(label);
    }
    return out;
  }

  _roomStatus(cam) {
    const h = this._hass;
    if (!cam.area || !h.entities) return "";
    if (this._regFor !== h.entities) { this._regFor = h.entities; this._areaCache = new Map(); }
    let ids = this._areaCache.get(cam.area);
    if (!ids) {
      ids = { presence: [], door: [] };
      for (const id in h.entities) {
        const ent = h.entities[id];
        if (ent.hidden || ent.disabled_by || ent.entity_category || !id.startsWith("binary_sensor.")) continue;
        if (ent.platform === "frigate") continue;
        const a = ent.area_id || h.devices?.[ent.device_id]?.area_id;
        if (a !== cam.area) continue;
        const dc = h.states[id]?.attributes.device_class;
        if (["presence", "occupancy", "motion"].includes(dc)) ids.presence.push(id);
        if (["door", "garage_door", "opening"].includes(dc)) ids.door.push(id);
      }
      this._areaCache.set(cam.area, ids);
    }
    const parts = [];
    const pres = ids.presence.map((id) => h.states[id]).filter(Boolean);
    if (pres.length) parts.push(pres.some((s) => s.state === "on") ? "Occupied" : "Clear");
    const doors = ids.door.map((id) => h.states[id]).filter(Boolean);
    if (doors.length) {
      const open = doors.filter((s) => s.state === "on").length;
      parts.push(open ? (doors.length > 1 ? `${open} doors open` : "Door open") : (doors.length > 1 ? "Doors closed" : "Door closed"));
    }
    return parts.join(" · ");
  }

  // ---------- recordings UI ----------
  _renderActivity() {
    if (!this._config.frigate || !this._el) return;
    const { buckets, any } = this._activity();
    let max = 0;
    for (const v of buckets) max = Math.max(max, v);
    const path = this._el.actPath;
    if (!any || !max) {
      if (path.__d) { path.__d = ""; path.setAttribute("d", ""); }
      this._el.legend.hidden = !this._dayReviews().length;
      return;
    }
    // sqrt lifts the quiet stretches so one busy minute doesn't flatten the whole day
    let d = "M0 100";
    for (let i = 0; i < BUCKETS; i++) {
      const y = (100 - (buckets[i] > 0 ? 6 + Math.sqrt(buckets[i] / max) * 60 : 0)).toFixed(1);
      d += `L${i} ${y}L${i + 1} ${y}`;
    }
    d += `L${BUCKETS} 100Z`;
    if (path.__d !== d) {
      const first = !path.__d;
      path.__d = d;
      path.setAttribute("d", d);
      if (first) { this._actIn.snap(0); this._actIn.to(1, MOTION.graph); this._wake(); }
    }
    this._el.legend.hidden = false;
  }

  _renderRec() {
    if (!this._config.frigate || !this._el) return;
    const el = this._el, day0 = dayStart(this._day), grid = this._grid;
    const names = ["Today", "Yesterday"];
    text(el.dayname, names[this._day] || new Date(day0 * 1000).toLocaleDateString(this._hass?.locale?.language || undefined,
      { weekday: "short", day: "numeric", month: "short" }));
    attr(el.prev, "disabled", this._day >= this._config.days - 1 ? "" : null);
    attr(el.next, "disabled", this._day === 0 ? "" : null);

    const entry = this._reviews.get(this._reviewKey());
    const all = entry?.items || [];
    const alerts = all.filter((r) => r.severity === "alert").length;
    const act = this._activity();
    let sum;
    if (!entry || (entry.loading && !entry.items)) sum = "Loading…";
    else if (entry.error) sum = "";
    else if (all.length) sum = `${alerts ? `${alerts} alert${alerts > 1 ? "s" : ""} · ` : ""}${all.length - alerts} detection${all.length - alerts === 1 ? "" : "s"}`;
    else if (act.any) sum = `No detections · ${span(act.seconds)} of motion`;
    else sum = act.loaded ? "No activity" : "No detections";
    text(el.daysum, sum);
    if (el.recSum) text(el.recSum, sum);

    const miss = this._missingHours();
    [...el.hours.children].forEach((i, hIdx) => attr(i, "data-norec", miss?.has(hIdx) ? "" : null));
    const nowFrac = this._day === 0 ? clamp((nowS() - day0) / DAY) : 1;
    el.future.hidden = this._day !== 0;
    put(el.future, "left", `${(nowFrac * 100).toFixed(3)}%`);
    el.now.hidden = this._day !== 0;
    put(el.now, "left", `${(nowFrac * 100).toFixed(3)}%`);

    const vis = new Set(this._visibleReviews().map((r) => r.id));
    const marks = all.map((r) => {
      const a = clamp((r.start - day0) / DAY), b = clamp(((r.end || nowS()) - day0) / DAY);
      return `<i class="mk" data-sev="${r.severity}" ${vis.has(r.id) ? "" : "data-dim"} style="left:${(a * 100).toFixed(3)}%;width:${Math.max(0, (b - a) * 100).toFixed(3)}%"></i>`;
    }).join("");
    if (el.marks.__html !== marks) { el.marks.__html = marks; el.marks.innerHTML = marks; }

    const counts = new Map();
    for (const r of all) for (const l of r.labels) counts.set(l, (counts.get(l) || 0) + 1);
    const filters = [["all", "All", "mdi:filmstrip", all.length]];
    if (alerts) filters.push(["alert", "Alerts", "mdi:alert-circle-outline", alerts]);
    for (const [l, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) filters.push([l, title(l), LABEL_ICONS[l] || "mdi:motion-sensor", n]);
    if (!filters.some((f) => f[0] === this._filter)) this._filter = "all";
    const fkey = filters.map((f) => f.join(":")).join("|");
    if (el.filters.__key !== fkey) {
      el.filters.__key = fkey;
      this._dropPress(el.filters);
      el.filters.innerHTML = "";
      for (const [key, name, icon, n] of filters) {
        const b = document.createElement("button");
        b.className = "chip";
        b.dataset.key = key;
        b.innerHTML = `<ha-icon icon="${icon}"></ha-icon><span>${name}</span><span class="n">${n}</span>`;
        b.setAttribute("aria-label", `${name}, ${n}`);
        this._press(b, () => { this._filter = key; this._haptic("selection"); this._renderRec(); }, { haptic: null });
        el.filters.appendChild(b);
      }
    }
    for (const b of el.filters.children) attr(b, "aria-pressed", String(b.dataset.key === this._filter));
    el.filters.hidden = !all.length;

    this._renderReviews();
    this._renderActivity();

    let note = "";
    if (entry?.error) note = "Recordings unavailable: the Frigate integration didn't answer. Check the instance id and that Frigate is running.";
    el.note.hidden = !note;
    text(el.note, note);
    attr(el.tl, "aria-label", `Recording timeline${grid ? ", all cameras" : `, ${this._camName(this._cam)}`}`);
    this._fitRows();
  }

  _dropPress(container) {
    this._pressNodes = this._pressNodes.filter((n) => {
      if (!container.contains(n)) return true;
      const i = this._springs.indexOf(n.__spring);
      if (i >= 0) this._springs.splice(i, 1);
      return false;
    });
  }

  _renderReviews() {
    const el = this._el, list = this._visibleReviews(), grid = this._grid;
    const key = `${this._reviewKey()}|${this._filter}|${grid}|${list.map((r) => `${r.id}:${r.reviewed}:${r.end}`).join(",")}`;
    if (el.reviews.__key !== key) {
      el.reviews.__key = key;
      this._dropPress(el.reviews);
      el.reviews.innerHTML = "";
      for (const r of list) {
        const b = document.createElement("button");
        b.className = "rv";
        b.dataset.id = r.id;
        b.dataset.sev = r.severity;
        b.setAttribute("role", "listitem");
        const label = r.labels[0];
        const dur = r.end ? r.end - r.start : nowS() - r.start;
        const cam = this._camByFrigate(r.camera);
        // in the grid the reviews come from every camera, so say which one
        const where = grid && cam ? this._camName(cam) : (r.end ? mmss(dur) : "ongoing");
        b.innerHTML = `
          <span class="th"><ha-icon icon="${LABEL_ICONS[label] || "mdi:cctv"}"></ha-icon><img alt="" hidden>
            ${label ? `<span class="lbl"><ha-icon icon="${LABEL_ICONS[label] || "mdi:motion-sensor"}"></ha-icon>${title(label)}${r.labels.length > 1 ? ` +${r.labels.length - 1}` : ""}</span>` : ""}
            ${r.reviewed ? "" : `<span class="new" aria-hidden="true"></span>`}
          </span>
          <span class="meta"><span>${hhmm(r.start)}</span><span class="d">${where}</span></span>`;
        b.setAttribute("aria-label", `${r.severity === "alert" ? "Alert" : "Detection"}: ${r.labels.map(title).join(", ") || "motion"}`
          + `${cam && grid ? ` on ${this._camName(cam)}` : ""} at ${hhmm(r.start)}${r.reviewed ? "" : ", not reviewed"}`);
        this._press(b, () => this._playReview(r), { haptic: "light" });
        el.reviews.appendChild(b);
        this._thumb(b.querySelector("img"), r.thumb);
      }
    }
    for (const b of el.reviews.children) attr(b, "data-active", b.dataset.id === this._activeReview ? "" : null);
    el.reviews.hidden = !list.length;
  }

  async _thumb(img, path) {
    if (!path) return;
    try {
      const url = await this._sign(path);
      img.onload = () => { img.hidden = false; };
      img.onerror = () => { img.hidden = true; };
      img.src = url;
    } catch (err) { /* the label icon stays as the placeholder */ }
  }

  _fitRows() {
    for (const row of [this._el?.filters, this._el?.reviews]) {
      if (!row || row.hidden) continue;
      row.toggleAttribute("data-overflow", row.scrollWidth > row.clientWidth + 1);
    }
  }

  // ---------- actions ----------
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
      if (this._reduced) s.snap();
      else s.step(dt);
      dirty.add(s.group);
    }
    if (!this._pillReady && !this._grid && this._config.cameras.length > 1) dirty.add("pill");
    if (!dirty.size) return false;
    if (this._onscreen) this._paint(dirty);
    return true;
  }

  _paint(dirty) {
    if (!this._el) return;
    const all = !dirty, red = this._reduced, el = this._el;

    const dl = this._dialog || this._closing;
    if (dl && (all || dirty.has("dlg"))) {
      const v = dl.open.x, sheet = dl.dlg.hasAttribute("data-sheet");
      put(dl.scrim, "opacity", clamp(v).toFixed(3));
      put(dl.dlg, "opacity", clamp(v * 1.6).toFixed(3));
      put(dl.dlg, "transform", sheet ? `translateY(${((1 - v) * 60).toFixed(2)}px)`
        : `translate(-50%, calc(-50% + ${((1 - v) * 18).toFixed(2)}px)) scale(${(0.97 + 0.03 * v).toFixed(4)})`);
      if (dl.closing && v < 0.02 && dl.open.idle) this._finishClosing();
    }

    for (const node of this._pressNodes) {
      const s = node.__spring;
      if (!s || (!all && !dirty.has(s.group))) continue;
      const p = s.x;
      if (red) put(node, "opacity", Math.abs(p) < 1e-4 ? "" : (1 - 0.25 * p).toFixed(3));
      else put(node, "transform", Math.abs(p) < 1e-4 ? "" : `scale(${(1 - 0.04 * p).toFixed(4)})`);
    }

    if (all || dirty.has("pager")) {
      const W = this._grid ? 0 : (el.stage.clientWidth || 0);
      put(el.track, "transform", this._grid ? "" : `translate3d(${(-this._pager.x * W).toFixed(2)}px,0,0)`);
    }

    if ((all || dirty.has("pill")) && !this._grid && this._config.cameras.length > 1) {
      const btn = el.pillBtns[this._index];
      if (btn && btn.offsetWidth) {
        if (!this._pillReady) {
          this._pillReady = true;
          this._indX.snap(btn.offsetLeft);
          this._indW.snap(btn.offsetWidth);
        }
        this._indX.to(btn.offsetLeft, MOTION.pill);
        this._indW.to(btn.offsetWidth, MOTION.pill);
        put(el.ind, "transform", `translateX(${this._indX.x.toFixed(2)}px)`);
        put(el.ind, "width", `${this._indW.x.toFixed(2)}px`);
      }
    }

    if (this._config.frigate && (all || dirty.has("head") || dirty.has("scrub"))) {
      const f = clamp(this._head.x / DAY);
      put(el.playhead, "left", `${(f * 100).toFixed(3)}%`);
      put(el.playhead, "opacity", clamp(this._headOn.x).toFixed(3));
      put(el.bubble, "left", `${(f * 100).toFixed(3)}%`);
      put(el.bubble, "opacity", clamp(this._scrub.x).toFixed(3));
    }

    // the activity graph grows up out of the baseline the first time it has data
    if (this._config.frigate && (all || dirty.has("act"))) {
      const a = clamp(this._actIn.x);
      put(el.act, "transform-origin", "50% 100%");
      put(el.act, "transform", a > 0.999 ? "" : `scaleY(${a.toFixed(3)})`);
    }
  }
}

// ---------- editor ----------
const EDITOR = defineEditor("savvy-camera-card", (hass, c) => [
  S.grid(S.titleLine(), S.titleLink("title")),
  { name: "area", label: "Area", helper: "Its cameras. Pick several areas for one card across rooms.", selector: { area: { multiple: true } } },
  { name: "cameras", label: "Cameras", type: "list", helper: "Instead of the area's: these, in this order.", add: { selector: { entity: { domain: "camera" } }, label: "Add a camera" },
    item: [
      { name: "entity", label: "Camera", selector: { entity: { domain: "camera" } } },
      { type: "grid", name: "", schema: [{ name: "name", label: "Name", selector: { text: {} } }, { name: "area", label: "Area", selector: { area: {} } }] },
      { name: "frigate_camera", label: "Frigate name", helper: "When it isn't the entity's own name.", selector: { text: {} } },
    ] },
  S.grid(S.select("recordings", "Recordings", [{ value: "popup", label: "In a popup" }, { value: "inline", label: "In the card" }]),
    { name: "columns", label: "Columns", selector: { select: { mode: "dropdown", options: [{ value: "auto", label: "By width" }, "1", "2", "3", "4"] } } }),
  S.grid(S.number("days", "Recording days", 1, 30), S.text("aspect_ratio", "Aspect ratio")),
  S.bool("audio_button", "Sound button", "A speaker button on cameras that have sound. It always starts muted; one tap turns the sound on.", true),
  { type: "expandable", name: "frigate", title: "Frigate", schema: [
    { name: "instance", label: "Instance", helper: "Frigate's MQTT client id; 'frigate' unless you changed it. Found by itself when the cameras come from Frigate.", selector: { text: {} } },
  ] },
]);

registerCard("savvy-camera-card", SavvyCameraCard, "Camera",
  "Live cameras side by side, with Frigate's alerts, motion activity and synced recording playback when the cameras come from Frigate.");
})();

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
  ${GLOW_CSS}
  ha-card {
    --radius: var(--ha-card-border-radius, 18px);
    --pad: 16px;
    --accent: 90 169 224;
    ${DESIGN_TOKENS}
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
    width: var(--c-l); height: var(--c-l); border-radius: 13px;
    background: var(--well); color: var(--secondary-text-color);
  }
  .power[data-on] { background: color-mix(in oklab, rgb(var(--accent)) var(--mix-on), transparent); color: rgb(var(--accent)); }
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
  .step { display: grid; place-items: center; width: var(--c-l); height: var(--c-l); border-radius: 13px; background: var(--well); }
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
  .stat ha-icon, .stat savvy-state-icon { --mdc-icon-size: 20px; flex: none; display: flex; color: var(--sc, var(--secondary-text-color)); }
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
  .act ha-icon, .act savvy-state-icon { --mdc-icon-size: 18px; flex: none; display: flex; color: var(--ac, inherit); }
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
  ha-card[data-compact] .step { order: 1; width: var(--c-s); height: var(--c-s); border-radius: 11px; padding: 0; }
  ha-card[data-compact] #minus { order: -1; }
  ha-card[data-compact] .step ha-icon { --mdc-icon-size: 19px; }
  ha-card[data-compact] .readout { flex: none; justify-content: center; min-width: 58px; }
  ha-card[data-compact] .value { font-size: 25px; line-height: 1; letter-spacing: -0.022em; }
  ha-card[data-compact] .unit { font-size: 13px; margin: 1px 0 0 1px; }
  ha-card[data-compact] .power { width: var(--c-s); height: var(--c-s); border-radius: 11px; }
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

    linkTitle(this._root, this._el.name, titlePathOf(this._config), (el, onTap) => {
      this._pressable(el, new Spring(0, MOTION.press, "x"), onTap);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); } });
    });
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
    this._modes = (c.hvac_modes || (a.hvac_modes ? offLast(a.hvac_modes) : ["off"])).filter((m) => m);
    if (st && st.state !== "off" && st.state !== "unavailable") this._lastOn = st.state;

    const dead = !st || st.state === "unavailable" || st.state === "unknown";
    const on = st && !dead && st.state !== "off";
    this._running = !!on;
    this._el.card.toggleAttribute("data-dead", dead);
    const accent = on ? toRgb(HVAC[st.state]?.color || "#5AA9E0") : toRgb("#9AA0A6");
    put(el.card, "--accent", accent.map(Math.round).join(" "));
    // the glow: the mode's colour, fuller while it is actually heating or cooling
    stateGlow(c, el.card, on ? accent : null, ["heating", "cooling", "drying", "fan"].includes(a.hvac_action) ? 0.85 : 0.45);

    text(el.name, c.name || c.title || a.friendly_name || title(c.entity.split(".")[1]));
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
        `${s.weather ? "<savvy-state-icon></savvy-state-icon>" : `<ha-icon icon="${s.icon}"></ha-icon>`}
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
        const icon = item.querySelector("savvy-state-icon");
        if (icon.stateObj !== s.weather) { icon.hass = h; icon.stateObj = s.weather; }
      }
    }
    const keys = new Set(want.map((s) => s.key));
    for (const [key, node] of el.__rows || []) Motion.show(node, keys.has(key));
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
        color: timer.cfg.color || TONE.warn,
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
        `${it.icon ? `<ha-icon icon="${it.icon}"></ha-icon>` : "<savvy-state-icon></savvy-state-icon>"}<span></span>`);
      if (!act.__wired) {
        act.__wired = true;
        this._pressable(act, new Spring(0, MOTION.press, "x"), () => act.__tap(), () => act.__hold());
      }
      act.__tap = it.tap; act.__hold = it.hold;
      Motion.tintVar(act, "--ac", it.color);
      attr(act, "data-on", it.on ? "" : null);
      text(act.querySelector("span"), it.label);
      const icon = act.querySelector("savvy-state-icon");
      if (icon && icon.stateObj !== it.state) { icon.hass = h; icon.stateObj = it.state; }
    }
    const keys = new Set(items.map((i) => i.key));
    for (const [key, node] of el.__rows || []) Motion.show(node, keys.has(key));
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
    for (const [key, node] of el.__rows || []) Motion.show(node, keys.has(key));
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
      ? { name: "entity", label: "Unit", selector: { select: { mode: "dropdown", options: found.map((id) => ({ value: id, label: hass.states[id].attributes.friendly_name || id })) } } }
      : S.entity("entity", "Climate entity", "climate"),
    S.grid(S.text("name", "Name"), S.select("layout", "Layout", [{ value: "full", label: "Full" }, { value: "compact", label: "Compact" }])),
    S.titleLink("name"),
    { name: "hvac_modes", label: "Modes", helper: "In this order. Empty: all the unit's modes.", selector: { select: { multiple: true, mode: "list", options: modes } } },
    S.grid(S.select("default_hvac_mode", "Power mode", modes.filter((m) => m !== "off")), S.bool("fan_control", "Fan button", null, true)),
    S.section("Readings", [
      S.entity("temperature", "Temperature sensor", "sensor", { helper: "Empty: the unit's own reading." }),
      S.entity("humidity", "Humidity sensor", "sensor", { helper: "Empty: the unit's own reading." }),
      S.entity("weather", "Weather", "weather"),
      S.grid(S.text("temperature_name", "Temperature label"), S.text("humidity_name", "Humidity label")),
    ]),
    { type: "expandable", name: "timer", title: "Timer", schema: [
      { name: "entity", label: "Timer", selector: { entity: { domain: "timer" } } },
      { name: "select", label: "Duration list (tap steps through it)", selector: { entity: { domain: "input_select" } } },
    ] },
    { type: "expandable", name: "history", title: "History (swipe left)", schema: [
      { name: "hours", label: "History range", selector: { number: { min: 1, max: 720, mode: "box" } } },
      { name: "show_state", label: "Show band", selector: { boolean: {} } },
    ] },
    S.grid(S.text("state_name", "Band label"), S.text("humidity_color", "Humidity colour")),
    S.chips(),
  ];
});

registerCard("savvy-climate-card", ClimateCard, "Climate",
  "An A/C or thermostat: drag the target, pick the mode, and swipe for its history. Finds the room's unit for you.");
})();

// ===== cards/entity.js =====
(() => {
// savvy-entity-card: one main entity, and the entities that belong with it underneath as
// chips.
//
//   main   by what it is: a person or device_tracker gets their picture (initials when
//          there's none), a zone badge and "Home · for 3 h"; anything else its own state
//          icon, name and "Charging · for 40 min". The time ticks on a coarse timer.
//   chips  the one chip spec. A toggle toggles at once (the chip shows the result before
//          HA confirms), a button presses, a script or scene runs, anything else shows its
//          value and opens more-info. Hold opens more-info.
//
//   type: custom:savvy-entity-card
//   entity: person.sam
//   chips: [{ entity: switch.charger_plug, name: Charger, icon: mdi:ev-plug-type2, color: blue }]

const TICK_MS = 30000;
const PREDICT_MS = 4000;
const PEOPLE = new Set(["person", "device_tracker"]);
const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";

// The pre-Savvy shorthands: tap_action: toggle | press | turn_on | more-info
const legacyAction = (a, entity) => {
  if (a === "press" || a === "turn_on") return { action: "perform-action", perform_action: `${domainOf(entity)}.${a}`, target: { entity_id: entity } };
  return asAction(a);
};

const STYLE = `${BASE_CSS}
  ha-card { --pad: 12px; display: flex; flex-direction: column; gap: 10px; padding: var(--pad); }
  .main { --on: 0; --away: 0; display: flex; align-items: center; gap: 11px; min-width: 0;
    border-radius: 14px; margin: -4px; padding: 4px; cursor: pointer; transform-origin: 30% 50%; }
  .av { position: relative; flex: none; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--well);
    --mdc-icon-size: 22px; color: color-mix(in oklab, var(--main-c, var(--primary-text-color)) calc(var(--on) * 100%), var(--secondary-text-color)); }
  .av[data-kind="icon"] { background: color-mix(in oklab, var(--main-c, var(--primary-text-color)) calc(6% + var(--on) * 10%), transparent); }
  .av img { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 50%; object-fit: cover;
    filter: grayscale(calc(var(--away) * 0.85)); opacity: calc(1 - var(--away) * 0.35); }
  .av .ini { font-size: 14px; line-height: 1; font-weight: 650; letter-spacing: -0.01em; transform: translate(-2px, -2px);
    color: var(--primary-text-color); opacity: calc(1 - var(--away) * 0.45); }
  .av .zone { position: absolute; right: -4px; bottom: -4px; width: 19px; height: 19px; border-radius: 50%; display: grid; place-items: center;
    --mdc-icon-size: 12px; background: var(--card-background-color, #fff); color: var(--primary-text-color);
    box-shadow: 0 0 0 1.5px var(--card-background-color, #fff), inset 0 0 0 20px var(--well); }
  /* ha-icon is inline with a baseline gap under its svg; as a fixed-size flex box it centres */
  .av > ha-icon, .av > savvy-state-icon, .av .zone ha-icon { display: flex; align-items: center; justify-content: center;
    width: var(--mdc-icon-size); height: var(--mdc-icon-size); line-height: 0; }
  .txt { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .name { font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { display: flex; gap: 4px; min-width: 0; font-size: 12.5px; line-height: 16px; font-weight: 500; letter-spacing: -0.005em;
    color: var(--secondary-text-color); white-space: nowrap; }
  .sub .st { font-weight: 600; color: var(--primary-text-color); flex: none; }
  .sub .since { overflow: hidden; text-overflow: ellipsis; }
  .sub .st:not([hidden]) + .since::before { content: "· "; }
  .sub .since:empty { display: none; }
  .main[data-off] .av, .main[data-off] .sub .st { opacity: 0.55; }

  .pills { display: flex; gap: 6px; min-width: 0; overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain; padding: 3px; margin: -3px; }
  .pills::-webkit-scrollbar { display: none; }
  .pills[data-overflow] { mask-image: linear-gradient(to left, transparent 0, #000 26px); -webkit-mask-image: linear-gradient(to left, transparent 0, #000 26px); }
  .pill { --on: 0; flex: none; display: flex; align-items: center; gap: 6px; box-sizing: border-box; height: 32px; padding: 0 12px 0 9px; border-radius: 11px;
    background: color-mix(in oklab, var(--chip-c, var(--primary-text-color)) calc(6% + var(--on) * 10%), transparent);
    font-size: 12.5px; line-height: 16px; font-weight: 600; letter-spacing: -0.006em;
    color: color-mix(in oklab, var(--primary-text-color) calc(60% + var(--on) * 40%), transparent);
    --mdc-icon-size: 17px; cursor: pointer; white-space: nowrap; transform-origin: 50% 50%; }
  .pill .ic { display: flex; color: color-mix(in oklab, var(--chip-c, var(--primary-text-color)) calc(var(--on) * 100%), var(--secondary-text-color)); }
  .pill[data-kind="value"] { color: var(--primary-text-color); }
  .pill .cn { font-weight: 500; color: var(--secondary-text-color); }
  /* show_state: false -> the name is the only label, so it reads as one and stays */
  .pill[data-nostate] .cn { font-weight: 600; color: inherit; display: inline !important; }
  .pill[data-icononly] { padding: 0 9px; }
  .pill[data-off] { opacity: 0.5; }
  @media (prefers-contrast: more) { .sub, .pill .cn { color: var(--primary-text-color); opacity: 0.85; } }
  /* half a section: names drop first (the icon says what it is), the time only when there's truly no room */
  @container (max-width: 300px) { .pill .cn { display: none; } .pill { padding-right: 11px; } }
  @container (max-width: 190px) { .av { width: 40px; height: 40px; } .sub .since { display: none; } }
`;

class SavvyEntityCard extends SavvyCard {
  static getStubConfig(hass) {
    const p = Object.keys(hass?.states || {}).find((id) => id.startsWith("person."))
      || Object.keys(hass?.states || {}).find((id) => id.startsWith("light.") || id.startsWith("switch."));
    return p ? { entity: p } : {};
  }
  static getConfigElement() { return document.createElement(EDITOR); }

  constructor() {
    super();
    this._onscreen = true;
    this._pills = new Map();
    this._expect = new Map();
  }

  setConfig(config) {
    if (!config?.entity) throw new Error('savvy-entity-card: "entity" (the main entity) is required');
    // chips: the one chip spec; `entities` is the pre-Savvy name
    const chips = asItems(config.chips ?? config.entities);
    this._config = { ...config, chips };
    if (this._el) { this._build(); if (this._hass) this._update(); }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._el) this._build();
    this._update();
  }

  connectedCallback() {
    this._observe();
    this._ticker = this._ticker || setInterval(() => { if (this._onscreen) this._tickTimes(); }, TICK_MS);
    this._wake();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._io?.disconnect();
    clearInterval(this._ticker);
    this._ticker = 0;
  }
  getCardSize() { return this._config?.chips?.length ? 2 : 1; }
  getGridOptions() { return { columns: 6, min_columns: 3, rows: "auto" }; }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._resetMotion();
    this._pills.clear();
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="main" id="main" role="button" tabindex="0">
          <span class="av" id="av"></span>
          <span class="txt"><span class="name" id="name"></span>
            <span class="sub" id="sub"><span class="st" id="st"></span><span class="since" id="since"></span></span></span>
        </div>
        <div class="pills" id="pills" role="group"></div>
      </ha-card>`;
    const $ = (id) => root.getElementById(id);
    this._el = { card: root.querySelector("ha-card"), main: $("main"), av: $("av"), name: $("name"), st: $("st"), since: $("since"), sub: $("sub"), pills: $("pills") };
    linkTitle(root, this._el.name, titlePathOf(this._config), (el, onTap) => this._pressable(el, { onTap, haptic: null }, 0.05));
    this._mainOn = this._spring(0, MOTION.ui, "main");
    this._mainAway = this._spring(0, MOTION.ui, "main");
    this._first = true;
    const c = this._config;
    this._pressable(this._el.main, {
      onTap: () => this._mainAct("tap"),
      onHold: () => this._mainAct("hold"),
      onDouble: c.double_tap_action ? () => this._mainAct("double_tap") : null,
      haptic: null,
    }, 0.035);
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => this._fitRow(this._el.pills));
    this._ro.observe(this._el.pills);
    this._observe();
  }

  _observe() {
    if (!this._el || !this.isConnected) return;
    this._io = this._io || new IntersectionObserver(([e]) => {
      this._onscreen = e.isIntersecting;
      if (this._onscreen) { this._tickTimes(); this._paintAll(null); this._wake(); }
    });
    this._io.disconnect();
    this._io.observe(this);
  }

  // ---------- the main entity ----------
  _mainAction(kind) {
    const c = this._config;
    const given = c[`${kind}_action`];
    if (given !== undefined) return legacyAction(given, c.entity);
    if (kind === "tap") return c.navigation_path ? { action: "navigate", navigation_path: c.navigation_path } : { action: "more-info" };
    if (kind === "hold") return { action: "more-info" };
    return null;
  }

  _mainAct(kind) {
    const c = this._config, h = this._hass, a = this._mainAction(kind);
    if (!a || a.action === "none") return;
    haptic("light");
    if (a.action === "toggle") return this._toggle(c.entity);
    // a button presses, a script or scene runs: the status line says so for a moment,
    // since a stateless entity has no state change of its own to show
    const svc = a.action === "perform-action" || a.action === "call-service" ? (a.perform_action || a.service || "") : "";
    const self = !a.target || [].concat(a.target.entity_id || []).includes(c.entity);
    if (self && /\.(press|turn_on)$/.test(svc) && STATELESS.has(domainOf(c.entity))) {
      if (isDown(h.states[c.entity])) return;
      runAction(this, h, a, { entity: c.entity });
      this._firedUntil = Date.now() + 1800;
      this._firedWord = svc.endsWith(".press") ? "Pressed" : "Running";
      clearTimeout(this._firedT);
      this._firedT = setTimeout(() => this._update(), 1850);
      return this._update();
    }
    runAction(this, h, a, { entity: c.entity });
  }

  _where(st) {
    if (!st) return { word: "Not found", icon: "mdi:help", away: false };
    if (isOff(st)) return { word: "Unavailable", icon: "mdi:help", away: false };
    if (st.state === "home") return { word: "Home", icon: "mdi:home", away: false };
    if (st.state === "not_home") return { word: "Away", icon: "mdi:home-export-outline", away: true };
    const zone = Object.values(this._hass.states).find((z) => z.entity_id.startsWith("zone.")
      && (z.attributes.friendly_name === st.state || z.entity_id === `zone.${st.state}`));
    return { word: stateText(this._hass, st), icon: zone?.attributes.icon || "mdi:map-marker", away: false };
  }

  _renderMain() {
    const h = this._hass, c = this._config, el = this._el, st = h.states[c.entity];
    const person = PEOPLE.has(domainOf(c.entity));
    const name = c.name || c.title || st?.attributes.friendly_name || title(c.entity.split(".")[1] || c.entity);
    text(el.name, name);
    attr(el.main, "data-off", !st || isOff(st));
    if (c.color) put(el.main, "--main-c", colorOf(c.color));
    let word, active, away = 0;
    if (person) {
      const w = this._where(st);
      word = w.word;
      active = !isOff(st);
      away = w.away ? 1 : 0;
      const pic = c.picture ?? st?.attributes.entity_picture;
      const want = `person|${pic || ""}|${initials(name)}`;
      if (el.av.__key !== want) {
        el.av.__key = want;
        attr(el.av, "data-kind", "person");
        el.av.innerHTML = `${pic ? `<img alt="" src="${esc(pic)}">` : `<span class="ini">${esc(initials(name))}</span>`}<span class="zone" aria-hidden="true"><ha-icon></ha-icon></span>`;
        const img = el.av.querySelector("img");
        // a picture that 404s falls back to initials rather than a broken image
        if (img) img.onerror = () => { img.replaceWith(Object.assign(document.createElement("span"), { className: "ini", textContent: initials(name) })); };
      }
      attr(el.av.querySelector(".zone ha-icon"), "icon", w.icon);
      el.av.querySelector(".zone").hidden = !st || isOff(st);
    } else {
      const k = c.icon ? "icon" : "state";
      if (el.av.__key !== k) {
        el.av.__key = k;
        attr(el.av, "data-kind", "icon");
        el.av.innerHTML = c.icon ? "<ha-icon></ha-icon>" : "<savvy-state-icon></savvy-state-icon>";
      }
      const ic = el.av.firstElementChild;
      if (c.icon) attr(ic, "icon", c.icon);
      else if (st && ic.stateObj !== st) { ic.hass = h; ic.stateObj = st; }
      active = !!st && !isOff(st) && !["off", "idle", "closed", "locked", "standby", "0"].includes(st.state);
      word = st ? stateText(h, st) : "Not found";
      // a button/scene/script's state is *when* it last ran, not a state
      if (st && STATELESS.has(domainOf(c.entity)) && st.state !== "unavailable") {
        const press = PRESSES.has(domainOf(c.entity));
        active = false;
        word = Number.isFinite(Date.parse(st.state)) ? (press ? "Last pressed" : "Last run") : (press ? "Never pressed" : "Never run");
      }
    }
    const fired = this._firedUntil && Date.now() < this._firedUntil;
    if (fired) { word = this._firedWord; active = true; }
    text(el.st, word);
    el.st.hidden = c.show_state === false && !fired;
    this._mainOn.to(active ? 1 : 0, MOTION.ui);
    // the glow: its colour while it is on, nothing otherwise (people at home, a switch on, a sensor reading on)
    const mainCss = c.color ? colorOf(c.color) : "";
    stateGlow(c, el.card, active && !person ? toRgb(mainCss && !mainCss.startsWith("var(") ? mainCss : "#588EE9") : null, 0.8);
    this._mainAway.to(away, MOTION.ui);
    el.main.__st = st;
    this._mainWord = word;
    this._tickTimes();
  }

  // ---------- the chips ----------
  _tapAction(item) {
    if (item.tap_action !== undefined) return legacyAction(item.tap_action, item.entity);
    if (item.navigation_path) return { action: "navigate", navigation_path: item.navigation_path };
    if (!item.entity) return null;
    const d = domainOf(item.entity);
    // locks and covers too: a chip is a quick control (the lock's more-info is a hold away)
    if (d === "lock" || d === "cover") return { action: "toggle" };
    return defaultTapAction(item.entity);
  }

  _kind(item) {
    const a = this._tapAction(item);
    if (!a) return "value";
    if (a.action === "navigate" && !item.entity) return "nav";
    if (a.action === "toggle") return "toggle";
    const svc = a.perform_action || a.service || "";
    if (/\.press$/.test(svc)) return "press";
    if (/\.turn_on$/.test(svc) && STATELESS.has(domainOf(item.entity))) return "turn_on";
    return "value";
  }

  _renderPills() {
    Motion.flip(this._el.pills, () => this._renderPillsNow());
  }

  _renderPillsNow() {
    const h = this._hass, list = this._config.chips, box = this._el.pills, seen = new Set();
    list.forEach((item, i) => {
      const key = `${i}|${item.entity || item.navigation_path}`;
      seen.add(key);
      let node = this._pills.get(key);
      if (!node) {
        node = document.createElement("div");
        node.className = "pill";
        node.innerHTML = `<span class="ic"></span><span class="cn"></span><span class="cv"></span>`;
        node.__el = { ic: node.querySelector(".ic"), v: node.querySelector(".cv"), n: node.querySelector(".cn") };
        attr(node, "role", "button");
        attr(node, "tabindex", "0");
        const cur = () => node.__item;
        this._pressable(node, {
          onTap: () => this._runPill(cur(), "tap"),
          onHold: () => this._runPill(cur(), "hold"),
          onDouble: item.double_tap_action ? () => this._runPill(cur(), "double_tap") : null,
          haptic: null,
        }, 0.035);
        node.__on = this._spring(0, MOTION.ui, `pill:${key}`);
        node.__enter = this._spring(0, MOTION.ui, `pill:${key}`).to(1, MOTION.ui);
        this._pills.set(key, node);
      }
      node.__item = item;
      place(box, node, i);
      this._renderPill(node, item, item.entity ? h.states[item.entity] : null);
    });
    for (const [key, node] of this._pills) {
      if (seen.has(key)) continue;
      for (const s of [node.__on, node.__enter, node.__spring]) { const k = this._springs.indexOf(s); if (k >= 0) this._springs.splice(k, 1); }
      const p = this._pressNodes.indexOf(node);
      if (p >= 0) this._pressNodes.splice(p, 1);
      node.remove();
      this._pills.delete(key);
    }
    box.hidden = !list.length;
    this._fitRow(box);
  }

  // A chip reads as its value ("On", "82 %", "Charging"); a configured name leads it
  // ("Charger On"); a toggle's on/off is carried by its tint as well as the word.
  _renderPill(node, item, st) {
    const h = this._hass, kind = this._kind(item);
    attr(node, "data-kind", kind);
    if (item.color) put(node, "--chip-c", colorOf(item.color));
    attr(node, "data-off", !!item.entity && isDown(st));
    const wantState = !item.icon && !!st;
    if (node.__iconKind !== (wantState ? "state" : "plain")) {
      node.__iconKind = wantState ? "state" : "plain";
      node.__el.ic.outerHTML = wantState ? `<savvy-state-icon class="ic"></savvy-state-icon>` : `<ha-icon class="ic"></ha-icon>`;
      node.__el.ic = node.querySelector(".ic");
    }
    if (wantState) { if (node.__el.ic.stateObj !== st) { node.__el.ic.hass = h; node.__el.ic.stateObj = st; } }
    else attr(node.__el.ic, "icon", item.icon || (kind === "nav" ? "mdi:arrow-right" : "mdi:help-circle-outline"));
    const on = kind === "toggle" ? this._isOn(item.entity, st) : kind === "value" && st?.state === "on";
    let value;
    if (kind === "nav") value = item.name || "Open";
    else if (!st) value = "Not found";
    else if (isDown(st)) value = "Unavailable";
    else if (kind === "toggle") value = on ? "On" : "Off";
    else value = chipState(h, st);
    // a button or a scene's own state says little ("Press", "Scene"); its name reads better
    if ((kind === "press" || kind === "turn_on") && item.name) value = item.name;
    const name = kind === "nav" || kind === "press" || kind === "turn_on" ? "" : (item.name || "");
    text(node.__el.v, value);
    const noState = item.show_state === false && kind !== "nav";
    node.__el.v.hidden = noState;
    attr(node, "data-nostate", noState && !!name);
    attr(node, "data-icononly", noState && !name);
    text(node.__el.n, name);
    node.__el.n.hidden = !name;
    const full = item.name || st?.attributes.friendly_name || item.entity || "";
    attr(node, "title", `${full}${kind !== "nav" ? `: ${value}` : ""}`);
    attr(node, "aria-label", kind === "nav" ? value : `${full}, ${value}`);
    attr(node, "aria-pressed", kind === "toggle" ? String(on) : null);
    node.__on.to(on ? 1 : 0, MOTION.ui);
  }

  // Optimism (CARD-DESIGN.md 4): a toggle shows the result the moment it's tapped and
  // reconciles when HA reports back; a guess HA never confirms expires.
  _isOn(id, st) {
    const exp = this._expect.get(id);
    if (exp) {
      if (Date.now() > exp.until || st?.state === exp.state) this._expect.delete(id);
      else return ["on", "open", "unlocked"].includes(exp.state);
    }
    return ["on", "open", "unlocked"].includes(st?.state);
  }

  _runPill(item, kind) {
    const h = this._hass, st = item.entity ? h.states[item.entity] : null;
    let a = kind === "tap" ? this._tapAction(item) : item[`${kind}_action`] !== undefined ? legacyAction(item[`${kind}_action`], item.entity) : { action: "more-info" };
    if (!a || a.action === "none") return;
    haptic("light");
    if (a.action === "toggle") { if (st && !isDown(st)) this._toggle(item.entity); return; }
    if (item.entity && !st && a.action !== "navigate") return;
    if (st && isDown(st) && a.action !== "more-info") return;
    runAction(this, h, a, { entity: item.entity });
  }

  _toggle(id) {
    const h = this._hass, d = domainOf(id), st = h.states[id];
    if (!st || isOff(st)) return;
    const on = this._isOn(id, st);
    // lock and cover have no toggle service: say what's meant
    if (d === "lock") h.callService("lock", on ? "lock" : "unlock", {}, { entity_id: id });
    else if (d === "cover") h.callService("cover", on ? "close_cover" : "open_cover", {}, { entity_id: id });
    else toggleEntity(h, id);
    const next = d === "lock" ? (on ? "locked" : "unlocked") : d === "cover" ? (on ? "closed" : "open") : on ? "off" : "on";
    this._expect.set(id, { state: next, until: Date.now() + PREDICT_MS });
    setTimeout(() => this._update(), PREDICT_MS + 50);
    this._update();
  }

  _update() {
    const h = this._hass;
    if (!h || !this._el) return;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    this._renderMain();
    this._renderPills();
    if (this._first) { this._first = false; requestAnimationFrame(() => this._paintAll(null)); }
    this._wake();
  }

  _tickTimes() {
    const el = this._el, st = el?.main.__st;
    if (!el) return;
    const stateless = st && STATELESS.has(domainOf(st.entity_id));
    const fired = this._firedUntil && Date.now() < this._firedUntil;
    const t = !st ? NaN : stateless ? Date.parse(st.state) : Date.parse(st.last_changed);
    const show = this._config.show_since !== false && st && !fired && (stateless ? Number.isFinite(t) : !isOff(st));
    const label = show ? since(t, !stateless) : "";
    text(el.since, label);
    el.sub.hidden = el.st.hidden && !label;
    attr(el.since, "title", show && Number.isFinite(t) ? `Since ${clockTime(t, langOf(this._hass))}` : null);
    attr(el.main, "aria-label", `${el.name.textContent}, ${this._mainWord || ""}${label ? `, ${label}` : ""}`);
  }

  _paint(dirty, all, red) {
    if (all || dirty.has("main")) {
      put(this._el.main, "--on", clamp(this._mainOn.x).toFixed(3));
      put(this._el.main, "--away", clamp(this._mainAway.x).toFixed(3));
    }
    for (const [key, node] of this._pills) {
      if (!all && !dirty.has(`pill:${key}`)) continue;
      put(node, "--on", clamp(node.__on.x).toFixed(3));
      const v = clamp(node.__enter.x);
      if (!node.hasAttribute("data-off")) put(node, "opacity", v > 0.999 ? "" : v.toFixed(3));
      put(node, "translate", red || v > 0.999 ? "" : `0 ${((1 - v) * 4).toFixed(2)}px`);
    }
  }
}

// ---------- editor ----------
const EDITOR = defineEditor("savvy-entity-card", (hass, c) => [
  S.entity("entity", "Entity", null, { helper: "A person gets their picture, zone and how long they've been there." }),
  S.grid(S.text("name", "Name"), S.icon("icon", "Icon")),
  S.titleLink("name"),
  S.grid(S.color("color", "Colour"), { name: "picture", label: "Picture", helper: "A person's picture, instead of theirs in HA.", selector: { text: {} } }),
  S.grid(S.bool("show_state", "Show state", null, true), S.bool("show_since", "Show since", null, true)),
  S.nav("navigation_path", "Target page", "Empty: tapping opens more-info (or set a tap action below)."),
  S.section("Actions", [S.action("tap_action", "Tap action"), S.action("hold_action", "Hold action"), S.action("double_tap_action", "Double tap action")]),
  S.chips("chips", "Custom chips", "Entities that belong with it: a toggle toggles, a button presses, anything else shows its value."),
]);

registerCard("savvy-entity-card", SavvyEntityCard, "Entity",
  "One main entity (a person gets their picture and zone) with the entities that belong with it as chips.");
})();

// ===== cards/graph.js =====
(() => {
// savvy-graph-card: a tile per entity, each one finding its own kind from its state.
//   graph   a number that's reporting (not a timestamp): a chart, two per row at every
//           width. Smoothed line over a fading fill, dashed average, min and max, an axis,
//           a scrub bubble (hover, or press and hold still). Thresholds colour it
//           good / warn / bad down the value axis. With no history yet it keeps its shape.
//   state   anything else (on/off, a timestamp, text): a small tile with its state.
//
// Each graph shows its own hours_to_show, else the card's; graphs sharing a range share
// one history call. An hours selector is opt-in (ranges: [24, 168, 720]) and drives every
// graph that hasn't pinned its own. Past a week, graphs read long-term statistics.
//
//   type: custom:savvy-graph-card
//   title: System
//   entities:
//     - entity: sensor.server_cpu
//       thresholds: [{ value: 0, level: good }, { value: 60, level: warn }, { value: 85, level: bad }]
//     - entity: sensor.living_room_temperature
//       thresholds: temperature            a preset: blue, teal, green, amber, red (also humidity, battery)
//       smooth: true                       blend through the colours between the thresholds
//     - entity: sensor.power
//       thresholds: [{ value: 0, color: blue }, { value: 500, color: orange }, { value: 2000, color: "#e53935" }]
//     - entity: sensor.humidity
//       color: teal                        one colour for the whole graph

const CHART_H = 72;
const SCRUB_SLOP = 6;        // press-and-dwell: move sooner and it's a scroll, hold still and it scrubs
const SCRUB_DWELL = 140;

// The level whose value the reading has most recently crossed.
function levelOf(value, thresholds) {
  if (!thresholds?.length || !Number.isFinite(value)) return null;
  let level = null;
  for (const t of [...thresholds].sort((a, b) => a.value - b.value)) if (value >= t.value) level = t.level;
  return level;
}

// ---- colour scales: thresholds with a level (good / warn / bad) or any colour, hard steps or smooth ----
// Presets are written in °C; a Fahrenheit sensor gets the same scale converted. A preset below its first
// stop keeps the first colour (the -1000 stop).
const SCALE_PRESETS = {
  temperature: { smooth: true, stops: [[-1000, "blue"], [12, "teal"], [18, "green"], [25, "amber"], [30, "red"]] },
  humidity: { stops: [[-1000, "amber"], [30, "green"], [60, "amber"], [70, "red"]] },
  battery: { stops: [[-1000, "red"], [15, "amber"], [40, "green"]] },
};

// -> { stops: [{ v, c }] sorted ascending, smooth } | null. c is a CSS colour.
function scaleOf(item, unit) {
  let raw = item.thresholds, smooth = item.smooth;
  if (typeof raw === "string") {
    const p = SCALE_PRESETS[raw.trim().toLowerCase()];
    if (!p) return null;
    const f = /f/i.test(String(unit || "")) && raw.trim().toLowerCase() === "temperature";
    raw = p.stops.map(([v, c]) => ({ value: f && v > -1000 ? v * 9 / 5 + 32 : v, color: c }));
    if (smooth === undefined) smooth = !!p.smooth;
  }
  if (!Array.isArray(raw) || !raw.length) return null;
  const stops = raw.map((t) => ({ v: Number(t.value), c: t.color ? colorOf(t.color) : t.level ? `var(--lvl-${t.level})` : "" }))
    .filter((t) => Number.isFinite(t.v)).sort((a, b) => a.v - b.v);
  return stops.length ? { stops, smooth: !!smooth } : null;
}

// The colour a reading has on the scale: hard steps by default (below the first stop: none), a blend
// between neighbouring stops when smooth. "" means the card's own colour.
function scaleColor(scale, v) {
  if (!scale || !Number.isFinite(v)) return "";
  const st = scale.stops;
  let i = -1;
  for (let k = 0; k < st.length; k++) if (v >= st[k].v) i = k;
  if (!scale.smooth) return i < 0 ? "" : st[i].c;
  if (i < 0) return st[0].c;
  if (i >= st.length - 1) return st[i].c;
  const a = st[i], b = st[i + 1];
  if (!a.c || !b.c || a.c === b.c) return a.c || b.c;
  const t = (v - a.v) / (b.v - a.v);
  return t <= 0.001 ? a.c : t >= 0.999 ? b.c : `color-mix(in oklab, ${b.c} ${(t * 100).toFixed(1)}%, ${a.c})`;
}

const STYLE = `${BASE_CSS}
  ha-card { display: flex; flex-direction: column; gap: 10px; padding: var(--pad); }
  .head { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .head .ht { flex: 1; min-width: 0; font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ranges { position: relative; flex: none; display: flex; gap: 2px; padding: 3px; border-radius: 11px; background: var(--well); }
  .ranges .sel { position: absolute; top: 3px; bottom: 3px; left: 0; border-radius: 8px; pointer-events: none;
    background: var(--ha-card-background, var(--card-background-color)); box-shadow: 0 1px 3px rgb(0 0 0 / 0.14), 0 0 0 0.5px rgb(0 0 0 / 0.04); }
  :host([dark]) .ranges .sel { background: color-mix(in oklab, var(--primary-text-color) 14%, transparent); box-shadow: none; }
  .rseg { position: relative; height: 24px; padding: 0 9px; border-radius: 8px; display: flex; align-items: center; cursor: pointer;
    font-size: 11.5px; line-height: 16px; font-weight: 550; color: var(--secondary-text-color); transform-origin: 50% 50%; }
  .rseg[data-sel] { color: var(--primary-text-color); }
  .graphs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .grid { display: grid; grid-template-columns: repeat(var(--cols, auto-fill), minmax(92px, 1fr)); gap: 8px; }
  .tile { position: relative; container-type: inline-size; box-sizing: border-box; display: flex; flex-direction: column; gap: 5px; min-width: 0;
    padding: 10px; border-radius: calc(var(--radius) * 0.6); background: var(--well); text-align: start; transform-origin: 50% 50%; cursor: pointer; }
  .tile[data-missing], .tile[data-unavailable] { opacity: 0.55; }
  .tile .top { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .tile .top ha-icon, .tile .top savvy-state-icon { --mdc-icon-size: 16px; display: flex; flex: none; color: var(--tile-lvl, var(--secondary-text-color)); }
  .tile .cap { min-width: 0; flex: 1; font-size: 13px; line-height: 16px; font-weight: 600; letter-spacing: -0.006em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile .val { display: flex; align-items: baseline; gap: 3px; min-width: 0; font-size: 14px; line-height: 17px; font-weight: 650; letter-spacing: -0.012em; }
  .tile .val .u { font-size: 12px; line-height: 16px; font-weight: 500; letter-spacing: -0.003em; color: var(--secondary-text-color); }
  .tile .note { font-size: 10.5px; line-height: 13px; font-weight: 500; letter-spacing: 0.006em; color: var(--secondary-text-color); }
  .tile[data-graph] .val { font-size: 19px; line-height: 23px; letter-spacing: -0.02em; }
  .tile[data-graph] .val .u { font-size: 12.5px; }
  .tile .chart { position: relative; height: ${CHART_H}px; margin-top: 2px; touch-action: pan-y; }
  .tile .chart svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
  .tile .axis { display: flex; justify-content: space-between; margin-top: 2px; font-size: 10px; line-height: 12px; font-weight: 500; letter-spacing: 0.01em;
    color: var(--secondary-text-color); opacity: 0.8; }
  .tile .bubble { position: absolute; top: -8px; left: 0; z-index: 1; display: flex; gap: 6px; align-items: center; font-size: 11px; line-height: 14px; font-weight: 600;
    letter-spacing: -0.004em; padding: 3px 7px; border-radius: 8px; white-space: nowrap; pointer-events: none;
    background: color-mix(in oklab, var(--primary-text-color) 10%, var(--ha-card-background, var(--card-background-color))); box-shadow: 0 4px 14px rgb(0 0 0 / 0.16); opacity: 0; }
  .tile .bubble .t { color: var(--secondary-text-color); font-weight: 550; }
  .tile .cnote { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; font-size: 11px; line-height: 14px; font-weight: 500;
    color: var(--secondary-text-color); border-radius: 8px; background: color-mix(in oklab, var(--primary-text-color) 3%, transparent); }
  @media (prefers-contrast: more) { .tile .val .u, .tile .note { color: var(--primary-text-color); opacity: 0.85; } }
  @container (max-width: 76px) { .tile .cap { display: none; } }
  @container (max-width: 200px) { .tile .axis .mid { display: none; } }
`;

class SavvyGraphCard extends SavvyCard {
  static getStubConfig(hass) {
    const ids = Object.keys(hass?.states || {}).filter((id) => id.startsWith("sensor.") && hass.states[id].attributes.state_class === "measurement").slice(0, 2);
    return { entities: ids.length ? ids : [] };
  }
  static getConfigElement() { return document.createElement(EDITOR); }

  constructor() {
    super();
    this._onscreen = true;
    this._tiles = new Map();
    this._series = {};
  }

  setConfig(config) {
    const entities = asItems(config?.entities);
    if (!entities.length) throw new Error('savvy-graph-card: an "entities" list is required');
    this._config = { hours_to_show: 24, ...config, entities };
    const hours = Number(this._config.hours_to_show) || 24;
    const ranges = [].concat(config.ranges || []).map(Number).filter((n) => n > 0);
    this._ranges = !ranges.length || ranges.includes(hours) ? ranges : [...ranges, hours].sort((a, b) => a - b);
    this._hours = hours;
    this._rawBy = new Map();
    this._raw = null;
    this._series = {};
    if (this._el) { this._build(); if (this._hass) this._update(); }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._el) this._build();
    this._update();
    this._loadHistory();
  }

  connectedCallback() { this._observe(); this._wake(); }
  disconnectedCallback() { super.disconnectedCallback(); this._io?.disconnect(); }
  getCardSize() { return 2; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: "auto" }; }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._resetMotion();
    this._first = true;
    this._tiles = new Map();
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="head" id="head" hidden><span class="ht" id="ht"></span>
          <div class="ranges" id="ranges" role="group" aria-label="History range" hidden><span class="sel"></span></div></div>
        <div class="graphs" id="graphs" hidden></div>
        <div class="grid" id="grid" hidden></div>
      </ha-card>`;
    const $ = (id) => root.getElementById(id);
    this._el = { card: root.querySelector("ha-card"), head: $("head"), ht: $("ht"), ranges: $("ranges"), graphs: $("graphs"), grid: $("grid") };
    text(this._el.ht, this._config.title || "");
    linkTitle(root, this._el.ht, titlePathOf(this._config), (el, onTap) => this._pressable(el, { onTap }, 0.04));
    if (this._config.columns) put(this._el.grid, "--cols", this._config.columns);
    this._rangeX = this._spring(0, MOTION.pill, "ranges", 0.02);
    this._rangeW = this._spring(0, MOTION.pill, "ranges", 0.02);
    for (const hours of this._ranges) {
      const seg = document.createElement("span");
      seg.className = "rseg";
      seg.__hours = hours;
      attr(seg, "role", "button");
      attr(seg, "tabindex", "0");
      text(seg, hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`);
      this._pressable(seg, { onTap: () => this._setRange(hours), haptic: null }, 0.04);
      this._el.ranges.appendChild(seg);
    }
    // charts draw at their real pixel size, so strokes and labels never stretch
    this._ro?.disconnect();
    this._ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const node = e.target.__node;
        if (!node) { this._rangeGeom(); continue; }
        node.__W = e.contentRect.width;
        node.__H = e.contentRect.height;
        node.__chartDirty = true;
      }
      this._wake();
    });
    this._ro.observe(this._el.ranges);
    this._observe();
  }

  _observe() {
    if (!this._el || !this.isConnected) return;
    this._io = this._io || new IntersectionObserver(([e]) => { this._onscreen = e.isIntersecting; if (this._onscreen) this._wake(); });
    this._io.disconnect();
    this._io.observe(this);
  }

  // ---------- history ----------
  _isGraph(st) {
    if (!st || isOff(st) || isTimestamp(st)) return false;
    return Number.isFinite(parseFloat(st.state));
  }
  _hoursFor(item) { return Number(item.hours_to_show) || this._hours; }
  // a tile can chart one attribute of an entity (a weather entity's humidity)
  _sk(item) { return item.attribute ? `${item.entity}#${item.attribute}` : item.entity; }
  _stateOf(h, item) {
    const st = h.states[item.entity];
    if (!item.attribute || !st) return st;
    const v = st.attributes[item.attribute];
    return { ...st, state: v == null ? "unavailable" : String(v), attributes: { ...st.attributes, unit_of_measurement: item.unit ?? "" } };
  }

  // Graphs sharing a range share one round-trip; each answer is kept for a minute, so
  // flipping the selector back and forth doesn't refetch.
  async _loadHistory() {
    const h = this._hass, groups = new Map(), attrs = [];
    for (const item of this._config.entities) {
      if (!this._isGraph(this._stateOf(h, item))) continue;
      const hours = this._hoursFor(item);
      if (item.attribute) { attrs.push({ id: item.entity, attribute: item.attribute, hours }); continue; }
      (groups.get(hours) || groups.set(hours, []).get(hours)).push(item.entity);
    }
    const key = [...[...groups].map(([hours, ids]) => `${hours}:${ids.join(",")}`), ...attrs.map((a) => `${a.hours}:${a.id}#${a.attribute}`)].join("|");
    if (!key) return;
    const cached = this._rawBy.get(key);
    if (cached && Date.now() - cached.at < 60000) {
      if (this._raw !== cached.raw) { this._raw = cached.raw; this._buildSeries(); this._update(); }
      return;
    }
    if (this._loading === key) return;
    this._loading = key;
    const raw = {};
    await Promise.all([...groups].map(async ([hours, ids]) => {
      try { Object.assign(raw, await fetchRange(h, ids, hours)); } catch (err) { /* that group shows no history */ }
    }).concat(attrs.map(async (a) => {
      try { raw[`${a.id}#${a.attribute}`] = await fetchAttributeHistory(h, a.id, a.attribute, a.hours); } catch (err) { /* no history for it */ }
    })));
    if (this._loading !== key) return;
    this._loading = null;
    this._rawBy.set(key, { raw, at: Date.now() });
    this._raw = raw;
    this._buildSeries();
    this._update();
  }

  _buildSeries() {
    const h = this._hass, end = Date.now(), out = {};
    for (const item of this._config.entities) {
      const rows = this._raw?.[this._sk(item)];
      if (!rows) continue;
      const start = end - this._hoursFor(item) * 3600000;
      const pts = numericPoints(rows, this._stateOf(h, item)?.state, end);
      const sampled = pts.length < 2 ? [] : resample(pts, start, end);
      out[this._sk(item)] = sampled.length < 2 ? null : { points: sampled, span: [start, end], ...seriesStats(sampled) };
    }
    this._series = out;
  }

  _setRange(hours) {
    if (hours === this._hours) return;
    this._hours = hours;
    haptic("selection");
    this._syncRanges();
    this._raw = null;
    this._series = {};
    this._update();
    this._loadHistory();
  }

  _syncRanges() {
    [...this._el.ranges.querySelectorAll(".rseg")].forEach((seg, i) => {
      const sel = seg.__hours === this._hours;
      attr(seg, "data-sel", sel);
      attr(seg, "aria-pressed", String(sel));
      if (sel) this._rangeIdx = i;
    });
    this._rangeGeom();
  }

  _rangeGeom() {
    const sel = this._el?.ranges.querySelectorAll(".rseg")[this._rangeIdx];
    if (!sel || !sel.offsetWidth) return;
    if (this._rangeW.x === 0) { this._rangeX.snap(sel.offsetLeft); this._rangeW.snap(sel.offsetWidth); }
    else { this._rangeX.to(sel.offsetLeft, MOTION.pill); this._rangeW.to(sel.offsetWidth, MOTION.pill); }
    this._wake();
  }

  // ---------- tiles ----------
  _update() {
    const h = this._hass;
    if (!h || !this._el) return;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    this._renderTiles();
    if (this._first) { this._first = false; requestAnimationFrame(() => this._paintAll(null)); }
    this._wake();
  }

  _renderTiles() {
    Motion.flip([this._el.graphs, this._el.grid], () => this._renderTilesNow());
  }

  _renderTilesNow() {
    const h = this._hass, cfg = this._config, el = this._el, seen = new Set();
    let graphs = 0, small = 0, gi = 0, si = 0;
    for (const item of cfg.entities) {
      const key = this._sk(item);
      seen.add(key);
      const graph = this._isGraph(this._stateOf(h, item));
      if (graph) graphs++; else small++;
      const box = graph ? el.graphs : el.grid;
      let node = this._tiles.get(key);
      if (!node) {
        node = document.createElement("div");
        node.className = "tile";
        node.innerHTML = `<span class="top"><span class="iconSlot"></span><span class="cap"></span></span>
          <span class="val"><span class="n"></span><span class="u"></span></span>
          <span class="note" hidden></span>
          <div class="chart" hidden><svg focusable="false" aria-hidden="true"></svg><span class="bubble"></span><span class="cnote" hidden></span></div>
          <div class="axis" hidden aria-hidden="true"><span></span><span class="mid"></span><span>Now</span></div>`;
        node.__el = { iconSlot: node.querySelector(".iconSlot"), cap: node.querySelector(".cap"), n: node.querySelector(".val .n"), u: node.querySelector(".val .u"),
          note: node.querySelector(".note"), chart: node.querySelector(".chart"), svg: node.querySelector("svg"), bubble: node.querySelector(".bubble"),
          axis: node.querySelector(".axis"), ax: [...node.querySelectorAll(".axis span")], cnote: node.querySelector(".cnote") };
        node.__el.chart.__node = node;
        this._ro.observe(node.__el.chart);
        attr(node, "role", "button");
        attr(node, "tabindex", "0");
        const act = (kind) => () => {
          const it = node.__item, a = it[`${kind}_action`];
          runAction(this, this._hass, a !== undefined ? a : { action: "more-info" }, { entity: it.entity });
        };
        this._pressable(node, { onTap: act("tap"), onHold: act("hold"), haptic: null }, 0.04);
        this._wireScrub(node, node.__el.chart);
        node.__enter = this._spring(0, MOTION.ui, `enter:${key}`).to(1, MOTION.ui);
        this._tiles.set(key, node);
      }
      this._renderTile(item, node);
      attr(node, "data-graph", graph);
      place(box, node, graph ? gi++ : si++);
    }
    el.graphs.hidden = !graphs;
    el.grid.hidden = !small;
    el.ranges.hidden = !graphs || this._ranges.length < 2;
    el.head.hidden = !cfg.title && el.ranges.hidden;
    if (!el.ranges.hidden) this._syncRanges();
    for (const [key, node] of this._tiles) {
      if (seen.has(key)) continue;
      for (const s of [node.__enter, node.__reveal, node.__value, node.__scrub, node.__scrubX, node.__spring]) {
        const i = this._springs.indexOf(s);
        if (i >= 0) this._springs.splice(i, 1);
      }
      const p = this._pressNodes.indexOf(node);
      if (p >= 0) this._pressNodes.splice(p, 1);
      node.remove();
      this._tiles.delete(key);
    }
  }

  _renderTile(item, node) {
    const h = this._hass, st = this._stateOf(h, item), el = node.__el;
    node.__item = item;
    const missing = !st, unavailable = !missing && isOff(st);
    attr(node, "data-missing", missing);
    attr(node, "data-unavailable", unavailable);
    text(el.cap, item.name || (item.attribute ? title(item.attribute) : st?.attributes.friendly_name) || title(item.entity.split(".")[1] || item.entity));
    const wantState = !item.icon && !item.attribute && !!st;
    if (node.__iconKind !== (wantState ? "state" : "plain")) {
      node.__iconKind = wantState ? "state" : "plain";
      el.iconSlot.innerHTML = wantState ? "<savvy-state-icon></savvy-state-icon>" : "<ha-icon></ha-icon>";
      el.icon = el.iconSlot.firstElementChild;
    }
    if (wantState) { if (el.icon.stateObj !== st) { el.icon.hass = h; el.icon.stateObj = st; } }
    else attr(el.icon, "icon", item.icon || "mdi:help-circle-outline");

    const numeric = this._isGraph(st);
    const series = numeric ? this._series[this._sk(item)] : undefined;
    if (!numeric) { el.chart.hidden = true; el.axis.hidden = true; }
    if (missing || unavailable) {
      el.n.parentElement.hidden = true;
      el.note.hidden = false;
      text(el.note, missing ? "Not found" : "Unavailable");
      Motion.tintVar(node, "--tile-lvl", "");
    } else if (numeric) {
      el.n.parentElement.hidden = false;
      const value = parseFloat(st.state);
      if (!node.__value) node.__value = this._spring(value, MOTION.text, `value:${item.entity}`);
      else node.__value.to(value, MOTION.text);
      const unit = item.unit ?? st.attributes.unit_of_measurement ?? "";
      const own = item.color ? colorOf(item.color) : "";
      Motion.tintVar(node, "--tile-lvl", scaleColor(scaleOf(item, unit), value) || own);
      text(el.u, unit);
      node.__unit = unit;
      el.chart.hidden = false;
      el.axis.hidden = false;
      el.cnote.hidden = !!series;
      if (series) {
        el.note.hidden = true;
        // the line draws itself in once per range, never on a routine refresh
        if (node.__revealFor !== this._hoursFor(item)) {
          node.__revealFor = this._hoursFor(item);
          if (!node.__reveal) node.__reveal = this._spring(0, MOTION.graph, `reveal:${item.entity}`);
          node.__reveal.snap(0).to(1, MOTION.graph);
        }
        if (!node.__scrub) {
          node.__scrub = this._spring(0, MOTION.scrub, `scrub:${item.entity}`);
          node.__scrubX = this._spring(0, MOTION.scrub, `scrub:${item.entity}`);
        }
        node.__series = series;
        node.__chartDirty = true;
      } else {
        // said where the graph would be, so the tile keeps its shape
        el.note.hidden = true;
        text(el.cnote, this._loading || !this._raw ? "Loading history…" : "No history yet");
        node.__series = null;
        if (el.svg.__key) { el.svg.__key = ""; el.svg.innerHTML = ""; }
        el.axis.hidden = true;
        if (node.__scrub) { node.__scrub.snap(0); node.__scrubX.snap(0); }
        put(el.bubble, "opacity", "0");
      }
    } else {
      // a plain state: on/off, a timestamp, text
      el.n.parentElement.hidden = false;
      el.note.hidden = true;
      node.__unit = "";
      node.__value = null;
      Motion.tintVar(node, "--tile-lvl", item.state_color && domainOf(item.entity) === "binary_sensor"
        ? (st.state === "on" ? "var(--lvl-good)" : st.state === "off" ? "var(--lvl-bad)" : "") : "");
      let words = null;
      if (isTimestamp(st)) { const t = Date.parse(st.state); if (Number.isFinite(t)) words = relativeTime(t, langOf(h)); }
      text(el.n, words ?? stateText(h, st));
      text(el.u, "");
    }
  }

  // ---------- frames ----------
  _frame(now, dt) {
    const stepped = super._frame(now, dt);
    if (stepped) return true;
    // a resize with nothing moving still needs the charts redrawn at their new size
    if ([...this._tiles.values()].some((n) => n.__chartDirty)) { this._paintAll(new Set()); return true; }
    return false;
  }

  _paint(dirty, all) {
    if (all || dirty.has("ranges")) {
      const pill = this._el.ranges.querySelector(".sel"), w = Math.max(0, this._rangeW.x);
      put(pill, "opacity", w < 1 ? "0" : "");
      put(pill, "width", `${w.toFixed(2)}px`);
      put(pill, "transform", `translate3d(${this._rangeX.x.toFixed(2)}px,0,0)`);
    }
    const red = MQ.reduced.matches;
    for (const [key, node] of this._tiles) {
      if (node.__enter && (all || dirty.has(`enter:${key}`))) {
        const v = clamp(node.__enter.x);
        put(node, "opacity", v > 0.999 ? "" : v.toFixed(3));
        put(node, "translate", red || v > 0.999 ? "" : `0 ${((1 - v) * 4).toFixed(2)}px`);
      }
      if (node.__value && (all || dirty.has(`value:${key}`))) text(node.__el.n, fmtNumber(node.__value.x));
      const chart = node.__chartDirty || (node.__reveal && (all || dirty.has(`reveal:${key}`))) || (node.__scrub && (all || dirty.has(`scrub:${key}`)));
      if (chart && node.__series) this._paintChart(node, key);
      node.__chartDirty = false;
    }
  }

  // The climate card's chart at tile scale, in real pixels.
  _paintChart(node, key) {
    const series = node.__series, el = node.__el, W = node.__W, H = node.__H;
    if (!series?.points?.length || !W || !H) return;
    const [t0, t1] = series.span, item = node.__item, lang = langOf(this._hass);
    const PT = 13, PB = 12;
    const pad = Math.max((series.max - series.min) * 0.12, Math.abs(series.max) * 0.002, 1e-6);
    const lo = series.min - pad, hi = series.max + pad;
    const xOf = (t) => ((t - t0) / Math.max(1, t1 - t0)) * W;
    const yOf = (v) => PT + (1 - (v - lo) / Math.max(1e-6, hi - lo)) * (H - PT - PB);
    const pts = series.points.map((p) => [xOf(p.t), yOf(p.v)]);
    const d = linePath(pts);
    const f = (v) => v.toFixed(2);
    const id = key.replace(/[^a-zA-Z0-9]/g, "_");
    const unit = node.__unit || "";
    // with thresholds, their colours down the value axis (steps, or blended when smooth); otherwise the
    // entity's own colour, else the accent
    const base = item.color ? colorOf(item.color) : "rgb(var(--accent))";
    const scale = scaleOf(item, unit);
    const colorAt = (v) => scaleColor(scale, v) || base;
    const th = scale;
    let stops;
    if (scale && scale.smooth) {
      // the browser blends stops in sRGB; sampling the oklab blend keeps the middle of a blue-to-red from going muddy
      stops = [];
      const n = 16;
      for (let k = 0; k <= n; k++) stops.push({ o: k / n, c: colorAt(hi - (hi - lo) * (k / n)) });
    } else if (scale) {
      stops = [{ o: 0, c: colorAt(hi) }];
      for (const t of [...scale.stops].reverse()) {
        if (t.v <= lo || t.v >= hi) continue;
        const o = (hi - t.v) / (hi - lo);
        stops.push({ o: clamp(o - 0.015), c: colorAt(t.v) });
        stops.push({ o: clamp(o + 0.015), c: colorAt(t.v - 1e-9) });
      }
      stops.push({ o: 1, c: colorAt(lo) });
    } else stops = [{ o: 0, c: base }, { o: 1, c: base }];
    const grad = stops.map((s) => `<stop offset="${f(s.o)}" style="stop-color:${s.c}"></stop>`).join("");
    const lastColor = colorAt(series.points[series.points.length - 1].v);
    let labels = "";
    for (const ex of [{ p: series.maxAt, v: series.max, up: true }, { p: series.minAt, v: series.min, up: false }]) {
      if (!ex.p || (!ex.up && series.max - series.min < 1e-9)) continue;
      const x = xOf(ex.p.t), y = yOf(ex.v);
      labels += `<circle cx="${f(x)}" cy="${f(y)}" r="2.25" fill="currentColor" fill-opacity="0.55"></circle>`
        + `<text x="${f(clamp(x, 16, W - 16))}" y="${f(ex.up ? y - 5 : y + 11)}" text-anchor="middle" fill="currentColor" fill-opacity="0.55" font-size="9.5" font-weight="600">${fmtNumber(ex.v)}${esc(unit)}</text>`;
    }
    const avgY = yOf(series.avg);
    const html = `<defs>
        <clipPath id="r-${id}"><rect class="rv" x="-4" y="-16" width="${f(W + 8)}" height="${f(H + 32)}"></rect></clipPath>
        <linearGradient id="g-${id}" x1="0" y1="${f(PT)}" x2="0" y2="${f(H - PB)}" gradientUnits="userSpaceOnUse">${grad}</linearGradient>
        <linearGradient id="f-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.24"></stop><stop offset="1" stop-color="#fff" stop-opacity="0"></stop></linearGradient>
        <mask id="m-${id}"><rect x="0" y="0" width="${f(W)}" height="${f(H)}" fill="url(#f-${id})"></rect></mask></defs>
      <g clip-path="url(#r-${id})">
        <path d="${d} L${f(W)} ${f(H)} L0 ${f(H)} Z" fill="url(#g-${id})" mask="url(#m-${id})"></path>
        <line x1="0" y1="${f(avgY)}" x2="${f(W)}" y2="${f(avgY)}" stroke="currentColor" stroke-opacity="0.2" stroke-width="1" stroke-dasharray="2 4"></line>
        <path d="${d}" fill="none" stroke="url(#g-${id})" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"></path>
        ${labels}
      </g>
      <line class="cur" x1="0" y1="0" x2="0" y2="${f(H)}" stroke="currentColor" stroke-width="1" opacity="0"></line>
      <circle class="dot" r="3.5" opacity="0" style="fill:${lastColor}"></circle>`;
    if (el.svg.__key !== html) {
      el.svg.__key = html;
      el.svg.setAttribute("viewBox", `0 0 ${f(W)} ${f(H)}`);
      el.svg.innerHTML = html;
      el.svg.__rv = el.svg.querySelector(".rv");
      el.svg.__cur = el.svg.querySelector(".cur");
      el.svg.__dot = el.svg.querySelector(".dot");
      text(el.ax[0], axisLabel(t0, t1 - t0, lang));
      text(el.ax[1], axisLabel((t0 + t1) / 2, t1 - t0, lang));
    }
    const reveal = node.__reveal ? clamp(node.__reveal.x) : 1;
    attr(el.svg.__rv, "width", f(Math.max(0.01, reveal * (W + 8))));
    const s = node.__scrub ? clamp(node.__scrub.x) : 0;
    attr(el.svg.__cur, "opacity", s < 1e-3 ? "0" : (s * 0.35).toFixed(3));
    attr(el.svg.__dot, "opacity", s < 1e-3 ? "0" : s.toFixed(3));
    put(el.bubble, "opacity", s < 1e-3 ? "0" : s.toFixed(3));
    if (s < 1e-3) return;
    const x = clamp(node.__scrubX.x, 0, W);
    let best = 0, bd = Infinity;
    pts.forEach((q, i) => { const dd = Math.abs(q[0] - x); if (dd < bd) { bd = dd; best = i; } });
    const q = pts[best], pt = series.points[best];
    attr(el.svg.__cur, "transform", `translate(${f(q[0])} 0)`);
    attr(el.svg.__dot, "transform", `translate(${f(q[0])} ${f(q[1])})`);
    if (th) put(el.svg.__dot, "fill", colorAt(pt.v));
    const bhtml = `<span class="t">${esc(momentLabel(pt.t, t1 - t0, lang))}</span><span>${fmtNumber(pt.v)}${esc(unit)}</span>`;
    if (el.bubble.__html !== bhtml) { el.bubble.__html = bhtml; el.bubble.innerHTML = bhtml; }
    const bw = el.bubble.offsetWidth || 0;
    put(el.bubble, "transform", `translateX(${f(clamp(q[0] - bw / 2, 0, Math.max(0, W - bw)))}px)`);
  }

  // Hover with a mouse; press and hold still with a finger, so a scrub never fights a
  // scroll (CARD-DESIGN.md 3.2's dwell rule).
  _wireScrub(node, chart) {
    let touchId = null, x0 = 0, y0 = 0, live = false, timer = 0;
    const show = () => { live = true; haptic("selection"); node.__spring?.swallow?.(); node.__scrub.to(1, MOTION.scrub); };
    const hide = () => { if (!live) return; live = false; node.__scrub.to(0, MOTION.scrub); this._wake(); };
    const snapX = (e) => { const r = chart.getBoundingClientRect(); if (r.width) node.__scrubX.snap(clamp(e.clientX - r.left, 0, r.width)); };
    const track = (e) => { const r = chart.getBoundingClientRect(); if (!r.width) return; node.__scrubX.to(clamp(e.clientX - r.left, 0, r.width), MOTION.scrub); this._wake(); };
    chart.addEventListener("pointerenter", (e) => { if (e.pointerType !== "mouse" || !node.__series) return; snapX(e); show(); this._wake(); });
    chart.addEventListener("pointermove", (e) => {
      if (e.pointerType === "mouse") { if (live) track(e); return; }
      if (e.pointerId !== touchId) return;
      if (!live) { if (Math.hypot(e.clientX - x0, e.clientY - y0) < SCRUB_SLOP) return; clearTimeout(timer); touchId = null; return; }
      track(e);
    });
    chart.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
    chart.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" || e.button > 0 || !node.__series) return;
      touchId = e.pointerId; x0 = e.clientX; y0 = e.clientY; live = false;
      snapX(e);
      timer = setTimeout(() => {
        if (touchId !== e.pointerId) return;
        try { chart.setPointerCapture(e.pointerId); } catch (err) { /* best effort */ }
        show();
        this._wake();
      }, SCRUB_DWELL);
    });
    const end = (e) => { if (e.pointerType === "mouse" || e.pointerId !== touchId) return; touchId = null; clearTimeout(timer); hide(); };
    chart.addEventListener("pointerup", end);
    chart.addEventListener("pointercancel", end);
  }
}

// ---------- editor ----------
const EDITOR = defineEditor("savvy-graph-card", (hass, c) => [
  S.grid(S.text("title", "Title"), S.titleLink("title")),
  S.grid(S.number("hours_to_show", "Hours", 1, 8760, 1, "h"), S.number("columns", "Columns", 1, 8)),
  { name: "ranges", label: "Hours selector", helper: "Offer these ranges in the header (e.g. 24, 168, 720). Empty: no selector.",
    selector: { select: { multiple: true, custom_value: true, options: ["6", "24", "48", "168", "720"] } } },
  { name: "entities", label: "Tiles", type: "list", helper: "A number gets a graph; anything else a small tile with its state.",
    item: [
      { name: "entity", label: "Entity", selector: { entity: {} } },
      { name: "attribute", label: "Attribute", helper: "Chart one of the entity's attributes instead of its state (a weather entity's humidity).", selector: { text: {} } },
      { type: "grid", name: "", schema: [{ name: "name", label: "Name", selector: { text: {} } }, { name: "icon", label: "Icon", selector: { icon: {} } }] },
      { type: "grid", name: "", schema: [{ name: "unit", label: "Unit", selector: { text: {} } },
        { name: "hours_to_show", label: "Tile hours", selector: { number: { min: 1, max: 8760, mode: "box", unit_of_measurement: "h" } } }] },
      { name: "state_color", label: "State colours", selector: { boolean: {} } },
      S.color("color", "Colour"),
      { name: "smooth", label: "Smooth colours", helper: "Blend through the colours between the thresholds instead of switching at each one.", selector: { boolean: {} } },
      { name: "thresholds", label: "Colour scale", type: "list", presets: ["temperature", "humidity", "battery"], presetLabel: "Preset",
        helper: "The graph takes the colour of the value it is in. A preset, or your own thresholds.",
        empty: "No thresholds: one colour.",
        addButton: { label: "Add threshold", make: (items) => ({ value: items.length ? Number(items[items.length - 1].value || 0) + 10 : 0 }) },
        summary: (t) => ({ title: String(t.value ?? ""), sub: t.color || t.level || "" }),
        item: [
          { name: "value", label: "From", helper: "The colour starts at this value.", selector: { number: { mode: "box", step: "any" } } },
          S.color("color", "Colour"),
          { name: "level", label: "Level", helper: "Instead of a colour: good, warn or bad.", selector: { select: { mode: "dropdown", options: ["good", "warn", "bad"] } } },
        ] },
      { name: "tap_action", label: "Tap action", selector: { ui_action: {} } },
      { name: "hold_action", label: "Hold action", selector: { ui_action: {} } },
    ] },
]);

registerCard("savvy-graph-card", SavvyGraphCard, "Graph",
  "Tiles for numbers and states: a graph with its range, min, max and average for every number, a plain readout for the rest.");
})();

// ===== cards/home-header.js =====
(() => {
// savvy-home-header-card: the header at the top of any page that isn't a room. Two big chips on
// top, the control (a house mode, say: tap to change it) and health (the cog, with a count); the weather; and
// four chips that count by themselves, no helpers needed: lights on, the average indoor
// temperature, what's playing, and security. Hold any of them for the entities behind it.
//
//   type: custom:savvy-home-header-card
//   control: input_select.house_mode   (never guessed; hidden when unset): a select opens a picker,
//                                       a button or scene runs, a switch toggles, the rest open more-info
//   weather: auto | weather.home | false
//   health: { navigation_path: /lovelace/admin, watchman: [...], battery_threshold: 20, group_by: hub } | false
//   lights / climate / media / security: false | { entity, name, icon, color, navigation_path,
//       popup_button, popup_label, exclude, exclude_areas, sort, room_order, sort_toggle, bulk_action, tap_action, hold_action }
//       (exclude / exclude_areas: ignored entities and rooms, for the count and the popup alike; sort: room | recent
//       is how the popup lists them, with a Room | Recent switch at its top unless sort_toggle is false, and a bulk
//       action beside it (All off, Pause all, Lock all) unless bulk_action is false;
//       tap and hold both open the list of what's
//       counted, unless tap_action / hold_action say otherwise; the popup's page button leads to
//       navigation_path, or to the page its tap or hold action navigates to. navigation_path never
//       changes what a tap does)
//   room_order: [area ids]                          the rooms' order in the popups (and a chip's own room_order wins);
//                                                    the rest follow by name, "No room" last
//   chips: [...]                                     your own, after the four

// Without a control chip the header is one row: the home button, the chips, then the weather and the
// health cog at the end; the row slides sideways when it is wider than the card. With a control chip it
// stays two rows: the control, weather and cog on top, the chips below.
const ROW_CSS = `
  .row { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .row[data-single] { flex-direction: row; align-items: center; gap: 8px; margin: 0 -2px; padding: 0 2px; overflow-x: auto; overscroll-behavior-x: contain;
    touch-action: pan-x pan-y; scrollbar-width: none; scroll-snap-type: x proximity; }
  .row[data-single]::-webkit-scrollbar { display: none; }
  .row[data-single] .top, .row[data-single] .chips { display: contents; }
  .row[data-single] .pill, .row[data-single] .spacer { display: none; }
  .row[data-single] #home { order: 0; }
  .row[data-single] .chip { order: 1; }
  .row[data-single] .wx { order: 2; }
  .row[data-single] #health { order: 3; }
  .row[data-single][data-overflow] { -webkit-mask-image: linear-gradient(to left, transparent 0, #000 26px); mask-image: linear-gradient(to left, transparent 0, #000 26px); }
`;
const STYLE = `${BASE_CSS}${HEADER_CSS}${CHIP_ROW_CSS}${ROW_CSS}`;

// The four chips: how each counts, and its look.
const ALERT_COLOR = TONE.bad;
const AUTO = {
  lights: { name: "Lights", icon: "mdi:lightbulb", color: "#F5B83D", domain: "light" },
  climate: { name: "Climate", icon: "mdi:fan", color: "#7FC4E8", domain: ["climate", "sensor"] },
  media: { name: "Media", icon: "mdi:multimedia", color: "#C98BD9", domain: "media_player" },
  security: { name: "Security", icon: "mdi:shield-home", color: "#E6C48F", domain: ["lock", "alarm_control_panel", "binary_sensor"] },
};

class SavvyHomeHeaderCard extends SavvyCard {
  // the control is never guessed: a select's options (and their icons in the editor) only
  // appear once one is chosen
  static getStubConfig() { return {}; }
  static getConfigElement() { return document.createElement(EDITOR); }

  setConfig(config) {
    const c = { mode_label: "Home mode", ...config };
    // the pre-Savvy names: home_mode, weather as { entity }, admin, tiles
    c.control = config.show_control === false ? "" : config.control ?? config.home_mode;
    if (config.weather && typeof config.weather === "object") c.weather = config.weather.entity;
    if (config.show_home === false) c.home_path = "";
    if (config.health === undefined && config.admin) {
      const a = config.admin;
      c.health = { navigation_path: a.path, tap_action: a.path ? { action: "navigate", navigation_path: a.path } : undefined, watchman: a.watchman ?? a.entities, battery_threshold: a.battery_threshold,
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

  connectedCallback() {
    this._observe();
    this._wake();
    // the cog counts failed integrations, which Home Assistant only tells us about asynchronously
    this._onEntries = this._onEntries || (() => { this._sumFor = null; if (this._hass && this._el) this._update(); });
    entryStore.listeners.add(this._onEntries);
    // what this person dismissed on the health card leaves the cog's count too
    dismissStore.listeners.add(this._onEntries);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    entryStore.listeners.delete(this._onEntries);
    dismissStore.listeners.delete(this._onEntries);
  }
  getCardSize() { return 2; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: "auto" }; }

  _modeInfo() { return this._hass && modeInfo(this._hass, controlOf(this._config).entity, this._config); }
  _healthCfg() { const hc = this._config.health; return hc === false ? null : hc || {}; }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._resetMotion();
    this._picker?.close();
    this._picker = null;
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="row" id="row">
        <div class="top">
          <button class="glyph" id="home" aria-label="Home" hidden><ha-icon icon="mdi:home"></ha-icon></button>
          <button class="pill" id="pill" hidden>
            <span class="swap" id="swap"><ha-icon id="pillIcon"></ha-icon><span class="col"><span class="val" id="val"></span><span class="pre" id="pre"></span></span></span>
          </button>
          <span class="spacer" id="spacer"></span>
          <button class="wx" id="weather" hidden><savvy-state-icon id="wicon"></savvy-state-icon><span class="deg" id="wtemp"></span></button>
          <button class="glyph" id="health" aria-label="System health" hidden><ha-icon icon="mdi:cog"></ha-icon><span class="count" id="count" hidden></span></button>
        </div>
        <div class="chips" id="chips"></div>
        </div>
      </ha-card>`;
    const $ = (id) => root.getElementById(id);
    mountTitleLine(root, root.querySelector("ha-card"), this._config, (el, onTap) => this._pressable(el, { onTap }, 0.04));
    this._el = { card: root.querySelector("ha-card"), row: $("row"), home: $("home"), pill: $("pill"), swap: $("swap"), pillIcon: $("pillIcon"), val: $("val"), pre: $("pre"),
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
      { tap: { action: "list" }, hold: { action: "list" } });
    this._observe();
  }

  _observe() {
    if (!this._el || !this.isConnected) return;
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => { this._fitRow(this._el.chips); this._fitRow(this._el.row); });
    this._ro.observe(this._el.chips);
    this._ro.observe(this._el.row);
  }

  // The same list savvy-system-health-card shows, with the same options: its count is the cog's.
  _showHealth() {
    if (!this._healthSheet) {
      this._healthSheet = new Sheet(this, { title: "System health", onClose: () => { this._healthCard?.remove(); this._healthCard = null; } });
      this._healthSheet.el.classList.add("health-sheet");
    }
    const card = document.createElement("savvy-system-health-card");
    const { navigation_path, tap_action, hold_action, popup_button, popup_label, ...opts } = this._healthCfg() || {};
    this._healthSheet.setFooter(pageButton(this._healthCfg() || {}, "system health"));
    card.setConfig({ ...opts, source: "all", max_rows: 30, title: " ", columns: 1 });
    this._healthSheet.body.replaceChildren(card);
    card.hass = this._hass;
    this._healthCard = card;
    this._healthSheet.open(this._el.health);
  }

  _update() {
    const h = this._hass, c = this._config, el = this._el;
    if (!h || !el) return;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    el.home.hidden = !c.home_path || samePage(c.home_path); // no button to the page you are on
    const info = this._modeInfo();
    this._renderPill(info, c.mode_label);
    el.spacer.hidden = !!info;
    el.row.toggleAttribute("data-single", !info);
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

  // Exactly what savvy-system-health-card counts: broken references, offline devices, low batteries.
  _renderHealth() {
    const hc = this._healthCfg(), el = this._el;
    const h = this._hass;
    // the cog can be kept from people who are not administrators; no gap is left where it was
    el.health.hidden = !hc || hiddenFromUser(h, this._config, "health_cog");
    if (!hc) return;
    refreshConfigEntries(h);
    ensureDismissed(h);
    if (this._sumFor !== h.states || this._sumReg !== h.entities || this._sumDev !== h.devices || this._sumEntries !== entryStore.map || this._sumDismiss !== dismissStore.version) {
      this._sumDismiss = dismissStore.version;
      this._sumFor = h.states;
      this._sumReg = h.entities;
      this._sumDev = h.devices;
      this._sumEntries = entryStore.map;
      this._sum = healthSummary(h, hc);
    }
    const total = this._sum.total, warn = hc.warn_above ?? 6;
    Motion.tintVar(el.health, "--ac", total === 0 ? "var(--secondary-text-color)" : total < warn ? "var(--lvl-warn)" : "var(--lvl-bad)");
    attr(el.health, "data-alert", total > 0);
    const showCount = !!total && !hiddenFromUser(h, this._config, "health_badges");
    el.count.hidden = !showCount;
    text(el.count, String(total));
    attr(el.health, "aria-label", !showCount ? "System health" : `System health, ${total} need attention`);
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
    this._fitRow(this._el.row);
  }

  _auto(key, cfg) {
    const h = this._hass, base = AUTO[key];
    const own = cfg.entity && h.states[cfg.entity];
    const skip = ignoring(h, cfg);
    let value, ids, spin, pinned, alert = false, listTitle = cfg.name || base.name;
    if (key === "lights") {
      const l = houseLights(h, skip);
      value = l.on.length ? `${l.on.length} on` : "All off";
      ids = l.on.length ? l.on : l.all;
      listTitle = l.on.length ? "Lights on" : "Lights";
    } else if (key === "media") {
      const m = housePlaying(h, skip);
      value = m.on.length ? `${m.on.length} playing` : "Not playing";
      ids = m.on.length ? m.on : m.all;
    } else if (key === "climate") {
      const t = houseTemperature(h, skip);
      value = t.value == null ? "–" : `${t.value.toFixed(1)}${t.unit}`;
      ids = t.ids;
      spin = t.running.length ? fanRate(h.states[t.running[0]]) : 0;
    } else {
      const s = houseSecurity(h, skip);
      value = s.entity ? stateText(h, h.states[s.entity]) : s.open.length ? `${s.open.length} open` : "Secure";
      // a tripped leak / smoke / gas sensor is the loudest thing the house can say
      alert = s.tripped.length > 0;
      if (alert) value = securityAlertWord(h, s.tripped);
      // every lock is always there, in any state; then what is open (or, when nothing is, every
      // opening), then the safety sensors, then who is about: presence and motion
      const first = new Set([...(s.entity ? [s.entity] : []), ...s.locks]);
      const rest = (s.open.length ? s.open : s.ids.filter((id) => !s.safety.includes(id) && !s.presence.includes(id))).filter((id) => !first.has(id));
      ids = [...first, ...s.tripped, ...rest, ...s.safety.filter((id) => !s.tripped.includes(id)), ...s.presence];
      pinned = ids.slice(0, first.size + s.tripped.length);     // the alarm, the locks and anything tripped stay on top, whatever the sort
    }
    if (own) value = chipState(h, own);
    const snapshot = [...ids];     // what was counted when opened: turning one off keeps its row
    return {
      key, icon: cfg.icon || base.icon, entity: cfg.entity, color: alert ? ALERT_COLOR : colorOf(cfg.color) || base.color,
      value, caption: cfg.name || base.name, aria: `${cfg.name || base.name}, ${value}`,
      spin: key === "climate" ? spin : undefined,
      config: { ...cfg },
      defaults: { tap: { action: "list" }, hold: { action: "list" } },
      list: (from) => this._showList(listTitle, snapshot, cfg.color ? colorOf(cfg.color) : base.color, from, pageButton(cfg, cfg.name || base.name),
        { sort: cfg.sort === "recent" ? "recent" : "room", order: cfg.room_order ?? this._config.room_order, toggle: cfg.sort_toggle !== false, storeKey: key, pinned, bulk: cfg.bulk_action === false ? null : key }),
    };
  }

  _paint(dirty, all, red) {
    if (all || dirty.has("pill")) this._swap.paint(red);
  }
}

// ---------- editor ----------
const autoSection = (key, what) => ({ type: "expandable", name: key, title: `${AUTO[key].name} chip`, schema: [
  S.bool("hide", "Hide chip"),
  { name: "entity", label: "Entity override", helper: `Show this entity's state instead. Empty: ${what}`, selector: { entity: {} } },
  S.grid(S.text("name", "Name"), { name: "icon", label: "Icon", selector: { icon: { placeholder: AUTO[key].icon } } }),
  S.color(),
  S.nav("navigation_path", "Target page", "The popup gets a button to it."),
  S.bool("popup_button", "Page button", "In the popup, when there is a target page.", true),
  S.text("popup_label", "Button text", `Default: Open ${AUTO[key].name.toLowerCase()}`),
  { name: "exclude", label: "Ignored entities", helper: "Left out of the count and the popup.", selector: { entity: { multiple: true, domain: AUTO[key].domain } } },
  { name: "exclude_areas", label: "Ignored rooms", helper: "Everything in these rooms is left out.", selector: { area: { multiple: true } } },
  S.select("sort", "Sort by", [{ value: "room", label: "Room" }, { value: "recent", label: "Recent" }]),
  { name: "room_order", label: "Room order", helper: "Rooms listed first, in this order (the order you pick them in). Empty: the card's, then the settings'.", selector: { area: { multiple: true } } },
  S.bool("sort_toggle", "Sort toggle", "A Room | Recent switch at the top of the popup.", true),
  S.bool("bulk_action", "Bulk action", `${BULK[key].label} for everything listed, at the top of the popup.`, true),
  S.action("tap_action", "Tap action", "Default: open the list."),
  S.action("hold_action", "Hold action", "Default: open the list."),
] });

const EDITOR = defineEditor("savvy-home-header-card", (hass, c) => [
  S.grid(S.titleLine(), S.titleLink("title")),
  ...modeSchema(hass, c),
  S.nav("home_path", "Home button", "The page it opens. Empty: the one from the Savvy settings."),
  { name: "admin_only", label: "Admin only", helper: "Kept from people who are not administrators. Empty: from the Savvy settings; everyone sees everything unless it is listed here or there.",
    selector: { select: { multiple: true, options: [{ value: "health_cog", label: "Health cog" }, { value: "health_badges", label: "Health count badge" }] } } },
  S.bool("show_home", "Show home button", "Off hides it, even when the Savvy settings have a home page.", true),
  S.bool("show_control", "Show control", "Off hides the control chip, even when the Savvy settings have one.", true),
  { name: "weather", label: "Weather", helper: "Empty: the first weather entity.", selector: { entity: { domain: "weather" } } },
  { type: "expandable", name: "health", title: "Health cog", schema: [
    S.nav("navigation_path", "Target page", "Where the popup's page button leads."),
    S.bool("dismiss", "Dismiss button", "A button on each health row that puts it aside for you. Off hides the buttons; what was dismissed stays dismissed.", true),
    S.bool("popup_button", "Page button", "A button under the popup that opens the target page. On whenever there is one.", true),
    S.text("popup_label", "Button text", "Default: Open system health"),
    S.action("tap_action", "Tap action", "Default: open the list of what needs attention."),
    S.action("hold_action", "Hold action", "Default: open the list of what needs attention."),
    { name: "watchman", label: "Watchman sensors", selector: { entity: { multiple: true, domain: "sensor" } } },
    S.bool("watchman_button", "Run report chip", "A chip in the popup's Watchman section that runs a new report. Needs the Watchman integration.", true),
    { name: "watchman_report", label: "Report options", helper: "Data sent to watchman.report. Default: parse_config: true.", selector: { object: {} } },
    { type: "grid", name: "", schema: [
      { name: "battery_threshold", label: "Battery alert", helper: "Low below", selector: { number: { min: 1, max: 100, mode: "box", unit_of_measurement: "%" } } },
      { name: "warn_above", label: "Red threshold", helper: "Red from this many issues", selector: { number: { min: 1, max: 99, mode: "box" } } },
    ] },
    { name: "exclude_platforms", label: "Ignored integrations", selector: { select: { multiple: true, custom_value: true, options: ["mobile_app"] } } },
    S.select("group_by", "Grouping", [
      { value: "hub", label: "Device, and the hub behind it" }, { value: "device", label: "Device" }, { value: "none", label: "Nothing: one row per entity" },
    ]),
    S.number("group_min", "Hub threshold", 2, 50),
    { type: "expandable", name: "ignore", title: "Known problems", schema: [
      { name: "devices", label: "Devices", helper: "Dead and waiting for a replacement? Listed here they leave the count and wait under Known.", selector: { device: { multiple: true } } },
      { name: "entities", label: "Entities", selector: { entity: { multiple: true } } },
    ] },
  ] },
  { name: "room_order", label: "Room order", type: "list", helper: "The order of the rooms in the popups: listed first, in this order; the rest follow by name. A chip can have its own.",
    initial: (h) => (h ? allAreas(h).map((a) => a.id) : []), add: { selector: { area: {} }, label: "Add a room" },
    summary: (a, h) => ({ title: areaInfo(h, a).name, sub: a }) },
  autoSection("lights", "counts the lights that are on."),
  autoSection("climate", "the average indoor temperature."),
  autoSection("media", "counts what's playing."),
  autoSection("security", "the alarm panel; with none, what's open or unlocked."),
  S.chips("chips", "Custom chips", "After the four."),
]);

registerCard("savvy-home-header-card", SavvyHomeHeaderCard, "Home header",
  "The house at a glance, for the top of any page that isn't a room: its control, health, weather, and chips that count lights, climate, media and security by themselves.");
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
//   order: with none of its own, a card takes the order of the first lights card for the same room that has one
//   (read from the dashboard); sync_order: false keeps a card independent



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
${GLOW_CSS}

ha-card {
  --radius: var(--ha-card-border-radius, 18px);
  --pad: 14px;
  --amber: 245 184 61;
  ${DESIGN_TOKENS}
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
  flex: none; display: grid; place-items: center; width: var(--b-m); height: var(--b-m); border-radius: 50%;
  background: var(--well);
  color: var(--secondary-text-color);
}
.orb[data-on] { background: color-mix(in oklab, rgb(var(--lc, var(--amber))) var(--mix-on), transparent); color: rgb(var(--lc, var(--amber))); }
.orb ha-icon, .orb savvy-state-icon { --mdc-icon-size: 20px; display: flex; }
.meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.meta .n { font-size: 13.5px; line-height: 17px; font-weight: 600; letter-spacing: -0.01em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta .d { font-size: 11.5px; line-height: 15px; font-weight: 500; color: var(--secondary-text-color);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.swatch {
  flex: none; display: grid; place-items: center; width: var(--c-s); height: var(--c-s); border-radius: 11px;
  background: var(--well);
}
.swatch i {
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--sw, rgb(var(--amber)));
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.14);
}

.power {
  flex: none; display: grid; place-items: center; width: var(--c-s); height: var(--c-s); border-radius: 11px;
  background: var(--well);
  color: var(--secondary-text-color);
}
.power[data-on] { background: color-mix(in oklab, rgb(var(--lc, var(--amber))) var(--mix-on), transparent); color: rgb(var(--lc, var(--amber))); }
.power ha-icon { --mdc-icon-size: 18px; display: flex; }

/* ---- compact: the light, its name and its state, and nothing else ---- */
ha-card[data-compact] .light { padding: 8px 10px; border-radius: 13px; }
ha-card[data-compact] .orb { width: var(--b-s); height: var(--b-s); }
ha-card[data-compact] .orb ha-icon, ha-card[data-compact] .orb savvy-state-icon { --mdc-icon-size: 16px; }
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
.chip ha-icon, .chip savvy-state-icon { --mdc-icon-size: 18px; flex: none; display: flex; color: var(--cc, inherit); }
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
    clearTimeout(this._wantTimer);
    Clock.remove(this._job);
    this._list?.sheet.close(true);
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

    linkTitle(this._root, this._el.title, titlePathOf(this._config), (el, onTap) => this._press(el, onTap));
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
    this._hint([id], !this._isOn(id));
    if (power) return this._hass.callService(power.split(".")[0], "toggle", {}, { entity_id: power });
    this._service("toggle", {}, id);
  }

  // A tap shows its result at once: the lamps move to the state they were asked for, and move
  // back if Home Assistant has not followed within two seconds.
  _hint(ids, on) {
    const want = this._want || (this._want = new Map());
    const until = performance.now() + 2000;
    for (const id of ids) {
      const st = this._hass.states[this._opts(id).power || id];
      if (!st || st.state === "unavailable" || st.state === "unknown") continue;
      want.set(id, { on, until });
    }
    if (!want.size) return;
    clearTimeout(this._wantTimer);
    this._wantTimer = setTimeout(() => { this._want?.clear(); if (this._el && this._hass) this._update(); }, 2050);
    if (this._el) this._update();
  }

  // Is this lamp on? Its own switch decides when it has one.
  // `real`: what Home Assistant says, ignoring a tap that is still waiting for its answer (a second tap
  // asks for the same thing again instead of reversing the first)
  _isOn(id, real = false) {
    const power = this._opts(id).power;
    const now = (power ? this._hass.states[power] : this._hass.states[id])?.state === "on";
    if (real) return now;
    return this._shown(id, now);
  }
  _shown(id, real) {
    const w = this._want?.get(id);
    if (!w) return real;
    if (real === w.on || performance.now() > w.until) { this._want.delete(id); return real; }
    return w.on;
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
    if (ids.length) { this._hint(ids, false); this._service("turn_off", {}, ids); }
  }

  _toggleAll() {
    const ids = this._ids || [];
    if (!ids.length) return;
    const anyOn = ids.some((id) => this._isOn(id, true));
    this._haptic("light");
    this._hint(ids, !anyOn);
    this._service(anyOn ? "turn_off" : "turn_on", {}, ids);
  }

  _applyPreset(p) {
    if (!this._open) return;
    this._haptic("light");
    this._call("turn_on", p.kelvin ? { color_temp_kelvin: p.kelvin }
      : { hs_color: [p.hs[0], Math.round(p.hs[1] * 100)] });
  }

  _navigate(path) {
    navigate(path);
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
    // the corner glow: the colour of the first light that is on, stronger the more of the room is lit
    const litIds = ids.filter((id) => this._isOn(id));
    const glowRgb = lit || litIds.length ? (litIds.map((id) => this._lightRgb(h.states[id])).find(Boolean) || [245, 184, 61]) : null;
    stateGlow(c, el.card, glowRgb, ids.length ? 0.55 + 0.45 * (litIds.length / ids.length) : 0.55);
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
      Motion.show(node, want.has(node.__entity));
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
          <button class="orb"><savvy-state-icon></savvy-state-icon></button>
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
    const icon = node.querySelector("savvy-state-icon");
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
        chip.innerHTML = `${cfg.icon ? "<ha-icon></ha-icon>" : "<savvy-state-icon></savvy-state-icon>"}<span></span>`;
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
      const sIcon = chip.querySelector("savvy-state-icon");
      if (sIcon && sIcon.stateObj !== st) { sIcon.hass = h; sIcon.stateObj = st; }
      const iIcon = chip.querySelector("ha-icon");
      if (iIcon) attr(iIcon, "icon", cfg.icon);
    }
    const keys = new Set(list.map((raw) => {
      const cfg = typeof raw === "string" ? { entity: raw } : raw;
      return cfg.entity || cfg.navigation_path || cfg.name;
    }));
    for (const [key, node] of cache) Motion.show(node, keys.has(key));
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
  S.grid(S.text("title", "Title"), S.titleLink("title")),
  S.grid(S.select("layout", "Layout", [{ value: "full", label: "Full" }, { value: "compact", label: "Compact" }])),
  S.grid(S.bool("show_header", "Show header", null, true), S.bool("show_toggle", "Show pill", null, true)),
  { type: "expandable", name: "toggle", title: "On/off pill", schema: [
    { name: "entity", label: "Pill entity", helper: "Empty: the pill turns this card's lights on and off. An entity (e.g. a room helper): tap toggles it, double tap turns every light off.", selector: { entity: {} } },
    { type: "grid", name: "", schema: [{ name: "name", label: "Name", selector: { text: {} } }, { name: "icon", label: "Icon", selector: { icon: {} } }] },
    { name: "tap_action", label: "Tap action", selector: { ui_action: {} } },
    { name: "double_tap_action", label: "Double tap action", selector: { ui_action: {} } },
    { name: "hold_action", label: "Hold action", selector: { ui_action: {} } },
  ] },
  { name: "order", label: "Order", type: "list", helper: "Drag order with the arrows. Lights not listed follow, by name. Without one, the first lights card for this room that has an order lends its own.",
    initial: (h, cfg) => (h ? lightsOf(h, cfg) : []), add: { selector: { entity: { domain: "light" } }, label: "Add a light" } },
  S.bool("sync_order", "Follow other cards", "Take the order from the first lights card for this room that has one, when this card has none.", true),
  { name: "featured", label: "Wide tiles", selector: { entity: { domain: "light", multiple: true } } },
  { name: "exclude", label: "Leave out", selector: { entity: { domain: "light", multiple: true } } },
  S.grid(S.number("columns", "Columns", 1, 6), S.bool("power_button", "Power buttons", null, false)),
  S.grid(S.bool("state_detail", "Brightness text", null, true), S.bool("color_background", "Tinted tiles", null, false)),
  { name: "lights", label: "Lights", type: "list", helper: "Only these lights, in this order. `power`: a smart plug a light sits behind.",
    item: [{ name: "entity", label: "Light", selector: { entity: { domain: "light" } } }, { name: "power", label: "Behind this plug", selector: { entity: { domain: "switch" } } }],
    add: { selector: { entity: { domain: "light" } }, label: "Add a light" } },
  S.chips(),
]);

registerCard("savvy-lights-card", LightsCard, "Lights",
  "Every light in a room, found for you, each with only the controls it supports. Reorder in the editor.");
})();

// ===== cards/lock.js =====
(() => {
// savvy-lock-card: a door, the way you'd want to handle it. The name is the title and the state a
// coloured status line under it (green when locked, amber when not, red when open or jammed;
// the card only washes when something is off), and the lock's own icon is the handle you slide across its row: past the first stop it
// does the opposite of what the lock is now, and Open (the latch) needs the end held until a ring fills.
// A tap on the icon only nudges it.
//
//   type: custom:savvy-lock-card
//   entity: lock.front_door                 or  entities: [lock.a, { entity: lock.b, name: Garage }]
//                                           or  area: hallway   (every lock of the area; `include` adds locks that have none)
//   name: Front door     icon: mdi:door
//   door: binary_sensor.front_door          (else the door contact of the lock's device or area; false: none)
//   battery: sensor.front_door_battery      (else the battery sensor of its device; false: none)
//   battery_warn: 40                        amber below this, red at 15
//   unlocked_warn: 15                       minutes before "Unlocked for 25 min" nudges (0: never)
//   alarm: alarm_control_panel.home         (else the house's alarm panel; false / hide_alarm: none)
//   alarm_view: compact | full | hidden     compact: one line, a chevron slides the arm modes open; full: the modes always there
//   camera: camera.porch                    (else a camera in the lock's area; false / hide_camera: none)
//   camera_view: compact | full | hidden    compact: a slim row with an Open camera button; full: a live still
//   layout: full | compact                  chips: [...]  (the one chip spec)
//
// With several locks: a row each, a summary and a "Lock all". Tap a name for the lock's
// details. The alarm's arm modes are buttons; disarming, and any code, is more-info's job:
// the card never keeps a code. The camera is a live still that opens a popup with the camera card.

const LOCK_CAM_MS = 8000;
const LOCK_DOOR_CLASSES = ["door", "garage_door", "opening", "window"];
const lockTone = (t) => (t <= 1 ? mixRgb(LOCK_COLORS[0], LOCK_COLORS[1], clamp(t)) : mixRgb(LOCK_COLORS[1], LOCK_COLORS[2], clamp(t - 1)));
const LOCK_TONE_WORD = ["rgb(76 175 80)", "rgb(232 163 61)", "rgb(224 102 102)"];
const LOCK_AMBER = "var(--warn-rgb)", LOCK_RED = "var(--bad-rgb)";

const STYLE = `${BASE_CSS}${CHIP_ROW_CSS}${LOCK_SLIDE_CSS}
  ha-card { --pad: 16px; --lk: 76 175 80; --pulse: 0; position: relative; display: flex; flex-direction: column; gap: 12px; padding: var(--pad); overflow: hidden; }
  :host([data-compact]) ha-card { --pad: 12px; gap: 8px; }
  ha-card > * { position: relative; }
  .head { display: flex; align-items: center; gap: 10px; min-height: 30px; }
  .head .t { flex: 1; min-width: 0; font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sum { flex: none; display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: 12px; font-size: 12px; font-weight: 650;
    color: rgb(var(--lk)); background: rgb(var(--lk) / 0.12); white-space: nowrap; }
  .btn { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 11px; background: var(--well);
    font-size: 12.5px; line-height: 16px; font-weight: 650; color: var(--primary-text-color); --mdc-icon-size: 16px; cursor: pointer; }
  .btn ha-icon { display: flex; }
  .btn[data-on] { color: rgb(var(--lk)); background: rgb(var(--lk) / 0.12); }
  .locks { display: flex; flex-direction: column; gap: 12px; }
  .lk { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .top { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 4px 8px 4px 4px; border-radius: 32px; }
  .who { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; text-align: start; border-radius: 12px; cursor: pointer; }
  .disc { flex: none; display: grid; place-items: center; width: var(--b-m); height: var(--b-m); border-radius: 50%; color: var(--tone); background: color-mix(in oklab, var(--tone) var(--mix-on), transparent); --mdc-icon-size: 20px; }
  .disc > .dicon { display: flex; align-items: center; justify-content: center; line-height: 0; }
  .disc > .dicon > * { display: flex; }
  .col { min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 5px; }
  .nm { grid-column: 1 / -1; font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .st { font-size: 13px; line-height: 17px; font-weight: 600; color: var(--tone); white-space: nowrap; }
  :host([data-solo]) .disc { width: var(--b-l); height: var(--b-l); --mdc-icon-size: 22px; }
  .sub { font-size: 13px; line-height: 17px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub:not(:empty)::before { content: "\\00b7\\00a0"; }
  .sub:empty { display: none; }
  .meta { flex: none; display: flex; align-items: center; gap: 8px; }
  .door, .batt { position: relative; display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px 0 7px; border-radius: 13px; background: var(--well);
    font-size: 12px; font-weight: 600; color: var(--secondary-text-color); white-space: nowrap; --mdc-icon-size: 16px; }
  .door ha-icon { display: flex; }
  /* a closed door is just its icon: the words appear when the door is open */
  .door:not([data-warn]) { padding: 0 5px; }
  .door:not([data-warn]) > span:last-child { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .door[data-warn], .batt[data-level="warn"] { color: rgb(${LOCK_AMBER}); background: rgb(${LOCK_AMBER} / 0.16); }
  .batt[data-level="bad"] { color: rgb(${LOCK_RED}); background: rgb(${LOCK_RED} / 0.16); }
  .batt ha-icon { display: flex; }
  /* several locks: a smaller row each */
  /* compact: one row, the handle at its start */
  :host([data-compact]) .locks { gap: 8px; }
  :host([data-compact]) .top { padding: 3px 8px 3px 3px; border-radius: 26px; }
  :host([data-compact]) .disc { width: var(--b-m); height: var(--b-m); --mdc-icon-size: 20px; }
  :host([data-compact]) .nm { font-size: 14px; line-height: 18px; }
  :host([data-compact]) .sub { display: none; }
  :host([data-compact]) .col { grid-template-columns: minmax(0, 1fr); }
  :host([data-compact]) .meta .door:not([data-warn]), :host([data-compact]) .meta .batt:not([data-level="warn"]):not([data-level="bad"]) { display: none; }
  :host([data-compact]) .door, :host([data-compact]) .batt { height: 22px; font-size: 11px; }
  .nudge { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 12px; border-radius: 14px; background: rgb(${LOCK_AMBER} / 0.14); color: rgb(${LOCK_AMBER});
    font-size: 13px; line-height: 17px; font-weight: 650; --mdc-icon-size: 18px; }
  .nudge ha-icon { display: flex; flex: none; }
  .nudge .tx { flex: 1; min-width: 0; }
  .nudge .btn { background: rgb(${LOCK_AMBER} / 0.2); color: inherit; }
  .alarm { display: flex; flex-direction: column; gap: 8px; padding: 6px 8px 6px 10px; border-radius: 14px; background: var(--well); min-width: 0; }
  .alarm[data-triggered] { background: rgb(${LOCK_RED} / 0.18); color: rgb(${LOCK_RED}); }
  .al1 { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 30px; }
  .alarm .ai { flex: none; display: grid; place-items: center; width: 24px; height: 24px;
    --mdc-icon-size: 20px; color: var(--secondary-text-color); }
  .alarm[data-armed] .ai { color: rgb(76 175 80); }
  .alarm[data-triggered] .ai { color: rgb(${LOCK_RED}); }
  .alarm .ai ha-icon { display: flex; }
  .alarm .ab { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 6px; }
  .alarm .an { flex: none; font-size: 13px; line-height: 18px; font-weight: 500; color: var(--secondary-text-color); }
  .alarm .as { min-width: 0; font-size: 14px; line-height: 18px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .alarm .achev { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%;
    color: var(--secondary-text-color); --mdc-icon-size: 20px; cursor: pointer; }
  .alarm .achev ha-icon { display: flex; transform: rotate(calc(var(--r, 0) * 180deg)); }
  .alarm[data-view="full"] .achev { display: none; }
  /* the arm modes slide sideways when there are more than fit: never clipped at the card's edge */
  .alarm .am { display: flex; flex-wrap: nowrap; gap: 6px; margin: 0 -8px 0 -10px; padding: 0 8px 0 10px; overflow-x: auto; overscroll-behavior-x: contain; touch-action: pan-x pan-y;
    scrollbar-width: none; scroll-snap-type: x proximity; }
  .alarm .am::-webkit-scrollbar { display: none; }
  .alarm .am[data-overflow] { -webkit-mask-image: linear-gradient(to left, transparent 0, #000 26px); mask-image: linear-gradient(to left, transparent 0, #000 26px); }
  .alarm .am .btn { flex: none; scroll-snap-align: start; height: 30px; padding: 0 10px; background: color-mix(in oklab, var(--primary-text-color) 7%, transparent); }
  .alarm .am .btn[data-on] { color: rgb(76 175 80); background: rgb(76 175 80 / 0.12); }
  .alarm[data-triggered] .am .btn { background: rgb(${LOCK_RED} / 0.14); color: inherit; }
  .cam { position: relative; display: block; width: 100%; padding: 0; border: 0; border-radius: 12px; overflow: hidden; cursor: pointer; background: var(--well); aspect-ratio: 21 / 9; }
  .cam img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cam .cl { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: 6px; padding: 18px 12px 9px; color: #fff; --mdc-icon-size: 16px;
    font-size: 12.5px; font-weight: 600; background: linear-gradient(transparent, rgb(0 0 0 / 0.45)); text-align: start; }
  .cam .cl ha-icon { display: flex; }
  .camrow { display: flex; align-items: center; gap: 10px; padding: 6px 8px 6px 6px; border-radius: 14px; background: var(--well); min-width: 0; }
  .camrow .cth { flex: none; width: 52px; height: 36px; border-radius: 9px; object-fit: cover; background: color-mix(in oklab, var(--secondary-text-color) 18%, transparent); cursor: pointer; }
  .camrow .ctx { flex: 1; min-width: 0; display: flex; flex-direction: column; text-align: start; cursor: pointer; }
  .camrow .cn { font-size: 13px; line-height: 17px; font-weight: 650; letter-spacing: -0.005em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .camrow .cs { font-size: 11px; line-height: 14px; font-weight: 600; color: var(--secondary-text-color); display: flex; align-items: center; gap: 5px; }
  .camrow .cs i { width: 6px; height: 6px; border-radius: 50%; background: rgb(${LOCK_RED}); display: inline-block; }
  .empty { padding: 4px 2px; font-size: 12.5px; font-weight: 500; color: var(--secondary-text-color); }
  .sep { display: none; }
  .cam-sheet savvy-camera-card { --ha-card-border-width: 0px; --ha-card-background: transparent; --ha-card-box-shadow: none; margin: -14px -14px 0; }
  @media (prefers-contrast: more) { .sub, .nm { color: var(--primary-text-color); } }
`;

class SavvyLockCard extends SavvyCard {
  static getStubConfig(hass) {
    const id = Object.keys(hass?.states || {}).find((i) => i.startsWith("lock."));
    return id ? { entity: id } : {};
  }
  static getConfigElement() { return document.createElement(EDITOR); }

  constructor() {
    super();
    this._nodes = new Map();
    this._reg = new WeakMap();
    this._tint = this._spring(0, MOTION.ui, "tint", 0.002);
    this._pulse = 0;
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("savvy-lock-card: invalid configuration");
    const areas = [].concat(config.area ?? config.areas ?? []).filter(Boolean);
    const pinned = asItems([...(config.entity ? [config.entity] : []), ...[].concat(config.entities || [])]);
    this._config = { ...config, areas, pinned, include: asItems(config.include).map((i) => i.entity),
      exclude: asItems(config.exclude).map((i) => i.entity), chips: [].concat(config.chips || []) };
    this._compact = config.layout === "compact";
    const view = (v, off) => (["full", "compact", "hidden"].includes(v) ? v : off ? "hidden" : "compact");
    this._alarmView = view(config.alarm_view, config.alarm === false || config.hide_alarm);
    // a compact card is one row: its camera stays away unless asked for
    this._camView = view(config.camera_view ?? (this._compact ? "hidden" : undefined), config.camera === false || config.hide_camera);
    if (this._compact && this._alarmView === "full") this._alarmView = "compact";
    if (this._el) { this._build(); if (this._hass) this._update(); }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._el) this._build();
    this._update();
    if (this._camSheet?.isOpen) this._camCard.hass = hass;
  }

  connectedCallback() {
    this._observe();
    this._wake();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._io?.disconnect();
    this._io = null;
    clearTimeout(this._timer);
    clearInterval(this._camTimer);
    this._camTimer = 0;
    this._camSheet?.close(true);
  }
  getCardSize() { return this._compact ? 2 : 3 + (this._camId && this._camView === "full" ? 3 : this._camId && this._camView === "compact" ? 1 : 0); }
  getGridOptions() { return { columns: 12, min_columns: 4, rows: "auto" }; }

  _observe() {
    if (!this._el || !this.isConnected || typeof IntersectionObserver !== "function") return;
    this._io = this._io || new IntersectionObserver(([e]) => { this._onscreen = e.isIntersecting; if (e.isIntersecting) this._camRefresh(); });
    this._io.disconnect();
    this._io.observe(this);
  }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._resetMotion();
    this._tint = this._spring(this._tint?.x || 0, MOTION.ui, "tint", 0.002);
    this._kit = new RowKit(() => this._wake());
    this._nodes.clear();
    this._badKey = "";
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="head" id="head" hidden><span class="t" id="title"></span><span class="sum" id="sum"></span><button class="btn" id="all"><ha-icon icon="mdi:lock"></ha-icon><span>Lock all</span></button></div>
        <div class="locks" id="locks"></div>
        <div class="nudge" id="nudge" hidden><ha-icon icon="mdi:lock-clock"></ha-icon><span class="tx" id="nudgeTx"></span><button class="btn" id="nudgeBtn"><ha-icon icon="mdi:lock"></ha-icon><span>Lock now</span></button></div>
        <div class="alarm" id="alarm" hidden><div class="al1"><span class="ai"><ha-icon id="alarmIc"></ha-icon></span><span class="ab"><span class="an">Alarm</span><span class="as" id="alarmSt"></span></span><button class="achev" id="alarmChev" aria-expanded="false" aria-label="Arm modes"><ha-icon icon="mdi:chevron-down"></ha-icon></button></div><div class="am" id="alarmModes"></div></div>
        <button class="cam" id="cam" hidden aria-label="Open camera"><img id="camImg" alt=""><span class="cl"><ha-icon icon="mdi:cctv"></ha-icon><span id="camName"></span></span></button>
        <div class="camrow" id="camRow" hidden><img class="cth" id="camThumb" alt=""><span class="ctx" id="camTx" role="button" tabindex="0"><span class="cn" id="camRowName"></span><span class="cs"><i></i>Live</span></span><button class="btn" id="camBtn"><ha-icon icon="mdi:cctv"></ha-icon><span>Open camera</span></button></div>
        <div class="empty" id="empty" hidden></div>
        <div class="chips" id="chips" hidden></div>
      </ha-card>`;
    const $ = (id) => root.getElementById(id);
    this._el = { card: root.querySelector("ha-card"), head: $("head"), title: $("title"), sum: $("sum"), all: $("all"), locks: $("locks"),
      nudge: $("nudge"), nudgeTx: $("nudgeTx"), nudgeBtn: $("nudgeBtn"), alarm: $("alarm"), alarmIc: $("alarmIc"), alarmSt: $("alarmSt"), alarmModes: $("alarmModes"), alarmChev: $("alarmChev"),
      cam: $("cam"), camImg: $("camImg"), camName: $("camName"), camRow: $("camRow"), camThumb: $("camThumb"), camTx: $("camTx"), camBtn: $("camBtn"), camRowName: $("camRowName"), empty: $("empty"), chips: $("chips") };
    linkTitle(root, this._el.title, titlePathOf(this._config), (el, onTap) => this._pressable(el, { onTap }, 0.04));
    this._pressable(this._el.all, { onTap: () => this._lockAll() }, 0.05);
    this._pressable(this._el.nudgeBtn, { onTap: () => this._nudged && this._call(this._nudged, "lock") }, 0.05);
    this._pressable(this._el.cam, { onTap: () => this._camId && this._openCamera() }, 0.025);
    this._pressable(this._el.camBtn, { onTap: () => this._camId && this._openCamera() }, 0.05);
    this._pressable(this._el.camTx, { onTap: () => this._camId && this._openCamera() }, 0.03);
    this._pressable(this._el.alarmChev, { onTap: () => this._toggleAlarm() }, 0.1);
    this._alarmOpen = false;
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => { this._fitRow(this._el.chips); this._fitRow(this._el.alarmModes); });
    this._ro.observe(this._el.chips);
    this._ro.observe(this._el.alarmModes);
    this._first = true;
    this._observe();
  }

  _frame(now, dt) {
    const a = super._frame(now, dt);
    const b = this._kit ? this._kit.step(dt) : false;
    if (this._pulsing && !MQ.reduced.matches) {
      this._pulse = (this._pulse + dt * 3.4) % (Math.PI * 2);
      put(this._el.card, "--pulse", (0.5 + 0.5 * Math.sin(this._pulse)).toFixed(3));
      return true;
    }
    return a || b;
  }

  // ---------- which locks, and what goes with each ----------
  _registry(id) {
    const e = this._hass.entities;
    if (!e) return [];
    let m = this._reg.get(e);
    if (!m) { m = new Map(); this._reg.set(e, m); }
    if (!m.has(id)) {
      const dev = e[id]?.device_id;
      m.set(id, dev ? Object.keys(e).filter((k) => k !== id && e[k].device_id === dev) : []);
    }
    return m.get(id);
  }

  _items() {
    const h = this._hass, c = this._config, out = [], skip = new Set(c.exclude);
    for (const p of c.pinned) if (p.entity && !out.some((o) => o.entity === p.entity)) out.push(p); // named locks always show
    const have = () => new Set(out.map((o) => o.entity));
    for (const a of c.areas) {
      for (const id of pick(h, areaEntities(h, a), { domains: "lock", exclude: [...skip, ...have()] })) out.push({ entity: id });
    }
    for (const id of c.include) if (h.states[id] && !skip.has(id) && !have().has(id)) out.push({ entity: id });
    if (!out.length && !c.pinned.length && !c.areas.length) {
      const first = Object.keys(h.states).find((i) => i.startsWith("lock.") && !skip.has(i));
      if (first) out.push({ entity: first });
    }
    return out;
  }

  _doorOf(item, solo) {
    const h = this._hass, c = this._config;
    const own = item.door ?? (solo ? c.door : undefined);
    if (own === false || (solo && c.hide_door)) return null;
    if (typeof own === "string" && own) return own;
    const dc = (id) => h.states[id]?.attributes.device_class;
    const same = this._registry(item.entity).filter((k) => domainOf(k) === "binary_sensor" && LOCK_DOOR_CLASSES.includes(dc(k)) && h.states[k]);
    if (same.length) return same.sort((a, b) => LOCK_DOOR_CLASSES.indexOf(dc(a)) - LOCK_DOOR_CLASSES.indexOf(dc(b)))[0];
    const area = entityArea(h, item.entity);
    if (area) {
      const found = pick(h, areaEntities(h, area), { domains: "binary_sensor", deviceClasses: ["door", "garage_door", "opening"] });
      if (found.length === 1) return found[0];
    }
    return null;
  }

  _batteryOf(item, solo) {
    const h = this._hass, c = this._config;
    const own = item.battery ?? (solo ? c.battery : undefined);
    if (own === false || (solo && c.hide_battery)) return null;
    if (typeof own === "string" && own) return own;
    return this._registry(item.entity).find((k) => domainOf(k) === "sensor" && h.states[k]?.attributes.device_class === "battery" && Number.isFinite(parseFloat(h.states[k].state))) || null;
  }

  _alarmId() {
    const h = this._hass, c = this._config;
    if (c.alarm === false || c.hide_alarm || this._alarmView === "hidden") return null;
    if (typeof c.alarm === "string" && c.alarm) return h.states[c.alarm] ? c.alarm : null;
    return houseEntities(h).find((id) => domainOf(id) === "alarm_control_panel") || null;
  }

  _cameraOf(items) {
    const h = this._hass, c = this._config;
    if (c.camera === false || c.hide_camera || this._camView === "hidden") return null;
    if (typeof c.camera === "string" && c.camera) return h.states[c.camera] ? c.camera : null;
    const own = items.map((i) => i.camera).find((x) => typeof x === "string" && h.states[x]);
    if (own) return own;
    const area = items.length ? entityArea(h, items[0].entity) : null;
    return area ? pick(h, areaEntities(h, area), { domains: "camera" })[0] || null : null;
  }

  // ---------- painting ----------
  _update() {
    const h = this._hass;
    if (!h || !this._el) return;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    const c = this._config, el = this._el;
    const items = this._items();
    const solo = items.length === 1;
    this.toggleAttribute("data-solo", solo && !this._compact);
    this.toggleAttribute("data-compact", this._compact);
    let urgency = 0;
    const seen = new Set();
    let at = 0, locked = 0, needing = [];
    const now = Date.now();
    const warnMin = c.unlocked_warn === undefined ? 15 : Number(c.unlocked_warn);
    const warnMs = c.unlocked_warn === false || !(warnMin > 0) ? Infinity : warnMin * 60000;
    let nudged = null, nudgeFor = 0, nextCheck = Infinity;
    for (const item of items) {
      const id = item.entity;
      seen.add(id);
      const st = h.states[id];
      const canOpen = (((st?.attributes.supported_features || 0) & 1) === 1);
      let node = this._nodes.get(id);
      if (node && node.__canOpen !== canOpen) { node.remove(); this._nodes.delete(id); node = null; }
      if (!node) { node = this._lockNode(item, canOpen, solo); this._nodes.set(id, node); }
      node.__item = item;
      const state = st?.state || "unavailable";
      const u = this._paintLock(node, item, st, solo);
      urgency = Math.max(urgency, u);
      if (state === "locked" || state === "locking") locked++;
      if (!["locked", "locking", "jammed", "unavailable", "unknown"].includes(state)) needing.push(id);
      if (state === "unlocked" && st) {
        const t = Date.parse(st.last_changed), elapsed = Number.isFinite(t) ? now - t : 0;
        if (elapsed >= warnMs && elapsed > nudgeFor) { nudged = id; nudgeFor = elapsed; }
        else if (elapsed < warnMs) nextCheck = Math.min(nextCheck, warnMs - elapsed);
      }
      place(el.locks, node, at++);
    }
    for (const [id, node] of this._nodes) {
      if (seen.has(id)) continue;
      node.remove();
      this._nodes.delete(id);
    }
    // header: only with several locks
    // (a title or a title link asks for the header on a single lock too)
    const multi = items.length > 1 && !this._compact;
    const headed = multi || !!(c.title || titlePathOf(c));
    el.head.hidden = !headed;
    if (headed) {
      text(el.title, c.name || c.title || (multi ? "Locks" : "Lock"));
      el.sum.hidden = !multi;
      if (multi) {
        const open = items.length - locked;
        text(el.sum, open ? `${open} unlocked` : "All locked");
      }
      Motion.show(el.all, multi && !!needing.length);
    }
    // the nudge: unlocked for a while
    this._nudged = nudged;
    Motion.reveal(el.nudge, !!nudged);
    if (nudged) {
      const name = items.find((i) => i.entity === nudged);
      text(el.nudgeTx, `${solo ? "Unlocked" : `${name?.name || shortName(h, nudged, null)} unlocked`} for ${duration(nudgeFor)}`);
      nextCheck = Math.min(nextCheck, 30000);
      urgency = Math.max(urgency, 1);
    }
    // alarm
    const alarm = this._renderAlarm();
    if (alarm.triggered) urgency = 2;
    // camera
    this._camId = this._cameraOf(items);
    this._renderCamera(items);
    // chips
    this._chipRow(el.chips, c.chips.map((x, i) => chipItem(h, x, i)));
    // nothing to show
    el.empty.hidden = items.length > 0;
    if (!items.length) text(el.empty, c.areas.length || c.pinned.length ? "No lock found." : "Pick a lock to show.");
    // the wash follows the most urgent thing
    this._tint.to(urgency, MOTION.ui);
    this._pulsing = items.some((i) => ["open", "opening", "jammed"].includes(h.states[i.entity]?.state)) || alarm.triggered;
    if (!this._pulsing) put(el.card, "--pulse", "0");
    clearTimeout(this._timer);
    if (Number.isFinite(nextCheck)) this._timer = setTimeout(() => this._update(), nextCheck + 40);
    if (this._first) { this._first = false; requestAnimationFrame(() => this._paintAll(null)); }
    this._wake();
  }

  _lockNode(item, canOpen, solo) {
    const id = item.entity;
    const node = document.createElement("div");
    node.className = "lk";
    node.__canOpen = canOpen;
    node.innerHTML = `<div class="top">
        <span class="disc"><span class="dicon"></span></span>
        <button class="who" aria-label="Open details"><span class="col"><span class="nm"></span><span class="st"></span><span class="sub"></span></span></button>
        <span class="meta"><span class="door" hidden><ha-icon></ha-icon><span></span></span><span class="batt" hidden><ha-icon></ha-icon><span></span></span></span>
      </div>`;
    const q = (s) => node.querySelector(s);
    node.__el = { disc: q(".disc"), dicon: q(".dicon"), nm: q(".nm"), st: q(".st"), door: q(".door"), doorIc: q(".door ha-icon"), doorTx: q(".door span:last-child"),
      batt: q(".batt"), battIc: q(".batt ha-icon"), battTx: q(".batt > span:last-child"), sub: q(".sub") };
    const call = (svc) => this._call(id, svc);
    node.__track = new LockSlide(this._kit, { host: q(".top"), handle: q(".disc"), label: "Lock", canOpen, hintHost: q(".who"),
      fade: [q(".who"), q(".meta")], onLock: () => call("lock"), onUnlock: () => call("unlock"), onOpen: () => call("open") });
    node.__track.onWords = () => this._update();
    this._pressable(q(".who"), { onTap: () => moreInfo(this, id) }, 0.03);
    node.__first = true;
    return node;
  }

  // one lock's face; returns how urgent it is: 0 calm, 1 amber, 2 red
  _paintLock(node, item, st, solo) {
    const h = this._hass, el = node.__el, id = item.entity;
    const state = st?.state || "unavailable";
    const track = node.__track;
    track.setState(state, node.__first);
    node.__first = false;
    text(el.nm, item.name || (solo && this._config.name) || shortName(h, id, null));
    text(el.st, state === "unavailable" || state === "unknown" ? title(state) : track.words);
    // the icon
    const wantState = !(item.icon || (solo && this._config.icon)) && !!st;
    if (node.__iconKind !== (wantState ? "state" : "plain")) {
      node.__iconKind = wantState ? "state" : "plain";
      el.dicon.innerHTML = wantState ? "<savvy-state-icon></savvy-state-icon>" : "<ha-icon></ha-icon>";
    }
    const ic = el.dicon.firstElementChild;
    if (wantState) { if (ic.stateObj !== st) { ic.hass = h; ic.stateObj = st; } }
    else attr(ic, "icon", item.icon || this._config.icon || "mdi:lock");
    // the door
    const doorId = this._doorOf(item, solo), door = doorId ? h.states[doorId] : null;
    const doorOpen = !!door && door.state === "on";
    const doorWords = door ? (door.state === "on" ? "Door open" : door.state === "off" ? "Door closed" : null) : null;
    Motion.show(el.door, !!doorWords);
    if (doorWords) {
      text(el.doorTx, doorWords);
      attr(el.doorIc, "icon", doorOpen ? "mdi:door-open" : "mdi:door-closed");
      attr(el.door, "data-warn", doorOpen && (state === "locked" || state === "locking"));
    }
    // the battery
    const battId = this._batteryOf(item, solo), batt = battId ? h.states[battId] : null;
    const pct = batt ? parseFloat(batt.state) : NaN;
    Motion.show(el.batt, Number.isFinite(pct));
    if (Number.isFinite(pct)) {
      const warn = Number(this._config.battery_warn ?? 40);
      attr(el.batt, "data-level", pct <= 15 ? "bad" : pct < warn ? "warn" : "ok");
      text(el.battTx, `${Math.round(pct)}%`);
      attr(el.battIc, "icon", pct <= 15 ? "mdi:battery-alert-variant-outline" : batteryLevelIcon(pct));
    }
    // the line under the name
    const parts = [];
    const by = st?.attributes.changed_by;
    if (by) parts.push(`by ${by}`);
    const t = Date.parse(st?.last_changed);
    if (Number.isFinite(t)) parts.push(since(t, false));
    text(el.sub, parts.join(" · "));
    attr(node, "title", parts.length ? parts.join(" · ") : null);
    // how urgent
    let u = 0;
    if (state === "jammed" || state === "open" || state === "opening") u = 2;
    else if (state === "unlocked" || state === "unlocking") u = 1;
    else if (doorOpen && (state === "locked" || state === "locking")) u = 1;
    put(node, "--tone", u === 0 ? LOCK_TONE_WORD[0] : u === 1 ? LOCK_TONE_WORD[1] : LOCK_TONE_WORD[2]);
    if (state === "unavailable" || state === "unknown") put(node, "--tone", "var(--secondary-text-color)");
    return u;
  }

  _call(id, svc) {
    this._hass.callService("lock", svc, {}, { entity_id: id });
  }

  _lockAll() {
    const h = this._hass;
    let n = 0;
    for (const [id] of this._nodes) {
      const s = h.states[id]?.state;
      if (!s || ["locked", "locking", "jammed", "unavailable", "unknown"].includes(s)) continue;
      this._call(id, "lock");
      n++;
    }
    if (n) haptic("medium");
  }

  // ---------- the alarm ----------
  _renderAlarm() {
    const h = this._hass, el = this._el, id = this._alarmId();
    const st = id ? h.states[id] : null;
    Motion.reveal(el.alarm, !!st);
    if (!st) return { triggered: false };
    const sf = st.attributes.supported_features ?? 7;
    const modes = ARM.filter((m) => sf & m[2]);
    const armed = /^armed_(.+)$/.exec(st.state);
    const triggered = st.state === "triggered";
    attr(el.alarm, "data-armed", !!armed);
    attr(el.alarm, "data-triggered", triggered);
    attr(el.alarm, "data-view", this._alarmView);
    // a triggered alarm opens its modes by itself; otherwise the chevron decides (full: always open)
    if (triggered && !this._wasTriggered) this._alarmOpen = true;
    this._wasTriggered = triggered;
    const open = this._alarmView === "full" || this._alarmOpen;
    Motion.reveal(el.alarmModes, open);
    attr(el.alarmChev, "aria-expanded", String(open));
    Motion.tweenVar(el.alarmChev, "--r", open ? 1 : 0);
    requestAnimationFrame(() => this._fitRow(el.alarmModes));
    attr(el.alarmIc, "icon", triggered ? "mdi:shield-alert" : armed ? "mdi:shield-lock" : "mdi:shield-off-outline");
    text(el.alarmSt, triggered ? "Triggered" : stateText(h, st));
    const key = `${id}|${modes.map((m) => m[0]).join()}`;
    if (key !== this._alarmKey) {
      this._alarmKey = key;
      for (const b of [...el.alarmModes.children]) { const i = this._pressNodes.indexOf(b); if (i >= 0) this._pressNodes.splice(i, 1); b.remove(); }
      for (const m of modes) {
        const b = document.createElement("button");
        b.className = "btn";
        b.dataset.mode = m[0];
        b.innerHTML = `<ha-icon></ha-icon><span></span>`;
        attr(b.firstElementChild, "icon", m[3]);
        text(b.querySelector("span"), m[1]);
        this._pressable(b, { onTap: () => this._arm(id, m[0]) }, 0.05);
        el.alarmModes.appendChild(b);
      }
      const d = document.createElement("button");
      d.className = "btn";
      d.dataset.mode = "disarm";
      d.innerHTML = `<ha-icon icon="mdi:shield-off"></ha-icon><span>Disarm</span>`;
      this._pressable(d, { onTap: () => moreInfo(this, id) }, 0.05);
      el.alarmModes.appendChild(d);
    }
    for (const b of el.alarmModes.children) {
      if (b.dataset.mode === "disarm") Motion.show(b, !(st.state === "disarmed" || st.state === "unavailable"));
      else attr(b, "data-on", armed && armed[1] === b.dataset.mode);
    }
    return { triggered };
  }

  _toggleAlarm() {
    this._alarmOpen = !this._alarmOpen;
    haptic("selection");
    if (this._hass) this._update();
  }

  _arm(id, mode) {
    const h = this._hass, cur = h.states[id];
    if (!cur || cur.state === `armed_${mode}`) return;
    // a code is the more-info dialog's job: nothing here ever holds one
    const needsCode = cur.attributes.code_format != null && cur.attributes.code_arm_required !== false;
    if (needsCode) { moreInfo(this, id); return; }
    h.callService("alarm_control_panel", `alarm_arm_${mode}`, {}, { entity_id: id });
    haptic("light");
  }

  // ---------- the camera ----------
  _renderCamera(items) {
    const el = this._el, id = this._camId, st = id ? this._hass.states[id] : null, view = this._camView;
    const full = !!st && view === "full", row = !!st && view === "compact";
    Motion.reveal(el.cam, full);
    Motion.reveal(el.camRow, row);
    this._camVisible = full || row;
    if (!this._camVisible) { clearInterval(this._camTimer); this._camTimer = 0; return; }
    const name = st.attributes.friendly_name || shortName(this._hass, id, null);
    text(el.camName, `${name} · Live`);
    text(el.camRowName, name);
    this._camRefresh(true);
    if (!this._camTimer) this._camTimer = setInterval(() => this._camRefresh(), LOCK_CAM_MS);
  }

  // a fresh still while the card is on screen
  _camRefresh(force = false) {
    const el = this._el, id = this._camId;
    if (!el || !id || !this._camVisible) return;
    if (!force && (this._onscreen === false || document.hidden)) return;
    const img = this._camView === "full" ? el.camImg : el.camThumb;
    const st = this._hass.states[id];
    const pic = st?.attributes.entity_picture || `/api/camera_proxy/${id}`;
    const url = typeof this._hass.hassUrl === "function" ? this._hass.hassUrl(pic) : pic;
    const next = /^(data|blob):/.test(url) ? url : `${url}${url.includes("?") ? "&" : "?"}_t=${Math.floor(Date.now() / 1000)}`;
    if (force && img.__base === url && img.__at && Date.now() - img.__at < LOCK_CAM_MS - 500) return;
    img.__base = url;
    img.__at = Date.now();
    img.src = next;
  }

  _openCamera() {
    const id = this._camId, h = this._hass;
    if (!id) return;
    if (!this._camSheet) {
      this._camSheet = new Sheet(this, { title: "Camera", wide: true, onClose: () => { this._camCard?.remove(); this._camCard = null; } });
      this._camSheet.el.classList.add("cam-sheet");
    }
    const st = h.states[id];
    this._camSheet.setTitle(st?.attributes.friendly_name || "Camera");
    const card = document.createElement("savvy-camera-card");
    card.setConfig({ cameras: [{ entity: id }], recordings: "inline", columns: 1 });
    this._camSheet.body.replaceChildren(card);
    card.hass = h;
    this._camCard = card;
    this._camSheet.open(this._camView === "full" ? this._el.cam : this._el.camBtn);
  }

  _paint(dirty, all, red) {
    const t = clamp(this._tint.x, 0, 2);
    const c = lockTone(t);
    put(this._el.card, "--lk", c.join(" "));
    // the corner glow, in the lock's tone: a soft green while it is locked, fuller as it turns amber and red
    put(this._el.card, "--glow-rgb", c.join(" "));
    put(this._el.card, "--glow", this._config.state_glow === false ? "0" : (0.5 + 0.25 * t).toFixed(3));
  }
}

// ---------- editor ----------
const VIEWS = [{ value: "compact", label: "Compact" }, { value: "full", label: "Full" }, { value: "hidden", label: "Hidden" }];
const EDITOR = defineEditor("savvy-lock-card", (hass, c) => [
  S.select("layout", "Layout", [{ value: "full", label: "Full" }, { value: "compact", label: "Compact (one row)" }]),
  S.titleLink("title"),
  S.entity("entity", "Lock", "lock", { helper: "One lock. Or pick an area, or list several below." }),
  { name: "area", label: "Area", helper: "Every lock in these areas. Locks with no area: add them under Include.", selector: { area: { multiple: true } } },
  { name: "entities", label: "Locks", helper: "Several locks, each with its own door, battery and camera.", type: "list",
    item: [
      { name: "entity", label: "Lock", selector: { entity: { domain: "lock" } } },
      S.grid(S.text("name", "Name"), S.icon()),
      { name: "door", label: "Door sensor", selector: { entity: { domain: "binary_sensor" } } },
      { name: "battery", label: "Battery", selector: { entity: { domain: "sensor", device_class: "battery" } } },
      { name: "camera", label: "Camera", selector: { entity: { domain: "camera" } } },
    ],
    add: { selector: { entity: { domain: "lock" } }, label: "Add a lock" } },
  { name: "include", label: "Include", helper: "Locks to show with this area, such as one that has no area.", selector: { entity: { domain: "lock", multiple: true } } },
  { name: "exclude", label: "Never show", selector: { entity: { domain: "lock", multiple: true } } },
  S.grid(S.text("name", "Name"), S.icon()),
  { type: "expandable", name: "", title: "Door and battery", schema: [
    { name: "door", label: "Door sensor", helper: "Empty: the door contact of the lock's device or area.", selector: { entity: { domain: "binary_sensor" } } },
    S.bool("hide_door", "Hide door"),
    { name: "battery", label: "Battery", helper: "Empty: the battery sensor of the lock's device.", selector: { entity: { domain: "sensor", device_class: "battery" } } },
    S.bool("hide_battery", "Hide battery"),
    S.number("battery_warn", "Battery alert", 5, 90, 1, "%"),
    S.number("unlocked_warn", "Unlocked nudge", 0, 240, 1, "min"),
  ] },
  { type: "expandable", name: "", title: "Alarm and camera", schema: [
    { name: "alarm", label: "Alarm", helper: "Empty: the house's alarm panel, when there is one.", selector: { entity: { domain: "alarm_control_panel" } } },
    S.select("alarm_view", "Alarm view", VIEWS),
    { name: "camera", label: "Camera", helper: "Empty: a camera in the lock's area.", selector: { entity: { domain: "camera" } } },
    S.select("camera_view", "Camera view", VIEWS),
  ] },
  S.chips(),
]);

registerCard("savvy-lock-card", SavvyLockCard, "Lock",
  "A door at a glance: lock, unlock and open on one slide, the door and battery, an alarm row and a live camera.");
})();

// ===== cards/media.js =====
(() => {
// savvy-media-card: a room's media, organised the way the hardware works: sources feed an
// output.
//   stage    artwork of what's playing, with the title over it (and progress)
//   sources  video boxes as a segmented picker, then the picked one's transport
//   output   the speaker the room actually listens through, with its volume
//   extras   presets, text to speech, the room's alarm clock, your chips
// Bands with nothing in them aren't drawn.
//
// `area` finds the room's players: speakers and receivers are the audio, TVs and the rest
// the video. `video` / `audio` name them instead (and add their own options).
//
//   type: custom:savvy-media-card
//   area: living_room
//   video_output: media_player.soundbar       where the video boxes' sound comes out
//   presets: [{ entity: input_button.radio }]  tts: { action: tts.speak, data: { ... $MSG ... } }
//   layout: compact                            one row: what's playing, its transport, the volume

const VOL_THROTTLE = 400;     // ms between volume writes while dragging
const VOL_PREDICT = 4000;     // how long an unconfirmed level outranks HA's own
const OPTIMISTIC_MS = 4000;   // a console takes its time to wake: hold the guess this long
const MEDIA_MOTION = { art: { response: 0.62, damping: 1 }, grab: { response: 0.4, damping: 1 } };

// media_player supported_features
const F = { PAUSE: 1, SEEK: 2, VOLUME_SET: 4, VOLUME_MUTE: 8, PREV: 16, NEXT: 32, TURN_ON: 128, TURN_OFF: 256,
  PLAY_MEDIA: 512, VOLUME_STEP: 1024, SELECT_SOURCE: 2048, STOP: 4096, PLAY: 16384 };
const has = (st, bit) => ((st?.attributes.supported_features || 0) & bit) === bit;
const ACTIVE = new Set(["playing", "buffering"]);
const DEAD = new Set(["off", "unavailable", "unknown", "standby"]);
const PLAYER_ICONS = { tv: "mdi:television", speaker: "mdi:speaker", receiver: "mdi:audio-video", game: "mdi:gamepad-variant", default: "mdi:cast-variant" };
const AUDIO_CLASSES = new Set(["speaker", "receiver"]);
const mediaAction = (a, entity) => (a === "press" || a === "turn_on"
  ? { action: "perform-action", perform_action: `${domainOf(entity)}.${a}`, target: { entity_id: entity } } : asAction(a));

const STYLE = `${BASE_CSS}
  ha-card { --accent: 154 120 214; display: flex; flex-direction: column; overflow: hidden; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
  /* the stage takes the artwork's own proportions, so a poster shows whole */
  .stage { position: relative; width: 100%; overflow: hidden; aspect-ratio: var(--ar, 16 / 9); min-height: 130px; max-height: var(--art-max, none);
    background: color-mix(in oklab, var(--primary-text-color) 8%, transparent); cursor: pointer; }
  .art { position: absolute; inset: 0; width: 100%; height: 100%; display: block; border: 0; object-fit: cover; }
  .veil { position: absolute; left: 0; right: 0; bottom: 0; height: 78px; background: linear-gradient(to top, rgb(0 0 0 / 0.74) 0%, rgb(0 0 0 / 0.42) 38%, rgb(0 0 0 / 0) 100%); }
  .caption { position: absolute; left: 0; right: 0; bottom: 0; padding: 0 13px 11px; color: #fff; }
  .stage .t { display: block; font-size: 15px; line-height: 19px; font-weight: 650; letter-spacing: -0.014em; text-shadow: 0 1px 3px rgb(0 0 0 / 0.42); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .stage .s { display: block; font-size: 12.5px; line-height: 16px; font-weight: 500; opacity: 0.88; text-shadow: 0 1px 3px rgb(0 0 0 / 0.36); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .progress { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: rgb(255 255 255 / 0.2); }
  .progress i { display: block; height: 100%; background: #fff; transform-origin: 0 50%; }
  header { padding: var(--pad) var(--pad) 10px; }
  .name { display: block; font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.014em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .body { display: flex; flex-direction: column; padding: var(--pad); gap: 10px; }
  .band { display: flex; flex-direction: column; gap: 9px; }
  .band + .band { padding-top: 10px; border-top: 1px solid var(--line); }
  /* the first visible band never gets a divider, even with a hidden one before it */
  .band[data-first] { padding-top: 0; border-top: 0; }
  .cap { font-size: 10.5px; line-height: 13px; font-weight: 650; letter-spacing: 0.05em; text-transform: uppercase; color: var(--secondary-text-color); opacity: 0.75; margin-bottom: -2px; }
  .row .when { flex: none; font-size: 15px; line-height: 19px; font-weight: 650; letter-spacing: -0.016em; }
  .row .when[data-off] { color: var(--secondary-text-color); }
  /* the alarm isn't media: its own colour, so it never reads as a player */
  #alarmBand { --alarm: 232 163 61; }
  #alarmBand .icon[data-live] { background: rgb(var(--alarm) / 0.16); color: rgb(var(--alarm)); }
  #alarmBand .tb[data-on] { background: rgb(var(--alarm) / 0.18); color: rgb(var(--alarm)); }
  #alarmBand .meta { text-align: start; }
  .segmented { position: relative; display: flex; gap: 2px; padding: 3px; border-radius: 14px; background: var(--well); }
  .sel { position: absolute; top: 3px; bottom: 3px; left: 0; border-radius: 11px; background: var(--ha-card-background, var(--card-background-color));
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.14), 0 0 0 0.5px rgb(0 0 0 / 0.04); }
  :host([dark]) .sel { background: color-mix(in oklab, var(--primary-text-color) 14%, transparent); box-shadow: none; }
  .seg { position: relative; flex: 1; min-width: 0; height: 34px; display: flex; align-items: center; justify-content: center; gap: 6px; border-radius: 11px;
    color: var(--secondary-text-color); font-size: 13px; line-height: 16px; font-weight: 550; letter-spacing: -0.004em; }
  .seg ha-icon { --mdc-icon-size: 18px; display: flex; }
  .seg span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .seg[data-sel] { color: var(--primary-text-color); }
  .seg[data-live] { color: color-mix(in oklab, rgb(var(--accent)) 70%, var(--secondary-text-color)); }
  @container (max-width: 320px) { .seg span { display: none; } }
  /* a narrow row keeps play and power; the stage still has the full transport */
  @container (max-width: 330px) { .row .tb[data-k="prev"], .row .tb[data-k="next"] { display: none; } .vol[data-steps] .pct { display: none; } }
  .row { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .row .icon { flex: none; display: grid; place-items: center; width: var(--b-m); height: var(--b-m); border-radius: 50%; background: var(--well); color: var(--secondary-text-color); }
  .row .icon[data-live] { background: color-mix(in oklab, rgb(var(--accent)) var(--mix-on), transparent); color: rgb(var(--accent)); }
  .row .icon ha-icon { --mdc-icon-size: 19px; display: flex; }
  .row .meta { flex: 1; min-width: 0; }
  .row .n { display: block; font-size: 13.5px; line-height: 17px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .d { display: block; font-size: 12px; line-height: 16px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .transport { flex: none; display: flex; align-items: center; gap: 4px; }
  .tb { display: grid; place-items: center; width: var(--c-s); height: var(--c-s); border-radius: 11px; color: var(--secondary-text-color); }
  .tb.solid { background: var(--well); color: var(--primary-text-color); }
  .tb[data-on] { background: color-mix(in oklab, rgb(var(--accent)) var(--mix-on), transparent); color: rgb(var(--accent)); }
  .tb[disabled] { opacity: 0.3; cursor: default; }
  .tb ha-icon { --mdc-icon-size: 20px; display: flex; }
  .vol { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
  .vol .bar { position: absolute; left: 0; right: 0; top: 50%; height: 9px; margin-top: -4.5px; border-radius: 99px; background: var(--well); overflow: hidden; transform-origin: 50% 50%; }
  .vol .mute { flex: none; display: grid; place-items: center; width: 34px; height: 32px; border-radius: 10px; color: var(--secondary-text-color); }
  .vol .mute ha-icon { --mdc-icon-size: 19px; display: flex; }
  .vol .mute[data-on] { color: #E8844F; background: rgb(232 132 79 / 0.16); }
  /* − / + as one pair at the end, the climate card's steppers at the transport's size */
  .vol .vsteps { flex: none; display: flex; gap: 4px; }
  .vol .vstep { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; background: var(--well); color: var(--primary-text-color); transform-origin: 50% 50%; }
  .vol .vstep ha-icon { --mdc-icon-size: 18px; display: flex; }
  .vol .vstep[disabled] { opacity: 0.35; cursor: default; }
  .slider { position: relative; flex: 1; height: 30px; touch-action: pan-y; cursor: grab; }
  .slider:active { cursor: grabbing; }
  .fill { position: absolute; inset: 0; border-radius: 99px; transform-origin: 0 50%; background: linear-gradient(90deg, rgb(var(--accent) / 0.55), rgb(var(--accent))); }
  .pct { flex: none; min-width: 34px; text-align: end; font-size: 12px; line-height: 16px; font-weight: 600; letter-spacing: -0.004em; color: var(--secondary-text-color); }
  .pills { display: flex; flex-wrap: wrap; gap: 8px; }
  .pill { display: inline-flex; align-items: center; gap: 7px; min-width: 0; height: 34px; padding: 0 12px; border-radius: 12px; background: var(--well);
    font-size: 13px; line-height: 16px; font-weight: 550; letter-spacing: -0.004em; color: var(--secondary-text-color); }
  .pill ha-icon, .pill savvy-state-icon { --mdc-icon-size: 18px; flex: none; display: flex; color: var(--cc, inherit); }
  .pill span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pill[data-on] { background: color-mix(in oklab, var(--cc) 16%, transparent); color: var(--cc); }
  /* compact: one row, a thumbnail of what's playing, its transport, the room's volume */
  ha-card[data-compact] .body { padding: 12px; gap: 8px; }
  ha-card[data-compact] .band + .band { padding-top: 0; border-top: 0; }
  ha-card[data-compact] .row { gap: 11px; }
  ha-card[data-compact] .row .icon { width: var(--b-l); height: var(--b-l); overflow: hidden; padding: 0; }
  ha-card[data-compact] .row .icon ha-icon { --mdc-icon-size: 22px; }
  ha-card[data-compact] .thumb { width: 100%; height: 100%; object-fit: cover; display: block; border: 0; }
  ha-card[data-compact] .row .n { font-size: 14px; line-height: 18px; }
  ha-card[data-compact] .row .d { font-size: 12.5px; line-height: 17px; }
  ha-card[data-compact] .vol { margin-top: 6px; }
  .tts { display: flex; align-items: center; gap: 8px; }
  .tts input { flex: 1; min-width: 0; height: 34px; box-sizing: border-box; padding: 0 12px; border-radius: 12px; border: 0; background: var(--well);
    color: var(--primary-text-color); font: inherit; font-size: 13px; font-weight: 500; outline: none; user-select: text; -webkit-user-select: text; }
  .tts input::placeholder { color: var(--secondary-text-color); opacity: 0.9; }
  .tts input:focus-visible { box-shadow: 0 0 0 2px rgb(var(--accent)); }
  .send { flex: none; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 12px; background: rgb(var(--accent) / 0.18); color: rgb(var(--accent)); }
  .send[disabled] { opacity: 0.35; cursor: default; }
  .send ha-icon { --mdc-icon-size: 19px; display: flex; }
  .empty { padding: 4px 0 2px; font-size: 12.5px; font-weight: 500; color: var(--secondary-text-color); }
  @media (prefers-contrast: more) { .row .d, .pct, .pill { color: var(--primary-text-color); } }
`;

class SavvyMediaCard extends SavvyCard {
  static getStubConfig(hass) {
    const a = allAreas(hass).find((x) => areaEntities(hass, x.id).some((id) => domainOf(id) === "media_player"));
    return a ? { area: a.id } : {};
  }
  static getConfigElement() { return document.createElement(EDITOR); }

  constructor() {
    super();
    this._onscreen = true;
    this._optimistic = new Map();
  }

  setConfig(config) {
    const players = (list) => asItems(list).filter((p) => p.entity);
    if (!config?.area && !players(config?.video).length && !players(config?.audio).length) throw new Error('savvy-media-card: set an "area" (or "video" / "audio" players)');
    const alarm = typeof config.alarm === "string" ? { entity: config.alarm } : config.alarm;
    this._compact = config.layout === "compact" || !!config.compact;
    this._given = { video: players(config.video), audio: players(config.audio) };
    this._config = { artwork: true, labels: {}, ...config, alarm: alarm || null,
      presets: asItems(config.presets), chips: asItems(config.chips ?? config.actions), video: [], audio: [] };
    this._picked = null;
    this._discovered = null;
    if (this._el) { this._build(); if (this._hass) this._update(); }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    this._discover();
    if (!this._el) this._build();
    this._update();
  }

  // The room's players, unless config lists them: a list that's given is used as it is.
  _discover() {
    const h = this._hass, c = this._config, g = this._given;
    const key = h.entities;
    if (this._discovered === key) return;
    this._discovered = key;
    let video = g.video, audio = g.audio;
    if (c.area && (!video.length || !audio.length)) {
      const skip = new Set([...video, ...audio].map((p) => p.entity).concat(asItems(c.exclude).map((i) => i.entity)));
      const found = pick(h, areaEntities(h, c.area), { domains: "media_player" }).filter((id) => !skip.has(id) && !isGroup(h.states[id]))
        .sort((a, b) => (h.states[a].attributes.friendly_name || a).localeCompare(h.states[b].attributes.friendly_name || b));
      const isAudio = (id) => AUDIO_CLASSES.has(h.states[id].attributes.device_class);
      if (!video.length && !g.audio.length) video = found.filter((id) => !isAudio(id)).map((entity) => ({ entity }));
      else if (!video.length) video = found.filter((id) => !isAudio(id)).map((entity) => ({ entity }));
      if (!audio.length) audio = found.filter(isAudio).map((entity) => ({ entity }));
    }
    c.video = video;
    c.audio = audio;
  }

  connectedCallback() { this._observe(); this._wake(); }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._io?.disconnect();
    clearInterval(this._tick);
    for (const t of this._volTimers?.values() || []) clearTimeout(t);
  }
  getCardSize() { return this._compact ? 2 : this._config?.artwork ? 6 : 4; }
  getGridOptions() { return this._compact ? { columns: 12, min_columns: 6, rows: "auto" } : { columns: 12, min_columns: 6, rows: "auto" }; }

  // ---------- build ----------
  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._resetMotion();
    clearInterval(this._tick);
    this._tick = 0;
    this._first = true;
    this._stageSrc = null;
    this._bars = new Map();
    this._volTimers = new Map();
    const c = this._config;
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <header id="header"><span class="name" id="title"></span></header>
        <section class="stage" id="stage" hidden>
          <img class="art" id="art" alt=""><span class="veil"></span>
          <div class="caption"><span class="t" id="stageT"></span><span class="s" id="stageS"></span></div>
          <div class="progress" id="progress" hidden><i id="progressFill"></i></div>
        </section>
        <div class="body">
          <div class="band" id="videoBand" hidden>
            <span class="cap" id="videoCap" hidden></span>
            <div class="segmented" id="sources" hidden><span class="sel"></span></div>
            <div class="row" id="nowRow">
              <span class="icon" id="nowIcon"></span>
              <span class="meta"><span class="n" id="nowName"></span><span class="d" id="nowSub"></span></span>
              <div class="transport" id="nowTransport"></div>
            </div>
            <div class="nowvol" id="nowVol"></div>
          </div>
          <div class="band" id="audioBand" hidden><span class="cap" id="audioCap" hidden></span></div>
          <div class="band" id="alarmBand" hidden>
            <div class="row">
              <button class="icon" id="alarmIcon"><ha-icon id="alarmGlyph"></ha-icon></button>
              <button class="meta" id="alarmMeta" style="text-align:start"><span class="n" id="alarmName"></span><span class="d" id="alarmSub"></span></button>
              <span class="when" id="alarmWhen"></span>
              <div class="transport"><button class="tb solid" id="alarmToggle"><ha-icon id="alarmToggleIcon"></ha-icon></button></div>
            </div>
          </div>
          <div class="band" id="extras" hidden>
            <div class="pills" id="presets" hidden></div>
            <div class="tts" id="tts" hidden>
              <input id="ttsInput" type="text" enterkeyhint="send" autocomplete="off" spellcheck="false">
              <button class="send" id="ttsSend" aria-label="Speak"><ha-icon icon="mdi:send"></ha-icon></button>
            </div>
            <div class="pills" id="actions" hidden></div>
          </div>
        </div>
      </ha-card>`;
    if (this._compact) {
      root.getElementById("nowIcon").innerHTML = `<img class="thumb" id="thumb" alt="" hidden><ha-icon id="nowGlyph"></ha-icon>`;
      root.querySelector("ha-card").setAttribute("data-compact", "");
      for (const id of ["stage", "sources", "audioBand", "alarmBand", "extras", "videoCap"]) root.getElementById(id).hidden = true;
    }
    const $ = (id) => root.getElementById(id);
    this._el = { card: root.querySelector("ha-card"), header: $("header"), title: $("title"), stage: $("stage"), art: $("art"), thumb: $("thumb"), nowGlyph: $("nowGlyph"),
      stageT: $("stageT"), stageS: $("stageS"), progress: $("progress"), progressFill: $("progressFill"), videoBand: $("videoBand"), sources: $("sources"),
      nowRow: $("nowRow"), nowIcon: $("nowIcon"), nowName: $("nowName"), nowSub: $("nowSub"), nowTransport: $("nowTransport"), nowVol: $("nowVol"),
      audioBand: $("audioBand"), videoCap: $("videoCap"), audioCap: $("audioCap"), alarmBand: $("alarmBand"), alarmIcon: $("alarmIcon"), alarmGlyph: $("alarmGlyph"),
      alarmMeta: $("alarmMeta"), alarmName: $("alarmName"), alarmSub: $("alarmSub"), alarmWhen: $("alarmWhen"), alarmToggle: $("alarmToggle"),
      alarmToggleIcon: $("alarmToggleIcon"), extras: $("extras"), presets: $("presets"), tts: $("tts"), ttsInput: $("ttsInput"), ttsSend: $("ttsSend"), actions: $("actions") };
    this._sp = {
      pill: this._spring(0, MOTION.pill, "sources", 0.02),
      pillW: this._spring(0, MOTION.pill, "sources", 0.02),
      art: this._spring(0, MEDIA_MOTION.art, "stage", 0.002),
      swap: this._spring(1, SWAP_IN, "now"),
      progress: this._spring(0, MOTION.value, "stage", 0.0005),
    };
    linkTitle(root, this._el.title, titlePathOf(c), (el, onTap) => this._pressable(el, { onTap }, 0.04));
    const P = (el, onTap, onHold) => this._pressable(el, { onTap, onHold, haptic: null }, 0.08);
    P(this._el.stage, () => this._stageOwner && moreInfo(this, this._stageOwner.entity));
    const alarmTime = () => moreInfo(this, this._config.alarm?.time || this._config.alarm?.entity);
    P(this._el.alarmMeta, alarmTime);
    P(this._el.alarmIcon, alarmTime);
    P(this._el.alarmToggle, () => this._toggleAlarm(), () => moreInfo(this, this._config.alarm?.entity));
    this._el.ttsInput.placeholder = c.tts?.placeholder || "Say something";
    this._el.ttsInput.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") this._speak(); });
    this._el.ttsInput.addEventListener("input", () => this._syncSend());
    P(this._el.ttsSend, () => this._speak());
    this._observe();
  }

  _observe() {
    if (!this._el || !this.isConnected) return;
    this._io = this._io || new IntersectionObserver(([e]) => { this._onscreen = e.isIntersecting; if (this._onscreen) { this._measure(); this._wake(); } });
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => { this._measure(); this._wake(); });
    this._io.disconnect();
    this._io.observe(this);
    this._ro.observe(this._el.card);
  }

  _measure() {
    const sel = this._el?.sources.querySelectorAll(".seg")[this._pickedIdx || 0];
    if (!sel) return;
    const first = this._first || this._sp.pillW.x === 0;
    this._sp.pill[first ? "snap" : "to"](sel.offsetLeft);
    this._sp.pillW[first ? "snap" : "to"](sel.offsetWidth);
  }

  // A volume bar. Nothing moves until a drag is clearly sideways, so a press, or a finger
  // on its way to scrolling the page, never changes the volume (CARD-DESIGN.md 3.1); then
  // the level follows the finger 1:1 from where it was, instead of jumping to it.
  _bar(key, el) {
    const group = `vol:${key}`;
    const value = this._spring(0, MOTION.value, group, 0.002);
    const grab = this._spring(0, MEDIA_MOTION.grab, group);
    const bar = { el, value, grab, cfg: null, dragging: false, pending: null, last: 0 };
    // an optimistic level, shown until HA reports it or it expires
    bar.guess = (v) => {
      bar.pending = v;
      bar.pendingAt = Date.now();
      clearTimeout(bar.expiry);
      bar.expiry = setTimeout(() => { bar.pending = null; if (this._hass) this._update(); }, VOL_PREDICT + 50);
    };
    bar.write = (v) => this._volumeIO(bar.cfg)?.write(v);
    this._bars.set(key, bar);
    const slider = el.querySelector(".slider");
    let id = null, x0 = 0, y0 = 0, xs = 0, from = 0, live = false;
    const at = (clientX) => clamp(from + (clientX - xs) / Math.max(1, slider.getBoundingClientRect().width));
    slider.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      e.stopPropagation();
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; live = false;
      try { slider.setPointerCapture(e.pointerId); } catch (err) { /* already lifted */ }
    });
    slider.addEventListener("pointermove", (e) => {
      if (e.pointerId !== id) return;
      if (!e.buttons && e.pointerType === "mouse") { id = null; return; }
      if (!live) {
        const dx = e.clientX - x0, dy = e.clientY - y0;
        if (Math.hypot(dx, dy) < SLOP) return;
        if (Math.abs(dy) >= Math.abs(dx)) { id = null; return; }   // vertical: the page scrolls
        live = true;
        bar.dragging = true;
        grab.to(1);
        xs = e.clientX;
        from = clamp(bar.pending ?? value.x);
        bar.last = Math.round(from * 10);
      }
      const v = at(e.clientX);
      value.snap(v);
      bar.guess(v);
      const notch = Math.round(v * 10);     // a tick of feedback every 10%
      if (notch !== bar.last) { bar.last = notch; haptic("selection"); }
      this._send(bar, v, true);
      this._wake();
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      if (!live) return;
      live = false;
      bar.dragging = false;
      grab.to(0);
      this._send(bar, value.x);
      this._wake();
    };
    slider.addEventListener("pointerup", end);
    slider.addEventListener("pointercancel", end);
    // one volume_step (default 5%), from the − / + buttons or the arrow keys
    bar.step = (d) => {
      const size = (Number(this._config.volume_step) || 5) / 100;
      const v = clamp((bar.pending ?? value.target) + d * size);
      if (Math.abs(v - (bar.pending ?? value.target)) < 1e-6) return;
      bar.guess(v);
      value.to(v);
      haptic("selection");
      this._send(bar, v);
      this._wake();
    };
    slider.addEventListener("keydown", (e) => {
      const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      bar.step(d);
    });
    return bar;
  }

  // writes are throttled while dragging; the release always lands
  _send(bar, v, throttle = false) {
    bar.queued = v;
    if (throttle) {
      if (this._volTimers.get(bar)) return;
      this._volTimers.set(bar, setTimeout(() => { this._volTimers.delete(bar); this._flush(bar); }, VOL_THROTTLE));
      return;
    }
    clearTimeout(this._volTimers.get(bar));
    this._volTimers.delete(bar);
    this._flush(bar);
  }
  _flush(bar) { if (bar.queued == null) return; bar.write(bar.queued); bar.queued = null; }

  // ---------- actions ----------
  _call(domain, service, data, entity) { this._hass.callService(domain, service, data || {}, { entity_id: entity }); }

  _playerIcon(cfg, st) {
    if (cfg.icon) return cfg.icon;
    const dc = st?.attributes.device_class;
    if (PLAYER_ICONS[dc]) return PLAYER_ICONS[dc];
    if (/ps\d|playstation|xbox|switch_console/i.test(cfg.entity)) return PLAYER_ICONS.game;
    return PLAYER_ICONS.default;
  }

  // a player may be powered by its own service or by a separate switch
  _isOn(cfg) {
    const guess = this._optimistic.get(cfg.entity);
    if (guess && Date.now() - guess.at < OPTIMISTIC_MS) return guess.on;
    if (cfg.power) { const p = this._hass.states[cfg.power]; if (p) return p.state === "on"; }
    const st = this._hass.states[cfg.entity];
    return !!st && !DEAD.has(st.state);
  }

  _togglePower(cfg) {
    const on = this._isOn(cfg);
    this._optimistic.set(cfg.entity, { on: !on, at: Date.now() });
    haptic("light");
    setTimeout(() => this._hass && this._update(), OPTIMISTIC_MS + 50);
    if (cfg.power) return this._call(domainOf(cfg.power), "toggle", {}, cfg.power);
    this._call("media_player", on ? "turn_off" : "turn_on", {}, cfg.entity);
  }

  _transport(cfg, action) { haptic("light"); this._call("media_player", action, {}, cfg.entity); }

  _mute(cfg, target) {
    const st = this._hass.states[target || cfg.entity];
    haptic("light");
    this._call("media_player", "volume_mute", { is_volume_muted: !st?.attributes.is_volume_muted }, target || cfg.entity);
  }

  // A room's real volume is sometimes a helper rather than the player's own level.
  _volumeIO(cfg) {
    const id = cfg.volume || cfg.entity;
    const st = this._hass.states[id];
    if (!st) return null;
    if (id.startsWith("input_number.") || id.startsWith("number.")) {
      const min = Number(st.attributes.min ?? 0), max = Number(st.attributes.max ?? 100);
      const span = Math.max(1e-6, max - min);
      return { id, level: clamp((parseFloat(st.state) - min) / span), write: (v) => this._call(domainOf(id), "set_value", { value: Math.round((min + v * span) * 100) / 100 }, id) };
    }
    if (!has(st, F.VOLUME_SET)) return null;
    return { id, level: clamp(Number(st.attributes.volume_level) || 0), muted: !!st.attributes.is_volume_muted,
      write: (v) => this._call("media_player", "volume_set", { volume_level: Math.round(v * 100) / 100 }, id) };
  }

  _runChip(cfg, kind) {
    const a = kind === "hold" ? (cfg.hold_action !== undefined ? mediaAction(cfg.hold_action, cfg.entity) : { action: "more-info" })
      : cfg.tap_action !== undefined ? mediaAction(cfg.tap_action, cfg.entity)
      : cfg.navigation_path ? { action: "navigate", navigation_path: cfg.navigation_path }
      : cfg.entity ? defaultTapAction(cfg.entity) : null;
    if (!a || a.action === "none") return;
    haptic("light");
    runAction(this, this._hass, a, { entity: cfg.entity });
  }

  _speak() {
    const cfg = this._config.tts, input = this._el.ttsInput;
    const msg = input.value.trim();
    if (!cfg || !msg) return;
    const [domain, service] = String(cfg.action || "tts.speak").split(".");
    // any value written as $MSG in the config is where the text goes
    const fill = (v) => (typeof v === "string" ? v.replace(/\$MSG/g, msg) : Array.isArray(v) ? v.map(fill)
      : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v);
    const data = cfg.data ? fill({ ...cfg.data }) : { message: msg };
    if (cfg.data && JSON.stringify(cfg.data) === JSON.stringify(data)) data.message = msg;
    const target = data.entity_id;
    delete data.entity_id;
    this._hass.callService(domain, service, data, target ? { entity_id: target } : undefined);
    haptic("light");
    input.value = "";
    this._syncSend();
  }
  _syncSend() { attr(this._el.ttsSend, "disabled", !this._el.ttsInput.value.trim()); }

  // ---------- what's playing ----------
  _mediaOf(cfg) {
    const st = this._hass.states[cfg.entity];
    if (!st) return { title: cfg.name || title(cfg.entity.split(".")[1]), sub: "Not found", missing: true };
    const a = st.attributes;
    const name = cfg.name || shortName(this._hass, cfg.entity, this._config.area);
    if (!this._isOn(cfg)) return { name, st, title: name, sub: "Off", off: true };
    let line = a.media_title || "", sub = "";
    if (a.media_series_title) {
      // a show reads as its name, then where you are in it
      line = a.media_series_title;
      const ep = [a.media_season != null ? `S${a.media_season}` : "", a.media_episode != null ? `E${a.media_episode}` : ""].join("");
      sub = [ep, a.media_title].filter(Boolean).join(" · ");
    } else if (a.media_artist) sub = [a.media_artist, a.media_album_name].filter(Boolean).join(" · ");
    if (!sub) sub = a.app_name || a.source || "";
    if (!line) line = a.app_name || a.source || (st.state === "playing" ? "Playing" : chipState(this._hass, st));
    return { name, st, title: line, sub: sub || name, playing: ACTIVE.has(st.state) };
  }

  // the stage only appears with real artwork, where the room says it may show it
  _artOf(cfg) {
    if (!this._config.artwork || !cfg || cfg.artwork === false) return null;
    const st = this._hass.states[cfg.entity];
    if (!st || !ACTIVE.has(st.state)) return null;
    if (typeof cfg.artwork === "string") { const gate = this._hass.states[cfg.artwork]; if (!gate || gate.state !== "on") return null; }
    return st.attributes.entity_picture || null;
  }

  _position(st) {
    const a = st?.attributes || {};
    const dur = Number(a.media_duration);
    if (!Number.isFinite(dur) || dur <= 0) return null;
    let pos = Number(a.media_position) || 0;
    if (st.state === "playing" && a.media_position_updated_at) pos += (Date.now() - Date.parse(a.media_position_updated_at)) / 1000;
    return clamp(pos / dur);
  }

  // ---------- update ----------
  _rowOf(parent, key, tag, cls, html) {
    const cache = parent.__rows || (parent.__rows = new Map());
    let el = cache.get(key);
    if (!el) {
      el = document.createElement(tag);
      el.className = cls;
      el.innerHTML = html;
      cache.set(key, el);
      parent.appendChild(el);
    }
    return el;
  }

  _update() {
    const h = this._hass, c = this._config, el = this._el;
    if (!h || !el) return;
    const cap = c.artwork_max_height;
    put(el.stage, "--art-max", cap ? (typeof cap === "number" ? `${cap}px` : String(cap)) : "none");
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    if (c.accent) put(el.card, "--accent", this._rgb(c.accent));
    // the glow: the accent while anything is playing, quieter while a player is only on
    const mine = [...c.video, ...c.audio];
    const playing = mine.some((m) => ACTIVE.has(h.states[m.entity]?.state)), awake = mine.some((m) => this._isOn(m));
    stateGlow(c, el.card, playing || awake ? getComputedStyle(el.card).getPropertyValue("--accent").trim().split(/\s+/).map(Number) : null, playing ? 1 : 0.45);
    text(el.title, c.name || c.title || (c.area ? areaInfo(h, c.area).name : "Media"));
    this._sources();
    if (!this._compact) this._stage();      // decides what the stage owns, so rows can defer
    this._nowPlaying();
    if (!this._compact) { this._outputs(); this._alarm(); this._chips(); }
    const labels = c.labels || {};
    for (const [key, node] of [["video", el.videoCap], ["audio", el.audioCap]]) {
      node.hidden = !labels[key];
      if (labels[key]) text(node, labels[key]);
    }
    let firstSeen = false;
    for (const band of [el.videoBand, el.audioBand, el.alarmBand, el.extras]) {
      attr(band, "data-first", !band.hidden && !firstSeen);
      if (!band.hidden) firstSeen = true;
    }
    if (this._first) { this._first = false; requestAnimationFrame(() => { this._measure(); this._paintAll(null); }); }
    this._syncTick();
    this._wake();
  }

  _rgb(css) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(css).trim());
    if (!m) return css;
    const n = parseInt(m[1], 16);
    return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
  }

  // Which video source the row and stage are about: the pick while it's still sensible,
  // else whatever is actually playing. A pick is released only when something new starts.
  _sources() {
    const c = this._config, el = this._el;
    if (this._compact) return this._primary();
    el.videoBand.hidden = !c.video.length;
    if (!c.video.length) { this._active = null; return; }
    const live = c.video.filter((v) => ACTIVE.has(this._hass.states[v.entity]?.state));
    const sig = live.map((v) => v.entity).join("|");
    if (this._liveSig === undefined) this._liveSig = sig;
    if (sig !== this._liveSig) { this._liveSig = sig; if (sig) this._picked = null; }
    const on = c.video.filter((v) => this._isOn(v));
    if (this._picked && !c.video.some((v) => v.entity === this._picked)) this._picked = null;
    const auto = live[0] || on[0] || c.video[0];
    const active = this._picked ? c.video.find((v) => v.entity === this._picked) : auto;
    const changed = this._active && this._active.entity !== active.entity;
    this._active = active;
    this._pickedIdx = c.video.indexOf(active);
    el.sources.hidden = c.video.length < 2;
    if (!el.sources.hidden) {
      c.video.forEach((v) => {
        const st = this._hass.states[v.entity];
        const seg = this._rowOf(el.sources, v.entity, "button", "seg", `<ha-icon></ha-icon><span></span>`);
        if (!seg.__wired) {
          seg.__wired = true;
          this._pressable(seg, { onTap: () => this._pick(v), onHold: () => moreInfo(this, v.entity), haptic: null }, 0.08);
        }
        attr(seg.querySelector("ha-icon"), "icon", this._playerIcon(v, st));
        text(seg.querySelector("span"), v.name || shortName(this._hass, v.entity, c.area));
        attr(seg, "data-sel", v === active);
        attr(seg, "data-live", this._isOn(v));
        attr(seg, "aria-pressed", v === active ? "true" : "false");
      });
      this._measure();
    }
    if (changed && !MQ.reduced.matches) this._sp.swap.snap(0).to(1, SWAP_IN);
  }

  // compact: one row for the room, showing whatever is actually playing
  _primary() {
    const c = this._config, all = [...c.video, ...c.audio];
    this._el.videoBand.hidden = !all.length;
    if (!all.length) { this._active = null; return; }
    const next = all.find((p) => ACTIVE.has(this._hass.states[p.entity]?.state)) || all.find((p) => this._isOn(p)) || all[0];
    if (this._active && this._active.entity !== next.entity && !MQ.reduced.matches) this._sp.swap.snap(0).to(1, SWAP_IN);
    this._active = next;
  }

  _pick(v) {
    if (this._active?.entity === v.entity) return moreInfo(this, v.entity);
    this._picked = v.entity;
    haptic("selection");
    this._update();
  }

  _nowPlaying() {
    const el = this._el, v = this._active;
    if (!v) return;
    const info = this._mediaOf(v), st = info.st;
    if (this._compact) {
      // a piece of the artwork stands in for the whole stage
      const url = this._config.artwork !== false ? this._artOf(v) : null;
      el.thumb.hidden = !url;
      el.nowGlyph.hidden = !!url;
      if (url && el.thumb.getAttribute("src") !== url) el.thumb.src = url;
      attr(el.nowGlyph, "icon", this._playerIcon(v, st));
      attr(el.nowIcon, "data-live", !url && this._isOn(v));
    } else {
      attr(el.nowIcon, "data-live", this._isOn(v));
      attr(this._rowOf(el.nowIcon, "i", "ha-icon", "", ""), "icon", this._playerIcon(v, st));
    }
    if (!el.nowIcon.__wired) {
      el.nowIcon.__wired = true;
      this._pressable(el.nowIcon, { onTap: () => moreInfo(this, el.nowIcon.__entity), haptic: null }, 0.08);
    }
    el.nowIcon.__entity = v.entity;
    if (this._compact) {
      // no stage here: the row leads with what's playing rather than which box
      const dead = info.off || info.missing;
      const primary = dead ? (info.name || info.title) : info.title;
      const second = !dead && (!info.sub || info.sub === primary) ? info.name : info.sub;
      text(el.nowName, primary);
      text(el.nowSub, second === primary ? "" : second);
    } else {
      text(el.nowName, info.name || info.title);
      text(el.nowSub, this._rowSub(v, info));
    }
    this._buildTransport(el.nowTransport, v, { power: true });
    const owner = this._volumeOwner(v);
    el.nowVol.hidden = !owner;
    if (owner) this._mountVolume(el.nowVol, owner, "source");
  }

  // when the stage already shows this player's media, the row says where it comes from
  _rowSub(cfg, info) {
    if (info.off) return "Off";
    if (info.missing) return info.sub;
    const staged = this._stageOwner?.entity === cfg.entity && !this._el.stage.hidden;
    const a = info.st?.attributes || {};
    if (staged) return a.app_name || a.source || chipState(this._hass, info.st);
    if (info.title === info.name) return info.sub;
    const extra = info.sub !== info.name && info.sub !== info.title ? info.sub : "";
    return [info.title, extra].filter(Boolean).join(" · ");
  }

  // transport buttons follow what the player says it supports
  _buildTransport(parent, cfg, { power = false, solid = true } = {}) {
    const st = this._hass.states[cfg.entity];
    const on = this._isOn(cfg), playing = ACTIVE.has(st?.state);
    const want = [];
    if (has(st, F.PREV)) want.push({ key: "prev", icon: "mdi:skip-previous", act: () => this._transport(cfg, "media_previous_track") });
    if (has(st, F.PAUSE) || has(st, F.PLAY)) want.push({ key: "play", solid, icon: playing ? "mdi:pause" : "mdi:play", act: () => this._transport(cfg, "media_play_pause") });
    if (has(st, F.NEXT)) want.push({ key: "next", icon: "mdi:skip-next", act: () => this._transport(cfg, "media_next_track") });
    if (power && (cfg.power || has(st, F.TURN_ON) || has(st, F.TURN_OFF))) want.push({ key: "power", icon: "mdi:power", on, act: () => this._togglePower(cfg) });
    for (const b of want) {
      const btn = this._rowOf(parent, b.key, "button", `tb${b.solid ? " solid" : ""}`, `<ha-icon></ha-icon>`);
      if (!btn.__wired) { btn.__wired = true; this._pressable(btn, { onTap: () => btn.__act(), haptic: null }, 0.08); }
      btn.__act = b.act;
      attr(btn, "aria-label", b.key);
      attr(btn, "data-k", b.key);
      attr(btn, "data-on", !!b.on);
      attr(btn, "disabled", !(on || b.key === "power"));
      attr(btn.querySelector("ha-icon"), "icon", b.icon);
    }
    // the DOM order is fixed, whichever button was built first: power is always the last
    let at = 0;
    for (const key of ["prev", "play", "next", "power"]) { const node = parent.__rows?.get(key); if (node) place(parent, node, at++); }
    const keys = new Set(want.map((b) => b.key));
    for (const [key, node] of parent.__rows || []) Motion.show(node, keys.has(key));
    parent.hidden = !want.length;
  }

  _outputs() {
    const el = this._el, c = this._config;
    el.audioBand.hidden = !c.audio.length;
    for (const cfg of c.audio) {
      const key = slug(cfg.entity);
      const row = this._rowOf(el.audioBand, key, "div", "player", `<div class="row">
          <span class="icon"><ha-icon></ha-icon></span>
          <span class="meta"><span class="n"></span><span class="d"></span></span>
          <div class="transport"></div></div>`);
      const st = this._hass.states[cfg.entity];
      const info = this._mediaOf(cfg);
      const icon = row.querySelector(".icon");
      attr(icon, "data-live", this._isOn(cfg));
      attr(icon.querySelector("ha-icon"), "icon", this._playerIcon(cfg, st));
      text(row.querySelector(".n"), info.name || info.title);
      text(row.querySelector(".d"), this._rowSub(cfg, info));
      this._buildTransport(row.querySelector(".transport"), cfg, { power: true });
      if (!icon.__wired) { icon.__wired = true; this._pressable(icon, { onTap: () => moreInfo(this, cfg.entity), haptic: null }, 0.08); }
      this._mountVolume(row, cfg, key);
    }
    const keys = new Set(c.audio.map((cfg) => slug(cfg.entity)));
    for (const [key, node] of el.audioBand.__rows || []) Motion.show(node, keys.has(key));
  }

  // the alarm clock that rings on this room's speaker: when it's set, and whether it's on
  _alarm() {
    const cfg = this._config.alarm, el = this._el, h = this._hass;
    const st = cfg && h.states[cfg.entity];
    el.alarmBand.hidden = !st;
    if (!st) return;
    const armed = st.state === "on";
    const time = cfg.time && h.states[cfg.time];
    attr(el.alarmIcon, "data-live", armed);
    attr(el.alarmGlyph, "icon", cfg.icon || (armed ? "mdi:alarm" : "mdi:alarm-off"));
    text(el.alarmName, cfg.name || st.attributes.friendly_name || "Alarm");
    text(el.alarmSub, armed ? (time ? this._nextAlarm(time) : "Armed") : "Off");
    text(el.alarmWhen, time ? this._clock(time.state) : "");
    attr(el.alarmWhen, "data-off", !armed);
    el.alarmWhen.hidden = !time;
    attr(el.alarmToggle, "data-on", armed);
    attr(el.alarmToggleIcon, "icon", armed ? "mdi:bell" : "mdi:bell-outline");
    attr(el.alarmToggle, "aria-pressed", armed ? "true" : "false");
    attr(el.alarmToggle, "aria-label", `Alarm ${armed ? "on" : "off"}`);
    attr(el.alarmMeta, "aria-label", `Alarm time ${time ? this._clock(time.state) : "not set"}`);
  }

  _toggleAlarm() {
    const id = this._config.alarm?.entity;
    if (!id) return;
    haptic("light");
    this._call(domainOf(id), "toggle", {}, id);
  }

  // input_datetime says "07:15:00": shown the way this dashboard's locale writes time
  _clock(value) {
    const [hh, mm] = String(value || "").split(":");
    if (hh == null || mm == null) return "";
    const d = new Date();
    d.setHours(Number(hh), Number(mm), 0, 0);
    const fmt = this._hass.locale?.time_format, opts = { hour: "2-digit", minute: "2-digit" };
    if (fmt === "12") opts.hour12 = true;
    if (fmt === "24") opts.hour12 = false;
    try { return new Intl.DateTimeFormat(langOf(this._hass), opts).format(d); } catch (err) { return `${hh}:${mm}`; }
  }

  // how long until it goes off, so the number means something at a glance
  _nextAlarm(time) {
    const [hh, mm] = String(time.state || "").split(":").map(Number);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return "Armed";
    const now = new Date(), at = new Date();
    at.setHours(hh, mm, 0, 0);
    if (at <= now) at.setDate(at.getDate() + 1);
    const mins = Math.round((at - now) / 60000), h = Math.floor(mins / 60), m = mins % 60;
    return h ? `in ${h}h ${m}m` : `in ${m}m`;
  }

  // a volume block, under a speaker, or under a TV that has no sound output of its own
  _mountVolume(host, cfg, key) {
    let vol = host.querySelector(".vol");
    if (!vol) {
      vol = document.createElement("div");
      vol.className = "vol";
      vol.innerHTML = `<button class="mute" aria-label="Mute"><ha-icon></ha-icon></button>
        <div class="slider" role="slider" tabindex="0" aria-label="Volume"><div class="bar"><span class="fill"></span></div></div>
        <span class="pct"></span>
        <span class="vsteps"><button class="vstep" data-d="-1" aria-label="Volume down"><ha-icon icon="mdi:minus"></ha-icon></button>
          <button class="vstep" data-d="1" aria-label="Volume up"><ha-icon icon="mdi:plus"></ha-icon></button></span>`;
      host.appendChild(vol);
    }
    const io = this._volumeIO(cfg);
    vol.hidden = !io;
    if (!io) return;
    let bar = this._bars.get(key);
    if (!bar) bar = this._bar(key, vol);
    if (bar.cfg && bar.cfg.entity !== cfg.entity) { bar.pending = null; bar.value.snap(io.level); }
    bar.cfg = cfg;
    if (bar.pending != null && (Math.abs(bar.pending - io.level) < 0.02 || Date.now() - bar.pendingAt > VOL_PREDICT)) bar.pending = null;
    if (!bar.dragging && bar.pending == null) { if (this._first) bar.value.snap(io.level); else bar.value.to(io.level); }
    const mute = vol.querySelector(".mute");
    const muteable = has(this._hass.states[io.id], F.VOLUME_MUTE);
    mute.hidden = !muteable;
    if (muteable) {
      attr(mute, "data-on", !!io.muted);
      attr(mute.querySelector("ha-icon"), "icon", io.muted ? "mdi:volume-off" : "mdi:volume-high");
      mute.__act = () => this._mute(bar.cfg, this._volumeIO(bar.cfg)?.id);
      if (!mute.__wired) { mute.__wired = true; this._pressable(mute, { onTap: () => mute.__act(), haptic: null }, 0.08); }
    }
    const steps = this._config.volume_buttons !== false;
    attr(vol, "data-steps", steps);
    vol.querySelector(".vsteps").hidden = !steps;
    for (const btn of vol.querySelectorAll(".vstep")) {
      btn.__bar = bar;
      if (steps && !btn.__wired) { btn.__wired = true; this._pressable(btn, { onTap: () => btn.__bar.step(Number(btn.dataset.d)), haptic: null }, 0.08); }
    }
    const slider = vol.querySelector(".slider");
    attr(slider, "aria-valuenow", Math.round(io.level * 100));
    attr(slider, "aria-valuemin", "0");
    attr(slider, "aria-valuemax", "100");
  }

  // Where a source's sound comes out; nothing declared means the box plays its own.
  _soundOutput(cfg) { return (cfg.output !== undefined ? cfg.output : this._config.video_output) || null; }

  // Whose volume belongs under the picked source: nothing if its sound goes to a box with
  // a row of its own (that row owns it); that box's if it has no row; otherwise its own.
  _volumeOwner(cfg) {
    if (cfg.volume === false) return null;
    const out = this._soundOutput(cfg);
    if (!out) return cfg;
    const listed = this._config.audio.find((a) => a.entity === out);
    if (listed) return this._compact ? listed : null;      // compact has no speaker row: it borrows
    const named = this._config.video.find((v) => v.entity === out);
    return named ? { ...named } : { entity: out };
  }

  _chips() {
    const el = this._el, c = this._config, h = this._hass;
    const fill = (parent, list) => {
      const keys = new Set();
      for (const cfg of list) {
        const st = cfg.entity && h.states[cfg.entity];
        if (cfg.entity && !st && !cfg.navigation_path) continue;
        const key = cfg.entity || cfg.navigation_path || cfg.name;
        keys.add(key);
        const chip = this._rowOf(parent, key, "button", "pill", `${cfg.icon ? "<ha-icon></ha-icon>" : "<savvy-state-icon></savvy-state-icon>"}<span></span>`);
        if (!chip.__wired) {
          chip.__wired = true;
          this._pressable(chip, { onTap: () => this._runChip(chip.__cfg, "tap"), onHold: () => this._runChip(chip.__cfg, "hold"), haptic: null }, 0.08);
        }
        chip.__cfg = cfg;
        put(chip, "--cc", colorOf(cfg.color) || "rgb(var(--accent))");
        attr(chip, "data-on", !!st && ["on", "playing", "home", "open"].includes(st.state));
        text(chip.querySelector("span"), cfg.name || st?.attributes.friendly_name || title(String(key).split(".").pop()));
        const sIcon = chip.querySelector("savvy-state-icon");
        if (sIcon && sIcon.stateObj !== st) { sIcon.hass = h; sIcon.stateObj = st; }
        const iIcon = chip.querySelector("ha-icon");
        if (iIcon) attr(iIcon, "icon", cfg.icon);
      }
      for (const [key, node] of parent.__rows || []) Motion.show(node, keys.has(key));
      parent.hidden = !keys.size;
    };
    fill(el.presets, c.presets);
    fill(el.actions, c.chips);
    el.tts.hidden = !c.tts;
    if (c.tts) this._syncSend();
    el.extras.hidden = el.presets.hidden && el.actions.hidden && el.tts.hidden;
  }

  _stage() {
    const el = this._el, c = this._config;
    // the stage follows the picked source first, then anything else that's playing
    let src = null, owner = null;
    for (const cfg of [this._active, ...c.video, ...c.audio].filter(Boolean)) {
      const url = this._artOf(cfg);
      if (url) { src = url; owner = cfg; break; }
    }
    el.stage.hidden = !src;
    if (!src) { this._sp.art.snap(0); this._stageOwner = null; return; }
    if (this._stageSrc !== src) {
      this._stageSrc = src;
      this._sp.art.snap(0);
      // the stage takes the artwork's shape first, then the artwork arrives into it
      el.art.onload = () => {
        const r = el.art.naturalWidth / el.art.naturalHeight;
        if (Number.isFinite(r) && r > 0.05) put(el.stage, "--ar", clamp(r, 0.56, 2.6).toFixed(4));
        this._sp.art.to(1, MEDIA_MOTION.art);
        this._wake();
      };
      el.art.onerror = () => { this._sp.art.to(1, MEDIA_MOTION.art); this._wake(); };
      el.art.src = src;
    }
    this._stageOwner = owner;
    const info = this._mediaOf(owner);
    text(el.stageT, info.title);
    text(el.stageS, info.sub);
    const pos = this._position(this._hass.states[owner.entity]);
    el.progress.hidden = pos == null;
    if (pos != null) {
      if (this._first || Math.abs(pos - this._sp.progress.x) > 0.08) this._sp.progress.snap(pos);
      else this._sp.progress.to(pos);
    }
  }

  // one ticking clock, only while something is actually running on screen
  _syncTick() {
    const owner = this._stageOwner;
    const need = !!owner && ACTIVE.has(this._hass.states[owner.entity]?.state) && this._position(this._hass.states[owner.entity]) != null;
    if (need === !!this._tick) return;
    clearInterval(this._tick);
    this._tick = need ? setInterval(() => {
      if (!this._onscreen || !this._stageOwner) return;
      const p = this._position(this._hass.states[this._stageOwner.entity]);
      if (p != null) { this._sp.progress.to(p); this._wake(); }
    }, 1000) : 0;
  }

  _paint(dirty, all, red) {
    const sp = this._sp, el = this._el;
    if (all || dirty.has("sources")) {
      const pill = el.sources.querySelector(".sel"), w = Math.max(0, sp.pillW.x);
      put(pill, "opacity", w < 1 ? "0" : "");
      put(pill, "width", `${w.toFixed(2)}px`);
      put(pill, "transform", `translate3d(${sp.pill.x.toFixed(2)}px,0,0)`);
    }
    if (all || dirty.has("now")) {
      const s = clamp(sp.swap.x);
      put(el.nowRow, "opacity", s > 0.999 ? "" : s.toFixed(3));
      put(el.nowRow, "transform", red || s > 0.999 ? "" : `translateY(${((1 - s) * 5).toFixed(2)}px)`);
    }
    if (all || dirty.has("stage")) {
      const a = clamp(sp.art.x);
      // blur and scale together, so the artwork arrives as a material
      put(el.art, "opacity", a.toFixed(3));
      put(el.art, "filter", red || a > 0.995 ? "" : `blur(${((1 - a) * 14).toFixed(2)}px)`);
      put(el.art, "transform", red || a > 0.995 ? "" : `scale(${(1.04 - 0.04 * a).toFixed(4)})`);
      put(el.progressFill, "transform", `scaleX(${clamp(sp.progress.x).toFixed(4)})`);
    }
    for (const [, bar] of this._bars) {
      if (!all && !dirty.has(bar.value.group)) continue;
      const v = clamp(bar.value.x), g = clamp(bar.grab.x);
      put(bar.el.querySelector(".fill"), "transform", `scaleX(${v.toFixed(4)})`);
      put(bar.el.querySelector(".bar"), "transform", red ? "" : `scaleY(${(1 + 0.45 * g).toFixed(3)})`);
      text(bar.el.querySelector(".pct"), `${Math.round(v * 100)}%`);
      const [down, up] = bar.el.querySelectorAll(".vstep");
      if (down) attr(down, "disabled", v <= 0.001);
      if (up) attr(up, "disabled", v >= 0.999);
    }
  }
}

// ---------- editor ----------
const playerList = (name, label, helper) => ({ name, label, helper, type: "list", add: { selector: { entity: { domain: "media_player" } }, label: "Add a player" },
  item: [
    { name: "entity", label: "Player", selector: { entity: { domain: "media_player" } } },
    { type: "grid", name: "", schema: [{ name: "name", label: "Name", selector: { text: {} } }, { name: "icon", label: "Icon", selector: { icon: {} } }] },
    { name: "power", label: "Power switch", helper: "A switch that powers it, when the player can't turn itself on.", selector: { entity: { domain: ["switch", "input_boolean"] } } },
    { name: "output", label: "Sound output", helper: "Where this source's sound comes out. Empty: it plays through itself. Overrides the card's output for all sources.", selector: { entity: { domain: "media_player" } } },
    { name: "volume", label: "Volume helper", helper: "A helper that is the real volume, when the player's own isn't.", selector: { entity: { domain: ["input_number", "number"] } } },
    { name: "artwork", label: "Artwork when", helper: "A binary sensor that says the artwork is worth showing.", selector: { entity: { domain: "binary_sensor" } } },
  ] });

const EDITOR = defineEditor("savvy-media-card", (hass, c) => [
  S.area(),
  S.grid(S.text("name", "Name"), S.select("layout", "Layout", [{ value: "full", label: "Full" }, { value: "compact", label: "Compact (one row)" }])),
  S.titleLink("name"),
  playerList("video", "Video sources", "Empty: the area's players (not its speakers)."),
  playerList("audio", "Speakers", "The room's speakers: each gets its own row with transport, volume and power. Empty: the area's speakers and receivers."),
  { name: "video_output", label: "Sound output for all sources", helper: "The speaker, receiver or soundbar every video source plays through. Its volume sits under the picked source.", selector: { entity: { domain: "media_player" } } },
  S.grid(S.bool("artwork", "Show artwork", null, true), S.bool("volume_buttons", "Volume buttons", null, true)),
  S.grid(S.number("volume_step", "Volume step", 1, 25, 1, "%"), S.number("artwork_max_height", "Artwork height", 80, 800, 10, "px")),
  { type: "expandable", name: "labels", title: "Captions", schema: [S.text("video", "Video caption"), S.text("audio", "Speaker caption")] },
  { type: "expandable", name: "alarm", title: "Alarm clock", schema: [
    { name: "entity", label: "On / off", selector: { entity: { domain: ["input_boolean", "switch"] } } },
    { name: "time", label: "Time", selector: { entity: { domain: "input_datetime" } } },
    { name: "name", label: "Name", selector: { text: {} } },
  ] },
  { type: "expandable", name: "tts", title: "Text to speech", schema: [
    { name: "action", label: "Action", helper: "e.g. tts.speak, or notify.alexa_media_…", selector: { text: {} } },
    { name: "data", label: "Data", helper: "$MSG is where the text goes.", selector: { object: {} } },
    { name: "placeholder", label: "Placeholder", selector: { text: {} } },
  ] },
  S.chips("presets", "Presets", "Stations, playlists: a button presses, a script runs."),
  S.chips("chips", "Custom chips", "The room's other media controls."),
]);

registerCard("savvy-media-card", SavvyMediaCard, "Media",
  "A room's media: artwork, its sources and the speaker they play through, volume, presets and text to speech.");
})();

// ===== cards/room-activity.js =====
(() => {
// savvy-room-activity-card: a security glance at one room. Is anything happening here, and
// when did it last happen? Everything is found from the area by device_class, with a
// per-kind override as the escape hatch.
//
//   events    presence / door / window: the state and "for 12 min" / "4 min ago"
//   readouts  temperature, humidity, light, and quiet "Clear" alert sensors
//   alerts    smoke / gas / CO / leak: quiet while clear; when one trips a banner pins to
//             the top and the whole card washes red
//   chips     your own (the one chip spec), and hand-picked entities placed by what they
//             are: a toggle is a chip, a door a tile, a number a readout
//
// A state that is on has its own colour, alarm or not: presence the accent, an open door or window
// and an unlocked lock amber, a tripped alert red (a leak blue); idle stays grey. `colored_states:
// false` keeps everything grey. The alarm is opt-in: `alarm: alarm_control_panel.home` (or `alarm:
// auto` for the house's first panel) adds the armed pill, and an open door or window while armed, or
// presence while armed away, escalates to red.
//
// Swipe the card left for its history: a lane per presence / door / window sensor over
// the room's temperature, for 6 h / 24 h / 3 d; scrubbing snaps onto the nearest change,
// so "when did the door open" has an exact answer.
//
//   type: custom:savvy-room-activity-card
//   area: living_room            navigation_path: /lovelace/living-room
//   layout: compact              one row: glyphs and the temperature
//   alarm: alarm_control_panel.home | auto | (none)   colored_states: false

const SNAP_TICK_MS = 30000;
const SNAP_PREDICT_MS = 4000;
const SNAP_SCRUB_SLOP = 6;
const SNAP_SCRUB_DWELL = 140;
const SNAP_PX = 10;          // a scrub this close to a change lands on it
const HIST_POLL_MS = 300000;
const SNAP_COLORS = { warn: TONE.warn, alert: TONE.bad, leak: "#5FA8E0" };

// Reading order. kind decides where a sensor renders; single keeps the best match only
// (dc order is the preference), since two temperatures for one room reads as noise.
const SLOTS = [
  { key: "presence", kind: "event", domain: "binary_sensor", dc: ["presence", "occupancy", "motion"], label: "Presence", single: true,
    on: "Occupied", off: "Clear", icon: "mdi:motion-sensor", iconOff: "mdi:motion-sensor-off" },
  { key: "door", kind: "event", domain: "binary_sensor", dc: ["door", "garage_door", "opening"], label: "Door",
    on: "Open", off: "Closed", icon: "mdi:door-open", iconOff: "mdi:door-closed" },
  { key: "window", kind: "event", domain: "binary_sensor", dc: ["window"], label: "Window",
    on: "Open", off: "Closed", icon: "mdi:window-open-variant", iconOff: "mdi:window-closed-variant" },
  { key: "lock", kind: "event", domain: "lock", dc: [], label: "Lock", on: "Unlocked", off: "Locked", icon: "mdi:lock-open-variant", iconOff: "mdi:lock" },
  { key: "temperature", kind: "read", domain: "sensor", dc: ["temperature"], label: "Temperature", single: true, icon: "mdi:thermometer" },
  { key: "humidity", kind: "read", domain: "sensor", dc: ["humidity"], label: "Humidity", single: true, icon: "mdi:water-percent" },
  { key: "illuminance", kind: "read", domain: "sensor", dc: ["illuminance"], label: "Light", single: true, icon: "mdi:brightness-5" },
  { key: "smoke", kind: "alert", domain: "binary_sensor", dc: ["smoke"], label: "Smoke", color: SNAP_COLORS.alert,
    icon: "mdi:smoke-detector-variant-alert", iconOff: "mdi:smoke-detector-variant" },
  { key: "gas", kind: "alert", domain: "binary_sensor", dc: ["gas"], label: "Gas", color: SNAP_COLORS.alert, icon: "mdi:gas-cylinder", iconOff: "mdi:gas-cylinder" },
  { key: "co", kind: "alert", domain: "binary_sensor", dc: ["carbon_monoxide"], label: "CO", color: SNAP_COLORS.alert, icon: "mdi:molecule-co", iconOff: "mdi:molecule-co" },
  { key: "leak", kind: "alert", domain: "binary_sensor", dc: ["moisture"], label: "Leak", color: SNAP_COLORS.leak, icon: "mdi:water-alert", iconOff: "mdi:water-check" },
];
const SLOT = Object.fromEntries(SLOTS.map((s) => [s.key, s]));
const CHIP_TOGGLES = new Set(["input_boolean", "switch", "light", "fan", "siren", "automation"]);
const ARM_ICONS = { armed_home: "mdi:shield-home", armed_away: "mdi:shield-lock", armed_night: "mdi:shield-moon",
  armed_vacation: "mdi:shield-airplane", armed_custom_bypass: "mdi:shield-half-full", triggered: "mdi:shield-alert" };
const decimalsOf = (s) => { const m = String(s).match(/\.(\d+)/); return m ? Math.min(m[1].length, 2) : 0; };
// the pre-Savvy shorthands: tap_action: toggle | press | turn_on | more-info
const chipAction = (a, entity) => (a === "press" || a === "turn_on"
  ? { action: "perform-action", perform_action: `${domainOf(entity)}.${a}`, target: { entity_id: entity } } : asAction(a));

const STYLE = `${BASE_CSS}
  ha-card { --warn-c: ${SNAP_COLORS.warn}; --alert-c: ${SNAP_COLORS.alert}; --esc: var(--alert-c); --acc-c: rgb(var(--accent)); display: flex; flex-direction: column; gap: 10px; padding: var(--pad); overflow: hidden; }
  :host([compact]) ha-card { --pad: 12px; gap: 0; }
  /* colored_states: false: everything stays grey, and an alarm escalation is amber as it used to be */
  ha-card[data-plain] { --esc: var(--warn-c); }
  /* the alert wash (steady) and glow (bloom), both springs, never transitions */
  .wash, .glow { position: absolute; inset: 0; pointer-events: none; z-index: -1; opacity: 0; border-radius: inherit; }
  .wash { background: radial-gradient(140% 110% at 0% 0%, color-mix(in oklab, var(--alert-hue, var(--alert-c)) 14%, transparent), transparent 68%); }
  .glow { background: radial-gradient(120% 90% at 50% 0%, color-mix(in oklab, var(--alert-hue, var(--alert-c)) 38%, transparent), transparent 70%); }
  :host([dark]) .glow { mix-blend-mode: plus-lighter; }

  .head { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .name { display: flex; align-items: center; gap: 9px; min-width: 0; flex: 1; border-radius: 12px; margin: -4px 0; padding: 4px 0; transform-origin: 0 50%; }
  .name[role="button"] { cursor: pointer; }
  .roomIcon { flex: none; width: var(--b-m); height: var(--b-m); border-radius: 50%; display: grid; place-items: center; background: var(--well); --mdc-icon-size: 18px; color: var(--primary-text-color); }
  .names { display: flex; flex-direction: column; min-width: 0; }
  .title { font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; overflow-wrap: anywhere; }
  .status { font-size: 12px; line-height: 16px; font-weight: 500; letter-spacing: -0.003em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .status[data-level="warn"] { color: var(--warn-c); font-weight: 600; }
  .status[data-level="info"] { color: var(--acc-c); font-weight: 600; }
  .status[data-level="alert"] { color: var(--alert-hue, var(--alert-c)); font-weight: 600; }
  .armed { flex: none; display: flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px; border-radius: 9px; background: var(--well); color: var(--secondary-text-color);
    font-size: 11px; line-height: 13px; font-weight: 650; letter-spacing: 0.05em; text-transform: uppercase; --mdc-icon-size: 14px; }

  .banner { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 13px; background: color-mix(in oklab, var(--alert-hue, var(--alert-c)) 16%, transparent);
    color: var(--alert-hue, var(--alert-c)); --mdc-icon-size: 20px; cursor: pointer; transform-origin: 50% 50%; }
  .banner .bt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .banner .b1 { font-size: 14px; line-height: 17px; font-weight: 650; letter-spacing: -0.012em; }
  .banner .b2 { font-size: 12px; line-height: 16px; font-weight: 500; letter-spacing: -0.003em; opacity: 0.85; }

  .events { display: grid; grid-template-columns: repeat(auto-fit, minmax(124px, 1fr)); gap: 8px; }
  .ev { --on: 0; --warn: 0; --tone-c: var(--primary-text-color);
    --hue: color-mix(in oklab, var(--esc) calc(var(--warn) * 100%), color-mix(in oklab, var(--tone-c) calc(var(--on) * 100%), var(--primary-text-color)));
    position: relative; box-sizing: border-box; min-width: 0; display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 10px; align-items: center;
    padding: 10px 12px 10px 10px; border-radius: 14px; background: color-mix(in oklab, var(--hue) calc(6% + var(--warn) * 8%), transparent); cursor: pointer; transform-origin: 50% 50%; }
  .ev .disc { grid-row: span 2; width: var(--b-m); height: var(--b-m); border-radius: 50%; display: grid; place-items: center; --mdc-icon-size: 19px;
    background: color-mix(in oklab, var(--hue) calc(var(--on) * 16%), transparent); color: color-mix(in oklab, var(--hue) calc(var(--on) * 100%), var(--secondary-text-color)); }
  .ev .l2 { display: flex; align-items: baseline; gap: 5px; min-width: 0; }
  .ev .st { font-size: 14px; line-height: 17px; font-weight: 650; letter-spacing: -0.012em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    color: color-mix(in oklab, var(--hue) calc(40% + var(--on) * 60%), var(--secondary-text-color)); }
  .ev .when { flex: none; font-size: 12px; line-height: 16px; font-weight: 500; letter-spacing: -0.003em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ev .lbl { font-size: 12px; line-height: 16px; font-weight: 600; letter-spacing: -0.003em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 0 1 auto; }
  .ev .lbl::after { content: " ·"; }
  .ev[data-off] { opacity: 0.55; }

  /* equal shares, 8px apart like the tiles above; never below their content; an overfull row scrolls */
  .reads { display: flex; gap: 8px; min-width: 0; overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain; }
  .reads::-webkit-scrollbar, .pills::-webkit-scrollbar { display: none; }
  .reads[data-overflow], .pills[data-overflow] { mask-image: linear-gradient(to left, transparent 0, #000 26px); -webkit-mask-image: linear-gradient(to left, transparent 0, #000 26px); }
  .rd { --al: 0; flex: 1 1 0; box-sizing: border-box; display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 12px;
    background: color-mix(in oklab, var(--rd-hue, var(--alert-c)) calc(var(--al) * 16%), var(--well)); cursor: pointer; transform-origin: 50% 50%; }
  .rd .v { display: flex; align-items: center; gap: 5px; white-space: nowrap; font-size: 13.5px; line-height: 17px; font-weight: 650; letter-spacing: -0.012em;
    color: color-mix(in oklab, var(--rd-hue, var(--alert-c)) calc(var(--al) * 100%), var(--primary-text-color)); }
  .rd .v ha-icon { --mdc-icon-size: 15px; display: flex; flex: none; color: color-mix(in oklab, var(--rd-hue, var(--alert-c)) calc(var(--al) * 100%), var(--secondary-text-color)); }
  .rd .c { font-size: 11px; line-height: 13px; font-weight: 550; letter-spacing: 0.006em; color: var(--secondary-text-color); white-space: nowrap; }
  .rd[data-off] { opacity: 0.55; }

  .pills { display: flex; gap: 6px; min-width: 0; overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain; }
  .pill { --on: 0; flex: none; display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px 0 9px; border-radius: 11px; box-sizing: border-box;
    background: color-mix(in oklab, var(--chip-c, var(--primary-text-color)) calc(6% + var(--on) * 10%), transparent);
    font-size: 12.5px; line-height: 16px; font-weight: 600; letter-spacing: -0.006em; color: color-mix(in oklab, var(--primary-text-color) calc(55% + var(--on) * 45%), transparent);
    --mdc-icon-size: 17px; cursor: pointer; white-space: nowrap; transform-origin: 50% 50%; }
  .pill ha-icon { display: flex; color: color-mix(in oklab, var(--chip-c, var(--primary-text-color)) calc(var(--on) * 100%), var(--secondary-text-color)); }
  .pill[data-off] { opacity: 0.5; }
  .empty { font-size: 12px; line-height: 16px; font-weight: 500; color: var(--secondary-text-color); padding: 6px 2px; }

  .glyphs { display: flex; align-items: center; gap: 4px; flex: none; }
  .gl { --on: 0; --warn: 0; --tone-c: var(--primary-text-color);
    --hue: color-mix(in oklab, var(--esc) calc(var(--warn) * 100%), color-mix(in oklab, var(--tone-c) calc(var(--on) * 100%), var(--primary-text-color)));
    width: 30px; height: 30px; border-radius: 10px; display: grid; place-items: center; --mdc-icon-size: 17px; cursor: pointer; transform-origin: 50% 50%;
    background: color-mix(in oklab, var(--hue) calc(var(--on) * 14%), transparent); color: color-mix(in oklab, var(--hue) calc(var(--on) * 100%), var(--secondary-text-color)); }
  .gl[data-alert] { --hue: var(--alert-hue, var(--alert-c)); --on: 1; }
  .gl[data-off] { opacity: 0.5; }
  .temp { font-size: 13.5px; line-height: 17px; font-weight: 650; letter-spacing: -0.012em; padding: 0 4px 0 6px; white-space: nowrap; cursor: pointer; transform-origin: 50% 50%; }

  /* the pager: now | history; the head stays put above it */
  .pager { position: relative; overflow: hidden; margin: 0 calc(-1 * var(--pad)); touch-action: pan-y; user-select: none; -webkit-user-select: none; }
  .track { display: flex; align-items: stretch; width: 200%; }
  .page { width: 50%; min-width: 0; box-sizing: border-box; padding: 0 var(--pad); display: flex; flex-direction: column; gap: 10px; }
  .dots { display: flex; justify-content: center; gap: 2px; margin: -6px 0 -8px; }
  .dot { appearance: none; border: 0; margin: 0; padding: 6px; box-sizing: content-box; width: 6px; height: 6px; border-radius: 50%; background: var(--primary-text-color);
    background-clip: content-box; opacity: 0.22; cursor: pointer; }
  .dot[data-sel] { opacity: 0.75; }

  .hist { gap: 8px; }
  .hhead { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .hsum { flex: 1; min-width: 0; font-size: 12px; line-height: 16px; font-weight: 550; letter-spacing: -0.003em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ranges { position: relative; flex: none; display: flex; gap: 2px; padding: 3px; border-radius: 11px; background: var(--well); }
  .ranges .sel { position: absolute; top: 3px; bottom: 3px; left: 0; border-radius: 8px; pointer-events: none; background: var(--ha-card-background, var(--card-background-color));
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.14), 0 0 0 0.5px rgb(0 0 0 / 0.04); }
  :host([dark]) .ranges .sel { background: color-mix(in oklab, var(--primary-text-color) 14%, transparent); box-shadow: none; }
  .rseg { position: relative; height: 24px; padding: 0 9px; border-radius: 8px; display: flex; align-items: center; cursor: pointer;
    font-size: 11.5px; line-height: 16px; font-weight: 550; color: var(--secondary-text-color); transform-origin: 50% 50%; }
  .rseg[data-sel] { color: var(--primary-text-color); }
  .chart { position: relative; flex: 1; display: grid; grid-template-columns: 20px minmax(0, 1fr); column-gap: 8px; align-content: end; touch-action: pan-y; border-radius: 8px; }
  .chart[data-loading] .gi, .chart[data-loading] .trk, .chart[data-loading] .line { visibility: hidden; }
  .gi { grid-column: 1; display: grid; place-items: center; --mdc-icon-size: 16px; color: var(--secondary-text-color); }
  .gi[data-on] { color: var(--primary-text-color); }
  .gi[data-off] { opacity: 0.5; }
  .line { grid-column: 2; position: relative; min-height: 44px; color: var(--primary-text-color); }
  .line svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  .trk { grid-column: 2; align-self: center; position: relative; height: 8px; border-radius: 4px; background: var(--well); }
  .segs { position: absolute; inset: 0; clip-path: inset(0 calc((1 - var(--rv, 1)) * 100%) 0 0); }
  .segs i { position: absolute; top: 0; bottom: 0; min-width: 3px; border-radius: 4px; background: color-mix(in oklab, var(--primary-text-color) 72%, transparent); }
  .segs i[data-k="x"] { background: repeating-linear-gradient(135deg, color-mix(in oklab, var(--primary-text-color) 24%, transparent) 0 2px, transparent 2px 5px); }
  .ov { grid-column: 2; position: relative; pointer-events: none; }
  .cursor { position: absolute; top: 0; bottom: 0; left: 0; width: 1px; background: var(--primary-text-color); opacity: 0; }
  .bubble { position: absolute; top: -4px; left: 0; display: flex; gap: 8px; align-items: center; padding: 4px 8px; border-radius: 9px;
    background: color-mix(in oklab, var(--primary-text-color) 10%, var(--ha-card-background, var(--card-background-color))); box-shadow: 0 4px 14px rgb(0 0 0 / 0.16);
    font-size: 11.5px; line-height: 15px; font-weight: 600; letter-spacing: -0.004em; white-space: nowrap; opacity: 0; }
  .bubble .t { color: var(--secondary-text-color); font-weight: 550; }
  .hempty { grid-column: 1 / -1; display: grid; place-items: center; text-align: center; min-height: 56px; font-size: 12px; line-height: 16px; font-weight: 500; color: var(--secondary-text-color); padding: 0 16px; }
  .axis { display: flex; justify-content: space-between; padding-inline-start: 28px; font-size: 10.5px; line-height: 13px; font-weight: 500; letter-spacing: 0.01em; color: var(--secondary-text-color); opacity: 0.8; }
  :host([kbd]) .chart:focus-visible { outline-offset: 4px; }
  @media (prefers-contrast: more) {
    .status, .ev .when, .ev .lbl, .rd .c, .hsum, .axis { color: var(--primary-text-color); opacity: 0.85; }
    .ev[data-off], .rd[data-off], .pill[data-off] { opacity: 0.75; }
  }
  @container (max-width: 300px) { .rd .c { display: none; } .rd { padding: 8px; } .armed .al { display: none; } }
  @container (max-width: 270px) { .events { grid-template-columns: 1fr; } }
  @container (max-width: 240px) { .roomIcon { display: none; } .glyphs .gl:nth-child(n+3) { display: none; } }
`;

class SavvyRoomActivityCard extends SavvyCard {
  static getStubConfig(hass) {
    const a = allAreas(hass).find((x) => areaEntities(hass, x.id).some((id) => domainOf(id) === "binary_sensor"));
    return a ? { area: a.id } : {};
  }
  static getConfigElement() { return document.createElement(EDITOR); }

  constructor() {
    super();
    this._onscreen = true;
    this._nodes = new Map();
    this._expect = new Map();
  }

  setConfig(config) {
    if (!config?.area && !config?.entities?.length && !config?.extras?.length && !config?.chips?.length && !SLOTS.some((s) => config?.[s.key])) {
      throw new Error('savvy-room-activity-card: set "area" (a room) or "entities" (a hand-picked list)');
    }
    this._compact = config.layout === "compact" || !!config.compact;
    this._config = { ...config, exclude_kinds: config.exclude_kinds ?? config.ignore_sensors };
    const hc = config.history;
    this._histCfg = this._compact || hc === false ? null : { hours: 24, ranges: [6, 24, 72], ...(hc && typeof hc === "object" ? hc : {}) };
    if (this._histCfg) {
      const hours = Number(this._histCfg.hours) || 24;
      const ranges = [].concat(this._histCfg.ranges || []).map(Number).filter((n) => n > 0);
      this._ranges = ranges.includes(hours) ? ranges : [...ranges, hours].sort((a, b) => a - b);
      this._hours = hours;
    }
    if (this._el) { this._build(); if (this._hass) this._update(); }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._el) this._build();
    this._update();
  }

  connectedCallback() {
    this._observe();
    if (!this._ticker) this._ticker = setInterval(() => { if (this._onscreen) this._tickTimes(); }, SNAP_TICK_MS);
    this._wake();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._io?.disconnect();
    clearInterval(this._ticker);
    this._ticker = 0;
  }
  getCardSize() { return this._compact ? 1 : 3; }
  getGridOptions() { return this._compact ? { columns: 6, min_columns: 3, rows: "auto" } : { columns: 12, min_columns: 4, rows: "auto" }; }

  // ---------- build ----------
  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._resetMotion();
    this._first = true;
    this._nodes.clear();
    this._laneEls = new Map();
    this._page = 0;
    this._histOn = false;
    this._histTargets = null;
    this._targetsKey = null;
    this._raw = null;
    this._hist = null;
    this._histKey = null;
    this._revealKey = null;
    this._loading = null;
    this._snapTr = null;
    this.toggleAttribute("compact", this._compact);
    const cmp = this._compact;
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="wash" id="wash" aria-hidden="true"></div>
        <div class="glow" id="glow" aria-hidden="true"></div>
        <div class="head">
          <div class="name" id="name"><span class="roomIcon"><ha-icon id="roomIcon"></ha-icon></span>
            <span class="names"><span class="title" id="title"></span><span class="status" id="status"></span></span></div>
          <span class="armed" id="armed" hidden><ha-icon id="armedIcon"></ha-icon><span class="al" id="armedText"></span></span>
          <span class="glyphs" id="glyphs" ${cmp ? "" : "hidden"}></span>
        </div>
        <div class="pager" id="pager">
          <div class="track" id="track">
            <section class="page" id="p0">
              <div class="banner" id="banner" role="button" tabindex="0" hidden><ha-icon id="bannerIcon"></ha-icon>
                <span class="bt"><span class="b1" id="b1"></span><span class="b2" id="b2"></span></span></div>
              <div class="events" id="events" ${cmp ? "hidden" : ""}></div>
              <div class="reads" id="reads" ${cmp ? "hidden" : ""}></div>
              <div class="pills" id="pills" ${cmp ? "hidden" : ""}></div>
              <div class="empty" id="empty" hidden></div>
            </section>
            <section class="page hist" id="p1" hidden inert aria-hidden="true">
              <div class="hhead"><span class="hsum" id="hsum"></span>
                <div class="ranges" id="ranges" role="group" aria-label="History range"><span class="sel"></span></div></div>
              <div class="chart" id="chart" tabindex="0" role="group" data-loading>
                <span class="gi" id="tIcon" title="Temperature"><ha-icon icon="mdi:thermometer"></ha-icon></span>
                <div class="line" id="line"><svg id="svg" focusable="false" aria-hidden="true"></svg></div>
                <div class="ov" id="ov"><span class="cursor" id="cursor"></span><span class="bubble" id="bubble" role="status" aria-live="polite"></span></div>
                <div class="hempty" id="hempty"></div>
              </div>
              <div class="axis" aria-hidden="true"><span id="ax0"></span><span id="ax1"></span><span id="ax2"></span></div>
            </section>
          </div>
        </div>
        <div class="dots" id="dots" hidden></div>
      </ha-card>`;
    const $ = (id) => root.getElementById(id);
    this._el = { card: root.querySelector("ha-card"), wash: $("wash"), glow: $("glow"), name: $("name"), roomIcon: $("roomIcon"), title: $("title"), status: $("status"),
      armed: $("armed"), armedIcon: $("armedIcon"), armedText: $("armedText"), glyphs: $("glyphs"), banner: $("banner"), bannerIcon: $("bannerIcon"), b1: $("b1"), b2: $("b2"),
      events: $("events"), reads: $("reads"), pills: $("pills"), empty: $("empty"), pager: $("pager"), track: $("track"), p0: $("p0"), p1: $("p1"), dots: $("dots"),
      hsum: $("hsum"), ranges: $("ranges"), chart: $("chart"), tIcon: $("tIcon"), line: $("line"), svg: $("svg"), ov: $("ov"), cursor: $("cursor"), bubble: $("bubble"),
      hempty: $("hempty"), ax: [$("ax0"), $("ax1"), $("ax2")] };

    this._alert = this._spring(0, MOTION.ui, "alert");
    this._glow = this._spring(0, MOTION.bloom, "alert");
    this._wasAlert = null;
    this._sp = {
      page: this._spring(0, MOTION.page, "page", 1e-4),
      rangeX: this._spring(0, MOTION.pill, "ranges", 0.02),
      rangeW: this._spring(0, MOTION.pill, "ranges", 0.02),
      reveal: this._spring(1, MOTION.graph, "chart", 0.002),
      scrub: this._spring(0, MOTION.scrub, "chart", 0.002),
      scrubX: this._spring(0, MOTION.scrub, "chart", 0.05),
    };
    if (this._histCfg) {
      for (let i = 0; i < 2; i++) {
        const dot = document.createElement("button");
        dot.className = "dot";
        dot.setAttribute("aria-label", i ? "History" : "Now");
        dot.addEventListener("click", () => this._goto(i));
        this._el.dots.appendChild(dot);
      }
      for (const hours of this._ranges) {
        const seg = document.createElement("span");
        seg.className = "rseg";
        seg.__hours = hours;
        attr(seg, "role", "button");
        attr(seg, "tabindex", "0");
        text(seg, hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`);
        this._pressable(seg, { onTap: () => this._setRange(hours), haptic: null }, 0.035);
        this._el.ranges.appendChild(seg);
      }
      this._el.ranges.hidden = this._ranges.length < 2;
      this._syncRanges();
      this._swipe();
      this._histScrub();
      this._histKeys();
      this._syncPage();
    }
    const c = this._config;
    // the whole name block links to navigation_path / tap_action; a title link replaces that with just the words
    linkTitle(root, this._el.title, titlePathOf(c), (el, onTap) => this._pressable(el, { onTap }, 0.035));
    if ((c.navigation_path || c.tap_action) && !titlePathOf(c)) {
      attr(this._el.name, "role", "button");
      attr(this._el.name, "tabindex", "0");
      this._pressable(this._el.name, { onTap: () => runAction(this, this._hass, c.tap_action || { action: "navigate", navigation_path: c.navigation_path }, {}) }, 0.035);
    }
    this._pressable(this._el.banner, { onTap: () => moreInfo(this, this._bannerEntity), haptic: null }, 0.035);
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => { this._fitRows(); this._measure(); });
    for (const n of [this._el.reads, this._el.pills, this._el.pager, this._el.line]) this._ro.observe(n);
    this._observe();
  }

  _observe() {
    if (!this._el || !this.isConnected) return;
    this._io = this._io || new IntersectionObserver(([e]) => {
      this._onscreen = e.isIntersecting;
      // springs step offscreen without painting: repaint everything on the way back
      if (this._onscreen) { this._tickTimes(); this._paintAll(null); this._wake(); }
    });
    this._io.disconnect();
    this._io.observe(this);
  }

  // ---------- discovery ----------
  // A kind's override: an id, a list, {entity, name, icon} objects, or false.
  _items(slot) {
    const h = this._hass, c = this._config;
    const conf = c[slot.key];
    if (conf === false || [].concat(c.exclude_kinds || []).includes(slot.key)) return [];
    if (conf != null) return asItems(conf);
    if (!c.area) return [];
    const skip = asItems(c.exclude).map((i) => i.entity);
    let ids = pick(h, areaEntities(h, c.area), { domains: slot.domain, deviceClasses: slot.dc.length ? slot.dc : undefined, exclude: skip });
    if (slot.single && ids.length > 1) ids = rankBy(h, ids, slot.dc).slice(0, 1);
    // `include`: entities that have no area, shown with this room (a lock, a door contact)
    for (const id of asItems(c.include).map((i) => i.entity)) {
      const st = h.states[id];
      if (!st || skip.includes(id) || ids.includes(id) || domainOf(id) !== slot.domain) continue;
      if (slot.dc.length && !slot.dc.includes(st.attributes.device_class)) continue;
      ids.push(id);
    }
    return ids.map((entity) => ({ entity }));
  }

  // Hand-picked: `chips` (the one chip spec), and the pre-Savvy `entities` / `extras`, each
  // placed by what it is.
  _manual() {
    const c = this._config;
    return asItems([].concat(c.chips || [], c.entities || [], c.extras || []));
  }

  _classify(item) {
    const st = item.entity ? this._hass.states[item.entity] : null;
    const d = domainOf(item.entity);
    if (item.navigation_path || item.tap_action || CHIP_TOGGLES.has(d) || PRESSES.has(d) || TURN_ON.has(d)) return { kind: "chip" };
    if (d === "lock") return { kind: "event", slot: SLOT.lock };
    const dc = st?.attributes.device_class;
    const slot = dc && SLOTS.find((s) => s.domain === d && s.dc.includes(dc));
    return slot ? { kind: slot.kind, slot } : { kind: "read", slot: null };
  }

  // "Living Room Entrance Door Sensor Contact" -> "Entrance": only when a room has two of
  // a kind; otherwise the kind's own label reads better.
  _shortName(id, slotLabel) {
    let name = shortName(this._hass, id, this._config.area);
    name = name.replace(/\s+(sensor\s+)?(contact|occupancy|presence)$/i, "") || name;
    const noun = slotLabel && new RegExp(`\\s+${slotLabel}$`, "i");
    return (noun && name.replace(noun, "")) || name;
  }

  // A lock reads like a door: on is what deserves a look (unlocked, open, jammed), off is calm.
  _ev(id) {
    const st = id ? this._hass.states[id] : null;
    if (!st || domainOf(id) !== "lock") return st;
    const s = st.state;
    const state = ["locked", "locking"].includes(s) ? "off" : ["unlocked", "unlocking", "open", "opening", "jammed"].includes(s) ? "on" : s;
    return { ...st, state, __lock: s };
  }

  _areaName() {
    const c = this._config;
    return c.name || c.title || (c.area ? areaInfo(this._hass, c.area).name : "Home");
  }

  // The alarm is opt-in: the panel the config names, or `auto` for the house's first one. Without it there is no
  // armed pill and nothing escalates.
  _alarmState() {
    const a = this._config.alarm;
    if (typeof a !== "string" || !a) return null;
    const id = a === "auto" ? Object.keys(this._hass.states).find((x) => x.startsWith("alarm_control_panel.")) : a;
    return id ? this._hass.states[id]?.state ?? null : null;
  }

  // The hue a state carries on its own (colored_states): presence the accent, a door, window or open lock amber.
  _toneOf(slot) {
    if (this._config.colored_states === false) return null;
    if (slot.key === "presence") return "var(--acc-c)";
    if (slot.key === "door" || slot.key === "window" || slot.key === "lock") return "var(--warn-c)";
    return null;
  }

  // A door or window escalates whenever armed; presence only when armed away (people
  // are expected to move around at home or at night).
  _escalates(slot, on, alarm) {
    if (!on || !alarm) return false;
    if (!(alarm.startsWith("armed_") || alarm === "triggered")) return false;
    if (slot.key === "door" || slot.key === "window" || slot.key === "lock") return true;
    if (slot.key === "presence") return alarm === "triggered" || [].concat(this._config.alarm_presence_states || ["armed_away", "armed_vacation"]).includes(alarm);
    return false;
  }

  // ---------- update ----------
  _update() {
    const el = this._el;
    if (!el) return;
    Motion.flip([el.events, el.reads, el.pills, el.glyphs], () => this._updateNow());
  }

  _updateNow() {
    const h = this._hass;
    if (!h || !this._el) return;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    const c = this._config, el = this._el;
    text(el.title, this._areaName());
    attr(el.roomIcon, "icon", c.icon || (c.area && areaInfo(h, c.area).icon) || (c.area ? "mdi:home-outline" : "mdi:home"));
    const alarm = this._alarmState();
    attr(el.card, "data-plain", c.colored_states === false);
    const seen = new Set();
    const summary = { active: [], warn: false, alerts: [], offline: 0, count: 0, watch: 0 };
    const tally = (slot, item, st) => {
      summary.count++;
      const on = st?.state === "on";
      if (item.entity && (!st || isOff(st))) summary.offline++;
      if (slot?.kind === "event" || slot?.kind === "alert") summary.watch++;
      if (slot?.kind === "alert" && on) summary.alerts.push({ slot, item, st });
      if (slot?.kind === "event" && on) {
        summary.active.push(slot.key);
        if (this._escalates(slot, on, alarm)) summary.warn = true;
      }
    };
    const lanes = [];
    let temp = null;
    for (const slot of SLOTS) {
      const items = this._items(slot);
      for (const item of items) {
        const key = `${slot.key}|${item.entity}`;
        seen.add(key);
        tally(slot, item, this._ev(item.entity));
        if (slot.kind === "event") lanes.push(this._lane(slot, item, items.length));
        if (slot.key === "temperature" && !temp) temp = item;
        if (this._compact) {
          if (slot.kind === "event" || slot.kind === "alert") this._renderGlyph(key, slot, item, items.length, alarm);
          else if (slot.key === "temperature") this._renderTemp(key, item);
        } else if (slot.kind === "event") this._renderEvent(key, slot, item, items.length, alarm);
        else this._renderRead(key, slot, item);
      }
    }
    const manual = this._manual().map((item) => ({ item, ...this._classify(item) }));
    for (const { item, kind, slot } of manual) {
      const key = `m|${item.entity || item.navigation_path}`;
      const st = item.entity ? h.states[item.entity] : null;
      if (kind !== "chip") tally(slot, item, st);
      else if (item.entity && (!st || isOff(st))) summary.offline++;
      const siblings = manual.filter((m) => m.slot === slot).length;
      if (this._compact) {
        if (kind !== "event" && kind !== "alert") continue;
        seen.add(key);
        this._renderGlyph(key, slot, item, siblings, alarm);
        continue;
      }
      seen.add(key);
      if (kind === "chip") this._renderPill(key, item);
      else if (kind === "event") { this._renderEvent(key, slot, item, siblings, alarm); lanes.push(this._lane(slot, item, siblings)); }
      else this._renderRead(key, slot, item);
    }
    if (!this._compact) this._setHistTargets(lanes, temp);
    for (const [key, node] of this._nodes) {
      if (seen.has(key)) continue;
      this._dropNode(node);
      this._nodes.delete(key);
    }
    // DOM order follows reading order
    const at = new Map();
    for (const key of seen) {
      const node = this._nodes.get(key);
      if (!node) continue;
      const i = at.get(node.__parent) || 0;
      at.set(node.__parent, i + 1);
      place(node.__parent, node, i);
    }
    this._renderSummary(summary, alarm);
    el.empty.hidden = summary.count > 0 || manual.length > 0;
    if (!el.empty.hidden) text(el.empty, c.area ? `No sensors found in ${this._areaName()}.` : "No sensors configured.");
    if (!this._compact) {
      el.events.hidden = !el.events.children.length;
      el.reads.hidden = !el.reads.children.length;
      el.pills.hidden = !el.pills.children.length;
    }
    this._fitRows();
    if (this._first) { this._first = false; requestAnimationFrame(() => this._paintAll(null)); }
    this._wake();
  }

  _node(key, parent, className, html) {
    let node = this._nodes.get(key);
    if (node) return node;
    node = document.createElement("div");
    node.className = className;
    node.innerHTML = html;
    node.__parent = parent;
    node.__key = key;
    node.__springs = [];
    node.__enter = this._spring(0, MOTION.ui, `enter:${key}`).to(1, MOTION.ui);
    node.__springs.push(node.__enter);
    this._nodes.set(key, node);
    parent.appendChild(node);
    return node;
  }

  _nodeSpring(node, name, value, motion) {
    if (node[name]) return node[name];
    const s = this._spring(value, motion, `${name}:${node.__key}`);
    node[name] = s;
    node.__springs.push(s);
    return s;
  }

  _dropNode(node) {
    for (const s of [...node.__springs, node.__spring]) { const i = this._springs.indexOf(s); if (i >= 0) this._springs.splice(i, 1); }
    const p = this._pressNodes.indexOf(node);
    if (p >= 0) this._pressNodes.splice(p, 1);
    node.remove();
  }

  _iconFor(slot, item, on) { return item.icon || (on ? slot.icon : (slot.iconOff || slot.icon)); }

  _stateWord(slot, st) {
    if (!st) return "Not found";
    if (isOff(st)) return "Offline";
    if (slot?.key === "lock" && st.__lock) return { locked: "Locked", unlocked: "Unlocked", locking: "Locking", unlocking: "Unlocking", open: "Open", opening: "Opening", jammed: "Jammed" }[st.__lock] || title(st.__lock);
    if (slot && st.state === "on" && slot.on) return slot.on;
    if (slot && st.state === "off" && slot.off) return slot.off;
    if (slot?.kind === "alert") return st.state === "on" ? "Detected" : "Clear";
    return stateText(this._hass, st);
  }

  _wire(node, item) {
    if (node.__wired) return;
    node.__wired = true;
    attr(node, "role", "button");
    attr(node, "tabindex", "0");
    this._pressable(node, { onTap: () => moreInfo(this, node.__item.entity), onHold: () => moreInfo(this, node.__item.entity) }, 0.035);
  }

  _renderEvent(key, slot, item, siblings, alarm) {
    const st = this._ev(item.entity);
    const node = this._node(key, this._el.events, "ev", `<span class="disc"><ha-icon></ha-icon></span><span class="st"></span><span class="l2"><span class="lbl"></span><span class="when"></span></span>`);
    if (!node.__el) node.__el = { icon: node.querySelector("ha-icon"), st: node.querySelector(".st"), when: node.querySelector(".when"), lbl: node.querySelector(".lbl") };
    node.__item = item;
    this._wire(node, item);
    const on = st?.state === "on";
    node.__slot = slot; node.__st = st; node.__isOn = on;
    attr(node, "data-off", !st || isOff(st));
    attr(node.__el.icon, "icon", this._iconFor(slot, item, on));
    text(node.__el.st, this._stateWord(slot, st));
    // the icon already says presence or door: the label only earns its space when a room
    // has two of a kind (or config names it)
    const label = item.name || (siblings > 1 ? this._shortName(item.entity, slot.label) : slot.label);
    node.__label = label;
    text(node.__el.lbl, label);
    node.__el.lbl.hidden = !(item.name || siblings > 1);
    put(node, "--tone-c", this._toneOf(slot) || "var(--primary-text-color)");
    this._nodeSpring(node, "__onS", on ? 1 : 0, MOTION.ui).to(on ? 1 : 0, MOTION.ui);
    this._nodeSpring(node, "__warn", 0, MOTION.ui).to(this._escalates(slot, on, alarm) ? 1 : 0, MOTION.ui);
    this._timeText(node);
  }

  _renderGlyph(key, slot, item, siblings, alarm) {
    const st = this._ev(item.entity);
    const on = st?.state === "on";
    // a quiet alert sensor stays out of the compact row entirely
    if (slot.kind === "alert" && !on) {
      const old = this._nodes.get(key);
      if (old) { this._dropNode(old); this._nodes.delete(key); }
      return;
    }
    const node = this._node(key, this._el.glyphs, "gl", "<ha-icon></ha-icon>");
    if (!node.__el) node.__el = { icon: node.querySelector("ha-icon") };
    node.__item = item;
    this._wire(node, item);
    node.__slot = slot; node.__st = st; node.__isOn = on;
    attr(node, "data-off", !st || isOff(st));
    attr(node, "data-alert", slot.kind === "alert");
    if (slot.color) put(node, "--alert-hue", slot.color);
    put(node, "--tone-c", this._toneOf(slot) || "var(--primary-text-color)");
    attr(node.__el.icon, "icon", this._iconFor(slot, item, on));
    this._nodeSpring(node, "__onS", on ? 1 : 0, MOTION.ui).to(on ? 1 : 0, MOTION.ui);
    this._nodeSpring(node, "__warn", 0, MOTION.ui).to(this._escalates(slot, on, alarm) ? 1 : 0, MOTION.ui);
    node.__label = item.name || (siblings > 1 ? this._shortName(item.entity, slot.label) : slot.label);
    this._timeText(node);
  }

  _renderTemp(key, item) {
    const st = this._hass.states[item.entity];
    const node = this._node(key, this._el.glyphs, "temp", "");
    node.__item = item;
    this._wire(node, item);
    this._readValue(node, item, st, (s) => text(node, s));
    attr(node, "aria-label", `Temperature ${node.__display || "unavailable"}`);
  }

  // numeric states roll through a spring; anything else is formatted text
  _readValue(node, item, st, write) {
    const h = this._hass;
    const v = st && !isOff(st) ? parseFloat(st.state) : NaN;
    if (Number.isFinite(v) && /^-?[\d.]+$/.test(String(st.state).trim())) {
      const prec = h.entities?.[item.entity]?.display_precision;
      node.__dec = Number.isFinite(prec) ? prec : decimalsOf(st.state);
      node.__unit = item.unit ?? st.attributes.unit_of_measurement ?? "";
      const s = this._nodeSpring(node, "__val", v, MOTION.text);
      s.to(v, MOTION.text);
      node.__write = write;
      node.__numeric = true;
      node.__display = `${v.toFixed(node.__dec)}${node.__unit}`;
      write(this._fmt(node, s.x));
    } else {
      node.__numeric = false;
      node.__display = !st || isOff(st) ? "—" : this._stateWord(null, st);
      write(node.__display);
    }
  }

  _fmt(node, x) { return withUnit(x.toFixed(node.__dec), node.__unit); }

  _renderRead(key, slot, item) {
    const st = this._hass.states[item.entity];
    const node = this._node(key, this._el.reads, "rd", `<span class="v"><ha-icon></ha-icon><span class="n"></span></span><span class="c"></span>`);
    if (!node.__el) node.__el = { icon: node.querySelector("ha-icon"), n: node.querySelector(".n"), c: node.querySelector(".c") };
    node.__item = item;
    this._wire(node, item);
    const on = st?.state === "on";
    attr(node, "data-off", !st || isOff(st));
    if (slot?.color) put(node, "--rd-hue", slot.color);
    attr(node.__el.icon, "icon", slot ? this._iconFor(slot, item, on) : item.icon || this._guessIcon(st));
    if (slot?.kind === "alert") {
      node.__numeric = false;
      text(node.__el.n, this._stateWord(slot, st));
      this._nodeSpring(node, "__al", on ? 1 : 0, MOTION.ui).to(on ? 1 : 0, MOTION.ui);
    } else this._readValue(node, item, st, (s) => text(node.__el.n, s));
    let caption = item.name || slot?.label || st?.attributes.friendly_name || title(item.entity.split(".")[1] || "");
    if (slot?.key === "illuminance" && !item.name) caption = this._luxWord(st) || caption;
    text(node.__el.c, caption);
    attr(node, "aria-label", `${caption}, ${node.__display ?? node.__el.n.textContent}`);
  }

  _luxWord(st) {
    const cfg = this._config.lux_labels;
    if (cfg === false || !st) return null;
    const v = parseFloat(st.state);
    if (!Number.isFinite(v)) return null;
    const { dark = 10, dim = 150 } = cfg || {};
    return v < dark ? "Dark" : v < dim ? "Dim" : "Bright";
  }

  _guessIcon(st) {
    if (!st) return "mdi:help-circle-outline";
    if (st.attributes.icon) return st.attributes.icon;
    const dc = st.attributes.device_class;
    if (dc === "temperature") return "mdi:thermometer";
    if (dc === "humidity") return "mdi:water-percent";
    if (dc === "illuminance") return "mdi:brightness-5";
    if (/people|person/.test(st.entity_id)) return "mdi:account-multiple";
    return "mdi:eye-outline";
  }

  _renderPill(key, item) {
    const st = item.entity ? this._hass.states[item.entity] : null;
    const node = this._node(key, this._el.pills, "pill", `<ha-icon></ha-icon><span class="cn"></span>`);
    if (!node.__el) {
      node.__el = { icon: node.querySelector("ha-icon"), n: node.querySelector(".cn") };
      attr(node, "role", "button");
      attr(node, "tabindex", "0");
      this._pressable(node, { onTap: () => this._runPill(node.__item, "tap"), onHold: () => this._runPill(node.__item, "hold"), haptic: null }, 0.035);
    }
    node.__item = item;
    if (item.color) put(node, "--chip-c", colorOf(item.color));
    const on = this._pillOn(item, st);
    attr(node, "data-off", !!item.entity && (!st || isOff(st)));
    const name = item.name || st?.attributes.friendly_name || title(item.entity?.split(".")[1] || "");
    text(node.__el.n, name);
    attr(node.__el.icon, "icon", item.icon || st?.attributes.icon || (on ? "mdi:toggle-switch" : "mdi:toggle-switch-off-outline"));
    const toggle = this._pillAction(item)?.action === "toggle";
    attr(node, "aria-pressed", toggle ? String(on) : null);
    attr(node, "aria-label", toggle ? `${name}, ${on ? "on" : "off"}` : name);
    this._nodeSpring(node, "__onS", on ? 1 : 0, MOTION.ui).to(on ? 1 : 0, MOTION.ui);
  }

  _pillAction(item) {
    if (item.tap_action !== undefined) return chipAction(item.tap_action, item.entity);
    if (item.navigation_path) return { action: "navigate", navigation_path: item.navigation_path };
    return item.entity ? defaultTapAction(item.entity) : null;
  }

  // Optimism (CARD-DESIGN.md 4): a toggle shows the result the moment it's tapped and
  // reconciles when HA reports back; a guess HA never confirms expires.
  _pillOn(item, st) {
    const exp = this._expect.get(item.entity);
    if (exp) {
      if (Date.now() > exp.until || st?.state === exp.state) this._expect.delete(item.entity);
      else return exp.state === "on";
    }
    return st?.state === "on";
  }

  _runPill(item, kind) {
    const h = this._hass, st = item.entity ? h.states[item.entity] : null;
    const a = kind === "tap" ? this._pillAction(item) : item.hold_action !== undefined ? chipAction(item.hold_action, item.entity) : { action: "more-info" };
    if (!a || a.action === "none") return;
    haptic("light");
    if (a.action === "toggle") {
      if (!st || isOff(st)) return;
      const next = this._pillOn(item, st) ? "off" : "on";
      this._expect.set(item.entity, { state: next, until: Date.now() + SNAP_PREDICT_MS });
      setTimeout(() => this._update(), SNAP_PREDICT_MS + 50);
      toggleEntity(h, item.entity);
      return this._update();
    }
    if (st && isOff(st) && a.action !== "more-info") return;
    runAction(this, h, a, { entity: item.entity });
  }

  // ---------- summary: status line, alarm pill, banner, wash ----------
  _renderSummary(sum, alarm) {
    const el = this._el;
    const armed = alarm && (alarm.startsWith("armed_") || alarm === "triggered");
    el.armed.hidden = !armed;
    if (armed) {
      attr(el.armedIcon, "icon", ARM_ICONS[alarm] || "mdi:shield-check");
      const word = alarm === "triggered" ? "Triggered" : title(alarm.replace(/^armed_/, ""));
      text(el.armedText, word);
      attr(el.armed, "aria-label", `Alarm ${alarm === "triggered" ? "triggered" : `armed ${word.toLowerCase()}`}`);
    }
    // the banner: the first tripped alert, the rest counted
    const first = sum.alerts[0];
    el.banner.hidden = !first || this._compact;
    if (first) {
      this._bannerEntity = first.item.entity;
      this._bannerNode = { __st: first.st };
      put(el.card, "--alert-hue", first.slot.color || SNAP_COLORS.alert);
      attr(el.bannerIcon, "icon", first.slot.icon);
      const more = sum.alerts.length > 1 ? ` · +${sum.alerts.length - 1}` : "";
      text(el.b1, `${first.item.name || first.slot.label} detected${more}`);
      attr(el.banner, "aria-label", `${first.slot.label} detected. Open details.`);
    } else { this._bannerEntity = null; this._bannerNode = null; }
    const alerting = !!first;
    // the strongest state sets the card's soft wash and its status colour: a tripped alert, an escalation (red),
    // anything open or unlocked (amber), presence (the accent); with colored_states off only an alert washes
    const colored = this._config.colored_states !== false;
    const openNow = sum.active.some((k) => k === "door" || k === "window" || k === "lock");
    let tier = alerting ? "alert" : null, wash = alerting ? 1 : 0;
    if (!alerting && colored) {
      if (sum.warn) { tier = "esc"; wash = 0.85; put(el.card, "--alert-hue", "var(--alert-c)"); }
      else if (openNow) { tier = "open"; wash = 0.6; put(el.card, "--alert-hue", "var(--warn-c)"); }
      else if (sum.active.includes("presence")) { tier = "presence"; wash = 0.5; put(el.card, "--alert-hue", "var(--acc-c)"); }
    }
    this._alert.to(wash, MOTION.ui);
    if (alerting && !this._wasAlert) bloom(this._glow, 1, MOTION.bloom);
    this._wasAlert = alerting;
    let level = null, words;
    if (alerting) {
      level = "alert";
      words = sum.alerts.map((a) => `${a.item.name || a.slot.label} detected`).join(" · ");
    } else {
      const parts = [];
      if (sum.active.includes("presence")) parts.push("Occupied");
      const unlocked = sum.active.filter((a) => a === "lock").length;
      if (unlocked) parts.push(unlocked === 1 ? "Unlocked" : `${unlocked} unlocked`);
      for (const k of ["door", "window"]) {
        const n = sum.active.filter((a) => a === k).length;
        if (n === 1) parts.push(`${SLOT[k].label} open`);
        else if (n > 1) parts.push(`${n} ${k}s open`);
      }
      level = tier === "esc" ? "alert" : tier === "open" ? "warn" : tier === "presence" ? "info" : sum.warn ? "warn" : null;
      words = parts.length ? parts.join(" · ") : (sum.watch ? "All quiet" : "");
    }
    if (sum.offline) words = words ? `${words} · ${sum.offline} offline` : `${sum.offline} offline`;
    attr(el.status, "data-level", level);
    text(el.status, words);
    el.status.hidden = !words;
    attr(el.name, "aria-label", `${this._areaName()}${words ? `, ${words}` : ""}`);
    this._tickTimes();
  }

  // ---------- relative times ----------
  _timeText(node) {
    const st = node.__st;
    const t = st ? Date.parse(st.last_changed) : NaN;
    const label = since(t, node.__isOn);
    if (node.__el?.when) {
      text(node.__el.when, label);
      attr(node.__el.when, "title", Number.isFinite(t) ? clockTime(t, langOf(this._hass)) : null);
    }
    if (node.classList.contains("ev")) attr(node, "aria-label", `${node.__label}, ${node.__el.st.textContent}${label ? `, ${label}` : ""}`);
    else if (node.classList.contains("gl")) {
      const word = this._stateWord(node.__slot, st);
      attr(node, "aria-label", `${node.__label}, ${word}${label ? `, ${label}` : ""}`);
      attr(node, "title", `${node.__label}: ${word}${label ? ` · ${label}` : ""}`);
    }
  }

  _tickTimes() {
    if (!this._el) return;
    for (const node of this._nodes.values()) if (node.classList.contains("ev") || node.classList.contains("gl")) this._timeText(node);
    const b = this._bannerNode;
    if (b) {
      const t = Date.parse(b.__st.last_changed);
      const when = Number.isFinite(t) ? since(t, true) : "";
      text(this._el.b2, when ? `${when === "just now" ? "Just now" : `Going ${when}`} · tap for details` : "Tap for details");
    }
    // an open history page keeps "now" at its right edge, and refetches now and then
    if (this._page === 1 && this._histTargets) {
      if (this._raw && Date.now() - (this._histAt || 0) > HIST_POLL_MS) this._loadHistory(true);
      else this._buildHistory();
    }
  }

  _fitRows() {
    for (const row of [this._el?.reads, this._el?.pills]) {
      if (!row || row.hidden) continue;
      row.toggleAttribute("data-overflow", row.scrollWidth > row.clientWidth + 1);
    }
  }

  // ---------- the history page ----------
  _lane(slot, item, siblings) {
    return { key: `${slot.key}|${item.entity}`, entity: item.entity, slot, label: item.name || (siblings > 1 ? this._shortName(item.entity, slot.label) : slot.label) };
  }

  _setHistTargets(lanes, temp) {
    const on = !!this._histCfg && (lanes.length > 0 || !!temp);
    const key = on ? [...lanes.map((l) => `${l.key}:${l.label}`), temp?.entity || ""].join("|") : "";
    this._histTargets = on ? { lanes, temp } : null;
    if (on !== this._histOn) {
      this._histOn = on;
      this._el.p1.hidden = !on;
      this._el.dots.hidden = !on;
      if (!on && this._page) this._goto(0, true);
    }
    if (key !== this._targetsKey) {
      this._targetsKey = key;
      this._raw = null;
      this._hist = null;
      this._histKey = null;
      this._renderHist();
      if (this._page === 1) this._loadHistory(true);
    }
  }

  _histIds() {
    const tg = this._histTargets;
    return tg ? [...new Set([...tg.lanes.map((l) => l.entity), ...(tg.temp ? [tg.temp.entity] : [])])] : [];
  }

  async _loadHistory(force = false) {
    const ids = this._histIds();
    if (!ids.length || !this._hass) return;
    const key = `${ids.join(",")}|${this._hours}`;
    if (!force && this._histKey === key && this._raw && Date.now() - (this._histAt || 0) < 60000) return;
    if (this._loading === key) return;
    this._loading = key;
    let raw = null, err = null;
    try {
      raw = await fetchHistory(this._hass, ids, this._hours);
      // a lock's history reads like a door's: unlocked is on
      for (const id of ids) if (domainOf(id) === "lock" && raw[id]) raw[id] = raw[id].map((r) => ({ ...r, s: ["locked", "locking"].includes(r.s) ? "off" : ["unlocked", "unlocking", "open", "opening", "jammed"].includes(r.s) ? "on" : r.s }));
    }
    catch (e) { err = "History isn't available. The recorder may not be keeping these sensors."; }
    if (this._loading !== key) return;                  // a newer request took over
    this._loading = null;
    if (`${this._histIds().join(",")}|${this._hours}` !== key) return;
    this._histKey = key;
    this._histAt = Date.now();
    this._raw = raw;
    this._histErr = err;
    // the lanes draw themselves in once per range, not on every refresh
    if (this._revealKey !== key) { this._revealKey = key; this._sp.reveal.snap(0).to(1, MOTION.graph); }
    if (raw) this._buildHistory();
    else { this._hist = null; this._renderHist(); }
  }

  _buildHistory() {
    const tg = this._histTargets, h = this._hass;
    if (!tg || !this._raw || !h) return;
    // quantized, so a burst of state updates doesn't rebuild the lanes every time
    const end = Math.ceil(Date.now() / 15000) * 15000;
    const start = end - this._hours * 3600000;
    const lanes = tg.lanes.map((l) => ({ ...l, runs: stateRuns(this._raw[l.entity], start, end, this._ev(l.entity)) }));
    const trans = [];
    for (const l of lanes) l.runs.forEach((r, i) => { if (i > 0 || r.t0 > start) trans.push({ t: r.t0, lane: l, state: r.state }); });
    trans.sort((a, b) => a.t - b.t);
    let temp = null;
    if (tg.temp) {
      const st = h.states[tg.temp.entity];
      const points = resample(numericPoints(this._raw[tg.temp.entity], st?.state, end), start, end);
      if (points.length > 1) {
        const s = seriesStats(points), prec = h.entities?.[tg.temp.entity]?.display_precision;
        temp = { points, ...s, unit: tg.temp.unit ?? st?.attributes.unit_of_measurement ?? "", dec: Number.isFinite(prec) ? prec : 1 };
      }
    }
    this._hist = { start, end, lanes, trans, temp };
    if (this._snapTr) this._snapTr = trans.find((x) => x.t === this._snapTr.t && x.lane.key === this._snapTr.lane.key) || null;
    this._renderHist();
  }

  _renderHist() {
    const el = this._el, tg = this._histTargets, H = this._hist;
    if (!el || !tg) return;
    const lanes = H ? H.lanes : tg.lanes;
    const hasTemp = !!tg.temp;
    const rows = Math.max(1, lanes.length + (hasTemp ? 1 : 0));
    put(el.chart, "gridTemplateRows", [hasTemp ? "minmax(44px, 1fr)" : "", lanes.length ? `repeat(${lanes.length}, 20px)` : ""].join(" ").trim());
    el.tIcon.hidden = !hasTemp;
    el.line.hidden = !hasTemp;
    // explicit rows throughout: an auto-placed row would land after the lanes
    put(el.tIcon, "gridRow", "1");
    put(el.line, "gridRow", "1");
    put(el.ov, "gridRow", `1 / span ${rows}`);
    put(el.hempty, "gridRow", `1 / span ${rows}`);
    const pct = (t) => (H ? ((t - H.start) / Math.max(1, H.end - H.start)) * 100 : 0);
    const seen = new Set();
    lanes.forEach((l, i) => {
      let row = this._laneEls.get(l.key);
      if (!row) {
        const gi = document.createElement("span");
        gi.className = "gi";
        gi.innerHTML = "<ha-icon></ha-icon>";
        const trk = document.createElement("div");
        trk.className = "trk";
        trk.innerHTML = `<div class="segs"></div>`;
        el.chart.insertBefore(gi, el.ov);
        el.chart.insertBefore(trk, el.ov);
        row = { gi, icon: gi.firstElementChild, trk, segs: trk.firstElementChild };
        this._laneEls.set(l.key, row);
      }
      seen.add(l.key);
      const r = String(i + 1 + (hasTemp ? 1 : 0));
      put(row.gi, "gridRow", r);
      put(row.trk, "gridRow", r);
      attr(row.gi, "title", l.label);
      const segs = (l.runs || []).filter((x) => x.state !== "off");
      const html = segs.map((x) => `<i${x.state === "on" ? "" : ' data-k="x"'} style="left:${pct(x.t0).toFixed(3)}%;width:${(pct(x.t1) - pct(x.t0)).toFixed(3)}%"></i>`).join("");
      if (row.segs.__html !== html) { row.segs.__html = html; row.segs.innerHTML = html; }
    });
    for (const [key, row] of this._laneEls) {
      if (seen.has(key)) continue;
      row.gi.remove();
      row.trk.remove();
      this._laneEls.delete(key);
    }
    this._paintLaneIcons(null);
    this._drawTemp();
    attr(el.chart, "data-loading", !H);
    el.hempty.hidden = !!H;
    text(el.hempty, this._histErr || "Loading history…");
    el.ov.hidden = !H;
    const sum = H ? this._histSummary(H) : "";
    text(el.hsum, sum);
    attr(el.chart, "aria-label", `History, last ${this._rangeWords()}${sum ? `: ${sum}` : ""}. Arrow keys step through changes.`);
    if (H) {
      const lang = langOf(this._hass), span = H.end - H.start;
      text(el.ax[0], axisLabel(H.start, span, lang));
      text(el.ax[1], axisLabel((H.start + H.end) / 2, span, lang));
      text(el.ax[2], "Now");
    }
    this._chartDirty = true;
    this._wake();
  }

  _drawTemp() {
    const el = this._el, H = this._hist, T = H?.temp;
    const W = el?.line.clientWidth, Hh = el?.line.clientHeight;
    if (!T || !W || !Hh) {
      if (el && el.svg.__key !== "") { el.svg.__key = ""; el.svg.innerHTML = ""; }
      this._tGeom = null;
      return;
    }
    const PT = 15, PB = 14;
    const pad = Math.max((T.max - T.min) * 0.1, 0.3);
    const lo = T.min - pad, hi = T.max + pad;
    const xOf = (t) => ((t - H.start) / Math.max(1, H.end - H.start)) * W;
    const yOf = (v) => PT + (1 - (v - lo) / Math.max(1e-6, hi - lo)) * (Hh - PT - PB);
    const d = linePath(T.points.map((p) => [xOf(p.t), yOf(p.v)]));
    const f = (v) => v.toFixed(2);
    let labels = "";
    for (const ex of [{ p: T.maxAt, v: T.max, up: true }, { p: T.minAt, v: T.min, up: false }]) {
      if (!ex.p || (!ex.up && T.max - T.min < 1e-6)) continue;
      const x = xOf(ex.p.t), y = yOf(ex.v);
      labels += `<circle cx="${f(x)}" cy="${f(y)}" r="2.5" fill="currentColor" fill-opacity="0.7"></circle>
        <text x="${f(clamp(x, 20, W - 20))}" y="${f(ex.up ? y - 6 : y + 12)}" text-anchor="middle" fill="currentColor" fill-opacity="0.55" font-size="10.5" font-weight="600">${esc(this._fmtTemp(ex.v))}</text>`;
    }
    const key = `${W}|${Hh}|${d}|${labels}`;
    if (el.svg.__key !== key) {
      el.svg.__key = key;
      el.svg.setAttribute("viewBox", `0 0 ${f(W)} ${f(Hh)}`);
      el.svg.innerHTML = `<defs><clipPath id="reveal"><rect id="revealRect" x="-4" y="-20" width="${f(W + 8)}" height="${f(Hh + 40)}"></rect></clipPath>
          <linearGradient id="tfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity="0.14"></stop><stop offset="1" stop-color="currentColor" stop-opacity="0"></stop></linearGradient></defs>
        <g clip-path="url(#reveal)"><path d="${d} L${f(W)} ${f(Hh)} L0 ${f(Hh)} Z" fill="url(#tfill)"></path>
          <path d="${d}" fill="none" stroke="currentColor" stroke-opacity="0.6" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"></path>${labels}</g>
        <g id="mk"></g>`;
      el.svg.__mk = null;
    }
    this._tGeom = { W, xOf, yOf };
  }

  _fmtTemp(v) { const T = this._hist?.temp; return `${v.toFixed(T ? T.dec : 1)}${T?.unit || ""}`; }

  // "Door opened 3× · Occupied 2 h 10 min" over the whole range
  _histSummary(H) {
    const parts = [];
    const on = H.lanes.filter((l) => l.slot.key === "presence")
      .reduce((ms, l) => ms + l.runs.filter((r) => r.state === "on").reduce((a, r) => a + (r.t1 - r.t0), 0), 0);
    for (const kind of ["door", "window"]) {
      const lanes = H.lanes.filter((l) => l.slot.key === kind);
      const n = lanes.reduce((c, l) => c + l.runs.filter((r, i) => r.state === "on" && (i > 0 || r.t0 > H.start)).length, 0);
      if (n) parts.push(`${lanes.length > 1 ? `${SLOT[kind].label}s` : lanes[0].label} opened ${n === 1 ? "once" : `${n}×`}`);
    }
    if (on >= 60000) parts.push(`Occupied ${duration(on)}`);
    if (parts.length) return parts.join(" · ");
    if (H.lanes.length) return "No activity";
    return H.temp ? `${this._fmtTemp(H.temp.min)} – ${this._fmtTemp(H.temp.max)}` : "";
  }

  _rangeWords() { return this._hours < 48 ? `${this._hours} hours` : `${Math.round(this._hours / 24)} days`; }

  _stateAt(lane, t) {
    const runs = lane.runs || [];
    for (const r of runs) if (t >= r.t0 && t < r.t1) return r.state;
    const last = runs[runs.length - 1];
    return last && t >= last.t1 ? last.state : null;
  }

  // "Door opened", "Occupied", "Balcony closed"
  _edgeWord(lane, state) {
    if (state === "unavailable" || state === "unknown") return `${lane.label} offline`;
    const on = state === "on";
    if (lane.slot.key === "presence") {
      const w = on ? "Occupied" : "Cleared";
      return lane.label === lane.slot.label ? w : `${lane.label} ${w.toLowerCase()}`;
    }
    if (lane.slot.key === "lock") return `${lane.label} ${on ? "unlocked" : "locked"}`;
    return `${lane.label} ${on ? "opened" : "closed"}`;
  }

  _activeWord(lane) {
    if (lane.slot.key === "presence") return lane.label === lane.slot.label ? "Occupied" : `${lane.label} occupied`;
    if (lane.slot.key === "lock") return `${lane.label} unlocked`;
    return `${lane.label} open`;
  }

  // each lane's icon shows the state at the cursor while scrubbing, and now otherwise
  _paintLaneIcons(t) {
    for (const l of this._hist?.lanes || this._histTargets?.lanes || []) {
      const row = this._laneEls.get(l.key);
      if (!row) continue;
      const state = t == null ? this._ev(l.entity)?.state : this._stateAt(l, t);
      const on = state === "on";
      attr(row.icon, "icon", on ? l.slot.icon : (l.slot.iconOff || l.slot.icon));
      attr(row.gi, "data-on", on);
      attr(row.gi, "data-off", !state || state === "unavailable" || state === "unknown");
    }
  }

  _syncRanges() {
    [...this._el.ranges.querySelectorAll(".rseg")].forEach((seg, i) => {
      const sel = seg.__hours === this._hours;
      attr(seg, "data-sel", sel);
      attr(seg, "aria-pressed", String(sel));
      if (sel) this._rangeIdx = i;
    });
    this._rangeGeom();
  }

  _rangeGeom() {
    const sel = this._el.ranges.querySelectorAll(".rseg")[this._rangeIdx];
    if (!sel || !sel.offsetWidth) return;
    const { rangeX, rangeW } = this._sp;
    if (rangeW.x === 0) { rangeX.snap(sel.offsetLeft); rangeW.snap(sel.offsetWidth); }
    else { rangeX.to(sel.offsetLeft, MOTION.pill); rangeW.to(sel.offsetWidth, MOTION.pill); }
    this._wake();
  }

  _setRange(hours) {
    if (hours === this._hours) return;
    this._hours = hours;
    haptic("selection");
    this._syncRanges();
    this._release();
    this._raw = null;
    this._hist = null;
    this._renderHist();
    this._loadHistory(true);
  }

  _measure() {
    const el = this._el;
    if (!el?.pager) return;
    this._W = el.pager.clientWidth;
    if (this._histOn) { this._rangeGeom(); this._drawTemp(); this._chartDirty = true; }
    this._wake();
  }

  // The pager: a horizontal swipe between the pages. Vertical intent goes back to the
  // dashboard, and a row that scrolls sideways keeps its own swipe.
  _swipe() {
    const sp = this._sp.page, el = this._el.pager;
    let id = null, x0 = 0, y0 = 0, base = 0, axis = 0, hist = [];
    el.addEventListener("pointerdown", (e) => {
      if (!this._histOn || e.button > 0 || id !== null || this._dragging) return;
      if (e.composedPath().some((n) => n.hasAttribute?.("data-overflow"))) return;
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; axis = 0;
      base = sp.x;
      hist = [[performance.now(), sp.x]];
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerId !== id) return;
      if (this._dragging) { id = null; sp.to(this._page, MOTION.page); this._wake(); return; }
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (!axis) {
        if (Math.hypot(dx, dy) < SLOP) return;
        axis = Math.abs(dx) > Math.abs(dy) ? 1 : -1;
        if (axis < 0) { id = null; return; }
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* already lifted */ }
        this._release();
        // the press that started this is a swipe now, not a tap
        for (const n of e.composedPath()) n.__spring?.swallow?.();
      }
      const W = this._W || 1;
      let x = base - dx / W;
      if (x < 0) x = -rubber(-x, 1);
      else if (x > 1) x = 1 + rubber(x - 1, 1);
      sp.snap(x);
      hist.push([performance.now(), x]);
      while (hist.length > 5) hist.shift();
      this._wake();
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      if (axis <= 0) return;
      const [t0, p0] = hist[0], t1 = performance.now();
      const v = t1 > t0 ? (sp.x - p0) / ((t1 - t0) / 1000) : 0;
      // land where the flick is going, not where the finger left off
      const target = clamp(Math.round(clamp(sp.x + project(v * 1000) / 1000, -0.4, 1.4)), 0, 1);
      if (target !== this._page) haptic("light");
      this._page = target;
      sp.to(target, MOTION.page).kick(v - sp.v, 0);
      this._syncPage();
      this._wake();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("click", (e) => { if (axis > 0) { axis = 0; e.stopPropagation(); } }, true);
  }

  _goto(page, quiet = false) {
    if (page === this._page) return;
    this._page = page;
    this._sp.page.to(page, MOTION.page);
    this._syncPage();
    if (!quiet) haptic("light");
    this._wake();
  }

  _syncPage() {
    const el = this._el;
    [...el.dots.children].forEach((d, i) => { attr(d, "data-sel", i === this._page); attr(d, "aria-current", i === this._page ? "true" : null); });
    el.p0.inert = this._page !== 0;
    el.p1.inert = this._page !== 1;
    attr(el.p0, "aria-hidden", this._page === 0 ? null : "true");
    attr(el.p1, "aria-hidden", this._page === 1 ? null : "true");
    if (this._page === 1) { this._loadHistory(); requestAnimationFrame(() => this._measure()); }
    else this._release();
  }

  // Hover (mouse) or press and dwell (touch) to scrub; the cursor snaps onto a change
  // within a few pixels of one. Moving before the dwell is a page swipe.
  _histScrub() {
    const el = this._el.chart;
    let id = null, x0 = 0, y0 = 0, live = false, hover = false, timer = 0;
    const show = (e) => { this._kb = false; this._track(e, true); this._sp.scrub.to(1, MOTION.scrub); this._wake(); };
    el.addEventListener("pointerenter", (e) => { if (e.pointerType !== "mouse" || !this._hist || this._page !== 1) return; hover = true; show(e); });
    el.addEventListener("pointerleave", (e) => { if (e.pointerType !== "mouse" || !hover) return; hover = false; this._release(); });
    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" || e.button > 0 || !this._hist) return;
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; live = false;
      timer = setTimeout(() => {
        if (id !== e.pointerId) return;
        live = true;
        this._dragging = true;
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* already lifted */ }
        haptic("selection");
        show(e);
      }, SNAP_SCRUB_DWELL);
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerType === "mouse") { if (hover && this._hist) this._track(e); return; }
      if (e.pointerId !== id) return;
      if (!live) { if (Math.hypot(e.clientX - x0, e.clientY - y0) < SNAP_SCRUB_SLOP) return; clearTimeout(timer); id = null; return; }
      this._track(e);
    });
    const end = (e) => {
      if (e.pointerType === "mouse" || e.pointerId !== id) return;
      id = null;
      clearTimeout(timer);
      if (!live) return;
      live = false;
      this._dragging = false;
      this._release();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  _track(e, instant = false) {
    const H = this._hist;
    if (!H) return;
    const r = this._el.ov.getBoundingClientRect(), W = r.width || 1;
    let x = clamp(e.clientX - r.left, 0, W);
    const xOf = (t) => ((t - H.start) / Math.max(1, H.end - H.start)) * W;
    let best = null, bd = SNAP_PX;
    for (const tr of H.trans) { const d = Math.abs(xOf(tr.t) - x); if (d <= bd) { bd = d; best = tr; } }
    if (best) x = xOf(best.t);
    if (best !== this._snapTr) { if (best) haptic("selection"); this._snapTr = best; }
    if (instant) this._sp.scrubX.snap(x); else this._sp.scrubX.to(x, MOTION.scrub);
    this._chartDirty = true;
    this._wake();
  }

  _release() {
    if (!this._sp || this._sp.scrub.target === 0) return;
    this._sp.scrub.to(0, MOTION.scrub);
    this._snapTr = null;
    this._kb = false;
    this._chartDirty = true;
    this._wake();
  }

  // Keyboard: arrows step from change to change, Home / End jump, Escape lets go.
  _histKeys() {
    const el = this._el.chart;
    el.addEventListener("keydown", (e) => {
      const H = this._hist;
      if (!H) return;
      if (e.key === "Escape") { if (this._sp.scrub.target > 0) { e.stopPropagation(); this._release(); } return; }
      const k = { ArrowLeft: -1, ArrowRight: 1, Home: "home", End: "end" }[e.key];
      if (!k || !H.trans.length) return;
      e.preventDefault();
      const cur = this._sp.scrub.target > 0 && this._snapTr ? this._snapTr.t : H.end;
      const tr = k === "home" ? H.trans[0] : k === "end" ? H.trans[H.trans.length - 1]
        : k < 0 ? [...H.trans].reverse().find((x) => x.t < cur) : H.trans.find((x) => x.t > cur);
      if (!tr) return;
      const W = this._el.ov.clientWidth || 1;
      const x = ((tr.t - H.start) / Math.max(1, H.end - H.start)) * W;
      const was = this._sp.scrub.target > 0;
      this._snapTr = tr;
      this._kb = true;
      if (was) this._sp.scrubX.to(x, MOTION.scrub); else this._sp.scrubX.snap(x);
      this._sp.scrub.to(1, MOTION.scrub);
      haptic("selection");
      this._chartDirty = true;
      this._wake();
    });
    el.addEventListener("blur", () => { if (this._kb) this._release(); });
  }

  _setMarker(html) {
    const g = this.shadowRoot.getElementById("mk");
    if (!g || this._el.svg.__mk === html) return;
    this._el.svg.__mk = html;
    g.innerHTML = html;
  }

  _paintHist() {
    const el = this._el, H = this._hist, sp = this._sp;
    put(el.chart, "--rv", clamp(sp.reveal.x).toFixed(4));
    const rect = this.shadowRoot.getElementById("revealRect");
    if (rect && this._tGeom) attr(rect, "width", (Math.max(0.01, clamp(sp.reveal.x) * (this._tGeom.W + 8))).toFixed(2));
    const s = H ? clamp(sp.scrub.x) : 0;
    put(el.cursor, "opacity", s < 1e-3 ? "0" : (s * 0.35).toFixed(3));
    put(el.bubble, "opacity", s < 1e-3 ? "0" : s.toFixed(3));
    if (s < 1e-3) {
      if (this._scrubShown) { this._scrubShown = false; this._paintLaneIcons(null); this._setMarker(""); }
      return;
    }
    this._scrubShown = true;
    const W = el.ov.clientWidth || 1;
    const x = clamp(sp.scrubX.x, 0, W);
    const snap = this._snapTr, lang = langOf(this._hass), span = H.end - H.start;
    const t = snap && sp.scrubX.idle ? snap.t : H.start + (x / W) * span;
    put(el.cursor, "transform", `translateX(${x.toFixed(2)}px)`);
    this._paintLaneIcons(t);
    const parts = [];
    if (snap) parts.push(`<span>${esc(this._edgeWord(snap.lane, snap.state))}</span>`, `<span class="t">${esc(momentLabel(snap.t, span, lang))}</span>`);
    else {
      parts.push(`<span class="t">${esc(momentLabel(t, span, lang))}</span>`);
      const active = H.lanes.filter((l) => this._stateAt(l, t) === "on").map((l) => this._activeWord(l));
      if (active.length) parts.push(...active.map((w) => `<span>${esc(w)}</span>`));
      else if (H.lanes.length) parts.push("<span>All quiet</span>");
    }
    let marker = "";
    if (H.temp && this._tGeom) {
      let best = H.temp.points[0];
      for (const p of H.temp.points) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
      parts.push(`<span class="t">${esc(this._fmtTemp(best.v))}</span>`);
      marker = `<circle cx="${this._tGeom.xOf(best.t).toFixed(2)}" cy="${this._tGeom.yOf(best.v).toFixed(2)}" r="3.5" fill="currentColor"></circle>`;
    }
    this._setMarker(marker);
    const html = parts.join("");
    if (el.bubble.__html !== html) { el.bubble.__html = html; el.bubble.innerHTML = html; }
    const bw = el.bubble.offsetWidth || 0;
    put(el.bubble, "transform", `translateX(${clamp(x - bw / 2, 0, Math.max(0, W - bw)).toFixed(2)}px)`);
  }

  // ---------- frames ----------
  _frame(now, dt) {
    const stepped = super._frame(now, dt);
    if (this._chartDirty && !stepped) { this._paintAll(new Set(["chart"])); return true; }
    return stepped;
  }

  _paint(dirty, all, red) {
    const el = this._el;
    const chart = this._chartDirty || all || dirty.has("chart");
    this._chartDirty = false;
    if (this._histOn && (all || dirty.has("page"))) {
      const x = this._sp.page.x, W = this._W || el.pager.clientWidth || 1;
      put(el.track, "transform", Math.abs(x) < 1e-4 ? "" : `translate3d(${(-x * W).toFixed(2)}px,0,0)`);
      // the page being left dims a little, so depth reads without a shadow
      const away = Math.abs(x);
      put(el.p0, "opacity", away > 0.002 ? (1 - 0.55 * clamp(away)).toFixed(3) : "");
      put(el.p1, "opacity", away < 0.998 ? (0.45 + 0.55 * clamp(away)).toFixed(3) : "");
    }
    if (this._histOn && (all || dirty.has("ranges"))) {
      const pill = el.ranges.querySelector(".sel"), w = Math.max(0, this._sp.rangeW.x);
      put(pill, "opacity", w < 1 ? "0" : "");
      put(pill, "width", `${w.toFixed(2)}px`);
      put(pill, "transform", `translate3d(${this._sp.rangeX.x.toFixed(2)}px,0,0)`);
    }
    if (this._histOn && chart) this._paintHist();
    for (const [key, node] of this._nodes) {
      if (node.__enter && (all || dirty.has(`enter:${key}`))) {
        const v = clamp(node.__enter.x);
        put(node, "opacity", v > 0.999 ? "" : v.toFixed(3));
        put(node, "translate", red || v > 0.999 ? "" : `0 ${((1 - v) * 4).toFixed(2)}px`);
      }
      if (node.__onS && (all || dirty.has(`__onS:${key}`))) put(node, "--on", clamp(node.__onS.x).toFixed(3));
      if (node.__warn && (all || dirty.has(`__warn:${key}`))) put(node, "--warn", clamp(node.__warn.x).toFixed(3));
      if (node.__al && (all || dirty.has(`__al:${key}`))) put(node, "--al", clamp(node.__al.x).toFixed(3));
      if (node.__val && node.__numeric && node.__write && (all || dirty.has(`__val:${key}`))) node.__write(this._fmt(node, node.__val.x));
    }
    if (all || dirty.has("alert")) {
      const a = clamp(this._alert.x), g = clamp(this._glow.x);
      put(el.wash, "opacity", a < 1e-3 || this._config.state_glow === false ? "0" : a.toFixed(3));
      put(el.glow, "opacity", g < 1e-3 ? "0" : (g * 0.9).toFixed(3));
    }
  }
}

// ---------- editor ----------
const EDITOR = defineEditor("savvy-room-activity-card", (hass, c) => [
  S.area("area", "Area"),
  S.grid(S.text("name", "Name"), S.icon("icon", "Icon")),
  S.grid(S.select("layout", "Layout", [{ value: "full", label: "Full" }, { value: "compact", label: "Compact (one row)" }]),
    { name: "alarm", label: "Alarm", helper: "Empty: none. Adds the armed pill, and an open door turns red while it's armed. Write auto in YAML for the house's first alarm.", selector: { entity: { domain: "alarm_control_panel" } } }),
  S.bool("colored_states", "Coloured states", "Presence in the accent colour, open doors, windows and unlocked locks amber, alerts red. Off keeps everything grey.", true),
  S.nav("navigation_path", "Target page", "Where tapping the name goes."),
  S.titleLink("title"),
  { name: "exclude_kinds", label: "Hide kinds", selector: { select: { multiple: true, options: SLOTS.map((s) => ({ value: s.key, label: s.label })) } } },
  { name: "exclude", label: "Exclude", selector: { entity: { multiple: true } } },
  S.section("Sensor overrides", SLOTS.map((s) => ({ name: s.key, label: s.label,
    selector: { entity: { domain: s.domain, device_class: s.dc.length ? s.dc : undefined, multiple: !s.single } } }))),
  S.section("History page", [
    { name: "history", label: "", selector: { object: {} }, helper: "false turns it off; { hours: 24, ranges: [6, 24, 72] }" },
  ]),
  S.chips("chips", "Custom chips", "Toggles become chips; a door or a number takes its place with the rest."),
]);

registerCard("savvy-room-activity-card", SavvyRoomActivityCard, "Room activity",
  "What is happening in a room, and when it last happened: presence, doors and windows, readings, alerts and a history page.");
})();

// ===== cards/room-header.js =====
(() => {
// savvy-room-header-card: the header at the top of a room's own page. The room's control (a mode
// select, say: tap to change it) and temperature; a row of what the room has, pinned entities first, then
// everything the area has, on or off (dimmed when idle); your own chips; and a row to
// jump to every other room.
//
//   type: custom:savvy-room-header-card
//   area: living_room
//   control: input_select.living_room_scene   home_path: /lovelace/home
//   entities: [switch.living_room_lights, …]     auto_discover: true
//   chips: [...]                              room_path: /lovelace/{slug}

const STYLE = `${BASE_CSS}${HEADER_CSS}${CHIP_ROW_CSS}`;

class SavvyRoomHeaderCard extends SavvyCard {
  static getStubConfig(hass) {
    const a = allAreas(hass).find((x) => areaEntities(hass, x.id).length);
    return a ? { area: a.id } : {};
  }
  static getConfigElement() { return document.createElement(EDITOR); }

  setConfig(config) {
    if (!config?.area) throw new Error("savvy-room-header-card: set an area");
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

  _modeInfo() { return this._hass && modeInfo(this._hass, controlOf(this._config).entity, this._config); }

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
    mountTitleLine(root, root.querySelector("ha-card"), this._config, (el, onTap) => this._pressable(el, { onTap }, 0.04));
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
      const value = chipState(h, st);
      return {
        key: b.key, icon: look.icon, stateObj: st, entity: b.entity,
        color: b.on ? (look.color || "var(--primary-text-color)") : "var(--secondary-text-color)",
        dim: !b.on, value, caption, aria: `${caption}, ${value}`,
        spin: look.spin ? (b.on && climateRunning(st) ? fanRate(st) : 0) : undefined,
        config: b.cfg, defaults: badgeDefaults(b),
        list: (from) => this._showList(caption, b.ids, look.color, from, null, { bulk: "auto" }),
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

const EDITOR = defineEditor("savvy-room-header-card", (hass, c) => [
  S.area(),
  S.grid(S.titleLine(), S.titleLink("title")),
  ...modeSchema(hass, c),
  S.nav("home_path", "Home button", "Empty hides the button."),
  { name: "temperature", label: "Temperature", helper: "Found from the area. Pick another to override.", selector: { entity: { domain: ["sensor", "climate"] } } },
  ...badgeSchema({ pinnedHelp: "Always shown first, in this order: a lights helper, presence, a door. The rest of the room follows." }),
  S.bool("icons_only", "Icons only", "Just the coloured icons, no names or states.", false),
  S.chips("chips", "Custom chips", "Your own chips, in a row under the room's."),
  { name: "room_path", label: "Room pages", helper: "E.g. /lovelace/{slug} ({area}: the area id, {slug}: with dashes). Empty hides the row.", selector: { text: {} } },
  { name: "room_order", label: "Room order", type: "list", helper: "Rooms listed first, in this order; the rest follow by name.",
    initial: (h, cfg) => (h ? areasOf(h, cfg) : []), add: { selector: { area: {} }, label: "Add a room" },
    summary: (a, h) => ({ title: areaInfo(h, a).name, sub: a }) },
  { name: "exclude_rooms", label: "Exclude rooms", selector: { area: { multiple: true } } },
]);

registerCard("savvy-room-header-card", SavvyRoomHeaderCard, "Room header",
  "The header at the top of a room's page: its control, temperature, everything it has, and the way to every other room.");
})();

// ===== cards/scene.js =====
(() => {
// savvy-scene-card: every scene of a room, one tap each.
//
//   type: custom:savvy-scene-card
//   area: office                          (or a list: scenes from several rooms)
//   title: Scenes                         (optional: a heading; tap it to go somewhere with navigation_path)
//   layout: full | compact                (compact: one scrolling row of pills)
//   columns: 3                            (else 2 to 4 by the card's width)
//   entities: [scene.x, { entity: scene.y, name: Cosy, icon: mdi:sofa, color: amber }]
//                                         pinned first, in this order, even outside the area
//   auto_discover: true                   also every scene the area has (hidden/disabled left out)
//   exclude: [scene.z]
//   strip: '^.*//\s*|\s*-\s*on$'          a regular expression taken out of each name (any case, every match), before the area's name
//   color: blue   show_icon: true
//
// Names: `strip` is taken out first, then the area's name off the front ("Office // Work"
// reads "Work"; with the strip above "Office Relax" reads "Relax"); `strip: false` keeps
// names as they are. A pinned scene's own `name` is used as written.
// Tap runs the scene; hold opens its more-info. A scene lights for a few seconds after it
// runs, from this card or from anywhere else (a scene's state is when it last ran).

const SCENE_LIT_MS = 4000;
const SCENE_DEFAULT_ICON = "mdi:palette";
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const STYLE = `${BASE_CSS}
  ha-card { --pad: 12px; --c: #588ee9; display: flex; flex-direction: column; gap: 10px; padding: var(--pad); }
  .head { display: flex; align-items: center; gap: 4px; min-width: 0; align-self: flex-start; margin: -3px -6px; padding: 3px 6px; border-radius: 10px;
    font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; }
  .head[role="button"] { cursor: pointer; }
  .head .t { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .head ha-icon { --mdc-icon-size: 18px; display: flex; color: var(--secondary-text-color); }

  .grid { display: grid; grid-template-columns: repeat(var(--cols, 2), minmax(0, 1fr)); gap: 8px; min-width: 0; }
  @container (min-width: 300px) { .grid:not([data-cols]) { --cols: 3; } }
  @container (min-width: 460px) { .grid:not([data-cols]) { --cols: 4; } }
  .tile { --on: 0; --tc: var(--c); display: flex; align-items: center; gap: 9px; min-width: 0; box-sizing: border-box; height: 46px; padding: 0 12px 0 8px;
    border-radius: 13px; cursor: pointer; transform-origin: 50% 50%;
    background: color-mix(in oklab, var(--tc) calc(7% + var(--on) * 17%), transparent);
    color: color-mix(in oklab, var(--primary-text-color) calc(78% + var(--on) * 22%), transparent); }
  .tile .ic { flex: none; display: grid; place-items: center; width: var(--b-s); height: var(--b-s); border-radius: 50%; --mdc-icon-size: 16px;
    background: color-mix(in oklab, var(--tc) calc(6% + var(--on) * 10%), transparent); color: var(--tc); }
  .tile .ic > * { display: flex; align-items: center; justify-content: center; width: var(--mdc-icon-size); height: var(--mdc-icon-size); line-height: 0; }
  .tile .nm { min-width: 0; font-size: 13px; line-height: 17px; font-weight: 600; letter-spacing: -0.008em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile[data-off] { opacity: 0.5; }
  .grid[data-noicon] .tile { padding-left: 12px; }
  .grid[data-noicon] .tile .ic { display: none; }

  .grid[data-compact] { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain; touch-action: pan-x pan-y; padding: 3px; margin: -3px; }
  .grid[data-compact]::-webkit-scrollbar { display: none; }
  .grid[data-compact][data-overflow] { mask-image: linear-gradient(to left, transparent 0, #000 26px); -webkit-mask-image: linear-gradient(to left, transparent 0, #000 26px); }
  .grid[data-compact] .tile { flex: none; height: 34px; padding: 0 12px 0 3px; border-radius: 11px; gap: 7px; }
  .grid[data-compact] .tile .ic { --mdc-icon-size: 15px; }
  .grid[data-compact][data-noicon] .tile { padding-left: 12px; }
  .grid[data-compact] .tile .nm { font-size: 12.5px; }

  .empty { padding: 4px 2px; font-size: 12.5px; font-weight: 500; color: var(--secondary-text-color); }
  @media (prefers-contrast: more) { .tile { color: var(--primary-text-color); } }
`;

class SavvySceneCard extends SavvyCard {
  static getStubConfig(hass) {
    const scenes = (ids) => pick(hass, ids, { domains: "scene" });
    const a = allAreas(hass).find((x) => scenes(areaEntities(hass, x.id)).length);
    if (a) return { area: a.id };
    const any = Object.keys(hass?.states || {}).find((id) => id.startsWith("scene."));
    return any ? { entities: [any] } : {};
  }
  static getConfigElement() { return document.createElement(EDITOR); }

  constructor() {
    super();
    this._tiles = new Map();
    this._fired = new Map();
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("savvy-scene-card: invalid configuration");
    const areas = [].concat(config.area ?? config.areas ?? []).filter(Boolean);
    let strip = null;
    if (typeof config.strip === "string" && config.strip) {
      try { strip = new RegExp(config.strip, "gi"); } catch (err) { strip = null; }
    }
    this._config = { ...config, areas, entities: asItems(config.entities), exclude: asItems(config.exclude).map((i) => i.entity), _strip: strip };
    this._compact = config.layout === "compact";
    if (this._el) { this._build(); if (this._hass) this._update(); }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._el) this._build();
    this._update();
  }

  connectedCallback() {
    if (this._el && this._ro) this._ro.observe(this._el.grid);
    this._wake();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this._litTimer);
  }
  getCardSize() {
    const c = this._config;
    if (!c) return 2;
    const rows = this._compact ? 1 : Math.ceil(Math.max(1, this._tiles.size) / (Number(c.columns) || 3));
    return rows + (this._headed() ? 1 : 0);
  }
  getGridOptions() { return { columns: 12, min_columns: 3, rows: "auto" }; }

  _headed() { const c = this._config; return !!(c.title || c.navigation_path || titlePathOf(c)); }
  // the whole header links to navigation_path; a title link replaces that with just the words
  _headLink() { const c = this._config; return titlePathOf(c) ? null : c.navigation_path || null; }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._resetMotion();
    this._tiles.clear();
    const c = this._config;
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="head" id="head" hidden><span class="t" id="title"></span><ha-icon id="chev" icon="mdi:chevron-right" hidden></ha-icon></div>
        <div class="grid" id="grid" role="group"></div>
        <div class="empty" id="empty" hidden></div>
      </ha-card>`;
    const $ = (id) => root.getElementById(id);
    this._el = { card: root.querySelector("ha-card"), head: $("head"), title: $("title"), chev: $("chev"), grid: $("grid"), empty: $("empty") };
    put(this._el.card, "--c", colorOf(c.color || "blue") || "#588ee9");
    attr(this._el.grid, "data-compact", this._compact);
    attr(this._el.grid, "data-noicon", c.show_icon === false);
    const cols = Number(c.columns);
    if (!this._compact && cols >= 1) { attr(this._el.grid, "data-cols", String(cols)); put(this._el.grid, "--cols", String(Math.min(6, Math.round(cols)))); }
    if (this._headLink()) {
      attr(this._el.head, "role", "button");
      attr(this._el.head, "tabindex", "0");
      this._pressable(this._el.head, { onTap: () => navigate(c.navigation_path) }, 0.03);
    }
    linkTitle(root, this._el.title, titlePathOf(c), (el, onTap) => this._pressable(el, { onTap }, 0.04));
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => this._fitRow(this._el.grid));
    this._ro.observe(this._el.grid);
    this._first = true;
  }

  // ---------- which scenes ----------
  _label(item, st, area) {
    if (item.name) return item.name;
    const h = this._hass, c = this._config;
    const raw = st?.attributes.friendly_name || title(String(item.entity).split(".")[1] || item.entity);
    if (c.strip === false) return raw;
    let out = c._strip ? raw.replace(c._strip, "").replace(/\s{2,}/g, " ").trim() : raw;
    const a = area || entityArea(h, item.entity) || c.areas[0];
    const name = a ? areaInfo(h, a).name : "";
    if (name) out = out.replace(new RegExp(`^\\s*${escRe(name)}\\s*(?:[/:|·•–—-]+\\s*)*`, "i"), "").trim();
    return out || raw;
  }

  _items() {
    const h = this._hass, c = this._config, out = [], seen = new Set(c.exclude);
    for (const p of c.entities) {
      if (!p.entity || out.some((o) => o.entity === p.entity)) continue;
      out.push({ ...p, pinned: true });
    }
    const pinned = new Set(out.map((o) => o.entity));
    if (c.auto_discover !== false) {
      const found = [];
      for (const a of c.areas) {
        for (const id of pick(h, areaEntities(h, a), { domains: "scene", exclude: [...seen, ...pinned] })) {
          if (found.some((f) => f.entity === id)) continue;
          found.push({ entity: id, area: a });
        }
      }
      for (const f of found) f.label = this._label(f, h.states[f.entity], f.area);
      found.sort((x, y) => x.label.localeCompare(y.label, langOf(h), { numeric: true }));
      out.push(...found);
    }
    return out;
  }

  // ---------- painting ----------
  _update() {
    const h = this._hass;
    if (!h || !this._el) return;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    const c = this._config, el = this._el;
    const headed = this._headed();
    el.head.hidden = !headed;
    if (headed) {
      text(el.title, c.title || "Scenes");
      el.chev.hidden = !this._headLink();
    }
    this._renderTiles(this._items());
    if (this._first) { this._first = false; requestAnimationFrame(() => this._paintAll(null)); }
    this._wake();
  }

  _lit(id, st) {
    const now = Date.now();
    const last = Math.max(this._fired.get(id) || 0, st ? Date.parse(st.state) || 0 : 0);
    return last > 0 && now - last < SCENE_LIT_MS ? last + SCENE_LIT_MS - now : 0;
  }

  _renderTiles(items) {
    Motion.flip(this._el.grid, () => this._renderTilesNow(items));
  }

  _renderTilesNow(items) {
    const h = this._hass, c = this._config, el = this._el, seen = new Set();
    let nextLit = 0;
    items.forEach((item, at) => {
      const id = item.entity;
      seen.add(id);
      const st = h.states[id];
      let node = this._tiles.get(id);
      if (!node) {
        node = document.createElement("div");
        node.className = "tile";
        node.innerHTML = `<span class="ic"></span><span class="nm"></span>`;
        node.__ic = node.querySelector(".ic");
        node.__nm = node.querySelector(".nm");
        attr(node, "role", "button");
        attr(node, "tabindex", "0");
        node.dataset.entity = id;
        this._pressable(node, { onTap: () => this._run(node.__item, "tap"), onHold: () => this._run(node.__item, "hold") }, 0.035);
        node.__on = this._spring(0, MOTION.ui, `tile:${id}`);
        node.__enter = this._spring(0, MOTION.ui, `tile:${id}`).to(1, MOTION.ui);
        this._tiles.set(id, node);
      }
      node.__item = item;
      const label = item.label ?? this._label(item, st, item.area);
      text(node.__nm, label);
      const down = !st || st.state === "unavailable";
      attr(node, "data-off", down);
      attr(node, "title", label);
      attr(node, "aria-label", down ? `${label}, unavailable` : label);
      put(node, "--tc", item.color ? colorOf(item.color) : "");
      const wantState = !item.icon && !!st;
      if (node.__iconKind !== (wantState ? "state" : "plain")) {
        node.__iconKind = wantState ? "state" : "plain";
        node.__ic.innerHTML = wantState ? "<savvy-state-icon></savvy-state-icon>" : "<ha-icon></ha-icon>";
      }
      const ic = node.__ic.firstElementChild;
      if (wantState) { if (ic.stateObj !== st) { ic.hass = h; ic.stateObj = st; } }
      else attr(ic, "icon", item.icon || SCENE_DEFAULT_ICON);
      const left = down ? 0 : this._lit(id, st);
      attr(node, "data-lit", left > 0);
      if (left > 0) nextLit = Math.max(nextLit, left);
      node.__on.to(left > 0 ? 1 : 0, MOTION.ui);
      place(el.grid, node, at);        // keeps the DOM in the items' order
    });
    for (const [id, node] of this._tiles) {
      if (seen.has(id)) continue;
      for (const s of [node.__on, node.__enter, node.__spring]) { const k = this._springs.indexOf(s); if (k >= 0) this._springs.splice(k, 1); }
      const p = this._pressNodes.indexOf(node);
      if (p >= 0) this._pressNodes.splice(p, 1);
      node.remove();
      this._tiles.delete(id);
    }
    el.empty.hidden = items.length > 0;
    if (!items.length) text(el.empty, c.areas.length || c.entities.length ? "No scenes found in this area." : "Pick an area to list its scenes.");
    el.grid.hidden = !items.length;
    this._fitRow(el.grid);
    clearTimeout(this._litTimer);
    if (nextLit > 0) this._litTimer = setTimeout(() => this._update(), nextLit + 40);
  }

  _run(item, kind) {
    if (!item) return;
    const h = this._hass, id = item.entity, st = h.states[id];
    const a = kind === "tap" ? asAction(item.tap_action ?? defaultTapAction(id)) : asAction(item.hold_action ?? { action: "more-info" });
    if (!a || a.action === "none") return;
    if (kind === "tap" && (!st || st.state === "unavailable") && a.action !== "navigate") return;
    runAction(this, h, a, { entity: id });
    if (kind === "tap" && item.tap_action === undefined) {
      this._fired.set(id, Date.now());
      this._update();
    }
  }

  _paint(dirty, all, red) {
    for (const [id, node] of this._tiles) {
      if (!all && !dirty.has(`tile:${id}`)) continue;
      put(node, "--on", clamp(node.__on.x).toFixed(3));
      const v = clamp(node.__enter.x);
      if (!node.hasAttribute("data-off")) put(node, "opacity", v > 0.999 ? "" : v.toFixed(3));
      put(node, "translate", red || v > 0.999 ? "" : `0 ${((1 - v) * 4).toFixed(2)}px`);
    }
  }
}

// ---------- editor ----------
const SCENE_PICK = { entity: { domain: "scene" } };
const EDITOR = defineEditor("savvy-scene-card", () => [
  { name: "area", label: "Area", helper: "Every scene in these areas is shown. Pick several for one card across rooms.", selector: { area: { multiple: true } } },
  S.grid(S.text("title", "Title", "Empty: no heading."), S.titleLink("title")),
  S.grid({ ...S.select("layout", "Layout", [{ value: "full", label: "Full" }, { value: "compact", label: "Compact (one row)" }]), default: "full" },
    { ...S.number("columns", "Columns", 1, 6), helper: "Empty: 2 to 4, by the card's width." }),
  S.grid(S.color(), S.bool("show_icon", "Show icons", null, true)),
  S.text("strip", "Strip text", "A regular expression taken out of each name, e.g. ^.*//\\s*|\\s*-\\s*on$. The area's name is always taken off the front too."),
  S.nav("navigation_path", "Target page", "Tapping the title goes there."),
  { name: "entities", label: "Pinned", helper: "Shown first, in this order, even from outside the area.", type: "list",
    item: [
      { name: "entity", label: "Scene", selector: SCENE_PICK },
      S.grid(S.text("name", "Name"), S.icon()),
      S.color(),
    ],
    add: { selector: SCENE_PICK, label: "Add a scene" } },
  S.bool("auto_discover", "Auto discover", "Every scene the area has, after the pinned ones.", true),
  { name: "exclude", label: "Never show", selector: { entity: { domain: "scene", multiple: true } } },
]);

registerCard("savvy-scene-card", SavvySceneCard, "Scenes",
  "Every scene of a room (or several) as tiles: one tap runs it, hold for its details.");
})();

// ===== cards/section-title.js =====
(() => {
// savvy-section-title-card: the first card in a room's section. The room's name and icon (from
// the area), its control, its temperature, and a row of badges for what's going on in it:
// pinned entities first, then what is active, then doors and windows, presence and the
// temperature, which are always there. A heading, not a panel: no plate unless `filled: true`.
//
//   type: custom:savvy-section-title-card
//   area: living_room            name / icon: from the area
//   navigation_path: /lovelace/living-room      (or tap_action on the title)
//   control: input_select.living_room_scene
//   entities: [binary_sensor.front_door]        auto_discover: true
//   temperature: sensor.x | false               heading_style: title | subtitle

const BADGE_W = 30;          // icon plus spacing
// The row is anchored at its end. On screen, left to right: the pinned badges, whatever else is
// active (it grows leftwards), then these always-there kinds, then the temperature. To flip the
// order, change this list.
const TRIO = ["window", "door", "presence"];

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
  .mode:not([data-pick]) .chev { display: none; }
  .mode .swap { display: inline-flex; align-items: center; gap: 5px; min-width: 0; }
  .mode .swap span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @container (max-width: 300px) { .mode .swap span { display: none; } }

  /* Right-aligned while everything fits; once it doesn't, the row scrolls from the start
     (flex-end in a scroll container leaves the first items unreachable) and rests at the end. */
  .badges { position: relative; flex: 1 1 0; min-width: 34px; display: flex; align-items: center; justify-content: flex-end;
    height: 28px; padding: 6px 0; margin: -6px 0; overflow: hidden; }
  .badges[data-overflow] { justify-content: flex-start; overflow-x: auto; overscroll-behavior-x: contain; touch-action: pan-x pan-y;
    scrollbar-width: none; -webkit-mask-image: linear-gradient(to right, transparent 0, #000 26px); mask-image: linear-gradient(to right, transparent 0, #000 26px); }
  .badges::-webkit-scrollbar { display: none; }
  .badge { position: relative; flex: none; width: 0; height: 28px; outline: none; }
  .chip { position: absolute; top: 0; inset-inline-start: 0; width: 28px; height: 28px; border-radius: 50%;
    display: grid; place-items: center; color: var(--secondary-text-color); opacity: 0; }
  .chip::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: color-mix(in oklab, var(--bc) 22%, transparent); opacity: 0; }
  .badge[data-critical] .chip::before { opacity: var(--on, 0); }
  .chip ha-icon, .chip savvy-state-icon { --mdc-icon-size: 19px; position: relative; display: flex; }
  :host([kbd]) .badge:focus-visible .chip { box-shadow: 0 0 0 2px var(--bc); }

  /* the temperature is a reading, so it keeps its number */
  .temp { flex: none; display: inline-flex; align-items: center; gap: 4px; padding: 2px 5px; margin-inline-start: 2px; border-radius: 8px;
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

class SavvySectionTitleCard extends SavvyCard {
  static getStubConfig(hass) {
    const a = allAreas(hass).find((x) => areaEntities(hass, x.id).length);
    return a ? { area: a.id } : { name: "Heading" };
  }
  static getConfigElement() { return document.createElement(EDITOR); }

  setConfig(config) {
    if (!config || (!config.area && !config.name && !config.heading && !config.title)) throw new Error("savvy-section-title-card: set an area (or a name)");
    // `title` and `title_path` are the same name and target page the other cards call by those words
    this._config = legacyBadges({ heading_style: "title", ...config, name: config.name || config.heading || config.title, navigation_path: config.navigation_path || config.title_path });
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

  _modeInfo() { return this._hass && modeInfo(this._hass, controlOf(this._config).entity, this._config); }
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
      Motion.tintVar(el.card, "--mode", info.color || "var(--secondary-text-color)");
      attr(el.mode, "data-c", !!info.color);
      attr(el.mode, "aria-label", [modeCaption(info, this._caption()), info.label].filter(Boolean).join(" "));
      attr(el.mode, "data-pick", info.options.length > 0);
      el.mode.disabled = info.kind === "select" && !info.options.length;
      syncModeChip(el.mode, info);
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
    const h = this._hass, found = roomBadges(h, this._config.area, this._config, { alwaysKinds: TRIO });
    const list = [...found.filter((b) => b.pinned), ...found.filter((b) => !b.pinned && !TRIO.includes(b.key)), ...TRIO.map((k) => found.find((b) => !b.pinned && b.key === k)).filter(Boolean)];
    const seen = new Set(), red = MQ.reduced.matches;
    for (const b of list) {
      seen.add(b.key);
      let item = this._badges.get(b.key);
      const look = badgeLook(b);
      if (!item) {
        const node = document.createElement("span");
        node.className = "badge";
        node.setAttribute("role", "button");
        node.innerHTML = `<span class="chip">${look.icon ? "<ha-icon></ha-icon>" : "<savvy-state-icon></savvy-state-icon>"}</span>`;
        item = { el: node, chip: node.querySelector(".chip"), icon: node.querySelector("ha-icon, savvy-state-icon"),
          shown: this._spring(0, MOTION.ui, `badge:${b.key}`, 0.002), on: this._spring(0, MOTION.ui, `badge:${b.key}`, 0.002) };
        item.b = b;
        this._chipActions(node, () => ({ config: item.b.cfg, entity: item.b.entity,
          list: () => this._showList(item.b.kind?.name || shortName(h, item.b.entity), item.b.ids, badgeLook(item.b).color, node, null, { bulk: "auto" }) }), badgeDefaults(b), 0.12);
        this._badges.set(b.key, item);
      }
      item.b = b;
      const st = h.states[b.entity];
      if (look.icon) attr(item.icon, "icon", look.icon);
      else if (item.icon.stateObj !== st) { item.icon.hass = h; item.icon.stateObj = st; }
      put(item.el, "--bc", look.color || "var(--primary-text-color)");
      attr(item.el, "data-critical", look.critical);
      attr(item.el, "aria-label", `${b.cfg.name || shortName(h, b.entity, this._config.area)}, ${chipState(h, st)}`);
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
    // DOM order follows the list, and the temperature closes the row
    const leaving = [...this._badges.values()].filter((i) => !seen.has(i.b.key)).map((i) => i.el);
    const want = [...list.map((b) => this._badges.get(b.key).el), ...leaving, this._el.temp];
    const kids = [...this._el.badges.children];
    if (want.some((n, i) => kids[i] !== n)) for (const n of want) this._el.badges.appendChild(n);
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
const EDITOR = defineEditor("savvy-section-title-card", (hass, c) => [
  S.area(),
  S.grid(S.text("name", "Name"), S.icon("icon", "Icon")),
  S.nav("navigation_path", "Target page", "Where tapping the name goes. Or set a tap action below."),
  S.grid(S.select("heading_style", "Style", [{ value: "title", label: "Title" }, { value: "subtitle", label: "Subtitle" }]),
    S.bool("filled", "Filled", null, false)),
  ...modeSchema(hass, c),
  { name: "temperature", label: "Temperature", helper: "Found from the area (a temperature sensor, else its climate unit). Pick another to override.",
    selector: { entity: { domain: ["sensor", "climate"] } } },
  ...badgeSchema(),
  S.section("Title actions", [S.action("tap_action", "Tap action"), S.action("hold_action", "Hold action")]),
]);

registerCard("savvy-section-title-card", SavvySectionTitleCard, "Section title",
  "A title for a section of a dashboard: plain text, or a room's name with its control, temperature and live status badges.");
})();

// ===== cards/settings.js =====
(() => {
// savvy-settings-card: the defaults every Savvy card on the dashboard shares. Place it once, on any
// page; the other cards find it by reading the dashboard's config, so they pick it up whichever
// page they are on. A card's own options always win; then the room's; then these; then
// auto-discovery. In view mode it is a small status card: how many defaults, how many cards
// on this page use them.
//
//   type: custom:savvy-settings-card
//   pages:  { home, lights, climate, media, security, health, room: /lovelace/{slug} }
//   house:  { control, weather, security, tap: list | navigate }
//   health: { watchman, battery_threshold, warn_above, exclude_platforms, group_by, group_min, watchman_last_run }
//   ignore: { entities: [], areas: [] }   entities leave every card's auto-discovery; areas leave the home header chips
//   room_order: [area ids]   the rooms' order in the popups and the room header's row; the rest follow by name
//   rooms:  { living_room: { name, icon, page, control, light_state, temperature, humidity, include, exclude } }
//   layout: full | compact

const STYLE = `${BASE_CSS}
  ha-card { display: flex; align-items: center; gap: 12px; padding: var(--pad); }
  :host([compact]) ha-card { padding: 10px 14px; gap: 10px; }
  .disc { flex: none; display: grid; place-items: center; width: var(--b-m); height: var(--b-m); border-radius: 50%;
    background: var(--well); color: var(--secondary-text-color); }
  :host([compact]) .disc { width: var(--b-s); height: var(--b-s); }
  .disc ha-icon { --mdc-icon-size: 20px; display: flex; }
  :host([compact]) .disc ha-icon { --mdc-icon-size: 16px; }
  .disc[data-warn] { background: color-mix(in oklab, var(--lvl-warn) var(--mix-alert), transparent); color: var(--lvl-warn); }
  .col { min-width: 0; display: flex; flex-direction: column; }
  .name { font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { font-size: 12px; line-height: 16px; font-weight: 500; color: var(--secondary-text-color); overflow-wrap: anywhere; }
  .sub[data-warn] { color: var(--lvl-warn, #E0A030); }
  :host([compact]) .col { flex-direction: row; align-items: baseline; gap: 10px; flex: 1; }
  :host([compact]) .name { flex: none; font-size: 13.5px; }
  :host([compact]) .sub { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;

class SavvySettingsCard extends SavvyCard {
  static getStubConfig() { return { pages: {}, house: {}, rooms: {} }; }
  static getConfigElement() { return document.createElement(SETTINGS_EDITOR); }

  setConfig(config) {
    this._config = { ...config };
    this._compact = config?.layout === "compact";
    SettingsStore.publish(this, this._config);
    this.toggleAttribute("compact", this._compact);
    if (this._el) this._update();
  }

  set hass(hass) {
    this._hass = hass;
    SettingsStore.load(hass);
    if (!this._config) return;
    if (!this._el) this._build();
    this._update();
  }

  connectedCallback() {
    this._unsub = SettingsStore.subscribe(() => this._update());
    if (this._config) SettingsStore.publish(this, this._config);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.();
    this._unsub = null;
    SettingsStore.unpublish(this);
  }

  getCardSize() { return 1; }
  getGridOptions() { return { columns: 12, min_columns: 4, rows: "auto" }; }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <span class="disc" id="disc"><ha-icon icon="mdi:cog-sync-outline"></ha-icon></span>
        <span class="col"><span class="name" id="name">Savvy settings</span><span class="sub" id="sub"></span></span>
      </ha-card>`;
    this._el = { card: root.querySelector("ha-card"), disc: root.getElementById("disc"), sub: root.getElementById("sub"), name: root.getElementById("name") };
  }

  _update() {
    const el = this._el;
    if (!el) return;
    this.toggleAttribute("dark", !!this._hass?.themes?.darkMode);
    // the card names itself; a title says it another way (no link: this card goes nowhere)
    text(el.name, String(this._config?.title ?? "").trim() || "Savvy settings");
    const { defaults, consumers, found } = SettingsStore.stats();
    const cards = `${consumers} ${consumers === 1 ? "card" : "cards"}`;
    const many = found > 1;
    let words = defaults ? `${defaults} ${defaults === 1 ? "default" : "defaults"} · used by ${cards} on this page` : "No defaults set yet";
    if (many) words = `${found} settings cards found: using the first. ${words}`;
    const pages = Object.keys(SettingsStore.autoPages()).length;
    if (pages) words += ` · ${pages} ${pages === 1 ? "page" : "pages"} found by name`;
    attr(el.disc, "data-warn", many);
    attr(el.sub, "data-warn", many);
    text(el.sub, words);
    attr(el.card, "aria-label", `Savvy settings, ${words}`);
  }
}

// ---- the editor: sections, and the rooms as a list (the config keeps them as a map by area)

// the rooms list follows `room_order`; rooms it doesn't name keep their place after the named ones
const byOrder = (order) => {
  const rank = new Map([].concat(order || []).map((a, i) => [a, i]));
  return (a, b) => (rank.get(a.area) ?? Infinity) - (rank.get(b.area) ?? Infinity);
};
const toRoomList = (rooms, order) => Object.entries(rooms || {}).map(([area, v]) => ({ area, ...(v && typeof v === "object" ? v : {}) })).sort(byOrder(order));
const fromRoomList = (list) => Object.fromEntries((list || []).filter((i) => i && i.area).map(({ area, ...rest }) => [area, cleanConfig(rest)]));
const withoutList = (c) => { const { rooms_list, ...rest } = c || {}; return rest; };

class SettingsEditor extends SavvyEditor {
  get cardType() { return null; }

  setConfig(config) {
    const same = this._config && JSON.stringify(cleanConfig({ ...config })) === JSON.stringify(withoutList(this._config));
    if (same) return;
    this._config = { ...config, rooms_list: toRoomList(config?.rooms, config?.room_order) };
    this._render();
  }

  _emit(config) {
    let { rooms_list, ...rest } = config;
    // a new room order re-orders the Rooms entries with it
    if (rooms_list && JSON.stringify(rest.room_order || []) !== JSON.stringify(this._config?.room_order || [])) {
      rooms_list = [...rooms_list].sort(byOrder(rest.room_order));
      this._reorder = true;
    }
    const out = { ...rest };
    if (rooms_list) {
      const map = fromRoomList(rooms_list);
      if (Object.keys(map).length) out.rooms = map; else delete out.rooms;
    }
    super._emit(out);
    this._config = { ...this._config, rooms_list: rooms_list ?? toRoomList(this._config.rooms, this._config.room_order) };
    if (this._reorder) { this._reorder = false; this._render(); }
  }

  _render() {
    super._render();
    const wrap = this.shadowRoot.querySelector(".sv-ed");
    if (!wrap) return;
    const button = (label, onClick) => {
      const btn = document.createElement("button");
      btn.className = "sv-prefill";
      btn.type = "button";
      btn.textContent = label;
      btn.addEventListener("click", onClick);
      return btn;
    };
    const everyArea = () => Object.values(this._hass?.areas || {}).sort((a, b) => String(a.name).localeCompare(String(b.name))).map((a) => a.area_id).filter(Boolean);
    // the order list sits above the rooms list: its button goes right after it
    const orderList = wrap.querySelector('[data-key="list:room_order"]');
    const orderBtn = button("Add every room to the order", () => {
      const have = new Set(this._config.room_order || []);
      const add = everyArea().filter((id) => !have.has(id));
      if (!add.length) return;
      this._emit({ ...this._config, room_order: [...(this._config.room_order || this._config.rooms_list?.map((i) => i.area) || []), ...add] });
      this._render();
    });
    orderBtn.dataset.for = "room_order";
    if (orderList) orderList.after(orderBtn); else wrap.appendChild(orderBtn);
    wrap.appendChild(button("Add every room", () => {
      const have = new Set((this._config.rooms_list || []).map((i) => i.area));
      const areas = everyArea().filter((id) => !have.has(id));
      if (!areas.length) return;
      this._emit({ ...this._config, rooms_list: [...(this._config.rooms_list || []), ...areas.map((area) => ({ area }))] });
      this._render();
    }));
  }

  schema(hass) {
    const areaName = (id) => hass?.areas?.[id]?.name || title(id);
    // a page the dashboard already has by name needs no entry here
    const found = SettingsStore.autoPages();
    const page = (key, label) => S.nav(key, label, found[key] ? `Found automatically: ${found[key]}. Fill it in to use another page; false for none.` : undefined);
    return [
      S.grid(S.text("title", "Title", "Empty: Savvy settings."), S.select("layout", "Layout", [{ value: "full", label: "Full" }, { value: "compact", label: "Compact" }])),
      { type: "expandable", name: "pages", title: "Pages", schema: [
        S.nav("home", "Home", "Where the home button goes."),
        page("lights", "Lights page"), page("climate", "Climate page"), page("media", "Media page"), page("security", "Security page"),
        S.nav("health", "System health page"),
        S.text("room", "Room pages", `A pattern: /lovelace/{slug} (the room with dashes) or {area} (its id).${found.room ? ` Found automatically: ${found.room}.` : " Each room's page is also found by its name."}`),
      ] },
      { type: "expandable", name: "house", title: "Home", schema: [
        S.entity("control", "Control", undefined, { helper: "The house mode: a select opens a picker; a button, scene or switch acts." }),
        S.entity("weather", "Weather", "weather"),
        S.entity("security", "Security entity", undefined, { helper: "Shown on the security chip instead of the alarm." }),
        S.select("tap", "Chip tap", [{ value: "list", label: "Open the list" }, { value: "navigate", label: "Go to its page (hold opens the list)" }]),
      ] },
      { type: "expandable", name: "health", title: "Health", schema: [
        { name: "watchman", label: "Watchman sensors", selector: { entity: { multiple: true, domain: "sensor" } } },
        S.grid(S.number("battery_threshold", "Battery alert", 1, 100, 1, "%"), S.number("warn_above", "Red threshold", 1, 99)),
        { name: "exclude_platforms", label: "Ignored integrations", selector: { select: { multiple: true, custom_value: true, options: ["mobile_app"] } } },
        S.select("group_by", "Grouping", [{ value: "hub", label: "Device, and the hub behind it" }, { value: "device", label: "Device" }, { value: "none", label: "Nothing: one row per entity" }]),
        S.number("group_min", "Hub threshold", 2, 50),
        S.entity("watchman_last_run", "Watchman last run", "sensor"),
        { type: "expandable", name: "ignore", title: "Known problems", schema: [
          { name: "devices", label: "Devices", helper: "Dead and waiting for a replacement? Listed here they leave the count and wait under Known.", selector: { device: { multiple: true } } },
          { name: "entities", label: "Entities", selector: { entity: { multiple: true } } },
        ] },
      ] },
      { type: "expandable", name: "ignore", title: "Ignore", schema: [
        { name: "entities", label: "Ignored entities", helper: "Left out of the home header's counts and popups, and out of what room headers, section titles, room tiles, room activity, locks, lights, scenes and vacuums find by themselves. A card that names an entity still shows it.", selector: { entity: { multiple: true } } },
        { name: "areas", label: "Ignored rooms", selector: { area: { multiple: true } } },
      ] },
      { type: "expandable", name: "design", title: "Design", schema: [
        S.bool("state_glow", "State glow", "A soft glow in a corner of a card in what it is doing: a lit light, a locked door, music playing. Off here turns it off on every card; a card can still set its own.", true),
      ] },
      { name: "admin_only", label: "Admin only", helper: "Kept from people who are not administrators; everyone sees everything unless it is listed. A card can only hide itself: it does not lock a page. In YAML, true means both.",
        selector: { select: { multiple: true, options: [{ value: "health_cog", label: "Health cog" }, { value: "health_badges", label: "Health count badge" }] } } },
      { name: "aggregate", label: "Aggregate sensors", helper: "Show a room's sensors of these kinds once: occupied if any one is. Sensors on your ignore list are left out. In YAML, true means presence.",
    selector: { select: { multiple: true, options: [{ value: "presence", label: "Presence and motion" }, { value: "door", label: "Doors" }, { value: "window", label: "Windows" },
      { value: "leak", label: "Leaks" }, { value: "smoke", label: "Smoke" }, { value: "gas", label: "Gas" }] } } },
  { name: "room_order", label: "Room order", type: "list", empty: "No order yet: rooms follow by name.",
        helper: "The order of the rooms in the popups and the room header's row: listed first, in this order; the rest follow by name.",
        // while unset it starts as the Rooms entries' order, so reordering works from the first touch
        initial: (h, cfg) => Object.keys(cfg?.rooms || {}),
        add: { selector: { area: {} }, label: "Add a room" },
        summary: (a, h) => ({ title: h?.areas?.[a]?.name || areaName(a), sub: a }) },
      { name: "rooms_list", label: "Rooms", type: "list", empty: "No rooms yet. Add one, or add every room below.",
        helper: "Per room: what its cards share. A card's own settings win.",
        summary: (item, h) => ({ title: item.name || h?.areas?.[item.area]?.name || areaName(item.area), sub: item.area }),
        add: { selector: { area: {} }, label: "Add a room", make: (area) => ({ area }) },
        item: [
          { name: "area", label: "Area", selector: { area: {} } },
          S.grid(S.text("name", "Name"), S.icon()),
          S.nav("page", "Target page"),
          S.entity("control", "Control"),
          S.entity("light_state", "Light helper", undefined, { helper: "Used by the lights card's pill and the room tile's toggle. Not shown as a badge: pin it yourself under entities if you want one." }),
          S.grid(S.entity("temperature", "Temperature", "sensor"), S.entity("humidity", "Humidity", "sensor")),
          { name: "include", label: "Include", helper: "Entities to treat as in this room (a lock with no area).", selector: { entity: { multiple: true } } },
          { name: "exclude", label: "Exclude", selector: { entity: { multiple: true } } },
        ] },
    ];
  }
}
const SETTINGS_EDITOR = "savvy-settings-card-editor";
if (!customElements.get(SETTINGS_EDITOR)) customElements.define(SETTINGS_EDITOR, SettingsEditor);

registerCard("savvy-settings-card", SavvySettingsCard, "settings",
  "The defaults every Savvy card shares: pages, the house control, health options, what to ignore, and each room's helpers. Set once; any card can still override.");
})();

// ===== cards/system-health.js =====
(() => {
// savvy-system-health-card: what in the house needs attention, with a count pill.
//
// By default it lists everything (source: all), in sections: Watchman (when its sensors are
// given), Offline devices (with the integrations that failed, and the entities that have no
// device) and Low batteries. Or one source on its own. The pill's number is exactly what
// savvy-home-header-card's cog shows: both read core/health.
//
// Offline devices are grouped: every unavailable entity of a device is one issue (the
// device), a hub whose devices are offline (a Zigbee bridge, a coordinator) is one issue for
// all of them, and so is an integration that failed or whose devices are mostly offline.
// Tap a row to open it; tap an entity for its more-info; hold a device for its page in Home
// Assistant. Watchman's section has a chip that runs a new report.
//
//   type: custom:savvy-system-health-card
//   source: all | watchman | offline | battery      (offline is also called unavailable)
//   battery_threshold: 20        exclude_platforms: [mobile_app]
//   watchman: [sensor.watchman_missing_entities, sensor.watchman_missing_actions]
//   group_by: hub | device | none      group_min: 3      details: false
//   warn_above: 6  max_rows: 7   title: …     columns: auto | 1 | 2 | 3   (source all: a column per category when wide)
//   dismiss: true                a button on each row that puts it aside for you (false hides the buttons)
//   watchman_button: true        watchman_report: { parse_config: true }
//   action: { label: Generate report, tap_action: { action: perform-action, perform_action: watchman.report } }
//           (a footer button only when there is an action to run: none by default, and `none` is none)

const SOURCES = {
  all: { title: "Health", noun: "issue", nouns: "issues" },
  watchman: { title: "Watchman", noun: "issue", nouns: "issues" },
  unavailable: { title: "Offline devices", noun: "offline", nouns: "offline" },
  battery: { title: "Batteries", noun: "low", nouns: "low" },
};
const GROUP_TITLE = { watchman: "Watchman", unavailable: "Offline devices", battery: "Low batteries" };
const ALL_FINE = { watchman: "Nothing missing", unavailable: "All devices online", battery: "All batteries fine" };
const REPORT_TIMEOUT = 60000;
const COL_MIN = 240, COL_GAP = 14;
const joinAnd = (parts) => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

const STYLE = `${BASE_CSS}
  ha-card { display: flex; flex-direction: column; gap: 10px; padding: var(--pad); overflow: hidden; --lvl: var(--secondary-text-color); container-name: card; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .name { font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pill { flex: none; display: inline-flex; align-items: center; height: 22px; padding: 0 9px; border-radius: 11px;
    background: color-mix(in oklab, var(--lvl) 16%, transparent); color: color-mix(in oklab, var(--lvl) 78%, var(--primary-text-color));
    font-size: 11px; line-height: 14px; font-weight: 650; letter-spacing: 0.02em; white-space: nowrap; text-transform: uppercase; }
  .empty { display: flex; align-items: center; gap: 8px; padding: 2px 0; color: var(--secondary-text-color); font-size: 12.5px; line-height: 16px; font-weight: 500; }
  .empty ha-icon { --mdc-icon-size: 17px; display: flex; color: var(--lvl-good); }
  .cols { display: grid; gap: 14px; align-items: start; grid-template-columns: minmax(0, 1fr); }
  .rows { container: rows / inline-size; display: flex; flex-direction: column; min-width: 0; max-height: calc(var(--max-rows, 7) * 38px); overflow-y: auto;
    scrollbar-width: none; margin: 0 -4px; padding: 0 4px; }
  .rows::-webkit-scrollbar { display: none; }
  /* only a list that really scrolls keeps the gesture to itself: a short one lets the page scroll over it */
  .rows[data-overflow] { overscroll-behavior-y: contain; -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 22px), transparent 100%);
    mask-image: linear-gradient(to bottom, #000 calc(100% - 22px), transparent 100%); }
  .titles { display: flex; flex-direction: column; min-width: 0; }
  .when { font-size: 11.5px; line-height: 15px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .group { display: flex; align-items: center; gap: 6px; }
  .rows .empty.ok { flex: none; padding: 4px 4px 2px; }
  .group .gw { margin-inline-start: auto; font-weight: 500; letter-spacing: 0; text-transform: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .group { flex: none; margin: 8px 4px 2px; font-size: 11px; line-height: 14px; font-weight: 650; letter-spacing: 0.04em;
    text-transform: uppercase; color: var(--secondary-text-color); }
  .group:first-child { margin-top: 0; }
  .row { flex: none; display: flex; align-items: center; gap: 9px; min-height: 38px; padding: 3px 4px; border-radius: 10px; text-align: start; transform-origin: 0 50%; }
  .row[role="button"] { cursor: pointer; }
  .row[data-group-start] { border-top: 1px solid var(--line); margin-top: 2px; padding-top: 5px; }
  .row[data-dim] { opacity: 0.55; }
  .row .disc { flex: none; display: grid; place-items: center; width: var(--b-s); height: var(--b-s); border-radius: 50%; background: var(--well); color: var(--secondary-text-color); }
  .row .disc ha-icon { --mdc-icon-size: 15px; display: flex; }
  .row[data-alert] .disc { background: color-mix(in oklab, var(--lvl-bad) var(--mix-alert), transparent); color: var(--lvl-bad); }
  .row .col { min-width: 0; flex: 1; display: flex; flex-direction: column; }
  .row .n { font-size: 12.5px; line-height: 16px; font-weight: 600; letter-spacing: -0.006em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .s { font-size: 10.5px; line-height: 13px; font-weight: 500; letter-spacing: 0.006em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row[data-depth="1"] { margin-inline-start: 16px; }
  .row[data-depth="2"] { margin-inline-start: 32px; }
  .row[data-depth="3"] { margin-inline-start: 48px; }
  .report { flex: none; display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 9px 0 6px; border-radius: 11px; margin-inline-start: 6px;
    background: color-mix(in oklab, rgb(var(--accent)) 16%, transparent); color: rgb(var(--accent));
    font-size: 11px; line-height: 14px; font-weight: 650; letter-spacing: 0; text-transform: none; white-space: nowrap; transform-origin: 50% 50%; }
  .report ha-icon { --mdc-icon-size: 14px; display: flex; transform-origin: 50% 50%; }
  .report[hidden] { display: none; }
  .report[data-flash] { background: color-mix(in oklab, var(--lvl-good) 18%, transparent); color: var(--lvl-good); }
  .row[data-soft] .disc { background: color-mix(in oklab, var(--lvl-warn) var(--mix-alert), transparent); color: var(--lvl-warn); }
  .row .chev { flex: none; display: flex; --mdc-icon-size: 18px; color: var(--secondary-text-color); transform-origin: 50% 50%; }
  .facts { flex: none; margin: -1px 4px 3px; font-size: 11.5px; line-height: 15px; font-weight: 500; color: var(--secondary-text-color);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .x { flex: none; display: grid; place-items: center; width: var(--c-s); height: var(--c-s); border-radius: 11px; margin-inline-end: -3px;
    color: var(--secondary-text-color); opacity: 0.62; transform-origin: 50% 50%; }
  .row .x ha-icon { --mdc-icon-size: 18px; display: flex; }
  .row .x:hover { opacity: 1; background: var(--well); }
  :host([kbd]) .row .x:focus-visible { opacity: 1; box-shadow: 0 0 0 2px rgb(var(--accent)); }
  .row .v { flex: none; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--secondary-text-color); }
  .action { flex: none; display: flex; align-items: center; justify-content: center; gap: 6px; height: 34px; margin-top: 2px; border-radius: 11px;
    background: color-mix(in oklab, rgb(var(--accent)) 16%, transparent); color: rgb(var(--accent));
    font-size: 12.5px; line-height: 16px; font-weight: 650; letter-spacing: -0.006em; transform-origin: 50% 50%; }
  @media (prefers-contrast: more) { .row .s { color: var(--primary-text-color); opacity: 0.8; } }
  @container card (max-width: 260px) { .row .s { display: none; } }
  /* a narrow column: the title and the chip on one line, what is wrong under them */
  @container rows (max-width: 340px) {
    .group { flex-wrap: wrap; row-gap: 2px; }
    .group .gt { white-space: nowrap; flex: 1 1 auto; }
    .group .report { order: 2; margin-inline-start: auto; }
    .group .gw { order: 3; flex: 1 0 100%; margin-inline-start: 0; white-space: normal; }
  }
`;

// What the footer button does, or null: it needs a tap_action that is not "none" (or the pre-Savvy
// shape { label, service, data, target }). A label alone, or an empty action, makes no button.
const footerAction = (a) => {
  if (!a || typeof a !== "object") return null;
  let t = a.tap_action;
  if (typeof t === "string") t = { action: t };
  if (!t && a.service) t = { action: "perform-action", perform_action: a.service, data: a.data, target: a.target };
  return t && t.action && t.action !== "none" ? t : null;
};

// The editor's footer section writes `action: { tap_action: { action: none } }` as soon as it is
// touched: that is no action, so it is not saved.
const tidyFooter = (c) => {
  const a = c.action;
  if (!a || typeof a !== "object") return c;
  const out = { ...a };
  const t = out.tap_action;
  if (t === "none" || t?.action === "none" || (t && typeof t === "object" && !Object.keys(t).length)) delete out.tap_action;
  if (!Object.keys(out).filter((k) => out[k] !== "" && out[k] != null).length) { const { action, ...rest } = c; return rest; }
  return { ...c, action: out };
};

class SavvySystemHealthCard extends HTMLElement {
  static getStubConfig() { return {}; }
  static getConfigElement() { return document.createElement(EDITOR); }

  constructor() {
    super();
    watchKeyboard(this);
    this._job = (now, dt) => this._frame(dt);
    this._rows = new Map();
    this._open = new Set();      // keys of the hub / device rows that are expanded
  }

  setConfig(config) {
    const source = (config?.source === "offline" ? "unavailable" : config?.source) || "all";
    if (!SOURCES[source]) throw new Error(`savvy-system-health-card: "source" must be one of ${Object.keys(SOURCES).join(", ")}`);
    // the pre-Savvy names still work: threshold, and entities for the watchman source
    const watchman = config.watchman ?? (source === "watchman" ? config.entities : undefined);
    if (source === "watchman" && !(watchman || []).length) throw new Error('savvy-system-health-card: the "watchman" source needs its sensors in "watchman"');
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
    this._ticker = this._ticker || setInterval(() => this._hass && this._update(), 30000);
    // failed integrations are only told to us asynchronously
    this._onEntries = this._onEntries || (() => { if (this._hass && this._root) this._update(); });
    entryStore.listeners.add(this._onEntries);
    dismissStore.listeners.add(this._onEntries);
  }
  disconnectedCallback() {
    Clock.remove(this._job); this._ro?.disconnect(); clearInterval(this._ticker); this._ticker = 0;
    entryStore.listeners.delete(this._onEntries);
    dismissStore.listeners.delete(this._onEntries);
    clearTimeout(this._repTimer); clearTimeout(this._flashTimer);
  }

  // "Checked 2 h ago", under the title for the Watchman source
  _tickWhen() {
    if (!this._el) return;
    const t = this._lastRunTime();
    const words = Number.isFinite(t) ? `Checked ${since(t, false)}` : "";
    const tip = Number.isFinite(t) ? clockTime(t, langOf(this._hass)) : null;
    const under = this._config.source === "watchman";
    this._el.when.hidden = !under || !words;
    text(this._el.when, under ? words : "");
    attr(this._el.when, "title", under ? tip : null);
  }
  _lastRunTime() {
    const st = this._lastRun && this._hass?.states[this._lastRun];
    return st ? Date.parse(st.state) : NaN;
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
        <div class="head" id="head"><span class="titles"><span class="name" id="name"></span><span class="when" id="when" hidden></span></span><span class="pill" id="pill"></span></div>
        <div class="cols" id="cols"></div>
        <button class="action" id="action" hidden></button>
        <button class="report" id="report" hidden><ha-icon icon="mdi:refresh"></ha-icon><span>Run report</span></button>
      </ha-card>`;
    const $ = (id) => this._root.getElementById(id);
    this._el = { card: this._root.querySelector("ha-card"), head: $("head"), name: $("name"), when: $("when"), pill: $("pill"), cols: $("cols"), action: $("action"), report: $("report") };
    this._boxes = new Map();
    this._el.report.remove();
    this._pressable(this._el.report, () => this._runReport());
    this._angle = 0;
    const c = this._config;
    put(this._el.cols, "--max-rows", c.max_rows);
    text(this._el.name, c.title || SOURCES[c.source].title);
    linkTitle(this._root, this._el.name, titlePathOf(c), (el, onTap) => this._pressable(el, onTap));
    // the footer button is off unless it has something to do
    const footer = footerAction(c.action);
    if (footer) {
      this._el.action.hidden = false;
      text(this._el.action, c.action.label || "Run");
      this._pressable(this._el.action, () => {
        haptic("medium");
        runAction(this, this._hass, footer, {});
      });
    }
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => this._fit());
  }

  // One list per category: they sit side by side when the card is wide, and stack when it isn't.
  _box(key) {
    let box = this._boxes.get(key);
    if (!box) {
      box = document.createElement("div");
      box.className = "rows";
      box.__key = key;
      this._boxes.set(key, box);
      this._ro.observe(box);
    }
    return box;
  }

  // `columns`: auto is as many as there are categories, never narrower than COL_MIN each; 1 stacks them
  _layoutCols(count) {
    const want = Number(this._config.columns) || count;
    const n = Math.max(1, Math.min(want, count));
    put(this._el.cols, "grid-template-columns", n === 1 ? "minmax(0, 1fr)"
      : `repeat(auto-fit, minmax(max(${COL_MIN}px, calc((100% - ${(n - 1) * COL_GAP}px) / ${n})), 1fr))`);
  }

  _pressable(el, onTap, onHold) {
    const spring = new Spring(0, MOTION.press, `p${this._springs.length}`);
    this._springs.push(spring);
    this._pressNodes.push(el);
    el.__spring = spring;
    bindPress(el, { spring, wake: () => this._wake(), onTap, onHold, haptic: null });
  }

  // ---------- what to say ----------
  _offlineLine(sum) {
    const is = sum.offline;
    const integ = is.filter((i) => i.kind === "integration").length;
    const down = is.filter((i) => i.kind === "hub" || (i.kind === "device" && i.state === "down")).length;
    const part = is.filter((i) => i.kind === "device" && i.state === "partial").length;
    const ent = is.filter((i) => i.kind === "entity").length;
    const main = [];
    if (integ) main.push(plural(integ, "integration", "integrations"));
    if (down) main.push(plural(down, "device", "devices"));
    if (ent) main.push(plural(ent, "entity", "entities"));
    const out = [];
    if (main.length) out.push(`${joinAnd(main)} offline`);
    if (part) out.push(`${part} partly offline`);
    return out.join(", ");
  }

  // Watchman's own words; what the offline devices already explain is said once, not counted twice
  _watchmanLine(sum) {
    const left = sum.counts.watchman, ex = sum.counts.watchmanExplained;
    const say = ({ entities, actions }) => {
      const parts = [];
      if (entities) parts.push(`${entities} missing ${entities === 1 ? "entity" : "entities"}`);
      if (actions) parts.push(`${actions} missing ${actions === 1 ? "action" : "actions"}`);
      return parts.join(", ");
    };
    if (!left && ex) return `${say(sum.counts.watchmanAllKinds)}, all from offline devices`;
    const line = say(sum.counts.watchmanKinds) || plural(left, "missing item", "missing items");
    return ex ? `${line}, ${ex} from offline devices` : line;
  }

  _line(key, sum) {
    const n = sum.counts[key];
    if (key === "watchman" && !n && sum.counts.watchmanExplained) return this._watchmanLine(sum);
    if (!n) return "";
    if (key === "unavailable") return this._offlineLine(sum);
    if (key === "battery") return `${plural(n, "battery", "batteries")} low`;
    return this._watchmanLine(sum);
  }

  _facts(key, sum) {
    if (key === "unavailable") {
      const { total, down } = sum.stats.devices;
      if (!total) return "";
      return down ? `${total - down} of ${plural(total, "device", "devices")} online` : `${plural(total, "device", "devices")}, ${total === 1 ? "online" : "all online"}`;
    }
    if (key === "battery") {
      const { count, lowest } = sum.stats.batteries;
      return count ? `${plural(count, "battery", "batteries")}, lowest ${Math.round(lowest)}%` : "No batteries found";
    }
    const t = this._lastRunTime(), n = sum.counts.watchman, ex = sum.counts.watchmanExplained;
    return [Number.isFinite(t) ? `Checked ${since(t, false)}` : "", n ? `${n} missing` : ex ? "nothing else missing" : "nothing missing"].filter(Boolean).join(", ").replace(/^./, (c) => c.toUpperCase());
  }

  // one issue (an integration, a hub, a device, an entity) as a row
  _issueRow(is, depth, open) {
    const det = this._config.details;
    const age = Number.isFinite(is.since) ? duration(Date.now() - is.since) : "";
    const meta = det ? [is.area, is.integration].filter(Boolean).join(" · ") : "";
    const join = (...p) => p.filter(Boolean).join(" · ");
    const refs = is.refs ? `${plural(is.refs, "dashboard reference", "dashboard references")} broken` : "";
    const nav = () => navigate(`/config/devices/device/${is.id}`);
    if (is.kind === "integration") {
      const failed = is.state === "failed";
      const page = () => navigate(`/config/integrations/integration/${is.domain}`);
      return { type: "row", key: is.key, icon: "mdi:puzzle-remove-outline", alert: true, depth, expandable: is.total > 0, open, hold: page, go: page,
        name: is.name,
        secondary: join(failed ? is.label : "", is.total ? `${plural(is.total, "device", "devices")}${failed ? "" : " offline"}` : "", !failed && age && `offline for ${age}`, refs) };
    }
    if (is.kind === "hub") {
      const offline = is.state === "offline";
      return { type: "row", key: is.key, icon: "mdi:access-point-network-off", alert: true, depth, expandable: true, open, hold: nav,
        name: offline ? `${is.name} offline` : `All ${is.total} devices on ${is.name} are offline`,
        secondary: join(meta, offline ? plural(is.total, "device", "devices") : "", age && `offline for ${age}`, refs) };
    }
    if (is.kind === "device") {
      const down = is.state === "down";
      return { type: "row", key: is.key, icon: down ? "mdi:power-plug-off-outline" : "mdi:alert-circle-outline", alert: down, soft: !down, depth, expandable: true, open, hold: nav,
        name: is.name,
        secondary: down ? join(meta, age && `offline for ${age}`, is.down < is.total ? `${is.down} of ${is.total} entities` : is.total > 1 && plural(is.total, "entity", "entities"), refs)
          : join(meta, `${is.down} of ${is.total} entities unavailable`, refs) };
    }
    return { type: "row", key: is.key, icon: "mdi:alert-circle-outline", alert: true, depth, entity: is.entity, name: is.name,
      secondary: depth ? join(is.entity, refs) : join(age && `offline for ${age}`, is.entity, refs) };
  }

  _offlineRows(issues) {
    const out = [];
    const walk = (is, depth) => {
      const open = this._open.has(is.key);
      const row = this._issueRow(is, depth, open);
      if (!depth) row.dismiss = this._dismissOf("off", is.dismissId, is.name, is.members);
      out.push(row);
      if (!open) return;
      if (is.kind === "integration") is.devices.forEach((d) => walk(d, depth + 1));
      else if (is.kind === "hub") { is.entities.forEach((e) => walk(e, depth + 1)); is.devices.forEach((d) => walk(d, depth + 1)); }
      else if (is.kind === "device") is.entities.forEach((e) => walk(e, depth + 1));
    };
    issues.forEach((i) => walk(i, 0));
    return out;
  }

  // what the user has snoozed: one collapsed line under the offline issues, the items dim inside it
  _knownRows(known) {
    const items = [...known.devices, ...known.entities];
    if (!items.length) return [];
    const open = this._open.has("k:known");
    const out = [{ type: "row", key: "k:known", icon: "mdi:bell-sleep-outline", soft: true, depth: 0, expandable: true, open, name: `Known · ${items.length}`,
      secondary: known.refs ? `Snoozed in your settings · ${plural(known.refs, "dashboard reference", "dashboard references")} broken` : "Snoozed in your settings" }];
    if (open) for (const k of items) {
      const age = Number.isFinite(k.since) ? duration(Date.now() - k.since) : "";
      out.push(k.entity
        ? { type: "row", key: k.key, icon: "mdi:bell-sleep-outline", soft: true, depth: 1, entity: k.entity, name: k.name, secondary: [age && `offline for ${age}`, k.entity].filter(Boolean).join(" · ") }
        : { type: "row", key: k.key, icon: "mdi:bell-sleep-outline", soft: true, depth: 1, name: k.name, hold: () => navigate(`/config/devices/device/${k.id}`),
            secondary: [k.area, age && `offline for ${age}`, k.total > 1 && plural(k.total, "entity", "entities")].filter(Boolean).join(" · ") });
    }
    return out;
  }

  // the button on a row: null when the card has them off
  _dismissOf(kind, id, name, members) { return this._config.dismiss === false || !id ? null : { id, kind, name, members }; }
  _dismiss(d) { haptic("light"); dismissAdd(this._hass, d); }
  _restore(d) { haptic("light"); dismissRestore(this._hass, d.kind, d.members); }

  // what this person put aside, one collapsed line at the foot of its category; a row brings its issue back
  _dismissedRows(key, sum) {
    const items = key === "unavailable" ? sum.dismissed.offline : key === "battery" ? sum.dismissed.battery : sum.dismissed.watchman;
    if (!items.length) return [];
    const open = this._open.has(`dm:${key}`);
    const out = [{ type: "row", key: `dm:${key}`, icon: "mdi:bell-off-outline", soft: true, depth: 0, expandable: true, open, name: `Dismissed · ${items.length}`,
      secondary: "Hidden for you. They come back if they break again" }];
    if (!open) return out;
    const kind = key === "unavailable" ? "off" : key === "battery" ? "bat" : "wat";
    for (const it of items) {
      const age = Number.isFinite(it.since) ? duration(Date.now() - it.since) : "";
      const name = it.name, restore = { kind, members: it.members, name };
      if (kind === "off") out.push({ type: "row", key: `dm:${it.key}`, icon: "mdi:bell-off-outline", soft: true, depth: 1, name, restore,
        secondary: [it.area, age && `offline for ${age}`].filter(Boolean).join(" · ") });
      else if (kind === "bat") out.push({ type: "row", key: `dm:${it.entity}`, icon: "mdi:bell-off-outline", soft: true, depth: 1, entity: it.entity, name, value: it.value, restore });
      else out.push({ type: "row", key: `dm:${it.key}`, icon: "mdi:bell-off-outline", soft: true, depth: 1, entity: it.entity, name, secondary: it.secondary, restore });
    }
    return out;
  }

  _batteryRows(sum, all) {
    const det = this._config.details, h = this._hass;
    return (all ? sum.battery : sum.battery.filter((r) => r.alert)).map((r) => {
      const area = det ? entityArea(h, r.entity) : null;
      return { ...r, type: "row", secondary: area ? h.areas?.[area]?.name || title(area.replace(/_/g, " ")) : "", dismiss: r.alert ? this._dismissOf("bat", r.dismissId, r.name, r.members) : null };
    });
  }

  // The rows for this card's source; the pill counts exactly what the home cog counts.
  _compute() {
    const c = this._config, sum = healthSummary(this._hass, c), det = c.details, src = c.source;
    const watchRows = () => sum.watchman.map((r) => ({ ...r, type: "row", dismiss: this._dismissOf("wat", r.dismissId, r.name, r.members) }));
    const section = (key, rows, group) => {
      const out = [];
      if (group) out.push({ type: "group", key: `g:${key}`, title: GROUP_TITLE[key], line: this._line(key, sum) });
      if (det) out.push({ type: "facts", key: `f:${key}`, text: this._facts(key, sum) });
      const aside = sum.counts.dismissedBy[key];
      if (!sum.counts[key]) out.push({ type: "ok", key: `ok:${key}`, text: aside ? "Nothing else needs a look" : key === "watchman" && sum.counts.watchmanExplained ? "Nothing else missing" : ALL_FINE[key] });
      out.push(...rows, ...this._dismissedRows(key, sum));
      return out;
    };
    if (src === "watchman") return { total: sum.counts.watchman, sections: [{ key: "watchman", rows: section("watchman", watchRows(), false) }] };
    if (src === "unavailable") return { total: sum.counts.unavailable, sections: [{ key: "unavailable", rows: section("unavailable", [...this._offlineRows(sum.offline), ...this._knownRows(sum.known)], false) }] };
    if (src === "battery") return { total: sum.counts.battery, sections: [{ key: "battery", rows: section("battery", this._batteryRows(sum, c.show_all_batteries !== false), false) }] };
    // every category shows, with its issue line or a tick and what's fine
    const sections = [];
    if (sum.opts.watchman.length) sections.push({ key: "watchman", rows: section("watchman", watchRows(), true) });
    sections.push({ key: "unavailable", rows: section("unavailable", [...this._offlineRows(sum.offline), ...this._knownRows(sum.known)], true) });
    sections.push({ key: "battery", rows: section("battery", this._batteryRows(sum, false), true) });
    return { total: sum.total, sections };
  }

  _update() {
    const h = this._hass, c = this._config;
    if (!h || !this._root) return;
    this._reduced = MQ.reduced.matches;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    ensureDismissed(h);
    this._lastRun = c.source === "all" || c.source === "watchman" ? watchmanLastRun(h, c) : null;
    if (c.source === "all" || c.source === "unavailable") refreshConfigEntries(h);
    this._checkReport();
    const { total, sections } = this._compute();
    const label = SOURCES[c.source];
    const lvl = total === 0 ? "var(--lvl-good)" : total < c.warn_above ? "var(--lvl-warn)" : "var(--lvl-bad)";
    Motion.tintVar(this._el.card, "--lvl", lvl);
    // the corner glow: amber while a few things need a look, red when it is a lot; nothing when all is well
    stateGlow(c, this._el.card, total === 0 ? null : total < c.warn_above ? [232, 163, 61] : [224, 102, 102], 0.8);
    text(this._el.pill, total === 0 ? "All good" : `${total} ${total === 1 ? label.noun : label.nouns}`);
    attr(this._el.card, "aria-label", `${c.title || label.title}, ${total === 0 ? "all good" : `${total} ${label.nouns}`}`);
    this._renderRows(sections);
    this._placeReport();
    this._tickWhen();
    this._wake();
  }

  // ---------- the Watchman chip: run a new report ----------
  _reportShown() {
    const c = this._config, h = this._hass;
    return (c.source === "all" || c.source === "watchman") && c.watchman_button !== false && healthOptions(c).watchman.length > 0 && !!h?.services?.watchman?.report;
  }

  _placeReport() {
    const chip = this._el.report, show = this._reportShown();
    chip.hidden = !show;
    if (!show) return;
    const host = this._config.source === "watchman" ? this._el.head : this._rows.get("g:watchman");
    if (!host) { chip.hidden = true; return; }
    if (chip.parentNode !== host) host.insertBefore(chip, host === this._el.head ? this._el.pill : null);
    this._paintReport();
  }

  _paintReport() {
    const chip = this._el.report, running = !!this._rep, flash = !!this._flash;
    attr(chip, "data-running", running);
    attr(chip, "data-flash", flash);
    attr(chip, "aria-busy", String(running));
    attr(chip.querySelector("ha-icon"), "icon", running ? "mdi:loading" : flash ? "mdi:check" : "mdi:refresh");
    text(chip.querySelector("span"), running ? "Running…" : flash ? "Done" : "Run report");
    attr(chip, "role", "button");
    attr(chip, "tabindex", "0");
    attr(chip, "aria-label", running ? "Running the Watchman report" : "Run a new Watchman report");
    if (!running) put(chip.querySelector("ha-icon"), "transform", "");
  }

  _runReport() {
    if (this._rep || !this._reportShown()) return;
    const c = this._config;
    haptic("medium");
    this._hass.callService("watchman", "report", { parse_config: true, ...(c.watchman_report || {}) });
    this._rep = { start: Date.now(), base: this._lastRunTime() };
    this._flash = false;
    clearTimeout(this._flashTimer);
    clearTimeout(this._repTimer);
    this._repTimer = setTimeout(() => { this._rep = null; this._paintReport(); }, REPORT_TIMEOUT);
    this._paintReport();
    this._wake();
  }

  // done when Watchman's last-parse timestamp changes
  _checkReport() {
    if (!this._rep) return;
    const t = this._lastRunTime(), base = this._rep.base;
    if (!Number.isFinite(t) || (Number.isFinite(base) && t === base)) return;
    this._rep = null;
    clearTimeout(this._repTimer);
    this._flash = true;
    this._flashTimer = setTimeout(() => { this._flash = false; this._paintReport(); }, 2500);
    this._paintReport();
  }

  _node(r) {
    const node = document.createElement("div");
    if (r.type === "ok") {
      node.className = "empty ok";
      node.innerHTML = `<ha-icon icon="mdi:check-circle-outline"></ha-icon><span></span>`;
    } else if (r.type === "group") {
      node.className = "group";
      node.innerHTML = `<span class="gt"></span><span class="gw"></span>`;
    } else if (r.type === "facts") {
      node.className = "facts";
    } else {
      node.className = "row";
      node.innerHTML = `<span class="disc"><ha-icon></ha-icon></span><span class="col"><span class="n"></span><span class="s"></span></span><span class="v" hidden></span><ha-icon class="chev" icon="mdi:chevron-right" hidden></ha-icon><button class="x" hidden><ha-icon icon="mdi:bell-off-outline"></ha-icon></button>`;
      node.__el = { icon: node.querySelector(".disc ha-icon"), n: node.querySelector(".n"), s: node.querySelector(".s"), v: node.querySelector(".v"), chev: node.querySelector(".chev"),
        x: node.querySelector(".x"), xicon: node.querySelector(".x ha-icon") };
      node.__enter = new Spring(0, MOTION.ui, `row:${r.key}`).to(1, MOTION.ui);
      this._springs.push(node.__enter);
    }
    return node;
  }

  _renderRows(sections) {
    Motion.flip([this._el.cols, ...this._boxes.values()], () => this._renderRowsNow(sections));
  }

  _renderRowsNow(sections) {
    const seen = new Set(), liveBoxes = new Set();
    this._layoutCols(sections.length);
    sections.forEach((sec, bi) => {
      const box = this._box(sec.key);
      liveBoxes.add(sec.key);
      place(this._el.cols, box, bi);
      let at = 0;
      for (const r of sec.rows) {
        seen.add(r.key);
        let node = this._rows.get(r.key);
        if (!node) { node = this._node(r); this._rows.set(r.key, node); }
        if (r.type === "ok") text(node.querySelector("span"), r.text);
        else if (r.type === "group") { text(node.querySelector(".gt"), r.title); text(node.querySelector(".gw"), r.line); }
        else if (r.type === "facts") text(node, r.text);
        else this._fillRow(node, r);
        place(box, node, at++);
      }
    });
    for (const [key, node] of this._rows) {
      if (seen.has(key)) continue;
      for (const s of [node.__enter, node.__spring, node.__chev, node.__el?.x?.__spring]) { const i = this._springs.indexOf(s); if (i >= 0) this._springs.splice(i, 1); }
      for (const n of [node, node.__el?.x]) { const p = this._pressNodes.indexOf(n); if (p >= 0) this._pressNodes.splice(p, 1); }
      node.remove();
      this._rows.delete(key);
    }
    for (const [key, box] of this._boxes) {
      if (liveBoxes.has(key)) continue;
      this._ro.unobserve(box);
      box.remove();
      this._boxes.delete(key);
    }
    this._fit();
  }

  _fillRow(node, r) {
    node.__r = r;
    const el = node.__el;
    attr(el.icon, "icon", r.icon);
    text(el.n, r.name);
    text(el.s, r.secondary || "");
    el.s.hidden = !r.secondary;
    el.v.hidden = !r.value;
    if (r.value) text(el.v, r.value);
    attr(node, "title", r.tooltip || null);
    attr(node, "data-alert", r.alert);
    attr(node, "data-soft", r.soft);
    attr(node, "data-dim", r.dim);
    attr(node, "data-group-start", r.groupStart);
    attr(node, "data-depth", r.depth || null);
    el.chev.hidden = !r.expandable;
    // the button on the row: dismiss it, or (in the dismissed list) bring it back
    const act = r.dismiss || r.restore;
    el.x.hidden = !act;
    if (act) {
      attr(el.xicon, "icon", r.restore ? "mdi:bell-ring-outline" : "mdi:bell-off-outline");
      attr(el.x, "aria-label", r.restore ? `Bring back ${act.name}` : `Dismiss ${act.name}`);
      attr(el.x, "title", r.restore ? "Bring back" : "Dismiss");
      if (!el.x.__wired) {
        el.x.__wired = true;
        // its press is its own: the row under it does not dip or open
        el.x.addEventListener("pointerdown", (e) => e.stopPropagation());
        this._pressable(el.x, () => { const cur = node.__r; if (cur.restore) this._restore(cur.restore); else if (cur.dismiss) this._dismiss(cur.dismiss); });
      }
    }
    attr(node, "aria-expanded", r.expandable ? String(!!r.open) : null);
    if (r.expandable) {
      if (!node.__chev) {
        node.__chev = new Spring(r.open ? 1 : 0, MOTION.ui, `chev:${r.key}`);
        this._springs.push(node.__chev);
        put(el.chev, "transform", r.open ? "rotate(90deg)" : "");
        node.__open = !!r.open;
      } else if (node.__open !== !!r.open) {
        node.__open = !!r.open;
        node.__chev.to(r.open ? 1 : 0, MOTION.ui);
      }
    }
    const live = r.entity && this._hass.states[r.entity];
    if ((r.expandable || live || r.go) && !node.__wired) {
      node.__wired = true;
      attr(node, "role", "button");
      attr(node, "tabindex", "0");
      this._pressable(node, () => this._tapRow(node.__r), r.hold ? () => node.__r.hold?.() : null);
    }
  }

  _tapRow(r) {
    if (r.expandable) {
      if (this._open.has(r.key)) this._open.delete(r.key); else this._open.add(r.key);
      this._update();
    } else if (r.go) r.go();
    else if (r.entity) moreInfo(this, r.entity);
  }

  // Does a list scroll? Measured from where its rows sit, not from scrollHeight: a row that is
  // still sliding in is translated, which grows scrollHeight for a moment and would leave the
  // flag set once it has settled.
  _fit() {
    for (const box of this._boxes?.values() || []) {
      const first = box.firstElementChild, last = box.lastElementChild;
      const content = first ? last.offsetTop + last.offsetHeight - first.offsetTop : 0;
      attr(box, "data-overflow", content > box.clientHeight + 2);
    }
  }

  _wake() { if (this._root && this.isConnected) Clock.add(this._job); }

  _frame(dt) {
    const dirty = new Set();
    for (const s of this._springs) {
      if (s.idle) continue;
      if (this._reduced) s.snap(); else s.step(dt);
      dirty.add(s.group);
    }
    // the report chip's spinner turns while a report runs
    const spinning = !!this._rep && !this._reduced;
    if (spinning) {
      this._angle = (this._angle + dt * 400) % 360;
      put(this._el.report.querySelector("ha-icon"), "transform", `rotate(${this._angle.toFixed(1)}deg)`);
    }
    if (!dirty.size) return spinning;
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
      if (s && dirty.has(`row:${key}`)) {
        const v = clamp(s.x);
        put(node, "opacity", v > 0.999 ? "" : v.toFixed(3));
        put(node, "translate", red || v > 0.999 ? "" : `0 ${((1 - v) * 4).toFixed(2)}px`);
      }
      const c = node.__chev;
      if (c && dirty.has(`chev:${key}`)) put(node.__el.chev, "transform", `rotate(${(90 * clamp(c.x)).toFixed(1)}deg)`);
    }
  }
}

const EDITOR = defineEditor("savvy-system-health-card", (hass, c) => [
  S.select("source", "List", [
    { value: "all", label: "Everything (Watchman, offline devices, low batteries)" },
    { value: "battery", label: "Batteries" }, { value: "unavailable", label: "Offline devices" }, { value: "watchman", label: "Watchman" },
  ]),
  S.grid(S.text("title", "Title"), S.titleLink("title")),
  S.grid(S.number("battery_threshold", "Battery alert", 1, 100, 1, "%"), S.number("warn_above", "Red threshold", 1, 99)),
  S.number("max_rows", "Max rows", 3, 30),
  { name: "columns", label: "Columns", helper: "Side by side when the card is wide: one column per category. Empty: automatic. 1 keeps them stacked.",
    selector: { number: { min: 1, max: 4, step: 1, mode: "box" } } },
  S.bool("dismiss", "Dismiss button", "A button on each health row that puts it aside for you: it leaves the count and waits under Dismissed, and comes back if it breaks again. Off hides the buttons.", true),
  S.bool("details", "Show details", "A line of facts under each section (how many devices, the lowest battery, when Watchman checked), and area and integration on the rows."),
  S.select("group_by", "Grouping", [
    { value: "hub", label: "Device, and the hub behind it" }, { value: "device", label: "Device" }, { value: "none", label: "Nothing: one row per entity" },
  ]),
  S.number("group_min", "Hub threshold", 2, 50),
  { type: "expandable", name: "ignore", title: "Known problems", schema: [
    { name: "devices", label: "Devices", helper: "Dead and waiting for a replacement? Listed here they leave the count and wait under Known.", selector: { device: { multiple: true } } },
    { name: "entities", label: "Entities", selector: { entity: { multiple: true } } },
  ] },
  { name: "exclude_platforms", label: "Ignored integrations", helper: "By integration, e.g. mobile_app for phones.",
    selector: { select: { multiple: true, custom_value: true, options: ["mobile_app"] } } },
  { name: "watchman", label: "Watchman sensors", helper: "Watchman's missing-entities and missing-actions sensors.",
    selector: { entity: { multiple: true, domain: "sensor" } } },
  S.bool("watchman_button", "Run report chip", "A chip in the Watchman section that runs a new report. Needs the Watchman integration.", true),
  { name: "watchman_report", label: "Report options", helper: "Data sent to watchman.report. Default: parse_config: true.", selector: { object: {} } },
  { name: "watchman_last_run", label: "Last run sensor", helper: "Found automatically (Watchman's last parse). Pick another to override.",
    selector: { entity: { domain: "sensor", device_class: "timestamp" } } },
  ...(c.source === "battery" ? [S.bool("show_all_batteries", "All batteries", "Low ones first, the rest dimmed.")] : []),
  // nested under `action`: ha-form's expandable with a name keeps its fields in that key
  { type: "expandable", name: "action", title: "Footer button", schema: [
    { name: "label", label: "Label", selector: { text: {} } },
    { name: "tap_action", label: "Action", helper: "Off unless you pick an action.", selector: { ui_action: {} } },
  ] },
], tidyFooter);

registerCard("savvy-system-health-card", SavvySystemHealthCard, "System health",
  "What needs attention: offline devices (grouped by device, hub and integration), low batteries and Watchman's findings, with a count.");
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
//   control: input_select.kitchen_scene    toggle: switch.kitchen_lights (optional)
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
  ha-card { --well-size: var(--b-l); --gap: 12px; --chip: var(--b-s); --tint: 245 184 61;
    display: flex; flex-direction: column; gap: 4px; padding: var(--pad); overflow: hidden; cursor: pointer;
    user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: manipulation; outline: none; }
  :host([dark]) ha-card::after { z-index: 2; }
  @media (hover: hover) { ha-card:hover { background: color-mix(in oklab, var(--primary-text-color) 2.5%, var(--ha-card-background, var(--card-background-color))); } }
  :host([kbd]) ha-card:focus-visible { outline: 2px solid rgb(var(--tint)); outline-offset: 2px; }

  /* light spilling from the drop into the card; only ever seen when a switch happens */
  .spill { position: absolute; z-index: 0; inset-inline-start: calc(var(--pad) + var(--well-size) / 2); top: calc(var(--pad) + var(--well-size) / 2);
    width: 320px; height: 320px; margin: -160px 0 0 -160px; border-radius: 50%; pointer-events: none; opacity: 0;
    background: radial-gradient(closest-side, rgb(var(--tint) / 0.9), rgb(var(--tint) / 0.42) 13%, rgb(var(--tint) / 0.16) 30%, rgb(var(--tint) / 0.05) 54%, rgb(var(--tint) / 0)); }
  :host([dark]) .spill { mix-blend-mode: plus-lighter; }
  .top { position: relative; z-index: 1; display: flex; align-items: center; gap: var(--gap); min-width: 0; }
  .well { position: relative; flex: none; width: var(--well-size); height: var(--well-size); display: grid; place-items: center; }
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
  @container (min-width: 300px) { .badges { padding-inline-start: calc(8px + var(--well-size) + var(--gap)); } }
  .badge { position: relative; flex: none; width: 0; height: var(--chip); outline: none; }
  .chip { position: absolute; top: 0; inset-inline-start: 0; width: var(--chip); height: var(--chip); border-radius: 50%;
    display: grid; place-items: center; color: var(--secondary-text-color); opacity: 0; }
  .chip::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: color-mix(in oklab, var(--bc) 22%, transparent); opacity: 0; }
  .badge[data-critical] .chip::before { opacity: var(--on, 0); }
  :host([kbd]) .badge:focus-visible .chip { box-shadow: 0 0 0 2px rgb(var(--tint)); }
  .chip ha-icon, .chip savvy-state-icon { --mdc-icon-size: 18px; position: relative; display: flex; }
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

  _modeInfo() { return this._hass && modeInfo(this._hass, controlOf(this._config).entity, this._config); }

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
      list: () => this._showList(this._name(), this._lights(), `rgb(${this._tint().join(" ")})`, card, null, { bulk: "lights" }) });
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
    line(this._el.mode, () => controlOf(this._config).entity);
    line(this._el.temp, () => this._temp?.entity);
    this._swap = new Swap(this._el.swap, (v) => {
      const info = this._modeInfo();
      text(this._el.label, info?.label || v);
      Motion.tintVar(this._el.mode, "--mode", info?.color || "");
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
    if (info) { attr(el.mode, "aria-label", info.kind === "control" ? info.label : `${info.label} mode`); this._swap.set(info.value); }

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
        node.innerHTML = `<span class="halo"></span><span class="chip">${look.icon ? "<ha-icon></ha-icon>" : "<savvy-state-icon></savvy-state-icon>"}</span>`;
        const group = `badge:${b.key}`;
        item = { el: node, chip: node.querySelector(".chip"), halo: node.querySelector(".halo"), icon: node.querySelector("ha-icon, savvy-state-icon"),
          shown: this._spring(0, MOTION.ui, group, 0.002), on: this._spring(0, MOTION.ui, group, 0.002),
          glow: this._spring(0, TILE_MOTION.halo, group), press: this._spring(0, MOTION.press, group), b };
        // a badge tap is its own: it never also taps the card
        node.addEventListener("pointerdown", (e) => e.stopPropagation());
        const act = (kind) => () => {
          const cur = item.b, cfgA = cur.cfg[`${kind}_action`];
          // the room's toggle, tapped: the same optimistic switch as the card's double tap
          if (kind === "tap" && cur.entity === this._config.toggle && cfgA === undefined) return this._toggleLights();
          runAction(this, this._hass, cfgA !== undefined ? cfgA : badgeDefaults(cur)[kind], { entity: cur.entity,
            list: () => this._showList(cur.kind?.name || shortName(this._hass, cur.entity), cur.ids, badgeLook(cur).color, node, null, { bulk: "auto" }) });
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
      attr(item.el, "aria-label", `${b.cfg.name || shortName(h, b.entity, c.area)}, ${chipState(h, st)}`);
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
    // the card's corner glow follows the drop: its colour, its brightness (the shared state glow, off with state_glow: false)
    put(e.card, "--glow-rgb", tint.join(" "));
    put(e.card, "--glow", this._config.state_glow === false ? "0" : (I * 0.85).toFixed(3));
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
  S.nav("navigation_path", "Target page", "Empty: tapping lists the room's lights."),
  ...modeSchema(hass, c, { helper: "Shown under the name, read only: a select's mode, or any entity's state. Empty hides it.", actions: false }),
  { name: "temperature", label: "Temperature", helper: "Found from the area. Pick another to override.", selector: { entity: { domain: ["sensor", "climate"] } } },
  S.section("Lights", [
    { name: "toggle", label: "Toggle entity", helper: "Empty: a double tap turns the room's lights off (or on). A helper here is what switches instead.", selector: { entity: {} } },
    { name: "lights", label: "Lights", helper: "Found from the area. Pick to use only these.", selector: { entity: { domain: "light", multiple: true } } },
    { name: "count", label: "Count sensor", helper: "A sensor with the number of lights on, instead of counting.", selector: { entity: { domain: "sensor" } } },
    { name: "color_lights", label: "Colour lights", helper: "Lights whose colour tints the drop. Empty: any of the room's lights.", selector: { entity: { domain: "light", multiple: true } } },
    S.color("tint", "White tint"),
  ]),
  ...badgeSchema(),
  S.section("Actions", [S.action("tap_action", "Tap action"), S.action("double_tap_action", "Double tap action"), S.action("hold_action", "Hold action")]),
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

const COLORS = { accent: "#5BA3D9", warn: TONE.warn, alert: TONE.bad, good: TONE.good };

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
${GLOW_CSS}

ha-card {
  --radius: var(--ha-card-border-radius, 18px);
  --pad: 14px;
  --well: color-mix(in oklab, var(--primary-text-color) 6%, transparent);
  --line: color-mix(in oklab, var(--primary-text-color) 9%, transparent);
  --acc: var(--savvy-vacuum-accent, ${COLORS.accent});
  --warn-c: ${COLORS.warn};
  --alert-c: ${COLORS.alert};
  --accent: 91 163 217;
  ${DESIGN_TOKENS}
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
ha-icon, savvy-state-icon { display: flex; align-items: center; justify-content: center; line-height: 0; }

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
.tile > ha-icon { flex: none; width: var(--b-s); height: var(--b-s); border-radius: 50%; background: var(--well); color: var(--secondary-text-color); }
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
    linkTitle(this._root, this._el.name, titlePathOf(this._config), (el, onTap) => this._press(el, onTap, { haptic: null }));
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
    text(el.name, c.name || c.title || st?.attributes.friendly_name || "Vacuum");

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
    // the glow: red for a problem, amber for a warning, the accent while it works; nothing when it rests
    const glowLevel = worst && !this._expect ? worst.level : null;
    stateGlow(c, el.card, glowLevel === "alert" ? [224, 102, 102] : glowLevel === "warn" ? [232, 163, 61] : cleaning || act === "returning" ? [91, 163, 217] : null, glowLevel ? 0.9 : 0.7);
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
    navigate(path);
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
    S.titleLink("name"),
    S.grid(S.text("name", "Name"), S.select("layout", "Layout", [{ value: "full", label: "Full" }, { value: "compact", label: "Compact (one row)" }])),
    S.entity("start", "Start action", null, { helper: "A button, script or scene (e.g. an app routine). Empty: the vacuum's own start. Resume after a pause is always a real resume." }),
    S.text("start_name", "Start label"),
    S.nav("navigation_path", "Target page", "Where tapping the name goes."),
    S.section("Parts", [
      { name: "map", label: "Map", helper: "Popup adds a Map button; inline shows it in the card. Or pick an image/camera entity.",
        selector: { select: { mode: "dropdown", custom_value: true, options: [
          { value: "popup", label: "Popup (a Map button)" }, { value: "inline", label: "In the card" }, { value: "off", label: "Hidden" }] } } },
      S.number("map_max_height", "Map height", 120, 1200, 10, "px"),
      part("rooms", "Rooms", "Your areas when mapped, else the robot's own rooms. A custom list is YAML: rooms: [kitchen, …]"),
      part("routines", "Routines", "Your app routines. A custom list is YAML: routines: [{entity, name, icon}]"),
      part("modes", "Modes"), part("dock", "Dock"), part("maintenance", "Maintenance"), part("stats", "Statistics"),
      { name: "hide_modes", label: "Hidden modes", selector: { select: { multiple: true, custom_value: true, options: [] } } },
      { name: "exclude", label: "Exclude", selector: { entity: { multiple: true } } },
    ]),
    S.grid(S.number("battery_warn", "Battery warning", 1, 100, 1, "%"), S.number("battery_critical", "Battery critical", 1, 100, 1, "%")),
  ];
});

registerCard("savvy-vacuum-card", VacuumCard, "Vacuum",
  "Any robot vacuum: live job, map, rooms in order, routines, modes, dock and maintenance, found from the device.");
})();

console.info(`%c SAVVY CARDS %c ${SAVVY_VERSION} `, "color:#fff;background:#588ee9;font-weight:700;border-radius:4px 0 0 4px;padding:2px 4px",
  "color:#588ee9;background:transparent;border:1px solid #588ee9;border-radius:0 4px 4px 0;padding:1px 4px");
})();
