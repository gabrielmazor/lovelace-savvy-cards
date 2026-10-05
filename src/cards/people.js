// savvy-people-card: who is home. An avatar for each person with a ring when they are home, where they are
// ("Home · 3 h", "At Work · 40 min", "Away · 2 h"), the phone's battery and, when someone is on the way,
// how long they will be. Tap a person for their details (the map is there).
//
//   type: custom:savvy-people-card
//   people: [person.a, { entity: person.b, name: Sam, eta: sensor.sam_travel_time, battery: sensor.sam_phone_battery }]
//                                         (default: every person)
//   title: Family                         (default: "At home: 2 of 3" is the pill)    title_path: /lovelace/people
//   battery: true                         (the phone's battery, found through the person's tracker; false hides it)
//   battery_warn: 20                      (amber below this)
//   eta: sensor.x                         (for everyone; or `eta` on a person. Minutes, or a time)
//   exclude: [person.guest]               (the Savvy settings' ignore list is added to it)
//   layout: full | compact                (compact: a row of avatars)
//   direction: vertical | horizontal      (full layout: one under the other, or side by side and wrapping)
//
// Home first, then the others by name. An ETA only shows while the person is away.

const PE_BATT_WARN = 20;

const STYLE = `${BASE_CSS}
  ha-card { --pad: 14px; --tone: var(--good-rgb); position: relative; display: flex; flex-direction: column; gap: 8px; padding: var(--pad); overflow: hidden; }
  :host([data-compact]) ha-card { --pad: 12px; }
  ha-card > * { position: relative; }
  .head { display: flex; align-items: center; gap: 10px; min-height: 28px; }
  .head .t { flex: 1; min-width: 0; font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pill { flex: none; display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: 12px; white-space: nowrap;
    font-size: 12px; font-weight: 650; color: rgb(var(--tone)); background: color-mix(in oklab, rgb(var(--tone)) var(--mix-on), transparent); }
  .list { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .p { --pc: var(--secondary-text-color); display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 52px; padding: 4px 4px 4px 2px; border-radius: 16px; cursor: pointer; text-align: start; }
  .av { position: relative; flex: none; width: var(--b-l); height: var(--b-l); border-radius: 50%; display: grid; place-items: center; overflow: hidden;
    background: var(--well); color: var(--secondary-text-color); font-size: 16px; font-weight: 650; box-shadow: 0 0 0 2px transparent; }
  .av img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .av::after { content: ""; position: absolute; inset: 0; border-radius: 50%; box-shadow: inset 0 0 0 2px rgb(var(--good-rgb) / var(--ring, 0)); pointer-events: none; }
  .p[data-home] .av { --ring: 1; }
  .p:not([data-home]) .av img { filter: saturate(0.55); opacity: 0.85; }
  .tx { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .nm { font-size: 14px; line-height: 18px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .st { display: flex; align-items: center; gap: 4px; min-width: 0; font-size: 12.5px; line-height: 16px; font-weight: 500; color: var(--secondary-text-color); --mdc-icon-size: 14px; }
  .st ha-icon { flex: none; display: flex; }
  .st .stt { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .p[data-home] .st { color: rgb(var(--good-rgb)); }
  .chipz { flex: none; display: flex; align-items: center; gap: 6px; }
  .chp { display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 9px 0 6px; border-radius: 13px; background: var(--well); white-space: nowrap;
    font-size: 12px; font-weight: 600; color: var(--secondary-text-color); --mdc-icon-size: 16px; }
  .chp ha-icon { display: flex; }
  .chp[data-level="warn"] { color: rgb(var(--warn-rgb)); background: color-mix(in oklab, rgb(var(--warn-rgb)) var(--mix-alert), transparent); }
  .chp[data-level="bad"] { color: rgb(var(--bad-rgb)); background: color-mix(in oklab, rgb(var(--bad-rgb)) var(--mix-alert), transparent); }
  .chp.eta { color: rgb(var(--accent)); background: color-mix(in oklab, rgb(var(--accent)) var(--mix-on), transparent); }
  /* side by side: tiles that wrap, each with its chips under its text when it is narrow */
  :host([data-dir="horizontal"]:not([data-compact])) .list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr)); gap: 4px 8px; }
  :host([data-dir="horizontal"]:not([data-compact])) .p { flex-wrap: wrap; row-gap: 4px; }
  :host([data-dir="horizontal"]:not([data-compact])) .chipz { flex: 1 0 100%; padding-inline-start: 54px; }
  :host([data-dir="horizontal"]:not([data-compact])) .chipz:empty { display: none; }
  /* compact: a row of avatars with a first name under each */
  :host([data-compact]) .list { flex-direction: row; gap: 4px; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none; touch-action: pan-x pan-y; padding: 2px; margin: -2px; }
  :host([data-compact]) .list::-webkit-scrollbar { display: none; }
  :host([data-compact]) .p { flex: none; flex-direction: column; gap: 4px; min-height: 0; width: 64px; padding: 4px 0; align-items: center; text-align: center; }
  :host([data-compact]) .tx { flex: none; align-items: center; max-width: 100%; }
  :host([data-compact]) .st, :host([data-compact]) .chipz { display: none; }
  :host([data-compact]) .nm { font-size: 12.5px; line-height: 16px; max-width: 64px; }
  .empty { padding: 4px 2px; font-size: 12.5px; font-weight: 500; color: var(--secondary-text-color); }
`;

