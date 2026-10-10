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

// design: glass. Frosted glass, not a copy of anyone's: one sheet per surface, and nothing stacked on it.
//   body    the backdrop blurred and a little saturated, under a semi-transparent tint (so text always reads)
//   grain   a fine, static noise over the body: frosted material rather than a smeared screenshot, no banding
//   edge    a 1px border brighter where the light falls (top-left) and fading to almost nothing opposite,
//           one hairline highlight along the top, one soft shadow under the card
//   inside  rows are flat areas a few percent lighter: no rims, gradients or shadows of their own
//   light   a lit lamp throws one faint wash of its colour from its icon (--lx --ly), and nothing more
// The body, grain and edge are one layered background (`--g-bg`), so a card, a popup and a menu share it.
const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='.33 .33 .33 0 0 .33 .33 .33 0 0 .33 .33 .33 0 0 0 0 0 0 .07'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;
const glassVars = (dark, d = 0) => dark ? `
    --g-bg: ${GRAIN} padding-box,
      linear-gradient(180deg, rgb(255 255 255 / 0.06), rgb(255 255 255 / 0.025)) padding-box,
      linear-gradient(rgb(20 22 30 / ${0.46 + d}), rgb(20 22 30 / ${0.46 + d})) padding-box,
      linear-gradient(155deg, rgb(255 255 255 / 0.26), rgb(255 255 255 / 0.08) 32%, rgb(255 255 255 / 0.03) 66%, rgb(255 255 255 / 0.07)) border-box;
    --g-shadow: inset 0 1px 0 rgb(255 255 255 / 0.07), 0 18px 40px -22px rgb(0 0 0 / 0.65), 0 2px 6px -2px rgb(0 0 0 / 0.25);
    --g-filter: blur(24px) saturate(1.35);
    --glass-tile: rgb(255 255 255 / 0.05);
    --glass-tile-shadow: none;
    --lblend: plus-lighter;` : `
    --g-bg: ${GRAIN} padding-box,
      linear-gradient(180deg, rgb(255 255 255 / ${0.62 + d}), rgb(255 255 255 / ${0.5 + d})) padding-box,
      linear-gradient(155deg, rgb(255 255 255 / 0.95), rgb(255 255 255 / 0.55) 40%, rgb(24 28 48 / 0.08) 100%) border-box;
    --g-shadow: inset 0 1px 0 rgb(255 255 255 / 0.9), 0 16px 36px -20px rgb(40 50 90 / 0.3), 0 2px 6px -2px rgb(40 50 90 / 0.1);
    --g-filter: blur(24px) saturate(1.3);
    --glass-tile: rgb(255 255 255 / 0.45);
    --glass-tile-shadow: none;
    --lblend: normal;`;
const glassSurface = (R, darkSel, lightSel, d = 0) => `
  ${R} { ${glassVars(true, d)}
    background: var(--g-bg); border: 1px solid transparent;
    -webkit-backdrop-filter: var(--g-filter); backdrop-filter: var(--g-filter); box-shadow: var(--g-shadow); }
  ${lightSel} { ${glassVars(false, d)} }
  @media (prefers-reduced-transparency: reduce) { ${R} { -webkit-backdrop-filter: none; backdrop-filter: none; background: var(--ha-card-background, var(--card-background-color, #fff)); } }
`;
const GLASS_LIT = (R) => `
  ${R} [data-light] { --lx: 28px; --ly: 50%; position: relative; isolation: isolate; background: var(--glass-tile); box-shadow: var(--glass-tile-shadow); }
  ${R} [data-light]::before, ${R}[data-light]::before {
    content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit; corner-shape: inherit; pointer-events: none;
    background: radial-gradient(ellipse 120% 220% at var(--lx) var(--ly), rgb(var(--lc, 128 128 128) / 0.2), rgb(var(--lc, 128 128 128) / 0.06) 45%, transparent 80%);
    mix-blend-mode: var(--lblend); opacity: var(--on, 0); transition: opacity 360ms ease;
  }
  ${R}[data-light] { --lx: 28px; --ly: 50%; }
`;
const GLASS_CSS = `${glassSurface('ha-card[data-glass]', '', ':host(:not([dark])) ha-card[data-glass]')}
  ${GLASS_LIT('ha-card[data-glass]')}
`;

// design: matte. A solid, flat material, the opposite of glass: one opaque plane per card in the theme's own card
// colour, a faint paper grain, a hairline edge and a quiet lift under it. Rows inside are flat areas a step
// lighter, with no outlines; nothing is ringed, bevelled or glowing. A lit lamp paints one wash of its colour
// (chroma capped, so amber, green and blue sit in one family) from its icon, and nothing more.
const MATTE_GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='.33 .33 .33 0 0 .33 .33 .33 0 0 .33 .33 .33 0 0 0 0 0 0 .045'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;
const matteVars = (dark) => dark ? `
    --m-base: var(--card-background-color, #1c1c1e);
    --m-card: color-mix(in oklab, var(--m-base) 97%, #fff);
    --m-tile-bg: color-mix(in oklab, var(--m-base) 92%, #fff);
    --m-edge: rgb(255 255 255 / 0.07);
    --m-lift: 0 1px 2px rgb(0 0 0 / 0.28), 0 12px 28px -20px rgb(0 0 0 / 0.6);` : `
    --m-base: var(--card-background-color, #fff);
    --m-card: color-mix(in oklab, var(--m-base) 96%, #e6dfd2);
    --m-tile-bg: color-mix(in oklab, var(--m-base) 45%, #fff);
    --m-edge: rgb(60 50 30 / 0.09);
    --m-lift: 0 1px 2px rgb(60 50 30 / 0.07), 0 10px 24px -18px rgb(60 50 30 / 0.26);`;
