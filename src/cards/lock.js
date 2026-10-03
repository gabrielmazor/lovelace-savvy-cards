// savvy-lock-card: a door, the way you'd want to handle it. The state is the biggest thing on
// the card, a glow behind it follows (green when locked, amber when not, red when open or
// jammed), and the lock is a track you slide: Locked, Unlocked, Open. A tap does nothing; the
// knob is dragged, and Open (the latch) needs the end held until a ring fills.
//
//   type: custom:savvy-lock-card
//   entity: lock.front_door                 or  entities: [lock.a, { entity: lock.b, name: Garage }]
//                                           or  area: hallway   (every lock of the area; `include` adds locks that have none)
//   name: Front door     icon: mdi:door
//   door: binary_sensor.front_door          (else the door contact of the lock's device or area; false: none)
//   battery: sensor.front_door_battery      (else the battery sensor of its device; false: none)
//   battery_warn: 40                        amber below this, red at 15
//   unlocked_warn: 15                       minutes before "Unlocked for 25 min" nudges (0: never)
//   alarm: alarm_control_panel.home         (else the house's alarm panel; false / hide_alarm: none)
//   camera: camera.porch                    (else a camera in the lock's area; false / hide_camera: none)
//   layout: full | compact                  chips: [...]  (the one chip spec)
//
// With several locks: a row each, a summary and a "Lock all". Tap a name for the lock's
// details. The alarm's arm modes are buttons; disarming, and any code, is more-info's job:
// the card never keeps a code. The camera is a live still that opens a popup with the camera card.

const LOCK_CAM_MS = 8000;
const LOCK_DOOR_CLASSES = ["door", "garage_door", "opening", "window"];
const lockTone = (t) => (t <= 1 ? mixRgb(LOCK_COLORS[0], LOCK_COLORS[1], clamp(t)) : mixRgb(LOCK_COLORS[1], LOCK_COLORS[2], clamp(t - 1)));
const LOCK_TONE_WORD = ["rgb(76 175 80)", "rgb(232 163 61)", "rgb(224 102 102)"];
const LOCK_AMBER = "232 163 61", LOCK_RED = "224 102 102";

