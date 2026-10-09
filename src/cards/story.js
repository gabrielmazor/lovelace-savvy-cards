// savvy-story-card: what happened at home, told in plain sentences. The logbook, without the noise:
// a motion sensor that fired seven times is one line, a room's lights are one span ("on 18:02 to 23:10"),
// a door unlocked from the app says who did it, and "While you were away" shows what happened since the
// last person left.
//
//   type: custom:savvy-story-card
//   range: today | 24h | away             (tap the range chip to change it; away: since the last person left)
//   area: [kitchen, hallway]              (empty: the whole house)
//   title: Home story                     title_path: /lovelace/logbook
//   people: true                          (arrivals and departures; false hides them)
//   filters: true                         (chips: All, People, Security, Rooms; false hides the row)
//   include: [switch.x]  exclude: [light.y]   (the Savvy settings' ignore list is added to exclude)
//   max_events: 30                        (then "Show more")
//   merge_minutes: 20                     (repeats of one thing closer than this are one line)
//   layout: full | compact
//
// Shown by default: lights, locks, doors and windows, motion, garage and gate, alarms, people, players
// starting, vacuums, leaks and smoke. Sensors, automations, updates and the like stay out. Tap a line
// for its details.

const ST_RANGES = ["today", "24h", "away"];
const ST_RANGE_WORD = { today: "Today", "24h": "24 hours", away: "While away" };
const ST_PARTS = [[5, "Morning"], [12, "Afternoon"], [17, "Evening"], [22, "Night"]];
const ST_SHOW = new Set(["light", "lock", "cover", "binary_sensor", "person", "media_player", "alarm_control_panel", "vacuum", "switch", "fan", "siren"]);
const ST_ALERT_CLASSES = new Set(["moisture", "smoke", "gas", "carbon_monoxide", "safety", "tamper", "problem"]);
const ST_OPENINGS = new Set(["door", "garage_door", "window", "opening"]);
const ST_MOTION = new Set(["motion", "occupancy", "presence", "moving"]);
const ST_LIGHTS = new Set(["light"]);
const ST_FILTERS = [["all", "All"], ["people", "People"], ["security", "Security"], ["rooms", "Rooms"]];

const STYLE = `${BASE_CSS}
  ha-card { --pad: 14px; --rt: var(--accent); position: relative; display: flex; flex-direction: column; gap: 10px; padding: var(--pad); overflow: hidden; }
  :host([data-compact]) ha-card { --pad: 12px; gap: 8px; }
  ha-card > * { position: relative; }
  .head { display: flex; align-items: center; gap: 10px; min-height: 28px; }
  .head .t { flex: 1; min-width: 0; font-size: 16px; line-height: 21px; font-weight: 620; letter-spacing: -0.021em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { font-size: 12.5px; line-height: 16px; font-weight: 500; color: var(--secondary-text-color); margin-top: -6px; }
  .filters { display: flex; gap: 6px; overflow-x: auto; overscroll-behavior-x: contain; touch-action: pan-x pan-y; scrollbar-width: none; padding: 3px; margin: -3px; }
  .filters::-webkit-scrollbar { display: none; }
  .filters[data-overflow] { -webkit-mask-image: linear-gradient(to left, transparent 0, #000 26px); mask-image: linear-gradient(to left, transparent 0, #000 26px); }
  .f { flex: none; display: inline-flex; align-items: center; height: 32px; padding: 0 13px; border-radius: 16px; background: var(--well); white-space: nowrap;
    font-size: 12.5px; font-weight: 650; color: var(--secondary-text-color); cursor: pointer; }
  .f[data-on] { color: rgb(var(--accent)); background: color-mix(in oklab, rgb(var(--accent)) var(--mix-on), transparent); }
  .f.range { margin-inline-start: auto; }
  .list { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .part { margin: 12px 4px 2px; font-size: 13px; line-height: 17px; font-weight: 600; letter-spacing: -0.006em; color: var(--secondary-text-color); }
  .part:first-child { margin-top: 0; }
  .ev { --rt: var(--accent); display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 44px; padding: 4px 4px 4px 2px; border-radius: 14px; cursor: pointer; text-align: start; }
  .ev[data-tone="warn"] { --rt: var(--warn-rgb); }
  .ev[data-tone="bad"] { --rt: var(--bad-rgb); }
  .ev[data-tone="good"] { --rt: var(--good-rgb); }
  .ev .ic { flex: none; display: grid; place-items: center; width: var(--b-m); height: var(--b-m); border-radius: 50%; --mdc-icon-size: 20px;
    color: rgb(var(--rt)); background: transparent; --mdc-icon-size: 22px; }
  .ev .ic ha-icon { display: flex; }
  .ev .tx { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .ev .nm { font-size: 14px; line-height: 18px; font-weight: 600; letter-spacing: -0.01em; }
  .ev .dt { font-size: 12.5px; line-height: 16px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ev .tm { flex: none; font-size: 12.5px; line-height: 16px; font-weight: 600; color: var(--secondary-text-color); white-space: nowrap; margin-inline-end: 4px; }
  .more { align-self: flex-start; margin: 2px 0 0 2px; padding: 0 12px; height: 32px; border-radius: 16px; background: var(--well); font-size: 12.5px; font-weight: 650; color: var(--secondary-text-color); cursor: pointer; }
  .empty { padding: 4px 2px; font-size: 13px; font-weight: 500; color: var(--secondary-text-color); }
  :host([data-compact]) .ev { min-height: 38px; }
  :host([data-compact]) .ev .dt { display: none; }
  @media (prefers-contrast: more) { .ev .dt, .ev .tm, .sub { color: var(--primary-text-color); } }
`;

