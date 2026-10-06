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
const SETTINGS_SECTIONS = ["pages", "house", "health", "ignore", "rooms", "design"];

// What a card can keep from people who are not administrators: the health cog in the home header, and
// the count badge on it. Everyone sees everything unless it is listed. A card can only hide itself: it
// cannot lock a page. A user Home Assistant does not describe (no `hass.user`) counts as an administrator.
const ADMIN_ITEMS = ["health_cog", "health_badges"];
const isAdminUser = (hass) => hass?.user?.is_admin !== false;
function adminOnlyItems(v) {
  if (v === true) return new Set(ADMIN_ITEMS);
  if (!v) return new Set();
  const list = Array.isArray(v) ? v : typeof v === "object" ? Object.keys(v).filter((k) => v[k]) : [v];
  return new Set(list.filter((k) => ADMIN_ITEMS.includes(k)));
}
const hiddenFromUser = (hass, config, item) => !isAdminUser(hass) && adminOnlyItems(config?.admin_only).has(item);

// ---- the table -------------------------------------------------------------------------

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const navTo = (path) => (path ? { action: "navigate", navigation_path: path } : undefined);
const pagePattern = (pattern, x) => (pattern ? String(pattern).replace(/\{area\}/g, x.area || "").replace(/\{slug\}/g, x.slug || "") : undefined);
// a room's own value, else nothing: the source says which room
const room = (key) => (s, c, x) => (x.room?.[key] != null && x.room[key] !== "" ? { v: x.room[key], src: `rooms.${x.area}` } : undefined);
const AUTO = "found automatically";
// a page the settings name; else the dashboard's own view of that name; `false` says there is none
const pageFor = (kind) => (s) => {
  const own = s.pages?.[kind];
  if (own) return { v: own, src: "pages" };
  if (own === false) return undefined;
  const v = SettingsStore.autoPage(kind);
  return v ? { v, src: AUTO } : undefined;
};
const roomPage = (s, c, x) => {
  if (!x.area) return undefined;
  if (x.room?.page) return { v: x.room.page, src: `rooms.${x.area}` };
  const v = pagePattern(s.pages?.room, x);
  if (v) return { v, src: "pages.room" };
  if (s.pages?.room === false) return undefined;
  const a = SettingsStore.autoRoom(x.area);
  return a ? { v: a, src: AUTO } : undefined;
};
const roomPattern = (s) => {
  if (s.pages?.room) return { v: s.pages.room, src: "pages" };
  if (s.pages?.room === false) return undefined;
  const v = SettingsStore.autoRoomPattern();
  return v ? { v, src: AUTO } : undefined;
};
// a card with no order of its own takes the first card of its kind for the same room that has one
const ORDER_CARDS = { "custom:savvy-lights-card": { label: "Lights card", legacy: ["main", "side", "master"] } };
const followOrder = (type) => (s, c, x) => {
  if (!x.area || c.sync_order === false || ORDER_CARDS[type].legacy.some((k) => c[k] !== undefined)) return undefined;
  const m = SettingsStore.orderFor(type, x.area);
  if (!m) return undefined;
  return { v: m.order, src: `read from the ${ORDER_CARDS[type].label} on ${m.where}${m.count > 1 ? `, the first of ${m.count}` : ""}`, unlink: true };
};
const glob = (section, key) => (s) => s[section]?.[key];
// what a room card leaves out: the room's own `exclude` and the global ignore list, one list
const roomExclude = (s, c, x) => {
  if (!x.area) return undefined;                       // a plain title has nothing to discover
  const own = x.room?.exclude, ign = s.ignore?.entities;
  const v = [...asList(own), ...asList(ign)].filter((e) => e != null && e !== "");
  if (!v.length) return undefined;
  return { v, src: asList(ign).length ? "ignore" : `rooms.${x.area}` };
};

const HEALTH_KEYS = [
  ["watchman", "Watchman sensors"], ["battery_threshold", "Battery alert"], ["warn_above", "Red threshold"],
  ["exclude_platforms", "Ignored integrations"], ["group_by", "Grouping"], ["group_min", "Hub threshold"], ["watchman_last_run", "Watchman last run"],
];
const healthRules = (prefix = "") => HEALTH_KEYS.map(([k, label]) => ({ path: `${prefix}${k}`, label, get: glob("health", k), src: "health" }));
// known problems: the settings' list adds to the card's own (devices by id, entities by id)
const knownRules = (prefix = "") => ["entities", "devices"].map((k) => ({ path: `${prefix}ignore.${k}`, label: "Known problems", kind: "union", src: "health",
  get: (s) => (Array.isArray(s.health?.ignore) ? s.health.ignore.filter((x) => (k === "entities") === String(x).includes(".")) : s.health?.ignore?.[k]) }));

