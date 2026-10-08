// savvy-energy-card: what the house used, what it cost, and where it went. Today, this week or this month
// against the same stretch before it, a bar for every hour (or day), the live power, and the biggest
// consumers. The cost is the energy of each hour times that hour's price, so a tariff that changes through
// the day is counted properly.
//
//   type: custom:savvy-energy-card
//   total: sensor.house_energy            (the whole house, kWh, total_increasing; else the consumers' sum)
//   consumers: [sensor.a, sensor.b]       (energy sensors to rank; default: every energy sensor found)
//   power: sensor.house_power             (the live reading, W or kW; optional)
//   tariff: sensor.tariff                 (the price per kWh as an entity; each hour's own average is used)
//   price: 0.25                           (a fixed price per kWh; used when there is no tariff entity or it is unavailable)
//   currency: EUR                         (default: Home Assistant's)
//   range: today | week | month           (the chips below the title change it)
//   by: device | room                     (what the ranking adds up)     max_consumers: 5
//   area: [kitchen]                       (only the consumers of these areas)
//   exclude: [sensor.x]                   (the Savvy settings' ignore list is added)
//   title: Energy     title_path: /lovelace/energy     layout: full | compact (no chart or ranking)
//
// It reads Home Assistant's long-term statistics, so a sensor needs a state class (total_increasing or
// total) and the unit kWh, Wh or MWh. Nothing is stored by the card.

const EN_RANGES = ["today", "week", "month"];
const EN_WORD = { today: "Today", week: "Week", month: "Month" };
const EN_PREV = { today: "yesterday", week: "last week", month: "last month" };
const EN_REFRESH_MS = 5 * 60000;
const EN_UNITS = { wh: 0.001, kwh: 1, mwh: 1000 };

const STYLE = `${BASE_CSS}
  ha-card { --pad: 14px; position: relative; display: flex; flex-direction: column; gap: 10px; padding: var(--pad); overflow: hidden; }
  :host([data-compact]) ha-card { --pad: 12px; gap: 8px; }
  ha-card > * { position: relative; }
  .head { display: flex; align-items: center; gap: 10px; min-height: 28px; }
  .head .t { flex: 1; min-width: 0; font-size: 17px; line-height: 22px; font-weight: 620; letter-spacing: -0.021em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .live { flex: none; display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 10px 0 7px; border-radius: 12px; white-space: nowrap; --mdc-icon-size: 15px;
    font-size: 12px; font-weight: 650; color: rgb(var(--warn-rgb)); background: color-mix(in oklab, rgb(var(--warn-rgb)) var(--mix-on), transparent); }
  .live ha-icon { display: flex; }
  .ranges { display: flex; gap: 6px; }
  .rg { flex: none; display: inline-flex; align-items: center; height: 32px; padding: 0 13px; border-radius: 16px; background: var(--well); white-space: nowrap;
    font-size: 12.5px; font-weight: 650; color: var(--secondary-text-color); cursor: pointer; }
  .rg[data-on] { color: rgb(var(--accent)); background: color-mix(in oklab, rgb(var(--accent)) var(--mix-on), transparent); }
  .big { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; min-width: 0; }
  .big .kwh { font-size: 30px; line-height: 34px; font-weight: 650; letter-spacing: -0.03em; }
  .big .kwh small { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; color: var(--secondary-text-color); margin-inline-start: 3px; }
  .big .cost { font-size: 17px; line-height: 22px; font-weight: 600; letter-spacing: -0.015em; color: var(--secondary-text-color); }
  .delta { display: inline-flex; align-items: center; height: 24px; padding: 0 9px; border-radius: 12px; font-size: 12px; font-weight: 650; white-space: nowrap;
    color: var(--secondary-text-color); background: var(--well); }
  .delta[data-dir="up"] { color: rgb(var(--warn-rgb)); background: color-mix(in oklab, rgb(var(--warn-rgb)) var(--mix-on), transparent); }
  .delta[data-dir="down"] { color: rgb(var(--good-rgb)); background: color-mix(in oklab, rgb(var(--good-rgb)) var(--mix-on), transparent); }
  .when { font-size: 12.5px; line-height: 16px; font-weight: 500; color: var(--secondary-text-color); min-height: 16px; }
  .chart { position: relative; display: flex; align-items: flex-end; gap: 3px; height: 84px; touch-action: pan-y; cursor: pointer; }
  .bar { flex: 1; min-width: 0; height: 100%; display: flex; align-items: flex-end; border-radius: 4px; }
  .bar i { display: block; width: 100%; min-height: 2px; border-radius: 4px; transform-origin: 50% 100%; transform: scaleY(var(--g, 1));
    background: color-mix(in oklab, rgb(var(--accent)) 38%, transparent); }
  .bar[data-sel] i, .chart:not([data-pick]) .bar[data-now] i { background: rgb(var(--accent)); }
  .bar[data-future] i { background: var(--well); }
  .axis { display: flex; justify-content: space-between; margin-top: -4px; font-size: 10.5px; line-height: 13px; font-weight: 550; color: var(--secondary-text-color); }
  .rank { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .rank #rows { display: flex; flex-direction: column; gap: 2px; }
  .rank .cap { margin: 4px 4px 2px; font-size: 13px; line-height: 17px; font-weight: 600; letter-spacing: -0.006em; color: var(--secondary-text-color); }
  .row { display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 44px; padding: 3px 4px 3px 2px; border-radius: 14px; cursor: pointer; text-align: start; }
  .row .ic { flex: none; display: grid; place-items: center; width: var(--b-m); height: var(--b-m); border-radius: 50%; --mdc-icon-size: 20px;
    color: rgb(var(--accent)); background: color-mix(in oklab, rgb(var(--accent)) var(--mix-on), transparent); }
  .row .ic ha-icon { display: flex; }
  .row .tx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .row .nm { font-size: 14px; line-height: 18px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .meter { height: 4px; border-radius: 2px; background: var(--well); overflow: hidden; }
  .row .meter i { display: block; height: 100%; width: calc(var(--w, 0) * 100%); border-radius: 2px; background: rgb(var(--accent)); }
  .row .num { flex: none; text-align: end; display: flex; flex-direction: column; }
  .row .num b { font-size: 13px; line-height: 17px; font-weight: 650; }
  .row .num span { font-size: 12px; line-height: 15px; font-weight: 500; color: var(--secondary-text-color); }
  .empty { padding: 4px 2px; font-size: 12.5px; font-weight: 500; color: var(--secondary-text-color); }
`;

