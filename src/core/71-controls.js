// ---------------------------------------------------------------------------------------
// core/controls: the small controls a popup row is built from (CARD-DESIGN.md 3): press
// buttons, a bar that only moves on a sideways drag, a segmented control, a - / + stepper
// and the lock slide. Each one owns its springs through a RowKit, which the popup's clock
// job steps and paints, so a row never needs its own animation loop.
// ---------------------------------------------------------------------------------------

const CTL_PREDICT_MS = 1500;   // an optimistic value waits this long for HA to agree
const CTL_WRITE_MS = 140;      // a drag sends at most this often; the release always lands
const LOCK_END = 0.96;         // where the finger's travel counts as the end of the track
const LOCK_HOLD_MS = 500;      // how long the end of the lock track must be held to open
const LOCK_COLORS = [[76, 175, 80], [232, 163, 61], [224, 102, 102]];   // locked, unlocked, open
const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

// The lock handle's stylesheet, shared by the popup rows and the lock card: the lock's own icon is the
// handle, its row the track.
const LOCK_SLIDE_CSS = `/* the lock slide: the icon is the handle, the row is the track */
  .sv-sl { position: relative; --lk: 76 175 80; --gh: 0; }
  .sv-sl-ov { position: absolute; inset: 0; border-radius: inherit; overflow: hidden; pointer-events: none; z-index: 0; }
  .sv-sl-ov::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: rgb(var(--lk) / 0.1); opacity: var(--gh);
    box-shadow: inset 0 0 0 1px rgb(var(--lk) / 0.32); }
  .sv-sl-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: rgb(var(--lk) / 0.24); opacity: var(--gh); }
  .sv-sl[data-rtl] .sv-sl-fill { left: auto; right: 0; }
  .sv-sl-g { position: absolute; top: 0; bottom: 0; display: flex; align-items: center; font-size: 12px; line-height: 16px; font-weight: 650; letter-spacing: -0.004em;
    color: rgb(var(--lk)); opacity: var(--gh); white-space: nowrap; }
  .sv-sl-hint { position: absolute; top: 0; bottom: 0; inset-inline-end: 12px; display: flex; align-items: center; color: rgb(var(--lk)); --mdc-icon-size: 18px;
    opacity: calc(0.5 * (1 - var(--gh))); pointer-events: none; }
  .sv-sl-hint[data-inline] { position: static; flex: none; margin-inline-start: auto; }
  .sv-sl-hint ha-icon { display: flex; }
  .sv-sl-fade { opacity: calc(1 - var(--gh) * 0.92); }
  .sv-sl[aria-disabled="true"] .sv-sl-hint { display: none; }
  .sv-sl-handle { position: relative; z-index: 3; touch-action: pan-y; cursor: grab; user-select: none; -webkit-user-select: none; will-change: transform; outline: none; --ring: 0; --breath: 0; --cov: 0; }
  .sv-sl[data-drag] .sv-sl-handle { cursor: grabbing; }
  .sv-sl-handle::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: rgb(var(--lk)); opacity: var(--cov);
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.3); pointer-events: none; }
  .sv-sl-handle::after { content: ""; position: absolute; inset: -4px; border-radius: inherit; border: 2px solid rgb(var(--lk)); opacity: calc(var(--breath) * 0.7);
    transform: scale(calc(1 + var(--breath) * 0.18)); pointer-events: none; }
  .sv-sl-handle > :not(.sv-sl-ring):not(.sv-sl-ic) { opacity: calc(1 - var(--cov)); }
  .sv-sl-ic { position: absolute; inset: 0; display: grid; place-items: center; color: #fff; opacity: var(--cov); pointer-events: none; }
  .sv-sl-ic ha-icon { position: absolute; display: flex; }
  .sv-sl-ring { position: absolute; inset: -4px; width: calc(100% + 8px); height: calc(100% + 8px); transform: rotate(-90deg); opacity: var(--ring); pointer-events: none; }
  .sv-sl-ring circle { fill: none; stroke: #fff; stroke-width: 3; stroke-linecap: round; stroke-dasharray: 125.7; stroke-dashoffset: 125.7; }
  .sv-sl[data-armed] .sv-sl-handle::before { box-shadow: 0 0 0 4px rgb(var(--lk) / 0.35), 0 2px 8px rgb(0 0 0 / 0.3); }
  .sv-sl[data-bad] { --lk: 224 102 102 !important; }
  @media (prefers-contrast: more) { .sv-sl-ov::before { box-shadow: inset 0 0 0 1.5px rgb(var(--lk)); } }`;

