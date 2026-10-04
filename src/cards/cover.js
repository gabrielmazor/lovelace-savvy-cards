// savvy-cover-card: the blinds, shutters, curtains, awnings, garage and gate of a room. One row each, the
// same rows the covers popup of the home header uses: open, close or stop on the line, a position bar and a
// tilt bar below. "Open all" and "Close all" act on exactly what is listed. A garage door or a gate asks for
// a second tap to open, and "Open all" leaves them out; closing is always one tap.
//
//   type: custom:savvy-cover-card
//   area: living_room                     (or a list; empty: every cover of the house)
//   title: Blinds                         (default: the area's name, else Covers)    title_path: /lovelace/covers
//   classes: [blind, shutter]             (only these device classes; default all)
//   include: [cover.x]  exclude: [cover.y]   (the Savvy settings' ignore list is added to exclude)
//   all: true                             (the Open all / Close all buttons; false hides them)
//   layout: full | compact                (compact: the summary and the two buttons, no rows)
//
// Tap a name for the cover's details. The chevron opens its position and tilt.

const CV_GUARDED = new Set(["garage", "gate"]);
const CV_OPEN = new Set(["open", "opening", "closing"]);

const STYLE = `${BASE_CSS}${LIST_CSS}${ROWS_CSS}
  ha-card { --pad: 14px; --tone: var(--accent); position: relative; display: flex; flex-direction: column; gap: 8px; padding: var(--pad); overflow: hidden; }
  :host([data-compact]) ha-card { --pad: 12px; }
  ha-card > * { position: relative; }
  .head { display: flex; align-items: center; gap: 8px; min-height: 32px; }
  .head .t { flex: 1; min-width: 0; font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pill { flex: none; display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: 12px; white-space: nowrap;
    font-size: 12px; font-weight: 650; color: rgb(var(--tone)); background: color-mix(in oklab, rgb(var(--tone)) var(--mix-on), transparent); }
  .ctl { flex: none; display: grid; place-items: center; width: var(--c-s); height: var(--c-s); border-radius: 11px; background: var(--well); --mdc-icon-size: 18px; }
  .ctl ha-icon { display: flex; }
  .ctl[disabled] { opacity: 0.4; cursor: default; }
  .empty { padding: 4px 2px; font-size: 12.5px; font-weight: 500; color: var(--secondary-text-color); }
`;

