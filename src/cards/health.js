// savvy-health-card: what in the house needs attention, with a count pill.
//
// By default it lists everything (source: all), grouped: Watchman issues (when its sensors
// are given), unavailable entities, low batteries. Or one source on its own. The pill's
// number is exactly what savvy-home-card's cog shows: both read core/health.
//
//   type: custom:savvy-health-card
//   source: all | watchman | unavailable | battery
//   battery_threshold: 20        exclude_platforms: [mobile_app]
//   watchman: [sensor.watchman_missing_entities, sensor.watchman_missing_actions]
//   warn_above: 6  max_rows: 7   title: …
//   action: { label: Generate report, tap_action: { action: perform-action, perform_action: watchman.report } }

const SOURCES = {
  all: { title: "Health", noun: "ISSUE", nouns: "ISSUES" },
  watchman: { title: "Watchman report", noun: "ISSUE", nouns: "ISSUES" },
  unavailable: { title: "Unavailable", noun: "UNAVAILABLE", nouns: "UNAVAILABLE" },
  battery: { title: "Batteries", noun: "LOW", nouns: "LOW" },
};
const GROUP_TITLE = { watchman: "Watchman", unavailable: "Unavailable", battery: "Low batteries" };

const STYLE = `${BASE_CSS}
  ha-card { display: flex; flex-direction: column; gap: 10px; padding: var(--pad); overflow: hidden; --lvl: var(--secondary-text-color); }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .name { font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pill { flex: none; display: inline-flex; align-items: center; height: 22px; padding: 0 9px; border-radius: 11px;
    background: color-mix(in oklab, var(--lvl) 16%, transparent); color: color-mix(in oklab, var(--lvl) 78%, var(--primary-text-color));
    font-size: 11px; line-height: 14px; font-weight: 650; letter-spacing: 0.02em; white-space: nowrap; text-transform: uppercase; }
  .empty { display: flex; align-items: center; gap: 8px; padding: 2px 0; color: var(--secondary-text-color); font-size: 12.5px; line-height: 16px; font-weight: 500; }
  .empty ha-icon { --mdc-icon-size: 17px; display: flex; color: var(--lvl-good); }
  .rows { display: flex; flex-direction: column; max-height: calc(var(--max-rows, 7) * 38px); overflow-y: auto; overscroll-behavior-y: contain;
    scrollbar-width: none; margin: 0 -4px; padding: 0 4px; }
  .rows::-webkit-scrollbar { display: none; }
  .rows[data-overflow] { -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 22px), transparent 100%);
    mask-image: linear-gradient(to bottom, #000 calc(100% - 22px), transparent 100%); }
  .titles { display: flex; flex-direction: column; min-width: 0; }
  .when { font-size: 11.5px; line-height: 15px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .group { display: flex; align-items: baseline; gap: 6px; }
  .group .gs[data-ok] { color: var(--lvl-good); }
  .group .gw { margin-inline-start: auto; font-weight: 500; letter-spacing: 0; text-transform: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .group { flex: none; margin: 8px 4px 2px; font-size: 11px; line-height: 14px; font-weight: 650; letter-spacing: 0.04em;
    text-transform: uppercase; color: var(--secondary-text-color); }
  .group:first-child { margin-top: 0; }
  .row { flex: none; display: flex; align-items: center; gap: 9px; min-height: 38px; padding: 3px 4px; border-radius: 10px; text-align: start; transform-origin: 0 50%; }
  .row[role="button"] { cursor: pointer; }
  .row[data-group-start] { border-top: 1px solid var(--line); margin-top: 2px; padding-top: 5px; }
  .row[data-dim] { opacity: 0.55; }
  .row .disc { flex: none; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--well); color: var(--secondary-text-color); }
  .row .disc ha-icon { --mdc-icon-size: 15px; display: flex; }
  .row[data-alert] .disc { background: color-mix(in oklab, var(--lvl-bad) 18%, transparent); color: var(--lvl-bad); }
  .row .col { min-width: 0; flex: 1; display: flex; flex-direction: column; }
  .row .n { font-size: 12.5px; line-height: 16px; font-weight: 600; letter-spacing: -0.006em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .s { font-size: 10.5px; line-height: 13px; font-weight: 500; letter-spacing: 0.006em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .v { flex: none; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--secondary-text-color); }
  .action { flex: none; display: flex; align-items: center; justify-content: center; gap: 6px; height: 34px; margin-top: 2px; border-radius: 11px;
    background: color-mix(in oklab, rgb(var(--accent)) 16%, transparent); color: rgb(var(--accent));
    font-size: 12.5px; line-height: 16px; font-weight: 650; letter-spacing: -0.006em; transform-origin: 50% 50%; }
  @media (prefers-contrast: more) { .row .s { color: var(--primary-text-color); opacity: 0.8; } }
  @container (max-width: 260px) { .row .s { display: none; } }
`;

