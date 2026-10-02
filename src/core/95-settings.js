// ---------------------------------------------------------------------------------------
// core/settings: the pages, entities and helpers a dashboard repeats on every card, set once
// in a `custom:savvy-settings-card` and picked up by every Savvy card on the dashboard.
//
//   precedence: the card's own config  >  rooms.<area>  >  global settings  >  auto-discovery
//   A value the card sets itself (even `false`) is never replaced. Lists (ignored entities,
//   a room's include / exclude) add to the card's own; a card can switch that off with `false`.
//
// Settings are found by reading the dashboard's own config (`lovelace/config`), so a card on
// any view gets them without the settings card being on its page. The last answer is kept in
// localStorage per dashboard, so repeat loads need no round trip and nothing flashes.
// The settings card on the page publishes its config as it is edited: cards follow live.
// One declarative table (SETTINGS_RULES) says what each card takes; a new key is one line.
// ---------------------------------------------------------------------------------------

const SETTINGS_TYPE = "custom:savvy-settings-card";
const SETTINGS_REFRESH_MS = 5 * 60 * 1000;
const SETTINGS_SECTIONS = ["pages", "house", "health", "ignore", "rooms"];

// ---- the table -------------------------------------------------------------------------

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const navTo = (path) => (path ? { action: "navigate", navigation_path: path } : undefined);
const pagePattern = (pattern, x) => (pattern ? String(pattern).replace(/\{area\}/g, x.area || "").replace(/\{slug\}/g, x.slug || "") : undefined);
// a room's own value, else nothing: the source says which room
const room = (key) => (s, c, x) => (x.room?.[key] != null && x.room[key] !== "" ? { v: x.room[key], src: `rooms.${x.area}` } : undefined);
const roomPage = (s, c, x) => {
  if (!x.area) return undefined;
  if (x.room?.page) return { v: x.room.page, src: `rooms.${x.area}` };
  const v = pagePattern(s.pages?.room, x);
  return v ? { v, src: "pages.room" } : undefined;
};
const glob = (section, key) => (s) => s[section]?.[key];

const HEALTH_KEYS = [
  ["watchman", "Watchman sensors"], ["battery_threshold", "Battery alert"], ["warn_above", "Red threshold"],
  ["exclude_platforms", "Ignored integrations"], ["group_by", "Grouping"], ["group_min", "Hub threshold"], ["watchman_last_run", "Watchman last run"],
];
const healthRules = (prefix = "") => HEALTH_KEYS.map(([k, label]) => ({ path: `${prefix}${k}`, label, get: glob("health", k), src: "health" }));

const HOME_CHIPS = ["lights", "climate", "media", "security"];

