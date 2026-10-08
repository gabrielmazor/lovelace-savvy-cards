// savvy-fan-card: the fans, air purifiers and humidifiers of a room. One row each, the same rows the popups
// use: the switch, and behind the chevron the speed, the preset modes and oscillation of a fan, or the
// target humidity and modes of a humidifier. A fan's icon turns while it runs, faster at a higher speed.
// "All off" acts on exactly what is listed.
//
//   type: custom:savvy-fan-card
//   area: bedroom                         (or a list; empty: every fan and humidifier of the house)
//   title: Air                            (default: the area's name + fans, else Fans)    title_path: /lovelace/air
//   kinds: [fan, humidifier]              (default both)
//   include: [fan.x]  exclude: [fan.y]    (the Savvy settings' ignore list is added to exclude)
//   all: true                             (the All off button; false hides it)
//   layout: full | compact                (compact: the summary and the button, no rows)
//
// Tap a name for the details. The chevron opens the speed, modes and oscillation.

const FN_KINDS = ["fan", "humidifier"];

const STYLE = `${BASE_CSS}${LIST_CSS}${ROWS_CSS}
  ha-card { --pad: 14px; --tone: var(--accent); position: relative; display: flex; flex-direction: column; gap: 8px; padding: var(--pad); overflow: hidden; }
  :host([data-compact]) ha-card { --pad: 12px; }
  ha-card > * { position: relative; }
  .head { display: flex; align-items: center; gap: 8px; min-height: 32px; }
  .head .t { flex: 1; min-width: 0; font-size: 17px; line-height: 22px; font-weight: 620; letter-spacing: -0.021em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pill { flex: none; display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: 12px; white-space: nowrap;
    font-size: 12px; font-weight: 650; color: rgb(var(--tone)); background: color-mix(in oklab, rgb(var(--tone)) var(--mix-on), transparent); }
  .pill[data-off] { color: var(--secondary-text-color); background: var(--well); }
  .ctl { flex: none; display: grid; place-items: center; width: var(--c-s); height: var(--c-s); border-radius: 11px; background: var(--well); --mdc-icon-size: 18px; }
  .ctl ha-icon { display: flex; }
  .ctl[disabled] { opacity: 0.4; cursor: default; }
  .empty { padding: 4px 2px; font-size: 12.5px; font-weight: 500; color: var(--secondary-text-color); }
`;

class SavvyFanCard extends SavvyCard {
  static getStubConfig(hass) {
    const a = allAreas(hass).find((x) => pick(hass, areaEntities(hass, x.id), { domains: FN_KINDS }).length);
    return a ? { area: a.id } : {};
  }
  static getConfigElement() { return document.createElement(EDITOR); }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("savvy-fan-card: invalid configuration");
    const areas = [].concat(config.area ?? config.areas ?? []).filter(Boolean);
    const kinds = [].concat(config.kinds ?? FN_KINDS).filter((k) => FN_KINDS.includes(k));
    this._config = { ...config, areas, kinds: kinds.length ? kinds : FN_KINDS, include: asItems(config.include).map((i) => i.entity),
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
          <button class="ctl" id="off" aria-label="All off"><ha-icon icon="mdi:power"></ha-icon></button></div>
        <div id="rows"></div>
        <div class="empty" id="empty" hidden></div>
      </ha-card>`;
    const $ = (id) => root.getElementById(id);
    this._el = { card: root.querySelector("ha-card"), title: $("title"), pill: $("pill"), off: $("off"), rows: $("rows"), empty: $("empty") };
    this._rows = new InlineRows(this);
    this._el.rows.appendChild(this._rows.rows);
    linkTitle(root, this._el.title, titlePathOf(this._config), (el, onTap) => this._pressable(el, { onTap }, 0.04));
    this._pressable(this._el.off, { onTap: () => this._allOff() }, 0.08);
    this._first = true;
  }

  _ids() {
    const h = this._hass, c = this._config;
    const skip = new Set(c.exclude), skipArea = new Set(c.exclude_areas), kinds = new Set(c.kinds);
    let ids = c.areas.length ? [...new Set(c.areas.flatMap((a) => areaEntities(h, a)))] : houseEntities(h);
    for (const id of c.include) if (h.states[id] && !ids.includes(id)) ids = [...ids, id];
    const inc = new Set(c.include);
    return ids.filter((id) => {
      if (skip.has(id) || !h.states[id]) return false;
      const a = entityArea(h, id);
      if (a && skipArea.has(a)) return false;
      return inc.has(id) || kinds.has(domainOf(id));
    });
  }

  _on(ids) { return ids.filter((id) => this._hass.states[id].state === "on"); }

  _allOff() {
    const on = this._on(this._ids());
    if (!on.length) return;
    haptic("medium");
    const by = { fan: [], humidifier: [] };
    for (const id of on) (by[domainOf(id)] || (by[domainOf(id)] = [])).push(id);
    for (const [d, list] of Object.entries(by)) if (list.length) this._hass.callService(d, "turn_off", {}, { entity_id: list });
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
    const fansOnly = ids.every((id) => domainOf(id) === "fan");
    text(el.title, c.title ?? `${areaName ? `${areaName} ` : ""}${fansOnly ? (areaName ? "fans" : "Fans") : (areaName ? "air" : "Air")}`);
    const on = this._on(ids);
    el.pill.hidden = !ids.length;
    text(el.pill, !ids.length ? "" : on.length ? `${on.length} on` : "All off");
    attr(el.pill, "data-off", !on.length);
    stateGlow(c, el.card, on.length ? [88, 142, 233] : null, 0.7);
    el.off.hidden = c.all === false || !ids.length;
    attr(el.off, "disabled", on.length ? null : "");
    el.rows.hidden = this._compact || !ids.length;
    if (!this._compact) this._rows.update(h, ids, { sort: c.areas.length > 1 ? "room" : null, hideArea: c.areas.length === 1 });
    el.empty.hidden = ids.length > 0;
    if (!ids.length) text(el.empty, c.areas.length ? "No fans in this area." : "No fans found.");
    attr(el.card, "aria-label", `${el.title.textContent}${el.pill.textContent ? `, ${el.pill.textContent}` : ""}`);
    if (this._first) { this._first = false; requestAnimationFrame(() => this._paintAll(null)); }
    this._wake();
  }
}

// ---------- editor ----------
const EDITOR = defineEditor("savvy-fan-card", () => [
  { name: "area", label: "Areas", helper: "Empty: every fan and humidifier of the house.", selector: { area: { multiple: true } } },
  S.grid(S.text("title", "Title", "Empty: the area's name + fans."), S.titleLink("title")),
  { name: "kinds", label: "Kinds", helper: "Empty: both.", selector: { select: { multiple: true, mode: "list", options: [{ value: "fan", label: "Fans and air purifiers" }, { value: "humidifier", label: "Humidifiers" }] } } },
  { name: "include", label: "Also show", selector: { entity: { multiple: true } } },
  { name: "exclude", label: "Never show", selector: { entity: { multiple: true } } },
  S.grid(S.bool("all", "All off", "A button that turns off everything listed.", true), S.select("layout", "Layout", [{ value: "full", label: "Full" }, { value: "compact", label: "Compact" }])),
  GLOW_FIELD,
]);

registerCard("savvy-fan-card", SavvyFanCard, "Fans",
  "The fans, air purifiers and humidifiers of a room: speed, modes, oscillation and target humidity, with All off.");