const msOf = (t) => (typeof t === "number" ? (t < 1e11 ? t * 1000 : t) : Date.parse(t));

class SavvyEnergyCard extends SavvyCard {
  static getStubConfig(hass) {
    const id = Object.keys(hass?.states || {}).find((i) => i.startsWith("sensor.") && hass.states[i].attributes.device_class === "energy");
    return id ? { total: id } : {};
  }
  static getConfigElement() { return document.createElement(EDITOR); }

  constructor() {
    super();
    this._data = null;
    this._sel = null;
    this._bars = [];
    this._rows = new Map();
    this._grow = this._spring(1, MOTION.ui, "grow", 0.002);
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("savvy-energy-card: invalid configuration");
    const areas = [].concat(config.area ?? config.areas ?? []).filter(Boolean);
    // a number (or a numeric string from the editor) is a fixed price; anything else names a sensor
    const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
    // `tariff` names the price entity; `price` is a number (or, as before, an entity or { entity, value })
    const tariff = typeof config.tariff === "string" && config.tariff ? config.tariff : null;
    const fixed = typeof config.price === "object" && config.price ? config.price.value : num(config.price);
    const price = tariff ? { entity: tariff, ...(fixed != null ? { value: Number(fixed) } : {}) }
      : typeof config.price === "object" && config.price ? config.price : fixed != null ? { value: fixed } : config.price ? { entity: config.price } : null;
    this._config = { ...config, areas, price, consumers: asItems(config.consumers).map((i) => i.entity), exclude: asItems(config.exclude).map((i) => i.entity),
      exclude_areas: [].concat(config.exclude_areas || []), max_consumers: Number(config.max_consumers) > 0 ? Number(config.max_consumers) : 5 };
    this._compact = config.layout === "compact";
    this._range = EN_RANGES.includes(config.range) ? config.range : "today";
    this._data = null;
    this._sel = null;
    if (this._el) { this._build(); if (this._hass) { this._update(); this._load(); } }
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (!this._el) this._build();
    this._update();
    if (first) this._load();
  }

