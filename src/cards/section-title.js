// savvy-section-title-card: the first card in a room's section. The room's name and icon (from
// the area), its control, its temperature, and a row of badges for what's going on in it:
// pinned entities first, then what is active, then doors and windows, presence and the
// temperature, which are always there. A heading, not a panel: no plate unless `filled: true`.
//
//   type: custom:savvy-section-title-card
//   area: living_room            name / icon: from the area
//   navigation_path: /lovelace/living-room      (or tap_action on the title)
//   control: input_select.living_room_scene
//   entities: [binary_sensor.front_door]        auto_discover: true
//   temperature: sensor.x | false               heading_style: title | subtitle

const BADGE_W = 30;          // icon plus spacing
// The row is anchored at its end. On screen, left to right: the pinned badges, whatever else is
// active (it grows leftwards), then these always-there kinds, then the temperature. To flip the
// order, change this list.
const TRIO = ["window", "door", "presence"];

const STYLE = `${BASE_CSS}
  ha-card { --mode: var(--secondary-text-color); display: block; background: none; border: 0; box-shadow: none;
    padding: 6px 4px 2px; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
  ha-card::after { display: none; }
  ha-card[data-filled] { padding: 12px 14px; border-radius: var(--radius);
    border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--line));
    background: var(--ha-card-background, var(--card-background-color)); box-shadow: var(--ha-card-box-shadow, none); }
  @supports (corner-shape: squircle) { ha-card[data-filled] { corner-shape: squircle; border-radius: calc(var(--radius) * 1.7); } }

  .row { display: flex; align-items: center; gap: 10px; min-width: 0; max-width: 100%; }
  .title { display: inline-flex; align-items: center; gap: 8px; min-width: 0; flex: 0 1 auto; max-width: 58%;
    padding: 2px 4px; margin: -2px -4px; border-radius: 9px; transform-origin: 0 50%; cursor: default; }
  .title[data-act] { cursor: pointer; }
  .title ha-icon { --mdc-icon-size: 20px; flex: none; display: flex; color: var(--secondary-text-color); }
  .title .n { min-width: 0; font-size: 20px; line-height: 26px; font-weight: 650; letter-spacing: -0.022em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ha-card[data-style="subtitle"] .title .n { font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.014em; }
  ha-card[data-style="subtitle"] .title ha-icon { --mdc-icon-size: 17px; }

  /* the mode chip: the overview pill, compressed to one line */
  .mode { flex: none; display: inline-flex; align-items: center; gap: 5px; min-width: 0; height: 26px; padding: 0 7px 0 6px; border-radius: 9px;
    background: color-mix(in oklab, var(--mode) 15%, transparent); color: color-mix(in oklab, var(--mode) 74%, var(--primary-text-color));
    font-size: 12px; line-height: 15px; font-weight: 600; letter-spacing: -0.004em; }
  .mode:not([data-c]) { background: var(--well); color: var(--secondary-text-color); }
  .mode ha-icon { --mdc-icon-size: 15px; flex: none; display: flex; }
  .mode .chev { --mdc-icon-size: 13px; opacity: 0.55; margin-inline-start: -2px; }
  .mode:not([data-pick]) .chev { display: none; }
  .mode .swap { display: inline-flex; align-items: center; gap: 5px; min-width: 0; }
  .mode .swap span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @container (max-width: 300px) { .mode .swap span { display: none; } }

  /* Right-aligned while everything fits; once it doesn't, the row scrolls from the start
     (flex-end in a scroll container leaves the first items unreachable) and rests at the end. */
  .badges { position: relative; flex: 1 1 0; min-width: 34px; display: flex; align-items: center; justify-content: flex-end;
    height: 28px; padding: 6px 0; margin: -6px 0; overflow: hidden; }
  .badges[data-overflow] { justify-content: flex-start; overflow-x: auto; overscroll-behavior-x: contain; touch-action: pan-x pan-y;
    scrollbar-width: none; -webkit-mask-image: linear-gradient(to right, transparent 0, #000 26px); mask-image: linear-gradient(to right, transparent 0, #000 26px); }
  .badges::-webkit-scrollbar { display: none; }
  .badge { position: relative; flex: none; width: 0; height: 28px; outline: none; }
  .chip { position: absolute; top: 0; inset-inline-start: 0; width: 28px; height: 28px; border-radius: 50%;
    display: grid; place-items: center; color: var(--secondary-text-color); opacity: 0; }
  .chip::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: color-mix(in oklab, var(--bc) 22%, transparent); opacity: 0; }
  .badge[data-critical] .chip::before { opacity: var(--on, 0); }
  .chip ha-icon, .chip savvy-state-icon { --mdc-icon-size: 19px; position: relative; display: flex; }
  :host([kbd]) .badge:focus-visible .chip { box-shadow: 0 0 0 2px var(--bc); }

  /* the temperature is a reading, so it keeps its number */
  .temp { flex: none; display: inline-flex; align-items: center; gap: 4px; padding: 2px 5px; margin-inline-start: 2px; border-radius: 8px;
    color: var(--secondary-text-color); font-size: 12.5px; line-height: 16px; font-weight: 600; letter-spacing: -0.006em; }
  .temp ha-icon { --mdc-icon-size: 17px; display: flex; color: var(--tc, var(--secondary-text-color)); }
  :host([kbd]) :focus-visible { outline-color: color-mix(in oklab, var(--mode) 80%, var(--primary-text-color)); }
  @media (prefers-contrast: more) { .temp { color: var(--primary-text-color); } }
`;