// the state glow is on unless the settings turn it off for every card
const styleRule = { path: "design", label: "Design", get: (s) => (["glass", "matte"].includes(s.design?.style) ? s.design.style : undefined), src: "design" };
const glowRule = { path: "state_glow", label: "State glow", get: (s) => (s.design?.state_glow === false ? false : undefined), src: "design" };

const HOME_CHIPS = ["lights", "climate", "media", "security"];

// Each rule fills `path` of the card's config when the card hasn't set it.
//   kind "union": the settings' list is added to the card's own (unless the card says false)
//   kind "pin":   the room's light helper is pinned first in the badge row
const SETTINGS_RULES = {
  "savvy-home-header-card": [
    { path: "aggregate", label: "Aggregate sensors", get: (s) => s.aggregate, src: "aggregate" },
    { path: "admin_only", label: "Admin only", get: (s) => s.admin_only, src: "admin_only" },
    { path: "control", label: "Control", get: glob("house", "control"), src: "house" },
    { path: "weather", label: "Weather", get: glob("house", "weather"), src: "house" },
    { path: "home_path", label: "Home button", get: glob("pages", "home"), src: "pages" },
    ...HOME_CHIPS.flatMap((k) => [
      { path: `${k}.navigation_path`, label: `${cap(k)} page`, get: pageFor(k) },
      // a tap goes to the page and the hold lists, unless the chip already has gestures of its own
      { path: `${k}.tap_action`, label: `${cap(k)} tap`, src: "house",
        get: (s, c) => (s.house?.tap === "navigate" && c[k]?.hold_action === undefined ? navTo(c[k]?.navigation_path ?? pageFor(k)(s)?.v) : undefined) },
      { path: `${k}.exclude`, label: `${cap(k)} ignored`, kind: "union", get: (s) => s.ignore?.entities, src: "ignore" },
      { path: `${k}.exclude_areas`, label: `${cap(k)} ignored rooms`, kind: "union", get: (s) => s.ignore?.areas, src: "ignore" },
      // the card's own room_order covers all four chips; the settings' order fills in under both
      { path: `${k}.room_order`, label: `${cap(k)} room order`, get: (s, c) => (c.room_order !== undefined ? undefined : s.room_order), src: "room_order" },
    ]),
    { path: "security.entity", label: "Security entity", get: glob("house", "security"), src: "house" },
    { path: "health.navigation_path", label: "Health page", get: (s) => s.pages?.health, src: "pages" },
    { path: "health.tap_action", label: "Health tap", src: "house",
      get: (s, c) => (s.house?.tap === "navigate" && c.health?.hold_action === undefined ? navTo(c.health?.navigation_path ?? s.pages?.health) : undefined) },
    ...healthRules("health."),
    ...knownRules("health."),
  ],
  "savvy-system-health-card": [glowRule, ...healthRules(), ...knownRules()],
  "savvy-room-header-card": [
    { path: "aggregate", label: "Aggregate sensors", get: (s) => s.aggregate, src: "aggregate" },
    { path: "control", label: "Control", get: room("control") },
    { path: "temperature", label: "Temperature", get: room("temperature") },
    { path: "include", label: "Include", kind: "union", get: room("include") },
    { path: "exclude", label: "Exclude", kind: "union", get: roomExclude },
    { path: "home_path", label: "Home button", get: glob("pages", "home"), src: "pages" },
    { path: "room_path", label: "Room pages", get: roomPattern },
    // the card's own `order` (the pre-Savvy name) counts as its own
    { path: "room_order", label: "Room order", get: (s, c) => (c.order !== undefined ? undefined : s.room_order), src: "room_order" },
  ],
  "savvy-section-title-card": [
    { path: "aggregate", label: "Aggregate sensors", get: (s) => s.aggregate, src: "aggregate" },
    { path: "name", label: "Name", get: room("name") },
    { path: "icon", label: "Icon", get: room("icon") },
    { path: "control", label: "Control", get: room("control") },
    { path: "temperature", label: "Temperature", get: room("temperature") },
    { path: "include", label: "Include", kind: "union", get: room("include") },
    { path: "exclude", label: "Exclude", kind: "union", get: roomExclude },
    { path: "navigation_path", label: "Target page", get: roomPage },
  ],
  "savvy-room-tile": [
    glowRule,
    { path: "animations", label: "Animations", get: (s) => (s.design?.animations === false ? false : undefined), src: "design" },
    { path: "aggregate", label: "Aggregate sensors", get: (s) => s.aggregate, src: "aggregate" },
    { path: "name", label: "Name", get: room("name") },
    { path: "icon", label: "Icon", get: room("icon") },
    { path: "control", label: "Control", get: room("control") },
    { path: "temperature", label: "Temperature", get: room("temperature") },
    { path: "toggle", label: "Light helper", get: (s, c, x) => (c.light_state !== undefined ? undefined : room("light_state")(s, c, x)) },
    { path: "entities", label: "Light badge", kind: "pin", get: room("light_state") },
    { path: "exclude", label: "Exclude", kind: "union", get: roomExclude },
    { path: "navigation_path", label: "Target page", get: roomPage },
  ],
  "savvy-lights-card": [
    glowRule,
    { path: "order", label: "Order", get: followOrder("custom:savvy-lights-card") },
    { path: "exclude", label: "Ignored", kind: "union", get: (s) => s.ignore?.entities, src: "ignore" },
    { path: "toggle", label: "Light helper",
      get: (s, c, x) => {
        if (c.toggle !== undefined || c.master !== undefined) return undefined;
        const r = room("light_state")(s, c, x);
        return r ? { v: { entity: r.v }, src: r.src } : undefined;
      } },
  ],
  "savvy-scene-card": [
    glowRule,
    { path: "exclude", label: "Ignored", kind: "union", get: (s) => s.ignore?.entities, src: "ignore" },
  ],
  "savvy-people-card": [
    { path: "exclude", label: "Ignored", kind: "union", get: (s) => s.ignore?.entities, src: "ignore" },
  ],
  "savvy-energy-card": [
    { path: "exclude", label: "Ignored", kind: "union", get: (s) => s.ignore?.entities, src: "ignore" },
    { path: "exclude_areas", label: "Ignored rooms", kind: "union", get: (s) => s.ignore?.areas, src: "ignore" },
  ],
  "savvy-fan-card": [
    glowRule,
    { path: "exclude", label: "Ignored", kind: "union", get: (s) => s.ignore?.entities, src: "ignore" },
    { path: "exclude_areas", label: "Ignored rooms", kind: "union", get: (s) => s.ignore?.areas, src: "ignore" },
  ],
  "savvy-cover-card": [
    glowRule,
    { path: "exclude", label: "Ignored", kind: "union", get: (s) => s.ignore?.entities, src: "ignore" },
    { path: "exclude_areas", label: "Ignored rooms", kind: "union", get: (s) => s.ignore?.areas, src: "ignore" },
  ],
  "savvy-story-card": [
    { path: "exclude", label: "Ignored", kind: "union", get: (s) => s.ignore?.entities, src: "ignore" },
    { path: "exclude_areas", label: "Ignored rooms", kind: "union", get: (s) => s.ignore?.areas, src: "ignore" },
  ],
  "savvy-last-check-card": [
    glowRule,
    { path: "exclude", label: "Ignored", kind: "union", get: (s) => s.ignore?.entities, src: "ignore" },
    { path: "exclude_areas", label: "Ignored rooms", kind: "union", get: (s) => s.ignore?.areas, src: "ignore" },
  ],
  "savvy-vacuum-card": [
    glowRule,
    { path: "exclude", label: "Ignored", kind: "union", get: (s) => s.ignore?.entities, src: "ignore" },
  ],
  "savvy-climate-card": [
    glowRule,
    { path: "temperature", label: "Temperature", get: room("temperature") },
    { path: "humidity", label: "Humidity", get: room("humidity") },
  ],
  "savvy-room-activity-card": [
    glowRule,
    { path: "aggregate", label: "Aggregate sensors", get: (s) => s.aggregate, src: "aggregate" },
    { path: "include", label: "Include", kind: "union", get: room("include") },
    { path: "exclude", label: "Exclude", kind: "union", get: roomExclude },
  ],
  "savvy-entity-card": [glowRule],
  "savvy-media-card": [glowRule],
  "savvy-lock-card": [
    glowRule,
    // with no lock named, the settings' security entity is the lock to show
    { path: "entity", label: "Lock", src: "house",
      get: (s, c) => (c.entity !== undefined || c.entities !== undefined || c.area !== undefined || c.areas !== undefined || domainOf(s.house?.security) !== "lock" ? undefined : s.house.security) },
    { path: "include", label: "Include", kind: "union", get: room("include") },
    { path: "exclude", label: "Exclude", kind: "union", get: roomExclude },
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
  const rules = SETTINGS_RULES[type] && [...SETTINGS_RULES[type], styleRule];
  if (!rules || !cfg || typeof cfg !== "object") return { config: cfg, inherited: [] };
  settings = settings || {};         // the dashboard's own pages and orders count even with no settings card
  const x = settingsArea(cfg, settings);
  let out = cfg;
  const inherited = [];
  for (const r of rules) {
    const got = r.get(settings, cfg, x);
    if (got === undefined || got === null) continue;
    const { v, src, unlink } = typeof got === "object" && !Array.isArray(got) && "v" in got ? got : { v: got, src: r.src };
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
      out = setPath(out, r.path, [{ entity: v, name: "Light" }, ...have]);
    } else {
      if (own !== undefined && own !== null) continue;
      out = setPath(out, r.path, v);
    }
    inherited.push({ path: r.path, label: r.label, value: showValue(v), from: src, ...(unlink ? { unlink: true, raw: v } : {}) });
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
  // one room order for every card that lists rooms
  if (Array.isArray(config.room_order)) {
    const order = config.room_order.filter((a) => typeof a === "string" && a);
    if (order.length) out.room_order = order;
  }
  // which kinds of sensor each room shows once (true: presence)
  const agg = aggKinds(config.aggregate);
  if (agg.length) out.aggregate = agg;
  // what only administrators see (true: everything that can be kept)
  const admin = [...adminOnlyItems(config.admin_only)];
  if (admin.length) out.admin_only = admin;
  return Object.keys(out).length ? out : null;
}

// ---- what the dashboard itself says: its views, and the orders its cards were given -----------

const slugOf = (v) => String(v ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
const DOMAIN_PAGES = { lights: ["lights", "lighting", "light"], climate: ["climate"], media: ["media"], security: ["security"] };

// the dashboard's views that can be opened by name
function collectViews(conf) {
  return (Array.isArray(conf?.views) ? conf.views : [])
    .filter((v) => v && typeof v.path === "string" && v.path)
    .map((v) => ({ path: v.path, title: typeof v.title === "string" ? v.title : "" }));
}

// the one view a name belongs to: by its path first, else by its title. Two different views: no guess.
function findView(views, names) {
  const want = new Set(names.map(slugOf).filter(Boolean));
  if (!want.size) return null;
  for (const by of ["path", "title"]) {
    const hit = [...new Set(views.filter((v) => want.has(slugOf(v[by]))).map((v) => v.path))];
    if (hit.length === 1) return hit[0];
    if (hit.length > 1) return null;
  }
  return null;
}
const viewUrl = (path) => `/${(location.pathname || "").split("/").filter(Boolean)[0] || "lovelace"}/${path}`;

// per card kind and room, the first card (in the dashboard's own order) that has an order of its own
function collectOrders(conf) {
  const out = {};
  (Array.isArray(conf?.views) ? conf.views : []).forEach((view, vi) => {
    const where = view?.title || view?.path || `view ${vi + 1}`;
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      const o = ORDER_CARDS[node.type];
      if (o && Array.isArray(node.order) && node.order.length) {
        let a = node.area ?? node.areas;
        if (Array.isArray(a)) a = a.length === 1 ? a[0] : null;
        if (typeof a === "string" && a) {
          const key = `${node.type}|${a}`;
          if (out[key]) out[key].count++;
          else out[key] = { order: node.order.filter((e) => typeof e === "string"), where, count: 1 };
        }
      }
      for (const v of Object.values(node)) if (v && typeof v === "object") walk(v);
    };
    walk(view);
  });
  return out;
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
  views: [],            // the dashboard's views with a path
  orders: {},           // `type|area` -> the first card's order
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
      if (this.settings || this.views.length || Object.keys(this.orders).length) {
        localStorage.setItem(this._key(), JSON.stringify({ settings: this.settings, found: this.found, views: this.views, orders: this.orders }));
      } else localStorage.removeItem(this._key());
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
    this.views = Array.isArray(c?.views) ? c.views : [];
    this.orders = c?.orders && typeof c.orders === "object" ? c.orders : {};
  },

  // what the dashboard says about itself changed: its views and the orders its cards hold
  setDashboard(views, orders) {
    if (JSON.stringify(views) === JSON.stringify(this.views) && JSON.stringify(orders) === JSON.stringify(this.orders)) return false;
    this.views = views;
    this.orders = orders;
    return true;
  },

  // pages found by name, for the cards that would otherwise need them written down
  autoPage(kind) {
    const p = DOMAIN_PAGES[kind] && findView(this.views, DOMAIN_PAGES[kind]);
    return p ? viewUrl(p) : undefined;
  },
  autoRoom(area) {
    const p = findView(this.views, [area, this.hass?.areas?.[area]?.name]);
    return p ? viewUrl(p) : undefined;
  },
  // `/lovelace/{slug}` when the dashboard's views carry the rooms' names (with dashes, else with underscores)
  autoRoomPattern() {
    const ids = Object.keys(this.hass?.areas || {});
    if (!ids.length || !this.views.length) return undefined;
    const paths = new Set(this.views.map((v) => v.path));
    const dashed = ids.filter((a) => paths.has(a.replace(/_/g, "-"))).length, plain = ids.filter((a) => a.includes("_") && paths.has(a)).length;
    const base = viewUrl("").replace(/\/$/, "");
    if (dashed >= plain && dashed > 0) return `${base}/{slug}`;
    return plain > 0 ? `${base}/{area}` : undefined;
  },
  orderFor(type, area) { return this.orders[`${type}|${area}`] || null; },
  // every page this dashboard gave a name to: what the settings card lists
  autoPages() {
    const out = {};
    for (const k of Object.keys(DOMAIN_PAGES)) { const v = this.autoPage(k); if (v) out[k] = v; }
    const room = this.autoRoomPattern();
    if (room) out.room = room;
    return out;
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
    const dash = this.setDashboard(collectViews(conf), collectOrders(conf));
    // the settings card on this page is the freshest source while it is there
    if (this.live) {
      this.found = Math.max(cards.length, 1);
      if (dash) { this._writeCache(); this._changed(); } else this._statsSoon();
      return;
    }
    this.set(normalizeSettings(cards[0]), cards.length);
    if (dash) { this._writeCache(); this._changed(); }
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
    this.settings = null; this.found = 0; this.views = []; this.orders = {}; this.live = null; this.hass = null; this.cards.clear(); this.subs.clear();
    this._path = undefined; this._fetched = false; this._fetchedAt = 0;
  },
};

// Every card with rules goes through here (registerCard): its setConfig receives the card's
// config with the settings filled in, and a change in the settings re-runs it, only when
// what the card would see really changed.
// A card with `aggregate` sees each room's sensors of those kinds once. What it leaves out
// (`exclude`, a chip's `exclude`, ignored rooms) is never merged.
function aggregateFor(config, hass) {
  if (!config?.aggregate) return hass;
  const chips = ["lights", "climate", "media", "security"].map((k) => config[k]).filter((c) => c && typeof c === "object");
  const list = (key) => [config[key], ...chips.map((c) => c[key])].flatMap((x) => asItems(x).map((i) => i.entity || i)).filter((x) => typeof x === "string");
  return aggregateHass(hass, { kinds: config.aggregate, exclude: list("exclude"), excludeAreas: list("exclude_areas") });
}

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
    if (this.__rawHass) this.hass = this.__rawHass;
  };
  const d = Object.getOwnPropertyDescriptor(proto, "hass");
  if (d?.set) {
    Object.defineProperty(proto, "hass", { ...d, set(v) {
      SettingsStore.load(v);
      this.__rawHass = v;
      d.set.call(this, aggregateFor(this._config, v));
    } });
  }
}
