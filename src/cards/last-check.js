// savvy-last-check-card: the last look before you go, or before bed. It finds what would be left
// behind (lights on, music playing, the A/C running, an unlocked door, an open garage), lists it by
// room, and one slide turns it all off. What it can't fix itself (an open window or door) stays on the
// list as something that needs you. It never unlocks anything.
//
//   type: custom:savvy-last-check-card
//   mode: leave | goodnight               (leave: lights, players, climate, fans, locks, garage and gate;
//                                          goodnight: the same without the climate)
//   area: hallway                         (or a list; empty: the whole house)
//   title: Leaving?                       (default by mode)     title_path: /lovelace/home
//   domains: [light, media_player, ...]   (replaces the mode's list: light, media_player, climate, fan,
//                                          lock, cover, switch, input_boolean, humidifier, siren)
//   include: [switch.coffee]              (more entities to turn off, any domain that can be turned off)
//   exclude: [light.hall]                 (never touched; the Savvy settings' ignore list too)
//   blockers: false                       (open doors and windows are listed as things that need you)
//   block: true                           (refuse to run while something needs you)
//   then: { action: perform-action, perform_action: scene.turn_on, target: { entity_id: scene.night } }
//                                         (after a clean run: one action, or a list)
//   slide_label: Slide to leave           layout: full | compact     max_rows: 8
//
// Rooms group the list; each row has a tick to leave that one out this time. Blockers are read only.
// A thing that does not turn off within 8 seconds shows a retry.

const LC_SETTLE_MS = 8000;       // how long a thing may take to turn off before it shows a retry
const LC_GAP_MS = 90;            // the cascade: each call follows the last by this much
const LC_END = 0.9;              // how far across counts as the end of the slide
const LC_MODES = {
  leave: { title: "Leaving?", slide: "Slide to leave", icon: "mdi:home-export-outline", clear: "Everything is off and locked", domains: ["light", "media_player", "climate", "fan", "lock", "cover"] },
  goodnight: { title: "Goodnight", slide: "Slide for goodnight", icon: "mdi:weather-night", clear: "Ready for the night", domains: ["light", "media_player", "fan", "lock", "cover"] },
};
const LC_TURN_OFF = new Set(["light", "switch", "input_boolean", "fan", "climate", "humidifier", "siren", "media_player", "water_heater", "valve"]);
const LC_BLOCKERS = ["door", "window", "garage_door", "opening"];
const LC_COVERS = ["garage", "gate"];
const LC_MEDIA_OFF = 256, LC_MEDIA_STOP = 4096;

// what "left behind" means per domain, and the service that fixes it
const LC_FIX = {
  light: { on: (s) => s === "on", svc: ["light", "turn_off"] },
  switch: { on: (s) => s === "on", svc: ["switch", "turn_off"] },
  input_boolean: { on: (s) => s === "on", svc: ["input_boolean", "turn_off"] },
  fan: { on: (s) => s === "on", svc: ["fan", "turn_off"] },
  humidifier: { on: (s) => s === "on", svc: ["humidifier", "turn_off"] },
  siren: { on: (s) => s === "on", svc: ["siren", "turn_off"] },
  climate: { on: (s) => s !== "off", svc: ["climate", "turn_off"] },
  water_heater: { on: (s) => s !== "off", svc: ["water_heater", "turn_off"] },
  valve: { on: (s) => s === "open" || s === "opening", svc: ["valve", "close_valve"] },
  lock: { on: (s) => s === "unlocked" || s === "open" || s === "unlocking", svc: ["lock", "lock"] },
  cover: { on: (s) => s === "open" || s === "opening", svc: ["cover", "close_cover"] },
  media_player: { on: (s) => ["playing", "on", "buffering", "paused"].includes(s),
    svc: (st) => { const f = st?.attributes.supported_features || 0; return f & LC_MEDIA_OFF ? ["media_player", "turn_off"] : f & LC_MEDIA_STOP ? ["media_player", "media_stop"] : ["media_player", "media_pause"]; } },
};

