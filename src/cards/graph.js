// savvy-graph-card: a tile per entity, each one finding its own kind from its state.
//   graph   a number that's reporting (not a timestamp): a chart, two per row at every
//           width. Smoothed line over a fading fill, dashed average, min and max, an axis,
//           a scrub bubble (hover, or press and hold still). Thresholds colour it
//           good / warn / bad down the value axis. With no history yet it keeps its shape.
//   state   anything else (on/off, a timestamp, text): a small tile with its state.
//
// Each graph shows its own hours_to_show, else the card's; graphs sharing a range share
// one history call. An hours selector is opt-in (ranges: [24, 168, 720]) and drives every
// graph that hasn't pinned its own. Past a week, graphs read long-term statistics.
//
//   type: custom:savvy-graph-card
//   title: System
//   entities:
//     - entity: sensor.processor_use
//       thresholds: [{ value: 0, level: good }, { value: 60, level: warn }, { value: 85, level: bad }]

const CHART_H = 72;
const SCRUB_SLOP = 6;        // press-and-dwell: move sooner and it's a scroll, hold still and it scrubs
const SCRUB_DWELL = 140;

// The level whose value the reading has most recently crossed.
function levelOf(value, thresholds) {
  if (!thresholds?.length || !Number.isFinite(value)) return null;
  let level = null;
  for (const t of [...thresholds].sort((a, b) => a.value - b.value)) if (value >= t.value) level = t.level;
  return level;
}

const STYLE = `${BASE_CSS}
  ha-card { display: flex; flex-direction: column; gap: 10px; padding: var(--pad); }
  .head { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .head .ht { flex: 1; min-width: 0; font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ranges { position: relative; flex: none; display: flex; gap: 2px; padding: 3px; border-radius: 11px; background: var(--well); }
  .ranges .sel { position: absolute; top: 3px; bottom: 3px; left: 0; border-radius: 8px; pointer-events: none;
    background: var(--ha-card-background, var(--card-background-color)); box-shadow: 0 1px 3px rgb(0 0 0 / 0.14), 0 0 0 0.5px rgb(0 0 0 / 0.04); }
  :host([dark]) .ranges .sel { background: color-mix(in oklab, var(--primary-text-color) 14%, transparent); box-shadow: none; }
  .rseg { position: relative; height: 24px; padding: 0 9px; border-radius: 8px; display: flex; align-items: center; cursor: pointer;
    font-size: 11.5px; line-height: 16px; font-weight: 550; color: var(--secondary-text-color); transform-origin: 50% 50%; }
  .rseg[data-sel] { color: var(--primary-text-color); }
  .graphs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .grid { display: grid; grid-template-columns: repeat(var(--cols, auto-fill), minmax(92px, 1fr)); gap: 8px; }
  .tile { position: relative; container-type: inline-size; box-sizing: border-box; display: flex; flex-direction: column; gap: 5px; min-width: 0;
    padding: 10px; border-radius: calc(var(--radius) * 0.6); background: var(--well); text-align: start; transform-origin: 50% 50%; cursor: pointer; }
  .tile[data-missing], .tile[data-unavailable] { opacity: 0.55; }
  .tile .top { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .tile .top ha-icon, .tile .top savvy-state-icon { --mdc-icon-size: 16px; display: flex; flex: none; color: var(--tile-lvl, var(--secondary-text-color)); }
  .tile .cap { min-width: 0; flex: 1; font-size: 13px; line-height: 16px; font-weight: 600; letter-spacing: -0.006em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile .val { display: flex; align-items: baseline; gap: 3px; min-width: 0; font-size: 14px; line-height: 17px; font-weight: 650; letter-spacing: -0.012em; }
  .tile .val .u { font-size: 12px; line-height: 16px; font-weight: 500; letter-spacing: -0.003em; color: var(--secondary-text-color); }
  .tile .note { font-size: 10.5px; line-height: 13px; font-weight: 500; letter-spacing: 0.006em; color: var(--secondary-text-color); }
  .tile[data-graph] .val { font-size: 19px; line-height: 23px; letter-spacing: -0.02em; }
  .tile[data-graph] .val .u { font-size: 12.5px; }
  .tile .chart { position: relative; height: ${CHART_H}px; margin-top: 2px; touch-action: pan-y; }
  .tile .chart svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
  .tile .axis { display: flex; justify-content: space-between; margin-top: 2px; font-size: 10px; line-height: 12px; font-weight: 500; letter-spacing: 0.01em;
    color: var(--secondary-text-color); opacity: 0.8; }
  .tile .bubble { position: absolute; top: -8px; left: 0; z-index: 1; display: flex; gap: 6px; align-items: center; font-size: 11px; line-height: 14px; font-weight: 600;
    letter-spacing: -0.004em; padding: 3px 7px; border-radius: 8px; white-space: nowrap; pointer-events: none;
    background: color-mix(in oklab, var(--primary-text-color) 10%, var(--ha-card-background, var(--card-background-color))); box-shadow: 0 4px 14px rgb(0 0 0 / 0.16); opacity: 0; }
  .tile .bubble .t { color: var(--secondary-text-color); font-weight: 550; }
  .tile .cnote { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; font-size: 11px; line-height: 14px; font-weight: 500;
    color: var(--secondary-text-color); border-radius: 8px; background: color-mix(in oklab, var(--primary-text-color) 3%, transparent); }
  @media (prefers-contrast: more) { .tile .val .u, .tile .note { color: var(--primary-text-color); opacity: 0.85; } }
  @container (max-width: 76px) { .tile .cap { display: none; } }
  @container (max-width: 200px) { .tile .axis .mid { display: none; } }
`;

