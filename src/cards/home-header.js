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
    if (this._healthCard) { this._healthCard.hass = hass; this._healthGlow(); }
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
    // the card's own corner glow would be cut by the title bar: the sheet draws it instead
    card.setConfig({ ...opts, source: "all", max_rows: 30, title: " ", columns: 1, state_glow: false });
    this._healthSheet.body.replaceChildren(card);
    card.hass = this._hass;
    this._healthCard = card;
    this._healthGlow();
    this._healthSheet.open(this._el.health);
  }

  _healthGlow() {
    const sheet = this._healthSheet?.el, card = this._healthCard;
    if (sheet && card) Motion.glow(sheet, (this._healthCfg() || {}).state_glow === false ? null : card._glowRgb, 0.8);
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
    // when the count is kept from this person the cog looks like any other: no colour, no alert
    const total = this._sum.total, warn = hc.warn_above ?? 6;
    const showCount = !!total && !hiddenFromUser(h, this._config, "health_badges");
    Motion.tintVar(el.health, "--ac", !showCount ? "var(--secondary-text-color)" : total < warn ? "var(--lvl-warn)" : "var(--lvl-bad)");
    attr(el.health, "data-alert", showCount);
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