const STYLE = `${BASE_CSS}
  ha-card { --pad: 14px; --tone: var(--warn-rgb); position: relative; display: flex; flex-direction: column; gap: 10px; padding: var(--pad); overflow: hidden; }
  :host([data-compact]) ha-card { --pad: 12px; gap: 8px; }
  ha-card > * { position: relative; }
  .head { display: flex; align-items: center; gap: 10px; min-height: 28px; }
  .head .t { flex: 1; min-width: 0; font-size: 17px; line-height: 22px; font-weight: 620; letter-spacing: -0.021em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pill { flex: none; display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: 12px; white-space: nowrap;
    font-size: 12px; font-weight: 650; color: rgb(var(--tone)); background: color-mix(in oklab, rgb(var(--tone)) var(--mix-on), transparent); }
  .list { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .area { margin: 10px 4px 2px; font-size: 13px; line-height: 17px; font-weight: 600; letter-spacing: -0.006em; color: var(--secondary-text-color); }
  .area:first-child { margin-top: 0; }
  .row { --rt: var(--warn-rgb); --tk: 1; --dn: 0; display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 44px; padding: 4px 4px 4px 2px; border-radius: 14px; }
  .row[data-kind="block"] { --rt: var(--bad-rgb); }
  .row .ic { flex: none; display: grid; place-items: center; width: var(--b-m); height: var(--b-m); border-radius: 50%; --mdc-icon-size: 20px;
    color: color-mix(in oklab, rgb(var(--good-rgb)) calc(var(--dn) * 100%), rgb(var(--rt))); background: transparent; --mdc-icon-size: 22px; }
  .row .ic > * { display: flex; align-items: center; justify-content: center; line-height: 0; }
  .row[data-st="done"] .ic { color: rgb(var(--good-rgb)); }
  .row .who { flex: 1; min-width: 0; display: flex; flex-direction: column; text-align: start; border-radius: 10px; cursor: pointer; }
  .row .nm { font-size: 14px; line-height: 18px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .sub { font-size: 12.5px; line-height: 16px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row[data-kind="block"] .sub { color: rgb(var(--bad-rgb)); }
  .row[data-st="fail"] .sub { color: rgb(var(--bad-rgb)); }
  .chk { flex: none; position: relative; display: grid; place-items: center; width: var(--c-s); height: var(--c-s); border-radius: 11px; --mdc-icon-size: 18px;
    background: color-mix(in oklab, rgb(var(--rt)) calc(var(--mix-on) * var(--tk)), var(--well)); color: rgb(var(--rt)); }
  .chk ha-icon { display: flex; opacity: calc(var(--tk) + var(--dn)); transform: scale(calc(0.6 + 0.4 * min(1, var(--tk) + var(--dn)))); }
  .row[data-st="done"] .chk { color: rgb(var(--good-rgb)); background: color-mix(in oklab, rgb(var(--good-rgb)) var(--mix-on), transparent); }
  .row[data-st="fail"] .chk { color: rgb(var(--bad-rgb)); background: color-mix(in oklab, rgb(var(--bad-rgb)) var(--mix-alert), transparent); }
  .row[data-st="run"] .chk ha-icon, .row[data-st="wait"] .chk ha-icon { opacity: 0; }
  .row[data-st="run"] .chk::after, .row[data-st="wait"] .chk::after { content: ""; position: absolute; width: 14px; height: 14px; border-radius: 50%;
    border: 2px solid color-mix(in oklab, rgb(var(--rt)) 30%, transparent); border-top-color: rgb(var(--rt)); animation: lc-spin 0.8s linear infinite; }
  .row[data-st="wait"] .chk::after { animation: none; opacity: 0.5; }
  .row[data-kind="block"] .chk { display: none; }
  .row[data-kind="block"] .chev { display: flex; }
  .chev { display: none; flex: none; color: var(--secondary-text-color); --mdc-icon-size: 18px; margin-inline-end: 6px; }
  .more { align-self: flex-start; margin: 2px 0 0 2px; padding: 4px 10px; border-radius: 11px; background: var(--well); font-size: 12.5px; font-weight: 650; color: var(--secondary-text-color); cursor: pointer; }
  .sum { font-size: 13px; line-height: 18px; font-weight: 500; color: var(--secondary-text-color); }
  .clear { display: flex; align-items: center; gap: 10px; min-height: 44px; font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
  .clear .ic { flex: none; display: grid; place-items: center; width: var(--b-m); height: var(--b-m); border-radius: 50%; --mdc-icon-size: 20px; color: rgb(var(--good-rgb));
    background: color-mix(in oklab, rgb(var(--good-rgb)) var(--mix-on), transparent); }
  .clear .ic ha-icon { display: flex; }
  .status { display: flex; align-items: center; gap: 8px; min-height: 52px; padding: 0 14px; border-radius: 26px; font-size: 13.5px; font-weight: 650; background: var(--well); }
  .status[data-tone="good"] { color: rgb(var(--good-rgb)); background: color-mix(in oklab, rgb(var(--good-rgb)) var(--mix-on), transparent); }
  .status[data-tone="bad"] { color: rgb(var(--bad-rgb)); background: color-mix(in oklab, rgb(var(--bad-rgb)) var(--mix-alert), transparent); }
  .slide { --p: 0; --sc: var(--warn-rgb); position: relative; height: 52px; border-radius: 26px; touch-action: pan-y; user-select: none; -webkit-user-select: none;
    background: color-mix(in oklab, rgb(var(--sc)) 8%, var(--well)); overflow: hidden; }
  .slide[aria-disabled="true"] { --sc: var(--bad-rgb); }
  .slide .fill { position: absolute; left: 0; top: 0; bottom: 0; width: calc(4px + var(--p) * (100% - 4px)); border-radius: inherit; background: rgb(var(--sc) / 0.22); }
  .slide .lbl { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding-inline-start: 44px; font-size: 13.5px; font-weight: 650;
    letter-spacing: -0.006em; color: color-mix(in oklab, rgb(var(--sc)) 70%, var(--primary-text-color)); opacity: calc(1 - var(--p) * 1.4); pointer-events: none; }
  .slide .hint { position: absolute; inset-inline-end: 16px; top: 0; bottom: 0; display: flex; align-items: center; color: rgb(var(--sc)); opacity: calc(0.55 * (1 - var(--p) * 1.5)); --mdc-icon-size: 20px; pointer-events: none; }
  .slide .hint ha-icon { display: flex; }
  .slide .h { position: absolute; left: 4px; top: 4px; width: var(--b-l); height: var(--b-l); border-radius: 50%; display: grid; place-items: center; cursor: grab; touch-action: none;
    background: rgb(var(--sc)); color: #fff; --mdc-icon-size: 22px; box-shadow: 0 2px 8px rgb(0 0 0 / 0.25); outline: none; transform: translateX(calc(var(--p) * var(--max, 0px))); }
  .slide[data-drag] .h { cursor: grabbing; }
  .slide .h ha-icon { display: flex; }
  .empty { padding: 4px 2px; font-size: 12.5px; font-weight: 500; color: var(--secondary-text-color); }
  @keyframes lc-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .row .chk::after { animation: none; } }
  @media (prefers-contrast: more) { .row .sub, .sum { color: var(--primary-text-color); } }
`;