  connectedCallback() {
    this._wake();
    this._poll = this._poll || setInterval(() => { if (this._hass && this._onscreen !== false) this._load(); }, EN_REFRESH_MS);
    this._io = this._io || (typeof IntersectionObserver === "function" ? new IntersectionObserver(([e]) => {
      this._onscreen = e.isIntersecting;
      if (e.isIntersecting && this._hass && this._data && Date.now() - this._data.at > EN_REFRESH_MS) this._load();
    }) : null);
    this._io?.observe(this);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._poll);
    this._poll = 0;
    this._io?.disconnect();
    this._io = null;
  }
  getCardSize() { return this._compact ? 2 : 5; }
  getGridOptions() { return { columns: 12, min_columns: 4, rows: "auto" }; }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._resetMotion();
    this._grow = this._spring(this._grow?.x ?? 1, MOTION.ui, "grow", 0.002);
    this._bars = [];
    this._rows.clear();
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="head"><span class="t" id="title"></span><span class="live" id="live" hidden><ha-icon icon="mdi:flash"></ha-icon><span id="liveTx"></span></span></div>
        <div class="ranges" id="ranges"></div>
        <div class="big"><span class="kwh" id="kwh"></span><span class="cost" id="cost"></span><span class="delta" id="delta" hidden></span></div>
        <div class="when" id="when"></div>
        <div class="chart" id="chart" hidden></div>
        <div class="axis" id="axis" hidden></div>
        <div class="rank" id="rank" hidden><div class="cap" id="cap"></div><div id="rows"></div></div>
        <div class="empty" id="empty" hidden></div>
      </ha-card>`;
    const $ = (id) => root.getElementById(id);
    this._el = { card: root.querySelector("ha-card"), title: $("title"), live: $("live"), liveTx: $("liveTx"), ranges: $("ranges"), kwh: $("kwh"), cost: $("cost"), delta: $("delta"),
      when: $("when"), chart: $("chart"), axis: $("axis"), rank: $("rank"), cap: $("cap"), rows: $("rows"), empty: $("empty") };
    linkTitle(root, this._el.title, titlePathOf(this._config), (el, onTap) => this._pressable(el, { onTap }, 0.04));
    this._pills = new Map();
    for (const r of EN_RANGES) {
      const b = document.createElement("button");
      b.className = "rg";
      b.textContent = EN_WORD[r];
      this._pressable(b, { onTap: () => { if (this._range === r) return; this._range = r; this._sel = null; this._data = null; this._update(); this._load(); } }, 0.06);
      this._el.ranges.appendChild(b);
      this._pills.set(r, b);
    }
    this._wireChart();
    this._first = true;
  }

  // ---------- which sensors, which window ----------
  _kwhFactor(id) {
    const u = String(this._hass.states[id]?.attributes.unit_of_measurement || "kWh").toLowerCase();
    return EN_UNITS[u] ?? 1;
  }

  _consumerIds() {
    const h = this._hass, c = this._config;
    const skip = new Set([...c.exclude, ...(c.total ? [c.total] : [])]), skipArea = new Set(c.exclude_areas);
    if (c.consumers.length) return c.consumers.filter((id) => h.states[id] && !skip.has(id));
    const energy = (id) => {
      const st = h.states[id];
      return domainOf(id) === "sensor" && st && st.attributes.device_class === "energy" && ["total_increasing", "total"].includes(st.attributes.state_class) && EN_UNITS[String(st.attributes.unit_of_measurement || "").toLowerCase()];
    };
    const ids = c.areas.length ? [...new Set(c.areas.flatMap((a) => areaEntities(h, a)))] : houseEntities(h);
    return ids.filter((id) => !skip.has(id) && energy(id) && !skipArea.has(entityArea(h, id) || ""));
  }

  _window(range) {
    const now = new Date(), start = new Date(now);
    start.setHours(0, 0, 0, 0);
    let prevStart;
    if (range === "week") {
      const first = Number(this._hass.locale?.first_weekday);
      const startDay = Number.isFinite(first) ? first : 1;
      start.setDate(start.getDate() - ((start.getDay() - startDay + 7) % 7));
      prevStart = new Date(start); prevStart.setDate(prevStart.getDate() - 7);
    } else if (range === "month") {
      start.setDate(1);
      prevStart = new Date(start); prevStart.setMonth(prevStart.getMonth() - 1);
    } else {
      prevStart = new Date(start); prevStart.setDate(prevStart.getDate() - 1);
    }
    const elapsed = now - start;
    const prevEnd = Math.min(prevStart.getTime() + elapsed, start.getTime());
    return { start: start.getTime(), end: now.getTime(), prevStart: prevStart.getTime(), prevEnd };
  }

  async _load() {
    const h = this._hass, c = this._config;
    if (!h || !c) return;
    const token = (this._token = (this._token || 0) + 1);
    const range = this._range, win = this._window(range);
    const consumers = this._consumerIds();
    const ids = [...new Set([...(c.total ? [c.total] : []), ...consumers])];
    const priceId = c.price?.entity && h.states[c.price.entity] ? c.price.entity : null;
    if (!ids.length) { this._data = { range, win, at: Date.now(), none: true }; this._update(); return; }
    let stats = {}, prices = {};
    try {
      const ask = (statistic_ids, types) => h.callWS({ type: "recorder/statistics_during_period", start_time: new Date(win.prevStart).toISOString(),
        end_time: new Date(win.end + 3600000).toISOString(), statistic_ids, period: "hour", types });
      stats = await ask(ids, ["change"]);
      if (priceId) { try { prices = await ask([priceId], ["mean"]); } catch (err) { prices = {}; } }
    } catch (err) { this._data = { range, win, at: Date.now(), failed: true }; this._update(); return; }
    if (token !== this._token) return;
    this._data = this._shape(range, win, ids, consumers, stats, prices, priceId);
    this._grow.snap(0.35);
    this._grow.to(1, MOTION.ui);
    this._update();
  }

  // ---------- from statistics to numbers ----------
  _shape(range, win, ids, consumers, stats, prices, priceId) {
    const h = this._hass, c = this._config;
    const fixed = c.price?.value != null ? Number(c.price.value) : null;
    const entityNow = priceId ? parseFloat(h.states[priceId].state) : NaN;
    const priceNow = Number.isFinite(entityNow) ? entityNow : fixed;
    const pf = priceId && /^(ct|c|cent|p)[\/ ]/i.test(String(h.states[priceId].attributes.unit_of_measurement || "")) ? 0.01 : 1;
    const priceAt = new Map();
    for (const r of prices?.[priceId] || []) if (Number.isFinite(r.mean)) priceAt.set(msOf(r.start), r.mean * pf);
    let lastP = null;
    const priceFor = (t) => {
      if (priceAt.has(t)) { lastP = priceAt.get(t); return lastP; }
      return lastP ?? (Number.isFinite(priceNow) ? priceNow * pf : null);
    };
    // every hour of the stretch, per sensor, in kWh
    const hours = new Map();
    for (const id of ids) {
      const f = this._kwhFactor(id);
      for (const r of stats?.[id] || []) {
        const t = msOf(r.start);
        if (!Number.isFinite(t) || !Number.isFinite(r.change) || t > win.end) continue;
        if (!hours.has(t)) hours.set(t, new Map());
        hours.get(t).set(id, r.change * f);
      }
    }
    const times = [...hours.keys()].sort((a, b) => a - b);
    const totalAt = (t) => {
      const m = hours.get(t);
      if (c.total) return m.get(c.total) || 0;
      let s = 0;
      for (const id of consumers) s += m.get(id) || 0;
      return s;
    };
    const cur = { kwh: 0, cost: 0 }, prev = { kwh: 0, cost: 0 }, per = new Map(), buckets = new Map();
    const hasPrice = Number.isFinite(priceNow) || priceAt.size > 0;
    const bucketKey = (t) => { const d = new Date(t); return range === "today" ? d.getHours() : new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
    for (const t of times) {
      const p = priceFor(t);
      const kwh = totalAt(t), cost = p == null ? 0 : kwh * p;
      if (t >= win.start) {
        cur.kwh += kwh; cur.cost += cost;
        const k = bucketKey(t), b = buckets.get(k) || { kwh: 0, cost: 0, t };
        b.kwh += kwh; b.cost += cost;
        buckets.set(k, b);
        for (const id of consumers) {
          const v = hours.get(t).get(id) || 0, e = per.get(id) || { kwh: 0, cost: 0 };
          e.kwh += v; e.cost += p == null ? 0 : v * p;
          per.set(id, e);
        }
      } else if (t >= win.prevStart && t < win.prevEnd) { prev.kwh += kwh; prev.cost += cost; }
    }
    // the bars: every hour of the day, or every day of the week or month
    const now = new Date(win.end), series = [];
    if (range === "today") for (let hr = 0; hr < 24; hr++) series.push({ key: hr, t: new Date(now.getFullYear(), now.getMonth(), now.getDate(), hr).getTime(), ...(buckets.get(hr) || { kwh: 0, cost: 0 }) });
    else {
      const len = range === "week" ? 7 : new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      for (let d = 0; d < len; d++) { const t = new Date(win.start); t.setDate(t.getDate() + d); const k = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime(); series.push({ key: k, t: k, ...(buckets.get(k) || { kwh: 0, cost: 0 }) }); }
    }
    for (const s of series) s.future = s.t > win.end;
    // the ranking: by device, or by room
    let rank = consumers.map((id) => ({ id, ...(per.get(id) || { kwh: 0, cost: 0 }), area: entityArea(h, id) }));
    if (c.by === "room") {
      const m = new Map();
      for (const r of rank) { const a = r.area || ""; const e = m.get(a) || { id: a ? `room:${a}` : "room:", area: a, kwh: 0, cost: 0, room: true, members: [] }; e.kwh += r.kwh; e.cost += r.cost; e.members.push(r.id); m.set(a, e); }
      rank = [...m.values()];
    }
    rank = rank.filter((r) => r.kwh > 0.0005).sort((a, b) => b.kwh - a.kwh);
    return { range, win, at: Date.now(), cur, prev, series, rank, hasPrice, any: times.length > 0 };
  }

  // ---------- painting ----------
  _fmtKwh(v) { return v >= 100 ? Math.round(v).toLocaleString(langOf(this._hass)) : v >= 10 ? v.toFixed(1) : v.toFixed(2); }
  _money(v) {
    const cur = this._config.currency || this._hass.config?.currency || "";
    try { return new Intl.NumberFormat(langOf(this._hass), cur ? { style: "currency", currency: cur } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v); }
    catch (err) { return v.toFixed(2); }
  }

  _live() {
    const h = this._hass, id = this._config.power, st = id && h.states[id];
    if (!st) return null;
    const v = parseFloat(st.state);
    if (!Number.isFinite(v)) return null;
    const unit = String(st.attributes.unit_of_measurement || "W");
    const w = unit.toLowerCase() === "kw" ? v * 1000 : v;
    return Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(w >= 10000 ? 1 : 2)} kW` : `${Math.round(w)} W`;
  }

  _update() {
    const h = this._hass;
    if (!h || !this._el) return;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    this.toggleAttribute("data-compact", this._compact);
    const c = this._config, el = this._el, d = this._data && this._data.range === this._range ? this._data : null;
    text(el.title, c.title ?? "Energy");
    for (const [r, b] of this._pills) attr(b, "data-on", r === this._range);
    const live = this._live();
    el.live.hidden = !live;
    if (live) text(el.liveTx, live);
    const ready = d && !d.none && !d.failed && d.any;
    el.empty.hidden = !!ready;
    if (!ready) {
      text(el.empty, !d ? "Loading…" : d.failed ? "Couldn't read the energy statistics." : d.none ? "Pick an energy sensor (total) or some consumers. A sensor needs state class total_increasing and the unit kWh." : "No energy data for this period yet.");
      el.kwh.textContent = "";
      el.cost.textContent = "";
      el.delta.hidden = true;
      el.when.hidden = true;
      el.chart.hidden = el.axis.hidden = el.rank.hidden = true;
      this._wake();
      return;
    }
    el.when.hidden = false;
    const pick = this._sel != null ? d.series[this._sel] : null;
    const kwh = pick ? pick.kwh : d.cur.kwh, cost = pick ? pick.cost : d.cur.cost;
    el.kwh.innerHTML = `${this._fmtKwh(kwh)}<small>kWh</small>`;
    text(el.cost, d.hasPrice ? this._money(cost) : "");
    // against the same stretch before: the same hours of yesterday, the same days of last week
    const dl = el.delta;
    if (pick || d.prev.kwh < 0.05) dl.hidden = true;
    else {
      const pct = Math.round(((d.cur.kwh - d.prev.kwh) / d.prev.kwh) * 100);
      dl.hidden = false;
      attr(dl, "data-dir", pct > 2 ? "up" : pct < -2 ? "down" : "flat");
      text(dl, `${pct > 0 ? "▲" : pct < 0 ? "▼" : "="} ${Math.abs(pct)}% vs ${EN_PREV[d.range]}`);
    }
    text(el.when, pick ? this._barLabel(pick, d.range) : { today: "Today so far", week: "This week so far", month: "This month so far" }[d.range]);
    el.chart.hidden = el.axis.hidden = this._compact;
    el.rank.hidden = this._compact || !d.rank.length;
    if (!this._compact) { this._renderChart(d); this._renderRank(d); }
    attr(el.card, "aria-label", `${c.title ?? "Energy"}, ${this._fmtKwh(d.cur.kwh)} kWh${d.hasPrice ? `, ${this._money(d.cur.cost)}` : ""}, ${EN_WORD[d.range].toLowerCase()}`);
    if (this._first) { this._first = false; requestAnimationFrame(() => this._paintAll(null)); }
    this._wake();
  }

  _barLabel(b, range) {
    const lang = langOf(this._hass), t = new Date(b.t);
    return range === "today" ? `${new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(t)} – ${new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(t.getTime() + 3600000)}`
      : new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "short" }).format(t);
  }

  _renderChart(d) {
    const el = this._el, series = d.series, max = Math.max(0.0001, ...series.map((s) => s.kwh));
    while (this._bars.length > series.length) this._bars.pop().remove();
    while (this._bars.length < series.length) { const b = document.createElement("span"); b.className = "bar"; b.innerHTML = "<i></i>"; el.chart.appendChild(b); this._bars.push(b); }
    const nowKey = series.reduce((k, s, i) => (!s.future ? i : k), -1);
    series.forEach((s, i) => {
      const b = this._bars[i];
      b.__h = s.kwh / max;
      attr(b, "data-future", s.future);
      attr(b, "data-now", i === nowKey);
      attr(b, "data-sel", this._sel === i);
    });
    attr(el.chart, "data-pick", this._sel != null);
    attr(el.chart, "role", "img");
    attr(el.chart, "aria-label", `${EN_WORD[d.range]}: ${series.length} bars`);
    const lang = langOf(this._hass), f = (t, o) => new Intl.DateTimeFormat(lang, o).format(t);
    const marks = d.range === "today" ? [0, 6, 12, 18, 23].map((hr) => f(new Date(2000, 0, 1, hr), { hour: "2-digit" }))
      : d.range === "week" ? [series[0], series[3], series[6]].map((s) => f(s.t, { weekday: "short" }))
        : [series[0], series[Math.floor(series.length / 2)], series[series.length - 1]].map((s) => f(s.t, { day: "numeric" }));
    el.axis.replaceChildren(...marks.map((m) => { const i = document.createElement("i"); i.style.fontStyle = "normal"; i.textContent = m; return i; }));
    this._paintBars();
  }

  _paintBars() {
    const g = clamp(this._grow.x);
    for (const b of this._bars) put(b.firstElementChild, "height", `${(Math.max(0, b.__h || 0) * 100).toFixed(2)}%`), put(b.firstElementChild, "--g", g.toFixed(3));
  }

  _renderRank(d) {
    const el = this._el, h = this._hass, rows = d.rank.slice(0, this._config.max_consumers), seen = new Set();
    text(el.cap, this._config.by === "room" ? "By room" : "Biggest consumers");
    const max = Math.max(0.0001, ...rows.map((r) => r.kwh));
    rows.forEach((r, at) => {
      seen.add(r.id);
      let node = this._rows.get(r.id);
      if (!node) {
        node = document.createElement("button");
        node.className = "row";
        node.innerHTML = `<span class="ic"><ha-icon></ha-icon></span><span class="tx"><span class="nm"></span><span class="meter"><i></i></span></span><span class="num"><b></b><span></span></span>`;
        node.__enter = this._spring(0, MOTION.ui, `r:${r.id}`).to(1, MOTION.ui);
        this._pressable(node, { onTap: () => { const id = node.__r.room ? node.__r.members?.[0] : node.__r.id; if (id && h.states[id]) moreInfo(this, id); } }, 0.025);
        this._rows.set(r.id, node);
      }
      node.__r = r;
      const name = r.room ? (r.area ? areaInfo(h, r.area).name : "No room") : shortName(h, r.id, null);
      text(node.querySelector(".nm"), name);
      attr(node.querySelector("ha-icon"), "icon", r.room ? (r.area && h.areas?.[r.area]?.icon) || "mdi:floor-plan" : (h.states[r.id]?.attributes.icon || "mdi:flash"));
      put(node.querySelector(".meter i"), "--w", (r.kwh / max).toFixed(3));
      text(node.querySelector(".num b"), `${this._fmtKwh(r.kwh)} kWh`);
      text(node.querySelector(".num span"), d.hasPrice ? this._money(r.cost) : (!r.room && r.area ? areaInfo(h, r.area).name : ""));
      place(el.rows, node, at);
    });
    for (const [id, node] of this._rows) {
      if (seen.has(id)) continue;
      for (const s of [node.__enter, node.__spring]) { const i = this._springs.indexOf(s); if (i >= 0) this._springs.splice(i, 1); }
      const p = this._pressNodes.indexOf(node);
      if (p >= 0) this._pressNodes.splice(p, 1);
      node.remove();
      this._rows.delete(id);
    }
  }

  // a tap or a drag along the chart picks a bar; tapping the picked bar again lets it go
  _wireChart() {
    const chart = this._el.chart;
    const at = (e) => {
      const r = chart.getBoundingClientRect(), n = this._bars.length;
      return n ? Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / (r.width || 1)) * n))) : null;
    };
    let down = null, moved = false;
    chart.addEventListener("pointerdown", (e) => { down = e.pointerId; moved = false; });
    chart.addEventListener("pointermove", (e) => {
      if (e.pointerId !== down) return;
      const i = at(e);
      if (i == null || i === this._sel) return;
      moved = true;
      this._sel = i;
      haptic("selection");
      this._update();
    });
    chart.addEventListener("pointerup", (e) => {
      if (e.pointerId !== down) return;
      down = null;
      const i = at(e);
      if (!moved && i != null) { this._sel = this._sel === i ? null : i; haptic("light"); this._update(); }
    });
    chart.addEventListener("pointercancel", () => { down = null; });
  }

  _paint(dirty, all, red) {
    if (all || dirty.has("grow")) this._paintBars();
    for (const [, node] of this._rows) {
      if (!node.__enter) continue;
      const v = clamp(node.__enter.x);
      if (Math.abs(node.__spring?.x || 0) < 1e-3) put(node, "opacity", v > 0.999 ? "" : v.toFixed(3));
      put(node, "translate", red || v > 0.999 ? "" : `0 ${((1 - v) * 4).toFixed(2)}px`);
    }
  }
}

