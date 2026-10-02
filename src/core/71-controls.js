// ---------------------------------------------------------------------------------------
// core/controls: the small controls a popup row is built from (CARD-DESIGN.md 3): press
// buttons, a bar that only moves on a sideways drag, a segmented control, a - / + stepper
// and the lock track. Each one owns its springs through a RowKit, which the popup's clock
// job steps and paints, so a row never needs its own animation loop.
// ---------------------------------------------------------------------------------------

const CTL_PREDICT_MS = 1500;   // an optimistic value waits this long for HA to agree
const CTL_WRITE_MS = 140;      // a drag sends at most this often; the release always lands
const LOCK_KNOB = 28;         // the lock track's knob, and the padding round it
const LOCK_PAD = 4;
const LOCK_END = 0.96;         // where the finger's travel counts as the end of the track
const LOCK_HOLD_MS = 500;      // how long the end of the lock track must be held to open
const LOCK_COLORS = [[76, 175, 80], [232, 163, 61], [224, 102, 102]];   // locked, unlocked, open
const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

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

// Lock, unlock, open: one track, one knob, three stops. A tap does nothing; the knob is
// dragged. Past Unlocked the track gets heavy and the end has to be held until a ring fills
// (and then released) before the door's latch opens. A lock that can't open has two stops.
class LockTrack {
  constructor(kit, { label, canOpen, onLock, onUnlock, onOpen }) {
    this.kit = kit;
    this.canOpen = canOpen;
    this.onLock = onLock;
    this.onUnlock = onUnlock;
    this.onOpen = onOpen;
    this.onWords = null;                        // the row calls this to say its subtitle changed
    this.u = canOpen ? 0.5 : 1;                 // where Unlocked sits, as a share of the travel
    const el = this.el = document.createElement("div");
    el.className = "sv-lk";
    el.dataset.stops = canOpen ? "3" : "2";
    el.setAttribute("role", "slider");
    el.tabIndex = 0;
    el.setAttribute("aria-label", label);
    el.setAttribute("aria-valuemin", "0");
    el.setAttribute("aria-valuemax", canOpen ? "2" : "1");
    el.innerHTML = `<span class="sv-lk-hint l"></span><span class="sv-lk-hint r"></span>
      <span class="sv-lk-knob">
        <svg class="sv-lk-ring" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="20"></circle></svg>
        <ha-icon class="i0"></ha-icon><ha-icon class="i1"></ha-icon><ha-icon class="i2"></ha-icon>
      </span>`;
    this.knob = el.querySelector(".sv-lk-knob");
    this.ring = el.querySelector(".sv-lk-ring circle");
    this.hl = el.querySelector(".sv-lk-hint.l");
    this.hr = el.querySelector(".sv-lk-hint.r");
    this.icons = [el.querySelector(".i0"), el.querySelector(".i1"), el.querySelector(".i2")];
    attr(this.icons[0], "icon", "mdi:lock");
    attr(this.icons[1], "icon", "mdi:lock-open-variant");
    attr(this.icons[2], "icon", "mdi:door-open");
    this.x = kit.spring(0, { response: 0.3, damping: 0.74 }, 0.001);
    this.pulse = 0;
    this.W = 0;
    this.state = "unknown";
    this.pend = null;                           // { stop, at }: what we asked for
    this.rest = 0;
    this.drag = null;
    this.holdFrom = 0;
    this.armed = false;
    this.timers = [];
    this.later = [];
    kit.paints.push((dt) => this.paint(dt));
    kit.onDispose(() => { this.clearTimers(); for (const t of this.later) clearTimeout(t); });
    if (typeof ResizeObserver === "function") {
      this.ro = new ResizeObserver(() => { this.measure(); kit.wake(); });
      this.ro.observe(el);
      kit.onDispose(() => this.ro.disconnect());
    }
    this.wire();
  }