// The springs and press feedback of one row's controls.
class RowKit {
  constructor(wake) {
    this.wake = wake;
    this.springs = [];
    this.presses = [];
    this.paints = [];
  }
  spring(value, motion, eps) {
    const s = new Spring(value, motion, "k", eps);
    this.springs.push(s);
    return s;
  }
  // tap (and optionally hold) with the shared press feedback
  press(el, onTap, { onHold, depth = 0.08, haptic: tap = "light" } = {}) {
    const spring = this.spring(0, MOTION.press);
    el.__spring = spring;
    el.__depth = depth;
    this.presses.push(el);
    bindPress(el, { spring, wake: this.wake, onTap, onHold, haptic: tap });
    return spring;
  }
  // steps every spring and paints; true while something still moves
  step(dt) {
    const red = MQ.reduced.matches;
    let busy = false;
    for (const s of this.springs) {
      if (s.idle) continue;
      if (red) s.snap(); else s.step(dt);
      if (!s.idle) busy = true;
    }
    for (const el of this.presses) {
      const p = el.__spring.x;
      put(el, "transform", red || Math.abs(p) < 1e-4 ? "" : `scale(${(1 - el.__depth * p).toFixed(4)})`);
      put(el, "opacity", Math.abs(p) > 1e-3 ? (1 - (red ? 0.25 : 0.12) * clamp(p)).toFixed(3) : "");
    }
    for (const paint of this.paints) if (paint(dt)) busy = true;
    return busy;
  }
  // a row that goes away takes its timers with it
  dispose() { for (const fn of this.disposers || []) fn(); }
  onDispose(fn) { (this.disposers || (this.disposers = [])).push(fn); }
}

// A round icon button: transport, power, mute, the - and + of a stepper.
function iconButton(kit, { icon, label, onTap, solid = false, cls = "" }) {
  const btn = document.createElement("button");
  btn.className = `sv-btn ${cls}`.trim();
  if (solid) btn.dataset.solid = "";
  btn.innerHTML = "<ha-icon></ha-icon>";
  btn.__icon = btn.firstElementChild;
  attr(btn.__icon, "icon", icon);
  attr(btn, "aria-label", label);
  kit.press(btn, onTap, { depth: solid ? 0.06 : 0.1 });
  btn.setIcon = (name) => attr(btn.__icon, "icon", name);
  return btn;
}

// A bar that only moves once a drag is clearly sideways, so a press, or a finger on its way
// to scrolling the page, never changes anything; then the level follows the finger 1:1 from
// where it was (CARD-DESIGN.md 3.1). onChange(level 0..1, final).
class SideBar {
  constructor(kit, { label, onChange, step = 0.05 }) {
    this.kit = kit;
    this.onChange = onChange;
    this.step = step;
    const el = this.el = document.createElement("div");
    el.className = "sv-bar";
    el.setAttribute("role", "slider");
    el.tabIndex = 0;
    el.setAttribute("aria-label", label);
    el.setAttribute("aria-valuemin", "0");
    el.setAttribute("aria-valuemax", "100");
    el.innerHTML = '<span class="sv-bar-fill"></span>';
    this.fill = el.firstElementChild;
    this.value = kit.spring(0, MOTION.value, 0.002);
    this.grab = kit.spring(0, { response: 0.4, damping: 1 });
    this.level = 0;
    this.pending = null;
    this.pendingAt = 0;
    this.dragging = false;
    this.queued = null;
    this.timer = 0;
    this.last = 0;
    kit.paints.push(() => this.paint());
    kit.onDispose(() => { clearTimeout(this.timer); clearTimeout(this.expiry); });
    this.wire();
  }

