// ---------------------------------------------------------------------------------------
// core/sheet: the popup (CARD-DESIGN.md 8). A centred panel on wide screens, a bottom sheet
// under 600px. Rendered in the card's shadow root but outside ha-card (its container-type
// would clip a fixed popup), so it carries its own colour tokens. Closes on the close
// button, a tap outside or Escape, and returns focus to whatever opened it.
// ---------------------------------------------------------------------------------------

const SHEET_CSS = `
  .sv-scrim { position: fixed; inset: 0; z-index: 998; background: rgb(0 0 0 / 0.45); opacity: 0; }
  .sv-sheet {
    --well: color-mix(in oklab, var(--primary-text-color) 6%, transparent);
    --line: color-mix(in oklab, var(--primary-text-color) 9%, transparent);
    --accent: 88 142 233;
    position: fixed; z-index: 999; box-sizing: border-box; display: flex; flex-direction: column;
    left: 50%; top: 50%; width: min(460px, calc(100vw - 32px)); max-height: min(640px, calc(100vh - 48px));
    border-radius: 22px; overflow: hidden; opacity: 0;
    background: var(--ha-card-background, var(--card-background-color, #fff)); color: var(--primary-text-color);
    box-shadow: 0 18px 50px rgb(0 0 0 / 0.35), 0 0 0 0.5px var(--line);
    font-family: var(--savvy-font-family, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", Roboto, sans-serif);
    font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased;
  }
  .sv-sheet[data-wide] { width: min(560px, calc(100vw - 32px)); max-height: min(720px, calc(100vh - 48px)); }
  @supports (corner-shape: squircle) { .sv-sheet { corner-shape: squircle; border-radius: 36px; } }
  .sv-sheet[data-bottom] { left: 0; right: 0; top: auto; bottom: 0; width: auto; max-height: 85vh;
    border-radius: 22px 22px 0 0; padding-bottom: env(safe-area-inset-bottom); }
  .sv-grab { align-self: center; width: 36px; height: 5px; border-radius: 3px; margin: 7px 0 -3px;
    background: color-mix(in oklab, var(--primary-text-color) 20%, transparent); }
  .sv-sheet:not([data-bottom]) .sv-grab { display: none; }
  .sv-head { display: flex; align-items: center; gap: 8px; padding: 14px 12px 8px 18px; }
  .sv-title { flex: 1; min-width: 0; font-size: 18px; line-height: 23px; font-weight: 650; letter-spacing: -0.022em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sv-close { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center;
    background: var(--well); --mdc-icon-size: 18px; flex: none; }
  .sv-body { overflow: auto; overscroll-behavior: contain; padding: 4px 16px 18px; display: flex; flex-direction: column;
    gap: 10px; container-type: inline-size; }

  /* the entity list: one row per entity, live */
  .sv-rows { display: flex; flex-direction: column; gap: 4px; }
  .sv-row { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 6px 8px 6px 6px; border-radius: 14px;
    cursor: pointer; }
  .sv-row:hover { background: var(--well); }
  .sv-ic { flex: none; width: 36px; height: 36px; border-radius: 11px; display: grid; place-items: center;
    background: var(--well); color: var(--secondary-text-color); --mdc-icon-size: 20px; }
  .sv-row[data-on] .sv-ic { color: var(--row-c, rgb(var(--accent))); background: color-mix(in oklab, var(--row-c, rgb(var(--accent))) 16%, transparent); }
  .sv-row[data-off] { opacity: 0.55; }
  .sv-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .sv-name { font-size: 14px; line-height: 18px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sv-sub { font-size: 12px; line-height: 16px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sv-val { flex: none; font-size: 13px; font-weight: 600; color: var(--secondary-text-color); }
  .sv-tog { flex: none; width: 44px; height: 26px; border-radius: 13px; background: var(--well); position: relative; }
  .sv-tog::after { content: ""; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%;
    background: var(--card-background-color, #fff); box-shadow: 0 1px 3px rgb(0 0 0 / 0.25); transform: translateX(var(--tx, 0px)); }
  .sv-tog[data-on] { background: var(--row-c, rgb(var(--accent))); --tx: 18px; }
  .sv-empty { padding: 18px 8px; text-align: center; font-size: 13px; color: var(--secondary-text-color); }
  .sv-group { margin: 8px 6px 2px; font-size: 11.5px; line-height: 14px; font-weight: 650; letter-spacing: 0.04em;
    text-transform: uppercase; color: var(--secondary-text-color); }
`;

const SHEET_STYLE_KEY = "__savvySheetCss";

class Sheet {
  // host: the card element (its shadow root holds the sheet). opts: { title, wide, onClose }
  constructor(host, { title: heading = "", wide = false, onClose } = {}) {
    this.host = host;
    this.onClose = onClose;
    const root = host.shadowRoot;
    if (!root[SHEET_STYLE_KEY]) {
      const style = document.createElement("style");
      style.textContent = SHEET_CSS;
      root.appendChild(style);
      root[SHEET_STYLE_KEY] = style;
    }
    this.scrim = document.createElement("div");
    this.scrim.className = "sv-scrim";
    this.el = document.createElement("div");
    this.el.className = "sv-sheet";
    this.el.toggleAttribute("data-wide", wide);
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-modal", "true");
    this.el.setAttribute("aria-label", heading);
    this.el.innerHTML = `<span class="sv-grab" aria-hidden="true"></span>
      <div class="sv-head"><span class="sv-title"></span><button class="sv-close" aria-label="Close"><ha-icon icon="mdi:close"></ha-icon></button></div>
      <div class="sv-body"></div>`;
    this.el.querySelector(".sv-title").textContent = heading;
    this.body = this.el.querySelector(".sv-body");
    this.spring = new Spring(0, MOTION.sheetIn, "sheet");
    this.job = (now, dt) => this.frame(false, dt);
    this.returnTo = null;
  }

