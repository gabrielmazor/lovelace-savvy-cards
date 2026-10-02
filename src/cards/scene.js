// savvy-scene-card: every scene of a room, one tap each.
//
//   type: custom:savvy-scene-card
//   area: office                          (or a list: scenes from several rooms)
//   title: Scenes                         (optional: a heading; tap it to go somewhere with navigation_path)
//   layout: full | compact                (compact: one scrolling row of pills)
//   columns: 3                            (else 2 to 4 by the card's width)
//   entities: [scene.x, { entity: scene.y, name: Cosy, icon: mdi:sofa, color: amber }]
//                                         pinned first, in this order, even outside the area
//   auto_discover: true                   also every scene the area has (hidden/disabled left out)
//   exclude: [scene.z]
//   strip: '^.*//\s*|\s*-\s*on$'          a regular expression taken out of each name (any case, every match), before the area's name
//   color: blue   show_icon: true
//
// Names: `strip` is taken out first, then the area's name off the front ("Office // Work"
// reads "Work"; with the strip above "Office Relax" reads "Relax"); `strip: false` keeps
// names as they are. A pinned scene's own `name` is used as written.
// Tap runs the scene; hold opens its more-info. A scene lights for a few seconds after it
// runs, from this card or from anywhere else (a scene's state is when it last ran).

const SCENE_LIT_MS = 4000;
const SCENE_DEFAULT_ICON = "mdi:palette";
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const STYLE = `${BASE_CSS}
  ha-card { --pad: 12px; --c: #588ee9; display: flex; flex-direction: column; gap: 10px; padding: var(--pad); }
  .head { display: flex; align-items: center; gap: 4px; min-width: 0; align-self: flex-start; margin: -3px -6px; padding: 3px 6px; border-radius: 10px;
    font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; }
  .head[role="button"] { cursor: pointer; }
  .head .t { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .head ha-icon { --mdc-icon-size: 18px; display: flex; color: var(--secondary-text-color); }

  .grid { display: grid; grid-template-columns: repeat(var(--cols, 2), minmax(0, 1fr)); gap: 8px; min-width: 0; }
  @container (min-width: 300px) { .grid:not([data-cols]) { --cols: 3; } }
  @container (min-width: 460px) { .grid:not([data-cols]) { --cols: 4; } }
  .tile { --on: 0; --tc: var(--c); display: flex; align-items: center; gap: 9px; min-width: 0; box-sizing: border-box; height: 46px; padding: 0 12px 0 8px;
    border-radius: 13px; cursor: pointer; transform-origin: 50% 50%;
    background: color-mix(in oklab, var(--tc) calc(7% + var(--on) * 17%), transparent);
    color: color-mix(in oklab, var(--primary-text-color) calc(78% + var(--on) * 22%), transparent); }
  .tile .ic { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; --mdc-icon-size: 17px;
    background: color-mix(in oklab, var(--tc) calc(13% + var(--on) * 22%), transparent); color: var(--tc); }
  .tile .ic > * { display: flex; align-items: center; justify-content: center; width: var(--mdc-icon-size); height: var(--mdc-icon-size); line-height: 0; }
  .tile .nm { min-width: 0; font-size: 13px; line-height: 17px; font-weight: 600; letter-spacing: -0.008em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile[data-off] { opacity: 0.5; }
  .grid[data-noicon] .tile { padding-left: 12px; }
  .grid[data-noicon] .tile .ic { display: none; }

  .grid[data-compact] { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain; touch-action: pan-x; padding: 3px; margin: -3px; }
  .grid[data-compact]::-webkit-scrollbar { display: none; }
  .grid[data-compact][data-overflow] { mask-image: linear-gradient(to left, transparent 0, #000 26px); -webkit-mask-image: linear-gradient(to left, transparent 0, #000 26px); }
  .grid[data-compact] .tile { flex: none; height: 34px; padding: 0 12px 0 5px; border-radius: 11px; gap: 7px; }
  .grid[data-compact] .tile .ic { width: 24px; height: 24px; --mdc-icon-size: 15px; }
  .grid[data-compact][data-noicon] .tile { padding-left: 12px; }
  .grid[data-compact] .tile .nm { font-size: 12.5px; }

  .empty { padding: 4px 2px; font-size: 12.5px; font-weight: 500; color: var(--secondary-text-color); }
  @media (prefers-contrast: more) { .tile { color: var(--primary-text-color); } }
`;