  paint() {
    put(this.fill, "transform", `scaleX(${clamp(this.value.x).toFixed(4)})`);
    put(this.el, "--grab", clamp(this.grab.x).toFixed(3));
    return false;
  }

  // Home Assistant's level; a guess of our own holds until it agrees or expires
  setLevel(v, snap = false) {
    this.level = v;
    attr(this.el, "aria-valuenow", String(Math.round(v * 100)));
    if (this.dragging) return;
    if (this.pending != null && (Math.abs(this.pending - v) < 0.02 || Date.now() - this.pendingAt > CTL_PREDICT_MS)) this.pending = null;
    if (this.pending != null) return;
    if (snap) this.value.snap(v); else this.value.to(v);
    this.kit.wake();
  }

  guess(v) {
    this.pending = v;
    this.pendingAt = Date.now();
    clearTimeout(this.expiry);
    this.expiry = setTimeout(() => { this.pending = null; this.value.to(this.level); this.kit.wake(); }, CTL_PREDICT_MS + 50);
  }

  send(v, throttle) {
    this.queued = v;
    if (throttle) {
      if (this.timer) return;
      this.timer = setTimeout(() => { this.timer = 0; this.flush(); }, CTL_WRITE_MS);
      return;
    }
    clearTimeout(this.timer);
    this.timer = 0;
    this.flush();
  }
  flush() {
    if (this.queued == null) return;
    const v = this.queued;
    this.queued = null;
    this.onChange(v);
  }

  nudge(d) {
    const v = clamp((this.pending ?? this.value.target) + d * this.step);
    this.guess(v);
    this.value.to(v);
    haptic("selection");
    this.send(v, false);
    this.kit.wake();
  }

  wire() {
    const el = this.el;
    let id = null, x0 = 0, y0 = 0, xs = 0, from = 0, live = false;
    const at = (x) => clamp(from + (x - xs) / Math.max(1, el.getBoundingClientRect().width));
    el.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      e.stopPropagation();
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; live = false;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* already lifted */ }
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerId !== id) return;
      if (!e.buttons && e.pointerType === "mouse") { id = null; return; }
      if (!live) {
        const dx = e.clientX - x0, dy = e.clientY - y0;
        if (Math.hypot(dx, dy) < SLOP) return;
        if (Math.abs(dy) >= Math.abs(dx)) { id = null; return; }   // vertical: the page scrolls
        live = true;
        this.dragging = true;
        this.grab.to(1);
        xs = e.clientX;
        from = clamp(this.pending ?? this.value.x);
        this.last = Math.round(from * 10);
      }
      const v = at(e.clientX);
      this.value.snap(v);
      this.guess(v);
      const notch = Math.round(v * 10);
      if (notch !== this.last) { this.last = notch; haptic("selection"); }
      this.send(v, true);
      this.kit.wake();
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      if (!live) return;
      live = false;
      this.dragging = false;
      this.grab.to(0);
      this.send(this.value.x, false);
      this.kit.wake();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("click", (e) => e.stopPropagation());
    el.addEventListener("keydown", (e) => {
      const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      this.nudge(d);
    });
  }
}

