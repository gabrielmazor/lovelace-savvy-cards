// ---------------------------------------------------------------------------------------
// core/mode: the control chip every header card shares. `control:` names any entity (a house
// mode, a room's scenes, a scene button, a switch). Its behaviour follows its domain:
//   select / input_select   tap opens a picker, one row per option, each with an icon and a
//                           colour from the mode dictionary (core/palette), overridable with
//                           mode_icons / mode_colors; hold opens more-info
//   button, script, scene   tap runs it
//   switch, input_boolean   tap toggles it
//   anything else           tap opens more-info
// tap_action / hold_action / double_tap_action override any of that, in Home Assistant's
// standard action format. It is never guessed: no `control`, no chip.
// ---------------------------------------------------------------------------------------

const SWAP_OUT = { response: 0.14, damping: 1 };
const SWAP_IN = { response: 0.32, damping: 1 };

const SELECTS = new Set(["select", "input_select"]);
const NO_STATE = new Set(["button", "input_button", "script", "scene"]);
const CONTROL_ICON = { button: "mdi:gesture-tap-button", input_button: "mdi:gesture-tap-button", script: "mdi:script-text-outline", scene: "mdi:palette-outline",
  switch: "mdi:toggle-switch-outline", input_boolean: "mdi:toggle-switch-outline", light: "mdi:lightbulb-outline" };

// `control` is an entity id, or { entity, name, icon, color, tap_action, hold_action,
// double_tap_action }; the flat control_tap_action ... keys say the same (the editor writes them).
function controlOf(cfg = {}) {
  const raw = cfg.control;
  const o = typeof raw === "string" ? { entity: raw } : { ...(raw || {}) };
  for (const k of ["name", "icon", "color", "tap_action", "hold_action", "double_tap_action"]) {
    if (o[k] === undefined && cfg[`control_${k}`] !== undefined) o[k] = cfg[`control_${k}`];
  }
  return o;
}

// Everything a card shows about its control. -> null when there's no such entity.
function modeInfo(hass, id, cfg = {}) {
  const st = id && hass.states[id];
  if (!st) return null;
  const ctl = controlOf(cfg);
  const label = (value) => {
    if (hass.formatEntityState) { try { return hass.formatEntityState(st, value); } catch (err) { /* older core */ } }
    return title(value);
  };
  if (!SELECTS.has(domainOf(id))) {
    const name = ctl.name || st.attributes.friendly_name || title(id.split(".")[1] || id);
    const d = domainOf(id), quiet = NO_STATE.has(d);
    return { entity: id, st, kind: "control", value: quiet ? id : st.state, label: quiet ? name : label(st.state), caption: quiet ? "" : name,
      icon: ctl.icon || st.attributes.icon || CONTROL_ICON[d] || "mdi:gesture-tap", color: colorOf(ctl.color) || "", options: [] };
  }
  const looks = { icons: keyed(cfg.mode_icons), colors: keyed(cfg.mode_colors) };
  const options = (st.attributes.options || []).map((o) => ({ value: o, label: label(o), ...modeLook(o, looks) }));
  return { entity: id, st, kind: "select", value: st.state, label: label(st.state), ...modeLook(st.state, looks), options };
}

// What sits under the value: a select's caption ("Home mode"), a control's own name.
const modeCaption = (info, configured) => (info?.kind === "control" ? info.caption : configured);

const selectOption = (hass, id, option) => {
  const d = domainOf(id);
  hass.callService(d === "select" ? "select" : "input_select", "select_option", { option }, { entity_id: id });
};

// A value that changes by lifting the old one away and bringing the new one in. The card
// steps `spring` with its others and calls paint() each frame.
class Swap {
  constructor(el, apply, group = "swap") {
    this.el = el;
    this.apply = apply;
    this.spring = new Spring(1, SWAP_IN, group);
    this.value = undefined;
    this.pending = undefined;
  }
  set(value) {
    if (this.value === undefined) { this.value = value; this.apply(value); return; }
    if (value === this.value) { this.pending = undefined; this.spring.to(1, SWAP_IN); return; }
    if (value === this.pending) return;
    this.pending = value;
    this.spring.to(0, SWAP_OUT);
  }
  paint(reduced) {
    if (this.pending !== undefined && this.spring.x < 0.06) {
      this.value = this.pending;
      this.pending = undefined;
      this.apply(this.value);
      this.spring.to(1, SWAP_IN);
    }
    const s = clamp(this.spring.x);
    put(this.el, "opacity", s > 0.999 ? "" : s.toFixed(3));
    put(this.el, "transform", reduced || s > 0.999 ? "" : `translateY(${((this.pending !== undefined ? -1 : 1) * (1 - s) * 4).toFixed(2)}px)`);
  }
}