// Each rule fills `path` of the card's config when the card hasn't set it.
//   kind "union": the settings' list is added to the card's own (unless the card says false)
//   kind "pin":   the room's light helper is pinned first in the badge row
const SETTINGS_RULES = {
  "savvy-home-header-card": [
    { path: "control", label: "Control", get: glob("house", "control"), src: "house" },
    { path: "weather", label: "Weather", get: glob("house", "weather"), src: "house" },
    { path: "home_path", label: "Home button", get: glob("pages", "home"), src: "pages" },
    ...HOME_CHIPS.flatMap((k) => [
      { path: `${k}.navigation_path`, label: `${cap(k)} page`, get: (s) => s.pages?.[k], src: "pages" },
      // a tap goes to the page and the hold lists, unless the chip already has gestures of its own
      { path: `${k}.tap_action`, label: `${cap(k)} tap`, src: "house",
        get: (s, c) => (s.house?.tap === "navigate" && c[k]?.hold_action === undefined ? navTo(c[k]?.navigation_path ?? s.pages?.[k]) : undefined) },
      { path: `${k}.exclude`, label: `${cap(k)} ignored`, kind: "union", get: (s) => s.ignore?.entities, src: "ignore" },
      { path: `${k}.exclude_areas`, label: `${cap(k)} ignored rooms`, kind: "union", get: (s) => s.ignore?.areas, src: "ignore" },
    ]),
    { path: "security.entity", label: "Security entity", get: glob("house", "security"), src: "house" },
    { path: "health.navigation_path", label: "Health page", get: (s) => s.pages?.health, src: "pages" },
    { path: "health.tap_action", label: "Health tap", src: "house",
      get: (s, c) => (s.house?.tap === "navigate" && c.health?.hold_action === undefined ? navTo(c.health?.navigation_path ?? s.pages?.health) : undefined) },
    ...healthRules("health."),
  ],
  "savvy-system-health-card": healthRules(),
  "savvy-room-header-card": [
    { path: "control", label: "Control", get: room("control") },
    { path: "temperature", label: "Temperature", get: room("temperature") },
    { path: "include", label: "Include", kind: "union", get: room("include") },
    { path: "exclude", label: "Exclude", kind: "union", get: room("exclude") },
    { path: "entities", label: "Light helper", kind: "pin", get: room("light_state") },
    { path: "home_path", label: "Home button", get: glob("pages", "home"), src: "pages" },
    { path: "room_path", label: "Room pages", get: glob("pages", "room"), src: "pages" },
  ],
  "savvy-section-title-card": [
    { path: "name", label: "Name", get: room("name") },
    { path: "icon", label: "Icon", get: room("icon") },
    { path: "control", label: "Control", get: room("control") },
    { path: "temperature", label: "Temperature", get: room("temperature") },
    { path: "include", label: "Include", kind: "union", get: room("include") },
    { path: "exclude", label: "Exclude", kind: "union", get: room("exclude") },
    { path: "entities", label: "Light helper", kind: "pin", get: room("light_state") },
    { path: "navigation_path", label: "Target page", get: roomPage },
  ],
  "savvy-room-tile": [
    { path: "name", label: "Name", get: room("name") },
    { path: "icon", label: "Icon", get: room("icon") },
    { path: "control", label: "Control", get: room("control") },
    { path: "temperature", label: "Temperature", get: room("temperature") },
    { path: "toggle", label: "Light helper", get: (s, c, x) => (c.light_state !== undefined ? undefined : room("light_state")(s, c, x)) },
    { path: "entities", label: "Light badge", kind: "pin", get: room("light_state") },
    { path: "navigation_path", label: "Target page", get: roomPage },
  ],
  "savvy-lights-card": [
    { path: "toggle", label: "Light helper",
      get: (s, c, x) => {
        if (c.toggle !== undefined || c.master !== undefined) return undefined;
        const r = room("light_state")(s, c, x);
        return r ? { v: { entity: r.v }, src: r.src } : undefined;
      } },
  ],
  "savvy-climate-card": [
    { path: "temperature", label: "Temperature", get: room("temperature") },
    { path: "humidity", label: "Humidity", get: room("humidity") },
  ],
  "savvy-room-activity-card": [
    { path: "exclude", label: "Exclude", kind: "union", get: room("exclude") },
  ],
};

// ---- the resolver -----------------------------------------------------------------------

const getPath = (o, p) => p.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
// copy-on-write: only the objects along `p` are copied
function setPath(o, p, v) {
  const ks = p.split("."), root = { ...o };
  let cur = root;
  for (let i = 0; i < ks.length - 1; i++) {
    const next = cur[ks[i]];
    cur[ks[i]] = next && typeof next === "object" ? { ...next } : {};
    cur = cur[ks[i]];
  }
  cur[ks[ks.length - 1]] = v;
  return root;
}
// `lights: false` (or any non-object) below a path: nothing is inherited under it
const blockedPath = (o, p) => {
  const ks = p.split(".");
  let cur = o;
  for (let i = 0; i < ks.length - 1; i++) {
    cur = cur?.[ks[i]];
    if (cur == null) return false;
    if (typeof cur !== "object") return true;
  }
  return false;
};
const asList = (v) => (v == null || v === false ? [] : [].concat(v));
const sameItem = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const unionOf = (add, own) => {
  const out = [...asList(own)];
  for (const v of asList(add)) if (!out.some((o) => sameItem(o, v))) out.unshift(v);
  return out;
};

// The area a card is about, when it is about exactly one.
function settingsArea(cfg, s) {
  let a = cfg.area ?? cfg.areas;
  if (Array.isArray(a)) a = a.length === 1 ? a[0] : null;
  if (typeof a !== "string" || !a) return {};
  return { area: a, slug: a.replace(/_/g, "-"), room: s.rooms?.[a] || null };
}