// A reading worth noticing warms up; a comfortable one stays quiet.
const tempColor = (t) => {
  const c = /F/.test(t.unit) ? (t.value - 32) * 5 / 9 : t.value;
  return c >= 30 ? "#EE7B4D" : c >= 26 ? "#E8B44F" : c <= 18 ? "#4F93DE" : "";
};
const tempText = (t) => `${t.value.toFixed(1)}${t.unit.includes("°") ? "°" : ` ${t.unit}`}`;

class SavvySectionTitleCard extends SavvyCard {
  static getStubConfig(hass) {
    const a = allAreas(hass).find((x) => areaEntities(hass, x.id).length);
    return a ? { area: a.id } : { name: "Heading" };
  }
  static getConfigElement() { return document.createElement(EDITOR); }

  setConfig(config) {
    if (!config || (!config.area && !config.name && !config.heading)) throw new Error("savvy-section-title-card: set an area (or a name)");
    this._config = legacyBadges({ heading_style: "title", ...config, name: config.name || config.heading });
    if (this.shadowRoot && this._el) { this._build(); if (this._hass) this._update(); }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._el) this._build();
    this._update();
    this._list?.render(hass);
    if (this._picker?.isOpen) this._picker.render(this._modeInfo(), this._caption());
  }

  connectedCallback() { this._observe(); this._wake(); }
  getCardSize() { return 1; }
  getGridOptions() { return { columns: 12, rows: "auto", min_columns: 4 }; }

  _modeInfo() { return this._hass && modeInfo(this._hass, controlOf(this._config).entity, this._config); }
  _caption() { return this._config.mode_label ?? "Mode"; }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._resetMotion();
    this._picker?.close();
    this._picker = null;
    this._first = true;
    this._lastWidth = 0;
    this._badges = new Map();
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="row">
          <div class="title" id="title"><ha-icon id="icon" hidden></ha-icon><span class="n" id="name"></span></div>
          <button class="mode" id="mode" hidden>
            <span class="swap" id="modeSwap"><ha-icon id="modeIcon"></ha-icon><span id="modeText"></span></span>
            <ha-icon class="chev" icon="mdi:chevron-down"></ha-icon>
          </button>
          <div class="badges" id="badges"><span class="temp" id="temp" role="button" tabindex="0" hidden><ha-icon icon="mdi:thermometer"></ha-icon><span id="tempText"></span></span></div>
        </div>
      </ha-card>`;
    const $ = (id) => root.getElementById(id);
    this._el = { card: root.querySelector("ha-card"), title: $("title"), icon: $("icon"), name: $("name"), mode: $("mode"),
      modeSwap: $("modeSwap"), modeIcon: $("modeIcon"), modeText: $("modeText"), badges: $("badges"), temp: $("temp"), tempText: $("tempText") };
    const c = this._config, el = this._el;
    attr(el.card, "data-style", c.heading_style === "subtitle" ? "subtitle" : "title");
    attr(el.card, "data-filled", !!c.filled);

    // the title: navigates (navigation_path) or whatever tap_action says
    const tap = c.tap_action || (c.navigation_path ? { action: "navigate", navigation_path: c.navigation_path } : null);
    if (tap || c.hold_action) {
      attr(el.title, "data-act", true);
      attr(el.title, "role", "button");
      attr(el.title, "tabindex", "0");
      this._chipActions(el.title, () => ({ config: { tap_action: tap, hold_action: c.hold_action, double_tap_action: c.double_tap_action } }), {}, 0.04);
    }

    this._swap = new Swap(el.modeSwap, (v) => {
      const info = this._modeInfo();
      text(el.modeText, info?.label || v);
      attr(el.modeIcon, "icon", info?.icon);
    }, "mode");
    this._springs.push(this._swap.spring);
    wireModeChip(this, el.mode, () => el.card, () => this._caption());
    this._pressable(el.temp, { onTap: () => moreInfo(this, this._temp?.entity) });
    this._observe();
  }

  _observe() {
    if (!this._el || !this.isConnected) return;
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => { this._fitBadges(); this._wake(); });
    this._ro.observe(this._el.badges);
  }

  _update() {
    const h = this._hass, c = this._config, el = this._el;
    if (!h || !el) return;
    const area = c.area ? areaInfo(h, c.area) : null;
    text(el.name, c.name || area?.name || "");
    const icon = c.icon ?? area?.icon;
    el.icon.hidden = !icon;
    if (icon) attr(el.icon, "icon", icon);
    attr(el.title, "aria-label", c.name || area?.name);

    // mode
    const info = this._modeInfo();
    el.mode.hidden = !info;
    if (info) {
      Motion.tintVar(el.card, "--mode", info.color || "var(--secondary-text-color)");
      attr(el.mode, "data-c", !!info.color);
      attr(el.mode, "aria-label", [modeCaption(info, this._caption()), info.label].filter(Boolean).join(" "));
      attr(el.mode, "data-pick", info.options.length > 0);
      el.mode.disabled = info.kind === "select" && !info.options.length;
      syncModeChip(el.mode, info);
      this._swap.set(info.value);
    }

    // temperature
    const t = roomTemperature(h, c.area, c);
    this._temp = t;
    el.temp.hidden = !t;
    if (t) {
      text(el.tempText, tempText(t));
      put(el.temp, "--tc", tempColor(t) || "var(--secondary-text-color)");
      attr(el.temp, "aria-label", `Temperature ${t.value.toFixed(1)} ${t.unit}`);
    }

    this._renderBadges();
    if (this._first) {
      this._first = false;
      this._paintAll(null);
      requestAnimationFrame(() => this._fitBadges());
    }
    this._wake();
  }

  _renderBadges() {
    const h = this._hass, found = roomBadges(h, this._config.area, this._config, { alwaysKinds: TRIO });
    const list = [...found.filter((b) => b.pinned), ...found.filter((b) => !b.pinned && !TRIO.includes(b.key)), ...TRIO.map((k) => found.find((b) => !b.pinned && b.key === k)).filter(Boolean)];
    const seen = new Set(), red = MQ.reduced.matches;
    for (const b of list) {
      seen.add(b.key);
      let item = this._badges.get(b.key);
      const look = badgeLook(b);
      if (!item) {
        const node = document.createElement("span");
        node.className = "badge";
        node.setAttribute("role", "button");
        node.innerHTML = `<span class="chip">${look.icon ? "<ha-icon></ha-icon>" : "<savvy-state-icon></savvy-state-icon>"}</span>`;
        item = { el: node, chip: node.querySelector(".chip"), icon: node.querySelector("ha-icon, savvy-state-icon"),
          shown: this._spring(0, MOTION.ui, `badge:${b.key}`, 0.002), on: this._spring(0, MOTION.ui, `badge:${b.key}`, 0.002) };
        item.b = b;
        this._chipActions(node, () => ({ config: item.b.cfg, entity: item.b.entity,
          list: () => this._showList(item.b.kind?.name || shortName(h, item.b.entity), item.b.ids, badgeLook(item.b).color, node, null, { bulk: "auto" }) }), badgeDefaults(b), 0.12);
        this._badges.set(b.key, item);
      }
      item.b = b;
      const st = h.states[b.entity];
      if (look.icon) attr(item.icon, "icon", look.icon);
      else if (item.icon.stateObj !== st) { item.icon.hass = h; item.icon.stateObj = st; }
      put(item.el, "--bc", look.color || "var(--primary-text-color)");
      attr(item.el, "data-critical", look.critical);
      attr(item.el, "aria-label", `${b.cfg.name || shortName(h, b.entity, this._config.area)}, ${chipState(h, st)}`);
      if (look.spin) {
        const spin = this._spinner(b.key, item.icon);
        spin.s.to(b.on && climateRunning(st) && !red ? fanRate(st) : 0);
        if (red) spin.s.snap();
      }
      if (item.shown.target !== 1) this._rowDirty = true;
      item.shown.to(1);
      item.on.to(b.on ? 1 : 0);
      if (this._first || red) { item.shown.snap(); item.on.snap(); }
      item.el.tabIndex = 0;
      attr(item.el, "aria-hidden", "false");
    }
    for (const [key, item] of this._badges) {
      if (seen.has(key)) continue;
      if (item.shown.target !== 0) this._rowDirty = true;
      item.shown.to(0);
      item.on.to(0);
      if (red) { item.shown.snap(); item.on.snap(); }
      this._spins.get(key)?.s.to(0);
      item.el.tabIndex = -1;
      attr(item.el, "aria-hidden", "true");
    }
    // DOM order follows the list, and the temperature closes the row
    const leaving = [...this._badges.values()].filter((i) => !seen.has(i.b.key)).map((i) => i.el);
    const want = [...list.map((b) => this._badges.get(b.key).el), ...leaving, this._el.temp];
    const kids = [...this._el.badges.children];
    if (want.some((n, i) => kids[i] !== n)) for (const n of want) this._el.badges.appendChild(n);
  }

  _fitBadges() {
    const row = this._el?.badges;
    if (!row) return;
    // right-aligned content that overflows spills off the start, where no scroll area
    // exists, so scrollWidth can't be trusted: add the children up
    let content = 0;
    for (const child of row.children) {
      if (child.hidden) continue;
      const cs = getComputedStyle(child);
      content += child.getBoundingClientRect().width + (parseFloat(cs.marginInlineStart) || 0) + (parseFloat(cs.marginInlineEnd) || 0);
    }
    const over = content > row.clientWidth + 1;
    row.toggleAttribute("data-overflow", over);
    if (over && Math.abs(this._lastWidth - content) > 1) {
      const go = () => { row.scrollLeft = row.scrollWidth; };
      requestAnimationFrame(go);
      clearTimeout(this._pinTimer);
      this._pinTimer = setTimeout(go, 180);
    }
    this._lastWidth = over ? content : 0;
  }

  _paint(dirty, all, red) {
    if (all || dirty.has("mode")) this._swap.paint(red);
    const idle = MQ.contrast.matches ? 0.7 : 0.45;
    for (const [key, item] of this._badges) {
      if (!all && !dirty.has(`badge:${key}`)) continue;
      const shown = clamp(item.shown.x), on = clamp(item.on.x);
      // joining: visible early; leaving: transparent while it travels
      const vis = item.shown.target === 1 ? Math.sqrt(shown) : shown * shown;
      put(item.el, "width", `${(shown * BADGE_W).toFixed(2)}px`);
      put(item.chip, "opacity", (vis * (idle + (1 - idle) * on)).toFixed(3));
      put(item.chip, "transform", red ? "" : `scale(${(0.6 + 0.4 * shown).toFixed(4)})`);
      put(item.chip, "--on", on.toFixed(3));
      put(item.chip, "color", on > 1e-3 ? `color-mix(in oklab, var(--bc) ${(on * 100).toFixed(1)}%, var(--secondary-text-color))` : "");
    }
    if (this._rowDirty && [...this._badges.values()].every((i) => i.shown.idle)) {
      this._rowDirty = false;
      this._fitBadges();
    }
  }
}

// ---------- editor ----------
const EDITOR = defineEditor("savvy-section-title-card", (hass, c) => [
  S.area(),
  S.grid(S.text("name", "Name"), S.icon("icon", "Icon")),
  S.nav("navigation_path", "Target page", "Where tapping the name goes. Or set a tap action below."),
  S.grid(S.select("heading_style", "Style", [{ value: "title", label: "Title" }, { value: "subtitle", label: "Subtitle" }]),
    S.bool("filled", "Filled", null, false)),
  ...modeSchema(hass, c),
  { name: "temperature", label: "Temperature", helper: "Found from the area (a temperature sensor, else its climate unit). Pick another to override.",
    selector: { entity: { domain: ["sensor", "climate"] } } },
  ...badgeSchema(),
  S.section("Title actions", [S.action("tap_action", "Tap action"), S.action("hold_action", "Hold action")]),
]);

registerCard("savvy-section-title-card", SavvySectionTitleCard, "Section title",
  "A title for a section of a dashboard: plain text, or a room's name with its control, temperature and live status badges.");
