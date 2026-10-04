// savvy-lock-card: a door, the way you'd want to handle it. The name is the title and the state a
// coloured status line under it (green when locked, amber when not, red when open or jammed;
// the card only washes when something is off), and the lock's own icon is the handle you slide across its row: past the first stop it
// does the opposite of what the lock is now, and Open (the latch) needs the end held until a ring fills.
// A tap on the icon only nudges it.
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
//   alarm_view: compact | full | hidden     compact: one line, a chevron slides the arm modes open; full: the modes always there
//   camera: camera.porch                    (else a camera in the lock's area; false / hide_camera: none)
//   camera_view: compact | full | hidden    compact: a slim row with an Open camera button; full: a live still
//   layout: full | compact                  chips: [...]  (the one chip spec)
//
// With several locks: a row each, a summary and a "Lock all". Tap a name for the lock's
// details. The alarm's arm modes are buttons; disarming, and any code, is more-info's job:
// the card never keeps a code. The camera is a live still that opens a popup with the camera card.

const LOCK_CAM_MS = 8000;
const LOCK_DOOR_CLASSES = ["door", "garage_door", "opening", "window"];
const lockTone = (t) => (t <= 1 ? mixRgb(LOCK_COLORS[0], LOCK_COLORS[1], clamp(t)) : mixRgb(LOCK_COLORS[1], LOCK_COLORS[2], clamp(t - 1)));
const LOCK_TONE_WORD = ["rgb(76 175 80)", "rgb(232 163 61)", "rgb(224 102 102)"];
const LOCK_AMBER = "var(--warn-rgb)", LOCK_RED = "var(--bad-rgb)";

