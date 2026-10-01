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
  S.grid(S.bool("show_header", "Show header", null, true), S.bool("show_toggle", "Show pill", null, true)),
  { type: "expandable", name: "toggle", title: "On/off pill", schema: [
    { name: "entity", label: "Pill entity", helper: "Empty: the pill turns this card's lights on and off. An entity (e.g. a room helper): tap toggles it, double tap turns every light off.", selector: { entity: {} } },
    { type: "grid", name: "", schema: [{ name: "name", label: "Name", selector: { text: {} } }, { name: "icon", label: "Icon", selector: { icon: {} } }] },
    { name: "tap_action", label: "Tap action", selector: { ui_action: {} } },
    { name: "double_tap_action", label: "Double tap action", selector: { ui_action: {} } },
    { name: "hold_action", label: "Hold action", selector: { ui_action: {} } },
  ] },
  { name: "order", label: "Order", type: "list", helper: "Drag order with the arrows. Lights not listed follow, by name.",
    initial: (h, cfg) => (h ? lightsOf(h, cfg) : []), add: { selector: { entity: { domain: "light" } }, label: "Add a light" } },
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
