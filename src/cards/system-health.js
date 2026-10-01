// savvy-system-health-card: what in the house needs attention, with a count pill.
//
// By default it lists everything (source: all), in sections: Broken references (Watchman,
// when its sensors are given), Offline (devices, and the entities that have no device) and
// Low batteries. Or one source on its own. The pill's number is exactly what
// savvy-home-header-card's cog shows: both read core/health.
//
// Offline is grouped: every unavailable entity of a device is one issue (the device), and a
// hub whose devices are down (a Zigbee bridge, a coordinator) is one issue for all of them.
// Tap a hub or a device to open it; tap an entity for its more-info; hold a device for its
// page in Home Assistant.
//
//   type: custom:savvy-system-health-card
//   source: all | watchman | unavailable | battery
//   battery_threshold: 20        exclude_platforms: [mobile_app]
//   watchman: [sensor.watchman_missing_entities, sensor.watchman_missing_actions]
//   group_by: hub | device | none      group_min: 3      details: false
//   warn_above: 6  max_rows: 7   title: …
//   action: { label: Generate report, tap_action: { action: perform-action, perform_action: watchman.report } }

const SOURCES = {
  all: { title: "Health", noun: "issue", nouns: "issues" },
  watchman: { title: "Broken references", noun: "issue", nouns: "issues" },
  unavailable: { title: "Offline", noun: "offline", nouns: "offline" },
  battery: { title: "Batteries", noun: "low", nouns: "low" },
};
const GROUP_TITLE = { watchman: "Broken references", unavailable: "Offline", battery: "Low batteries" };
const ALL_FINE = { watchman: "No broken references", unavailable: "Everything is online", battery: "All batteries fine" };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const joinAnd = (parts) => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

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
  .rows .empty.ok { flex: none; padding: 4px 4px 2px; }
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
  .row[data-depth="1"] { margin-inline-start: 16px; }
  .row[data-depth="2"] { margin-inline-start: 32px; }
  .row[data-soft] .disc { background: color-mix(in oklab, var(--lvl-warn) 20%, transparent); color: var(--lvl-warn); }
  .row .chev { flex: none; display: flex; --mdc-icon-size: 18px; color: var(--secondary-text-color); transform-origin: 50% 50%; }
  .facts { flex: none; margin: -1px 4px 3px; font-size: 11.5px; line-height: 15px; font-weight: 500; color: var(--secondary-text-color);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .v { flex: none; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--secondary-text-color); }
  .action { flex: none; display: flex; align-items: center; justify-content: center; gap: 6px; height: 34px; margin-top: 2px; border-radius: 11px;
    background: color-mix(in oklab, rgb(var(--accent)) 16%, transparent); color: rgb(var(--accent));
    font-size: 12.5px; line-height: 16px; font-weight: 650; letter-spacing: -0.006em; transform-origin: 50% 50%; }
  @media (prefers-contrast: more) { .row .s { color: var(--primary-text-color); opacity: 0.8; } }
  @container (max-width: 260px) { .row .s { display: none; } }
