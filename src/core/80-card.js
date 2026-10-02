// ---------------------------------------------------------------------------------------
// core/card: the frame the home, room, heading and tile cards share. Springs, the press
// feedback every tappable thing gets, spinning fan icons, and the entity-list popup, so a
// card only writes what it shows.
//
//   this._spring(value, motion, group, eps)   a spring the card's frame loop steps
//   this._pressable(el, handlers, depth)      tap / hold / double-tap with press feedback
//   this._chipActions(el, getCtx, defaults)   the same, from a chip's action config
//   this._spinner(key, el)                    a rotating icon; set .s.to(turnsPerSecond)
//   this._showList(title, ids, color, from, footer, opts)   the popup of the entities a chip stands for,
//                                              with an optional pinned page button; opts: { sort, order, toggle, storeKey, pinned }
//   _paint(dirty, all)                        the card's own painting, after the shared part
// ---------------------------------------------------------------------------------------

class SavvyCard extends HTMLElement {
  constructor() {
    super();
    watchKeyboard(this);
    this._job = (now, dt) => this._frame(now, dt);
    this._resetMotion();
  }

  _resetMotion() {
    this._springs = [];
    this._pressNodes = [];
    this._spins = new Map();
  }

  _spring(value, motion, group, eps) {
    const s = new Spring(value, motion, group, eps);
    this._springs.push(s);
    return s;
  }

  _pressable(el, handlers = {}, depth = 0.06) {
    const spring = this._spring(0, MOTION.press, `p${this._springs.length}`);
    el.__spring = spring;
    el.__depth = depth;
    this._pressNodes.push(el);
    bindPress(el, { spring, wake: () => this._wake(), ...handlers });
    return spring;
  }

  // getCtx() -> { config, entity, list }: the chip's action config and what `list` opens
  _chipActions(el, getCtx, defaults = {}, depth = 0.06) {
    const spring = this._spring(0, MOTION.press, `p${this._springs.length}`);
    el.__spring = spring;
    el.__depth = depth;
    this._pressNodes.push(el);
    bindActions(this, el, () => ({ hass: this._hass, ...getCtx() }), { spring, wake: () => this._wake(), defaults });
    return spring;
  }

  _spinner(key, el) {
    let spin = this._spins.get(key);
    if (!spin) {
      spin = { s: this._spring(0, MOTION.spin, `spin:${key}`, 1e-4), angle: 0, el };
      this._spins.set(key, spin);
    }
    spin.el = el;
    return spin;
  }

  _showList(heading, ids, color, from, footer = null, opts = {}) {
    if (!this._list) this._list = new EntityListSheet(this, { title: heading });
    this._list.sheet.setTitle(heading);
    this._list.sheet.setFooter(footer);
    this._list.color = color;
    this._list.show(this._hass, ids, from, opts);
  }

  _wake() { if (this.shadowRoot && this.isConnected) Clock.add(this._job); }

  disconnectedCallback() {
    Clock.remove(this._job);
    // popups live at page level: they go when their card does
    this._picker?.close();
    this._list?.sheet.close(true);
    this._healthSheet?.close(true);
    this._ro?.disconnect();
  }

  _frame(now, dt) {
    const dirty = new Set(), red = MQ.reduced.matches;
    for (const s of this._springs) {
      if (s.idle) continue;
      if (red) s.snap(); else s.step(dt);
      dirty.add(s.group);
    }
    for (const [key, spin] of this._spins) {
      if (spin.s.x < 1e-4) continue;
      spin.angle = (spin.angle + spin.s.x * 360 * dt) % 360;
      dirty.add(`spin:${key}`);
    }
    if (!dirty.size) return false;
    this._paintAll(dirty);
    return true;
  }