class SavvyGraphCard extends SavvyCard {
  static getStubConfig(hass) {
    const ids = Object.keys(hass?.states || {}).filter((id) => id.startsWith("sensor.") && hass.states[id].attributes.state_class === "measurement").slice(0, 2);
    return { entities: ids.length ? ids : [] };
  }
  static getConfigElement() { return document.createElement(EDITOR); }

  constructor() {
    super();
    this._onscreen = true;
    this._tiles = new Map();
    this._series = {};
  }

  setConfig(config) {
    const entities = asItems(config?.entities);
    if (!entities.length) throw new Error('savvy-graph-card: an "entities" list is required');
    this._config = { hours_to_show: 24, ...config, entities };
    const hours = Number(this._config.hours_to_show) || 24;
    const ranges = [].concat(config.ranges || []).map(Number).filter((n) => n > 0);
    this._ranges = !ranges.length || ranges.includes(hours) ? ranges : [...ranges, hours].sort((a, b) => a - b);
    this._hours = hours;
    this._rawBy = new Map();
    this._raw = null;
    this._series = {};
    if (this._el) { this._build(); if (this._hass) this._update(); }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._el) this._build();
    this._update();
    this._loadHistory();
  }

  connectedCallback() { this._observe(); this._wake(); }
  disconnectedCallback() { super.disconnectedCallback(); this._io?.disconnect(); }
  getCardSize() { return 2; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: "auto" }; }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._resetMotion();
    this._first = true;
    this._tiles = new Map();
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="head" id="head" hidden><span class="ht" id="ht"></span>
          <div class="ranges" id="ranges" role="group" aria-label="History range" hidden><span class="sel"></span></div></div>
        <div class="graphs" id="graphs" hidden></div>
        <div class="grid" id="grid" hidden></div>
      </ha-card>`;
    const $ = (id) => root.getElementById(id);
    this._el = { card: root.querySelector("ha-card"), head: $("head"), ht: $("ht"), ranges: $("ranges"), graphs: $("graphs"), grid: $("grid") };
    text(this._el.ht, this._config.title || "");
    if (this._config.columns) put(this._el.grid, "--cols", this._config.columns);
    this._rangeX = this._spring(0, MOTION.pill, "ranges", 0.02);
    this._rangeW = this._spring(0, MOTION.pill, "ranges", 0.02);
    for (const hours of this._ranges) {
      const seg = document.createElement("span");
      seg.className = "rseg";
      seg.__hours = hours;
      attr(seg, "role", "button");
      attr(seg, "tabindex", "0");
      text(seg, hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`);
      this._pressable(seg, { onTap: () => this._setRange(hours), haptic: null }, 0.04);
      this._el.ranges.appendChild(seg);
    }
    // charts draw at their real pixel size, so strokes and labels never stretch
    this._ro?.disconnect();
    this._ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const node = e.target.__node;
        if (!node) { this._rangeGeom(); continue; }
        node.__W = e.contentRect.width;
        node.__H = e.contentRect.height;
        node.__chartDirty = true;
      }
      this._wake();
    });
    this._ro.observe(this._el.ranges);
    this._observe();
  }

  _observe() {
    if (!this._el || !this.isConnected) return;
    this._io = this._io || new IntersectionObserver(([e]) => { this._onscreen = e.isIntersecting; if (this._onscreen) this._wake(); });
    this._io.disconnect();
    this._io.observe(this);
  }

  // ---------- history ----------
  _isGraph(st) {
    if (!st || isOff(st) || isTimestamp(st)) return false;
    return Number.isFinite(parseFloat(st.state));
  }
  _hoursFor(item) { return Number(item.hours_to_show) || this._hours; }
  // a tile can chart one attribute of an entity (a weather entity's humidity)
  _sk(item) { return item.attribute ? `${item.entity}#${item.attribute}` : item.entity; }
  _stateOf(h, item) {
    const st = h.states[item.entity];
    if (!item.attribute || !st) return st;
    const v = st.attributes[item.attribute];
    return { ...st, state: v == null ? "unavailable" : String(v), attributes: { ...st.attributes, unit_of_measurement: item.unit ?? "" } };
  }

  // Graphs sharing a range share one round-trip; each answer is kept for a minute, so
  // flipping the selector back and forth doesn't refetch.
  async _loadHistory() {
    const h = this._hass, groups = new Map(), attrs = [];
    for (const item of this._config.entities) {
      if (!this._isGraph(this._stateOf(h, item))) continue;
      const hours = this._hoursFor(item);
      if (item.attribute) { attrs.push({ id: item.entity, attribute: item.attribute, hours }); continue; }
      (groups.get(hours) || groups.set(hours, []).get(hours)).push(item.entity);
    }
    const key = [...[...groups].map(([hours, ids]) => `${hours}:${ids.join(",")}`), ...attrs.map((a) => `${a.hours}:${a.id}#${a.attribute}`)].join("|");
    if (!key) return;
    const cached = this._rawBy.get(key);
    if (cached && Date.now() - cached.at < 60000) {
      if (this._raw !== cached.raw) { this._raw = cached.raw; this._buildSeries(); this._update(); }
      return;
    }
    if (this._loading === key) return;
    this._loading = key;
    const raw = {};
    await Promise.all([...groups].map(async ([hours, ids]) => {
      try { Object.assign(raw, await fetchRange(h, ids, hours)); } catch (err) { /* that group shows no history */ }
    }).concat(attrs.map(async (a) => {
      try { raw[`${a.id}#${a.attribute}`] = await fetchAttributeHistory(h, a.id, a.attribute, a.hours); } catch (err) { /* no history for it */ }
    })));
    if (this._loading !== key) return;
    this._loading = null;
    this._rawBy.set(key, { raw, at: Date.now() });
    this._raw = raw;
    this._buildSeries();
    this._update();
  }

  _buildSeries() {
    const h = this._hass, end = Date.now(), out = {};
    for (const item of this._config.entities) {
      const rows = this._raw?.[this._sk(item)];
      if (!rows) continue;
      const start = end - this._hoursFor(item) * 3600000;
      const pts = numericPoints(rows, this._stateOf(h, item)?.state, end);
      const sampled = pts.length < 2 ? [] : resample(pts, start, end);
      out[this._sk(item)] = sampled.length < 2 ? null : { points: sampled, span: [start, end], ...seriesStats(sampled) };
    }
    this._series = out;
  }

  _setRange(hours) {
    if (hours === this._hours) return;
    this._hours = hours;
    haptic("selection");
    this._syncRanges();
    this._raw = null;
    this._series = {};
    this._update();
    this._loadHistory();
  }

  _syncRanges() {
    [...this._el.ranges.querySelectorAll(".rseg")].forEach((seg, i) => {
      const sel = seg.__hours === this._hours;
      attr(seg, "data-sel", sel);
      attr(seg, "aria-pressed", String(sel));
      if (sel) this._rangeIdx = i;
    });
    this._rangeGeom();
  }

  _rangeGeom() {
    const sel = this._el?.ranges.querySelectorAll(".rseg")[this._rangeIdx];
    if (!sel || !sel.offsetWidth) return;
    if (this._rangeW.x === 0) { this._rangeX.snap(sel.offsetLeft); this._rangeW.snap(sel.offsetWidth); }
    else { this._rangeX.to(sel.offsetLeft, MOTION.pill); this._rangeW.to(sel.offsetWidth, MOTION.pill); }
    this._wake();
  }

  // ---------- tiles ----------
  _update() {
    const h = this._hass;
    if (!h || !this._el) return;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    this._renderTiles();
    if (this._first) { this._first = false; requestAnimationFrame(() => this._paintAll(null)); }
    this._wake();
  }

  _renderTiles() {
    const h = this._hass, cfg = this._config, el = this._el, seen = new Set();
    let graphs = 0, small = 0, gi = 0, si = 0;
    for (const item of cfg.entities) {
      const key = this._sk(item);
      seen.add(key);
      const graph = this._isGraph(this._stateOf(h, item));
      if (graph) graphs++; else small++;
      const box = graph ? el.graphs : el.grid;
      let node = this._tiles.get(key);
      if (!node) {
        node = document.createElement("div");
        node.className = "tile";
        node.innerHTML = `<span class="top"><span class="iconSlot"></span><span class="cap"></span></span>
          <span class="val"><span class="n"></span><span class="u"></span></span>
          <span class="note" hidden></span>
          <div class="chart" hidden><svg focusable="false" aria-hidden="true"></svg><span class="bubble"></span><span class="cnote" hidden></span></div>
          <div class="axis" hidden aria-hidden="true"><span></span><span class="mid"></span><span>Now</span></div>`;
        node.__el = { iconSlot: node.querySelector(".iconSlot"), cap: node.querySelector(".cap"), n: node.querySelector(".val .n"), u: node.querySelector(".val .u"),
          note: node.querySelector(".note"), chart: node.querySelector(".chart"), svg: node.querySelector("svg"), bubble: node.querySelector(".bubble"),
          axis: node.querySelector(".axis"), ax: [...node.querySelectorAll(".axis span")], cnote: node.querySelector(".cnote") };
        node.__el.chart.__node = node;
        this._ro.observe(node.__el.chart);
        attr(node, "role", "button");
        attr(node, "tabindex", "0");
        const act = (kind) => () => {
          const it = node.__item, a = it[`${kind}_action`];
          runAction(this, this._hass, a !== undefined ? a : { action: "more-info" }, { entity: it.entity });
        };
        this._pressable(node, { onTap: act("tap"), onHold: act("hold"), haptic: null }, 0.04);
        this._wireScrub(node, node.__el.chart);
        node.__enter = this._spring(0, MOTION.ui, `enter:${key}`).to(1, MOTION.ui);
        this._tiles.set(key, node);
      }
      this._renderTile(item, node);
      attr(node, "data-graph", graph);
      place(box, node, graph ? gi++ : si++);
    }
    el.graphs.hidden = !graphs;
    el.grid.hidden = !small;
    el.ranges.hidden = !graphs || this._ranges.length < 2;
    el.head.hidden = !cfg.title && el.ranges.hidden;
    if (!el.ranges.hidden) this._syncRanges();
    for (const [key, node] of this._tiles) {
      if (seen.has(key)) continue;
      for (const s of [node.__enter, node.__reveal, node.__value, node.__scrub, node.__scrubX, node.__spring]) {
        const i = this._springs.indexOf(s);
        if (i >= 0) this._springs.splice(i, 1);
      }
      const p = this._pressNodes.indexOf(node);
      if (p >= 0) this._pressNodes.splice(p, 1);
      node.remove();
      this._tiles.delete(key);
    }
  }

  _renderTile(item, node) {
    const h = this._hass, st = this._stateOf(h, item), el = node.__el;
    node.__item = item;
    const missing = !st, unavailable = !missing && isOff(st);
    attr(node, "data-missing", missing);
    attr(node, "data-unavailable", unavailable);
    text(el.cap, item.name || (item.attribute ? title(item.attribute) : st?.attributes.friendly_name) || title(item.entity.split(".")[1] || item.entity));
    const wantState = !item.icon && !item.attribute && !!st;
    if (node.__iconKind !== (wantState ? "state" : "plain")) {
      node.__iconKind = wantState ? "state" : "plain";
      el.iconSlot.innerHTML = wantState ? "<savvy-state-icon></savvy-state-icon>" : "<ha-icon></ha-icon>";
      el.icon = el.iconSlot.firstElementChild;
    }
    if (wantState) { if (el.icon.stateObj !== st) { el.icon.hass = h; el.icon.stateObj = st; } }
    else attr(el.icon, "icon", item.icon || "mdi:help-circle-outline");

    const numeric = this._isGraph(st);
    const series = numeric ? this._series[this._sk(item)] : undefined;
    if (!numeric) { el.chart.hidden = true; el.axis.hidden = true; }
    if (missing || unavailable) {
      el.n.parentElement.hidden = true;
      el.note.hidden = false;
      text(el.note, missing ? "Not found" : "Unavailable");
      put(node, "--tile-lvl", "");
    } else if (numeric) {
      el.n.parentElement.hidden = false;
      const value = parseFloat(st.state);
      if (!node.__value) node.__value = this._spring(value, MOTION.text, `value:${item.entity}`);
      else node.__value.to(value, MOTION.text);
      const level = levelOf(value, item.thresholds);
      put(node, "--tile-lvl", level ? `var(--lvl-${level})` : "");
      const unit = item.unit ?? st.attributes.unit_of_measurement ?? "";
      text(el.u, unit);
      node.__unit = unit;
      el.chart.hidden = false;
      el.axis.hidden = false;
      el.cnote.hidden = !!series;
      if (series) {
        el.note.hidden = true;
        // the line draws itself in once per range, never on a routine refresh
        if (node.__revealFor !== this._hoursFor(item)) {
          node.__revealFor = this._hoursFor(item);
          if (!node.__reveal) node.__reveal = this._spring(0, MOTION.graph, `reveal:${item.entity}`);
          node.__reveal.snap(0).to(1, MOTION.graph);
        }
        if (!node.__scrub) {
          node.__scrub = this._spring(0, MOTION.scrub, `scrub:${item.entity}`);
          node.__scrubX = this._spring(0, MOTION.scrub, `scrub:${item.entity}`);
        }
        node.__series = series;
        node.__chartDirty = true;
      } else {
        // said where the graph would be, so the tile keeps its shape
        el.note.hidden = true;
        text(el.cnote, this._loading || !this._raw ? "Loading history…" : "No history yet");
        node.__series = null;
        if (el.svg.__key) { el.svg.__key = ""; el.svg.innerHTML = ""; }
        el.axis.hidden = true;
        if (node.__scrub) { node.__scrub.snap(0); node.__scrubX.snap(0); }
        put(el.bubble, "opacity", "0");
      }
    } else {
      // a plain state: on/off, a timestamp, text
      el.n.parentElement.hidden = false;
      el.note.hidden = true;
      node.__unit = "";
      node.__value = null;
      put(node, "--tile-lvl", item.state_color && domainOf(item.entity) === "binary_sensor"
        ? (st.state === "on" ? "var(--lvl-good)" : st.state === "off" ? "var(--lvl-bad)" : "") : "");
      let words = null;
      if (isTimestamp(st)) { const t = Date.parse(st.state); if (Number.isFinite(t)) words = relativeTime(t, langOf(h)); }
      text(el.n, words ?? stateText(h, st));
      text(el.u, "");
    }
  }

  // ---------- frames ----------
  _frame(now, dt) {
    const stepped = super._frame(now, dt);
    if (stepped) return true;
    // a resize with nothing moving still needs the charts redrawn at their new size
    if ([...this._tiles.values()].some((n) => n.__chartDirty)) { this._paintAll(new Set()); return true; }
    return false;
  }

  _paint(dirty, all) {
    if (all || dirty.has("ranges")) {
      const pill = this._el.ranges.querySelector(".sel"), w = Math.max(0, this._rangeW.x);
      put(pill, "opacity", w < 1 ? "0" : "");
      put(pill, "width", `${w.toFixed(2)}px`);
      put(pill, "transform", `translate3d(${this._rangeX.x.toFixed(2)}px,0,0)`);
    }
    const red = MQ.reduced.matches;
    for (const [key, node] of this._tiles) {
      if (node.__enter && (all || dirty.has(`enter:${key}`))) {
        const v = clamp(node.__enter.x);
        put(node, "opacity", v > 0.999 ? "" : v.toFixed(3));
        put(node, "translate", red || v > 0.999 ? "" : `0 ${((1 - v) * 4).toFixed(2)}px`);
      }
      if (node.__value && (all || dirty.has(`value:${key}`))) text(node.__el.n, fmtNumber(node.__value.x));
      const chart = node.__chartDirty || (node.__reveal && (all || dirty.has(`reveal:${key}`))) || (node.__scrub && (all || dirty.has(`scrub:${key}`)));
      if (chart && node.__series) this._paintChart(node, key);
      node.__chartDirty = false;
    }
  }

  // The climate card's chart at tile scale, in real pixels.
  _paintChart(node, key) {
    const series = node.__series, el = node.__el, W = node.__W, H = node.__H;
    if (!series?.points?.length || !W || !H) return;
    const [t0, t1] = series.span, item = node.__item, lang = langOf(this._hass);
    const PT = 13, PB = 12;
    const pad = Math.max((series.max - series.min) * 0.12, Math.abs(series.max) * 0.002, 1e-6);
    const lo = series.min - pad, hi = series.max + pad;
    const xOf = (t) => ((t - t0) / Math.max(1, t1 - t0)) * W;
    const yOf = (v) => PT + (1 - (v - lo) / Math.max(1e-6, hi - lo)) * (H - PT - PB);
    const pts = series.points.map((p) => [xOf(p.t), yOf(p.v)]);
    const d = linePath(pts);
    const f = (v) => v.toFixed(2);
    const id = key.replace(/[^a-zA-Z0-9]/g, "_");
    const unit = node.__unit || "";
    // with thresholds, good / warn / bad down the value axis; otherwise the accent
    const levelColor = (lvl) => (lvl ? `var(--lvl-${lvl})` : "rgb(var(--accent))");
    const th = item.thresholds?.length ? [...item.thresholds].sort((a, b) => b.value - a.value) : null;
    let stops;
    if (th) {
      stops = [{ o: 0, c: levelColor(levelOf(hi, th)) }];
      for (const t of th) {
        if (t.value <= lo || t.value >= hi) continue;
        const o = (hi - t.value) / (hi - lo);
        stops.push({ o: clamp(o - 0.015), c: levelColor(levelOf(t.value, th)) });
        stops.push({ o: clamp(o + 0.015), c: levelColor(levelOf(t.value - 1e-9, th)) });
      }
      stops.push({ o: 1, c: levelColor(levelOf(lo, th)) });
    } else stops = [{ o: 0, c: levelColor(null) }, { o: 1, c: levelColor(null) }];
    const grad = stops.map((s) => `<stop offset="${f(s.o)}" style="stop-color:${s.c}"></stop>`).join("");
    const lastColor = th ? levelColor(levelOf(series.points[series.points.length - 1].v, th)) : levelColor(null);
    let labels = "";
    for (const ex of [{ p: series.maxAt, v: series.max, up: true }, { p: series.minAt, v: series.min, up: false }]) {
      if (!ex.p || (!ex.up && series.max - series.min < 1e-9)) continue;
      const x = xOf(ex.p.t), y = yOf(ex.v);
      labels += `<circle cx="${f(x)}" cy="${f(y)}" r="2.25" fill="currentColor" fill-opacity="0.55"></circle>`
        + `<text x="${f(clamp(x, 16, W - 16))}" y="${f(ex.up ? y - 5 : y + 11)}" text-anchor="middle" fill="currentColor" fill-opacity="0.55" font-size="9.5" font-weight="600">${fmtNumber(ex.v)}${esc(unit)}</text>`;
    }
    const avgY = yOf(series.avg);
    const html = `<defs>
        <clipPath id="r-${id}"><rect class="rv" x="-4" y="-16" width="${f(W + 8)}" height="${f(H + 32)}"></rect></clipPath>
        <linearGradient id="g-${id}" x1="0" y1="${f(PT)}" x2="0" y2="${f(H - PB)}" gradientUnits="userSpaceOnUse">${grad}</linearGradient>
        <linearGradient id="f-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.24"></stop><stop offset="1" stop-color="#fff" stop-opacity="0"></stop></linearGradient>
        <mask id="m-${id}"><rect x="0" y="0" width="${f(W)}" height="${f(H)}" fill="url(#f-${id})"></rect></mask></defs>
      <g clip-path="url(#r-${id})">
        <path d="${d} L${f(W)} ${f(H)} L0 ${f(H)} Z" fill="url(#g-${id})" mask="url(#m-${id})"></path>
        <line x1="0" y1="${f(avgY)}" x2="${f(W)}" y2="${f(avgY)}" stroke="currentColor" stroke-opacity="0.2" stroke-width="1" stroke-dasharray="2 4"></line>
        <path d="${d}" fill="none" stroke="url(#g-${id})" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"></path>
        ${labels}
      </g>
      <line class="cur" x1="0" y1="0" x2="0" y2="${f(H)}" stroke="currentColor" stroke-width="1" opacity="0"></line>
      <circle class="dot" r="3.5" opacity="0" style="fill:${lastColor}"></circle>`;
    if (el.svg.__key !== html) {
      el.svg.__key = html;
      el.svg.setAttribute("viewBox", `0 0 ${f(W)} ${f(H)}`);
      el.svg.innerHTML = html;
      el.svg.__rv = el.svg.querySelector(".rv");
      el.svg.__cur = el.svg.querySelector(".cur");
      el.svg.__dot = el.svg.querySelector(".dot");
      text(el.ax[0], axisLabel(t0, t1 - t0, lang));
      text(el.ax[1], axisLabel((t0 + t1) / 2, t1 - t0, lang));
    }
    const reveal = node.__reveal ? clamp(node.__reveal.x) : 1;
    attr(el.svg.__rv, "width", f(Math.max(0.01, reveal * (W + 8))));
    const s = node.__scrub ? clamp(node.__scrub.x) : 0;
    attr(el.svg.__cur, "opacity", s < 1e-3 ? "0" : (s * 0.35).toFixed(3));
    attr(el.svg.__dot, "opacity", s < 1e-3 ? "0" : s.toFixed(3));
    put(el.bubble, "opacity", s < 1e-3 ? "0" : s.toFixed(3));
    if (s < 1e-3) return;
    const x = clamp(node.__scrubX.x, 0, W);
    let best = 0, bd = Infinity;
    pts.forEach((q, i) => { const dd = Math.abs(q[0] - x); if (dd < bd) { bd = dd; best = i; } });
    const q = pts[best], pt = series.points[best];
    attr(el.svg.__cur, "transform", `translate(${f(q[0])} 0)`);
    attr(el.svg.__dot, "transform", `translate(${f(q[0])} ${f(q[1])})`);
    if (th) put(el.svg.__dot, "fill", levelColor(levelOf(pt.v, th)));
    const bhtml = `<span class="t">${esc(momentLabel(pt.t, t1 - t0, lang))}</span><span>${fmtNumber(pt.v)}${esc(unit)}</span>`;
    if (el.bubble.__html !== bhtml) { el.bubble.__html = bhtml; el.bubble.innerHTML = bhtml; }
    const bw = el.bubble.offsetWidth || 0;
    put(el.bubble, "transform", `translateX(${f(clamp(q[0] - bw / 2, 0, Math.max(0, W - bw)))}px)`);
  }

  // Hover with a mouse; press and hold still with a finger, so a scrub never fights a
  // scroll (CARD-DESIGN.md 3.2's dwell rule).
  _wireScrub(node, chart) {
    let touchId = null, x0 = 0, y0 = 0, live = false, timer = 0;
    const show = () => { live = true; haptic("selection"); node.__spring?.swallow?.(); node.__scrub.to(1, MOTION.scrub); };
    const hide = () => { if (!live) return; live = false; node.__scrub.to(0, MOTION.scrub); this._wake(); };
    const snapX = (e) => { const r = chart.getBoundingClientRect(); if (r.width) node.__scrubX.snap(clamp(e.clientX - r.left, 0, r.width)); };
    const track = (e) => { const r = chart.getBoundingClientRect(); if (!r.width) return; node.__scrubX.to(clamp(e.clientX - r.left, 0, r.width), MOTION.scrub); this._wake(); };
    chart.addEventListener("pointerenter", (e) => { if (e.pointerType !== "mouse" || !node.__series) return; snapX(e); show(); this._wake(); });
    chart.addEventListener("pointermove", (e) => {
      if (e.pointerType === "mouse") { if (live) track(e); return; }
      if (e.pointerId !== touchId) return;
      if (!live) { if (Math.hypot(e.clientX - x0, e.clientY - y0) < SCRUB_SLOP) return; clearTimeout(timer); touchId = null; return; }
      track(e);
    });
    chart.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
    chart.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" || e.button > 0 || !node.__series) return;
      touchId = e.pointerId; x0 = e.clientX; y0 = e.clientY; live = false;
      snapX(e);
      timer = setTimeout(() => {
        if (touchId !== e.pointerId) return;
        try { chart.setPointerCapture(e.pointerId); } catch (err) { /* best effort */ }
        show();
        this._wake();
      }, SCRUB_DWELL);
    });
    const end = (e) => { if (e.pointerType === "mouse" || e.pointerId !== touchId) return; touchId = null; clearTimeout(timer); hide(); };
    chart.addEventListener("pointerup", end);
    chart.addEventListener("pointercancel", end);
  }
}