const showValue = (v) => {
  if (Array.isArray(v)) return v.map(showValue).join(", ");
  if (v && typeof v === "object") return v.action ? `${v.action}${v.navigation_path ? ` to ${v.navigation_path}` : ""}` : v.entity ? v.entity : JSON.stringify(v);
  return String(v);
};

// resolveSettings(type, cfg, settings) -> { config, inherited: [{ path, label, value, from }] }
function resolveSettings(type, cfg, settings) {
  const rules = SETTINGS_RULES[type];
  if (!rules || !settings || !cfg || typeof cfg !== "object") return { config: cfg, inherited: [] };
  const x = settingsArea(cfg, settings);
  let out = cfg;
  const inherited = [];
  for (const r of rules) {
    const got = r.get(settings, cfg, x);
    if (got === undefined || got === null) continue;
    const { v, src } = typeof got === "object" && !Array.isArray(got) && "v" in got ? got : { v: got, src: r.src };
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
    if (blockedPath(cfg, r.path)) continue;
    const own = getPath(cfg, r.path);
    if (r.kind === "union") {
      if (own === false) continue;
      const merged = unionOf(v, own);
      if (merged.length === asList(own).length) continue;
      out = setPath(out, r.path, merged);
    } else if (r.kind === "pin") {
      if (own === false) continue;
      const have = asList(own);
      if (have.some((e) => (e && e.entity) === v || e === v)) continue;
      out = setPath(out, r.path, [{ entity: v, name: "Light", icon: "mdi:light-switch" }, ...have]);
    } else {
      if (own !== undefined && own !== null) continue;
      out = setPath(out, r.path, v);
    }
    inherited.push({ path: r.path, label: r.label, value: showValue(v), from: src });
  }
  return { config: out, inherited };
}

// ---- the store --------------------------------------------------------------------------

// the dashboard this page belongs to: /lovelace/home is the default dashboard (url_path null)
function dashboardPath() {
  const seg = (location.pathname || "").split("/").filter(Boolean)[0];
  return !seg || seg === "lovelace" ? null : seg;
}

function findSettingsCards(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => findSettingsCards(n, out));
  else if (node && typeof node === "object") {
    if (node.type === SETTINGS_TYPE) out.push(node);
    else for (const v of Object.values(node)) if (v && typeof v === "object") findSettingsCards(v, out);
  }
  return out;
}