class SavvyLastCheckCard extends SavvyCard {
  static getStubConfig() { return { mode: "leave" }; }
  static getConfigElement() { return document.createElement(EDITOR); }

  constructor() {
    super();
    this._nodes = new Map();
    this._off = new Set();
    this._snap = null;
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("savvy-last-check-card: invalid configuration");
    const mode = LC_MODES[config.mode] ? config.mode : "leave";
    const areas = [].concat(config.area ?? config.areas ?? []).filter(Boolean);
    const domains = [].concat(config.domains ?? LC_MODES[mode].domains).filter((d) => LC_FIX[d]);
    this._config = { ...config, mode, areas, domains, include: asItems(config.include).map((i) => i.entity),
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
    clearTimeout(this._tickT);
    clearTimeout(this._clearT);
    for (const t of this._callTs || []) clearTimeout(t);
    this._callTs = [];
  }
  getCardSize() { return this._compact ? 2 : 2 + Math.min(this._nodes.size, this._config?.max_rows || 8); }
  getGridOptions() { return { columns: 12, min_columns: 4, rows: "auto" }; }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._resetMotion();
    this._nodes.clear();
    this._sl = this._spring(0, MOTION.ui, "slide", 0.002);
    const c = this._config, m = LC_MODES[c.mode];
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="head"><span class="t" id="title"></span><span class="pill" id="pill"></span></div>
        <div class="sum" id="sum" hidden></div>
        <div class="list" id="list"></div>
        <button class="more" id="more" hidden></button>
        <div class="clear" id="clear" hidden><span class="ic"><ha-icon icon="mdi:check"></ha-icon></span><span id="clearTx"></span></div>
        <div class="status" id="status" hidden></div>
        <div class="slide" id="slide" role="button" tabindex="0" hidden>
          <span class="fill"></span><span class="lbl" id="lbl"></span>
          <span class="hint"><ha-icon icon="mdi:chevron-double-right"></ha-icon></span>
          <span class="h" id="handle"><ha-icon id="hIcon"></ha-icon></span>
        </div>
      </ha-card>`;
    const $ = (id) => root.getElementById(id);
    this._el = { card: root.querySelector("ha-card"), title: $("title"), pill: $("pill"), sum: $("sum"), list: $("list"), more: $("more"), clear: $("clear"), clearTx: $("clearTx"),
      status: $("status"), slide: $("slide"), lbl: $("lbl"), handle: $("handle"), hIcon: $("hIcon") };
    attr(this._el.hIcon, "icon", m.icon);
    linkTitle(root, this._el.title, titlePathOf(c), (el, onTap) => this._pressable(el, { onTap }, 0.04));
    this._pressable(this._el.more, { onTap: () => { this._all = !this._all; this._update(); } }, 0.05);
    this._wireSlide();
    this._ro?.disconnect();
    this._first = true;
  }

  // ---------- what would be left behind ----------
  _scan() {
    const h = this._hass, c = this._config;
    const skip = new Set(c.exclude), skipArea = new Set(c.exclude_areas);
    let ids = c.areas.length ? [...new Set(c.areas.flatMap((a) => areaEntities(h, a)))] : houseEntities(h);
    for (const id of c.include) if (h.states[id] && !ids.includes(id)) ids = [...ids, id];
    const fix = [], block = [];
    const want = new Set(c.domains), inc = new Set(c.include);
    for (const id of ids) {
      if (skip.has(id)) continue;
      const area = entityArea(h, id);
      if (area && skipArea.has(area)) continue;
      const st = h.states[id];
      if (!st || st.state === "unavailable" || st.state === "unknown") continue;
      const d = domainOf(id);
      const rule = LC_FIX[d];
      if (rule && (want.has(d) || inc.has(id))) {
        // a cover is only a garage or a gate unless it was asked for by name
        if (d === "cover" && !inc.has(id) && !LC_COVERS.includes(st.attributes.device_class)) continue;
        if (rule.on(st.state)) fix.push({ entity: id, domain: d, area, svc: typeof rule.svc === "function" ? rule.svc(st) : rule.svc });
        continue;
      }
      if (c.blockers === false) continue;
      if (d === "binary_sensor" && st.state === "on" && LC_BLOCKERS.includes(st.attributes.device_class)) block.push({ entity: id, domain: d, area });
      else if (d === "lock" && st.state === "jammed") block.push({ entity: id, domain: d, area });
    }
    return { fix, block };
  }

  _label(id, area) {
    const h = this._hass;
    const raw = h.states[id]?.attributes.friendly_name || title(id.split(".")[1].replace(/_/g, " "));
    const name = area ? areaInfo(h, area).name : "";
    const out = name ? raw.replace(new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[/:|·–—-]*\\s*`, "i"), "").trim() : raw;
    return out || raw;
  }

  // ---------- painting ----------
  _update() {
    const h = this._hass;
    if (!h || !this._el) return;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    this.toggleAttribute("data-compact", this._compact);
    const c = this._config, el = this._el, m = LC_MODES[c.mode];
    text(el.title, c.title || m.title);
    const scan = this._scan();
    this._settle();
    const snap = this._snap;
    const rows = snap ? snap.items : scan.fix.map((i) => ({ ...i, label: this._label(i.entity, i.area) }));
    for (const r of rows) r.label = r.label || this._label(r.entity, r.area);
    const blockers = scan.block.map((i) => ({ ...i, kind: "block", label: this._label(i.entity, i.area) }));
    const todo = snap ? snap.items.filter((i) => i.st === "wait" || i.st === "run").length : scan.fix.filter((i) => !this._off.has(i.entity)).length;
    const failed = snap ? snap.items.filter((i) => i.st === "fail").length : 0;
    this._todo = todo;
    this._blockers = blockers.length;

    // the summary: what is left, what needs you, or all set
    let tone = "warn", pill;
    if (snap && todo) pill = `${snap.items.length - todo} of ${snap.items.length}`;
    else if (failed) { tone = "bad"; pill = `${failed} didn't turn off`; }
    else if (todo) pill = `${todo} to do`;
    else if (blockers.length) { tone = "bad"; pill = `${blockers.length} ${blockers.length === 1 ? "needs" : "need"} you`; }
    else { tone = "good"; pill = "All set"; }
    text(el.pill, pill);
    put(el.card, "--tone", `var(--${tone}-rgb)`);
    stateGlow(c, el.card, tone === "good" ? null : tone === "bad" ? [224, 102, 102] : [232, 163, 61], 0.8);
    attr(el.card, "aria-label", `${c.title || m.title}, ${pill}`);

    // rows: fixes first, then what needs you, grouped by room when there is more than one
    const all = [...rows.map((r) => ({ ...r, kind: "fix" })), ...blockers];
    const limit = Math.max(1, Number(c.max_rows) || 8);
    // what needs you always shows; the limit is for the list of things to turn off
    const fixes = all.filter((r) => r.kind !== "block"), needs = all.filter((r) => r.kind === "block");
    const shown = this._all || this._compact ? all : [...fixes.slice(0, limit), ...needs];
    this._renderRows(this._compact ? [] : shown);
    const hidden = all.length - shown.length;
    el.more.hidden = this._compact || hidden <= 0;
    if (hidden > 0) text(el.more, `+${hidden} more`);
    el.sum.hidden = !this._compact || !all.length;
    if (this._compact) text(el.sum, this._summary(rows, blockers));
    const empty = !all.length;
    el.clear.hidden = !empty;
    text(el.clearTx, m.clear);

    // the slide, the progress, or the result
    const running = !!snap && !snap.done;
    const canSlide = !snap && todo > 0;
    const blocked = canSlide && c.block === true && blockers.length > 0;
    el.slide.hidden = !canSlide;
    attr(el.slide, "aria-disabled", blocked ? "true" : "false");
    attr(el.slide, "aria-label", `${c.slide_label || m.slide}${blocked ? ", close what is open first" : ""}`);
    text(el.lbl, blocked ? "Close what is open first" : c.slide_label || m.slide);
    const statusOn = !!snap;
    el.status.hidden = !statusOn;
    if (snap) {
      let msg, st = "";
      if (running) msg = `Turning things off · ${snap.items.length - todo} of ${snap.items.length}`;
      else if (failed) { msg = `${failed} didn't turn off · tap one to retry`; st = "bad"; }
      else if (blockers.length) { msg = `${blockers.length} ${blockers.length === 1 ? "thing needs" : "things need"} you`; st = "bad"; }
      else { msg = "All set"; st = "good"; }
      text(el.status, msg);
      attr(el.status, "data-tone", st);
    }
    if (this._first) { this._first = false; requestAnimationFrame(() => this._paintAll(null)); }
    this._wake();
  }

  _summary(rows, blockers) {
    const names = rows.filter((r) => !this._off.has(r.entity)).map((r) => r.label);
    const bits = names.length > 3 ? [...names.slice(0, 3), `+${names.length - 3}`] : names;
    return [bits.join(", "), blockers.length ? `${blockers.length} open: ${blockers.map((b) => b.label).slice(0, 2).join(", ")}` : ""].filter(Boolean).join(" · ");
  }

  _renderRows(rows) {
    const el = this._el, h = this._hass, seen = new Set();
    const areas = new Set(rows.map((r) => r.area || ""));
    const grouped = areas.size > 1;
    const ordered = [...rows].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "block" ? 1 : -1))
      .sort((a, b) => (grouped && a.kind === b.kind ? (a.area ? 0 : 1) - (b.area ? 0 : 1) || areaInfo(h, a.area).name.localeCompare(areaInfo(h, b.area).name, langOf(h)) : 0));
    let at = 0, last = null;
    const add = (node) => { place(el.list, node, at++); };
    // the first group is the fixable things, then the ones that need you, each by room
    for (const r of ordered) {
      if (grouped) {
        const key = `${r.kind}:${r.area || ""}`;
        if (key !== last) {
          last = key;
          const id = `a:${key}`;
          seen.add(id);
          let lab = this._nodes.get(id);
          if (!lab) { lab = document.createElement("div"); lab.className = "area"; this._nodes.set(id, lab); }
          text(lab, `${r.kind === "block" ? "Needs you · " : ""}${r.area ? areaInfo(h, r.area).name : "No room"}`);
          add(lab);
        }
      }
      const id = `r:${r.entity}`;
      seen.add(id);
      let node = this._nodes.get(id);
      if (!node) { node = this._rowNode(r); this._nodes.set(id, node); }
      this._fillRow(node, r);
      add(node);
    }
    for (const [id, node] of this._nodes) {
      if (seen.has(id)) continue;
      for (const s of [node.__tk, node.__dn, node.__enter, node.__spring]) { const i = this._springs.indexOf(s); if (i >= 0) this._springs.splice(i, 1); }
      for (const n of [node, node.__chk, node.__who]) { const p = this._pressNodes.indexOf(n); if (p >= 0) this._pressNodes.splice(p, 1); }
      node.remove();
      this._nodes.delete(id);
    }
  }

  _rowNode(r) {
    const node = document.createElement("div");
    node.className = "row";
    node.innerHTML = `<span class="ic"><savvy-state-icon></savvy-state-icon></span>
      <button class="who"><span class="nm"></span><span class="sub"></span></button>
      <button class="chk"><ha-icon icon="mdi:check"></ha-icon></button><ha-icon class="chev" icon="mdi:chevron-right"></ha-icon>`;
    node.__ic = node.querySelector("savvy-state-icon");
    node.__who = node.querySelector(".who");
    node.__chk = node.querySelector(".chk");
    node.__tk = this._spring(1, MOTION.ui, `row:${r.entity}`, 0.002);
    node.__dn = this._spring(0, MOTION.ui, `row:${r.entity}`, 0.002);
    node.__enter = this._spring(0, MOTION.ui, `row:${r.entity}`).to(1, MOTION.ui);
    this._pressable(node.__who, { onTap: () => moreInfo(this, node.__r.entity) }, 0.02);
    this._pressable(node.__chk, { onTap: () => this._tick(node.__r), haptic: null }, 0.1);
    return node;
  }

  _fillRow(node, r) {
    const h = this._hass, st = h.states[r.entity];
    node.__r = r;
    attr(node, "data-kind", r.kind);
    attr(node, "data-st", r.st || null);
    if (st && node.__ic.stateObj !== st) { node.__ic.hass = h; node.__ic.stateObj = st; }
    text(node.querySelector(".nm"), r.label);
    const state = st ? stateText(h, st) : "";
    const area = r.area ? areaInfo(h, r.area).name : "";
    const sub = r.st === "fail" ? "Still on · tap to retry" : r.kind === "block" ? (r.domain === "lock" ? "Jammed" : "Open") + (area ? ` · ${area}` : "") : state;
    text(node.querySelector(".sub"), sub);
    const off = this._off.has(r.entity) && !r.st;
    node.__tk.to(off ? 0 : 1, MOTION.ui);
    node.__dn.to(r.st === "done" ? 1 : 0, MOTION.ui);
    attr(node.__chk, "aria-pressed", String(!off));
    attr(node.__chk, "aria-label", r.st === "fail" ? `Retry ${r.label}` : off ? `Include ${r.label}` : `Leave out ${r.label}`);
    attr(node.__chk.querySelector("ha-icon"), "icon", r.st === "fail" ? "mdi:refresh" : "mdi:check");
  }

  _tick(r) {
    if (!r) return;
    haptic("selection");
    if (r.st === "fail") return this._retry(r);
    if (this._snap) return;
    if (this._off.has(r.entity)) this._off.delete(r.entity); else this._off.add(r.entity);
    this._update();
  }

  // ---------- the run ----------
  _run() {
    const c = this._config;
    if (this._snap) return;
    const scan = this._scan();
    if (c.block === true && scan.block.length) { haptic("failure"); return; }
    const items = scan.fix.filter((i) => !this._off.has(i.entity)).map((i) => ({ ...i, label: this._label(i.entity, i.area), st: "wait", at: 0 }));
    if (!items.length) return;
    haptic("light");
    this._snap = { items, done: false, t0: Date.now() };
    this._callTs = items.map((it, i) => setTimeout(() => this._call(it), i * LC_GAP_MS));
    this._update();
  }

  _call(it) {
    it.st = "run";
    it.at = Date.now();
    try {
      const p = this._hass.callService(it.svc[0], it.svc[1], {}, { entity_id: it.entity });
      p?.catch?.(() => { it.st = "fail"; this._update(); });
    } catch (err) { it.st = "fail"; }
    this._update();
  }

  _retry(r) {
    const it = this._snap?.items.find((i) => i.entity === r.entity);
    if (!it) return;
    it.svc = typeof LC_FIX[it.domain].svc === "function" ? LC_FIX[it.domain].svc(this._hass.states[it.entity]) : LC_FIX[it.domain].svc;
    this._snap.done = false;
    this._snap.fired = false;
    clearTimeout(this._clearT);
    this._call(it);
  }

  // what has turned off, what is still waiting, and when the run is over
  _settle() {
    const snap = this._snap, h = this._hass;
    if (!snap) return;
    const now = Date.now();
    let waiting = false;
    for (const it of snap.items) {
      if (it.st !== "run") { if (it.st === "wait") waiting = true; continue; }
      const st = h.states[it.entity];
      if (!st || !LC_FIX[it.domain].on(st.state)) it.st = "done";
      else if (now - it.at > LC_SETTLE_MS) it.st = "fail";
      else waiting = true;
    }
    clearTimeout(this._tickT);
    if (waiting) { this._tickT = setTimeout(() => this._update(), 400); return; }
    if (snap.done) return;
    snap.done = true;
    const failed = snap.items.some((i) => i.st === "fail");
    haptic(failed ? "failure" : "success");
    // after a clean run (and nothing needing you, unless you block on it) the `then` action goes
    if (!failed && !snap.fired) {
      snap.fired = true;
      const then = this._config.then;
      if (then && !(this._config.block === true && this._scan().block.length)) {
        for (const a of [].concat(then)) runAction(this, h, asAction(a), {});
      }
    }
    clearTimeout(this._clearT);
    this._clearT = setTimeout(() => { this._snap = null; this._off.clear(); this._update(); }, failed ? 12000 : 6000);
  }

  // ---------- the slide ----------
  _wireSlide() {
    const el = this._el, track = el.slide, handle = el.handle;
    let down = null, x0 = 0, max = 0;
    const set = (p) => { this._sl.snap(p); this._paintSlide(); };
    handle.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      e.stopPropagation();
      down = e.pointerId;
      x0 = e.clientX;
      max = Math.max(1, track.clientWidth - handle.offsetWidth - 8);
      put(track, "--max", `${max}px`);
      attr(track, "data-drag", "");
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      haptic("light");
    });
    handle.addEventListener("pointermove", (e) => {
      if (e.pointerId !== down) return;
      const blocked = track.getAttribute("aria-disabled") === "true";
      set(clamp((e.clientX - x0) / max) * (blocked ? 0.25 : 1));
    });
    const up = (e) => {
      if (e.pointerId !== down) return;
      down = null;
      track.removeAttribute("data-drag");
      const go = e.type === "pointerup" && this._sl.x >= LC_END && track.getAttribute("aria-disabled") !== "true";
      if (go) this._run();
      else if (e.type === "pointerup" && this._sl.x >= 0.2 && track.getAttribute("aria-disabled") === "true") haptic("failure");
      this._sl.to(0, MOTION.ui);
      this._wake();
    };
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
    // a tap or the keyboard nudges the handle; Enter or Space runs it without the drag
    track.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      if (track.getAttribute("aria-disabled") === "true") return haptic("failure");
      this._run();
    });
    handle.addEventListener("click", () => { if (!down && this._sl.x < 0.05) { this._sl.snap(0.18); this._sl.to(0, MOTION.ui); this._wake(); } });
  }

  _paintSlide() {
    put(this._el.slide, "--p", clamp(this._sl.x).toFixed(3));
  }

  _paint(dirty, all, red) {
    if (all || dirty.has("slide")) this._paintSlide();
    for (const [, node] of this._nodes) {
      if (!node.__tk) continue;
      put(node, "--tk", clamp(node.__tk.x).toFixed(3));
      put(node, "--dn", clamp(node.__dn.x).toFixed(3));
      const v = clamp(node.__enter.x);
      put(node, "opacity", v > 0.999 ? "" : v.toFixed(3));
      put(node, "translate", red || v > 0.999 ? "" : `0 ${((1 - v) * 4).toFixed(2)}px`);
    }
  }
}

