// savvy-room-header-card: the header at the top of a room's own page. The room's control (a mode
// select, say: tap to change it) and temperature; a row of what the room has: how many lights are on,
// then everything the area has, on or off (dimmed when idle), what is active first; your own chips;
// and a row to jump to every other room.
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

  // How many of the room's lights are on, leading the row: a tap lists them, with all on / off.
  _lightsItem() {
    const h = this._hass, c = this._config;
    // its own option; with discovery off (only the pinned badges) it shows only when asked for
    if (c.lights === false || (c.auto_discover === false && c.lights !== true)) return null;
    const ids = areaLights(h, c.area).filter((id) => !asItems(c.exclude).some((i) => i.entity === id));
    if (!ids.length) return null;
    const on = ids.filter((id) => h.states[id]?.state === "on").length;
    const value = on ? `${on} on` : "Off";
    return {
      key: "lights", icon: on ? "mdi:lightbulb" : "mdi:lightbulb-outline", value, caption: "Lights", aria: `Lights, ${value}`,
      color: on ? LIGHT_COLOR : "var(--secondary-text-color)", dim: !on,
      config: { tap_action: { action: "list" }, hold_action: { action: "list" } }, defaults: { tap: { action: "list" }, hold: { action: "list" } },
      list: (from) => this._showList("Lights", ids, LIGHT_COLOR, from, null, { bulk: "auto" }),
    };
  }

  // Everything the room has, on or off: active ones in their colour, idle ones dimmed.
  _sensors() {
    const h = this._hass, c = this._config;
    const lights = this._lightsItem();
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
    this._chipRow(this._el.sensors, lights ? [lights, ...items] : items, { iconOnly: !!c.icons_only });
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
  S.grid(S.bool("lights", "Lights count", "How many of the room's lights are on, first in the row; a tap lists them.", true),
    S.bool("icons_only", "Icons only", "Just the coloured icons, no names or states.", false)),
  S.chips("chips", "Custom chips", "Your own chips, in a row under the room's."),
  { name: "room_path", label: "Room pages", helper: "E.g. /lovelace/{slug} ({area}: the area id, {slug}: with dashes). Empty hides the row.", selector: { text: {} } },
  { name: "room_order", label: "Room order", type: "list", helper: "Rooms listed first, in this order; the rest follow by name.",
    initial: (h, cfg) => (h ? areasOf(h, cfg) : []), add: { selector: { area: {} }, label: "Add a room" },
    summary: (a, h) => ({ title: areaInfo(h, a).name, sub: a }) },
  { name: "exclude_rooms", label: "Exclude rooms", selector: { area: { multiple: true } } },
]);

registerCard("savvy-room-header-card", SavvyRoomHeaderCard, "Room header",
  "The header at the top of a room's page: its control, temperature, everything it has, and the way to every other room.");
