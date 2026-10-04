// savvy-entity-card: one main entity, and the entities that belong with it underneath as
// chips.
//
//   main   by what it is: a person or device_tracker gets their picture (initials when
//          there's none), a zone badge and "Home · for 3 h"; anything else its own state
//          icon, name and "Charging · for 40 min". The time ticks on a coarse timer.
//   chips  the one chip spec. A toggle toggles at once (the chip shows the result before
//          HA confirms), a button presses, a script or scene runs, anything else shows its
//          value and opens more-info. Hold opens more-info.
//
//   type: custom:savvy-entity-card
//   entity: person.sam
//   chips: [{ entity: switch.charger_plug, name: Charger, icon: mdi:ev-plug-type2, color: blue }]

const TICK_MS = 30000;
const PREDICT_MS = 4000;
const PEOPLE = new Set(["person", "device_tracker"]);
const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";

// The pre-Savvy shorthands: tap_action: toggle | press | turn_on | more-info
const legacyAction = (a, entity) => {
  if (a === "press" || a === "turn_on") return { action: "perform-action", perform_action: `${domainOf(entity)}.${a}`, target: { entity_id: entity } };
  return asAction(a);
};

const STYLE = `${BASE_CSS}
  ha-card { --pad: 12px; display: flex; flex-direction: column; gap: 10px; padding: var(--pad); }
  .main { --on: 0; --away: 0; display: flex; align-items: center; gap: 11px; min-width: 0;
    border-radius: 14px; margin: -4px; padding: 4px; cursor: pointer; transform-origin: 30% 50%; }
  .av { position: relative; flex: none; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--well);
    --mdc-icon-size: 22px; color: color-mix(in oklab, var(--main-c, var(--primary-text-color)) calc(var(--on) * 100%), var(--secondary-text-color)); }
  .av[data-kind="icon"] { background: color-mix(in oklab, var(--main-c, var(--primary-text-color)) calc(6% + var(--on) * 10%), transparent); }
  .av img { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 50%; object-fit: cover;
    filter: grayscale(calc(var(--away) * 0.85)); opacity: calc(1 - var(--away) * 0.35); }
  .av .ini { font-size: 14px; line-height: 1; font-weight: 650; letter-spacing: -0.01em; transform: translate(-2px, -2px);
    color: var(--primary-text-color); opacity: calc(1 - var(--away) * 0.45); }
  .av .zone { position: absolute; right: -4px; bottom: -4px; width: 19px; height: 19px; border-radius: 50%; display: grid; place-items: center;
    --mdc-icon-size: 12px; background: var(--card-background-color, #fff); color: var(--primary-text-color);
    box-shadow: 0 0 0 1.5px var(--card-background-color, #fff), inset 0 0 0 20px var(--well); }
  /* ha-icon is inline with a baseline gap under its svg; as a fixed-size flex box it centres */
  .av > ha-icon, .av > savvy-state-icon, .av .zone ha-icon { display: flex; align-items: center; justify-content: center;
    width: var(--mdc-icon-size); height: var(--mdc-icon-size); line-height: 0; }
  .txt { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .name { font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { display: flex; gap: 4px; min-width: 0; font-size: 12.5px; line-height: 16px; font-weight: 500; letter-spacing: -0.005em;
    color: var(--secondary-text-color); white-space: nowrap; }
  .sub .st { font-weight: 600; color: var(--primary-text-color); flex: none; }
  .sub .since { overflow: hidden; text-overflow: ellipsis; }
  .sub .st:not([hidden]) + .since::before { content: "· "; }
  .sub .since:empty { display: none; }
  .main[data-off] .av, .main[data-off] .sub .st { opacity: 0.55; }

  .pills { display: flex; gap: 6px; min-width: 0; overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain; padding: 3px; margin: -3px; }
  .pills::-webkit-scrollbar { display: none; }
  .pills[data-overflow] { mask-image: linear-gradient(to left, transparent 0, #000 26px); -webkit-mask-image: linear-gradient(to left, transparent 0, #000 26px); }
  .pill { --on: 0; flex: none; display: flex; align-items: center; gap: 6px; box-sizing: border-box; height: 32px; padding: 0 12px 0 9px; border-radius: 11px;
    background: color-mix(in oklab, var(--chip-c, var(--primary-text-color)) calc(6% + var(--on) * 10%), transparent);
    font-size: 12.5px; line-height: 16px; font-weight: 600; letter-spacing: -0.006em;
    color: color-mix(in oklab, var(--primary-text-color) calc(60% + var(--on) * 40%), transparent);
    --mdc-icon-size: 17px; cursor: pointer; white-space: nowrap; transform-origin: 50% 50%; }
  .pill .ic { display: flex; color: color-mix(in oklab, var(--chip-c, var(--primary-text-color)) calc(var(--on) * 100%), var(--secondary-text-color)); }
  .pill[data-kind="value"] { color: var(--primary-text-color); }
  .pill .cn { font-weight: 500; color: var(--secondary-text-color); }
  /* show_state: false -> the name is the only label, so it reads as one and stays */
  .pill[data-nostate] .cn { font-weight: 600; color: inherit; display: inline !important; }
  .pill[data-icononly] { padding: 0 9px; }
  .pill[data-off] { opacity: 0.5; }
  @media (prefers-contrast: more) { .sub, .pill .cn { color: var(--primary-text-color); opacity: 0.85; } }
  /* half a section: names drop first (the icon says what it is), the time only when there's truly no room */
  @container (max-width: 300px) { .pill .cn { display: none; } .pill { padding-right: 11px; } }
  @container (max-width: 190px) { .av { width: 40px; height: 40px; } .sub .since { display: none; } }
`;