class SavvyStoryCard extends SavvyCard {
  static getStubConfig() { return {}; }
  static getConfigElement() { return document.createElement(EDITOR); }

  constructor() {
    super();
    this._nodes = new Map();
    this._filter = "all";
    this._shown = 0;
    this._data = null;
    this._seen = false;
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("savvy-story-card: invalid configuration");
    const areas = [].concat(config.area ?? config.areas ?? []).filter(Boolean);
    this._config = { ...config, areas, include: asItems(config.include).map((i) => i.entity),
      exclude: asItems(config.exclude).map((i) => i.entity), exclude_areas: [].concat(config.exclude_areas || []) };
    this._compact = config.layout === "compact";
    this._range = ST_RANGES.includes(config.range) ? config.range : "today";
    this._filter = "all";
    this._shown = Number(config.max_events) > 0 ? Number(config.max_events) : 30;
    this._data = null;
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
    this._io = this._io || (typeof IntersectionObserver === "function" ? new IntersectionObserver(([e]) => {
      this._onscreen = e.isIntersecting;
      if (e.isIntersecting && this._hass && (!this._data || Date.now() - this._data.at > 45000)) this._load();
    }) : null);
    this._io?.observe(this);
    this._poll = this._poll || setInterval(() => { if (this._onscreen !== false && this._hass) this._load(); }, 60000);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._io?.disconnect();
    this._io = null;
    clearInterval(this._poll);
    this._poll = 0;
  }
  getCardSize() { return 2 + Math.min(this._nodes.size, this._compact ? 4 : 8); }
  getGridOptions() { return { columns: 12, min_columns: 4, rows: "auto" }; }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._resetMotion();
    this._nodes.clear();
    const c = this._config;
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="head"><span class="t" id="title"></span></div>
        <div class="sub" id="sub" hidden></div>
        <div class="filters" id="filters"></div>
        <div class="list" id="list"></div>
        <button class="more" id="more" hidden></button>
        <div class="empty" id="empty" hidden></div>
      </ha-card>`;
    const $ = (id) => root.getElementById(id);
    this._el = { card: root.querySelector("ha-card"), title: $("title"), sub: $("sub"), filters: $("filters"), list: $("list"), more: $("more"), empty: $("empty") };
    linkTitle(root, this._el.title, titlePathOf(c), (el, onTap) => this._pressable(el, { onTap }, 0.04));
    this._pressable(this._el.more, { onTap: () => { this._shown += Number(this._config.max_events) > 0 ? Number(this._config.max_events) : 30; this._update(); } }, 0.05);
    this._buildFilters();
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => this._fitRow(this._el.filters));
    this._ro.observe(this._el.filters);
    this._first = true;
  }

  _buildFilters() {
    const el = this._el, c = this._config;
    el.filters.replaceChildren();
    el.filters.hidden = c.filters === false;
    this._pills = new Map();
    for (const [key, label] of ST_FILTERS) {
      const b = document.createElement("button");
      b.className = "f";
      b.textContent = label;
      this._pressable(b, { onTap: () => { this._filter = key; this._shown = Number(c.max_events) > 0 ? Number(c.max_events) : 30; this._update(); } }, 0.06);
      el.filters.appendChild(b);
      this._pills.set(key, b);
    }
    const r = document.createElement("button");
    r.className = "f range";
    this._pressable(r, { onTap: () => { this._range = ST_RANGES[(ST_RANGES.indexOf(this._range) + 1) % ST_RANGES.length]; this._data = null; this._update(); this._load(true); } }, 0.06);
    el.filters.appendChild(r);
    this._rangeBtn = r;
  }

  // ---------- the time window ----------
  _dayStart(ts = Date.now()) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }

  async _window() {
    const now = Date.now();
    if (this._range === "today") return { start: this._dayStart(now), end: now };
    if (this._range === "24h") return { start: now - 86400000, end: now };
    const away = await this._awayWindow();
    return away ? { ...away, away: true } : { start: now - 86400000, end: now, fell: true };
  }

  // from the moment the last person left until the first one came back (or now), from the people's history
  async _awayWindow() {
    const h = this._hass, people = Object.keys(h.states).filter((id) => id.startsWith("person."));
    if (!people.length) return null;
    const now = Date.now(), start = now - 3 * 86400000;
    let res;
    try {
      res = await h.callWS({ type: "history/history_during_period", start_time: new Date(start).toISOString(), end_time: new Date(now).toISOString(),
        entity_ids: people, minimal_response: true, no_attributes: true, significant_changes_only: false });
    } catch (err) { return null; }
    const marks = [];
    for (const id of people) {
      for (const e of res?.[id] || []) {
        const t = (e.lu ?? (e.last_changed ? Date.parse(e.last_changed) / 1000 : null));
        marks.push({ id, home: (e.s ?? e.state) === "home", t: t == null ? start : t * 1000 });
      }
    }
    marks.sort((a, b) => a.t - b.t);
    // a person with no history in the window is where they are now
    const at = new Map(people.map((p) => [p, (res?.[p] || []).length ? true : h.states[p].state === "home"]));
    let from = null, last = null;
    for (const m of marks) {
      at.set(m.id, m.home);
      const none = ![...at.values()].some(Boolean);
      if (none && from == null) from = m.t;
      else if (!none && from != null) { last = { start: from, end: m.t }; from = null; }
    }
    if (from != null) last = { start: from, end: now, ongoing: true };
    return last;
  }

  _ids() {
    const h = this._hass, c = this._config;
    const skip = new Set(c.exclude), skipArea = new Set(c.exclude_areas);
    let ids = c.areas.length ? [...new Set(c.areas.flatMap((a) => areaEntities(h, a)))] : houseEntities(h);
    for (const id of c.include) if (h.states[id] && !ids.includes(id)) ids = [...ids, id];
    const inc = new Set(c.include);
    return ids.filter((id) => {
      if (skip.has(id)) return false;
      const a = entityArea(h, id);
      if (a && skipArea.has(a)) return false;
      const d = domainOf(id);
      if (d === "person") return c.people !== false;
      return inc.has(id) || ST_SHOW.has(d);
    });
  }

  async _load(force) {
    const h = this._hass;
    if (!h || !this._config) return;
    const token = (this._token = (this._token || 0) + 1);
    const win = await this._window();
    if (token !== this._token) return;
    // persons are wanted whatever the area: who came and went is the house's story
    let ids = this._ids();
    if (this._config.areas.length && this._config.people !== false) {
      ids = [...new Set([...ids, ...Object.keys(h.states).filter((id) => id.startsWith("person."))])];
    }
    let events = [];
    try {
      events = await h.callWS({ type: "logbook/get_events", start_time: new Date(win.start).toISOString(), end_time: new Date(win.end + 60000).toISOString(), entity_ids: ids });
    } catch (err) { this._data = { events: [], win, at: Date.now(), failed: true }; this._update(); return; }
    if (token !== this._token) return;
    this._data = { events: Array.isArray(events) ? events : [], win, at: Date.now() };
    this._update();
  }

  // ---------- plain sentences ----------
  _name(id) {
    const h = this._hass, area = entityArea(h, id), raw = h.states[id]?.attributes.friendly_name || title(id.split(".")[1].replace(/_/g, " "));
    const an = area ? areaInfo(h, area).name : "";
    const out = an ? raw.replace(new RegExp(`^\\s*${an.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[/:|·–—-]*\\s*`, "i"), "").trim() : raw;
    return out || raw;
  }

  // one event -> { text, cat, icon, tone, base } or null when it is not worth a line
  _phrase(ev) {
    const h = this._hass, id = ev.entity_id, st = h.states[id], d = domainOf(id), s = String(ev.state ?? "");
    if (!id || !s || s === "unavailable" || s === "unknown") return null;
    const dc = st?.attributes.device_class;
    const area = entityArea(h, id), an = area ? areaInfo(h, area).name : "";
    const full = st?.attributes.friendly_name || title(id.split(".")[1].replace(/_/g, " "));
    const nm = this._name(id);
    if (d === "person") {
      const who = st?.attributes.friendly_name || nm;
      if (s === "home") return { text: `${who} arrived home`, cat: "people", icon: "mdi:home-account", tone: "good" };
      if (s === "not_home") return { text: `${who} left home`, cat: "people", icon: "mdi:home-export-outline", tone: "" };
      return { text: `${who} arrived at ${title(s.replace(/_/g, " "))}`, cat: "people", icon: "mdi:map-marker", tone: "" };
    }
    if (d === "lock") {
      if (s === "locked") return { text: `${full} locked`, cat: "security", icon: "mdi:lock", tone: "good", base: `${full} locked` };
      if (s === "unlocked") return { text: `${full} unlocked`, cat: "security", icon: "mdi:lock-open-variant", tone: "warn", base: `${full} unlocked` };
      if (s === "open") return { text: `${full} opened`, cat: "security", icon: "mdi:door-open", tone: "warn", base: `${full} opened` };
      if (s === "jammed") return { text: `${full} jammed`, cat: "security", icon: "mdi:lock-alert", tone: "bad" };
      return null;
    }
    if (d === "alarm_control_panel") {
      if (s === "disarmed") return { text: `${full} disarmed`, cat: "security", icon: "mdi:shield-off", tone: "" };
      if (s === "triggered") return { text: `${full} went off`, cat: "security", icon: "mdi:shield-alert", tone: "bad" };
      if (s.startsWith("armed")) return { text: `${full} armed${s.length > 6 ? ` (${s.slice(6).replace(/_/g, " ")})` : ""}`, cat: "security", icon: "mdi:shield-lock", tone: "good" };
      return null;
    }
    if (d === "cover") {
      if (s === "open") return { text: `${full} opened`, cat: "security", icon: dc === "garage" ? "mdi:garage-open" : "mdi:window-shutter-open", tone: dc === "garage" || dc === "gate" ? "warn" : "", base: `${full} opened` };
      if (s === "closed") return { text: `${full} closed`, cat: "security", icon: dc === "garage" ? "mdi:garage" : "mdi:window-shutter", tone: "", base: `${full} closed` };
      return null;
    }
    if (d === "binary_sensor") {
      if (ST_MOTION.has(dc)) return s === "on" ? { text: an ? `Motion in ${an}` : `${full} detected motion`, cat: "rooms", icon: "mdi:motion-sensor", tone: "", base: an ? `Motion in ${an}` : full } : null;
      if (ST_OPENINGS.has(dc)) {
        const garage = dc === "garage_door";
        return s === "on" ? { text: `${full} opened`, cat: "security", icon: garage ? "mdi:garage-open" : dc === "window" ? "mdi:window-open-variant" : "mdi:door-open", tone: "warn", base: `${full} opened` }
          : s === "off" ? { text: `${full} closed`, cat: "security", icon: garage ? "mdi:garage" : dc === "window" ? "mdi:window-closed-variant" : "mdi:door-closed", tone: "", base: `${full} closed` } : null;
      }
      if (ST_ALERT_CLASSES.has(dc)) {
        const word = { moisture: "leak detected", smoke: "smoke detected", gas: "gas detected", carbon_monoxide: "carbon monoxide detected", tamper: "tampered with", safety: "unsafe", problem: "has a problem" }[dc];
        return s === "on" ? { text: `${full}: ${word}`, cat: "security", icon: dc === "moisture" ? "mdi:water-alert" : dc === "smoke" ? "mdi:smoke" : "mdi:alert", tone: "bad" }
          : s === "off" ? { text: `${full}: cleared`, cat: "security", icon: "mdi:check-circle-outline", tone: "good" } : null;
      }
      return null;
    }
    if (d === "media_player") return s === "playing" ? { text: `${full} started playing`, cat: "rooms", icon: "mdi:play-circle", tone: "", base: `${full} started playing` } : null;
    if (d === "vacuum") {
      if (s === "cleaning") return { text: `${full} started cleaning`, cat: "rooms", icon: "mdi:robot-vacuum", tone: "" };
      if (s === "docked") return { text: `${full} finished and docked`, cat: "rooms", icon: "mdi:robot-vacuum", tone: "good" };
      if (s === "error") return { text: `${full} got stuck`, cat: "rooms", icon: "mdi:robot-vacuum-alert", tone: "bad" };
      return null;
    }
    if (ST_LIGHTS.has(d)) return null;     // lights are told as spans, below
    if (d === "switch" || d === "fan" || d === "siren") {
      if (s === "on") return { text: `${full} turned on`, cat: "rooms", icon: d === "fan" ? "mdi:fan" : d === "siren" ? "mdi:bullhorn" : "mdi:toggle-switch", tone: d === "siren" ? "bad" : "", base: `${full} turned on` };
      if (s === "off") return { text: `${full} turned off`, cat: "rooms", icon: d === "fan" ? "mdi:fan-off" : "mdi:toggle-switch-off", tone: "", base: `${full} turned off` };
    }
    return null;
  }

  // ---------- from events to lines ----------
  _lines() {
    const h = this._hass, c = this._config, data = this._data;
    if (!data) return [];
    const gap = (Number(c.merge_minutes) > 0 ? Number(c.merge_minutes) : 20) * 60000;
    const evs = data.events.map((e) => ({ ...e, t: Number(e.when) * 1000 })).filter((e) => Number.isFinite(e.t)).sort((a, b) => a.t - b.t);
    const people = new Map(Object.keys(h.states).filter((i) => i.startsWith("person.")).map((i) => [h.states[i].attributes.user_id, h.states[i].attributes.friendly_name || this._name(i)]));
    const lines = [];
    const open = new Map();                 // entity+text -> the line a repeat joins
    const lightOn = new Map();              // light entity -> since
    const spans = [];                       // [{ area, start, end|null }]
    for (const e of evs) {
      const id = e.entity_id;
      if (id && domainOf(id) === "light") {
        const s = String(e.state);
        if (s === "on" && !lightOn.has(id)) lightOn.set(id, e.t);
        else if (s === "off") {
          const from = lightOn.get(id);
          lightOn.delete(id);
          spans.push({ id, area: entityArea(h, id) || "", start: from ?? null, end: e.t });
        }
        continue;
      }
      const p = this._phrase(e);
      if (!p) continue;
      const who = e.context_user_id && people.get(e.context_user_id);
      const key = `${id}|${p.base || p.text}`;
      const prev = p.base ? open.get(key) : null;
      if (prev && e.t - prev.last <= gap) { prev.n++; prev.last = e.t; prev.end = e.t; continue; }
      const line = { key: `${id}:${e.t}`, entity: id, ...p, t: e.t, end: e.t, last: e.t, n: 1, who: who && p.cat !== "people" ? who : "" };
      lines.push(line);
      if (p.base) open.set(key, line);
    }
    for (const [id, start] of lightOn) spans.push({ id, area: entityArea(h, id) || "", start, end: null });
    // a room's lights: the spans of all its lights, joined where they overlap
    const byArea = new Map();
    for (const s of spans) { if (!byArea.has(s.area)) byArea.set(s.area, []); byArea.get(s.area).push(s); }
    for (const [area, list] of byArea) {
      const sorted = list.map((s) => ({ ...s, start: s.start ?? data.win.start, early: s.start == null })).sort((a, b) => a.start - b.start);
      let cur = null;
      const flush = () => {
        if (!cur) return;
        const room = area ? areaInfo(h, area).name : "";
        const ongoing = cur.end == null;
        lines.push({ key: `light:${area}:${cur.start}`, entity: cur.id, cat: "rooms", icon: "mdi:lightbulb", tone: "warn", t: cur.start, end: cur.end ?? Date.now(), last: cur.end ?? Date.now(), n: 1,
          text: `${room ? `${room} lights` : "Lights"} ${ongoing ? "on" : "were on"}`, span: true, ongoing, early: cur.early, who: "" });
        cur = null;
      };
      for (const s of sorted) {
        if (cur && (cur.end == null || s.start <= cur.end)) { cur.end = cur.end == null || s.end == null ? (cur.end == null ? null : s.end) : Math.max(cur.end, s.end); }
        else { flush(); cur = { ...s }; }
      }
      flush();
    }
    return lines.sort((a, b) => b.t - a.t);
  }

  _fmtTime(t) { return new Intl.DateTimeFormat(langOf(this._hass), { hour: "2-digit", minute: "2-digit" }).format(t); }
  _partOf(t) {
    const hr = new Date(t).getHours();
    let name = "Night";
    for (const [from, n] of ST_PARTS) if (hr >= from) name = n;
    return hr < 5 ? "Night" : name;
  }
  _dayWord(t) {
    const d = this._dayStart(t), today = this._dayStart();
    if (d === today) return "";
    if (d === today - 86400000) return "Yesterday";
    return new Intl.DateTimeFormat(langOf(this._hass), { weekday: "long" }).format(t);
  }

  _detail(l) {
    const h = this._hass, bits = [];
    if (l.span) {
      const dur = Math.max(0, l.end - l.t);
      bits.push(l.ongoing ? `since ${this._fmtTime(l.t)}` : `${this._fmtTime(l.t)}–${this._fmtTime(l.end)}`);
      if (!l.ongoing && dur >= 60000) bits.push(duration(dur));
      return bits.join(" · ");
    }
    if (l.n > 1) bits.push(`${l.n} times, ${this._fmtTime(l.t)}–${this._fmtTime(l.end)}`);
    const area = entityArea(h, l.entity);
    if (area && l.cat !== "people" && !l.text.includes(areaInfo(h, area).name)) bits.push(areaInfo(h, area).name);
    if (l.who) bits.push(`by ${l.who}`);
    return bits.join(" · ");
  }

  // ---------- painting ----------
  _update() {
    const h = this._hass;
    if (!h || !this._el) return;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    this.toggleAttribute("data-compact", this._compact);
    const c = this._config, el = this._el, data = this._data;
    const away = this._range === "away";
    text(el.title, c.title || (away ? "While you were away" : "Home story"));
    for (const [key, b] of this._pills) attr(b, "data-on", key === this._filter);
    text(this._rangeBtn, ST_RANGE_WORD[this._range]);
    attr(this._rangeBtn, "aria-label", `Range: ${ST_RANGE_WORD[this._range]}. Tap to change`);
    const all = this._lines();
    const lines = all.filter((l) => this._filter === "all" || l.cat === this._filter);
    const shown = lines.slice(0, this._shown);
    // the small line: what the window is
    let sub = "";
    if (data?.win?.away) sub = `Since ${this._fmtTime(data.win.start)}${data.win.end < Date.now() - 60000 ? `, until ${this._fmtTime(data.win.end)}` : ""}`;
    else if (data?.win?.fell) sub = "Nobody has been away lately. Showing the last 24 hours.";
    el.sub.hidden = !sub;
    text(el.sub, sub);
    this._renderLines(shown);
    el.more.hidden = lines.length <= shown.length;
    if (lines.length > shown.length) text(el.more, `Show more · ${lines.length - shown.length}`);
    el.empty.hidden = shown.length > 0;
    if (!shown.length) text(el.empty, !data ? "Loading…" : data.failed ? "Couldn't read the logbook." : away ? "Nothing happened while you were away." : this._range === "today" ? "Nothing has happened yet today." : "Nothing happened in the last 24 hours.");
    attr(el.card, "aria-label", c.title || "Home story");
    if (this._first) { this._first = false; requestAnimationFrame(() => this._paintAll(null)); }
    this._wake();
  }

  _renderLines(lines) {
    const el = this._el, h = this._hass;
    Motion.flip(el.list, () => {
      const seen = new Set();
      let at = 0, lastPart = null;
      const multiDay = this._range !== "today";
      for (const l of lines) {
        const part = `${multiDay ? this._dayWord(l.t) : ""}|${this._partOf(l.t)}|${multiDay ? this._dayStart(l.t) : 0}`;
        if (part !== lastPart) {
          lastPart = part;
          const pid = `p:${part}`;
          seen.add(pid);
          let lab = this._nodes.get(pid);
          if (!lab) { lab = document.createElement("div"); lab.className = "part"; this._nodes.set(pid, lab); }
          const dw = multiDay ? this._dayWord(l.t) : "";
          text(lab, `${dw ? `${dw} · ` : ""}${this._partOf(l.t)}`);
          place(el.list, lab, at++);
        }
        const id = `e:${l.key}`;
        seen.add(id);
        let node = this._nodes.get(id);
        if (!node) {
          node = document.createElement("button");
          node.className = "ev";
          node.innerHTML = `<span class="ic"><ha-icon></ha-icon></span><span class="tx"><span class="nm"></span><span class="dt"></span></span><span class="tm"></span>`;
          node.__enter = this._spring(this._seen ? 0 : 1, MOTION.ui, `ev:${l.key}`).to(1, MOTION.ui);
          this._pressable(node, { onTap: () => node.__l?.entity && moreInfo(this, node.__l.entity) }, 0.025);
          this._nodes.set(id, node);
        }
        node.__l = l;
        attr(node, "data-tone", l.tone || null);
        attr(node.querySelector("ha-icon"), "icon", l.icon);
        text(node.querySelector(".nm"), l.text);
        const detail = this._detail(l);
        text(node.querySelector(".dt"), detail);
        node.querySelector(".dt").hidden = !detail;
        text(node.querySelector(".tm"), this._fmtTime(l.span ? l.t : l.n > 1 ? l.end : l.t));
        place(el.list, node, at++);
      }
      for (const [id, node] of this._nodes) {
        if (seen.has(id)) continue;
        for (const s of [node.__enter, node.__spring]) { const i = this._springs.indexOf(s); if (i >= 0) this._springs.splice(i, 1); }
        const p = this._pressNodes.indexOf(node);
        if (p >= 0) this._pressNodes.splice(p, 1);
        node.remove();
        this._nodes.delete(id);
      }
    });
    if (this._data) this._seen = true;
    this._fitRow(this._el.filters);
  }

  _paint(dirty, all, red) {
    for (const [, node] of this._nodes) {
      if (!node.__enter) continue;
      const v = clamp(node.__enter.x);
      put(node, "opacity", v > 0.999 ? "" : v.toFixed(3));
      put(node, "translate", red || v > 0.999 ? "" : `0 ${((1 - v) * 6).toFixed(2)}px`);
    }
  }
}

// ---------- editor ----------
const EDITOR = defineEditor("savvy-story-card", () => [
  S.select("range", "Range", [{ value: "today", label: "Today" }, { value: "24h", label: "Last 24 hours" }, { value: "away", label: "While you were away" }]),
  S.grid(S.text("title", "Title", "Empty: Home story."), S.titleLink("title")),
  { name: "area", label: "Areas", helper: "Empty: the whole house.", selector: { area: { multiple: true } } },
  S.grid(S.bool("people", "People", "Arrivals and departures.", true), S.bool("filters", "Filter chips", "All, People, Security, Rooms.", true)),
  { name: "include", label: "Also show", helper: "Entities that are left out by default (a sensor, say).", selector: { entity: { multiple: true } } },
  { name: "exclude", label: "Never show", selector: { entity: { multiple: true } } },
  S.grid(S.number("max_events", "Lines", 5, 200), S.number("merge_minutes", "Merge repeats within", 1, 240, 1, "min")),
  S.select("layout", "Layout", [{ value: "full", label: "Full" }, { value: "compact", label: "Compact" }]),
]);

registerCard("savvy-story-card", SavvyStoryCard, "Home story",
  "What happened at home in plain sentences: who came and went, doors, lights by room, and what happened while you were away.");