  _paintAll(dirty) {
    const all = !dirty, red = MQ.reduced.matches;
    for (const node of this._pressNodes) {
      const s = node.__spring;
      if (!s || (!all && !dirty.has(s.group))) continue;
      const p = s.x;
      put(node, "transform", red || Math.abs(p) < 1e-4 ? "" : `scale(${(1 - node.__depth * p).toFixed(4)})`);
      put(node, "opacity", Math.abs(p) > 1e-3 ? (1 - (red ? 0.25 : 0.12) * clamp(p)).toFixed(3) : "");
    }
    for (const [key, spin] of this._spins) {
      if ((!all && !dirty.has(`spin:${key}`)) || !spin.el) continue;
      put(spin.el, "transform", spin.angle ? `rotate(${spin.angle.toFixed(1)}deg)` : "");
    }
    this._paint?.(dirty, all, red);
  }
}

// The control chip's gestures, the same on every card: a select's tap opens the picker, any
// other entity's tap does what its domain does (a button presses, a switch toggles, the
// rest open more-info), hold opens more-info, and tap_action / hold_action /
// double_tap_action override all of it. `card._modeInfo()` returns the current modeInfo.
function wireModeChip(card, chip, bounds, caption) {
  card._picker = card._picker || new ModePicker(card, { onPick: (id, v) => selectOption(card._hass, id, v) });
  const run = (kind) => () => {
    const info = card._modeInfo();
    if (!info) return;
    const set = controlOf(card._config)[`${kind}_action`], ctx = { entity: info.entity };
    if (set !== undefined) { runAction(card, card._hass, set, ctx); return; }
    if (kind === "tap") {
      if (info.options.length) card._picker.open(chip, bounds(), info, caption());
      else if (info.kind === "control") runAction(card, card._hass, defaultTapAction(info.entity), ctx);
    } else if (kind === "hold") moreInfo(card, info.entity);
  };
  card._pressable(chip, { onTap: run("tap"), onHold: run("hold"), onDouble: controlOf(card._config).double_tap_action ? run("double_tap") : null });
}

// The chip's accessibility state follows what it does now: only a select has a popup.
function syncModeChip(chip, info) {
  const picker = !!info?.options?.length;
  attr(chip, "aria-haspopup", picker ? "listbox" : null);
  if (!picker) chip.removeAttribute("aria-expanded");
  else if (!chip.hasAttribute("aria-expanded")) attr(chip, "aria-expanded", "false");
}

// ---- the header and chip rows the home and room cards share

const HEADER_CSS = `
  ha-card { --mode: var(--secondary-text-color); display: flex; flex-direction: column; gap: 12px; padding: var(--pad); overflow: hidden;
    user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
  .top { display: flex; align-items: center; gap: 8px; }
  .glyph { flex: none; position: relative; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 13px;
    background: var(--well); color: var(--secondary-text-color); }
  .glyph ha-icon { --mdc-icon-size: 19px; display: flex; }
  .glyph[data-alert] { background: color-mix(in oklab, var(--ac) 18%, transparent); color: var(--ac); }
  .count { position: absolute; top: -4px; inset-inline-end: -4px; min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box;
    border-radius: 8px; background: var(--ac); color: #fff; font-size: 10.5px; line-height: 16px; font-weight: 700; text-align: center;
    box-shadow: 0 0 0 2px var(--ha-card-background, var(--card-background-color)); }
  .pill { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: flex-start; gap: 9px; height: 44px; padding: 0 13px; border-radius: 13px;
    background: color-mix(in oklab, var(--mode) 14%, transparent); color: color-mix(in oklab, var(--mode) 72%, var(--primary-text-color));
    font-size: 13.5px; line-height: 17px; font-weight: 600; letter-spacing: -0.008em; }
  .pill ha-icon { --mdc-icon-size: 18px; flex: none; display: flex; }
  .pill .col { min-width: 0; display: flex; flex-direction: column; align-items: flex-start; }
  .pill .pre { font-size: 10.5px; line-height: 13px; font-weight: 500; letter-spacing: 0.012em; color: var(--secondary-text-color); white-space: nowrap; }
  .pill .swap { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
  .pill .val { font-size: 15px; line-height: 19px; font-weight: 650; letter-spacing: -0.012em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .spacer { flex: 1; }
  /* a readout, not a panel */
  .wx { flex: none; display: flex; align-items: center; gap: 5px; height: 44px; padding: 0 12px 0 10px; border-radius: 13px;
    background: var(--well); color: var(--secondary-text-color); }
  .wx ha-icon, .wx savvy-state-icon { --mdc-icon-size: 19px; display: flex; }
  .wx .deg { font-size: 13.5px; line-height: 17px; font-weight: 650; letter-spacing: -0.012em; color: var(--primary-text-color); }
  :host([kbd]) :focus-visible { outline-color: color-mix(in oklab, var(--mode) 80%, var(--primary-text-color)); }
`;

