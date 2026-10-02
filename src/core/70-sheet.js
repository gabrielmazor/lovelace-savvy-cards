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
  .sv-ic { flex: none; width: 36px; height: 36px; border-radius: 11px; display: grid; place-items: center;
    background: var(--well); color: var(--secondary-text-color); --mdc-icon-size: 20px; }
  .sv-row[data-on] .sv-ic { color: var(--row-c, rgb(var(--accent))); background: color-mix(in oklab, var(--row-c, rgb(var(--accent))) 16%, transparent); }
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
  :host([kbd]) .sv-go:focus-visible { outline: 2px solid var(--go-c, rgb(var(--accent))); outline-offset: 2px; }
  .sv-scrim { touch-action: none; }
  /* the popup's pinned page button: below the list, always in reach */
  .sv-foot { flex: none; padding: 2px 16px 16px; }
  .sv-sheet[data-bottom] .sv-foot { padding-bottom: 12px; }
  .sv-go { display: flex; align-items: center; gap: 10px; width: 100%; box-sizing: border-box; height: 48px; padding: 0 14px 0 16px;
    border: 0; margin: 0; border-radius: 14px; font: inherit; font-size: 14px; line-height: 18px; font-weight: 650; letter-spacing: -0.01em;
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
    style.textContent = SHEET_CSS + ROWS_CSS + PICKER_CSS;
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

// The popup a group chip opens: the entities it counts, live, each with the controls its kind
// needs (core/rows.js: a lock's track, a media player's transport, a climate unit's target...).
// The row's name area opens more-info; the switch on switchable rows toggles.
//   show(hass, ids, returnTo, { sort: "room" | "recent", toggle: false, storeKey, pinned: [ids] })
// sort groups the rows under room headings, or lists them by latest change; the toggle at the
// top lets the user switch, and remembers the choice per storeKey. pinned ids stay first.
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
  }

  show(hass, ids, returnTo, opts = {}) {
    this.ids = ids;
    this.opts = opts || {};
    this.sort = null;
    if (this.opts.sort) {
      this.sort = this.opts.sort;
      if (this.opts.toggle !== false && this.opts.storeKey) {
        try {
          const v = localStorage.getItem(`savvy-sort:${this.opts.storeKey}`);
          if (v === "room" || v === "recent") this.sort = v;
        } catch (err) { /* private window: the default it is */ }
      }
    }
    this.sortBar(!!this.opts.sort && this.opts.toggle !== false);
    this.open = true;
    this.render(hass);
    this.sheet.open(returnTo);
  }

  // "Room | Recent" at the top of the list
  sortBar(on) {
    if (!on) { this.sortEl?.remove(); this.sortEl = null; this.seg = null; return; }
    if (!this.sortEl) {
      this.sortEl = document.createElement("div");
      this.sortEl.className = "sv-sortbar";
      this.seg = new Seg(this.kit, { label: "Sort by", items: [{ value: "room", label: "Room", icon: "mdi:floor-plan" }, { value: "recent", label: "Recent", icon: "mdi:clock-outline" }],
        onPick: (v) => this.setSort(v) });
      this.sortEl.appendChild(this.seg.el);
      this.sheet.body.insertBefore(this.sortEl, this.rows);
    }
    this.seg.setValue(this.sort, true);
  }

  setSort(v) {
    if (v === this.sort) return;
    this.sort = v;
    this.seg?.setValue(v);
    if (this.opts.storeKey) { try { localStorage.setItem(`savvy-sort:${this.opts.storeKey}`, v); } catch (err) { /* not stored */ } }
    haptic("selection");
    this.render(this.hass);
  }

  makeRow(id) {
    const d = domainOf(id);
    const row = document.createElement("div");
    row.className = "sv-row";
    row.dataset.kind = d;
    row.dataset.id = id;
    const fan = d === "climate";
    row.innerHTML = `<div class="sv-main" role="button" tabindex="0">
        <span class="sv-ic">${fan ? '<ha-icon icon="mdi:fan"></ha-icon>' : "<ha-state-icon></ha-state-icon>"}</span>
        <span class="sv-txt"><span class="sv-name"></span><span class="sv-sub"></span></span>
        <span class="sv-val"></span><button class="sv-tog" hidden></button>
      </div><div class="sv-ctl" hidden></div>`;
    row.__main = row.querySelector(".sv-main");
    row.__ic = row.querySelector(".sv-ic");
    row.__icon = row.querySelector(".sv-ic > *");
    row.__ctlBox = row.querySelector(".sv-ctl");
    if (fan) { row.__spin = new Spring(0, MOTION.spin, "spin", 1e-4); row.__angle = 0; }
    row.__tog = row.querySelector(".sv-tog");
    row.__kit = new RowKit(() => Clock.add(this.ctlJob));
    const kind = ROW_KINDS[d];
    if (kind) {
      row.__ctl = kind.build({ id, kit: row.__kit, host: this.host, hass: () => this.hass, refresh: () => this.render(this.hass) });
      row.__ctlBox.appendChild(row.__ctl.el);
    }
    bindPress(row.__main, { onTap: () => moreInfo(this.host, id), haptic: null });
    bindPress(row.__tog, { onTap: () => toggleEntity(this.hass, id) });
    return row;
  }

  // cards call this from their hass setter while it's open, so rows stay live
  render(hass) {
    if (!this.open) return;
    this.hass = hass;
    const ids = (typeof this.ids === "function" ? this.ids(hass) : this.ids) || [];
    const box = this.rows;
    box.__rows = box.__rows || new Map();
    box.__heads = box.__heads || new Map();
    const seen = new Set(), seenHeads = new Set();
    let at = 0;
    if (!ids.length) {
      if (!box.__empty) { box.__empty = document.createElement("div"); box.__empty.className = "sv-empty"; box.__empty.textContent = "Nothing right now."; }
      box.appendChild(box.__empty);
    } else box.__empty?.remove();
    for (const item of sortRows(hass, ids, { sort: this.sort, pinned: this.opts.pinned })) {
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
        row.__spin.to(climateRunning(st) && !MQ.reduced.matches ? fanRate(st) : 0);
        if (!row.__spin.idle || row.__spin.x > 1e-4) Clock.add(this.spinJob);
      } else if (st && row.__icon && row.__icon.stateObj !== st) { row.__icon.hass = hass; row.__icon.stateObj = st; }
      text(row.querySelector(".sv-name"), shortName(hass, id, null));
      const res = (st && row.__ctl?.update(st, hass)) || {};
      this.art(row, res.art);
      const area = entityArea(hass, id);
      const t = Date.parse(st?.last_changed);
      const parts = [];
      if (res.sub) parts.push(res.sub);
      if ((this.sort === "recent" || res.timed) && Number.isFinite(t)) parts.push(since(t, false));
      if (this.sort !== "room" && area) parts.push(areaInfo(hass, area).name);
      text(row.querySelector(".sv-sub"), parts.join(" · "));
      row.__ctlBox.hidden = !res.visible;
      const switchable = TOGGLE_DOMAINS.has(d);
      row.__tog.hidden = !switchable || !st || isOff(st);
      attr(row.__tog, "data-on", on);
      attr(row.__tog, "aria-label", on ? "Turn off" : "Turn on");
      text(row.querySelector(".sv-val"), switchable || ROW_KINDS[d] ? "" : stateText(hass, st));
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
