// ---------------------------------------------------------------------------------------
// core/sheet: the popup (CARD-DESIGN.md 8). A centred panel on wide screens, a bottom sheet
// under 600px. Rendered in the card's shadow root but outside ha-card (its container-type
// would clip a fixed popup), so it carries its own colour tokens. Closes on the close
// button, a tap outside or Escape, and returns focus to whatever opened it.
// ---------------------------------------------------------------------------------------

// the rows of an entity list, in a popup and inline in a card (the cards that list entities)
const LIST_CSS = `
  /* the entity list: one row per entity, live */
  .sv-rows { display: flex; flex-direction: column; gap: 2px; }
  .sv-ic { flex: none; width: var(--b-m); height: var(--b-m); border-radius: 50%; display: grid; place-items: center;
    background: var(--well); color: var(--secondary-text-color); --mdc-icon-size: 20px; }
  .sv-row[data-on] .sv-ic { color: var(--row-c, rgb(var(--accent))); background: color-mix(in oklab, var(--row-c, rgb(var(--accent))) var(--mix-on), transparent); }
  .sv-row[data-alert] .sv-ic { color: rgb(var(--bad-rgb)); background: color-mix(in oklab, rgb(var(--bad-rgb)) var(--mix-alert), transparent); }
  .sv-row[data-alert] .sv-val { color: rgb(var(--bad-rgb)); }
  .sv-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .sv-name { font-size: 14px; line-height: 18px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sv-sub { font-size: 12px; line-height: 15px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sv-sub:empty { display: none; }
  .sv-val { flex: none; font-size: 13px; font-weight: 600; color: var(--secondary-text-color); }
  .sv-val:empty { display: none; }
  /* the switch: a 38 x 22 track and an 18 knob, 2 px of track all round, whatever the pixel ratio */
  .sv-tog { flex: none; display: block; position: relative; width: 38px; height: 22px; border-radius: 11px; background: var(--well); }
  .sv-tog-k { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; box-sizing: border-box;
    background: var(--card-background-color, #fff); box-shadow: 0 1px 3px rgb(0 0 0 / 0.25); translate: calc(var(--p, 0) * 16px) 0; }
  .sv-tog[data-on] { background: var(--row-c, rgb(var(--accent))); }
  .sv-empty { padding: 18px 8px; text-align: center; font-size: 13px; color: var(--secondary-text-color); }
  .sv-group { margin: 8px 6px 2px; font-size: 11.5px; line-height: 14px; font-weight: 650; letter-spacing: 0.04em;
    text-transform: uppercase; color: var(--secondary-text-color); }
`;
const SHEET_CSS = `
  .sv-scrim { position: fixed; inset: 0; z-index: 998; background: rgb(0 0 0 / 0.45); opacity: 0; }
  .sv-sheet {
    --well: color-mix(in oklab, var(--primary-text-color) 6%, transparent);
    --line: color-mix(in oklab, var(--primary-text-color) 9%, transparent);
    --accent: 88 142 233;
    ${DESIGN_TOKENS}
    position: fixed; z-index: 999; box-sizing: border-box; display: flex; flex-direction: column;
    left: 50%; top: 50%; width: min(460px, calc(100vw - 32px)); max-height: min(640px, calc(100vh - 48px));
    border-radius: 22px; overflow: hidden; opacity: 0;
    background: var(--ha-card-background, var(--card-background-color, #fff)); color: var(--primary-text-color);
    box-shadow: 0 18px 50px rgb(0 0 0 / 0.35), 0 0 0 0.5px var(--line);
    font-family: var(--savvy-font-family, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", Roboto, sans-serif);
    font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased;
  }
  /* a sheet that carries a state glow of its own (the health list): the same corner wash as a card, under the title too */
  .sv-sheet::before { content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit; corner-shape: inherit; pointer-events: none;
    background: radial-gradient(140% 110% at 0% 0%, rgb(var(--glow-rgb, var(--accent)) / calc(var(--glow, 0) * 0.1)), transparent 66%); }
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
  .sv-close { width: var(--c-s); height: var(--c-s); border-radius: 11px; display: grid; place-items: center;
    background: var(--well); --mdc-icon-size: 18px; flex: none; }
  .sv-body { overflow: auto; overscroll-behavior: contain; padding: 4px 16px 18px; display: flex; flex-direction: column;
    gap: 10px; container-type: inline-size; }

  ${LIST_CSS}
  :host([kbd]) .sv-go:focus-visible { outline: 2px solid var(--go-c, rgb(var(--accent))); outline-offset: 2px; }
  .sv-scrim { touch-action: none; }
  /* the popup's pinned page button: below the list, always in reach */
  .sv-foot { flex: none; padding: 2px 16px 16px; }
  .sv-sheet[data-bottom] .sv-foot { padding-bottom: 12px; }
  .sv-go { display: flex; align-items: center; gap: 10px; width: 100%; box-sizing: border-box; height: var(--c-l); padding: 0 14px 0 16px;
    border: 0; margin: 0; border-radius: 13px; font: inherit; font-size: 14px; line-height: 18px; font-weight: 650; letter-spacing: -0.01em;
    text-align: start; cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent;
    color: var(--go-c, rgb(var(--accent))); background: color-mix(in oklab, var(--go-c, rgb(var(--accent))) 15%, transparent); }
  .sv-go span { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sv-go ha-icon { --mdc-icon-size: 20px; flex: none; display: flex; }
  @media (hover: hover) { .sv-go:hover { background: color-mix(in oklab, var(--go-c, rgb(var(--accent))) 22%, transparent); } }
  @media (prefers-contrast: more) { .sv-go { box-shadow: inset 0 0 0 1.5px currentColor; } }
  /* the home card's health list, inside a popup */
  .sv-sheet savvy-system-health-card { --ha-card-border-width: 0px; --ha-card-background: transparent; --ha-card-box-shadow: none; margin: -14px -14px 0; }
`;