// only the known sections, and only what is filled in
function normalizeSettings(config) {
  if (!config || typeof config !== "object") return null;
  const out = {};
  for (const k of SETTINGS_SECTIONS) {
    const v = config[k];
    if (v && typeof v === "object" && Object.keys(v).length) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

// how many values are set: what the settings card reports as "defaults"
function countDefaults(s) {
  let n = 0;
  const walk = (v) => {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) return;
    if (v && typeof v === "object" && !Array.isArray(v)) Object.values(v).forEach(walk);
    else n++;
  };
  walk(s);
  return n;
}

const SettingsStore = {
  settings: null,
  found: 0,
  live: null,           // the settings card on this page that publishes while it is edited
  hass: null,
  cards: new Set(),
  subs: new Set(),
  _path: undefined,
  _fetched: false,
  _fetchedAt: 0,
  _seeing: false,
  _tick: 0,

  _key: () => `savvy:settings:${dashboardPath() || "default"}`,
  _readCache() {
    try {
      const v = JSON.parse(localStorage.getItem(this._key()) || "null");
      return v && typeof v === "object" ? v : null;
    } catch (err) { return null; }
  },
  _writeCache() {
    try {
      if (this.settings) localStorage.setItem(this._key(), JSON.stringify({ settings: this.settings, found: this.found }));
      else localStorage.removeItem(this._key());
    } catch (err) { /* storage can be blocked: the cards still work from the fetch */ }
  },

  // the page can move between dashboards without a reload: follow it
  _sync() {
    const p = dashboardPath();
    if (this._path === p) return;
    this._path = p;
    this._fetched = false;
    this.live = null;
    const c = this._readCache();
    this.settings = c?.settings || null;
    this.found = c?.found || 0;
  },

  subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); },
  _emit() {
    for (const fn of [...this.subs]) { try { fn(); } catch (err) { /* a listener must not break the others */ } }
  },
  _changed() {
    this._emit();
    for (const card of [...this.cards]) {
      if (!card.isConnected) { this.cards.delete(card); continue; }
      card._onSettings?.();
    }
    this._statsSoon();
  },
  // the settings card's counts follow what cards inherit; coalesced
  _statsSoon() {
    if (this._tick) return;
    this._tick = setTimeout(() => { this._tick = 0; this._emit(); }, 0);
  },

  set(next, found) {
    const same = JSON.stringify(next) === JSON.stringify(this.settings);
    this.found = found ?? this.found;
    if (same) return;
    this.settings = next;
    this._writeCache();
    this._changed();
  },

  // a card on this page: remembered so a change reaches it, and counted
  register(card) {
    this._sync();
    this.cards.add(card);
  },
  consumers() {
    let n = 0;
    for (const card of this.cards) if (card.isConnected && card._inherited?.length) n++;
    return n;
  },
  stats() { return { defaults: countDefaults(this.settings), consumers: this.consumers(), found: this.found }; },

  // the settings card on the page says what it holds, edited or not
  publish(card, config) {
    this._sync();
    this.live = card;
    this.set(normalizeSettings(config), Math.max(this.found, 1));
  },
  unpublish(card) {
    if (this.live !== card) return;
    this.live = null;
    this._fetch();
  },

  // every card hands over hass; the dashboard is read once per page load
  load(hass) {
    this._sync();
    this.hass = hass;
    if (this._fetched || !hass?.callWS) return;
    this._fetched = true;
    this._fetch().then(() => this._watch());
  },
  async _fetch() {
    const hass = this.hass;
    if (!hass?.callWS) return;
    let conf;
    try { conf = await hass.callWS({ type: "lovelace/config", url_path: dashboardPath() }); }
    catch (err) { return; }                   // no access, or not a dashboard: keep what we have
    if (!conf || typeof conf !== "object") return;
    this._fetchedAt = Date.now();
    const cards = findSettingsCards(conf);
    // the settings card on this page is the freshest source while it is there
    if (this.live) { this.found = Math.max(cards.length, 1); this._statsSoon(); return; }
    this.set(normalizeSettings(cards[0]), cards.length);
    this._statsSoon();
  },
  _watch() {
    if (this._seeing || typeof document === "undefined") return;
    this._seeing = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && Date.now() - this._fetchedAt > SETTINGS_REFRESH_MS) this._fetch();
    });
  },

  // test pages reset it between runs
  reset() {
    this.settings = null; this.found = 0; this.live = null; this.hass = null; this.cards.clear(); this.subs.clear();
    this._path = undefined; this._fetched = false; this._fetchedAt = 0;
  },
};

// Every card with rules goes through here (registerCard): its setConfig receives the card's
// config with the settings filled in, and a change in the settings re-runs it, only when
// what the card would see really changed.
function wireSettings(type, cls) {
  if (!SETTINGS_RULES[type] || cls.prototype.__settingsWired) return;
  const proto = cls.prototype, original = proto.setConfig;
  proto.__settingsWired = true;
  proto.setConfig = function (config) {
    SettingsStore.register(this);
    this._rawConfig = config;
    const r = resolveSettings(type, config, SettingsStore.settings);
    this._inherited = r.inherited;
    this._appliedKey = JSON.stringify(r.config);
    const out = original.call(this, r.config);
    SettingsStore._statsSoon();
    return out;
  };
  proto._onSettings = function () {
    if (!this._rawConfig) return;
    const r = resolveSettings(type, this._rawConfig, SettingsStore.settings);
    this._inherited = r.inherited;
    const key = JSON.stringify(r.config);
    if (key === this._appliedKey) return;
    this._appliedKey = key;
    original.call(this, r.config);
    if (this._hass) this.hass = this._hass;
  };
  const d = Object.getOwnPropertyDescriptor(proto, "hass");
  if (d?.set) {
    Object.defineProperty(proto, "hass", { ...d, set(v) { SettingsStore.load(v); d.set.call(this, v); } });
  }
}
