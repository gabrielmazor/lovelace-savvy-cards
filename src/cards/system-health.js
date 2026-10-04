// savvy-system-health-card: what in the house needs attention, with a count pill.
//
// By default it lists everything (source: all), in sections: Watchman (when its sensors are
// given), Offline devices (with the integrations that failed, and the entities that have no
// device) and Low batteries. Or one source on its own. The pill's number is exactly what
// savvy-home-header-card's cog shows: both read core/health.
//
// Offline devices are grouped: every unavailable entity of a device is one issue (the
// device), a hub whose devices are offline (a Zigbee bridge, a coordinator) is one issue for
// all of them, and so is an integration that failed or whose devices are mostly offline.
// Tap a row to open it; tap an entity for its more-info; hold a device for its page in Home
// Assistant. Watchman's section has a chip that runs a new report.
//
//   type: custom:savvy-system-health-card
//   source: all | watchman | offline | battery      (offline is also called unavailable)
//   battery_threshold: 20        exclude_platforms: [mobile_app]
//   watchman: [sensor.watchman_missing_entities, sensor.watchman_missing_actions]
//   group_by: hub | device | none      group_min: 3      details: false
//   warn_above: 6  max_rows: 7   title: …     columns: auto | 1 | 2 | 3   (source all: a column per category when wide)
//   dismiss: true                a button on each row that puts it aside for you (false hides the buttons)
//   watchman_button: true        watchman_report: { parse_config: true }
//   action: { label: Generate report, tap_action: { action: perform-action, perform_action: watchman.report } }
//           (a footer button only when there is an action to run: none by default, and `none` is none)

const SOURCES = {
  all: { title: "Health", noun: "issue", nouns: "issues" },
  watchman: { title: "Watchman", noun: "issue", nouns: "issues" },
  unavailable: { title: "Offline devices", noun: "offline", nouns: "offline" },
  battery: { title: "Batteries", noun: "low", nouns: "low" },
};
const GROUP_TITLE = { watchman: "Watchman", unavailable: "Offline devices", battery: "Low batteries" };
const ALL_FINE = { watchman: "Nothing missing", unavailable: "All devices online", battery: "All batteries fine" };
const REPORT_TIMEOUT = 60000;
const COL_MIN = 240, COL_GAP = 14;
const joinAnd = (parts) => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