class SavvyCoverCard extends SavvyCard {
  static getStubConfig(hass) {
    const a = allAreas(hass).find((x) => pick(hass, areaEntities(hass, x.id), { domains: "cover" }).length);
    if (a) return { area: a.id };
    return {};
  }
  static getConfigElement() { return document.createElement(EDITOR); }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("savvy-cover-card: invalid configuration");
    const areas = [].concat(config.area ?? config.areas ?? []).filter(Boolean);
    this._config = { ...config, areas, classes: [].concat(config.classes || []), include: asItems(config.include).map((i) => i.entity),
      exclude: asItems(config.exclude).map((i) => i.entity), exclude_areas: [].concat(config.exclude_areas || []) };
    this._compact = config.layout === "compact";
    if (this._el) { this._build(); if (this._hass) this._update(); }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._el) this._build();
    this._update();
  }

  connectedCallback() { this._wake(); }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._rows?.dispose();
    this._rows = null;
  }
  getCardSize() { return this._compact ? 1 : 1 + Math.max(1, this._count || 2); }
  getGridOptions() { return { columns: 12, min_columns: 4, rows: "auto" }; }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._resetMotion();
    this._rows?.dispose();
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="head"><span class="t" id="title"></span><span class="pill" id="pill"></span>
          <button class="ctl" id="up" aria-label="Open all"><ha-icon icon="mdi:arrow-up"></ha-icon></button>
          <button class="ctl" id="down" aria-label="Close all"><ha-icon icon="mdi:arrow-down"></ha-icon></button></div>
        <div id="rows"></div>
        <div class="empty" id="empty" hidden></div>
      </ha-card>`;
    const $ = (id) => root.getElementById(id);
    this._el = { card: root.querySelector("ha-card"), title: $("title"), pill: $("pill"), up: $("up"), down: $("down"), rows: $("rows"), empty: $("empty") };
    this._rows = new InlineRows(this);
    this._el.rows.appendChild(this._rows.rows);
    linkTitle(root, this._el.title, titlePathOf(this._config), (el, onTap) => this._pressable(el, { onTap }, 0.04));
    this._pressable(this._el.up, { onTap: () => this._all("open") }, 0.08);
    this._pressable(this._el.down, { onTap: () => this._all("close") }, 0.08);
    this._first = true;
  }

  _ids() {
    const h = this._hass, c = this._config;
    const skip = new Set(c.exclude), skipArea = new Set(c.exclude_areas);
    let ids = c.areas.length ? [...new Set(c.areas.flatMap((a) => areaEntities(h, a)))] : houseEntities(h);
    for (const id of c.include) if (h.states[id] && !ids.includes(id)) ids = [...ids, id];
    const inc = new Set(c.include);
    return ids.filter((id) => {
      if (domainOf(id) !== "cover" || skip.has(id) || !h.states[id]) return false;
      const a = entityArea(h, id);
      if (a && skipArea.has(a)) return false;
      return inc.has(id) || !c.classes.length || c.classes.includes(h.states[id].attributes.device_class || "none");
    });
  }

  // what each button acts on: everything listed that is not already there; opening leaves out garage and gate
  _targets(kind, ids) {
    const h = this._hass;
    return ids.filter((id) => {
      const st = h.states[id];
      if (!st || st.state === "unavailable" || st.state === "unknown") return false;
      const sf = st.attributes.supported_features ?? 11;
      if (kind === "open") return (st.state === "closed" || st.state === "closing") && (sf & 1) && !CV_GUARDED.has(st.attributes.device_class);
      return (st.state === "open" || st.state === "opening") && (sf & 2);
    });
  }

  _all(kind) {
    const targets = this._targets(kind, this._ids());
    if (!targets.length) return;
    haptic("medium");
    this._hass.callService("cover", kind === "open" ? "open_cover" : "close_cover", {}, { entity_id: targets });
  }

  _update() {
    const h = this._hass;
    if (!h || !this._el) return;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    this.toggleAttribute("data-compact", this._compact);
    const c = this._config, el = this._el;
    const ids = this._ids();
    this._count = ids.length;
    const areaName = c.areas.length === 1 ? areaInfo(h, c.areas[0]).name : "";
    text(el.title, c.title ?? (areaName ? `${areaName} covers` : "Covers"));
    const open = ids.filter((id) => CV_OPEN.has(h.states[id].state));
    const guarded = open.filter((id) => CV_GUARDED.has(h.states[id].attributes.device_class));
    let tone = "accent", pill;
    if (!ids.length) pill = "";
    else if (!open.length) { tone = "good"; pill = "All closed"; }
    else if (guarded.length) { tone = "warn"; pill = guarded.length === open.length && open.length === 1 ? `${shortName(h, guarded[0], null)} open` : `${open.length} open`; }
    else pill = `${open.length} open`;
    el.pill.hidden = !ids.length;
    text(el.pill, pill);
    put(el.card, "--tone", tone === "accent" ? "var(--accent)" : `var(--${tone}-rgb)`);
    stateGlow(c, el.card, guarded.length ? [232, 163, 61] : null, 0.8);
    const showAll = c.all !== false && ids.length > 1;
    el.up.hidden = el.down.hidden = !showAll;
    attr(el.up, "disabled", this._targets("open", ids).length ? null : "");
    attr(el.down, "disabled", this._targets("close", ids).length ? null : "");
    el.rows.hidden = this._compact || !ids.length;
    if (!this._compact) this._rows.update(h, ids, { sort: c.areas.length > 1 ? "room" : null, hideArea: c.areas.length === 1 });
    el.empty.hidden = ids.length > 0;
    if (!ids.length) text(el.empty, c.areas.length ? "No covers in this area." : "No covers found.");
    attr(el.card, "aria-label", `${c.title ?? "Covers"}${pill ? `, ${pill}` : ""}`);
    if (this._first) { this._first = false; requestAnimationFrame(() => this._paintAll(null)); }
    this._wake();
  }
}

// ---------- editor ----------
const EDITOR = defineEditor("savvy-cover-card", () => [
  { name: "area", label: "Areas", helper: "Empty: every cover of the house.", selector: { area: { multiple: true } } },
  S.grid(S.text("title", "Title", "Empty: the area's name."), S.titleLink("title")),
  { name: "classes", label: "Kinds", helper: "Only these kinds of cover. Empty: all.", selector: { select: { multiple: true, mode: "list", options: [
    { value: "blind", label: "Blinds" }, { value: "shutter", label: "Shutters" }, { value: "curtain", label: "Curtains" }, { value: "awning", label: "Awnings" },
    { value: "shade", label: "Shades" }, { value: "garage", label: "Garage doors" }, { value: "gate", label: "Gates" }, { value: "door", label: "Doors" }, { value: "window", label: "Windows" },
  ] } } },
  { name: "include", label: "Also show", selector: { entity: { domain: "cover", multiple: true } } },
  { name: "exclude", label: "Never show", selector: { entity: { domain: "cover", multiple: true } } },
  S.grid(S.bool("all", "Open and close all", "Buttons for everything listed. A garage and a gate are not opened by them.", true), S.select("layout", "Layout", [{ value: "full", label: "Full" }, { value: "compact", label: "Compact" }])),
  GLOW_FIELD,
]);

registerCard("savvy-cover-card", SavvyCoverCard, "Covers",
  "Blinds, shutters, curtains, garage and gate of a room: open, close, position and tilt, with Open all and Close all.");