// Popups live in one layer at the top of the page, not inside the card: dashboards wrap
// cards in containers (transforms, containment) that would clip a "full screen" layer to
// the card, so a tap or scroll outside the popup would reach the page instead of closing it.
let portalEl = null;
function portalRoot() {
  if (!portalEl || !portalEl.isConnected) {
    portalEl = document.createElement("div");
    portalEl.className = "savvy-portal";
    const root = portalEl.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = ROLL_CSS + SHEET_CSS + ROWS_CSS + PICKER_CSS;
    root.appendChild(style);
    watchKeyboard(portalEl);
    document.body.appendChild(portalEl);
  }
  return portalEl.shadowRoot;
}

// While a popup is open the page underneath stays put: a press on the backdrop closes it
// (and goes no further), a scroll on the backdrop closes it without scrolling, and a
// scroll inside the popup never carries on into the page.
function guardBackdrop(scrim, panel, close, bodySel = ".sv-body") {
  const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };
  scrim.addEventListener("pointerdown", (e) => { swallow(e); close(); });
  for (const t of ["click", "pointerup", "contextmenu"]) scrim.addEventListener(t, swallow);
  for (const t of ["wheel", "touchmove"]) scrim.addEventListener(t, (e) => { swallow(e); close(); }, { passive: false });
  const stuck = (e) => {
    const box = e.composedPath().find((n) => n.matches?.(bodySel));
    if (!box || box.scrollHeight <= box.clientHeight + 1) { e.preventDefault(); return; }
    // at an end, a wheel that would go further is kept in
    if (e.type === "wheel" && ((e.deltaY < 0 && box.scrollTop <= 0) || (e.deltaY > 0 && box.scrollTop + box.clientHeight >= box.scrollHeight - 1))) e.preventDefault();
  };
  panel.addEventListener("wheel", stuck, { passive: false });
  panel.addEventListener("touchmove", stuck, { passive: false });
}

class Sheet {
  // host: the card element (its shadow root holds the sheet). opts: { title, wide, onClose }
  constructor(host, { title: heading = "", wide = false, onClose } = {}) {
    this.host = host;
    this.onClose = onClose;
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
    guardBackdrop(this.scrim, this.el, () => this.close());
    this.el.querySelector(".sv-close").addEventListener("click", (e) => { e.stopPropagation(); this.close(); });
  }

  setTitle(t) { text(this.el.querySelector(".sv-title"), t); this.el.setAttribute("aria-label", t); }

