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

// design: glass. A frosted surface, and anything marked data-light is a light source (lit(el, rgb, level) sets
// --lc, --on). The source sits at --lx --ly (the icon). A broad ambient bleed falls off with distance, a tighter
// core gives depth, and a rim light brightens the edge nearest the source. The colour mixes additively
// (plus-lighter) so it shows on pure black too: a lit tile is a faintly lifted matte surface for it to land on.
const GLASS_LIT = (R, L = ':host(:not([dark])) ' + R) => `
  ${R} [data-light] { --lx: 28px; --ly: 50%; position: relative; isolation: isolate; background: var(--glass-tile); box-shadow: inset 0 0 0 1px var(--glass-tile-edge); }
  ${L} [data-light] { box-shadow: inset 0 0 0 1px var(--glass-tile-edge), 0 1px 3px rgb(40 50 90 / 0.08); }
  ${R} [data-light]::before, ${R}[data-light]::before {
    content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit; corner-shape: inherit; pointer-events: none;
    background:
      radial-gradient(circle 34px at var(--lx) var(--ly), rgb(var(--lc, 128 128 128) / 0.34), transparent),
      radial-gradient(ellipse 150% 260% at var(--lx) var(--ly), rgb(var(--lc, 128 128 128) / 0.25), rgb(var(--lc, 128 128 128) / 0.1) 34%, rgb(var(--lc, 128 128 128) / 0.03) 66%, transparent 100%);
    mix-blend-mode: var(--lblend); opacity: var(--on, 0); transition: opacity 360ms ease;
  }
  ${R}[data-light] { --lx: 28px; --ly: 50%; }
  ${R} [data-light]::after, ${R}[data-light]::after {
    content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit; corner-shape: inherit; padding: 1px; pointer-events: none;
    background: radial-gradient(circle 170px at var(--lx) var(--ly), rgb(var(--lc, 128 128 128) / 0.58), rgb(var(--lc, 128 128 128) / 0.17) 42%, transparent 100%);
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
    mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
    mix-blend-mode: var(--lblend); opacity: var(--on, 0); transition: opacity 360ms ease;
  }
`;
const GLASS_CSS = `
  ha-card[data-glass] {
    --glass-tint: rgb(255 255 255 / 0.03); --glass-edge: rgb(255 255 255 / 0.12); --glass-hi: rgb(255 255 255 / 0.18);
    --glass-tile: rgb(255 255 255 / 0.075); --glass-tile-edge: rgb(255 255 255 / 0.09); --lblend: plus-lighter;
    background: linear-gradient(155deg, rgb(255 255 255 / 0.07), var(--glass-tint) 55%, rgb(255 255 255 / 0.01)), linear-gradient(rgb(0 0 0 / 0.26), rgb(0 0 0 / 0.26));
    -webkit-backdrop-filter: blur(26px) saturate(1.6); backdrop-filter: blur(26px) saturate(1.6);
    border-color: var(--glass-edge);
    box-shadow: inset 0 1px 0 var(--glass-hi), 0 12px 32px rgb(0 0 0 / 0.28);
  }
  :host(:not([dark])) ha-card[data-glass] {
    --glass-tint: rgb(255 255 255 / 0.28); --glass-edge: rgb(255 255 255 / 0.75); --glass-hi: rgb(255 255 255 / 0.95);
    --glass-tile: rgb(255 255 255 / 0.72); --glass-tile-edge: rgb(255 255 255 / 0.85); --lblend: normal;
    background: linear-gradient(155deg, rgb(255 255 255 / 0.48), var(--glass-tint) 60%, rgb(255 255 255 / 0.2));
    box-shadow: inset 0 1px 0 var(--glass-hi), 0 10px 28px rgb(40 50 90 / 0.14);
  }
  ${GLASS_LIT('ha-card[data-glass]')}
  @media (prefers-reduced-transparency: reduce) {
    ha-card[data-glass] { -webkit-backdrop-filter: none; backdrop-filter: none; background: var(--ha-card-background, var(--card-background-color)); }
  }
`;