// A segmented control: equal segments and a pill that slides between them on a spring.
// items: [{ value, label, icon }]; setValue(null) leaves none picked.
class Seg {
  constructor(kit, { items, label, onPick }) {
    this.kit = kit;
    this.items = items;
    this.onPick = onPick;
    const el = this.el = document.createElement("div");
    el.className = "sv-seg";
    el.setAttribute("role", "radiogroup");
    el.setAttribute("aria-label", label);
    el.style.setProperty("--n", String(items.length));
    el.innerHTML = '<span class="sv-seg-pill"></span>';
    this.pill = el.firstElementChild;
    this.buttons = items.map((it, i) => {
      const b = document.createElement("button");
      b.className = "sv-seg-b";
      b.setAttribute("role", "radio");
      b.dataset.v = String(it.value);
      b.innerHTML = `${it.icon ? "<ha-icon></ha-icon>" : ""}<span></span>`;
      if (it.icon) attr(b.querySelector("ha-icon"), "icon", it.icon);
      text(b.querySelector("span"), it.label);
      kit.press(b, () => this.onPick(it.value), { depth: 0.04 });
      el.appendChild(b);
      return b;
    });
    this.idx = kit.spring(0, MOTION.pill, 0.002);
    this.shown = kit.spring(0, MOTION.ui, 0.002);
    this.value = undefined;
    kit.paints.push(() => this.paint());
  }
  setValue(v, snap = false) {
    if (v === this.value && !snap) return;
    this.value = v;
    const i = this.items.findIndex((it) => it.value === v);
    this.buttons.forEach((b, k) => { attr(b, "aria-checked", String(k === i)); attr(b, "data-on", k === i); });
    this.shown.to(i < 0 ? 0 : 1);
    if (i >= 0) { if (snap || this.shown.x < 0.01) this.idx.snap(i); else this.idx.to(i); }
    if (snap) this.shown.snap();
    this.kit.wake();
  }
  paint() {
    put(this.pill, "--i", this.idx.x.toFixed(3));
    put(this.pill, "opacity", clamp(this.shown.x).toFixed(3));
    return false;
  }
}

// - value +: the target of a climate unit. Taps step it; the service call waits until the
// stepping stops, so three taps are one write.
class Stepper {
  constructor(kit, { label, onChange, compact = false }) {
    this.kit = kit;
    this.onChange = onChange;
    const el = this.el = document.createElement("div");
    el.className = "sv-step";
    if (compact) el.dataset.compact = "";
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", label);
    this.down = iconButton(kit, { icon: "mdi:minus", label: `${label} down`, onTap: () => this.bump(-1) });
    this.up = iconButton(kit, { icon: "mdi:plus", label: `${label} up`, onTap: () => this.bump(1) });
    this.val = document.createElement("span");
    this.val.className = "sv-step-v";
    el.append(this.down, this.val, this.up);
    this.cfg = { value: 0, min: 0, max: 100, step: 1, unit: "" };
    this.pending = null;
    this.timer = 0;
    kit.onDispose(() => clearTimeout(this.timer));
  }
  fmt(v) { return `${v.toFixed(this.cfg.step < 1 ? 1 : 0)}${this.cfg.unit}`; }
  set(cfg) {
    this.cfg = cfg;
    if (this.pending != null && (Math.abs(this.pending - cfg.value) < 1e-6 || Date.now() - this.pendingAt > CTL_PREDICT_MS + 600)) this.pending = null;
    const shown = this.pending ?? cfg.value;
    text(this.val, this.fmt(shown));
    attr(this.down, "disabled", shown <= cfg.min + 1e-9);
    attr(this.up, "disabled", shown >= cfg.max - 1e-9);
  }
  bump(d) {
    const { value, min, max, step } = this.cfg;
    const v = clamp((this.pending ?? value) + d * step, min, max);
    this.pending = Math.round(v / step) * step;
    this.pendingAt = Date.now();
    this.set(this.cfg);
    haptic("selection");
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = 0; this.onChange(this.pending); }, 450);
  }
}