  // A button pinned under the body: { label, onTap, icon?, color? }, or null for none. A tap
  // closes the popup first, then runs onTap (a page change, say).
  setFooter(spec) {
    this.foot?.remove();
    this.foot = null;
    this.footSpring = null;
    if (!spec) return;
    const foot = document.createElement("div");
    foot.className = "sv-foot";
    const go = document.createElement("button");
    go.className = "sv-go";
    go.innerHTML = '<ha-icon></ha-icon><span></span><ha-icon icon="mdi:chevron-right"></ha-icon>';
    attr(go.firstElementChild, "icon", spec.icon || "mdi:arrow-top-right");
    text(go.querySelector("span"), spec.label);
    if (spec.color) put(go, "--go-c", spec.color);
    this.footSpring = new Spring(0, MOTION.press, "foot");
    go.__spring = this.footSpring;
    bindPress(go, { spring: this.footSpring, wake: () => Clock.add(this.job), onTap: () => { this.close(); spec.onTap(); } });
    foot.appendChild(go);
    this.el.appendChild(foot);
    this.foot = foot;
  }

  open(returnTo) {
    this.returnTo = returnTo || this.host.shadowRoot?.activeElement || null;
    portalRoot().append(this.scrim, this.el);
    this.place = () => this.el.toggleAttribute("data-bottom", window.innerWidth < 600);
    this.place();
    this.onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(); } };
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("resize", this.place);
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
    // the backdrop stays until the popup has gone: the rest of that tap lands on it
    this.closing = true;
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
    let busy = !s.idle;
    const f = this.footSpring;
    if (f && !f.idle) {
      if (MQ.reduced.matches) f.snap(); else f.step(dt);
      const go = this.foot?.firstElementChild;
      if (go) {
        put(go, "transform", MQ.reduced.matches || Math.abs(f.x) < 1e-4 ? "" : `scale(${(1 - 0.03 * f.x).toFixed(4)})`);
        put(go, "opacity", Math.abs(f.x) > 1e-3 ? (1 - 0.1 * clamp(f.x)).toFixed(3) : "");
      }
      busy = true;
    }
    if (this.closing && v < 0.02) { this.remove(); return false; }     // gone: the backdrop goes too
    return busy;
  }
}

// The popup a group chip opens: the entities it counts, live. Each row is one line: the entity,
// its main control on the right (a switch, play / pause, a target stepper...) and, when it has
// more, a chevron that opens one extra line (core/rows.js says what each kind puts where). One
// extra line is open at a time. The row's name area opens more-info.
//   show(hass, ids, returnTo, { sort: "room" | "recent", order: [area ids], toggle: false, storeKey, pinned: [ids], bulk: "lights" | ... | "auto" })
// sort groups the rows under room headings, or lists them by latest change; the toggle at the
// top lets the user switch, and remembers the choice per storeKey. pinned ids stay first. bulk
// puts a button next to the toggle that acts on exactly the listed entities (All off, Pause all, Lock all).
class EntityListSheet {
  constructor(host, { title: heading, color } = {}) {
    this.host = host;
    this.color = color;
    this.sheet = new Sheet(host, { title: heading, onClose: () => { this.open = false; } });
    this.kit = new RowKit(() => Clock.add(this.ctlJob));
    this.ctlJob = (now, dt) => {
      if (!this.open) return false;
      let busy = this.kit.step(dt);
      for (const row of this.rows.__rows?.values() || []) if (row.__kit.step(dt)) busy = true;
      return busy;
    };
    // A/C rows show a fan that turns while the unit runs
    this.spinJob = (now, dt) => {
      if (!this.open) return false;
      let busy = false;
      for (const row of this.rows.__rows?.values() || []) {
        const sp = row.__spin;
        if (!sp) continue;
        if (!sp.idle) { if (MQ.reduced.matches) sp.snap(); else sp.step(dt); }
        if (sp.x > 1e-4) {
          row.__angle = (row.__angle + sp.x * 360 * dt) % 360;
          busy = true;
        }
        // a fan that winds down stops where it is, never jumps back
        put(row.__icon, "transform", row.__angle ? `rotate(${row.__angle.toFixed(1)}deg)` : "");
        if (!sp.idle) busy = true;
      }
      return busy;
    };
    this.rows = document.createElement("div");
    this.rows.className = "sv-rows";
    this.sheet.body.appendChild(this.rows);
    this.opts = {};
    this.sort = null;
    this.openId = null;
    this.curIds = [];
  }