// ---------- editor ----------
const EDITOR = defineEditor("savvy-energy-card", () => [
  S.select("range", "Range", [{ value: "today", label: "Today" }, { value: "week", label: "This week" }, { value: "month", label: "This month" }]),
  S.grid(S.text("title", "Title", "Empty: Energy."), S.titleLink("title")),
  S.entity("total", "Whole house", "sensor", { helper: "An energy sensor (kWh, total increasing) for the whole house. Empty: the consumers' sum." }),
  { name: "consumers", label: "Consumers", helper: "Energy sensors to rank. Empty: every energy sensor found.", selector: { entity: { domain: "sensor", device_class: "energy", multiple: true } } },
  S.entity("power", "Live power", "sensor", { helper: "A power sensor (W or kW) for the live reading." }),
  { name: "tariff", label: "Tariff entity", helper: "A sensor or input number with the price per kWh. Each hour's own price is used.", selector: { entity: { domain: ["sensor", "input_number"] } } },
  S.grid({ name: "price", label: "Fixed price", helper: "Per kWh. Used when there is no tariff entity.", selector: { number: { min: 0, step: 0.001, mode: "box" } } }, S.text("currency", "Currency", "Empty: Home Assistant's.")),
  S.grid(S.select("by", "Ranking", [{ value: "device", label: "By device" }, { value: "room", label: "By room" }]), S.number("max_consumers", "Ranked", 1, 20)),
  { name: "area", label: "Areas", helper: "Only the consumers of these areas.", selector: { area: { multiple: true } } },
  { name: "exclude", label: "Never rank", selector: { entity: { domain: "sensor", multiple: true } } },
  S.select("layout", "Layout", [{ value: "full", label: "Full" }, { value: "compact", label: "Compact (numbers only)" }]),
]);

registerCard("savvy-energy-card", SavvyEnergyCard, "Energy",
  "What the house used and what it cost: today, week or month against the one before, a bar for every hour, live power and the biggest consumers.");