const STYLE = `${BASE_CSS}
  ha-card { display: flex; flex-direction: column; gap: 10px; padding: var(--pad); overflow: hidden; --lvl: var(--secondary-text-color); container-name: card; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .name { font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pill { flex: none; display: inline-flex; align-items: center; height: 22px; padding: 0 9px; border-radius: 11px;
    background: color-mix(in oklab, var(--lvl) 16%, transparent); color: color-mix(in oklab, var(--lvl) 78%, var(--primary-text-color));
    font-size: 11px; line-height: 14px; font-weight: 650; letter-spacing: 0.02em; white-space: nowrap; text-transform: uppercase; }
  .empty { display: flex; align-items: center; gap: 8px; padding: 2px 0; color: var(--secondary-text-color); font-size: 12.5px; line-height: 16px; font-weight: 500; }
  .empty ha-icon { --mdc-icon-size: 17px; display: flex; color: var(--lvl-good); }
  .cols { display: grid; gap: 14px; align-items: start; grid-template-columns: minmax(0, 1fr); }
  .rows { container: rows / inline-size; display: flex; flex-direction: column; min-width: 0; max-height: calc(var(--max-rows, 7) * 38px); overflow-y: auto;
    scrollbar-width: none; margin: 0 -4px; padding: 0 4px; }
  .rows::-webkit-scrollbar { display: none; }
  /* only a list that really scrolls keeps the gesture to itself: a short one lets the page scroll over it */
  .rows[data-overflow] { overscroll-behavior-y: contain; -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 22px), transparent 100%);
    mask-image: linear-gradient(to bottom, #000 calc(100% - 22px), transparent 100%); }
  .titles { display: flex; flex-direction: column; min-width: 0; }
  .when { font-size: 11.5px; line-height: 15px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .group { display: flex; align-items: center; gap: 6px; }
  .rows .empty.ok { flex: none; padding: 4px 4px 2px; }
  .group .gw { margin-inline-start: auto; font-weight: 500; letter-spacing: 0; text-transform: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .group { flex: none; margin: 8px 4px 2px; font-size: 11px; line-height: 14px; font-weight: 650; letter-spacing: 0.04em;
    text-transform: uppercase; color: var(--secondary-text-color); }
  .group:first-child { margin-top: 0; }
  .row { flex: none; display: flex; align-items: center; gap: 9px; min-height: 38px; padding: 3px 4px; border-radius: 10px; text-align: start; transform-origin: 0 50%; }
  .row[role="button"] { cursor: pointer; }
  .row[data-group-start] { border-top: 1px solid var(--line); margin-top: 2px; padding-top: 5px; }
  .row[data-dim] { opacity: 0.55; }
  .row .disc { flex: none; display: grid; place-items: center; width: var(--b-s); height: var(--b-s); border-radius: 50%; background: var(--well); color: var(--secondary-text-color); }
  .row .disc ha-icon { --mdc-icon-size: 15px; display: flex; }
  .row[data-alert] .disc { background: color-mix(in oklab, var(--lvl-bad) var(--mix-alert), transparent); color: var(--lvl-bad); }
  .row .col { min-width: 0; flex: 1; display: flex; flex-direction: column; }
  .row .n { font-size: 12.5px; line-height: 16px; font-weight: 600; letter-spacing: -0.006em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .s { font-size: 10.5px; line-height: 13px; font-weight: 500; letter-spacing: 0.006em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row[data-depth="1"] { margin-inline-start: 16px; }
  .row[data-depth="2"] { margin-inline-start: 32px; }
  .row[data-depth="3"] { margin-inline-start: 48px; }
  .report { flex: none; display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 9px 0 6px; border-radius: 11px; margin-inline-start: 6px;
    background: color-mix(in oklab, rgb(var(--accent)) 16%, transparent); color: rgb(var(--accent));
    font-size: 11px; line-height: 14px; font-weight: 650; letter-spacing: 0; text-transform: none; white-space: nowrap; transform-origin: 50% 50%; }
  .report ha-icon { --mdc-icon-size: 14px; display: flex; transform-origin: 50% 50%; }
  .report[hidden] { display: none; }
  .report[data-flash] { background: color-mix(in oklab, var(--lvl-good) 18%, transparent); color: var(--lvl-good); }
  .row[data-soft] .disc { background: color-mix(in oklab, var(--lvl-warn) var(--mix-alert), transparent); color: var(--lvl-warn); }
  .row .chev { flex: none; display: flex; --mdc-icon-size: 18px; color: var(--secondary-text-color); transform-origin: 50% 50%; }
  .facts { flex: none; margin: -1px 4px 3px; font-size: 11.5px; line-height: 15px; font-weight: 500; color: var(--secondary-text-color);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .x { flex: none; display: grid; place-items: center; width: var(--c-s); height: var(--c-s); border-radius: 11px; margin-inline-end: -3px;
    color: var(--secondary-text-color); opacity: 0.62; transform-origin: 50% 50%; }
  .row .x ha-icon { --mdc-icon-size: 18px; display: flex; }
  .row .x:hover { opacity: 1; background: var(--well); }
  :host([kbd]) .row .x:focus-visible { opacity: 1; box-shadow: 0 0 0 2px rgb(var(--accent)); }
  .row .v { flex: none; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--secondary-text-color); }
  .action { flex: none; display: flex; align-items: center; justify-content: center; gap: 6px; height: 34px; margin-top: 2px; border-radius: 11px;
    background: color-mix(in oklab, rgb(var(--accent)) 16%, transparent); color: rgb(var(--accent));
    font-size: 12.5px; line-height: 16px; font-weight: 650; letter-spacing: -0.006em; transform-origin: 50% 50%; }
  @media (prefers-contrast: more) { .row .s { color: var(--primary-text-color); opacity: 0.8; } }
  @container card (max-width: 260px) { .row .s { display: none; } }
  /* a narrow column: the title and the chip on one line, what is wrong under them */
  @container rows (max-width: 340px) {
    .group { flex-wrap: wrap; row-gap: 2px; }
    .group .gt { white-space: nowrap; flex: 1 1 auto; }
    .group .report { order: 2; margin-inline-start: auto; }
    .group .gw { order: 3; flex: 1 0 100%; margin-inline-start: 0; white-space: normal; }
  }
`;

// What the footer button does, or null: it needs a tap_action that is not "none" (or the pre-Savvy
// shape { label, service, data, target }). A label alone, or an empty action, makes no button.
const footerAction = (a) => {
  if (!a || typeof a !== "object") return null;
  let t = a.tap_action;
  if (typeof t === "string") t = { action: t };
  if (!t && a.service) t = { action: "perform-action", perform_action: a.service, data: a.data, target: a.target };
  return t && t.action && t.action !== "none" ? t : null;
};