  clearTimers() { for (const t of this.timers) clearTimeout(t); this.timers = []; }
  measure() { this.W = this.el.clientWidth; this.T = Math.max(1, this.W - LOCK_KNOB - 2 * LOCK_PAD); }
  stopPos(stop) { return stop === 0 ? 0 : stop === 1 ? this.u : 1; }
  // the knob sits where the finger is, but past Unlocked it lags and then arrives: heavy. The
  // end is the finger's last 4%: a drag only counts from where it became clearly sideways.
  mapFinger(f) {
    if (!this.canOpen || f <= this.u) return f;
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
    attr(this.el, "aria-valuenow", String(stop));
    attr(this.el, "aria-valuetext", ["Locked", "Unlocked", "Open"][stop]);
    attr(this.el, "data-bad", state === "jammed");
    attr(this.el, "aria-disabled", this.disabled ? "true" : null);
    attr(this.el, "data-busy", this.transitional);
    if (!this.drag) {
      if (snap) this.x.snap(this.stopPos(stop)); else this.x.to(this.stopPos(stop));
    }
    text(this.hr, this.disabled ? "" : stop === 0 ? "Slide to unlock" : stop === 1 && this.canOpen ? "Hold the end to open" : "");
    text(this.hl, this.disabled ? "" : stop >= 1 ? "Lock" : "");
    this.kit.wake();
  }

  // what the row says under the name
  get words() {
    if (this.pend) return this.pend.stop === 0 ? "Locking…" : this.pend.stop === 1 ? "Unlocking…" : "Opening…";
    return { locked: "Locked", unlocked: "Unlocked", locking: "Locking…", unlocking: "Unlocking…", opening: "Opening…", open: "Open", jammed: "Jammed" }[this.state] || title(this.state);
  }

  paint(dt) {
    if (!this.W) this.measure();
    const x = clamp(this.x.x, 0, 1.04), u = this.u;
    put(this.knob, "transform", `translateX(${(x * this.T).toFixed(2)}px)`);
    const c = this.canOpen
      ? (x <= u ? mixRgb(LOCK_COLORS[0], LOCK_COLORS[1], u ? x / u : 1) : mixRgb(LOCK_COLORS[1], LOCK_COLORS[2], clamp((x - u) / (1 - u))))
      : mixRgb(LOCK_COLORS[0], LOCK_COLORS[1], clamp(x));
    put(this.el, "--lk", c.join(" "));
    // the icon crossfades between the stops it sits between
    const pos = this.canOpen ? [0, u, 1] : [0, 1, 1];
    const span = this.canOpen ? u : 1;
    this.icons.forEach((ic, i) => {
      const w = i === 2 && !this.canOpen ? 0 : clamp(1 - Math.abs(x - pos[i]) / span);
      put(ic, "opacity", w.toFixed(3));
      put(ic, "transform", `scale(${(0.7 + 0.3 * w).toFixed(3)})`);
    });
    // the hints belong to the stop the knob rests on and fade as it leaves
    const near = this.drag ? 0 : clamp(1 - Math.abs(x - this.stopPos(this.rest)) * 5);
    put(this.hl, "opacity", near.toFixed(3));
    put(this.hr, "opacity", near.toFixed(3));
    // the hold ring, from the clock so reduced motion keeps it
    let busy = false;
    let p = 0;
    if (this.holdFrom && !this.armed) { p = clamp((performance.now() - this.holdFrom) / LOCK_HOLD_MS); busy = true; }
    else if (this.armed) p = 1;
    put(this.ring, "strokeDashoffset", (125.7 * (1 - p)).toFixed(2));
    put(this.knob, "--ring", p > 0 ? "1" : "0");
    attr(this.el, "data-armed", this.armed);
    // a knob waiting on HA breathes
    if (this.transitional && !MQ.reduced.matches) {
      this.pulse += (dt || 0) * 5;
      put(this.knob, "--breath", (0.5 + 0.5 * Math.sin(this.pulse)).toFixed(3));
      busy = true;
    } else put(this.knob, "--breath", "0");
    return busy;
  }