  show(hass, ids, returnTo, opts = {}) {
    this.ids = ids;
    this.opts = opts || {};
    this.sort = null;
    this.openId = null;
    for (const row of this.rows.__rows?.values() || []) { row.__exp.snap(0); row.__chev && attr(row.__chev, "aria-expanded", "false"); attr(row, "data-open", false); }
    if (this.opts.sort) {
      this.sort = this.opts.sort;
      if (this.opts.toggle !== false && this.opts.storeKey) {
        try {
          const v = localStorage.getItem(`savvy-sort:${this.opts.storeKey}`);
          if (v === "room" || v === "recent") this.sort = v;
        } catch (err) { /* private window: the default it is */ }
      }
    }
    this.tools(!!this.opts.sort && this.opts.toggle !== false, !!this.opts.bulk);
    this.open = true;
    this.render(hass);
    this.sheet.open(returnTo);
  }

  // the top of the list: "Room | Recent", and the bulk action beside it
  tools(wantSort, wantBulk) {
    if (!wantSort && !wantBulk) { if (this.toolsEl) this.toolsEl.hidden = true; return; }
    if (!this.toolsEl) {
      this.toolsEl = document.createElement("div");
      this.toolsEl.className = "sv-tools";
      this.sheet.body.insertBefore(this.toolsEl, this.rows);
    }
    this.toolsEl.hidden = false;
    attr(this.toolsEl, "data-solo", !wantSort);
    if (wantSort && !this.seg) {
      this.seg = new Seg(this.kit, { label: "Sort by", items: [{ value: "room", label: "Room", icon: "mdi:floor-plan" }, { value: "recent", label: "Recent", icon: "mdi:clock-outline" }],
        onPick: (v) => this.setSort(v) });
      this.toolsEl.prepend(this.seg.el);
    }
    if (this.seg) { this.seg.el.hidden = !wantSort; if (wantSort) this.seg.setValue(this.sort, true); }
    if (wantBulk && !this.bulkBtn) {
      const b = this.bulkBtn = document.createElement("button");
      b.className = "sv-bulk";
      b.innerHTML = "<ha-icon></ha-icon><span></span>";
      this.kit.press(b, () => this.runBulk(), { depth: 0.06, haptic: "medium" });
      this.toolsEl.appendChild(b);
    }
    if (this.bulkBtn) this.bulkBtn.hidden = !wantBulk;
  }

  bulkKind() {
    const b = this.opts.bulk;
    if (!b) return null;
    return b === "auto" ? bulkKindOf(this.curIds) : BULK[b] ? b : null;
  }

  runBulk() {
    const kind = this.bulkKind();
    if (!kind) return;
    const targets = bulkTargets(kind, this.curIds, this.hass);
    if (!targets.length) return;
    this.hass.callService(BULK[kind].domain, BULK[kind].service, {}, { entity_id: targets });
  }

  syncBulk() {
    const b = this.bulkBtn;
    if (!b || b.hidden) return;
    const kind = this.bulkKind();
    b.hidden = !kind;
    if (!kind) return;
    const targets = bulkTargets(kind, this.curIds, this.hass);
    text(b.querySelector("span"), BULK[kind].label);
    attr(b.querySelector("ha-icon"), "icon", BULK[kind].icon);
    attr(b, "disabled", !targets.length);
    attr(b, "aria-label", `${BULK[kind].label}${targets.length ? `, ${targets.length}` : ""}`);
  }

  setSort(v) {
    if (v === this.sort) return;
    this.sort = v;
    this.seg?.setValue(v);
    if (this.opts.storeKey) { try { localStorage.setItem(`savvy-sort:${this.opts.storeKey}`, v); } catch (err) { /* not stored */ } }
    haptic("selection");
    this.render(this.hass);
  }

  // one extra line open at a time
  toggleRow(id) {
    this.openId = this.openId === id ? null : id;
    for (const [rid, row] of this.rows.__rows || []) this.syncOpen(rid, row);
    haptic("selection");
    Clock.add(this.ctlJob);
    const row = this.rows.__rows?.get(this.openId);
    if (row) setTimeout(() => row.scrollIntoView?.({ block: "nearest", behavior: MQ.reduced.matches ? "auto" : "smooth" }), 120);
  }

  syncOpen(id, row) {
    const open = this.openId === id && row.__hasExtra && !row.__fixed;
    row.__exp.to(open ? 1 : 0, MOTION.ui);
    attr(row.__chev, "aria-expanded", String(open));
    attr(row.__chev, "aria-label", open ? "Fewer controls" : "More controls");
    attr(row, "data-open", open);
  }