const PICKER_CSS = `
  .sv-pick-scrim { position: fixed; inset: 0; z-index: 996; }
  .sv-pick {
    --line: color-mix(in oklab, var(--primary-text-color) 9%, transparent);
    position: fixed; z-index: 997; box-sizing: border-box;
    padding: 8px; border-radius: 16px;
    background: color-mix(in oklab, var(--primary-text-color) 7%, var(--card-background-color, #fff));
    color: var(--primary-text-color);
    box-shadow: 0 12px 34px rgb(0 0 0 / 0.26), 0 0 0 0.5px var(--line);
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px;
    transform-origin: var(--ox, 50%) 0; opacity: 0;
    font-family: var(--savvy-font-family, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", Roboto, sans-serif);
    -webkit-font-smoothing: antialiased; user-select: none; -webkit-user-select: none;
  }
  .sv-pick[data-wide] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .sv-pick[data-wider] { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .sv-pick[data-up] { transform-origin: var(--ox, 50%) 100%; }
  .sv-pick .cap { grid-column: 1 / -1; padding: 2px 4px 3px; font-size: 10.5px; line-height: 13px; font-weight: 650;
    letter-spacing: 0.05em; text-transform: uppercase; color: var(--secondary-text-color); opacity: 0.8; }
  .sv-opt { display: flex; align-items: center; gap: 8px; min-width: 0; height: 38px; padding: 0 10px; border-radius: 11px;
    color: var(--secondary-text-color); font: inherit; font-size: 13px; line-height: 16px; font-weight: 550; letter-spacing: -0.004em;
    background: none; border: 0; margin: 0; cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent; text-align: start; }
  .sv-opt ha-icon { --mdc-icon-size: 18px; flex: none; display: flex; color: var(--oc, var(--secondary-text-color)); }
  .sv-opt span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sv-opt[data-sel] { background: color-mix(in oklab, var(--oc, var(--primary-text-color)) 16%, transparent); color: var(--oc, var(--primary-text-color)); }
  @media (hover: hover) { .sv-opt:not([data-sel]):hover { background: color-mix(in oklab, var(--primary-text-color) 6%, transparent); } }
  :host([kbd]) .sv-opt:focus-visible { outline: 2px solid var(--oc, rgb(88 142 233)); outline-offset: 1px; }
`;

// The picker: anchored to the chip that opened it, as wide as the card, closed by a pick,
// a tap outside, Escape, or anything that moves the page.
class ModePicker {
  constructor(host, { onPick } = {}) {
    this.host = host;
    this.onPick = onPick;
    this.scrim = document.createElement("div");
    this.scrim.className = "sv-pick-scrim";
    this.el = document.createElement("div");
    this.el.className = "sv-pick";
    this.el.setAttribute("role", "listbox");
    this.el.innerHTML = `<span class="cap"></span>`;
    this.cap = this.el.firstChild;
    this.rows = new Map();
    this.spring = new Spring(0, MOTION.sheetIn, "picker", 0.002);
    this.press = [];
    this.job = (now, dt) => this.frame(dt);
    this.isOpen = false;
    guardBackdrop(this.scrim, this.el, () => this.close());
  }