  // ---- gestures
  wire() {
    const el = this.el;
    let id = null, x0 = 0, y0 = 0, xs = 0, from = 0;
    el.addEventListener("pointerdown", (e) => {
      if (e.button > 0 || this.disabled) return;
      e.stopPropagation();
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY;
      this.drag = null;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* already lifted */ }
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerId !== id) return;
      if (!e.buttons && e.pointerType === "mouse") { id = null; return; }
      if (!this.drag) {
        const dx = e.clientX - x0, dy = e.clientY - y0;
        if (Math.hypot(dx, dy) < SLOP) return;
        if (Math.abs(dy) >= Math.abs(dx)) { id = null; return; }   // vertical: the page scrolls
        this.measure();
        // relative: the finger moves the knob from wherever it was
        const cur = this.x.x, f0 = this.canOpen && cur > this.u ? this.u + (LOCK_END - this.u) * Math.pow((cur - this.u) / (1 - this.u), 1 / 1.8) : cur;
        from = f0; xs = x0;                     // the knob stays under the finger that grabbed it
        this.drag = { f: f0, zone: false };
        this.last = 0;
        el.dataset.drag = "";
      }
      const f = clamp(from + (e.clientX - xs) / this.T);
      this.drag.f = f;
      this.x.snap(this.mapFinger(f));
      const notch = f > this.u ? 2 : f > this.u / 2 ? 1 : 0;
      if (notch !== this.last) { this.last = notch; haptic("selection"); }
      this.zone(f >= LOCK_END);
      this.kit.wake();
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      if (!this.drag) return;
      const f = this.drag.f, armed = this.armed;
      this.drag = null;
      delete el.dataset.drag;
      this.zone(false);
      this.release(f, armed);
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", (e) => { if (e.pointerId === id && this.drag) { id = null; this.drag = null; delete el.dataset.drag; this.zone(false); this.x.to(this.stopPos(this.rest)); this.kit.wake(); } });
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
        if (this.rest === 0 || !this.canOpen) { this.commit(this.rest === 0 ? 1 : 0); return; }
        keyHold = true;
        this.x.to(1);
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
      this.release(armed ? 1 : this.u, armed);
    });
    el.addEventListener("blur", () => { if (keyHold) { keyHold = false; this.zone(false); this.x.to(this.stopPos(this.rest)); this.kit.wake(); } });
  }

  // the end of the track: entering it starts the ring; a half second later it arms
  zone(inside) {
    if (!this.canOpen) return;
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
    if (armed && this.canOpen) {
      this.armed = false;
      this.holdFrom = 0;
      // the knob shows the latch for a moment, then settles back on Unlocked
      this.pend = { stop: 2, at: Date.now(), ttl: 700 };
      haptic("success");
      this.x.to(1);
      this.onOpen();
      this.setState(this.state);
      this.onWords?.();
      this.recheck(750);
      this.kit.wake();
      return;
    }
    this.armed = false;
    this.holdFrom = 0;
    const m = this.canOpen ? this.u / 2 : 0.5;
    let target = f < m ? 0 : 1;
    if (this.rest === 2 && f >= m) target = 2;     // already open: a small drag changes nothing
    this.commit(target);
  }

  // settle on a stop; ask HA when it isn't the one it's in
  commit(stop) {
    if (stop !== this.rest) {
      this.pend = { stop, at: Date.now() };
      haptic("light");
      if (stop === 0) this.onLock(); else if (stop === 1) this.onUnlock();
      this.setState(this.state);
      this.onWords?.();
      this.recheck(CTL_PREDICT_MS + 60);
    }
    this.x.to(this.stopPos(this.rest));
    this.kit.wake();
  }

  // HA may never answer (or answer with the state it was already in): look again when the guess is stale
  recheck(ms) {
    this.later.push(setTimeout(() => { this.setState(this.state); this.onWords?.(); }, ms));
  }
}
