// savvy-snapshot-card: a security glance at one room. Is anything happening here, and
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
// With an alarm (found by itself; `alarm: false` for none), an open door or window while
// armed, or presence while armed away, turns amber: the only time they borrow a hue.
//
// Swipe the card left for its history: a lane per presence / door / window sensor over
// the room's temperature, for 6 h / 24 h / 3 d; scrubbing snaps onto the nearest change,
// so "when did the door open" has an exact answer.
//
//   type: custom:savvy-snapshot-card
//   area: living_room            navigation_path: /lovelace/living-room
//   layout: compact              one row: glyphs and the temperature

const SNAP_TICK_MS = 30000;
const SNAP_PREDICT_MS = 4000;
const SNAP_SCRUB_SLOP = 6;
const SNAP_SCRUB_DWELL = 140;
const SNAP_PX = 10;          // a scrub this close to a change lands on it
const HIST_POLL_MS = 300000;
const SNAP_COLORS = { warn: "#E8A33D", alert: "#E06666", leak: "#5FA8E0" };

// Reading order. kind decides where a sensor renders; single keeps the best match only
// (dc order is the preference), since two temperatures for one room reads as noise.
const SLOTS = [
  { key: "presence", kind: "event", domain: "binary_sensor", dc: ["presence", "occupancy", "motion"], label: "Presence", single: true,
    on: "Occupied", off: "Clear", icon: "mdi:motion-sensor", iconOff: "mdi:motion-sensor-off" },
  { key: "door", kind: "event", domain: "binary_sensor", dc: ["door", "garage_door", "opening"], label: "Door",
    on: "Open", off: "Closed", icon: "mdi:door-open", iconOff: "mdi:door-closed" },
  { key: "window", kind: "event", domain: "binary_sensor", dc: ["window"], label: "Window",
    on: "Open", off: "Closed", icon: "mdi:window-open-variant", iconOff: "mdi:window-closed-variant" },
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
  ha-card { --warn-c: ${SNAP_COLORS.warn}; --alert-c: ${SNAP_COLORS.alert}; display: flex; flex-direction: column; gap: 10px; padding: var(--pad); overflow: hidden; }
  :host([compact]) ha-card { --pad: 12px; gap: 0; }
  /* the alert wash (steady) and glow (bloom), both springs, never transitions */
  .wash, .glow { position: absolute; inset: 0; pointer-events: none; z-index: -1; opacity: 0; border-radius: inherit; }
  .wash { background: color-mix(in oklab, var(--alert-hue, var(--alert-c)) 9%, transparent); box-shadow: inset 0 0 0 1.5px color-mix(in oklab, var(--alert-hue, var(--alert-c)) 55%, transparent); }
  .glow { background: radial-gradient(120% 90% at 50% 0%, color-mix(in oklab, var(--alert-hue, var(--alert-c)) 38%, transparent), transparent 70%); }
  :host([dark]) .glow { mix-blend-mode: plus-lighter; }

  .head { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .name { display: flex; align-items: center; gap: 9px; min-width: 0; flex: 1; border-radius: 12px; margin: -4px 0; padding: 4px 0; transform-origin: 0 50%; }
  .name[role="button"] { cursor: pointer; }
  .roomIcon { flex: none; width: 32px; height: 32px; border-radius: 11px; display: grid; place-items: center; background: var(--well); --mdc-icon-size: 18px; color: var(--primary-text-color); }
  .names { display: flex; flex-direction: column; min-width: 0; }
  .title { font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; overflow-wrap: anywhere; }
  .status { font-size: 12px; line-height: 16px; font-weight: 500; letter-spacing: -0.003em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .status[data-level="warn"] { color: var(--warn-c); font-weight: 600; }
  .status[data-level="alert"] { color: var(--alert-hue, var(--alert-c)); font-weight: 600; }
  .armed { flex: none; display: flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px; border-radius: 9px; background: var(--well); color: var(--secondary-text-color);
    font-size: 11px; line-height: 13px; font-weight: 650; letter-spacing: 0.05em; text-transform: uppercase; --mdc-icon-size: 14px; }

  .banner { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 13px; background: color-mix(in oklab, var(--alert-hue, var(--alert-c)) 16%, transparent);
    color: var(--alert-hue, var(--alert-c)); --mdc-icon-size: 20px; cursor: pointer; transform-origin: 50% 50%; }
  .banner .bt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .banner .b1 { font-size: 14px; line-height: 17px; font-weight: 650; letter-spacing: -0.012em; }
  .banner .b2 { font-size: 12px; line-height: 16px; font-weight: 500; letter-spacing: -0.003em; opacity: 0.85; }

  .events { display: grid; grid-template-columns: repeat(auto-fit, minmax(124px, 1fr)); gap: 8px; }
  .ev { --on: 0; --warn: 0; --hue: color-mix(in oklab, var(--warn-c) calc(var(--warn) * 100%), var(--primary-text-color));
    position: relative; box-sizing: border-box; min-width: 0; display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 10px; align-items: center;
    padding: 10px 12px 10px 10px; border-radius: 14px; background: color-mix(in oklab, var(--hue) calc(6% + var(--warn) * 8%), transparent); cursor: pointer; transform-origin: 50% 50%; }
  .ev .disc { grid-row: span 2; width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; --mdc-icon-size: 19px;
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
  .gl { --on: 0; --warn: 0; --hue: color-mix(in oklab, var(--warn-c) calc(var(--warn) * 100%), var(--primary-text-color));
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

class SavvySnapshotCard extends SavvyCard {
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
      throw new Error('savvy-snapshot-card: set "area" (a room) or "entities" (a hand-picked list)');
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
    if (c.navigation_path || c.tap_action) {
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
    let ids = pick(h, areaEntities(h, c.area), { domains: slot.domain, deviceClasses: slot.dc, exclude: asItems(c.exclude).map((i) => i.entity) });
    if (slot.single && ids.length > 1) ids = rankBy(h, ids, slot.dc).slice(0, 1);
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

  _areaName() {
    const c = this._config;
    return c.name || (c.area ? areaInfo(this._hass, c.area).name : "Home");
  }

  // The alarm: the one config names, else the house's (false: none).
  _alarmState() {
    const a = this._config.alarm;
    if (a === false) return null;
    const id = typeof a === "string" ? a : Object.keys(this._hass.states).find((x) => x.startsWith("alarm_control_panel."));
    return id ? this._hass.states[id]?.state : null;
  }

  // A door or window escalates whenever armed; presence only when armed away (people
  // are expected to move around at home or at night).
  _escalates(slot, on, alarm) {
    if (!on || !alarm) return false;
    if (!(alarm.startsWith("armed_") || alarm === "triggered")) return false;
    if (slot.key === "door" || slot.key === "window") return true;
    if (slot.key === "presence") return alarm === "triggered" || [].concat(this._config.alarm_presence_states || ["armed_away", "armed_vacation"]).includes(alarm);
    return false;
  }

  // ---------- update ----------
  _update() {
    const h = this._hass;
    if (!h || !this._el) return;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    const c = this._config, el = this._el;
    text(el.title, this._areaName());
    attr(el.roomIcon, "icon", c.icon || (c.area && areaInfo(h, c.area).icon) || (c.area ? "mdi:home-outline" : "mdi:home"));
    const alarm = this._alarmState();
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
        tally(slot, item, h.states[item.entity]);
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
    for (const key of seen) {
      const node = this._nodes.get(key);
      if (node) node.__parent.appendChild(node);
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
    const st = this._hass.states[item.entity];
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
    this._nodeSpring(node, "__onS", on ? 1 : 0, MOTION.ui).to(on ? 1 : 0, MOTION.ui);
    this._nodeSpring(node, "__warn", 0, MOTION.ui).to(this._escalates(slot, on, alarm) ? 1 : 0, MOTION.ui);
    this._timeText(node);
  }

  _renderGlyph(key, slot, item, siblings, alarm) {
    const st = this._hass.states[item.entity];
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
    this._alert.to(alerting ? 1 : 0, MOTION.ui);
    if (alerting && !this._wasAlert) bloom(this._glow, 1, MOTION.bloom);
    this._wasAlert = alerting;
    let level = null, words;
    if (alerting) {
      level = "alert";
      words = sum.alerts.map((a) => `${a.item.name || a.slot.label} detected`).join(" · ");
    } else {
      const parts = [];
      if (sum.active.includes("presence")) parts.push("Occupied");
      for (const k of ["door", "window"]) {
        const n = sum.active.filter((a) => a === k).length;
        if (n === 1) parts.push(`${SLOT[k].label} open`);
        else if (n > 1) parts.push(`${n} ${k}s open`);
      }
      if (sum.warn) level = "warn";
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
    try { raw = await fetchHistory(this._hass, ids, this._hours); }
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
    const lanes = tg.lanes.map((l) => ({ ...l, runs: stateRuns(this._raw[l.entity], start, end, h.states[l.entity]) }));
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
    return `${lane.label} ${on ? "opened" : "closed"}`;
  }

  _activeWord(lane) {
    if (lane.slot.key === "presence") return lane.label === lane.slot.label ? "Occupied" : `${lane.label} occupied`;
    return `${lane.label} open`;
  }

  // each lane's icon shows the state at the cursor while scrubbing, and now otherwise
  _paintLaneIcons(t) {
    for (const l of this._hist?.lanes || this._histTargets?.lanes || []) {
      const row = this._laneEls.get(l.key);
      if (!row) continue;
      const state = t == null ? this._hass?.states[l.entity]?.state : this._stateAt(l, t);
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
      put(el.wash, "opacity", a < 1e-3 ? "0" : a.toFixed(3));
      put(el.glow, "opacity", g < 1e-3 ? "0" : (g * 0.9).toFixed(3));
    }
  }
}

// ---------- editor ----------
const EDITOR = defineEditor("savvy-snapshot-card", (hass, c) => [
  S.area("area", "Area"),
  S.grid(S.text("name", "Name"), S.icon("icon", "Icon")),
  S.grid(S.select("layout", "Layout", [{ value: "full", label: "Full" }, { value: "compact", label: "Compact (one row)" }]),
    { name: "alarm", label: "Alarm", helper: "Found by itself. Doors and windows turn amber while it's armed.", selector: { entity: { domain: "alarm_control_panel" } } }),
  S.nav("navigation_path", "Navigate to on tap", "Where tapping the name goes."),
  { name: "exclude_kinds", label: "Don't show", selector: { select: { multiple: true, options: SLOTS.map((s) => ({ value: s.key, label: s.label })) } } },
  { name: "exclude", label: "Never show", selector: { entity: { multiple: true } } },
  S.section("Pick a sensor instead of discovering", SLOTS.map((s) => ({ name: s.key, label: s.label,
    selector: { entity: { domain: s.domain, device_class: s.dc, multiple: !s.single } } }))),
  S.section("History page", [
    { name: "history", label: "", selector: { object: {} }, helper: "false turns it off; { hours: 24, ranges: [6, 24, 72] }" },
  ]),
  S.chips("chips", "Chips", "Toggles become chips; a door or a number takes its place with the rest."),
]);

registerCard("savvy-snapshot-card", SavvySnapshotCard, "Snapshot",
  "A security glance at a room: presence and doors with how long ago, readouts, alerts, and a history page.");