const matteSurface = (R, lightSel) => `
  ${R} { ${matteVars(true)} background: ${MATTE_GRAIN}, var(--m-card); border: 1px solid var(--m-edge); box-shadow: var(--m-lift); }
  ${lightSel} { ${matteVars(false)} }
`;
const MATTE_LIT = (R) => `
  ${R} [data-light], ${R}[data-light] { --lx: 28px; --ly: 50%; --mc: color-mix(in oklab, rgb(var(--lc, 128 128 128)) 72%, #8a8a8a); }
  ${R} [data-light] { position: relative; isolation: isolate; background: var(--m-tile-bg); box-shadow: none; }
  ${R} [data-light]::before, ${R}[data-light]::before {
    content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit; corner-shape: inherit; pointer-events: none;
    background: radial-gradient(ellipse 130% 240% at var(--lx) var(--ly), color-mix(in srgb, var(--mc) 24%, transparent), color-mix(in srgb, var(--mc) 8%, transparent) 45%, transparent 85%);
    opacity: var(--on, 0); transition: opacity 360ms ease;
  }
`;
const MATTE_CSS = `${matteSurface('ha-card[data-matte]', ':host(:not([dark])) ha-card[data-matte]')}
  ${MATTE_LIT('ha-card[data-matte]')}
`;
const DESIGN_CSS = `${GLASS_CSS}${MATTE_CSS}`;

// The CSS every card shares: host basics, the card surface, focus rings.
const BASE_CSS = `${ROLL_CSS}${GLOW_CSS}${DESIGN_CSS}
  :host { display: block; -webkit-tap-highlight-color: transparent; }
  [hidden] { display: none !important; }
  button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0;
    cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent; }
  ha-card {
    --radius: var(--ha-card-border-radius, 18px);
    --pad: 16px;
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
// Grid heights. In a sections view Home Assistant lays cards on rows of 56px with 8px between; a card
// that sizes itself ("rows: auto") ends wherever its content ends, so two cards side by side that are
// nearly the same height end a few pixels apart. Every Savvy card rounds its height up to whole rows,
// so neighbours line up. Only inside a sections grid (it defines --row-height), never for a card given
// a number of rows (Home Assistant sizes those), and `grid_snap: false` turns it off.
// A card as wide as its section has no neighbour to end with: rounding it up would only add empty space.
// The grid is the nearest ancestor (across shadow roots) laid out as one; none found, the card snaps.
function aloneInRow(host) {
  let n = host;
  for (let i = 0; i < 8 && n; i++) {
    const p = n.parentElement || n.getRootNode?.()?.host;
    if (!p) return false;
    const cs = getComputedStyle(p);
    if (cs.display === "grid" || cs.display === "inline-grid") {
      const inner = p.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
      return inner > 0 && n.getBoundingClientRect().width >= inner - 1;
    }
    n = p;
  }
  return false;
}
function snapToGrid(host) {
  const card = host.shadowRoot?.querySelector("ha-card");
  if (!card) return;
  const cs = getComputedStyle(host);
  const row = parseFloat(cs.getPropertyValue("--row-height")), gap = parseFloat(cs.getPropertyValue("--row-gap"));
  const rows = host._config?.grid_options?.rows ?? host.getGridOptions?.()?.rows;
  const off = !Number.isFinite(row) || row <= 0 || typeof rows === "number" || host._config?.grid_snap === false || aloneInRow(host);
  const prev = card.style.minHeight;
  if (off) { if (prev) card.style.minHeight = ""; return; }
  // the natural height, measured without our own floor; putting the same value back reports no resize
  card.style.minHeight = "";
  const natural = card.offsetHeight;
  if (!natural) { card.style.minHeight = prev; return; }
  const step = row + (Number.isFinite(gap) ? gap : 8);
  const snapped = Math.ceil((natural + step - row - 0.5) / step) * step - (step - row);
  card.style.minHeight = `${Math.max(natural, snapped)}px`;
}
function wireGridSnap(cls) {
  const proto = cls.prototype;
  if (proto.__gridSnap) return;
  proto.__gridSnap = true;
  const connect = proto.connectedCallback, disconnect = proto.disconnectedCallback;
  proto.connectedCallback = function () {
    connect?.call(this);
    if (this.__snapRo) return;
    let card = null;
    const seen = new WeakSet();
    const ro = this.__snapRo = new ResizeObserver(() => {
      // the card builds its shadow DOM when it gets hass: follow whichever ha-card is there now
      const now = this.shadowRoot?.querySelector("ha-card") || null;
      if (now !== card) { if (card) ro.unobserve(card); card = now; if (card) ro.observe(card); }
      // content that shrinks inside a card held at its rows doesn't resize the card: watch the content too
      for (const child of card?.children || []) if (!seen.has(child)) { seen.add(child); ro.observe(child); }
      snapToGrid(this);
    });
    ro.observe(this);
  };
  proto.disconnectedCallback = function () {
    disconnect?.call(this);
    this.__snapRo?.disconnect();
    this.__snapRo = null;
  };
}

const registerCard = (type, cls, name, description) => {
  wireGridSnap(cls);             // whole grid rows, so cards side by side end together
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