const STYLE = `${BASE_CSS}${CHIP_ROW_CSS}${LOCK_TRACK_CSS}
  ha-card { --pad: 14px; --lk: 76 175 80; --wash: 0.1; --pulse: 0; position: relative; display: flex; flex-direction: column; gap: 12px; padding: var(--pad); overflow: hidden; }
  ha-card::before { content: ""; position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(140% 110% at 0% 0%, rgb(var(--lk) / calc(var(--wash) + var(--pulse) * 0.08)), transparent 68%); }
  ha-card > * { position: relative; }
  .head { display: flex; align-items: center; gap: 10px; min-height: 30px; }
  .head .t { flex: 1; min-width: 0; font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sum { flex: none; display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: 12px; font-size: 12px; font-weight: 650;
    color: rgb(var(--lk)); background: rgb(var(--lk) / 0.16); white-space: nowrap; }
  .btn { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 11px; background: var(--well);
    font-size: 12.5px; line-height: 16px; font-weight: 650; color: var(--primary-text-color); --mdc-icon-size: 16px; cursor: pointer; }
  .btn ha-icon { display: flex; }
  .btn[data-on] { color: rgb(var(--lk)); background: rgb(var(--lk) / 0.16); }
  .locks { display: flex; flex-direction: column; gap: 16px; }
  .lk { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .top { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .who { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; text-align: start; border-radius: 12px; cursor: pointer; }
  .disc { flex: none; display: grid; place-items: center; width: 38px; height: 38px; border-radius: 50%; color: var(--tone); background: color-mix(in oklab, var(--tone) 18%, transparent); --mdc-icon-size: 21px; }
  .disc > * { display: flex; align-items: center; justify-content: center; line-height: 0; }
  .col { min-width: 0; display: flex; flex-direction: column; }
  .nm { font-size: 12.5px; line-height: 16px; font-weight: 600; letter-spacing: -0.005em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .st { font-size: 17px; line-height: 22px; font-weight: 700; letter-spacing: -0.02em; color: var(--tone); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  :host([data-solo]) .st { font-size: 28px; line-height: 32px; letter-spacing: -0.03em; }
  :host([data-solo]) .disc { width: 46px; height: 46px; --mdc-icon-size: 25px; }
  .sub { font-size: 12.5px; line-height: 16px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub:empty { display: none; }
  .meta { flex: none; display: flex; align-items: center; gap: 8px; }
  .door, .batt { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px 0 7px; border-radius: 13px; background: var(--well);
    font-size: 12px; font-weight: 650; color: var(--secondary-text-color); white-space: nowrap; --mdc-icon-size: 16px; }
  .door ha-icon { display: flex; }
  .door[data-warn], .batt[data-level="warn"] { color: rgb(${LOCK_AMBER}); background: rgb(${LOCK_AMBER} / 0.16); }
  .batt[data-level="bad"] { color: rgb(${LOCK_RED}); background: rgb(${LOCK_RED} / 0.16); }
  .batt svg { width: 16px; height: 16px; transform: rotate(-90deg); }
  .batt circle { fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; }
  .batt .bg { opacity: 0.25; }
  .track { min-width: 0; }
  /* several locks: a smaller row each */
  :host(:not([data-solo])) .st { font-size: 15px; line-height: 20px; }
  /* compact: one row, the track beside the name */
  :host([data-compact]) .locks { gap: 8px; }
  :host([data-compact]) .lk { flex-direction: row; align-items: center; gap: 10px; }
  :host([data-compact]) .top { flex: 1; }
  :host([data-compact]) .track { flex: none; width: min(46%, 168px); }
  :host([data-compact]) .disc { width: 34px; height: 34px; --mdc-icon-size: 19px; }
  :host([data-compact]) .st { font-size: 15px; line-height: 19px; }
  :host([data-compact]) .sub { display: none; }
  :host([data-compact]) .meta .door:not([data-warn]), :host([data-compact]) .meta .batt:not([data-level="warn"]):not([data-level="bad"]) { display: none; }
  :host([data-compact]) .door, :host([data-compact]) .batt { height: 22px; font-size: 11px; }
  :host([data-compact]) .sv-lk-hint { display: none; }
  .nudge { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 12px; border-radius: 14px; background: rgb(${LOCK_AMBER} / 0.14); color: rgb(${LOCK_AMBER});
    font-size: 13px; line-height: 17px; font-weight: 650; --mdc-icon-size: 18px; }
  .nudge ha-icon { display: flex; flex: none; }
  .nudge .tx { flex: 1; min-width: 0; }
  .nudge .btn { background: rgb(${LOCK_AMBER} / 0.2); color: inherit; }
  .alarm { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 10px; border-radius: 14px; background: var(--well); min-width: 0; flex-wrap: wrap; }
  .alarm[data-triggered] { background: rgb(${LOCK_RED} / 0.18); color: rgb(${LOCK_RED}); }
  .alarm .ai { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: color-mix(in oklab, var(--secondary-text-color) 14%, transparent);
    --mdc-icon-size: 17px; color: var(--secondary-text-color); }
  .alarm[data-armed] .ai { color: rgb(76 175 80); background: rgb(76 175 80 / 0.16); }
  .alarm[data-triggered] .ai { color: rgb(${LOCK_RED}); background: rgb(${LOCK_RED} / 0.2); }
  .alarm .ai ha-icon { display: flex; }
  .alarm .ab { flex: 1; min-width: 92px; display: flex; flex-direction: column; }
  .alarm .an { font-size: 11px; line-height: 14px; font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase; color: var(--secondary-text-color); }
  .alarm .as { font-size: 14px; line-height: 18px; font-weight: 650; letter-spacing: -0.01em; }
  .alarm .am { flex: none; display: flex; gap: 6px; flex-wrap: wrap; }
  .alarm .am .btn { height: 30px; padding: 0 10px; }
  .alarm .am .btn[data-on] { color: rgb(76 175 80); background: rgb(76 175 80 / 0.16); }
  .alarm[data-triggered] .am .btn { background: rgb(${LOCK_RED} / 0.14); color: inherit; }
  .cam { position: relative; display: block; width: 100%; padding: 0; border: 0; border-radius: 14px; overflow: hidden; cursor: pointer; background: var(--well); aspect-ratio: 21 / 9; }
  .cam img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cam .cl { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: 6px; padding: 18px 12px 9px; color: #fff; --mdc-icon-size: 16px;
    font-size: 12.5px; font-weight: 650; background: linear-gradient(transparent, rgb(0 0 0 / 0.55)); text-align: start; }
  .cam .cl ha-icon { display: flex; }
  .empty { padding: 4px 2px; font-size: 12.5px; font-weight: 500; color: var(--secondary-text-color); }
  .sep { display: none; }
  .cam-sheet savvy-camera-card { --ha-card-border-width: 0px; --ha-card-background: transparent; --ha-card-box-shadow: none; margin: -14px -14px 0; }
  @media (prefers-contrast: more) { .sub, .nm { color: var(--primary-text-color); } }
`;