// design: matte. The same tiles and lights as glass, in a solid, tactile material: opaque surfaces derived from
// the theme's card colour, raised tiles with a top highlight and a soft neutral shadow, controls that sit pressed
// in while on. A lit tile is painted, not lit: the state colour (chroma capped, so amber, green and blue sit in one
// family) is a wash strongest at the icon, with a thin coloured edge on the icon's side. No blur, no glow, no
// transparency.
const MATTE_VARS_DARK = `
    --m-base: var(--card-background-color, #1c1c1e); --m-tile-hi: 7%; --m-wash: 1;
    --m-tile-bg: linear-gradient(180deg, color-mix(in oklab, var(--m-base) 91%, #fff), color-mix(in oklab, var(--m-base) 94%, #fff));
    --m-tile-shadow: inset 0 1px 0 rgb(255 255 255 / 0.07), inset 0 -1px 0 rgb(0 0 0 / 0.28), 0 5px 10px -5px rgb(0 0 0 / 0.6);
    --m-disc: inset 0 1px 0 rgb(255 255 255 / 0.09), inset 0 -1px 2px rgb(0 0 0 / 0.3);
    --m-ctl: inset 0 1px 0 rgb(255 255 255 / 0.07), 0 2px 4px -1px rgb(0 0 0 / 0.4);
    --m-press: inset 0 2px 4px rgb(0 0 0 / 0.38);`;
const MATTE_VARS_LIGHT = `
    --m-base: var(--card-background-color, #fff);
    --m-tile-bg: linear-gradient(180deg, #fff, #fbfaf8);
    --m-tile-shadow: inset 0 1px 0 #fff, 0 0 0 1px rgb(60 50 30 / 0.06), 0 4px 10px -4px rgb(60 50 30 / 0.18);
    --m-disc: inset 0 1px 0 #fff, inset 0 -1px 2px rgb(60 50 30 / 0.12);
    --m-ctl: inset 0 1px 0 #fff, 0 1px 3px rgb(60 50 30 / 0.16);
    --m-press: inset 0 2px 4px rgb(60 50 30 / 0.18);`;
const MATTE_LIT = (R, L = ':host(:not([dark])) ' + R) => `
  ${R} [data-light], ${R}[data-light] { --lx: 28px; --ly: 50%; --mc: color-mix(in oklab, rgb(var(--lc, 128 128 128)) 72%, #8a8a8a); }
  ${R} [data-light] { position: relative; isolation: isolate; background: var(--m-tile-bg); box-shadow: var(--m-tile-shadow); }
  ${R} [data-light]::before, ${R}[data-light]::before {
    content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit; corner-shape: inherit; pointer-events: none;
    background: radial-gradient(ellipse 150% 260% at var(--lx) var(--ly), color-mix(in srgb, var(--mc) 30%, transparent), color-mix(in srgb, var(--mc) 12%, transparent) 40%, color-mix(in srgb, var(--mc) 3%, transparent) 78%, transparent 100%);
    opacity: var(--on, 0); transition: opacity 360ms ease;
  }
  ${R} [data-light]::after, ${R}[data-light]::after {
    content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit; corner-shape: inherit; padding: 1px; pointer-events: none;
    background: radial-gradient(circle 170px at var(--lx) var(--ly), color-mix(in srgb, var(--mc) 55%, transparent), color-mix(in srgb, var(--mc) 14%, transparent) 50%, transparent 100%);
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
    mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
    opacity: var(--on, 0); transition: opacity 360ms ease;
  }
  ${R} :is(.orb, .av, .disc, .sv-ic, .row .icon, .ic) { box-shadow: var(--m-disc); }
  ${R} :is(.power, .step, .ctl, .tb.solid, .swatch, .master, .sv-close) { box-shadow: var(--m-ctl); }
  ${R} :is(.power, .tb, .btn, .master)[data-on] { box-shadow: var(--m-press), inset 0 0 0 1px color-mix(in oklab, currentColor 18%, transparent); }
`;
const MATTE_CSS = `
  ha-card[data-matte] {
    ${MATTE_VARS_DARK}
    background: linear-gradient(180deg, color-mix(in oklab, var(--m-base) 95%, #fff), var(--m-base) 72%);
    border-color: color-mix(in oklab, #fff 6%, transparent);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.06), 0 12px 26px -12px rgb(0 0 0 / 0.65), 0 1px 2px rgb(0 0 0 / 0.35);
  }
  :host(:not([dark])) ha-card[data-matte] {
    ${MATTE_VARS_LIGHT}
    background: linear-gradient(180deg, color-mix(in oklab, var(--m-base) 98%, #fff), color-mix(in oklab, var(--m-base) 95%, #e8e0d4));
    border-color: rgb(60 50 30 / 0.07);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.9), 0 12px 24px -12px rgb(60 50 30 / 0.22), 0 1px 2px rgb(60 50 30 / 0.1);
  }
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