`;

class SavvySystemHealthCard extends HTMLElement {
  static getStubConfig() { return {}; }
  static getConfigElement() { return document.createElement(EDITOR); }

  constructor() {
    super();
    watchKeyboard(this);
    this._job = (now, dt) => this._frame(dt);
    this._rows = new Map();
    this._open = new Set();      // keys of the hub / device rows that are expanded
  }

  setConfig(config) {
    const source = config?.source || "all";
    if (!SOURCES[source]) throw new Error(`savvy-system-health-card: "source" must be one of ${Object.keys(SOURCES).join(", ")}`);
    // the pre-Savvy names still work: threshold, and entities for the watchman source
    const watchman = config.watchman ?? (source === "watchman" ? config.entities : undefined);
    if (source === "watchman" && !(watchman || []).length) throw new Error('savvy-system-health-card: the "watchman" source needs its sensors in "watchman"');
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
    this._ticker = this._ticker || setInterval(() => this._hass && this._update(), 30000);
  }
  disconnectedCallback() { Clock.remove(this._job); this._ro?.disconnect(); clearInterval(this._ticker); this._ticker = 0; }

  // "Checked 2 h ago", under the title for the Watchman source
  _tickWhen() {
    if (!this._el) return;
    const t = this._lastRunTime();
    const words = Number.isFinite(t) ? `Checked ${since(t, false)}` : "";
    const tip = Number.isFinite(t) ? clockTime(t, langOf(this._hass)) : null;
    const under = this._config.source === "watchman";
    this._el.when.hidden = !under || !words;
    text(this._el.when, under ? words : "");
    attr(this._el.when, "title", under ? tip : null);
  }
  _lastRunTime() {
    const st = this._lastRun && this._hass?.states[this._lastRun];
    return st ? Date.parse(st.state) : NaN;
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
        <div class="rows" id="rows"></div>
        <button class="action" id="action" hidden></button>
      </ha-card>`;
    const $ = (id) => this._root.getElementById(id);
    this._el = { card: this._root.querySelector("ha-card"), name: $("name"), when: $("when"), pill: $("pill"), rows: $("rows"), action: $("action") };
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

  _pressable(el, onTap, onHold) {
    const spring = new Spring(0, MOTION.press, `p${this._springs.length}`);
    this._springs.push(spring);
    this._pressNodes.push(el);
    el.__spring = spring;
    bindPress(el, { spring, wake: () => this._wake(), onTap, onHold, haptic: null });
  }

  // ---------- what to say ----------
  _offlineLine(sum) {
    const is = sum.offline;
    const down = is.filter((i) => i.kind === "hub" || (i.kind === "device" && i.state === "down")).length;
    const part = is.filter((i) => i.kind === "device" && i.state === "partial").length;
    const ent = is.filter((i) => i.kind === "entity").length;
    const parts = [];
    if (down) parts.push(`${plural(down, "device", "devices")} offline`);
    if (part) parts.push(`${part} partly offline`);
    if (ent) parts.push(down || part ? plural(ent, "entity", "entities") : `${plural(ent, "entity", "entities")} offline`);
    return joinAnd(parts);
  }

  _line(key, sum) {
    const n = sum.counts[key];
    if (!n) return "";
    if (key === "unavailable") return this._offlineLine(sum);
    if (key === "battery") return `${plural(n, "battery", "batteries")} low`;
    return plural(n, "broken reference", "broken references");
  }

  _facts(key, sum) {
    if (key === "unavailable") {
      const { total, down } = sum.stats.devices;
      if (!total) return "";
      return down ? `${total - down} of ${plural(total, "device", "devices")} online` : `${plural(total, "device", "devices")}, ${total === 1 ? "online" : "all online"}`;
    }
    if (key === "battery") {
      const { count, lowest } = sum.stats.batteries;
      return count ? `${plural(count, "battery", "batteries")}, lowest ${Math.round(lowest)}%` : "No batteries found";
    }
    const t = this._lastRunTime(), n = sum.counts.watchman;
    return `${Number.isFinite(t) ? `Checked ${since(t, false)}, ` : ""}${plural(n, "problem", "problems")}`;
  }

  // one issue (a hub, a device, an entity) as a row
  _issueRow(is, depth, open) {
    const det = this._config.details;
    const age = Number.isFinite(is.since) ? duration(Date.now() - is.since) : "";
    const meta = det ? [is.area, is.integration].filter(Boolean).join(" · ") : "";
    const join = (...p) => p.filter(Boolean).join(" · ");
    const nav = () => navigate(`/config/devices/device/${is.id}`);
    if (is.kind === "hub") {
      const offline = is.state === "offline";
      return { type: "row", key: is.key, icon: "mdi:access-point-network-off", alert: true, depth, expandable: true, open, hold: nav,
        name: offline ? `${is.name} offline` : `All ${is.total} devices on ${is.name} are offline`,
        secondary: join(meta, offline ? plural(is.total, "device", "devices") : "", age && `offline for ${age}`) };
    }
    if (is.kind === "device") {
      const down = is.state === "down";
      return { type: "row", key: is.key, icon: down ? "mdi:power-plug-off-outline" : "mdi:alert-circle-outline", alert: down, soft: !down, depth, expandable: true, open, hold: nav,
        name: is.name,
        secondary: down ? join(meta, age && `offline for ${age}`, is.total > 1 && plural(is.total, "entity", "entities"))
          : join(meta, `${is.down} of ${is.total} entities unavailable`) };
    }
    return { type: "row", key: is.key, icon: "mdi:alert-circle-outline", alert: true, depth, entity: is.entity, name: is.name,
      secondary: depth ? is.entity : join(age && `offline for ${age}`, is.entity) };
  }

  _offlineRows(issues) {
    const out = [];
    const walk = (is, depth) => {
      const open = this._open.has(is.key);
      out.push(this._issueRow(is, depth, open));
      if (!open) return;
      if (is.kind === "hub") { is.entities.forEach((e) => walk(e, depth + 1)); is.devices.forEach((d) => walk(d, depth + 1)); }
      else if (is.kind === "device") is.entities.forEach((e) => walk(e, depth + 1));
    };
    issues.forEach((i) => walk(i, 0));
    return out;
  }

  _batteryRows(sum, all) {
    const det = this._config.details, h = this._hass;
    return (all ? sum.battery : sum.battery.filter((r) => r.alert)).map((r) => {
      const area = det ? entityArea(h, r.entity) : null;
      return { ...r, type: "row", secondary: area ? h.areas?.[area]?.name || title(area.replace(/_/g, " ")) : "" };
    });
  }

  // The rows for this card's source; the pill counts exactly what the home cog counts.
  _compute() {
    const c = this._config, sum = healthSummary(this._hass, c), det = c.details, src = c.source;
    const watchRows = () => sum.watchman.map((r) => ({ ...r, type: "row" }));
    const section = (key, rows, group) => {
      const out = [];
      if (group) out.push({ type: "group", key: `g:${key}`, title: GROUP_TITLE[key], line: this._line(key, sum) });
      if (det) out.push({ type: "facts", key: `f:${key}`, text: this._facts(key, sum) });
      if (!sum.counts[key]) out.push({ type: "ok", key: `ok:${key}`, text: ALL_FINE[key] });
      out.push(...rows);
      return out;
    };
    if (src === "watchman") return { total: sum.counts.watchman, rows: section("watchman", watchRows(), false) };
    if (src === "unavailable") return { total: sum.counts.unavailable, rows: section("unavailable", this._offlineRows(sum.offline), false) };
    if (src === "battery") return { total: sum.counts.battery, rows: section("battery", this._batteryRows(sum, c.show_all_batteries !== false), false) };
    // every category shows, with its issue line or a tick and what's fine
    const rows = [];
    if (sum.opts.watchman.length) rows.push(...section("watchman", watchRows(), true));
    rows.push(...section("unavailable", this._offlineRows(sum.offline), true));
    rows.push(...section("battery", this._batteryRows(sum, false), true));
    return { total: sum.total, rows };
  }

  _update() {
    const h = this._hass, c = this._config;
    if (!h || !this._root) return;
    this._reduced = MQ.reduced.matches;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    this._lastRun = c.source === "all" || c.source === "watchman" ? watchmanLastRun(h, c) : null;
    const { total, rows } = this._compute();
    const label = SOURCES[c.source];
    const lvl = total === 0 ? "var(--lvl-good)" : total < c.warn_above ? "var(--lvl-warn)" : "var(--lvl-bad)";
    put(this._el.card, "--lvl", lvl);
    text(this._el.pill, total === 0 ? "All good" : `${total} ${total === 1 ? label.noun : label.nouns}`);
    attr(this._el.card, "aria-label", `${c.title || label.title}, ${total === 0 ? "all good" : `${total} ${label.nouns}`}`);
    this._renderRows(rows);
    this._tickWhen();
    this._wake();
  }

  _node(r) {
    const node = document.createElement("div");
    if (r.type === "ok") {
      node.className = "empty ok";
      node.innerHTML = `<ha-icon icon="mdi:check-circle-outline"></ha-icon><span></span>`;
    } else if (r.type === "group") {
      node.className = "group";
      node.innerHTML = `<span class="gt"></span><span class="gw"></span>`;
    } else if (r.type === "facts") {
      node.className = "facts";
    } else {
      node.className = "row";
      node.innerHTML = `<span class="disc"><ha-icon></ha-icon></span><span class="col"><span class="n"></span><span class="s"></span></span><span class="v" hidden></span><ha-icon class="chev" icon="mdi:chevron-right" hidden></ha-icon>`;
      node.__el = { icon: node.querySelector(".disc ha-icon"), n: node.querySelector(".n"), s: node.querySelector(".s"), v: node.querySelector(".v"), chev: node.querySelector(".chev") };
      node.__enter = new Spring(0, MOTION.ui, `row:${r.key}`).to(1, MOTION.ui);
      this._springs.push(node.__enter);
    }
    return node;
  }

  _renderRows(rows) {
    const box = this._el.rows, seen = new Set();
    let at = 0;
    for (const r of rows) {
      seen.add(r.key);
      let node = this._rows.get(r.key);
      if (!node) { node = this._node(r); this._rows.set(r.key, node); }
      if (r.type === "ok") text(node.querySelector("span"), r.text);
      else if (r.type === "group") { text(node.querySelector(".gt"), r.title); text(node.querySelector(".gw"), r.line); }
      else if (r.type === "facts") text(node, r.text);
      else this._fillRow(node, r);
      place(box, node, at++);
    }
    for (const [key, node] of this._rows) {
      if (seen.has(key)) continue;
      for (const s of [node.__enter, node.__spring, node.__chev]) { const i = this._springs.indexOf(s); if (i >= 0) this._springs.splice(i, 1); }
      const p = this._pressNodes.indexOf(node);
      if (p >= 0) this._pressNodes.splice(p, 1);
      node.remove();
      this._rows.delete(key);
    }
    this._fit();
  }

  _fillRow(node, r) {
    node.__r = r;
    const el = node.__el;
    attr(el.icon, "icon", r.icon);
    text(el.n, r.name);
    text(el.s, r.secondary || "");
    el.s.hidden = !r.secondary;
    el.v.hidden = !r.value;
    if (r.value) text(el.v, r.value);
    attr(node, "title", r.tooltip || null);
    attr(node, "data-alert", r.alert);
    attr(node, "data-soft", r.soft);
    attr(node, "data-dim", r.dim);
    attr(node, "data-group-start", r.groupStart);
    attr(node, "data-depth", r.depth || null);
    el.chev.hidden = !r.expandable;
    attr(node, "aria-expanded", r.expandable ? String(!!r.open) : null);
    if (r.expandable) {
      if (!node.__chev) {
        node.__chev = new Spring(r.open ? 1 : 0, MOTION.ui, `chev:${r.key}`);
        this._springs.push(node.__chev);
        put(el.chev, "transform", r.open ? "rotate(90deg)" : "");
        node.__open = !!r.open;
      } else if (node.__open !== !!r.open) {
        node.__open = !!r.open;
        node.__chev.to(r.open ? 1 : 0, MOTION.ui);
      }
    }
    const live = r.entity && this._hass.states[r.entity];
    if ((r.expandable || live) && !node.__wired) {
      node.__wired = true;
      attr(node, "role", "button");
      attr(node, "tabindex", "0");
      this._pressable(node, () => this._tapRow(node.__r), r.expandable ? () => node.__r.hold?.() : null);
    }
  }

  _tapRow(r) {
    if (r.expandable) {
      if (this._open.has(r.key)) this._open.delete(r.key); else this._open.add(r.key);
      this._update();
    } else if (r.entity) moreInfo(this, r.entity);
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
      if (s && dirty.has(`row:${key}`)) {
        const v = clamp(s.x);
        put(node, "opacity", v > 0.999 ? "" : v.toFixed(3));
        put(node, "translate", red || v > 0.999 ? "" : `0 ${((1 - v) * 4).toFixed(2)}px`);
      }
      const c = node.__chev;
      if (c && dirty.has(`chev:${key}`)) put(node.__el.chev, "transform", `rotate(${(90 * clamp(c.x)).toFixed(1)}deg)`);
    }
  }
}