// Lock, unlock, open, with the lock's own icon as the handle. It rests at the start of its row; drag it
// across and the row becomes the track. Past the first stop it does the opposite of what the lock is
// now (unlock when locked, lock when not); a lock that can open has a second stop at the end that has
// to be held until a ring fills, then released, before the latch opens. A tap on the handle only
// nudges it, to show that it slides. The handle always comes back to the start; the icon and the
// colour say what the lock is.
class LockSlide {
  constructor(kit, { host, handle, label, canOpen, onLock, onUnlock, onOpen, hintHost = null, fade = [] }) {
    this.kit = kit;
    this.host = host;
    this.handle = handle;
    this.canOpen = canOpen;
    this.onLock = onLock;
    this.onUnlock = onUnlock;
    this.onOpen = onOpen;
    this.onWords = null;                        // the row calls this to say its subtitle changed
    this.u = 0.5;                               // where the first stop sits when there are two
    host.classList.add("sv-sl");
    host.dataset.stops = canOpen ? "3" : "2";
    handle.classList.add("sv-sl-handle");
    handle.setAttribute("role", "slider");
    handle.tabIndex = 0;
    handle.setAttribute("aria-label", label);
    handle.setAttribute("aria-valuemin", "0");
    handle.setAttribute("aria-valuemax", canOpen ? "2" : "1");
    host.insertAdjacentHTML("afterbegin", `<span class="sv-sl-ov" aria-hidden="true"><span class="sv-sl-fill"></span><span class="sv-sl-g g1"></span><span class="sv-sl-g g2"></span></span>`);
    this.fill = host.querySelector(".sv-sl-fill");
    this.g1 = host.querySelector(".sv-sl-g.g1");
    this.g2 = host.querySelector(".sv-sl-g.g2");
    const hint = document.createElement("span");
    hint.className = "sv-sl-hint";
    hint.setAttribute("aria-hidden", "true");
    hint.innerHTML = '<ha-icon icon="mdi:chevron-double-right"></ha-icon>';
    if (hintHost) { hint.dataset.inline = ""; hintHost.appendChild(hint); } else host.appendChild(hint);
    for (const f of fade) f.classList.add("sv-sl-fade");
    handle.insertAdjacentHTML("beforeend", `<svg class="sv-sl-ring" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="20"></circle></svg>
      <span class="sv-sl-ic"><ha-icon class="i0"></ha-icon><ha-icon class="i1"></ha-icon><ha-icon class="i2"></ha-icon></span>`);
    this.ring = handle.querySelector(".sv-sl-ring circle");
    this.icons = [handle.querySelector(".i0"), handle.querySelector(".i1"), handle.querySelector(".i2")];
    attr(this.icons[0], "icon", "mdi:lock");
    attr(this.icons[1], "icon", "mdi:lock-open-variant");
    attr(this.icons[2], "icon", "mdi:door-open");
    this.x = kit.spring(0, { response: 0.3, damping: 0.74 }, 0.001);   // the handle's place, as a share of the travel
    this.cv = kit.spring(0, MOTION.ui, 0.002);                           // how far the handle has become a knob
    this.gh = kit.spring(0, MOTION.ui, 0.002);                           // how visible the track is
    this.pulse = 0;
    this.W = 0; this.T = 1; this.H = 0; this.L = 0; this.tx = 0; this.dir = 1;
    this.state = "unknown";
    this.pend = null;                           // { stop, at }: what we asked for
    this.rest = 0;                              // 0 locked, 1 unlocked, 2 open (what the lock is, or is about to be)
    this.drag = null;
    this.holdFrom = 0;
    this.armed = false;
    this.timers = [];
    this.later = [];
    kit.paints.push((dt) => this.paint(dt));
    kit.onDispose(() => { this.clearTimers(); for (const t of this.later) clearTimeout(t); });
    if (typeof ResizeObserver === "function") {
      this.ro = new ResizeObserver(() => { this.measure(); kit.wake(); });
      this.ro.observe(host);
      kit.onDispose(() => this.ro.disconnect());
    }
    this.wire();
  }

  get el() { return this.handle; }
  get openZone() { return this.canOpen && this.rest !== 2; }
  get target() { return this.rest === 0 ? 1 : 0; }
  clearTimers() { for (const t of this.timers) clearTimeout(t); this.timers = []; }

  // the track is the host's width less the handle and the room round it
  measure() {
    const r = this.host.getBoundingClientRect(), hr = this.handle.getBoundingClientRect();
    if (!r.width || !hr.width) return;
    this.dir = getComputedStyle(this.host).direction === "rtl" ? -1 : 1;
    this.host.toggleAttribute("data-rtl", this.dir === -1);
    this.W = r.width;
    this.H = hr.width;
    this.L = this.dir === 1 ? hr.left - r.left - this.tx : r.right - hr.right + this.tx;
    this.T = Math.max(1, this.W - this.H - 2 * this.L);
  }
  // the knob sits where the finger is, but past the first stop it lags and then arrives: heavy. The
  // end is the finger's last 4%: a drag only counts from where it became clearly sideways.
  mapFinger(f) {
    if (!this.openZone || f <= this.u) return f;
    const t = clamp((f - this.u) / (LOCK_END - this.u));
    return this.u + (1 - this.u) * Math.pow(t, 1.8);
  }

