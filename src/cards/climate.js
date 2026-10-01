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
      ? { name: "entity", label: "Unit", selector: { select: { mode: "dropdown", options: found.map((id) => ({ value: id, label: hass.states[id].attributes.friendly_name || id })) } } }
      : S.entity("entity", "Climate entity", "climate"),
    S.grid(S.text("name", "Name"), S.select("layout", "Layout", [{ value: "full", label: "Full" }, { value: "compact", label: "Compact" }])),
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
