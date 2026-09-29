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