class SavvyPeopleCard extends SavvyCard {
  static getStubConfig() { return {}; }
  static getConfigElement() { return document.createElement(EDITOR); }

  constructor() {
    super();
    this._nodes = new Map();
    this._reg = new WeakMap();
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("savvy-people-card: invalid configuration");
    this._config = { ...config, people: asItems(config.people), exclude: asItems(config.exclude).map((i) => i.entity) };
    this._compact = config.layout === "compact";
    this._horizontal = config.direction === "horizontal";
    if (this._el) { this._build(); if (this._hass) this._update(); }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._el) this._build();
    this._update();
  }

  connectedCallback() { this._wake(); this._tick = this._tick || setInterval(() => { if (this._hass && this._el) this._update(); }, 60000); }
  disconnectedCallback() { super.disconnectedCallback(); clearInterval(this._tick); this._tick = 0; }
  getCardSize() { return this._compact ? 2 : 1 + Math.max(1, this._nodes.size); }
  getGridOptions() { return { columns: 12, min_columns: 3, rows: "auto" }; }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._resetMotion();
    this._nodes.clear();
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="head"><span class="t" id="title"></span><span class="pill" id="pill"></span></div>
        <div class="list" id="list"></div>
        <div class="empty" id="empty" hidden></div>
      </ha-card>`;
    const $ = (id) => root.getElementById(id);
    this._el = { card: root.querySelector("ha-card"), head: root.querySelector(".head"), title: $("title"), pill: $("pill"), list: $("list"), empty: $("empty") };
    linkTitle(root, this._el.title, titlePathOf(this._config), (el, onTap) => this._pressable(el, { onTap }, 0.04));
    this._first = true;
  }

  // ---------- who, and what goes with them ----------
  _items() {
    const h = this._hass, c = this._config, skip = new Set(c.exclude);
    const out = [];
    for (const p of c.people) if (p.entity && h.states[p.entity] && !out.some((o) => o.entity === p.entity)) out.push(p);
    if (!c.people.length) {
      for (const id of Object.keys(h.states)) if (id.startsWith("person.") && !skip.has(id)) out.push({ entity: id });
    }
    const home = (i) => (h.states[i.entity].state === "home" ? 0 : 1);
    const name = (i) => i.name || h.states[i.entity].attributes.friendly_name || i.entity;
    // an explicit list keeps its order; the automatic one puts who is home first
    if (!c.people.length) out.sort((a, b) => home(a) - home(b) || name(a).localeCompare(name(b), langOf(h)));
    return out;
  }

  // the phone's battery: the person's tracker, its device, and the battery sensor that device has
  _battery(item) {
    const h = this._hass, c = this._config;
    const own = item.battery ?? undefined;
    if (own === false || c.battery === false) return null;
    if (typeof own === "string" && own) return { id: own, level: parseFloat(h.states[own]?.state) };
    const st = h.states[item.entity];
    const trackers = [].concat(st?.attributes.source || [], st?.attributes.device_trackers || []).filter(Boolean);
    for (const t of trackers) {
      const tr = h.states[t];
      const own = Number(tr?.attributes.battery_level ?? tr?.attributes.battery);
      const dev = h.entities?.[t]?.device_id;
      if (dev) {
        const ents = h.entities;
        let m = this._reg.get(ents);
        if (!m) { m = new Map(); this._reg.set(ents, m); }
        if (!m.has(dev)) m.set(dev, Object.keys(ents).filter((k) => ents[k].device_id === dev));
        const sensor = m.get(dev).find((k) => domainOf(k) === "sensor" && h.states[k]?.attributes.device_class === "battery" && Number.isFinite(parseFloat(h.states[k].state)));
        if (sensor) return { id: sensor, level: parseFloat(h.states[sensor].state) };
      }
      if (Number.isFinite(own)) return { id: t, level: own };
    }
    return null;
  }

  // minutes, or a time of arrival, while the person is away
  _eta(item) {
    const h = this._hass, id = item.eta ?? this._config.eta;
    if (!id || typeof id !== "string") return null;
    const st = h.states[id];
    if (!st || ["unavailable", "unknown", "none"].includes(st.state)) return null;
    const n = Number(st.state);
    if (Number.isFinite(n)) {
      const u = (st.attributes.unit_of_measurement || "min").toLowerCase();
      const min = u.startsWith("h") ? n * 60 : u.startsWith("s") ? n / 60 : n;
      return min < 1 ? "arriving" : min >= 60 ? `${Math.floor(min / 60)} h ${Math.round(min % 60)} min` : `${Math.round(min)} min`;
    }
    const t = Date.parse(st.state);
    if (Number.isFinite(t)) return t > Date.now() ? new Intl.DateTimeFormat(langOf(h), { hour: "2-digit", minute: "2-digit" }).format(t) : null;
    return null;
  }

  // the icon of the place they are at: the zone's own, else home, away or a pin
  _zoneIcon(st) {
    const h = this._hass, s = st.state;
    if (s === "not_home") return "mdi:map-marker-off";
    const zone = s === "home" ? h.states["zone.home"] : Object.values(h.states).find((z) => z.entity_id.startsWith("zone.") && z.attributes.friendly_name === s);
    return zone?.attributes.icon || (s === "home" ? "mdi:home" : "mdi:map-marker");
  }

  _where(st) {
    const h = this._hass, s = st.state;
    if (s === "home") return "Home";
    if (s === "not_home") return "Away";
    const zone = Object.values(h.states).find((z) => z.entity_id.startsWith("zone.") && z.attributes.friendly_name === s);
    return `At ${zone?.attributes.friendly_name || title(String(s).replace(/_/g, " "))}`;
  }

  // ---------- painting ----------
  _update() {
    const h = this._hass;
    if (!h || !this._el) return;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    this.toggleAttribute("data-compact", this._compact);
    if (this._horizontal) this.setAttribute("data-dir", "horizontal"); else this.removeAttribute("data-dir");
    const c = this._config, el = this._el;
    const items = this._items();
    const home = items.filter((i) => h.states[i.entity].state === "home").length;
    text(el.title, c.title ?? "People");
    text(el.pill, items.length ? (home === items.length ? "Everyone is home" : home === 0 ? "Nobody home" : `${home} of ${items.length} home`) : "");
    el.pill.hidden = !items.length;
    put(el.card, "--tone", home ? "var(--good-rgb)" : "var(--accent)");
    this._renderPeople(items);
    el.empty.hidden = items.length > 0;
    if (!items.length) text(el.empty, "No people found.");
    attr(el.card, "aria-label", `${c.title ?? "People"}, ${el.pill.textContent}`);
    if (this._first) { this._first = false; requestAnimationFrame(() => this._paintAll(null)); }
    this._wake();
  }

  _renderPeople(items) {
    const h = this._hass, el = this._el, seen = new Set();
    Motion.flip(el.list, () => {
      items.forEach((item, at) => {
        const id = item.entity;
        seen.add(id);
        const st = h.states[id];
        let node = this._nodes.get(id);
        if (!node) {
          node = document.createElement("button");
          node.className = "p";
          node.innerHTML = `<span class="av"><span class="ini"></span></span><span class="tx"><span class="nm"></span><span class="st"><ha-icon></ha-icon><span class="stt"></span></span></span><span class="chipz"></span>`;
          node.__enter = this._spring(0, MOTION.ui, `p:${id}`).to(1, MOTION.ui);
          this._pressable(node, { onTap: () => moreInfo(this, id) }, 0.025);
          this._nodes.set(id, node);
        }
        const name = item.name || st.attributes.friendly_name || title(id.split(".")[1]);
        const isHome = st.state === "home";
        attr(node, "data-home", isHome);
        text(node.querySelector(".nm"), name);
        const t = Date.parse(st.last_changed), age = Number.isFinite(t) ? Date.now() - t : NaN;
        const where = this._where(st);
        text(node.querySelector(".stt"), [where, Number.isFinite(age) ? (age < 60000 ? "just now" : duration(age)) : ""].filter(Boolean).join(" · "));
        attr(node.querySelector(".st ha-icon"), "icon", this._zoneIcon(st));
        this._avatar(node, st, name);
        // the phone's battery and the way home
        const bits = [];
        const b = this._battery(item);
        if (b && Number.isFinite(b.level)) {
          const warn = Number(this._config.battery_warn) || PE_BATT_WARN;
          const lvl = b.level <= 10 ? "bad" : b.level < warn ? "warn" : "";
          bits.push({ key: "b", icon: batteryIcon(b.level), text: `${Math.round(b.level)}%`, level: lvl });
        }
        const eta = !isHome ? this._eta(item) : null;
        if (eta) bits.push({ key: "e", icon: "mdi:car", text: eta, cls: "eta" });
        this._chips(node.querySelector(".chipz"), bits);
        attr(node, "aria-label", `${name}, ${node.querySelector(".st").textContent}`);
        place(el.list, node, at);
      });
      for (const [id, node] of this._nodes) {
        if (seen.has(id)) continue;
        for (const s of [node.__enter, node.__spring]) { const i = this._springs.indexOf(s); if (i >= 0) this._springs.splice(i, 1); }
        const p = this._pressNodes.indexOf(node);
        if (p >= 0) this._pressNodes.splice(p, 1);
        node.remove();
        this._nodes.delete(id);
      }
    });
  }

  _avatar(node, st, name) {
    const av = node.querySelector(".av"), pic = st.attributes.entity_picture;
    let img = av.querySelector("img");
    text(av.querySelector(".ini"), (name.match(/\p{L}/u)?.[0] || "?").toUpperCase());
    if (pic) {
      if (!img) {
        img = document.createElement("img");
        img.alt = "";
        img.addEventListener("error", () => { img.hidden = true; av.querySelector(".ini").hidden = false; });
        av.appendChild(img);
      }
      if (img.__src !== pic) { img.__src = pic; img.hidden = false; img.src = pic; }
    } else if (img) img.hidden = true;
    // the letter only shows when there is no picture (or it did not load)
    av.querySelector(".ini").hidden = !!pic && !!img && !img.hidden;
  }

  _chips(box, bits) {
    const have = new Map([...box.children].map((n) => [n.dataset.key, n]));
    bits.forEach((b, i) => {
      let n = have.get(b.key);
      if (!n) {
        n = document.createElement("span");
        n.dataset.key = b.key;
        n.className = `chp ${b.cls || ""}`;
        n.innerHTML = "<ha-icon></ha-icon><span></span>";
      }
      attr(n.querySelector("ha-icon"), "icon", b.icon);
      text(n.querySelector("span"), b.text);
      attr(n, "data-level", b.level || null);
      place(box, n, i);
    });
    for (const [k, n] of have) if (!bits.some((b) => b.key === k)) n.remove();
  }

  _paint(dirty, all, red) {
    for (const [, node] of this._nodes) {
      if (!node.__enter) continue;
      const v = clamp(node.__enter.x);
      if (Math.abs(node.__spring?.x || 0) < 1e-3) put(node, "opacity", v > 0.999 ? "" : v.toFixed(3));
      put(node, "translate", red || v > 0.999 ? "" : `0 ${((1 - v) * 4).toFixed(2)}px`);
    }
  }
}

// mdi:battery-10 ... mdi:battery, in tens
const batteryIcon = (level) => {
  const n = Math.max(0, Math.min(100, level));
  return n < 5 ? "mdi:battery-outline" : n >= 95 ? "mdi:battery" : `mdi:battery-${Math.round(n / 10) * 10}`;
};

// ---------- editor ----------
const EDITOR = defineEditor("savvy-people-card", () => [
  S.grid(S.text("title", "Title", "Empty: People."), S.titleLink("title")),
  { name: "people", label: "People", helper: "Empty: every person, home first. Listed people keep this order.", type: "list",
    item: [
      { name: "entity", label: "Person", selector: { entity: { domain: "person" } } },
      S.grid(S.text("name", "Name"), S.entity("eta", "Time to get home", "sensor", { helper: "Minutes, or a time. Shown while they are away." })),
      S.entity("battery", "Phone battery", "sensor", { helper: "Empty: found through their phone." }),
    ],
    add: { selector: { entity: { domain: "person" } }, label: "Add a person" } },
  S.entity("eta", "Time to get home (everyone)", "sensor", { helper: "One sensor for everyone, or set it on a person." }),
  S.grid(S.bool("battery", "Phone battery", "Shown when the phone reports it.", true), S.number("battery_warn", "Battery warning", 5, 80, 1, "%")),
  { name: "exclude", label: "Never show", selector: { entity: { domain: "person", multiple: true } } },
  S.grid(S.select("layout", "Layout", [{ value: "full", label: "Full" }, { value: "compact", label: "Compact (avatars)" }]),
    S.select("direction", "Direction", [{ value: "vertical", label: "One under the other" }, { value: "horizontal", label: "Side by side" }])),
]);

registerCard("savvy-people-card", SavvyPeopleCard, "People",
  "Who is home: avatars with a ring, where they are and for how long, the phone's battery and how long until they are home.");