const EDITOR = defineEditor("savvy-system-health-card", (hass, c) => [
  S.select("source", "List", [
    { value: "all", label: "Everything (broken references, offline, low batteries)" },
    { value: "battery", label: "Batteries" }, { value: "unavailable", label: "Offline devices" }, { value: "watchman", label: "Broken references (Watchman)" },
  ]),
  S.text("title", "Title"),
  S.grid(S.number("battery_threshold", "Battery alert", 1, 100, 1, "%"), S.number("warn_above", "Red threshold", 1, 99)),
  S.number("max_rows", "Max rows", 3, 30),
  S.bool("details", "Show details", "A line of facts under each section (how many devices, the lowest battery, when Watchman checked), and area and integration on the rows."),
  S.select("group_by", "Grouping", [
    { value: "hub", label: "Device, and the hub behind it" }, { value: "device", label: "Device" }, { value: "none", label: "Nothing: one row per entity" },
  ]),
  S.number("group_min", "Hub threshold", 2, 50),
  { name: "exclude_platforms", label: "Ignored integrations", helper: "By integration, e.g. mobile_app for phones.",
    selector: { select: { multiple: true, custom_value: true, options: ["mobile_app"] } } },
  { name: "watchman", label: "Watchman sensors", helper: "Watchman's missing-entities and missing-actions sensors.",
    selector: { entity: { multiple: true, domain: "sensor" } } },
  { name: "watchman_last_run", label: "Last run sensor", helper: "Found automatically (Watchman's last parse). Pick another to override.",
    selector: { entity: { domain: "sensor", device_class: "timestamp" } } },
  ...(c.source === "battery" ? [S.bool("show_all_batteries", "All batteries", "Low ones first, the rest dimmed.")] : []),
  // nested under `action`: ha-form's expandable with a name keeps its fields in that key
  { type: "expandable", name: "action", title: "Footer button", schema: [
    { name: "label", label: "Label", selector: { text: {} } },
    { name: "tap_action", label: "Action", selector: { ui_action: {} } },
  ] },
]);

registerCard("savvy-system-health-card", SavvySystemHealthCard, "System health",
  "What needs attention: offline devices (grouped by device and hub), low batteries and Watchman's broken references, with a count.");