// ---------- editor ----------
const EDITOR = defineEditor("savvy-last-check-card", () => [
  S.select("mode", "Routine", [{ value: "leave", label: "Leaving" }, { value: "goodnight", label: "Goodnight" }]),
  S.grid(S.text("title", "Title", "Empty: by routine."), S.titleLink("title")),
  { name: "area", label: "Areas", helper: "Empty: the whole house.", selector: { area: { multiple: true } } },
  { name: "domains", label: "What to turn off", helper: "Empty: Leaving checks lights, players, climate, fans, locks, garage and gate; Goodnight the same without the climate.",
    selector: { select: { multiple: true, mode: "list", options: [
      { value: "light", label: "Lights" }, { value: "media_player", label: "Players" }, { value: "climate", label: "Climate" }, { value: "fan", label: "Fans" },
      { value: "lock", label: "Locks" }, { value: "cover", label: "Garage and gate" }, { value: "switch", label: "Switches" }, { value: "input_boolean", label: "Input booleans" },
    ] } } },
  { name: "include", label: "Also turn off", helper: "Entities to include, any kind that can be turned off.", selector: { entity: { multiple: true } } },
  { name: "exclude", label: "Never touch", selector: { entity: { multiple: true } } },
  S.grid(S.bool("blockers", "Open doors and windows", "Listed as things that need you.", true), S.bool("block", "Wait for them", "Refuse to run while one is open.")),
  S.grid(S.text("slide_label", "Slide label"), S.select("layout", "Layout", [{ value: "full", label: "Full" }, { value: "compact", label: "Compact" }])),
  S.number("max_rows", "Max rows", 3, 30),
  S.action("then", "After a clean run", "Optional: a scene, a script or any action to run once everything is off."),
  GLOW_FIELD,
]);

registerCard("savvy-last-check-card", SavvyLastCheckCard, "Last check",
  "The last look before you leave or go to bed: what would be left on, listed by room, and one slide turns it off.");