  open(anchor, bounds, info, caption) {
    if (this.isOpen || !info) return;
    this.isOpen = true;
    this.anchor = anchor;
    portalRoot().append(this.scrim, this.el);
    this.render(info, caption);
    this.place(anchor, bounds);
    this.returnTo = anchor;
    this.onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(); } };
    this.onMove = () => this.close();
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("resize", this.onMove);
    attr(anchor, "aria-expanded", "true");
    this.spring.to(1, MOTION.sheetIn);
    haptic("light");
    Clock.add(this.job);
    (this.el.querySelector(".sv-opt[data-sel]") || this.el.querySelector(".sv-opt"))?.focus({ preventScroll: true });
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("resize", this.onMove);
    attr(this.anchor, "aria-expanded", "false");
    const active = portalRoot().activeElement;
    if (active && this.el.contains(active)) this.returnTo?.focus?.({ preventScroll: true });
    this.spring.to(0, MOTION.sheetOut);
    if (MQ.reduced.matches || !this.host.isConnected) { this.spring.snap(0); this.frame(0); this.scrim.remove(); }
    else Clock.add(this.job);
  }

  // Width follows the card; it opens below the chip, or above it near the bottom of the screen.
  place(anchor, bounds) {
    const a = anchor.getBoundingClientRect(), b = (bounds || anchor).getBoundingClientRect();
    const width = Math.max(200, Math.min(520, b.width - 8));
    let left = Math.max(b.left + 4, Math.min(a.left + a.width / 2 - width / 2, b.right - width - 4));
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    put(this.el, "width", `${Math.round(width)}px`);
    put(this.el, "left", `${Math.round(left)}px`);
    put(this.el, "--ox", `${Math.round(a.left + a.width / 2 - left)}px`);
    this.el.toggleAttribute("data-wide", width >= 330 && width < 450);
    this.el.toggleAttribute("data-wider", width >= 450);
    const h = this.el.getBoundingClientRect().height;
    const up = a.bottom + 6 + h > window.innerHeight - 8 && a.top - 6 - h > 8;
    this.el.toggleAttribute("data-up", up);
    put(this.el, "top", `${Math.round(up ? a.top - 6 - h : a.bottom + 6)}px`);
  }

  // live: the selection follows the entity while it's open
  render(info, caption) {
    if (!info) return this.close();
    this.info = info;
    this.cap.hidden = !caption;
    text(this.cap, caption || "");
    const keep = new Set();
    for (const o of info.options) {
      keep.add(o.value);
      let row = this.rows.get(o.value);
      if (!row) {
        row = document.createElement("button");
        row.className = "sv-opt";
        row.setAttribute("role", "option");
        row.innerHTML = "<ha-icon></ha-icon><span></span>";
        const spring = new Spring(0, MOTION.press, "pick-press");
        row.__spring = spring;
        this.press.push(row);
        bindPress(row, { spring, wake: () => Clock.add(this.job), onTap: () => this.pick(o.value), haptic: null });
        this.rows.set(o.value, row);
      }
      const sel = o.value === info.value;
      put(row, "--oc", o.color || "");
      attr(row.querySelector("ha-icon"), "icon", o.icon);
      text(row.querySelector("span"), o.label);
      attr(row, "data-sel", sel);
      attr(row, "aria-selected", sel ? "true" : "false");
      this.el.appendChild(row);
    }
    for (const [k, row] of this.rows) if (!keep.has(k)) { row.remove(); this.rows.delete(k); }
  }

  pick(value) {
    const info = this.info;
    this.close();
    if (!info || info.value === value) return;
    haptic("light");
    this.onPick?.(info.entity, value);
  }

  frame(dt) {
    const s = this.spring, red = MQ.reduced.matches;
    let busy = false;
    for (const sp of [s, ...this.press.map((r) => r.__spring)]) {
      if (sp.idle) continue;
      if (red) sp.snap(); else sp.step(dt);
      busy = true;
    }
    const v = clamp(s.x);
    put(this.el, "opacity", v.toFixed(3));
    put(this.el, "pointer-events", this.isOpen ? "auto" : "none");
    put(this.el, "transform", red ? "" : `scale(${(0.92 + 0.08 * v).toFixed(4)}) translateY(${((1 - v) * (this.el.hasAttribute("data-up") ? 6 : -6)).toFixed(2)}px)`);
    for (const row of this.press) {
      const p = row.__spring.x;
      put(row, "transform", red || Math.abs(p) < 1e-4 ? "" : `scale(${(1 - 0.05 * p).toFixed(4)})`);
    }
    // the backdrop goes with the picker, so the rest of the closing tap lands on it
    if (!this.isOpen && v < 0.01) { this.el.remove(); this.scrim.remove(); return false; }
    return busy;
  }
}
