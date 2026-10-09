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
  .name { font-size: 14px; line-height: 19px; font-weight: 600; letter-spacing: -0.016em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
  .badges { position: relative; z-index: 1; display: flex; align-items: center; height: var(--chip); padding: 16px; margin: -16px; margin-inline-start: -21px; overflow: hidden; pointer-events: none; }
  .badge { pointer-events: auto; }
  .badges[data-overflow] { -webkit-mask-image: linear-gradient(to left, transparent 8px, #000 40px); mask-image: linear-gradient(to left, transparent 8px, #000 40px); }
  @container (min-width: 300px) { .badges { padding-inline-start: calc(16px + var(--well-size) + var(--gap)); } }
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
    this._reduced = this._noMotion();
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
  S.bool("animations", "Animations", "The drop's movement and glow, badges popping in, text rolling. Off keeps the tile still. The settings card can turn them off for every room tile.", true),
  S.section("Actions", [S.action("tap_action", "Tap action"), S.action("double_tap_action", "Double tap action"), S.action("hold_action", "Hold action")]),
]);

registerCard("savvy-room-tile", SavvyRoomTile, "Room tile",
  "A room at a glance: a drop that fills with its light, its mode, temperature and live badges.");