  get disabled() { return this.state === "unavailable" || this.state === "unknown"; }
  get transitional() { return ["locking", "unlocking", "opening"].includes(this.state) || !!this.pend; }

  // HA's state each render; an optimistic stop holds until HA agrees or it expires
  setState(state, snap = false) {
    this.state = state;
    const truth = state === "locked" || state === "locking" ? 0 : state === "open" || state === "opening" ? 2 : 1;
    const now = Date.now();
    if (this.pend && (this.pend.stop === truth || (now - this.pend.at > (this.pend.ttl ?? CTL_PREDICT_MS) && !["locking", "unlocking", "opening"].includes(state)))) this.pend = null;
    let stop = this.pend ? this.pend.stop : truth;
    if (!this.canOpen && stop === 2) stop = 1;
    this.rest = stop;
    attr(this.handle, "aria-valuenow", String(stop));
    attr(this.handle, "aria-valuetext", ["Locked", "Unlocked", "Open"][stop]);
    attr(this.host, "data-bad", state === "jammed");
    attr(this.host, "aria-disabled", this.disabled ? "true" : null);
    attr(this.host, "data-busy", this.transitional);
    if (!this.drag) { if (snap) this.x.snap(0); else this.x.to(0); }
    this.cv.to(this.drag || this.pend || this.armed ? 1 : 0);
    text(this.g1, this.openZone ? (this.target === 1 ? "Unlock" : "Lock") : "");
    text(this.g2, this.openZone ? "Open" : this.target === 1 ? "Unlock" : "Lock");
    this.kit.wake();
  }

  // what the row says under the name
  get words() {
    if (this.pend) return this.pend.stop === 0 ? "Locking…" : this.pend.stop === 1 ? "Unlocking…" : "Opening…";
    return { locked: "Locked", unlocked: "Unlocked", locking: "Locking…", unlocking: "Unlocking…", opening: "Opening…", open: "Open", jammed: "Jammed" }[this.state] || title(this.state);
  }

  // the track's colour where the handle sits: from what the lock is, to what the slide would make it, to red
  colorAt(x) {
    const u = this.u, cur = this.rest, tgt = this.target;
    if (this.openZone) return x <= u ? mixRgb(LOCK_COLORS[cur], LOCK_COLORS[tgt], u ? x / u : 1) : mixRgb(LOCK_COLORS[tgt], LOCK_COLORS[2], clamp((x - u) / (1 - u)));
    return mixRgb(LOCK_COLORS[cur], LOCK_COLORS[tgt], clamp(x));
  }