const CHIP_ROW_CSS = `
  /* one row always: the chips share the width, and slide when there isn't enough of it */
  .chips { display: flex; gap: 8px; margin: 0 -2px; padding: 0 2px; overflow-x: auto; overscroll-behavior-x: contain; touch-action: pan-x pan-y;
    scrollbar-width: none; scroll-snap-type: x proximity; }
  .chips::-webkit-scrollbar { display: none; }
  .chips[data-overflow] { -webkit-mask-image: linear-gradient(to left, transparent 0, #000 26px); mask-image: linear-gradient(to left, transparent 0, #000 26px); }
  /* no plate: the disc carries the colour, the text sits beside it. The dim lives on .body,
     so a state's opacity and the press feedback's never fight over one node. */
  .chip { flex: none; scroll-snap-align: start; padding: 2px 4px; border-radius: 13px; text-align: start; }
  .chip .body { display: flex; align-items: center; gap: 9px; }
  .chip .disc { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%;
    background: color-mix(in oklab, var(--tc) 18%, transparent); color: var(--tc); }
  .chip .disc ha-icon, .chip .disc savvy-state-icon { --mdc-icon-size: 17px; display: flex; }
  .chip .col { display: flex; flex-direction: column; }
  .chip .v { font-size: 12.5px; line-height: 16px; font-weight: 650; letter-spacing: -0.01em; white-space: nowrap; }
  .chip .k { font-size: 10.5px; line-height: 13px; font-weight: 500; letter-spacing: 0.012em; color: var(--secondary-text-color); white-space: nowrap; }
  .chips[data-icon-only] { gap: 4px; }
  .chips[data-icon-only] .chip { padding: 2px; }
  /* navigation chips: a plate per room, no colour disc */
  .chips.nav .chip { background: var(--well); border-radius: 12px; padding: 4px 12px 4px 4px; }
  .chips.nav .chip .body { gap: 5px; }
  .chips.nav .chip .disc { width: auto; height: auto; min-width: 26px; border-radius: 0; background: none; color: var(--secondary-text-color); }
  .sep { height: 1px; margin: 1px 0; background: var(--line); }
  @media (prefers-contrast: more) { .chip .k { color: var(--primary-text-color); } }
`;