class SavvyLockCard extends SavvyCard {
  static getStubConfig(hass) {
    const id = Object.keys(hass?.states || {}).find((i) => i.startsWith("lock."));
    return id ? { entity: id } : {};
  }
  static getConfigElement() { return document.createElement(EDITOR); }

  constructor() {
    super();
    this._nodes = new Map();
    this._reg = new WeakMap();
    this._tint = this._spring(0, MOTION.ui, "tint", 0.002);
    this._pulse = 0;
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("savvy-lock-card: invalid configuration");
    const areas = [].concat(config.area ?? config.areas ?? []).filter(Boolean);
    const pinned = asItems([...(config.entity ? [config.entity] : []), ...[].concat(config.entities || [])]);
    this._config = { ...config, areas, pinned, include: asItems(config.include).map((i) => i.entity),
      exclude: asItems(config.exclude).map((i) => i.entity), chips: [].concat(config.chips || []) };
    this._compact = config.layout === "compact";
    if (this._el) { this._build(); if (this._hass) this._update(); }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._el) this._build();
    this._update();
    if (this._camSheet?.isOpen) this._camCard.hass = hass;
  }

  connectedCallback() {
    this._observe();
    this._wake();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._io?.disconnect();
    this._io = null;
    clearTimeout(this._timer);
    clearInterval(this._camTimer);
    this._camTimer = 0;
    this._camSheet?.close(true);
  }
  getCardSize() { return this._compact ? 2 : 4 + (this._camId ? 3 : 0); }
  getGridOptions() { return { columns: 12, min_columns: 4, rows: "auto" }; }

  _observe() {
    if (!this._el || !this.isConnected || typeof IntersectionObserver !== "function") return;
    this._io = this._io || new IntersectionObserver(([e]) => { this._onscreen = e.isIntersecting; if (e.isIntersecting) this._camRefresh(); });
    this._io.disconnect();
    this._io.observe(this);
  }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._resetMotion();
    this._tint = this._spring(this._tint?.x || 0, MOTION.ui, "tint", 0.002);
    this._kit = new RowKit(() => this._wake());
    this._nodes.clear();
    this._badKey = "";
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="head" id="head" hidden><span class="t" id="title"></span><span class="sum" id="sum"></span><button class="btn" id="all"><ha-icon icon="mdi:lock"></ha-icon><span>Lock all</span></button></div>
        <div class="locks" id="locks"></div>
        <div class="nudge" id="nudge" hidden><ha-icon icon="mdi:lock-clock"></ha-icon><span class="tx" id="nudgeTx"></span><button class="btn" id="nudgeBtn"><ha-icon icon="mdi:lock"></ha-icon><span>Lock now</span></button></div>
        <div class="alarm" id="alarm" hidden><span class="ai"><ha-icon id="alarmIc"></ha-icon></span><span class="ab"><span class="an">Alarm</span><span class="as" id="alarmSt"></span></span><span class="am" id="alarmModes"></span></div>
        <button class="cam" id="cam" hidden aria-label="Open camera"><img id="camImg" alt=""><span class="cl"><ha-icon icon="mdi:cctv"></ha-icon><span id="camName"></span></span></button>
        <div class="empty" id="empty" hidden></div>
        <div class="chips" id="chips" hidden></div>
      </ha-card>`;
    const $ = (id) => root.getElementById(id);
    this._el = { card: root.querySelector("ha-card"), head: $("head"), title: $("title"), sum: $("sum"), all: $("all"), locks: $("locks"),
      nudge: $("nudge"), nudgeTx: $("nudgeTx"), nudgeBtn: $("nudgeBtn"), alarm: $("alarm"), alarmIc: $("alarmIc"), alarmSt: $("alarmSt"), alarmModes: $("alarmModes"),
      cam: $("cam"), camImg: $("camImg"), camName: $("camName"), empty: $("empty"), chips: $("chips") };
    this._pressable(this._el.all, { onTap: () => this._lockAll() }, 0.05);
    this._pressable(this._el.nudgeBtn, { onTap: () => this._nudged && this._call(this._nudged, "lock") }, 0.05);
    this._pressable(this._el.cam, { onTap: () => this._camId && this._openCamera() }, 0.025);
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => this._fitRow(this._el.chips));
    this._ro.observe(this._el.chips);
    this._first = true;
    this._observe();
  }

  _frame(now, dt) {
    const a = super._frame(now, dt);
    const b = this._kit ? this._kit.step(dt) : false;
    if (this._pulsing && !MQ.reduced.matches) {
      this._pulse = (this._pulse + dt * 3.4) % (Math.PI * 2);
      put(this._el.card, "--pulse", (0.5 + 0.5 * Math.sin(this._pulse)).toFixed(3));
      return true;
    }
    return a || b;
  }

  // ---------- which locks, and what goes with each ----------
  _registry(id) {
    const e = this._hass.entities;
    if (!e) return [];
    let m = this._reg.get(e);
    if (!m) { m = new Map(); this._reg.set(e, m); }
    if (!m.has(id)) {
      const dev = e[id]?.device_id;
      m.set(id, dev ? Object.keys(e).filter((k) => k !== id && e[k].device_id === dev) : []);
    }
    return m.get(id);
  }

  _items() {
    const h = this._hass, c = this._config, out = [], skip = new Set(c.exclude);
    for (const p of c.pinned) if (p.entity && !skip.has(p.entity) && !out.some((o) => o.entity === p.entity)) out.push(p);
    const have = () => new Set(out.map((o) => o.entity));
    for (const a of c.areas) {
      for (const id of pick(h, areaEntities(h, a), { domains: "lock", exclude: [...skip, ...have()] })) out.push({ entity: id });
    }
    for (const id of c.include) if (h.states[id] && !skip.has(id) && !have().has(id)) out.push({ entity: id });
    if (!out.length && !c.pinned.length && !c.areas.length) {
      const first = Object.keys(h.states).find((i) => i.startsWith("lock.") && !skip.has(i));
      if (first) out.push({ entity: first });
    }
    return out;
  }

  _doorOf(item, solo) {
    const h = this._hass, c = this._config;
    const own = item.door ?? (solo ? c.door : undefined);
    if (own === false || (solo && c.hide_door)) return null;
    if (typeof own === "string" && own) return own;
    const dc = (id) => h.states[id]?.attributes.device_class;
    const same = this._registry(item.entity).filter((k) => domainOf(k) === "binary_sensor" && LOCK_DOOR_CLASSES.includes(dc(k)) && h.states[k]);
    if (same.length) return same.sort((a, b) => LOCK_DOOR_CLASSES.indexOf(dc(a)) - LOCK_DOOR_CLASSES.indexOf(dc(b)))[0];
    const area = entityArea(h, item.entity);
    if (area) {
      const found = pick(h, areaEntities(h, area), { domains: "binary_sensor", deviceClasses: ["door", "garage_door", "opening"] });
      if (found.length === 1) return found[0];
    }
    return null;
  }

  _batteryOf(item, solo) {
    const h = this._hass, c = this._config;
    const own = item.battery ?? (solo ? c.battery : undefined);
    if (own === false || (solo && c.hide_battery)) return null;
    if (typeof own === "string" && own) return own;
    return this._registry(item.entity).find((k) => domainOf(k) === "sensor" && h.states[k]?.attributes.device_class === "battery" && Number.isFinite(parseFloat(h.states[k].state))) || null;
  }

  _alarmId() {
    const h = this._hass, c = this._config;
    if (c.alarm === false || c.hide_alarm) return null;
    if (typeof c.alarm === "string" && c.alarm) return h.states[c.alarm] ? c.alarm : null;
    return houseEntities(h).find((id) => domainOf(id) === "alarm_control_panel") || null;
  }

  _cameraOf(items) {
    const h = this._hass, c = this._config;
    if (c.camera === false || c.hide_camera) return null;
    if (typeof c.camera === "string" && c.camera) return h.states[c.camera] ? c.camera : null;
    const own = items.map((i) => i.camera).find((x) => typeof x === "string" && h.states[x]);
    if (own) return own;
    const area = items.length ? entityArea(h, items[0].entity) : null;
    return area ? pick(h, areaEntities(h, area), { domains: "camera" })[0] || null : null;
  }

  // ---------- painting ----------
  _update() {
    const h = this._hass;
    if (!h || !this._el) return;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    const c = this._config, el = this._el;
    const items = this._items();
    const solo = items.length === 1;
    this.toggleAttribute("data-solo", solo && !this._compact);
    this.toggleAttribute("data-compact", this._compact);
    let urgency = 0;
    const seen = new Set();
    let at = 0, locked = 0, needing = [];
    const now = Date.now();
    const warnMin = c.unlocked_warn === undefined ? 15 : Number(c.unlocked_warn);
    const warnMs = c.unlocked_warn === false || !(warnMin > 0) ? Infinity : warnMin * 60000;
    let nudged = null, nudgeFor = 0, nextCheck = Infinity;
    for (const item of items) {
      const id = item.entity;
      seen.add(id);
      const st = h.states[id];
      const canOpen = (((st?.attributes.supported_features || 0) & 1) === 1);
      let node = this._nodes.get(id);
      if (node && node.__canOpen !== canOpen) { node.remove(); this._nodes.delete(id); node = null; }
      if (!node) { node = this._lockNode(item, canOpen, solo); this._nodes.set(id, node); }
      node.__item = item;
      const state = st?.state || "unavailable";
      const u = this._paintLock(node, item, st, solo);
      urgency = Math.max(urgency, u);
      if (state === "locked" || state === "locking") locked++;
      if (!["locked", "locking", "jammed", "unavailable", "unknown"].includes(state)) needing.push(id);
      if (state === "unlocked" && st) {
        const t = Date.parse(st.last_changed), elapsed = Number.isFinite(t) ? now - t : 0;
        if (elapsed >= warnMs && elapsed > nudgeFor) { nudged = id; nudgeFor = elapsed; }
        else if (elapsed < warnMs) nextCheck = Math.min(nextCheck, warnMs - elapsed);
      }
      place(el.locks, node, at++);
    }
    for (const [id, node] of this._nodes) {
      if (seen.has(id)) continue;
      node.remove();
      this._nodes.delete(id);
    }
    // header: only with several locks
    const multi = items.length > 1 && !this._compact;
    el.head.hidden = !multi;
    if (multi) {
      text(el.title, c.name || "Locks");
      const open = items.length - locked;
      text(el.sum, open ? `${open} unlocked` : "All locked");
      el.all.hidden = !needing.length;
    }
    // the nudge: unlocked for a while
    this._nudged = nudged;
    el.nudge.hidden = !nudged;
    if (nudged) {
      const name = items.find((i) => i.entity === nudged);
      text(el.nudgeTx, `${solo ? "Unlocked" : `${name?.name || shortName(h, nudged, null)} unlocked`} for ${duration(nudgeFor)}`);
      nextCheck = Math.min(nextCheck, 30000);
      urgency = Math.max(urgency, 1);
    }
    // alarm
    const alarm = this._renderAlarm();
    if (alarm.triggered) urgency = 2;
    // camera
    this._camId = this._cameraOf(items);
    this._renderCamera(items);
    // chips
    this._chipRow(el.chips, c.chips.map((x, i) => chipItem(h, x, i)));
    // nothing to show
    el.empty.hidden = items.length > 0;
    if (!items.length) text(el.empty, c.areas.length || c.pinned.length ? "No lock found." : "Pick a lock to show.");
    // the wash follows the most urgent thing
    this._tint.to(urgency, MOTION.ui);
    this._pulsing = items.some((i) => ["open", "opening", "jammed"].includes(h.states[i.entity]?.state)) || alarm.triggered;
    if (!this._pulsing) put(el.card, "--pulse", "0");
    clearTimeout(this._timer);
    if (Number.isFinite(nextCheck)) this._timer = setTimeout(() => this._update(), nextCheck + 40);
    if (this._first) { this._first = false; requestAnimationFrame(() => this._paintAll(null)); }
    this._wake();
  }

  _lockNode(item, canOpen, solo) {
    const id = item.entity;
    const node = document.createElement("div");
    node.className = "lk";
    node.__canOpen = canOpen;
    node.innerHTML = `<div class="top">
        <button class="who" aria-label="Open details"><span class="disc"></span><span class="col"><span class="nm"></span><span class="st"></span><span class="sub"></span></span></button>
        <span class="meta"><span class="door" hidden><ha-icon></ha-icon><span></span></span><span class="batt" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><circle class="bg" cx="12" cy="12" r="9"></circle><circle class="fg" cx="12" cy="12" r="9"></circle></svg><span></span></span></span>
      </div>
      <div class="track"></div>`;
    const q = (s) => node.querySelector(s);
    node.__el = { disc: q(".disc"), nm: q(".nm"), st: q(".st"), door: q(".door"), doorIc: q(".door ha-icon"), doorTx: q(".door span:last-child"),
      batt: q(".batt"), battFg: q(".batt .fg"), battTx: q(".batt > span:last-child"), sub: q(".sub"), track: q(".track") };
    const call = (svc) => this._call(id, svc);
    node.__track = new LockTrack(this._kit, { label: "Lock", canOpen, size: solo && !this._compact ? "lg" : "sm",
      onLock: () => call("lock"), onUnlock: () => call("unlock"), onOpen: () => call("open") });
    node.__track.onWords = () => this._update();
    node.__el.track.appendChild(node.__track.el);
    this._pressable(q(".who"), { onTap: () => moreInfo(this, id) }, 0.03);
    node.__first = true;
    return node;
  }

  // one lock's face; returns how urgent it is: 0 calm, 1 amber, 2 red
  _paintLock(node, item, st, solo) {
    const h = this._hass, el = node.__el, id = item.entity;
    const state = st?.state || "unavailable";
    const track = node.__track;
    track.setState(state, node.__first);
    node.__first = false;
    text(el.nm, item.name || (solo && this._config.name) || shortName(h, id, null));
    text(el.st, state === "unavailable" || state === "unknown" ? title(state) : track.words);
    // the icon
    const wantState = !(item.icon || (solo && this._config.icon)) && !!st;
    if (node.__iconKind !== (wantState ? "state" : "plain")) {
      node.__iconKind = wantState ? "state" : "plain";
      el.disc.innerHTML = wantState ? "<savvy-state-icon></savvy-state-icon>" : "<ha-icon></ha-icon>";
    }
    const ic = el.disc.firstElementChild;
    if (wantState) { if (ic.stateObj !== st) { ic.hass = h; ic.stateObj = st; } }
    else attr(ic, "icon", item.icon || this._config.icon || "mdi:lock");
    // the door
    const doorId = this._doorOf(item, solo), door = doorId ? h.states[doorId] : null;
    const doorOpen = !!door && door.state === "on";
    const doorWords = door ? (door.state === "on" ? "Door open" : door.state === "off" ? "Door closed" : null) : null;
    el.door.hidden = !doorWords;
    if (doorWords) {
      text(el.doorTx, doorWords);
      attr(el.doorIc, "icon", doorOpen ? "mdi:door-open" : "mdi:door-closed");
      attr(el.door, "data-warn", doorOpen && (state === "locked" || state === "locking"));
    }
    // the battery
    const battId = this._batteryOf(item, solo), batt = battId ? h.states[battId] : null;
    const pct = batt ? parseFloat(batt.state) : NaN;
    el.batt.hidden = !Number.isFinite(pct);
    if (Number.isFinite(pct)) {
      const warn = Number(this._config.battery_warn ?? 40);
      attr(el.batt, "data-level", pct <= 15 ? "bad" : pct < warn ? "warn" : "ok");
      text(el.battTx, `${Math.round(pct)}%`);
      put(el.battFg, "stroke-dasharray", "56.55");
      put(el.battFg, "stroke-dashoffset", (56.55 * (1 - clamp(pct / 100))).toFixed(2));
    }
    // the line under the name
    const parts = [];
    const by = st?.attributes.changed_by;
    if (by) parts.push(`by ${by}`);
    const t = Date.parse(st?.last_changed);
    if (Number.isFinite(t)) parts.push(since(t, false));
    text(el.sub, parts.join(" · "));
    attr(node, "title", parts.length ? parts.join(" · ") : null);
    // how urgent
    let u = 0;
    if (state === "jammed" || state === "open" || state === "opening") u = 2;
    else if (state === "unlocked" || state === "unlocking") u = 1;
    else if (doorOpen && (state === "locked" || state === "locking")) u = 1;
    put(node, "--tone", u === 0 ? LOCK_TONE_WORD[0] : u === 1 ? LOCK_TONE_WORD[1] : LOCK_TONE_WORD[2]);
    if (state === "unavailable" || state === "unknown") put(node, "--tone", "var(--secondary-text-color)");
    return u;
  }

  _call(id, svc) {
    this._hass.callService("lock", svc, {}, { entity_id: id });
  }

  _lockAll() {
    const h = this._hass;
    let n = 0;
    for (const [id] of this._nodes) {
      const s = h.states[id]?.state;
      if (!s || ["locked", "locking", "jammed", "unavailable", "unknown"].includes(s)) continue;
      this._call(id, "lock");
      n++;
    }
    if (n) haptic("medium");
  }

  // ---------- the alarm ----------
  _renderAlarm() {
    const h = this._hass, el = this._el, id = this._alarmId();
    const st = id ? h.states[id] : null;
    el.alarm.hidden = !st;
    if (!st) return { triggered: false };
    const sf = st.attributes.supported_features ?? 7;
    const modes = ARM.filter((m) => sf & m[2]);
    const armed = /^armed_(.+)$/.exec(st.state);
    const triggered = st.state === "triggered";
    attr(el.alarm, "data-armed", !!armed);
    attr(el.alarm, "data-triggered", triggered);
    attr(el.alarmIc, "icon", triggered ? "mdi:shield-alert" : armed ? "mdi:shield-lock" : "mdi:shield-off-outline");
    text(el.alarmSt, triggered ? "Triggered" : stateText(h, st));
    const key = `${id}|${modes.map((m) => m[0]).join()}`;
    if (key !== this._alarmKey) {
      this._alarmKey = key;
      for (const b of [...el.alarmModes.children]) { const i = this._pressNodes.indexOf(b); if (i >= 0) this._pressNodes.splice(i, 1); b.remove(); }
      for (const m of modes) {
        const b = document.createElement("button");
        b.className = "btn";
        b.dataset.mode = m[0];
        b.innerHTML = `<ha-icon></ha-icon><span></span>`;
        attr(b.firstElementChild, "icon", m[3]);
        text(b.querySelector("span"), m[1]);
        this._pressable(b, { onTap: () => this._arm(id, m[0]) }, 0.05);
        el.alarmModes.appendChild(b);
      }
      const d = document.createElement("button");
      d.className = "btn";
      d.dataset.mode = "disarm";
      d.innerHTML = `<ha-icon icon="mdi:shield-off"></ha-icon><span>Disarm</span>`;
      this._pressable(d, { onTap: () => moreInfo(this, id) }, 0.05);
      el.alarmModes.appendChild(d);
    }
    for (const b of el.alarmModes.children) {
      if (b.dataset.mode === "disarm") b.hidden = st.state === "disarmed" || st.state === "unavailable";
      else attr(b, "data-on", armed && armed[1] === b.dataset.mode);
    }
    return { triggered };
  }

  _arm(id, mode) {
    const h = this._hass, cur = h.states[id];
    if (!cur || cur.state === `armed_${mode}`) return;
    // a code is the more-info dialog's job: nothing here ever holds one
    const needsCode = cur.attributes.code_format != null && cur.attributes.code_arm_required !== false;
    if (needsCode) { moreInfo(this, id); return; }
    h.callService("alarm_control_panel", `alarm_arm_${mode}`, {}, { entity_id: id });
    haptic("light");
  }

  // ---------- the camera ----------
  _renderCamera(items) {
    const el = this._el, id = this._camId, st = id ? this._hass.states[id] : null;
    el.cam.hidden = !st || this._compact;
    if (!st || this._compact) { clearInterval(this._camTimer); this._camTimer = 0; return; }
    text(el.camName, `${st.attributes.friendly_name || shortName(this._hass, id, null)} · Live`);
    this._camRefresh(true);
    if (!this._camTimer) this._camTimer = setInterval(() => this._camRefresh(), LOCK_CAM_MS);
  }

  // a fresh still while the card is on screen
  _camRefresh(force = false) {
    const el = this._el, id = this._camId;
    if (!el || !id || el.cam.hidden) return;
    if (!force && (this._onscreen === false || document.hidden)) return;
    const st = this._hass.states[id];
    const pic = st?.attributes.entity_picture || `/api/camera_proxy/${id}`;
    const url = typeof this._hass.hassUrl === "function" ? this._hass.hassUrl(pic) : pic;
    const next = /^(data|blob):/.test(url) ? url : `${url}${url.includes("?") ? "&" : "?"}_t=${Math.floor(Date.now() / 1000)}`;
    if (force && el.camImg.__base === url && el.camImg.__at && Date.now() - el.camImg.__at < LOCK_CAM_MS - 500) return;
    el.camImg.__base = url;
    el.camImg.__at = Date.now();
    el.camImg.src = next;
  }

  _openCamera() {
    const id = this._camId, h = this._hass;
    if (!id) return;
    if (!this._camSheet) {
      this._camSheet = new Sheet(this, { title: "Camera", wide: true, onClose: () => { this._camCard?.remove(); this._camCard = null; } });
      this._camSheet.el.classList.add("cam-sheet");
    }
    const st = h.states[id];
    this._camSheet.setTitle(st?.attributes.friendly_name || "Camera");
    const card = document.createElement("savvy-camera-card");
    card.setConfig({ cameras: [{ entity: id }], recordings: false, columns: 1 });
    this._camSheet.body.replaceChildren(card);
    card.hass = h;
    this._camCard = card;
    this._camSheet.open(this._el.cam);
  }

  _paint(dirty, all, red) {
    const t = clamp(this._tint.x, 0, 2);
    const c = lockTone(t);
    put(this._el.card, "--lk", c.join(" "));
    put(this._el.card, "--wash", (0.1 + 0.08 * t).toFixed(3));
  }
}

// ---------- editor ----------
const EDITOR = defineEditor("savvy-lock-card", (hass, c) => [
  S.entity("entity", "Lock", "lock", { helper: "One lock. Or pick an area, or list several below." }),
  { name: "area", label: "Area", helper: "Every lock in these areas. Locks with no area: add them under Include.", selector: { area: { multiple: true } } },
  { name: "entities", label: "Locks", helper: "Several locks, each with its own door, battery and camera.", type: "list",
    item: [
      { name: "entity", label: "Lock", selector: { entity: { domain: "lock" } } },
      S.grid(S.text("name", "Name"), S.icon()),
      { name: "door", label: "Door sensor", selector: { entity: { domain: "binary_sensor" } } },
      { name: "battery", label: "Battery", selector: { entity: { domain: "sensor", device_class: "battery" } } },
      { name: "camera", label: "Camera", selector: { entity: { domain: "camera" } } },
    ],
    add: { selector: { entity: { domain: "lock" } }, label: "Add a lock" } },
  { name: "include", label: "Include", helper: "Locks to show with this area, such as one that has no area.", selector: { entity: { domain: "lock", multiple: true } } },
  { name: "exclude", label: "Never show", selector: { entity: { domain: "lock", multiple: true } } },
  S.grid(S.text("name", "Name"), S.select("layout", "Layout", [{ value: "full", label: "Full" }, { value: "compact", label: "Compact (one row)" }])),
  S.icon(),
  { type: "expandable", name: "", title: "Door and battery", schema: [
    { name: "door", label: "Door sensor", helper: "Empty: the door contact of the lock's device or area.", selector: { entity: { domain: "binary_sensor" } } },
    S.bool("hide_door", "Hide door"),
    { name: "battery", label: "Battery", helper: "Empty: the battery sensor of the lock's device.", selector: { entity: { domain: "sensor", device_class: "battery" } } },
    S.bool("hide_battery", "Hide battery"),
    S.number("battery_warn", "Battery alert", 5, 90, 1, "%"),
    S.number("unlocked_warn", "Unlocked nudge", 0, 240, 1, "min"),
  ] },
  { type: "expandable", name: "", title: "Alarm and camera", schema: [
    { name: "alarm", label: "Alarm", helper: "Empty: the house's alarm panel, when there is one.", selector: { entity: { domain: "alarm_control_panel" } } },
    S.bool("hide_alarm", "Hide alarm"),
    { name: "camera", label: "Camera", helper: "Empty: a camera in the lock's area.", selector: { entity: { domain: "camera" } } },
    S.bool("hide_camera", "Hide camera"),
  ] },
  S.chips(),
]);

registerCard("savvy-lock-card", SavvyLockCard, "Lock",
  "A door at a glance: lock, unlock and open on one slide, the door and battery, an alarm row and a live camera.");