class SavvyHealthCard extends HTMLElement {
  static getStubConfig() { return {}; }
  static getConfigElement() { return document.createElement(EDITOR); }

  constructor() {
    super();
    watchKeyboard(this);
    this._job = (now, dt) => this._frame(dt);
    this._rows = new Map();
  }

  setConfig(config) {
    const source = config?.source || "all";
    if (!SOURCES[source]) throw new Error(`savvy-health-card: "source" must be one of ${Object.keys(SOURCES).join(", ")}`);
    // the pre-Savvy names still work: threshold, and entities for the watchman source
    const watchman = config.watchman ?? (source === "watchman" ? config.entities : undefined);
    if (source === "watchman" && !(watchman || []).length) throw new Error('savvy-health-card: the "watchman" source needs its sensors in "watchman"');
    this._config = { warn_above: 6, max_rows: 7, ...config, source,
      battery_threshold: config.battery_threshold ?? config.threshold, watchman };
    if (this._root) { this._build(); if (this._hass) this._update(); }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._root) this._build();
    this._update();
  }

  connectedCallback() {
    this._wake();
    this._ticker = this._ticker || setInterval(() => this._tickWhen(), 30000);
  }
  disconnectedCallback() { Clock.remove(this._job); this._ro?.disconnect(); clearInterval(this._ticker); this._ticker = 0; }

  // "Checked 2 h ago": under the title for the Watchman source, on its group in "all"
  _tickWhen() {
    if (!this._el) return;
    const st = this._lastRun && this._hass?.states[this._lastRun];
    const t = st ? Date.parse(st.state) : NaN;
    const words = Number.isFinite(t) ? `Checked ${since(t, false)}` : "";
    const tip = Number.isFinite(t) ? clockTime(t, langOf(this._hass)) : null;
    const under = this._config.source === "watchman";
    this._el.when.hidden = !under || !words;
    text(this._el.when, under ? words : "");
    attr(this._el.when, "title", under ? tip : null);
    for (const node of this._rows.values()) {
      if (!node.__lastRun) continue;
      text(node.querySelector(".gw"), words);
      attr(node.querySelector(".gw"), "title", tip);
    }
  }
  getCardSize() { return 3; }
  getGridOptions() { return { columns: 6, min_columns: 4, rows: "auto" }; }

  _build() {
    this._root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._springs = [];
    this._pressNodes = [];
    this._rows.clear();
    this._root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="head"><span class="titles"><span class="name" id="name"></span><span class="when" id="when" hidden></span></span><span class="pill" id="pill"></span></div>
        <div class="empty" id="empty" hidden><ha-icon icon="mdi:check-circle-outline"></ha-icon><span>All good</span></div>
        <div class="rows" id="rows"></div>
        <button class="action" id="action" hidden></button>
      </ha-card>`;
    const $ = (id) => this._root.getElementById(id);
    this._el = { card: this._root.querySelector("ha-card"), name: $("name"), when: $("when"), pill: $("pill"), empty: $("empty"), rows: $("rows"), action: $("action") };
    const c = this._config;
    put(this._el.rows, "--max-rows", c.max_rows);
    text(this._el.name, c.title || SOURCES[c.source].title);
    if (c.action) {
      this._el.action.hidden = false;
      text(this._el.action, c.action.label || "Run");
      this._pressable(this._el.action, () => {
        const a = c.action;
        // the pre-Savvy shape { label, service, data, target } still works
        const act = a.tap_action || (a.service ? { action: "perform-action", perform_action: a.service, data: a.data, target: a.target } : null);
        haptic("medium");
        runAction(this, this._hass, act, {});
      });
    }
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => this._fit());
    this._ro.observe(this._el.rows);
  }

  _pressable(el, onTap) {
    const spring = new Spring(0, MOTION.press, `p${this._springs.length}`);
    this._springs.push(spring);
    this._pressNodes.push(el);
    el.__spring = spring;
    bindPress(el, { spring, wake: () => this._wake(), onTap, haptic: null });
  }

  // The rows for this card's source; the pill counts exactly what the home cog counts.
  _compute() {
    const c = this._config, sum = healthSummary(this._hass, c);
    const src = c.source;
    if (src === "watchman") return { total: sum.counts.watchman, rows: sum.watchman };
    if (src === "unavailable") return { total: sum.counts.unavailable, rows: sum.unavailable };
    if (src === "battery") return { total: sum.counts.battery, rows: c.show_all_batteries === false ? sum.battery.filter((r) => r.alert) : sum.battery };
    // every category shows, with its count or All good (Watchman when its sensors are set)
    const rows = [];
    for (const key of ["watchman", "unavailable", "battery"]) {
      if (key === "watchman" && !sum.opts.watchman.length) continue;
      const list = key === "battery" ? sum.battery.filter((r) => r.alert) : sum[key];
      rows.push({ key: `g:${key}`, group: GROUP_TITLE[key], count: sum.counts[key], lastRun: key === "watchman" });
      rows.push(...list.map((r) => ({ ...r, groupStart: false, dim: false })));
    }
    return { total: sum.total, rows };
  }

  _update() {
    const h = this._hass, c = this._config;
    if (!h || !this._root) return;
    this._reduced = MQ.reduced.matches;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    const { total, rows } = this._compute();
    const label = SOURCES[c.source];
    const lvl = total === 0 ? "var(--lvl-good)" : total < c.warn_above ? "var(--lvl-warn)" : "var(--lvl-bad)";
    put(this._el.card, "--lvl", lvl);
    text(this._el.pill, total === 0 ? "All good" : `${total} ${total === 1 ? label.noun : label.nouns}`);
    attr(this._el.card, "aria-label", `${c.title || label.title}, ${total === 0 ? "all good" : `${total} ${label.nouns.toLowerCase()}`}`);
    this._el.empty.hidden = rows.length > 0;
    this._el.rows.hidden = rows.length === 0;
    this._lastRun = c.source === "all" || c.source === "watchman" ? watchmanLastRun(h, c) : null;
    this._renderRows(rows);
    this._tickWhen();     // after the rows: the Watchman group shows it too
    this._wake();
  }

  _renderRows(rows) {
    const box = this._el.rows, seen = new Set();
    for (const r of rows) {
      seen.add(r.key);
      let node = this._rows.get(r.key);
      if (!node) {
        node = document.createElement("div");
        if (r.group) {
          node.className = "group";
          node.innerHTML = `<span class="gt"></span><span class="gs"></span><span class="gw"></span>`;
        }
        else {
          node.className = "row";
          node.innerHTML = `<span class="disc"><ha-icon></ha-icon></span><span class="col"><span class="n"></span><span class="s"></span></span><span class="v" hidden></span>`;
          node.__el = { icon: node.querySelector("ha-icon"), n: node.querySelector(".n"), s: node.querySelector(".s"), v: node.querySelector(".v") };
          node.__enter = new Spring(0, MOTION.ui, `row:${r.key}`).to(1, MOTION.ui);
          this._springs.push(node.__enter);
        }
        this._rows.set(r.key, node);
      }
      if (r.group) {
        text(node.querySelector(".gt"), r.group);
        text(node.querySelector(".gs"), r.count ? `· ${r.count}` : "· All good");
        attr(node.querySelector(".gs"), "data-ok", !r.count);
        node.__lastRun = r.lastRun;
        box.appendChild(node);
        continue;
      }
      attr(node.__el.icon, "icon", r.icon);
      text(node.__el.n, r.name);
      text(node.__el.s, r.secondary || "");
      node.__el.s.hidden = !r.secondary;
      node.__el.v.hidden = !r.value;
      if (r.value) text(node.__el.v, r.value);
      attr(node, "title", r.tooltip || null);
      attr(node, "data-alert", r.alert);
      attr(node, "data-dim", r.dim);
      attr(node, "data-group-start", r.groupStart);
      if (r.entity && this._hass.states[r.entity] && !node.__wired) {
        node.__wired = true;
        attr(node, "role", "button");
        attr(node, "tabindex", "0");
        this._pressable(node, () => moreInfo(this, r.entity));
      }
      box.appendChild(node);
    }
    for (const [key, node] of this._rows) {
      if (seen.has(key)) continue;
      for (const s of [node.__enter, node.__spring]) { const i = this._springs.indexOf(s); if (i >= 0) this._springs.splice(i, 1); }
      const p = this._pressNodes.indexOf(node);
      if (p >= 0) this._pressNodes.splice(p, 1);
      node.remove();
      this._rows.delete(key);
    }
    this._fit();
  }

  _fit() {
    const el = this._el?.rows;
    if (el) attr(el, "data-overflow", el.scrollHeight > el.clientHeight + 1);
  }

  _wake() { if (this._root && this.isConnected) Clock.add(this._job); }

  _frame(dt) {
    const dirty = new Set();
    for (const s of this._springs) {
      if (s.idle) continue;
      if (this._reduced) s.snap(); else s.step(dt);
      dirty.add(s.group);
    }
    if (!dirty.size) return false;
    this._paint(dirty);
    return true;
  }

  _paint(dirty) {
    const red = this._reduced;
    for (const node of this._pressNodes) {
      const s = node.__spring;
      if (!s || !dirty.has(s.group)) continue;
      const p = s.x;
      put(node, "transform", red || Math.abs(p) < 1e-4 ? "" : `scale(${(1 - 0.04 * p).toFixed(4)})`);
      put(node, "opacity", Math.abs(p) > 1e-3 ? (1 - (red ? 0.2 : 0.1) * clamp(p)).toFixed(3) : "");
    }
    for (const [key, node] of this._rows) {
      const s = node.__enter;
      if (!s || !dirty.has(`row:${key}`)) continue;
      const v = clamp(s.x);
      put(node, "opacity", v > 0.999 ? "" : v.toFixed(3));
      put(node, "translate", red || v > 0.999 ? "" : `0 ${((1 - v) * 4).toFixed(2)}px`);
    }
  }
}

const EDITOR = defineEditor("savvy-health-card", (hass, c) => [
  S.select("source", "What to list", [
    { value: "all", label: "Everything (Watchman, unavailable, low batteries)" },
    { value: "battery", label: "Batteries" }, { value: "unavailable", label: "Unavailable entities" }, { value: "watchman", label: "Watchman report" },
  ]),
  S.text("title", "Title"),
  S.grid(S.number("battery_threshold", "Low battery below", 1, 100, 1, "%"), S.number("warn_above", "Red from", 1, 99)),
  S.number("max_rows", "Rows before scrolling", 3, 30),
  { name: "exclude_platforms", label: "Ignore integrations", helper: "By integration, e.g. mobile_app for phones.",
    selector: { select: { multiple: true, custom_value: true, options: ["mobile_app"] } } },
  { name: "watchman", label: "Watchman sensors", helper: "Watchman's missing-entities and missing-actions sensors.",
    selector: { entity: { multiple: true, domain: "sensor" } } },
  { name: "watchman_last_run", label: "Watchman's last-run sensor", helper: "Found automatically (Watchman's last parse). Pick another to override.",
    selector: { entity: { domain: "sensor", device_class: "timestamp" } } },
  ...(c.source === "battery" ? [S.bool("show_all_batteries", "Show every battery", "Low ones first, the rest dimmed.")] : []),
  // nested under `action`: ha-form's expandable with a name keeps its fields in that key
  { type: "expandable", name: "action", title: "Footer button", schema: [
    { name: "label", label: "Label", selector: { text: {} } },
    { name: "tap_action", label: "When pressed", selector: { ui_action: {} } },
  ] },
]);

registerCard("savvy-health-card", SavvyHealthCard, "Health",
  "What needs attention: unavailable entities, low batteries and Watchman issues, with a count.");