// A row of chips. items: [{ key, icon (null: the entity's state icon), stateObj, color, dim,
// value, caption, aria, spin: turns/s or 0, config (actions), entity, defaults, list() }]
SavvyCard.prototype._chipRow = function (row, items, { iconOnly = false } = {}) {
  row.__nodes = row.__nodes || new Map();
  attr(row, "data-icon-only", iconOnly);
  const seen = new Set();
  for (const item of items) {
    seen.add(item.key);
    let node = row.__nodes.get(item.key);
    const wantState = !item.icon;
    if (node && node.__state !== wantState) { node.remove(); row.__nodes.delete(item.key); node = null; }
    if (!node) {
      node = document.createElement("button");
      node.className = "chip";
      node.__state = wantState;
      node.innerHTML = `<span class="body"><span class="disc">${wantState ? "<savvy-state-icon></savvy-state-icon>" : "<ha-icon></ha-icon>"}</span>
        <span class="col"><span class="v"></span><span class="k"></span></span></span>`;
      node.__icon = node.querySelector(".disc > *");
      node.__item = item;     // bindActions reads it while wiring
      const cur = () => node.__item;
      this._chipActions(node, () => ({ config: cur().config || {}, entity: cur().entity, list: () => cur().list?.(node) }),
        { get tap() { return cur().defaults?.tap; }, get hold() { return cur().defaults?.hold; }, get double_tap() { return cur().defaults?.double_tap; } });
      row.__nodes.set(item.key, node);
    }
    node.__item = item;
    put(node, "--tc", item.color || "var(--primary-text-color)");
    put(node.querySelector(".body"), "opacity", item.dim ? (MQ.contrast.matches ? "0.7" : "0.45") : "");
    if (wantState) {
      if (node.__icon.stateObj !== item.stateObj) { node.__icon.hass = this._hass; node.__icon.stateObj = item.stateObj; }
    } else attr(node.__icon, "icon", item.icon);
    const col = node.querySelector(".col");
    col.hidden = iconOnly;
    text(node.querySelector(".v"), item.value ?? "");
    const k = node.querySelector(".k");
    k.hidden = !item.caption;
    text(k, item.caption || "");
    attr(node, "aria-label", item.aria || [item.caption, item.value].filter(Boolean).join(", "));
    if (item.spin !== undefined) {
      const spin = this._spinner(`${row.id}:${item.key}`, node.__icon);
      spin.s.to(MQ.reduced.matches ? 0 : item.spin || 0);
      if (MQ.reduced.matches) spin.s.snap();
    }
    row.appendChild(node);      // keeps the DOM in the items' order
  }
  for (const [key, node] of row.__nodes) {
    if (seen.has(key)) continue;
    node.remove();
    row.__nodes.delete(key);
    const i = this._pressNodes.indexOf(node);
    if (i >= 0) this._pressNodes.splice(i, 1);
  }
  row.hidden = !items.length;
  this._fitRow(row);
};

SavvyCard.prototype._fitRow = function (row) {
  if (row && !row.hidden) row.toggleAttribute("data-overflow", row.scrollWidth > row.clientWidth + 1);
};

// The control pill of the house and room headers: icon, value and a caption under it.
SavvyCard.prototype._renderPill = function (info, caption) {
  const el = this._el;
  el.pill.hidden = !info;
  if (!info) return;
  put(el.card, "--mode", info.color || "var(--secondary-text-color)");
  caption = modeCaption(info, caption);
  attr(el.pill, "aria-label", [caption, info.label].filter(Boolean).join(" "));
  el.pill.disabled = info.kind === "select" && !info.options.length;
  syncModeChip(el.pill, info);
  el.pre.hidden = !caption;
  text(el.pre, caption || "");
  this._swap.set(info.value);
};

// A chip from the one chip spec: { entity, name, icon, color, show_state, navigation_path,
// tap_action, hold_action, double_tap_action, spin }. The state is the value, the name
// the caption under it; with show_state: false the name alone.
function chipItem(hass, x, i) {
  const st = x.entity ? hass.states[x.entity] : null;
  const name = x.name || (st ? shortName(hass, x.entity) : x.entity ? title(x.entity.split(".")[1]) : "");
  const showState = x.show_state !== false && !!x.entity;
  const value = showState ? (st ? chipState(hass, st) : "Unavailable") : name;
  const spinning = x.spin === "climate" ? houseTemperature(hass).running.length > 0
    : x.spin === true ? climateRunning(st) || isActive(st) : false;
  return {
    key: `c${i}:${x.entity || x.name || ""}`, icon: x.icon ? x.icon : st ? null : "mdi:gesture-tap", stateObj: st, entity: x.entity,
    color: colorOf(x.color) || "var(--primary-text-color)", value, caption: showState ? name : "",
    spin: x.spin ? (spinning ? SPIN.medium : 0) : undefined,
    config: { ...x, tap_action: x.tap_action ?? (x.navigation_path ? { action: "navigate", navigation_path: x.navigation_path } : undefined) },
    defaults: { tap: x.entity ? defaultTapAction(x.entity) : null, hold: x.entity ? { action: "more-info" } : null },
  };
}