const STYLE = `${BASE_CSS}${CHIP_ROW_CSS}${LOCK_SLIDE_CSS}
  ha-card { --pad: 16px; --lk: 76 175 80; --pulse: 0; position: relative; display: flex; flex-direction: column; gap: 12px; padding: var(--pad); overflow: hidden; }
  :host([data-compact]) ha-card { --pad: 12px; gap: 8px; }
  ha-card > * { position: relative; }
  .head { display: flex; align-items: center; gap: 10px; min-height: 30px; }
  .head .t { flex: 1; min-width: 0; font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sum { flex: none; display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: 12px; font-size: 12px; font-weight: 650;
    color: rgb(var(--lk)); background: rgb(var(--lk) / 0.12); white-space: nowrap; }
  .btn { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 11px; background: var(--well);
    font-size: 12.5px; line-height: 16px; font-weight: 650; color: var(--primary-text-color); --mdc-icon-size: 16px; cursor: pointer; }
  .btn ha-icon { display: flex; }
  .btn[data-on] { color: rgb(var(--lk)); background: rgb(var(--lk) / 0.12); }
  .locks { display: flex; flex-direction: column; gap: 12px; }
  .lk { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .top { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 4px 8px 4px 4px; border-radius: 32px; }
  .who { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; text-align: start; border-radius: 12px; cursor: pointer; }
  .disc { flex: none; display: grid; place-items: center; width: var(--b-m); height: var(--b-m); border-radius: 50%; color: var(--tone); background: color-mix(in oklab, var(--tone) var(--mix-on), transparent); --mdc-icon-size: 20px; }
  .disc > .dicon { display: flex; align-items: center; justify-content: center; line-height: 0; }
  .disc > .dicon > * { display: flex; }
  .col { min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 5px; }
  .nm { grid-column: 1 / -1; font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .st { font-size: 13px; line-height: 17px; font-weight: 600; color: var(--tone); white-space: nowrap; }
  :host([data-solo]) .disc { width: var(--b-l); height: var(--b-l); --mdc-icon-size: 22px; }
  .sub { font-size: 13px; line-height: 17px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub:not(:empty)::before { content: "\\00b7\\00a0"; }
  .sub:empty { display: none; }
  .meta { flex: none; display: flex; align-items: center; gap: 8px; }
  .door, .batt { position: relative; display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px 0 7px; border-radius: 13px; background: var(--well);
    font-size: 12px; font-weight: 600; color: var(--secondary-text-color); white-space: nowrap; --mdc-icon-size: 16px; }
  .door ha-icon { display: flex; }
  /* a closed door is just its icon: the words appear when the door is open */
  .door:not([data-warn]) { padding: 0 5px; }
  .door:not([data-warn]) > span:last-child { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .door[data-warn], .batt[data-level="warn"] { color: rgb(${LOCK_AMBER}); background: rgb(${LOCK_AMBER} / 0.16); }
  .batt[data-level="bad"] { color: rgb(${LOCK_RED}); background: rgb(${LOCK_RED} / 0.16); }
  .batt ha-icon { display: flex; }
  /* several locks: a smaller row each */
  /* compact: one row, the handle at its start */
  :host([data-compact]) .locks { gap: 8px; }
  :host([data-compact]) .top { padding: 3px 8px 3px 3px; border-radius: 26px; }
  :host([data-compact]) .disc { width: var(--b-m); height: var(--b-m); --mdc-icon-size: 20px; }
  :host([data-compact]) .nm { font-size: 14px; line-height: 18px; }
  :host([data-compact]) .sub { display: none; }
  :host([data-compact]) .col { grid-template-columns: minmax(0, 1fr); }
  :host([data-compact]) .meta .door:not([data-warn]), :host([data-compact]) .meta .batt:not([data-level="warn"]):not([data-level="bad"]) { display: none; }
  :host([data-compact]) .door, :host([data-compact]) .batt { height: 22px; font-size: 11px; }
  .nudge { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 12px; border-radius: 14px; background: rgb(${LOCK_AMBER} / 0.14); color: rgb(${LOCK_AMBER});
    font-size: 13px; line-height: 17px; font-weight: 650; --mdc-icon-size: 18px; }
  .nudge ha-icon { display: flex; flex: none; }
  .nudge .tx { flex: 1; min-width: 0; }
  .nudge .btn { background: rgb(${LOCK_AMBER} / 0.2); color: inherit; }
  .alarm { display: flex; flex-direction: column; gap: 8px; padding: 6px 8px 6px 10px; border-radius: 14px; background: var(--well); min-width: 0; }
  .alarm[data-triggered] { background: rgb(${LOCK_RED} / 0.18); color: rgb(${LOCK_RED}); }
  .al1 { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 30px; }
  .alarm .ai { flex: none; display: grid; place-items: center; width: 24px; height: 24px;
    --mdc-icon-size: 20px; color: var(--secondary-text-color); }
  .alarm[data-armed] .ai { color: rgb(76 175 80); }
  .alarm[data-triggered] .ai { color: rgb(${LOCK_RED}); }
  .alarm .ai ha-icon { display: flex; }
  .alarm .ab { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 6px; }
  .alarm .an { flex: none; font-size: 13px; line-height: 18px; font-weight: 500; color: var(--secondary-text-color); }
  .alarm .as { min-width: 0; font-size: 14px; line-height: 18px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .alarm .achev { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%;
    color: var(--secondary-text-color); --mdc-icon-size: 20px; cursor: pointer; }
  .alarm .achev ha-icon { display: flex; transform: rotate(calc(var(--r, 0) * 180deg)); }
  .alarm[data-view="full"] .achev { display: none; }
  /* the arm modes slide sideways when there are more than fit: never clipped at the card's edge */
  .alarm .am { display: flex; flex-wrap: nowrap; gap: 6px; margin: 0 -8px 0 -10px; padding: 0 8px 0 10px; overflow-x: auto; overscroll-behavior-x: contain; touch-action: pan-x pan-y;
    scrollbar-width: none; scroll-snap-type: x proximity; }
  .alarm .am::-webkit-scrollbar { display: none; }
  .alarm .am[data-overflow] { -webkit-mask-image: linear-gradient(to left, transparent 0, #000 26px); mask-image: linear-gradient(to left, transparent 0, #000 26px); }
  .alarm .am .btn { flex: none; scroll-snap-align: start; height: 30px; padding: 0 10px; background: color-mix(in oklab, var(--primary-text-color) 7%, transparent); }
  .alarm .am .btn[data-on] { color: rgb(76 175 80); background: rgb(76 175 80 / 0.12); }
  .alarm[data-triggered] .am .btn { background: rgb(${LOCK_RED} / 0.14); color: inherit; }
  .cam { position: relative; display: block; width: 100%; padding: 0; border: 0; border-radius: 12px; overflow: hidden; cursor: pointer; background: var(--well); aspect-ratio: 21 / 9; }
  .cam img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cam .cl { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: 6px; padding: 18px 12px 9px; color: #fff; --mdc-icon-size: 16px;
    font-size: 12.5px; font-weight: 600; background: linear-gradient(transparent, rgb(0 0 0 / 0.45)); text-align: start; }
  .cam .cl ha-icon { display: flex; }
  .camrow { display: flex; align-items: center; gap: 10px; padding: 6px 8px 6px 6px; border-radius: 14px; background: var(--well); min-width: 0; }
  .camrow .cth { flex: none; width: 52px; height: 36px; border-radius: 9px; object-fit: cover; background: color-mix(in oklab, var(--secondary-text-color) 18%, transparent); cursor: pointer; }
  .camrow .ctx { flex: 1; min-width: 0; display: flex; flex-direction: column; text-align: start; cursor: pointer; }
  .camrow .cn { font-size: 13px; line-height: 17px; font-weight: 650; letter-spacing: -0.005em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .camrow .cs { font-size: 11px; line-height: 14px; font-weight: 600; color: var(--secondary-text-color); display: flex; align-items: center; gap: 5px; }
  .camrow .cs i { width: 6px; height: 6px; border-radius: 50%; background: rgb(${LOCK_RED}); display: inline-block; }
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
    const view = (v, off) => (["full", "compact", "hidden"].includes(v) ? v : off ? "hidden" : "compact");
    this._alarmView = view(config.alarm_view, config.alarm === false || config.hide_alarm);
    // a compact card is one row: its camera stays away unless asked for
    this._camView = view(config.camera_view ?? (this._compact ? "hidden" : undefined), config.camera === false || config.hide_camera);
    if (this._compact && this._alarmView === "full") this._alarmView = "compact";
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
  getCardSize() { return this._compact ? 2 : 3 + (this._camId && this._camView === "full" ? 3 : this._camId && this._camView === "compact" ? 1 : 0); }
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
        <div class="alarm" id="alarm" hidden><div class="al1"><span class="ai"><ha-icon id="alarmIc"></ha-icon></span><span class="ab"><span class="an">Alarm</span><span class="as" id="alarmSt"></span></span><button class="achev" id="alarmChev" aria-expanded="false" aria-label="Arm modes"><ha-icon icon="mdi:chevron-down"></ha-icon></button></div><div class="am" id="alarmModes"></div></div>
        <button class="cam" id="cam" hidden aria-label="Open camera"><img id="camImg" alt=""><span class="cl"><ha-icon icon="mdi:cctv"></ha-icon><span id="camName"></span></span></button>
        <div class="camrow" id="camRow" hidden><img class="cth" id="camThumb" alt=""><span class="ctx" id="camTx" role="button" tabindex="0"><span class="cn" id="camRowName"></span><span class="cs"><i></i>Live</span></span><button class="btn" id="camBtn"><ha-icon icon="mdi:cctv"></ha-icon><span>Open camera</span></button></div>
        <div class="empty" id="empty" hidden></div>
        <div class="chips" id="chips" hidden></div>
      </ha-card>`;
    const $ = (id) => root.getElementById(id);
    this._el = { card: root.querySelector("ha-card"), head: $("head"), title: $("title"), sum: $("sum"), all: $("all"), locks: $("locks"),
      nudge: $("nudge"), nudgeTx: $("nudgeTx"), nudgeBtn: $("nudgeBtn"), alarm: $("alarm"), alarmIc: $("alarmIc"), alarmSt: $("alarmSt"), alarmModes: $("alarmModes"), alarmChev: $("alarmChev"),
      cam: $("cam"), camImg: $("camImg"), camName: $("camName"), camRow: $("camRow"), camThumb: $("camThumb"), camTx: $("camTx"), camBtn: $("camBtn"), camRowName: $("camRowName"), empty: $("empty"), chips: $("chips") };
    this._pressable(this._el.all, { onTap: () => this._lockAll() }, 0.05);
    this._pressable(this._el.nudgeBtn, { onTap: () => this._nudged && this._call(this._nudged, "lock") }, 0.05);
    this._pressable(this._el.cam, { onTap: () => this._camId && this._openCamera() }, 0.025);
    this._pressable(this._el.camBtn, { onTap: () => this._camId && this._openCamera() }, 0.05);
    this._pressable(this._el.camTx, { onTap: () => this._camId && this._openCamera() }, 0.03);
    this._pressable(this._el.alarmChev, { onTap: () => this._toggleAlarm() }, 0.1);
    this._alarmOpen = false;
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => { this._fitRow(this._el.chips); this._fitRow(this._el.alarmModes); });
    this._ro.observe(this._el.chips);
    this._ro.observe(this._el.alarmModes);
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
    for (const p of c.pinned) if (p.entity && !out.some((o) => o.entity === p.entity)) out.push(p); // named locks always show
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
    if (c.alarm === false || c.hide_alarm || this._alarmView === "hidden") return null;
    if (typeof c.alarm === "string" && c.alarm) return h.states[c.alarm] ? c.alarm : null;
    return houseEntities(h).find((id) => domainOf(id) === "alarm_control_panel") || null;
  }

  _cameraOf(items) {
    const h = this._hass, c = this._config;
    if (c.camera === false || c.hide_camera || this._camView === "hidden") return null;
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
      Motion.show(el.all, !!needing.length);
    }
    // the nudge: unlocked for a while
    this._nudged = nudged;
    Motion.reveal(el.nudge, !!nudged);
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
        <span class="disc"><span class="dicon"></span></span>
        <button class="who" aria-label="Open details"><span class="col"><span class="nm"></span><span class="st"></span><span class="sub"></span></span></button>
        <span class="meta"><span class="door" hidden><ha-icon></ha-icon><span></span></span><span class="batt" hidden><ha-icon></ha-icon><span></span></span></span>
      </div>`;
    const q = (s) => node.querySelector(s);
    node.__el = { disc: q(".disc"), dicon: q(".dicon"), nm: q(".nm"), st: q(".st"), door: q(".door"), doorIc: q(".door ha-icon"), doorTx: q(".door span:last-child"),
      batt: q(".batt"), battIc: q(".batt ha-icon"), battTx: q(".batt > span:last-child"), sub: q(".sub") };
    const call = (svc) => this._call(id, svc);
    node.__track = new LockSlide(this._kit, { host: q(".top"), handle: q(".disc"), label: "Lock", canOpen, hintHost: q(".who"),
      fade: [q(".who"), q(".meta")], onLock: () => call("lock"), onUnlock: () => call("unlock"), onOpen: () => call("open") });
    node.__track.onWords = () => this._update();
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
      el.dicon.innerHTML = wantState ? "<savvy-state-icon></savvy-state-icon>" : "<ha-icon></ha-icon>";
    }
    const ic = el.dicon.firstElementChild;
    if (wantState) { if (ic.stateObj !== st) { ic.hass = h; ic.stateObj = st; } }
    else attr(ic, "icon", item.icon || this._config.icon || "mdi:lock");
    // the door
    const doorId = this._doorOf(item, solo), door = doorId ? h.states[doorId] : null;
    const doorOpen = !!door && door.state === "on";
    const doorWords = door ? (door.state === "on" ? "Door open" : door.state === "off" ? "Door closed" : null) : null;
    Motion.show(el.door, !!doorWords);
    if (doorWords) {
      text(el.doorTx, doorWords);
      attr(el.doorIc, "icon", doorOpen ? "mdi:door-open" : "mdi:door-closed");
      attr(el.door, "data-warn", doorOpen && (state === "locked" || state === "locking"));
    }
    // the battery
    const battId = this._batteryOf(item, solo), batt = battId ? h.states[battId] : null;
    const pct = batt ? parseFloat(batt.state) : NaN;
    Motion.show(el.batt, Number.isFinite(pct));
    if (Number.isFinite(pct)) {
      const warn = Number(this._config.battery_warn ?? 40);
      attr(el.batt, "data-level", pct <= 15 ? "bad" : pct < warn ? "warn" : "ok");
      text(el.battTx, `${Math.round(pct)}%`);
      attr(el.battIc, "icon", pct <= 15 ? "mdi:battery-alert-variant-outline" : batteryLevelIcon(pct));
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
    Motion.reveal(el.alarm, !!st);
    if (!st) return { triggered: false };
    const sf = st.attributes.supported_features ?? 7;
    const modes = ARM.filter((m) => sf & m[2]);
    const armed = /^armed_(.+)$/.exec(st.state);
    const triggered = st.state === "triggered";
    attr(el.alarm, "data-armed", !!armed);
    attr(el.alarm, "data-triggered", triggered);
    attr(el.alarm, "data-view", this._alarmView);
    // a triggered alarm opens its modes by itself; otherwise the chevron decides (full: always open)
    if (triggered && !this._wasTriggered) this._alarmOpen = true;
    this._wasTriggered = triggered;
    const open = this._alarmView === "full" || this._alarmOpen;
    Motion.reveal(el.alarmModes, open);
    attr(el.alarmChev, "aria-expanded", String(open));
    Motion.tweenVar(el.alarmChev, "--r", open ? 1 : 0);
    requestAnimationFrame(() => this._fitRow(el.alarmModes));
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
      if (b.dataset.mode === "disarm") Motion.show(b, !(st.state === "disarmed" || st.state === "unavailable"));
      else attr(b, "data-on", armed && armed[1] === b.dataset.mode);
    }
    return { triggered };
  }

  _toggleAlarm() {
    this._alarmOpen = !this._alarmOpen;
    haptic("selection");
    if (this._hass) this._update();
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
    const el = this._el, id = this._camId, st = id ? this._hass.states[id] : null, view = this._camView;
    const full = !!st && view === "full", row = !!st && view === "compact";
    Motion.reveal(el.cam, full);
    Motion.reveal(el.camRow, row);
    this._camVisible = full || row;
    if (!this._camVisible) { clearInterval(this._camTimer); this._camTimer = 0; return; }
    const name = st.attributes.friendly_name || shortName(this._hass, id, null);
    text(el.camName, `${name} · Live`);
    text(el.camRowName, name);
    this._camRefresh(true);
    if (!this._camTimer) this._camTimer = setInterval(() => this._camRefresh(), LOCK_CAM_MS);
  }

  // a fresh still while the card is on screen
  _camRefresh(force = false) {
    const el = this._el, id = this._camId;
    if (!el || !id || !this._camVisible) return;
    if (!force && (this._onscreen === false || document.hidden)) return;
    const img = this._camView === "full" ? el.camImg : el.camThumb;
    const st = this._hass.states[id];
    const pic = st?.attributes.entity_picture || `/api/camera_proxy/${id}`;
    const url = typeof this._hass.hassUrl === "function" ? this._hass.hassUrl(pic) : pic;
    const next = /^(data|blob):/.test(url) ? url : `${url}${url.includes("?") ? "&" : "?"}_t=${Math.floor(Date.now() / 1000)}`;
    if (force && img.__base === url && img.__at && Date.now() - img.__at < LOCK_CAM_MS - 500) return;
    img.__base = url;
    img.__at = Date.now();
    img.src = next;
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
    card.setConfig({ cameras: [{ entity: id }], recordings: "inline", columns: 1 });
    this._camSheet.body.replaceChildren(card);
    card.hass = h;
    this._camCard = card;
    this._camSheet.open(this._camView === "full" ? this._el.cam : this._el.camBtn);
  }

  _paint(dirty, all, red) {
    const t = clamp(this._tint.x, 0, 2);
    const c = lockTone(t);
    put(this._el.card, "--lk", c.join(" "));
    // the corner glow, in the lock's tone: a soft green while it is locked, fuller as it turns amber and red
    put(this._el.card, "--glow-rgb", c.join(" "));
    put(this._el.card, "--glow", this._config.state_glow === false ? "0" : (0.5 + 0.25 * t).toFixed(3));
  }
}

// ---------- editor ----------
const VIEWS = [{ value: "compact", label: "Compact" }, { value: "full", label: "Full" }, { value: "hidden", label: "Hidden" }];
const EDITOR = defineEditor("savvy-lock-card", (hass, c) => [
  S.select("layout", "Layout", [{ value: "full", label: "Full" }, { value: "compact", label: "Compact (one row)" }]),
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
  S.grid(S.text("name", "Name"), S.icon()),
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
    S.select("alarm_view", "Alarm view", VIEWS),
    { name: "camera", label: "Camera", helper: "Empty: a camera in the lock's area.", selector: { entity: { domain: "camera" } } },
    S.select("camera_view", "Camera view", VIEWS),
  ] },
  S.chips(),
]);

registerCard("savvy-lock-card", SavvyLockCard, "Lock",
  "A door at a glance: lock, unlock and open on one slide, the door and battery, an alarm row and a live camera.");