class SavvySceneCard extends SavvyCard {
  static getStubConfig(hass) {
    const scenes = (ids) => pick(hass, ids, { domains: "scene" });
    const a = allAreas(hass).find((x) => scenes(areaEntities(hass, x.id)).length);
    if (a) return { area: a.id };
    const any = Object.keys(hass?.states || {}).find((id) => id.startsWith("scene."));
    return any ? { entities: [any] } : {};
  }
  static getConfigElement() { return document.createElement(EDITOR); }

  constructor() {
    super();
    this._tiles = new Map();
    this._fired = new Map();
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("savvy-scene-card: invalid configuration");
    const areas = [].concat(config.area ?? config.areas ?? []).filter(Boolean);
    let strip = null;
    if (typeof config.strip === "string" && config.strip) {
      try { strip = new RegExp(config.strip, "gi"); } catch (err) { strip = null; }
    }
    this._config = { ...config, areas, entities: asItems(config.entities), exclude: asItems(config.exclude).map((i) => i.entity), _strip: strip };
    this._compact = config.layout === "compact";
    if (this._el) { this._build(); if (this._hass) this._update(); }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._el) this._build();
    this._update();
  }

  connectedCallback() {
    if (this._el && this._ro) this._ro.observe(this._el.grid);
    this._wake();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this._litTimer);
  }
  getCardSize() {
    const c = this._config;
    if (!c) return 2;
    const rows = this._compact ? 1 : Math.ceil(Math.max(1, this._tiles.size) / (Number(c.columns) || 3));
    return rows + (this._headed() ? 1 : 0);
  }
  getGridOptions() { return { columns: 12, min_columns: 3, rows: "auto" }; }

  _headed() { const c = this._config; return !!(c.title || c.navigation_path); }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._resetMotion();
    this._tiles.clear();
    const c = this._config;
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="head" id="head" hidden><span class="t" id="title"></span><ha-icon id="chev" icon="mdi:chevron-right" hidden></ha-icon></div>
        <div class="grid" id="grid" role="group"></div>
        <div class="empty" id="empty" hidden></div>
      </ha-card>`;
    const $ = (id) => root.getElementById(id);
    this._el = { card: root.querySelector("ha-card"), head: $("head"), title: $("title"), chev: $("chev"), grid: $("grid"), empty: $("empty") };
    put(this._el.card, "--c", colorOf(c.color || "blue") || "#588ee9");
    attr(this._el.grid, "data-compact", this._compact);
    attr(this._el.grid, "data-noicon", c.show_icon === false);
    const cols = Number(c.columns);
    if (!this._compact && cols >= 1) { attr(this._el.grid, "data-cols", String(cols)); put(this._el.grid, "--cols", String(Math.min(6, Math.round(cols)))); }
    if (c.navigation_path) {
      attr(this._el.head, "role", "button");
      attr(this._el.head, "tabindex", "0");
      this._pressable(this._el.head, { onTap: () => navigate(c.navigation_path) }, 0.03);
    }
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => this._fitRow(this._el.grid));
    this._ro.observe(this._el.grid);
    this._first = true;
  }

  // ---------- which scenes ----------
  _label(item, st, area) {
    if (item.name) return item.name;
    const h = this._hass, c = this._config;
    const raw = st?.attributes.friendly_name || title(String(item.entity).split(".")[1] || item.entity);
    if (c.strip === false) return raw;
    let out = c._strip ? raw.replace(c._strip, "").replace(/\s{2,}/g, " ").trim() : raw;
    const a = area || entityArea(h, item.entity) || c.areas[0];
    const name = a ? areaInfo(h, a).name : "";
    if (name) out = out.replace(new RegExp(`^\\s*${escRe(name)}\\s*(?:[/:|·•–—-]+\\s*)*`, "i"), "").trim();
    return out || raw;
  }

  _items() {
    const h = this._hass, c = this._config, out = [], seen = new Set(c.exclude);
    for (const p of c.entities) {
      if (!p.entity || out.some((o) => o.entity === p.entity)) continue;
      out.push({ ...p, pinned: true });
    }
    const pinned = new Set(out.map((o) => o.entity));
    if (c.auto_discover !== false) {
      const found = [];
      for (const a of c.areas) {
        for (const id of pick(h, areaEntities(h, a), { domains: "scene", exclude: [...seen, ...pinned] })) {
          if (found.some((f) => f.entity === id)) continue;
          found.push({ entity: id, area: a });
        }
      }
      for (const f of found) f.label = this._label(f, h.states[f.entity], f.area);
      found.sort((x, y) => x.label.localeCompare(y.label, langOf(h), { numeric: true }));
      out.push(...found);
    }
    return out;
  }

  // ---------- painting ----------
  _update() {
    const h = this._hass;
    if (!h || !this._el) return;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    const c = this._config, el = this._el;
    const headed = this._headed();
    el.head.hidden = !headed;
    if (headed) {
      text(el.title, c.title || "Scenes");
      el.chev.hidden = !c.navigation_path;
    }
    this._renderTiles(this._items());
    if (this._first) { this._first = false; requestAnimationFrame(() => this._paintAll(null)); }
    this._wake();
  }

  _lit(id, st) {
    const now = Date.now();
    const last = Math.max(this._fired.get(id) || 0, st ? Date.parse(st.state) || 0 : 0);
    return last > 0 && now - last < SCENE_LIT_MS ? last + SCENE_LIT_MS - now : 0;
  }

  _renderTiles(items) {
    const h = this._hass, c = this._config, el = this._el, seen = new Set();
    let nextLit = 0;
    items.forEach((item, at) => {
      const id = item.entity;
      seen.add(id);
      const st = h.states[id];
      let node = this._tiles.get(id);
      if (!node) {
        node = document.createElement("div");
        node.className = "tile";
        node.innerHTML = `<span class="ic"></span><span class="nm"></span>`;
        node.__ic = node.querySelector(".ic");
        node.__nm = node.querySelector(".nm");
        attr(node, "role", "button");
        attr(node, "tabindex", "0");
        node.dataset.entity = id;
        this._pressable(node, { onTap: () => this._run(node.__item, "tap"), onHold: () => this._run(node.__item, "hold") }, 0.035);
        node.__on = this._spring(0, MOTION.ui, `tile:${id}`);
        node.__enter = this._spring(0, MOTION.ui, `tile:${id}`).to(1, MOTION.ui);
        this._tiles.set(id, node);
      }
      node.__item = item;
      const label = item.label ?? this._label(item, st, item.area);
      text(node.__nm, label);
      const down = !st || st.state === "unavailable";
      attr(node, "data-off", down);
      attr(node, "title", label);
      attr(node, "aria-label", down ? `${label}, unavailable` : label);
      put(node, "--tc", item.color ? colorOf(item.color) : "");
      const wantState = !item.icon && !!st;
      if (node.__iconKind !== (wantState ? "state" : "plain")) {
        node.__iconKind = wantState ? "state" : "plain";
        node.__ic.innerHTML = wantState ? "<savvy-state-icon></savvy-state-icon>" : "<ha-icon></ha-icon>";
      }
      const ic = node.__ic.firstElementChild;
      if (wantState) { if (ic.stateObj !== st) { ic.hass = h; ic.stateObj = st; } }
      else attr(ic, "icon", item.icon || SCENE_DEFAULT_ICON);
      const left = down ? 0 : this._lit(id, st);
      attr(node, "data-lit", left > 0);
      if (left > 0) nextLit = Math.max(nextLit, left);
      node.__on.to(left > 0 ? 1 : 0, MOTION.ui);
      place(el.grid, node, at);        // keeps the DOM in the items' order
    });
    for (const [id, node] of this._tiles) {
      if (seen.has(id)) continue;
      for (const s of [node.__on, node.__enter, node.__spring]) { const k = this._springs.indexOf(s); if (k >= 0) this._springs.splice(k, 1); }
      const p = this._pressNodes.indexOf(node);
      if (p >= 0) this._pressNodes.splice(p, 1);
      node.remove();
      this._tiles.delete(id);
    }
    el.empty.hidden = items.length > 0;
    if (!items.length) text(el.empty, c.areas.length || c.entities.length ? "No scenes found in this area." : "Pick an area to list its scenes.");
    el.grid.hidden = !items.length;
    this._fitRow(el.grid);
    clearTimeout(this._litTimer);
    if (nextLit > 0) this._litTimer = setTimeout(() => this._update(), nextLit + 40);
  }

  _run(item, kind) {
    if (!item) return;
    const h = this._hass, id = item.entity, st = h.states[id];
    const a = kind === "tap" ? asAction(item.tap_action ?? defaultTapAction(id)) : asAction(item.hold_action ?? { action: "more-info" });
    if (!a || a.action === "none") return;
    if (kind === "tap" && (!st || st.state === "unavailable") && a.action !== "navigate") return;
    runAction(this, h, a, { entity: id });
    if (kind === "tap" && item.tap_action === undefined) {
      this._fired.set(id, Date.now());
      this._update();
    }
  }

  _paint(dirty, all, red) {
    for (const [id, node] of this._tiles) {
      if (!all && !dirty.has(`tile:${id}`)) continue;
      put(node, "--on", clamp(node.__on.x).toFixed(3));
      const v = clamp(node.__enter.x);
      if (!node.hasAttribute("data-off")) put(node, "opacity", v > 0.999 ? "" : v.toFixed(3));
      put(node, "translate", red || v > 0.999 ? "" : `0 ${((1 - v) * 4).toFixed(2)}px`);
    }
  }
}

// ---------- editor ----------
const SCENE_PICK = { entity: { domain: "scene" } };
const EDITOR = defineEditor("savvy-scene-card", () => [
  { name: "area", label: "Area", helper: "Every scene in these areas is shown. Pick several for one card across rooms.", selector: { area: { multiple: true } } },
  S.text("title", "Title", "Empty: no heading."),
  S.grid({ ...S.select("layout", "Layout", [{ value: "full", label: "Full" }, { value: "compact", label: "Compact (one row)" }]), default: "full" },
    { ...S.number("columns", "Columns", 1, 6), helper: "Empty: 2 to 4, by the card's width." }),
  S.grid(S.color(), S.bool("show_icon", "Show icons", null, true)),
  S.text("strip", "Strip text", "A regular expression taken out of each name, e.g. ^.*//\\s*|\\s*-\\s*on$. The area's name is always taken off the front too."),
  S.nav("navigation_path", "Target page", "Tapping the title goes there."),
  { name: "entities", label: "Pinned", helper: "Shown first, in this order, even from outside the area.", type: "list",
    item: [
      { name: "entity", label: "Scene", selector: SCENE_PICK },
      S.grid(S.text("name", "Name"), S.icon()),
      S.color(),
    ],
    add: { selector: SCENE_PICK, label: "Add a scene" } },
  S.bool("auto_discover", "Auto discover", "Every scene the area has, after the pinned ones.", true),
  { name: "exclude", label: "Never show", selector: { entity: { domain: "scene", multiple: true } } },
]);

registerCard("savvy-scene-card", SavvySceneCard, "Scenes",
  "Every scene of a room (or several) as tiles: one tap runs it, hold for its details.");