// ---------- editor ----------
const EDITOR = defineEditor("savvy-graph-card", (hass, c) => [
  S.text("title", "Title"),
  S.grid(S.number("hours_to_show", "Hours", 1, 8760, 1, "h"), S.number("columns", "Columns", 1, 8)),
  { name: "ranges", label: "Hours selector", helper: "Offer these ranges in the header (e.g. 24, 168, 720). Empty: no selector.",
    selector: { select: { multiple: true, custom_value: true, options: ["6", "24", "48", "168", "720"] } } },
  { name: "entities", label: "Tiles", type: "list", helper: "A number gets a graph; anything else a small tile with its state.",
    item: [
      { name: "entity", label: "Entity", selector: { entity: {} } },
      { name: "attribute", label: "Attribute", helper: "Chart one of the entity's attributes instead of its state (a weather entity's humidity).", selector: { text: {} } },
      { type: "grid", name: "", schema: [{ name: "name", label: "Name", selector: { text: {} } }, { name: "icon", label: "Icon", selector: { icon: {} } }] },
      { type: "grid", name: "", schema: [{ name: "unit", label: "Unit", selector: { text: {} } },
        { name: "hours_to_show", label: "Tile hours", selector: { number: { min: 1, max: 8760, mode: "box", unit_of_measurement: "h" } } }] },
      { name: "state_color", label: "State colours", selector: { boolean: {} } },
      { name: "thresholds", label: "Thresholds", helper: "[{value: 0, level: good}, {value: 60, level: warn}, {value: 85, level: bad}]", selector: { object: {} } },
      { name: "tap_action", label: "Tap action", selector: { ui_action: {} } },
      { name: "hold_action", label: "Hold action", selector: { ui_action: {} } },
    ] },
]);

registerCard("savvy-graph-card", SavvyGraphCard, "Graph",
  "Tiles for numbers and states: a graph with its range, min, max and average for every number, a plain readout for the rest.");
