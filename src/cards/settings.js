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