  setTitle(t) { text(this.el.querySelector(".sv-title"), t); this.el.setAttribute("aria-label", t); }

  open(returnTo) {
    this.returnTo = returnTo || this.host.shadowRoot.activeElement || null;
    this.host.shadowRoot.append(this.scrim, this.el);
    this.place = () => this.el.toggleAttribute("data-bottom", window.innerWidth < 600);
    this.place();
    this.onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(); } };
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("resize", this.place);
    this.el.querySelector(".sv-close").addEventListener("click", (e) => { e.stopPropagation(); this.close(); });
    // a frame later, so the tap that opened it doesn't close it straight away
    requestAnimationFrame(() => this.scrim.addEventListener("pointerdown", () => this.close()));
    this.isOpen = true;
    this.closing = false;
    this.spring.snap(0).to(1, MOTION.sheetIn);
    haptic("selection");
    this.el.querySelector(".sv-close").focus({ preventScroll: true });
    this.frame(true);
    Clock.add(this.job);
    return this;
  }

  close(now = false) {
    if (!this.isOpen) return;
    this.isOpen = false;
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("resize", this.place);
    this.returnTo?.focus?.({ preventScroll: true });
    if (now || !this.host.isConnected || MQ.reduced.matches) return this.remove();
    this.closing = true;
    this.scrim.style.pointerEvents = "none";
    this.spring.to(0, MOTION.sheetOut);
    Clock.add(this.job);
  }

  remove() {
    Clock.remove(this.job);
    this.scrim.remove();
    this.el.remove();
    this.closing = false;
    this.onClose?.();
  }

  frame(force = false, dt = 1 / 60) {
    const s = this.spring;
    if (!force) { if (MQ.reduced.matches) s.snap(); else s.step(dt); }
    const v = s.x, bottom = this.el.hasAttribute("data-bottom");
    put(this.scrim, "opacity", clamp(v).toFixed(3));
    put(this.el, "opacity", clamp(v * 1.6).toFixed(3));
    put(this.el, "transform", bottom ? `translateY(${((1 - v) * 60).toFixed(2)}px)`
      : `translate(-50%, calc(-50% + ${((1 - v) * 18).toFixed(2)}px)) scale(${(0.97 + 0.03 * v).toFixed(4)})`);
    if (this.closing && v < 0.02 && s.idle) { this.remove(); return false; }
    return !s.idle;
  }
}

// The popup a group chip opens: the entities it counts, live, each with its own control.
// Row tap opens more-info; the switch on toggleable rows toggles.
class EntityListSheet {
  constructor(host, { title: heading, color } = {}) {
    this.host = host;
    this.color = color;
    this.sheet = new Sheet(host, { title: heading, onClose: () => { this.open = false; } });
    this.rows = document.createElement("div");
    this.rows.className = "sv-rows";
    this.sheet.body.appendChild(this.rows);
  }

  show(hass, ids, returnTo) {
    this.ids = ids;
    this.open = true;
    this.render(hass);
    this.sheet.open(returnTo);
  }

  // cards call this from their hass setter while it's open, so rows stay live
  render(hass) {
    if (!this.open) return;
    this.hass = hass;
    const ids = (typeof this.ids === "function" ? this.ids(hass) : this.ids) || [];
    const box = this.rows;
    box.__rows = box.__rows || new Map();
    const seen = new Set();
    if (!ids.length) {
      if (!box.__empty) { box.__empty = document.createElement("div"); box.__empty.className = "sv-empty"; box.__empty.textContent = "Nothing right now."; }
      box.appendChild(box.__empty);
    } else box.__empty?.remove();
    for (const id of ids) {
      seen.add(id);
      let row = box.__rows.get(id);
      if (!row) {
        row = document.createElement("div");
        row.className = "sv-row";
        row.setAttribute("role", "button");
        row.setAttribute("tabindex", "0");
        row.innerHTML = `<span class="sv-ic"><ha-state-icon></ha-state-icon></span>
          <span class="sv-txt"><span class="sv-name"></span><span class="sv-sub"></span></span>
          <span class="sv-val"></span><button class="sv-tog" hidden></button>`;
        row.__icon = row.querySelector("ha-state-icon");
        row.__tog = row.querySelector(".sv-tog");
        bindPress(row, { onTap: () => moreInfo(this.host, id), haptic: null });
        bindPress(row.__tog, { onTap: () => toggleEntity(this.hass, id) });
        box.__rows.set(id, row);
      }
      const st = hass.states[id];
      const on = isActive(st);
      if (this.color) put(row, "--row-c", colorOf(this.color));
      attr(row, "data-on", on);
      attr(row, "data-off", !st || isOff(st));
      if (st && row.__icon.stateObj !== st) { row.__icon.hass = hass; row.__icon.stateObj = st; }
      text(row.querySelector(".sv-name"), shortName(hass, id, null));
      const area = entityArea(hass, id);
      text(row.querySelector(".sv-sub"), area ? areaInfo(hass, area).name : "");
      const toggleable = ["light", "switch", "input_boolean", "fan", "lock", "cover", "media_player", "climate", "siren", "humidifier"].includes(domainOf(id));
      row.__tog.hidden = !toggleable || !st || isOff(st);
      attr(row.__tog, "data-on", on);
      attr(row.__tog, "aria-label", on ? "Turn off" : "Turn on");
      text(row.querySelector(".sv-val"), toggleable ? "" : stateText(hass, st));
      box.appendChild(row);   // keeps DOM order equal to the ids' order
    }
    for (const [id, row] of box.__rows) if (!seen.has(id)) { row.remove(); box.__rows.delete(id); }
  }
}