class SavvyEntityCard extends SavvyCard {
  static getStubConfig(hass) {
    const p = Object.keys(hass?.states || {}).find((id) => id.startsWith("person."))
      || Object.keys(hass?.states || {}).find((id) => id.startsWith("light.") || id.startsWith("switch."));
    return p ? { entity: p } : {};
  }
  static getConfigElement() { return document.createElement(EDITOR); }

  constructor() {
    super();
    this._onscreen = true;
    this._pills = new Map();
    this._expect = new Map();
  }

  setConfig(config) {
    if (!config?.entity) throw new Error('savvy-entity-card: "entity" (the main entity) is required');
    // chips: the one chip spec; `entities` is the pre-Savvy name
    const chips = asItems(config.chips ?? config.entities);
    this._config = { ...config, chips };
    if (this._el) { this._build(); if (this._hass) this._update(); }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._el) this._build();
    this._update();
  }

  connectedCallback() {
    this._observe();
    this._ticker = this._ticker || setInterval(() => { if (this._onscreen) this._tickTimes(); }, TICK_MS);
    this._wake();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._io?.disconnect();
    clearInterval(this._ticker);
    this._ticker = 0;
  }
  getCardSize() { return this._config?.chips?.length ? 2 : 1; }
  getGridOptions() { return { columns: 6, min_columns: 3, rows: "auto" }; }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._resetMotion();
    this._pills.clear();
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="main" id="main" role="button" tabindex="0">
          <span class="av" id="av"></span>
          <span class="txt"><span class="name" id="name"></span>
            <span class="sub" id="sub"><span class="st" id="st"></span><span class="since" id="since"></span></span></span>
        </div>
        <div class="pills" id="pills" role="group"></div>
      </ha-card>`;
    const $ = (id) => root.getElementById(id);
    this._el = { card: root.querySelector("ha-card"), main: $("main"), av: $("av"), name: $("name"), st: $("st"), since: $("since"), sub: $("sub"), pills: $("pills") };
    linkTitle(root, this._el.name, titlePathOf(this._config), (el, onTap) => this._pressable(el, { onTap, haptic: null }, 0.05));
    this._mainOn = this._spring(0, MOTION.ui, "main");
    this._mainAway = this._spring(0, MOTION.ui, "main");
    this._first = true;
    const c = this._config;
    this._pressable(this._el.main, {
      onTap: () => this._mainAct("tap"),
      onHold: () => this._mainAct("hold"),
      onDouble: c.double_tap_action ? () => this._mainAct("double_tap") : null,
      haptic: null,
    }, 0.035);
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => this._fitRow(this._el.pills));
    this._ro.observe(this._el.pills);
    this._observe();
  }

  _observe() {
    if (!this._el || !this.isConnected) return;
    this._io = this._io || new IntersectionObserver(([e]) => {
      this._onscreen = e.isIntersecting;
      if (this._onscreen) { this._tickTimes(); this._paintAll(null); this._wake(); }
    });
    this._io.disconnect();
    this._io.observe(this);
  }

  // ---------- the main entity ----------
  _mainAction(kind) {
    const c = this._config;
    const given = c[`${kind}_action`];
    if (given !== undefined) return legacyAction(given, c.entity);
    if (kind === "tap") return c.navigation_path ? { action: "navigate", navigation_path: c.navigation_path } : { action: "more-info" };
    if (kind === "hold") return { action: "more-info" };
    return null;
  }

  _mainAct(kind) {
    const c = this._config, h = this._hass, a = this._mainAction(kind);
    if (!a || a.action === "none") return;
    haptic("light");
    if (a.action === "toggle") return this._toggle(c.entity);
    // a button presses, a script or scene runs: the status line says so for a moment,
    // since a stateless entity has no state change of its own to show
    const svc = a.action === "perform-action" || a.action === "call-service" ? (a.perform_action || a.service || "") : "";
    const self = !a.target || [].concat(a.target.entity_id || []).includes(c.entity);
    if (self && /\.(press|turn_on)$/.test(svc) && STATELESS.has(domainOf(c.entity))) {
      if (isDown(h.states[c.entity])) return;
      runAction(this, h, a, { entity: c.entity });
      this._firedUntil = Date.now() + 1800;
      this._firedWord = svc.endsWith(".press") ? "Pressed" : "Running";
      clearTimeout(this._firedT);
      this._firedT = setTimeout(() => this._update(), 1850);
      return this._update();
    }
    runAction(this, h, a, { entity: c.entity });
  }

  _where(st) {
    if (!st) return { word: "Not found", icon: "mdi:help", away: false };
    if (isOff(st)) return { word: "Unavailable", icon: "mdi:help", away: false };
    if (st.state === "home") return { word: "Home", icon: "mdi:home", away: false };
    if (st.state === "not_home") return { word: "Away", icon: "mdi:home-export-outline", away: true };
    const zone = Object.values(this._hass.states).find((z) => z.entity_id.startsWith("zone.")
      && (z.attributes.friendly_name === st.state || z.entity_id === `zone.${st.state}`));
    return { word: stateText(this._hass, st), icon: zone?.attributes.icon || "mdi:map-marker", away: false };
  }

  _renderMain() {
    const h = this._hass, c = this._config, el = this._el, st = h.states[c.entity];
    const person = PEOPLE.has(domainOf(c.entity));
    const name = c.name || c.title || st?.attributes.friendly_name || title(c.entity.split(".")[1] || c.entity);
    text(el.name, name);
    attr(el.main, "data-off", !st || isOff(st));
    if (c.color) put(el.main, "--main-c", colorOf(c.color));
    let word, active, away = 0;
    if (person) {
      const w = this._where(st);
      word = w.word;
      active = !isOff(st);
      away = w.away ? 1 : 0;
      const pic = c.picture ?? st?.attributes.entity_picture;
      const want = `person|${pic || ""}|${initials(name)}`;
      if (el.av.__key !== want) {
        el.av.__key = want;
        attr(el.av, "data-kind", "person");
        el.av.innerHTML = `${pic ? `<img alt="" src="${esc(pic)}">` : `<span class="ini">${esc(initials(name))}</span>`}<span class="zone" aria-hidden="true"><ha-icon></ha-icon></span>`;
        const img = el.av.querySelector("img");
        // a picture that 404s falls back to initials rather than a broken image
        if (img) img.onerror = () => { img.replaceWith(Object.assign(document.createElement("span"), { className: "ini", textContent: initials(name) })); };
      }
      attr(el.av.querySelector(".zone ha-icon"), "icon", w.icon);
      el.av.querySelector(".zone").hidden = !st || isOff(st);
    } else {
      const k = c.icon ? "icon" : "state";
      if (el.av.__key !== k) {
        el.av.__key = k;
        attr(el.av, "data-kind", "icon");
        el.av.innerHTML = c.icon ? "<ha-icon></ha-icon>" : "<savvy-state-icon></savvy-state-icon>";
      }
      const ic = el.av.firstElementChild;
      if (c.icon) attr(ic, "icon", c.icon);
      else if (st && ic.stateObj !== st) { ic.hass = h; ic.stateObj = st; }
      active = !!st && !isOff(st) && !["off", "idle", "closed", "locked", "standby", "0"].includes(st.state);
      word = st ? stateText(h, st) : "Not found";
      // a button/scene/script's state is *when* it last ran, not a state
      if (st && STATELESS.has(domainOf(c.entity)) && st.state !== "unavailable") {
        const press = PRESSES.has(domainOf(c.entity));
        active = false;
        word = Number.isFinite(Date.parse(st.state)) ? (press ? "Last pressed" : "Last run") : (press ? "Never pressed" : "Never run");
      }
    }
    const fired = this._firedUntil && Date.now() < this._firedUntil;
    if (fired) { word = this._firedWord; active = true; }
    text(el.st, word);
    el.st.hidden = c.show_state === false && !fired;
    this._mainOn.to(active ? 1 : 0, MOTION.ui);
    // the glow: its colour while it is on, nothing otherwise (people at home, a switch on, a sensor reading on)
    const mainCss = c.color ? colorOf(c.color) : "";
    stateGlow(c, el.card, active && !person ? toRgb(mainCss && !mainCss.startsWith("var(") ? mainCss : "#588EE9") : null, 0.8);
    this._mainAway.to(away, MOTION.ui);
    el.main.__st = st;
    this._mainWord = word;
    this._tickTimes();
  }

  // ---------- the chips ----------
  _tapAction(item) {
    if (item.tap_action !== undefined) return legacyAction(item.tap_action, item.entity);
    if (item.navigation_path) return { action: "navigate", navigation_path: item.navigation_path };
    if (!item.entity) return null;
    const d = domainOf(item.entity);
    // locks and covers too: a chip is a quick control (the lock's more-info is a hold away)
    if (d === "lock" || d === "cover") return { action: "toggle" };
    return defaultTapAction(item.entity);
  }

  _kind(item) {
    const a = this._tapAction(item);
    if (!a) return "value";
    if (a.action === "navigate" && !item.entity) return "nav";
    if (a.action === "toggle") return "toggle";
    const svc = a.perform_action || a.service || "";
    if (/\.press$/.test(svc)) return "press";
    if (/\.turn_on$/.test(svc) && STATELESS.has(domainOf(item.entity))) return "turn_on";
    return "value";
  }

  _renderPills() {
    Motion.flip(this._el.pills, () => this._renderPillsNow());
  }

  _renderPillsNow() {
    const h = this._hass, list = this._config.chips, box = this._el.pills, seen = new Set();
    list.forEach((item, i) => {
      const key = `${i}|${item.entity || item.navigation_path}`;
      seen.add(key);
      let node = this._pills.get(key);
      if (!node) {
        node = document.createElement("div");
        node.className = "pill";
        node.innerHTML = `<span class="ic"></span><span class="cn"></span><span class="cv"></span>`;
        node.__el = { ic: node.querySelector(".ic"), v: node.querySelector(".cv"), n: node.querySelector(".cn") };
        attr(node, "role", "button");
        attr(node, "tabindex", "0");
        const cur = () => node.__item;
        this._pressable(node, {
          onTap: () => this._runPill(cur(), "tap"),
          onHold: () => this._runPill(cur(), "hold"),
          onDouble: item.double_tap_action ? () => this._runPill(cur(), "double_tap") : null,
          haptic: null,
        }, 0.035);
        node.__on = this._spring(0, MOTION.ui, `pill:${key}`);
        node.__enter = this._spring(0, MOTION.ui, `pill:${key}`).to(1, MOTION.ui);
        this._pills.set(key, node);
      }
      node.__item = item;
      place(box, node, i);
      this._renderPill(node, item, item.entity ? h.states[item.entity] : null);
    });
    for (const [key, node] of this._pills) {
      if (seen.has(key)) continue;
      for (const s of [node.__on, node.__enter, node.__spring]) { const k = this._springs.indexOf(s); if (k >= 0) this._springs.splice(k, 1); }
      const p = this._pressNodes.indexOf(node);
      if (p >= 0) this._pressNodes.splice(p, 1);
      node.remove();
      this._pills.delete(key);
    }
    box.hidden = !list.length;
    this._fitRow(box);
  }

  // A chip reads as its value ("On", "82 %", "Charging"); a configured name leads it
  // ("Charger On"); a toggle's on/off is carried by its tint as well as the word.
  _renderPill(node, item, st) {
    const h = this._hass, kind = this._kind(item);
    attr(node, "data-kind", kind);
    if (item.color) put(node, "--chip-c", colorOf(item.color));
    attr(node, "data-off", !!item.entity && isDown(st));
    const wantState = !item.icon && !!st;
    if (node.__iconKind !== (wantState ? "state" : "plain")) {
      node.__iconKind = wantState ? "state" : "plain";
      node.__el.ic.outerHTML = wantState ? `<savvy-state-icon class="ic"></savvy-state-icon>` : `<ha-icon class="ic"></ha-icon>`;
      node.__el.ic = node.querySelector(".ic");
    }
    if (wantState) { if (node.__el.ic.stateObj !== st) { node.__el.ic.hass = h; node.__el.ic.stateObj = st; } }
    else attr(node.__el.ic, "icon", item.icon || (kind === "nav" ? "mdi:arrow-right" : "mdi:help-circle-outline"));
    const on = kind === "toggle" ? this._isOn(item.entity, st) : kind === "value" && st?.state === "on";
    let value;
    if (kind === "nav") value = item.name || "Open";
    else if (!st) value = "Not found";
    else if (isDown(st)) value = "Unavailable";
    else if (kind === "toggle") value = on ? "On" : "Off";
    else value = chipState(h, st);
    // a button or a scene's own state says little ("Press", "Scene"); its name reads better
    if ((kind === "press" || kind === "turn_on") && item.name) value = item.name;
    const name = kind === "nav" || kind === "press" || kind === "turn_on" ? "" : (item.name || "");
    text(node.__el.v, value);
    const noState = item.show_state === false && kind !== "nav";
    node.__el.v.hidden = noState;
    attr(node, "data-nostate", noState && !!name);
    attr(node, "data-icononly", noState && !name);
    text(node.__el.n, name);
    node.__el.n.hidden = !name;
    const full = item.name || st?.attributes.friendly_name || item.entity || "";
    attr(node, "title", `${full}${kind !== "nav" ? `: ${value}` : ""}`);
    attr(node, "aria-label", kind === "nav" ? value : `${full}, ${value}`);
    attr(node, "aria-pressed", kind === "toggle" ? String(on) : null);
    node.__on.to(on ? 1 : 0, MOTION.ui);
  }

  // Optimism (CARD-DESIGN.md 4): a toggle shows the result the moment it's tapped and
  // reconciles when HA reports back; a guess HA never confirms expires.
  _isOn(id, st) {
    const exp = this._expect.get(id);
    if (exp) {
      if (Date.now() > exp.until || st?.state === exp.state) this._expect.delete(id);
      else return ["on", "open", "unlocked"].includes(exp.state);
    }
    return ["on", "open", "unlocked"].includes(st?.state);
  }

  _runPill(item, kind) {
    const h = this._hass, st = item.entity ? h.states[item.entity] : null;
    let a = kind === "tap" ? this._tapAction(item) : item[`${kind}_action`] !== undefined ? legacyAction(item[`${kind}_action`], item.entity) : { action: "more-info" };
    if (!a || a.action === "none") return;
    haptic("light");
    if (a.action === "toggle") { if (st && !isDown(st)) this._toggle(item.entity); return; }
    if (item.entity && !st && a.action !== "navigate") return;
    if (st && isDown(st) && a.action !== "more-info") return;
    runAction(this, h, a, { entity: item.entity });
  }

  _toggle(id) {
    const h = this._hass, d = domainOf(id), st = h.states[id];
    if (!st || isOff(st)) return;
    const on = this._isOn(id, st);
    // lock and cover have no toggle service: say what's meant
    if (d === "lock") h.callService("lock", on ? "lock" : "unlock", {}, { entity_id: id });
    else if (d === "cover") h.callService("cover", on ? "close_cover" : "open_cover", {}, { entity_id: id });
    else toggleEntity(h, id);
    const next = d === "lock" ? (on ? "locked" : "unlocked") : d === "cover" ? (on ? "closed" : "open") : on ? "off" : "on";
    this._expect.set(id, { state: next, until: Date.now() + PREDICT_MS });
    setTimeout(() => this._update(), PREDICT_MS + 50);
    this._update();
  }

  _update() {
    const h = this._hass;
    if (!h || !this._el) return;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    this._renderMain();
    this._renderPills();
    if (this._first) { this._first = false; requestAnimationFrame(() => this._paintAll(null)); }
    this._wake();
  }

  _tickTimes() {
    const el = this._el, st = el?.main.__st;
    if (!el) return;
    const stateless = st && STATELESS.has(domainOf(st.entity_id));
    const fired = this._firedUntil && Date.now() < this._firedUntil;
    const t = !st ? NaN : stateless ? Date.parse(st.state) : Date.parse(st.last_changed);
    const show = this._config.show_since !== false && st && !fired && (stateless ? Number.isFinite(t) : !isOff(st));
    const label = show ? since(t, !stateless) : "";
    text(el.since, label);
    el.sub.hidden = el.st.hidden && !label;
    attr(el.since, "title", show && Number.isFinite(t) ? `Since ${clockTime(t, langOf(this._hass))}` : null);
    attr(el.main, "aria-label", `${el.name.textContent}, ${this._mainWord || ""}${label ? `, ${label}` : ""}`);
  }

  _paint(dirty, all, red) {
    if (all || dirty.has("main")) {
      put(this._el.main, "--on", clamp(this._mainOn.x).toFixed(3));
      put(this._el.main, "--away", clamp(this._mainAway.x).toFixed(3));
    }
    for (const [key, node] of this._pills) {
      if (!all && !dirty.has(`pill:${key}`)) continue;
      put(node, "--on", clamp(node.__on.x).toFixed(3));
      const v = clamp(node.__enter.x);
      if (!node.hasAttribute("data-off")) put(node, "opacity", v > 0.999 ? "" : v.toFixed(3));
      put(node, "translate", red || v > 0.999 ? "" : `0 ${((1 - v) * 4).toFixed(2)}px`);
    }
  }
}

// ---------- editor ----------
const EDITOR = defineEditor("savvy-entity-card", (hass, c) => [
  S.entity("entity", "Entity", null, { helper: "A person gets their picture, zone and how long they've been there." }),
  S.grid(S.text("name", "Name"), S.icon("icon", "Icon")),
  S.titleLink("name"),
  S.grid(S.color("color", "Colour"), { name: "picture", label: "Picture", helper: "A person's picture, instead of theirs in HA.", selector: { text: {} } }),
  S.grid(S.bool("show_state", "Show state", null, true), S.bool("show_since", "Show since", null, true)),
  S.nav("navigation_path", "Target page", "Empty: tapping opens more-info (or set a tap action below)."),
  S.section("Actions", [S.action("tap_action", "Tap action"), S.action("hold_action", "Hold action"), S.action("double_tap_action", "Double tap action")]),
  S.chips("chips", "Custom chips", "Entities that belong with it: a toggle toggles, a button presses, anything else shows its value."),
]);

registerCard("savvy-entity-card", SavvyEntityCard, "Entity",
  "One main entity (a person gets their picture and zone) with the entities that belong with it as chips.");