  // the extra line's height and the chevron, from the row's spring
  paintOpen(row) {
    if (row.__fixed) return false;
    const sp = row.__exp, p = clamp(sp.x);
    const show = row.__hasExtra && (sp.target === 1 || p > 0.001);
    if (row.__ctl.hidden === show) row.__ctl.hidden = !show;
    if (show) {
      const settled = sp.idle && sp.target === 1;
      put(row.__ctl, "height", settled ? "" : `${(p * row.__ctlIn.offsetHeight).toFixed(1)}px`);
      put(row.__ctl, "opacity", p.toFixed(3));
    }
    attr(row.__ctl, "inert", !(sp.target === 1));
    put(row.__chev, "transform", p > 0.001 ? `rotate(${(180 * p).toFixed(1)}deg)` : "");
    return !sp.idle;
  }

  makeRow(id) {
    const d = domainOf(id);
    const row = document.createElement("div");
    row.className = "sv-row";
    row.dataset.kind = d;
    row.dataset.id = id;
    const fan = d === "climate", spins = fan || d === "fan";
    row.innerHTML = `<div class="sv-line1">
        <div class="sv-main" role="button" tabindex="0">
          <span class="sv-ic">${fan ? '<ha-icon icon="mdi:fan"></ha-icon>' : "<savvy-state-icon></savvy-state-icon>"}</span>
          <span class="sv-txt"><span class="sv-name"></span><span class="sv-sub"></span></span>
        </div>
        <span class="sv-val"></span>
        <div class="sv-act"><button class="sv-tog" hidden><i class="sv-tog-k"></i></button></div>
        <button class="sv-chev" data-none aria-expanded="false" aria-label="More controls"><ha-icon icon="mdi:chevron-down"></ha-icon></button>
      </div>
      <div class="sv-ctl" hidden><div class="sv-ctl-in"></div></div>`;
    row.__main = row.querySelector(".sv-main");
    row.__ic = row.querySelector(".sv-ic");
    row.__icon = row.querySelector(".sv-ic > *");
    row.__act = row.querySelector(".sv-act");
    row.__ctl = row.querySelector(".sv-ctl");
    row.__ctlIn = row.querySelector(".sv-ctl-in");
    row.__chev = row.querySelector(".sv-chev");
    row.__tog = row.querySelector(".sv-tog");
    if (spins) { row.__spin = new Spring(0, MOTION.spin, "spin", 1e-4); row.__angle = 0; }
    row.__kit = new RowKit(() => Clock.add(this.ctlJob));
    row.__exp = row.__kit.spring(0, MOTION.ui, 0.002);
    row.__kit.paints.push(() => this.paintOpen(row));
    const kind = ROW_KINDS[d];
    if (kind) {
      row.__ctrl = kind.build({ id, kit: row.__kit, host: this.host, hass: () => this.hass, opts: () => this.opts, refresh: () => this.render(this.hass),
        row, line: row.querySelector(".sv-line1"), handle: row.querySelector(".sv-ic"), text: row.querySelector(".sv-txt") });
      row.__fixed = !!row.__ctrl.fixed;
      if (row.__ctrl.main) row.__act.appendChild(row.__ctrl.main);
      if (row.__ctrl.extra) row.__ctlIn.appendChild(row.__ctrl.extra);
    }
    bindPress(row.__main, { onTap: () => moreInfo(this.host, id), haptic: null });
    bindPress(row.__tog, { onTap: () => toggleEntity(this.hass, id) });
    row.__kit.press(row.__chev, () => this.toggleRow(id), { depth: 0.1, haptic: null });
    return row;
  }

  // cards call this from their hass setter while it's open, so rows stay live
  render(hass) {
    if (!this.open) return;
    Motion.flip(this.rows, () => this.renderNow(hass));
  }