// The editor's footer section writes `action: { tap_action: { action: none } }` as soon as it is
// touched: that is no action, so it is not saved.
const tidyFooter = (c) => {
  const a = c.action;
  if (!a || typeof a !== "object") return c;
  const out = { ...a };
  const t = out.tap_action;
  if (t === "none" || t?.action === "none" || (t && typeof t === "object" && !Object.keys(t).length)) delete out.tap_action;
  if (!Object.keys(out).filter((k) => out[k] !== "" && out[k] != null).length) { const { action, ...rest } = c; return rest; }
  return { ...c, action: out };
};

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
    const source = (config?.source === "offline" ? "unavailable" : config?.source) || "all";
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
    // failed integrations are only told to us asynchronously
    this._onEntries = this._onEntries || (() => { if (this._hass && this._root) this._update(); });
    entryStore.listeners.add(this._onEntries);
    dismissStore.listeners.add(this._onEntries);
  }
  disconnectedCallback() {
    Clock.remove(this._job); this._ro?.disconnect(); clearInterval(this._ticker); this._ticker = 0;
    entryStore.listeners.delete(this._onEntries);
    dismissStore.listeners.delete(this._onEntries);
    clearTimeout(this._repTimer); clearTimeout(this._flashTimer);
  }

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
        <div class="head" id="head"><span class="titles"><span class="name" id="name"></span><span class="when" id="when" hidden></span></span><span class="pill" id="pill"></span></div>
        <div class="cols" id="cols"></div>
        <button class="action" id="action" hidden></button>
        <button class="report" id="report" hidden><ha-icon icon="mdi:refresh"></ha-icon><span>Run report</span></button>
      </ha-card>`;
    const $ = (id) => this._root.getElementById(id);
    this._el = { card: this._root.querySelector("ha-card"), head: $("head"), name: $("name"), when: $("when"), pill: $("pill"), cols: $("cols"), action: $("action"), report: $("report") };
    this._boxes = new Map();
    this._el.report.remove();
    this._pressable(this._el.report, () => this._runReport());
    this._angle = 0;
    const c = this._config;
    put(this._el.cols, "--max-rows", c.max_rows);
    text(this._el.name, c.title || SOURCES[c.source].title);
    linkTitle(this._root, this._el.name, titlePathOf(c), (el, onTap) => this._pressable(el, onTap));
    // the footer button is off unless it has something to do
    const footer = footerAction(c.action);
    if (footer) {
      this._el.action.hidden = false;
      text(this._el.action, c.action.label || "Run");
      this._pressable(this._el.action, () => {
        haptic("medium");
        runAction(this, this._hass, footer, {});
      });
    }
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => this._fit());
  }

  // One list per category: they sit side by side when the card is wide, and stack when it isn't.
  _box(key) {
    let box = this._boxes.get(key);
    if (!box) {
      box = document.createElement("div");
      box.className = "rows";
      box.__key = key;
      this._boxes.set(key, box);
      this._ro.observe(box);
    }
    return box;
  }

  // `columns`: auto is as many as there are categories, never narrower than COL_MIN each; 1 stacks them
  _layoutCols(count) {
    const want = Number(this._config.columns) || count;
    const n = Math.max(1, Math.min(want, count));
    put(this._el.cols, "grid-template-columns", n === 1 ? "minmax(0, 1fr)"
      : `repeat(auto-fit, minmax(max(${COL_MIN}px, calc((100% - ${(n - 1) * COL_GAP}px) / ${n})), 1fr))`);
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
    const integ = is.filter((i) => i.kind === "integration").length;
    const down = is.filter((i) => i.kind === "hub" || (i.kind === "device" && i.state === "down")).length;
    const part = is.filter((i) => i.kind === "device" && i.state === "partial").length;
    const ent = is.filter((i) => i.kind === "entity").length;
    const main = [];
    if (integ) main.push(plural(integ, "integration", "integrations"));
    if (down) main.push(plural(down, "device", "devices"));
    if (ent) main.push(plural(ent, "entity", "entities"));
    const out = [];
    if (main.length) out.push(`${joinAnd(main)} offline`);
    if (part) out.push(`${part} partly offline`);
    return out.join(", ");
  }

  // Watchman's own words; what the offline devices already explain is said once, not counted twice
  _watchmanLine(sum) {
    const left = sum.counts.watchman, ex = sum.counts.watchmanExplained;
    const say = ({ entities, actions }) => {
      const parts = [];
      if (entities) parts.push(`${entities} missing ${entities === 1 ? "entity" : "entities"}`);
      if (actions) parts.push(`${actions} missing ${actions === 1 ? "action" : "actions"}`);
      return parts.join(", ");
    };
    if (!left && ex) return `${say(sum.counts.watchmanAllKinds)}, all from offline devices`;
    const line = say(sum.counts.watchmanKinds) || plural(left, "missing item", "missing items");
    return ex ? `${line}, ${ex} from offline devices` : line;
  }

  _line(key, sum) {
    const n = sum.counts[key];
    if (key === "watchman" && !n && sum.counts.watchmanExplained) return this._watchmanLine(sum);
    if (!n) return "";
    if (key === "unavailable") return this._offlineLine(sum);
    if (key === "battery") return `${plural(n, "battery", "batteries")} low`;
    return this._watchmanLine(sum);
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
    const t = this._lastRunTime(), n = sum.counts.watchman, ex = sum.counts.watchmanExplained;
    return [Number.isFinite(t) ? `Checked ${since(t, false)}` : "", n ? `${n} missing` : ex ? "nothing else missing" : "nothing missing"].filter(Boolean).join(", ").replace(/^./, (c) => c.toUpperCase());
  }

  // one issue (an integration, a hub, a device, an entity) as a row
  _issueRow(is, depth, open) {
    const det = this._config.details;
    const age = Number.isFinite(is.since) ? duration(Date.now() - is.since) : "";
    const meta = det ? [is.area, is.integration].filter(Boolean).join(" · ") : "";
    const join = (...p) => p.filter(Boolean).join(" · ");
    const refs = is.refs ? `${plural(is.refs, "dashboard reference", "dashboard references")} broken` : "";
    const nav = () => navigate(`/config/devices/device/${is.id}`);
    if (is.kind === "integration") {
      const failed = is.state === "failed";
      const page = () => navigate(`/config/integrations/integration/${is.domain}`);
      return { type: "row", key: is.key, icon: "mdi:puzzle-remove-outline", alert: true, depth, expandable: is.total > 0, open, hold: page, go: page,
        name: is.name,
        secondary: join(failed ? is.label : "", is.total ? `${plural(is.total, "device", "devices")}${failed ? "" : " offline"}` : "", !failed && age && `offline for ${age}`, refs) };
    }
    if (is.kind === "hub") {
      const offline = is.state === "offline";
      return { type: "row", key: is.key, icon: "mdi:access-point-network-off", alert: true, depth, expandable: true, open, hold: nav,
        name: offline ? `${is.name} offline` : `All ${is.total} devices on ${is.name} are offline`,
        secondary: join(meta, offline ? plural(is.total, "device", "devices") : "", age && `offline for ${age}`, refs) };
    }
    if (is.kind === "device") {
      const down = is.state === "down";
      return { type: "row", key: is.key, icon: down ? "mdi:power-plug-off-outline" : "mdi:alert-circle-outline", alert: down, soft: !down, depth, expandable: true, open, hold: nav,
        name: is.name,
        secondary: down ? join(meta, age && `offline for ${age}`, is.down < is.total ? `${is.down} of ${is.total} entities` : is.total > 1 && plural(is.total, "entity", "entities"), refs)
          : join(meta, `${is.down} of ${is.total} entities unavailable`, refs) };
    }
    return { type: "row", key: is.key, icon: "mdi:alert-circle-outline", alert: true, depth, entity: is.entity, name: is.name,
      secondary: depth ? join(is.entity, refs) : join(age && `offline for ${age}`, is.entity, refs) };
  }

  _offlineRows(issues) {
    const out = [];
    const walk = (is, depth) => {
      const open = this._open.has(is.key);
      const row = this._issueRow(is, depth, open);
      if (!depth) row.dismiss = this._dismissOf("off", is.dismissId, is.name, is.members);
      out.push(row);
      if (!open) return;
      if (is.kind === "integration") is.devices.forEach((d) => walk(d, depth + 1));
      else if (is.kind === "hub") { is.entities.forEach((e) => walk(e, depth + 1)); is.devices.forEach((d) => walk(d, depth + 1)); }
      else if (is.kind === "device") is.entities.forEach((e) => walk(e, depth + 1));
    };
    issues.forEach((i) => walk(i, 0));
    return out;
  }

  // what the user has snoozed: one collapsed line under the offline issues, the items dim inside it
  _knownRows(known) {
    const items = [...known.devices, ...known.entities];
    if (!items.length) return [];
    const open = this._open.has("k:known");
    const out = [{ type: "row", key: "k:known", icon: "mdi:bell-sleep-outline", soft: true, depth: 0, expandable: true, open, name: `Known · ${items.length}`,
      secondary: known.refs ? `Snoozed in your settings · ${plural(known.refs, "dashboard reference", "dashboard references")} broken` : "Snoozed in your settings" }];
    if (open) for (const k of items) {
      const age = Number.isFinite(k.since) ? duration(Date.now() - k.since) : "";
      out.push(k.entity
        ? { type: "row", key: k.key, icon: "mdi:bell-sleep-outline", soft: true, depth: 1, entity: k.entity, name: k.name, secondary: [age && `offline for ${age}`, k.entity].filter(Boolean).join(" · ") }
        : { type: "row", key: k.key, icon: "mdi:bell-sleep-outline", soft: true, depth: 1, name: k.name, hold: () => navigate(`/config/devices/device/${k.id}`),
            secondary: [k.area, age && `offline for ${age}`, k.total > 1 && plural(k.total, "entity", "entities")].filter(Boolean).join(" · ") });
    }
    return out;
  }

  // the button on a row: null when the card has them off
  _dismissOf(kind, id, name, members) { return this._config.dismiss === false || !id ? null : { id, kind, name, members }; }
  _dismiss(d) { haptic("light"); dismissAdd(this._hass, d); }
  _restore(d) { haptic("light"); dismissRestore(this._hass, d.kind, d.members); }

  // what this person put aside, one collapsed line at the foot of its category; a row brings its issue back
  _dismissedRows(key, sum) {
    const items = key === "unavailable" ? sum.dismissed.offline : key === "battery" ? sum.dismissed.battery : sum.dismissed.watchman;
    if (!items.length) return [];
    const open = this._open.has(`dm:${key}`);
    const out = [{ type: "row", key: `dm:${key}`, icon: "mdi:bell-off-outline", soft: true, depth: 0, expandable: true, open, name: `Dismissed · ${items.length}`,
      secondary: "Hidden for you. They come back if they break again" }];
    if (!open) return out;
    const kind = key === "unavailable" ? "off" : key === "battery" ? "bat" : "wat";
    for (const it of items) {
      const age = Number.isFinite(it.since) ? duration(Date.now() - it.since) : "";
      const name = it.name, restore = { kind, members: it.members, name };
      if (kind === "off") out.push({ type: "row", key: `dm:${it.key}`, icon: "mdi:bell-off-outline", soft: true, depth: 1, name, restore,
        secondary: [it.area, age && `offline for ${age}`].filter(Boolean).join(" · ") });
      else if (kind === "bat") out.push({ type: "row", key: `dm:${it.entity}`, icon: "mdi:bell-off-outline", soft: true, depth: 1, entity: it.entity, name, value: it.value, restore });
      else out.push({ type: "row", key: `dm:${it.key}`, icon: "mdi:bell-off-outline", soft: true, depth: 1, entity: it.entity, name, secondary: it.secondary, restore });
    }
    return out;
  }

  _batteryRows(sum, all) {
    const det = this._config.details, h = this._hass;
    return (all ? sum.battery : sum.battery.filter((r) => r.alert)).map((r) => {
      const area = det ? entityArea(h, r.entity) : null;
      return { ...r, type: "row", secondary: area ? h.areas?.[area]?.name || title(area.replace(/_/g, " ")) : "", dismiss: r.alert ? this._dismissOf("bat", r.dismissId, r.name, r.members) : null };
    });
  }

  // The rows for this card's source; the pill counts exactly what the home cog counts.
  _compute() {
    const c = this._config, sum = healthSummary(this._hass, c), det = c.details, src = c.source;
    const watchRows = () => sum.watchman.map((r) => ({ ...r, type: "row", dismiss: this._dismissOf("wat", r.dismissId, r.name, r.members) }));
    const section = (key, rows, group) => {
      const out = [];
      if (group) out.push({ type: "group", key: `g:${key}`, title: GROUP_TITLE[key], line: this._line(key, sum) });
      if (det) out.push({ type: "facts", key: `f:${key}`, text: this._facts(key, sum) });
      const aside = sum.counts.dismissedBy[key];
      if (!sum.counts[key]) out.push({ type: "ok", key: `ok:${key}`, text: aside ? "Nothing else needs a look" : key === "watchman" && sum.counts.watchmanExplained ? "Nothing else missing" : ALL_FINE[key] });
      out.push(...rows, ...this._dismissedRows(key, sum));
      return out;
    };
    if (src === "watchman") return { total: sum.counts.watchman, sections: [{ key: "watchman", rows: section("watchman", watchRows(), false) }] };
    if (src === "unavailable") return { total: sum.counts.unavailable, sections: [{ key: "unavailable", rows: section("unavailable", [...this._offlineRows(sum.offline), ...this._knownRows(sum.known)], false) }] };
    if (src === "battery") return { total: sum.counts.battery, sections: [{ key: "battery", rows: section("battery", this._batteryRows(sum, c.show_all_batteries !== false), false) }] };
    // every category shows, with its issue line or a tick and what's fine
    const sections = [];
    if (sum.opts.watchman.length) sections.push({ key: "watchman", rows: section("watchman", watchRows(), true) });
    sections.push({ key: "unavailable", rows: section("unavailable", [...this._offlineRows(sum.offline), ...this._knownRows(sum.known)], true) });
    sections.push({ key: "battery", rows: section("battery", this._batteryRows(sum, false), true) });
    return { total: sum.total, sections };
  }

  _update() {
    const h = this._hass, c = this._config;
    if (!h || !this._root) return;
    this._reduced = MQ.reduced.matches;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    ensureDismissed(h);
    this._lastRun = c.source === "all" || c.source === "watchman" ? watchmanLastRun(h, c) : null;
    if (c.source === "all" || c.source === "unavailable") refreshConfigEntries(h);
    this._checkReport();
    const { total, sections } = this._compute();
    const label = SOURCES[c.source];
    const lvl = total === 0 ? "var(--lvl-good)" : total < c.warn_above ? "var(--lvl-warn)" : "var(--lvl-bad)";
    Motion.tintVar(this._el.card, "--lvl", lvl);
    // the corner glow: amber while a few things need a look, red when it is a lot; nothing when all is well
    stateGlow(c, this._el.card, total === 0 ? null : total < c.warn_above ? [232, 163, 61] : [224, 102, 102], 0.8);
    text(this._el.pill, total === 0 ? "All good" : `${total} ${total === 1 ? label.noun : label.nouns}`);
    attr(this._el.card, "aria-label", `${c.title || label.title}, ${total === 0 ? "all good" : `${total} ${label.nouns}`}`);
    this._renderRows(sections);
    this._placeReport();
    this._tickWhen();
    this._wake();
  }

  // ---------- the Watchman chip: run a new report ----------
  _reportShown() {
    const c = this._config, h = this._hass;
    return (c.source === "all" || c.source === "watchman") && c.watchman_button !== false && healthOptions(c).watchman.length > 0 && !!h?.services?.watchman?.report;
  }

  _placeReport() {
    const chip = this._el.report, show = this._reportShown();
    chip.hidden = !show;
    if (!show) return;
    const host = this._config.source === "watchman" ? this._el.head : this._rows.get("g:watchman");
    if (!host) { chip.hidden = true; return; }
    if (chip.parentNode !== host) host.insertBefore(chip, host === this._el.head ? this._el.pill : null);
    this._paintReport();
  }

  _paintReport() {
    const chip = this._el.report, running = !!this._rep, flash = !!this._flash;
    attr(chip, "data-running", running);
    attr(chip, "data-flash", flash);
    attr(chip, "aria-busy", String(running));
    attr(chip.querySelector("ha-icon"), "icon", running ? "mdi:loading" : flash ? "mdi:check" : "mdi:refresh");
    text(chip.querySelector("span"), running ? "Running…" : flash ? "Done" : "Run report");
    attr(chip, "role", "button");
    attr(chip, "tabindex", "0");
    attr(chip, "aria-label", running ? "Running the Watchman report" : "Run a new Watchman report");
    if (!running) put(chip.querySelector("ha-icon"), "transform", "");
  }

  _runReport() {
    if (this._rep || !this._reportShown()) return;
    const c = this._config;
    haptic("medium");
    this._hass.callService("watchman", "report", { parse_config: true, ...(c.watchman_report || {}) });
    this._rep = { start: Date.now(), base: this._lastRunTime() };
    this._flash = false;
    clearTimeout(this._flashTimer);
    clearTimeout(this._repTimer);
    this._repTimer = setTimeout(() => { this._rep = null; this._paintReport(); }, REPORT_TIMEOUT);
    this._paintReport();
    this._wake();
  }

  // done when Watchman's last-parse timestamp changes
  _checkReport() {
    if (!this._rep) return;
    const t = this._lastRunTime(), base = this._rep.base;
    if (!Number.isFinite(t) || (Number.isFinite(base) && t === base)) return;
    this._rep = null;
    clearTimeout(this._repTimer);
    this._flash = true;
    this._flashTimer = setTimeout(() => { this._flash = false; this._paintReport(); }, 2500);
    this._paintReport();
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
      node.innerHTML = `<span class="disc"><ha-icon></ha-icon></span><span class="col"><span class="n"></span><span class="s"></span></span><span class="v" hidden></span><ha-icon class="chev" icon="mdi:chevron-right" hidden></ha-icon><button class="x" hidden><ha-icon icon="mdi:bell-off-outline"></ha-icon></button>`;
      node.__el = { icon: node.querySelector(".disc ha-icon"), n: node.querySelector(".n"), s: node.querySelector(".s"), v: node.querySelector(".v"), chev: node.querySelector(".chev"),
        x: node.querySelector(".x"), xicon: node.querySelector(".x ha-icon") };
      node.__enter = new Spring(0, MOTION.ui, `row:${r.key}`).to(1, MOTION.ui);
      this._springs.push(node.__enter);
    }
    return node;
  }

  _renderRows(sections) {
    Motion.flip([this._el.cols, ...this._boxes.values()], () => this._renderRowsNow(sections));
  }

  _renderRowsNow(sections) {
    const seen = new Set(), liveBoxes = new Set();
    this._layoutCols(sections.length);
    sections.forEach((sec, bi) => {
      const box = this._box(sec.key);
      liveBoxes.add(sec.key);
      place(this._el.cols, box, bi);
      let at = 0;
      for (const r of sec.rows) {
        seen.add(r.key);
        let node = this._rows.get(r.key);
        if (!node) { node = this._node(r); this._rows.set(r.key, node); }
        if (r.type === "ok") text(node.querySelector("span"), r.text);
        else if (r.type === "group") { text(node.querySelector(".gt"), r.title); text(node.querySelector(".gw"), r.line); }
        else if (r.type === "facts") text(node, r.text);
        else this._fillRow(node, r);
        place(box, node, at++);
      }
    });
    for (const [key, node] of this._rows) {
      if (seen.has(key)) continue;
      for (const s of [node.__enter, node.__spring, node.__chev, node.__el?.x?.__spring]) { const i = this._springs.indexOf(s); if (i >= 0) this._springs.splice(i, 1); }
      for (const n of [node, node.__el?.x]) { const p = this._pressNodes.indexOf(n); if (p >= 0) this._pressNodes.splice(p, 1); }
      node.remove();
      this._rows.delete(key);
    }
    for (const [key, box] of this._boxes) {
      if (liveBoxes.has(key)) continue;
      this._ro.unobserve(box);
      box.remove();
      this._boxes.delete(key);
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
    // the button on the row: dismiss it, or (in the dismissed list) bring it back
    const act = r.dismiss || r.restore;
    el.x.hidden = !act;
    if (act) {
      attr(el.xicon, "icon", r.restore ? "mdi:bell-ring-outline" : "mdi:bell-off-outline");
      attr(el.x, "aria-label", r.restore ? `Bring back ${act.name}` : `Dismiss ${act.name}`);
      attr(el.x, "title", r.restore ? "Bring back" : "Dismiss");
      if (!el.x.__wired) {
        el.x.__wired = true;
        // its press is its own: the row under it does not dip or open
        el.x.addEventListener("pointerdown", (e) => e.stopPropagation());
        this._pressable(el.x, () => { const cur = node.__r; if (cur.restore) this._restore(cur.restore); else if (cur.dismiss) this._dismiss(cur.dismiss); });
      }
    }
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
    if ((r.expandable || live || r.go) && !node.__wired) {
      node.__wired = true;
      attr(node, "role", "button");
      attr(node, "tabindex", "0");
      this._pressable(node, () => this._tapRow(node.__r), r.hold ? () => node.__r.hold?.() : null);
    }
  }

  _tapRow(r) {
    if (r.expandable) {
      if (this._open.has(r.key)) this._open.delete(r.key); else this._open.add(r.key);
      this._update();
    } else if (r.go) r.go();
    else if (r.entity) moreInfo(this, r.entity);
  }

  // Does a list scroll? Measured from where its rows sit, not from scrollHeight: a row that is
  // still sliding in is translated, which grows scrollHeight for a moment and would leave the
  // flag set once it has settled.
  _fit() {
    for (const box of this._boxes?.values() || []) {
      const first = box.firstElementChild, last = box.lastElementChild;
      const content = first ? last.offsetTop + last.offsetHeight - first.offsetTop : 0;
      attr(box, "data-overflow", content > box.clientHeight + 2);
    }
  }

  _wake() { if (this._root && this.isConnected) Clock.add(this._job); }

  _frame(dt) {
    const dirty = new Set();
    for (const s of this._springs) {
      if (s.idle) continue;
      if (this._reduced) s.snap(); else s.step(dt);
      dirty.add(s.group);
    }
    // the report chip's spinner turns while a report runs
    const spinning = !!this._rep && !this._reduced;
    if (spinning) {
      this._angle = (this._angle + dt * 400) % 360;
      put(this._el.report.querySelector("ha-icon"), "transform", `rotate(${this._angle.toFixed(1)}deg)`);
    }
    if (!dirty.size) return spinning;
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
    { value: "all", label: "Everything (Watchman, offline devices, low batteries)" },
    { value: "battery", label: "Batteries" }, { value: "unavailable", label: "Offline devices" }, { value: "watchman", label: "Watchman" },
  ]),
  S.grid(S.text("title", "Title"), S.titleLink("title")),
  S.grid(S.number("battery_threshold", "Battery alert", 1, 100, 1, "%"), S.number("warn_above", "Red threshold", 1, 99)),
  S.number("max_rows", "Max rows", 3, 30),
  { name: "columns", label: "Columns", helper: "Side by side when the card is wide: one column per category. Empty: automatic. 1 keeps them stacked.",
    selector: { number: { min: 1, max: 4, step: 1, mode: "box" } } },
  S.bool("dismiss", "Dismiss button", "A button on each health row that puts it aside for you: it leaves the count and waits under Dismissed, and comes back if it breaks again. Off hides the buttons.", true),
  S.bool("details", "Show details", "A line of facts under each section (how many devices, the lowest battery, when Watchman checked), and area and integration on the rows."),
  S.select("group_by", "Grouping", [
    { value: "hub", label: "Device, and the hub behind it" }, { value: "device", label: "Device" }, { value: "none", label: "Nothing: one row per entity" },
  ]),
  S.number("group_min", "Hub threshold", 2, 50),
  { type: "expandable", name: "ignore", title: "Known problems", schema: [
    { name: "devices", label: "Devices", helper: "Dead and waiting for a replacement? Listed here they leave the count and wait under Known.", selector: { device: { multiple: true } } },
    { name: "entities", label: "Entities", selector: { entity: { multiple: true } } },
  ] },
  { name: "exclude_platforms", label: "Ignored integrations", helper: "By integration, e.g. mobile_app for phones.",
    selector: { select: { multiple: true, custom_value: true, options: ["mobile_app"] } } },
  { name: "watchman", label: "Watchman sensors", helper: "Watchman's missing-entities and missing-actions sensors.",
    selector: { entity: { multiple: true, domain: "sensor" } } },
  S.bool("watchman_button", "Run report chip", "A chip in the Watchman section that runs a new report. Needs the Watchman integration.", true),
  { name: "watchman_report", label: "Report options", helper: "Data sent to watchman.report. Default: parse_config: true.", selector: { object: {} } },
  { name: "watchman_last_run", label: "Last run sensor", helper: "Found automatically (Watchman's last parse). Pick another to override.",
    selector: { entity: { domain: "sensor", device_class: "timestamp" } } },
  ...(c.source === "battery" ? [S.bool("show_all_batteries", "All batteries", "Low ones first, the rest dimmed.")] : []),
  // nested under `action`: ha-form's expandable with a name keeps its fields in that key
  { type: "expandable", name: "action", title: "Footer button", schema: [
    { name: "label", label: "Label", selector: { text: {} } },
    { name: "tap_action", label: "Action", helper: "Off unless you pick an action.", selector: { ui_action: {} } },
  ] },
], tidyFooter);

registerCard("savvy-system-health-card", SavvySystemHealthCard, "System health",
  "What needs attention: offline devices (grouped by device, hub and integration), low batteries and Watchman's findings, with a count.");