  paint(dt) {
    if (!this.W) this.measure();
    const x = clamp(this.x.x, 0, 1.04), u = this.u, cv = clamp(this.cv.x), gh = clamp(this.gh.x);
    this.tx = this.dir * x * this.T;
    put(this.handle, "transform", Math.abs(this.tx) < 0.01 ? "" : `translateX(${this.tx.toFixed(2)}px)`);
    put(this.host, "--lk", (this.pend ? LOCK_COLORS[this.pend.stop] : this.colorAt(x)).join(" "));
    put(this.host, "--gh", gh.toFixed(3));
    put(this.handle, "--cov", cv.toFixed(3));
    // the fill reaches the handle's far edge; the ghosts name the stops ahead of it
    put(this.fill, "width", `${(x * this.T + this.H + this.L).toFixed(1)}px`);
    const edge = this.L + this.H + 8;
    if (this.openZone) put(this.g1, this.dir === 1 ? "left" : "right", `${(edge + u * this.T).toFixed(1)}px`);
    put(this.g2, this.dir === 1 ? "right" : "left", `${edge.toFixed(1)}px`);
    put(this.g1, this.dir === 1 ? "right" : "left", "auto");
    put(this.g2, this.dir === 1 ? "left" : "right", "auto");
    put(this.g1, "opacity", this.openZone ? (gh * clamp(1 - (x - u) * 5)).toFixed(3) : "0");
    // the icon crossfades between the stops it sits between: what the lock is, what the slide makes it, open
    const w = [0, 0, 0];
    if (this.pend) w[this.pend.stop] = 1;
    else {
      const pts = this.openZone ? [[0, this.rest], [u, this.target], [1, 2]] : [[0, this.rest], [1, this.target]];
      if (x >= pts[pts.length - 1][0]) w[pts[pts.length - 1][1]] = 1;
      else for (let k = 0; k < pts.length - 1; k++) {
        if (x >= pts[k][0] && x <= pts[k + 1][0]) { const t = (x - pts[k][0]) / (pts[k + 1][0] - pts[k][0]); w[pts[k][1]] += 1 - t; w[pts[k + 1][1]] += t; }
      }
    }
    this.icons.forEach((ic, i) => {
      put(ic, "opacity", w[i].toFixed(3));
      put(ic, "transform", `scale(${(0.7 + 0.3 * w[i]).toFixed(3)})`);
    });
    // the hold ring, from the clock so reduced motion keeps it
    let busy = false;
    let p = 0;
    if (this.holdFrom && !this.armed) { p = clamp((performance.now() - this.holdFrom) / LOCK_HOLD_MS); busy = true; }
    else if (this.armed) p = 1;
    put(this.ring, "strokeDashoffset", (125.7 * (1 - p)).toFixed(2));
    put(this.handle, "--ring", p > 0 ? "1" : "0");
    attr(this.host, "data-armed", this.armed);
    // a handle waiting on HA breathes
    if (this.transitional && !MQ.reduced.matches) {
      this.pulse += (dt || 0) * 5;
      put(this.handle, "--breath", (0.5 + 0.5 * Math.sin(this.pulse)).toFixed(3));
      busy = true;
    } else put(this.handle, "--breath", "0");
    return busy;
  }