  renderNow(hass) {
    this.hass = hass;
    const ids = (typeof this.ids === "function" ? this.ids(hass) : this.ids) || [];
    this.curIds = ids;
    this.syncBulk();
    const box = this.rows;
    box.__rows = box.__rows || new Map();
    box.__heads = box.__heads || new Map();
    const seen = new Set(), seenHeads = new Set();
    let at = 0;
    if (!ids.length) {
      if (!box.__empty) { box.__empty = document.createElement("div"); box.__empty.className = "sv-empty"; box.__empty.textContent = "Nothing right now."; }
      box.appendChild(box.__empty);
    } else box.__empty?.remove();
    for (const item of sortRows(hass, ids, { sort: this.sort, pinned: this.opts.pinned, order: this.opts.order })) {
      if (item.head) {
        let head = box.__heads.get(item.head.key);
        if (!head) { head = document.createElement("div"); head.className = "sv-group"; box.__heads.set(item.head.key, head); }
        text(head, item.head.label);
        seenHeads.add(item.head.key);
        place(box, head, at++);
        continue;
      }
      const id = item.id;
      seen.add(id);
      let row = box.__rows.get(id);
      if (!row) { row = this.makeRow(id); box.__rows.set(id, row); }
      const d = domainOf(id), st = hass.states[id];
      const on = isActive(st);
      if (this.color) put(row, "--row-c", colorOf(this.color));
      attr(row, "data-on", on);
      attr(row, "data-off", !st || isOff(st));
      attr(row.__main, "data-on", on);
      if (row.__spin) {
        // an A/C's fan turns while the unit runs, a fan's own icon while it is on
        const turning = d === "fan" ? !!st && st.state === "on" : climateRunning(st);
        row.__spin.to(turning && !MQ.reduced.matches ? (d === "fan" ? fanSpeedRate(st) : fanRate(st)) : 0);
        if (!row.__spin.idle || row.__spin.x > 1e-4) Clock.add(this.spinJob);
      }
      // a card can give an entity its own icon and name (opts.icons / opts.names)
      let shown = st;
      const own = this.opts.icons?.[id];
      if (own && st) {
        if (row.__ovFor !== st || row.__ovIcon !== own) { row.__ov = { ...st, attributes: { ...st.attributes, icon: own } }; row.__ovFor = st; row.__ovIcon = own; }
        shown = row.__ov;
      }
      if (d !== "climate" && shown && row.__icon && row.__icon.stateObj !== shown) { row.__icon.hass = hass; row.__icon.stateObj = shown; }
      text(row.querySelector(".sv-name"), this.opts.names?.[id] || shortName(hass, id, null));
      const res = (st && row.__ctrl?.update(st, hass)) || {};
      attr(row, "data-alert", !!res.alert);
      this.art(row, res.art);
      const area = entityArea(hass, id);
      const t = Date.parse(st?.last_changed);
      const parts = [];
      if (res.sub) parts.push(res.sub);
      if ((this.sort === "recent" || res.timed) && Number.isFinite(t)) parts.push(since(t, false));
      if (this.sort !== "room" && area && !this.opts.hideArea) parts.push(areaInfo(hass, area).name);
      text(row.querySelector(".sv-sub"), parts.join(" · "));
      // the extra line: always there for a lock's track, else behind the chevron
      row.__hasExtra = !!res.extra;
      if (row.__fixed) {
        row.__ctl.hidden = !res.extra;
        put(row.__ctl, "height", "");
        put(row.__ctl, "opacity", "");
        attr(row.__chev, "data-none", true);
      } else {
        if (this.openId === id && !res.extra) this.openId = null;
        attr(row.__chev, "data-none", !res.extra);
        this.syncOpen(id, row);
      }
      const switchable = TOGGLE_DOMAINS.has(d);
      row.__tog.hidden = !switchable || !st || isOff(st);
      attr(row.__tog, "data-on", on);
      Motion.tweenVar(row.__tog, "--p", on ? 1 : 0);
      attr(row.__tog, "aria-label", on ? "Turn off" : "Turn on");
      text(row.querySelector(".sv-val"), res.val || (switchable || ROW_KINDS[d] ? "" : stateText(hass, st)));
      place(box, row, at++);   // keeps DOM order equal to the order
    }
    for (const [id, row] of box.__rows) if (!seen.has(id)) { row.__kit.dispose(); row.remove(); box.__rows.delete(id); }
    for (const [key, head] of box.__heads) if (!seenHeads.has(key)) { head.remove(); box.__heads.delete(key); }
    Clock.add(this.ctlJob);
  }

  // what's playing replaces the icon in its tile
  art(row, url) {
    let img = row.__art;
    if (!url) { if (img) img.hidden = true; attr(row.__ic, "data-art", false); if (row.__icon) row.__icon.hidden = false; return; }
    if (!img) { img = row.__art = document.createElement("img"); img.className = "sv-art"; img.alt = ""; row.__ic.appendChild(img); }
    if (img.__src !== url) { img.__src = url; img.src = url; }
    img.hidden = false;
    attr(row.__ic, "data-art", true);
    row.__icon.hidden = true;
  }
}