  // ---- gestures
  wire() {
    const el = this.handle;
    let id = null, x0 = 0, y0 = 0, xs = 0, from = 0, moved = false;
    el.addEventListener("pointerdown", (e) => {
      if (e.button > 0 || this.disabled) return;
      e.stopPropagation();
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; moved = false;
      this.drag = null;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* already lifted */ }
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerId !== id) return;
      if (!e.buttons && e.pointerType === "mouse") { id = null; return; }
      if (!this.drag) {
        const dx = (e.clientX - x0) * this.dir, dy = e.clientY - y0;
        if (Math.hypot(dx, dy) < SLOP) return;
        if (Math.abs(dy) >= Math.abs(dx)) { id = null; return; }   // vertical: the page scrolls
        this.measure();
        moved = true;
        // relative: the finger moves the handle from wherever it was
        const cur = this.x.x, f0 = this.openZone && cur > this.u ? this.u + (LOCK_END - this.u) * Math.pow((cur - this.u) / (1 - this.u), 1 / 1.8) : cur;
        from = f0; xs = x0;                     // the handle stays under the finger that grabbed it
        this.drag = { f: f0 };
        this.last = 0;
        this.host.dataset.drag = "";
        this.gh.to(1);
        this.cv.to(1);
      }
      const f = clamp(from + ((e.clientX - xs) * this.dir) / this.T);
      this.drag.f = f;
      this.x.snap(this.mapFinger(f));
      const notch = this.openZone ? (f > this.u ? 2 : f > this.u / 2 ? 1 : 0) : (f > 0.6 ? 1 : 0);
      if (notch !== this.last) { this.last = notch; haptic("selection"); }
      this.zone(f >= LOCK_END);
      this.kit.wake();
    });
    const endDrag = () => { delete this.host.dataset.drag; this.gh.to(0); };
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      if (!this.drag) { if (!moved && e.type === "pointerup") this.nudge(); return; }
      const f = this.drag.f, armed = this.armed;
      this.drag = null;
      endDrag();
      this.zone(false);
      this.release(f, armed);
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", (e) => {
      if (e.pointerId === id && this.drag) { id = null; this.drag = null; endDrag(); this.zone(false); this.x.to(0); this.cv.to(this.pend ? 1 : 0); this.kit.wake(); }
    });
    el.addEventListener("click", (e) => e.stopPropagation());

    // keyboard: arrows lock and unlock; Open needs Enter or Space held for the same half second
    let keyHold = false;
    el.addEventListener("keydown", (e) => {
      if (this.disabled) return;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); if (this.rest === 0) this.commit(1); return; }
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); if (this.rest >= 1) this.commit(0); return; }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault(); e.stopPropagation();
        if (e.repeat || keyHold) return;
        if (this.rest === 0 || !this.openZone) { this.commit(this.target); return; }
        keyHold = true;
        this.x.to(1);
        this.cv.to(1);
        this.gh.to(1);
        this.zone(true);
        this.kit.wake();
      }
    });
    el.addEventListener("keyup", (e) => {
      if (!keyHold || (e.key !== "Enter" && e.key !== " ")) return;
      e.stopPropagation();
      keyHold = false;
      const armed = this.armed;
      this.zone(false);
      this.gh.to(0);
      if (armed) this.release(1, true); else { this.x.to(0); this.cv.to(this.pend ? 1 : 0); this.kit.wake(); }
    });
    el.addEventListener("blur", () => { if (keyHold) { keyHold = false; this.zone(false); this.x.to(0); this.gh.to(0); this.cv.to(this.pend ? 1 : 0); this.kit.wake(); } });
  }

  // a tap only shows that it slides
  nudge() {
    if (this.disabled || MQ.reduced.matches) return;
    haptic("light");
    this.x.to(0.09);
    this.later.push(setTimeout(() => { if (!this.drag) { this.x.to(0); this.kit.wake(); } }, 130));
    this.kit.wake();
  }

  // the end of the track: entering it starts the ring; a half second later it arms
  zone(inside) {
    if (!this.openZone) return;
    if (inside && !this.holdFrom) {
      this.holdFrom = performance.now();
      this.clearTimers();
      const red = MQ.reduced.matches;
      if (!red) {
        haptic("selection");
        this.timers.push(setTimeout(() => haptic("light"), LOCK_HOLD_MS * 0.35), setTimeout(() => haptic("light"), LOCK_HOLD_MS * 0.7));
      }
      this.timers.push(setTimeout(() => { this.armed = true; haptic("medium"); this.kit.wake(); }, LOCK_HOLD_MS));
      this.kit.wake();
    } else if (!inside && this.holdFrom) {
      this.holdFrom = 0;
      this.armed = false;
      this.clearTimers();
      this.kit.wake();
    }
  }

  // the finger lets go at share f of the travel
  release(f, armed) {
    if (armed && this.openZone) {
      this.armed = false;
      this.holdFrom = 0;
      // the latch shows for a moment, then the handle is back and the lock is what it was
      this.pend = { stop: 2, at: Date.now(), ttl: 700 };
      haptic("success");
      this.x.to(0);
      this.onOpen();
      this.setState(this.state);
      this.onWords?.();
      this.recheck(750);
      this.kit.wake();
      return;
    }
    this.armed = false;
    this.holdFrom = 0;
    // past the first stop does the opposite of what the lock is; letting go in the end zone early, or short of the stop, does nothing
    const fire = this.openZone ? 0.4 : 0.6;
    if (f >= fire && !(this.openZone && f >= LOCK_END)) this.commit(this.target);
    else { this.x.to(0); this.cv.to(this.pend ? 1 : 0); this.kit.wake(); }
  }

  // ask HA for a stop it isn't in; the handle goes back to the start
  commit(stop) {
    if (stop !== this.rest) {
      this.pend = { stop, at: Date.now() };
      haptic("light");
      if (stop === 0) this.onLock(); else if (stop === 1) this.onUnlock();
      this.setState(this.state);
      this.onWords?.();
      this.recheck(CTL_PREDICT_MS + 60);
    }
    this.x.to(0);
    this.kit.wake();
  }

  // HA may never answer (or answer with the state it was already in): look again when the guess is stale
  recheck(ms) {
    this.later.push(setTimeout(() => { this.setState(this.state); this.onWords?.(); }, ms));
  }
}
