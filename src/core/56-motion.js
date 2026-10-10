// ---------------------------------------------------------------------------------------
// core/motion: the rule is that anything that changes state in front of you moves there
// with a spring, and every one of those moves can be interrupted. Four pieces, built once:
//
//   Tint     a colour that changes (on / off, idle / alert) slides from the old one to the
//            new one. Hooked into attr(): when a state attribute flips, every colour under
//            that element is measured before and after, and the difference is animated.
//   Roll     text that changes slides and fades; a count ticks through its numbers. Hooked
//            into text(). The real text is always final at once (so reading it never sees
//            a half-way value); the motion is drawn by the element's pseudo-elements.
//   Appear   Motion.flip(box, fn): rows, badges, chips and tiles that come, go or move
//            inside a container slide to their places; the ones that leave fade out where
//            they were.
//   Cascade  changes that land together ripple with a small stagger instead of all at once.
//
// Nothing here animates a card's first paint, an element's first value, a hidden card or
// anything while reduced motion is on; the shared clock sleeps when nothing is moving.
// ---------------------------------------------------------------------------------------

// state attributes whose flip changes colours (layout flags such as data-open stay out)
const TINT_ATTRS = new Set(["data-on", "data-off", "data-sel", "data-level", "data-live", "data-alert", "data-warn",
  "data-critical", "data-armed", "data-playing", "data-running", "data-unavailable", "data-missing", "data-triggered",
  "data-active", "data-light", "data-dim", "data-bad", "data-kind", "data-mode", "data-c", "data-k", "data-soft", "data-solo",
  "data-pick", "data-busy", "data-flash", "data-filled", "data-nostate"]);
const TINT_PROPS = ["color", "background-color", "border-top-color", "fill", "stroke"];
const COLOR_FN = /^(rgb|rgba|color|oklab|oklch|lab|lch|hsl|hwb)\(/i;
const STAGGER_GAP = 0.04;      // s between neighbours of a cascade
const STAGGER_CAP = 0.35;      // s: no cascade runs longer than this
const ROLL_MIN_GAP = 250;      // ms: a value that changes every frame (a drag) never rolls
const NUM_RE = /-?\d+(?:\.\d+)?/;
const FLIP_MAX = 120;         // children: a longer list just updates (measuring it every update costs more than it gives)

MOTION.blend = { response: 0.3, damping: 1 };
MOTION.roll = { response: 0.4, damping: 1 };
MOTION.flip = { response: 0.5, damping: 0.88 };
MOTION.leave = { response: 0.32, damping: 1 };

class MotionAnim {
  constructor(from, to, motion, delay, paint, end) {
    this.s = new Spring(from, motion, "motion", 2e-3).to(to);
    this.delay = delay || 0;
    this.paint = paint;
    this.end = end;
    this.dead = false;
    paint(from);
  }
}

function motionJob(now, dt) {
  for (const a of Motion.anims) {
    if (a.dead) { Motion.anims.delete(a); continue; }
    let step = dt;
    if (a.delay > 0) {
      a.delay -= dt;
      if (a.delay > 0) continue;
      step = -a.delay;
      a.delay = 0;
    }
    a.s.step(step);
    if (a.s.idle) {
      a.s.snap();
      a.paint(a.s.x);
      Motion.anims.delete(a);
      a.end?.();
    } else a.paint(a.s.x);
  }
  return Motion.anims.size > 0;
}

const Motion = {
  anims: new Set(),
  stag: 0,
  stagQueued: false,

  start(anim) {
    this.anims.add(anim);
    Clock.add(motionJob);
    return anim;
  },
  // true while anything is still moving (tests wait on it)
  busy() { return this.anims.size > 0; },

  // A card is ready to animate two frames after its first write: what lands while it is being
  // built is its first paint, not a change.
  seen(el) {
    const root = el.getRootNode();
    if (root.__mReady === undefined) {
      root.__mReady = false;
      requestAnimationFrame(() => requestAnimationFrame(() => { root.__mReady = true; }));
    }
    return root;
  },

  // may this element animate at all? Not before its card has settled, not hidden, not reduced.
  can(el) {
    if (!el || MQ.reduced.matches || !el.isConnected || document.hidden) return false;
    return this.seen(el).__mReady === true;
  },

  // the n-th change in the same tick starts n gaps later, up to the cap
  stagger() {
    const i = this.stag++;
    if (!this.stagQueued) {
      this.stagQueued = true;
      queueMicrotask(() => { this.stag = 0; this.stagQueued = false; });
    }
    return Math.min(i * STAGGER_GAP, STAGGER_CAP);
  },

  // ---------- Tint ----------
  // Runs `apply` (a state attribute write) and animates every colour it changed beneath el.
  change(el, apply) {
    const els = tintScan(el), before = tintRead(els);
    apply();
    tintDiff(els, before);
  },

  // ---------- Glow ----------
  // The card's state colour in its corner (ha-card::before reads --glow-rgb and --glow). Pass the
  // colour and a level 0..1, or no colour for nothing. Colour and strength move together; a glow
  // coming from nothing takes its colour at once and only grows. Interruptible: a new target
  // starts from what is on screen.
  glow(el, rgb, level = 1) {
    if (!el) return;
    const g = el.__gl || (el.__gl = { c: (rgb || [128, 128, 128]).slice(), a: 0, to: null, anim: null });
    const to = { c: rgb ? rgb.map(Number) : g.to ? g.to.c : g.c, a: rgb ? clamp(level) : 0 };
    if (g.to && g.to.a === to.a && g.to.c.every((v, i) => v === to.c[i])) return;
    g.to = to;
    const from = { c: g.c.slice(), a: g.a };
    if (g.anim) g.anim.dead = true;
    const paint = (x) => {
      g.a = from.a + (to.a - from.a) * x;
      g.c = from.a < 0.02 ? to.c.slice() : from.c.map((v, i) => v + (to.c[i] - v) * x);
      el.style.setProperty("--glow", g.a.toFixed(3));
      el.style.setProperty("--glow-rgb", g.c.map(Math.round).join(" "));
    };
    if (!this.can(el)) { g.anim = null; paint(1); return; }
    g.anim = this.start(new MotionAnim(0, 1, MOTION.blend, 0, paint, () => { g.anim = null; }));
  },

  // ---------- Roll ----------
  rollable(el) { return !el.hasAttribute("data-noroll"); },

  roll(el, old, val) {
    const now = performance.now();
    if (el.__mr) this.endRoll(el);
    const tooSoon = el.__mrT && now - el.__mrT < ROLL_MIN_GAP;
    el.__mrT = now;
    if (tooSoon || old === val || !el.getClientRects().length) return;
    // a number rolls the way it went: down when it falls, up otherwise (words always roll up)
    const num = tickParts(old, val);
    const down = !!num && num.nb < num.na;
    if (this.rollPart(el, old, val, down)) return;
    const cs = getComputedStyle(el);
    el.style.setProperty("--rl-c", cs.color);
    el.toggleAttribute("data-rl-rel", cs.position === "static");
    // the drawn values sit where the text does: in its padding, and centred the way a flex pill centres it
    el.style.setProperty("--rl-d", /flex/.test(cs.display) ? "flex" : "block");
    el.setAttribute("data-dir", down ? "down" : "up");
    el.setAttribute("data-rolling", "slide");
    el.setAttribute("data-out", old);
    el.setAttribute("data-in", val);
    el.style.setProperty("--rl", "0");
    el.__mr = this.start(new MotionAnim(0, 1, MOTION.roll, 0, (x) => el.style.setProperty("--rl", x.toFixed(3)), () => this.endRoll(el)));
  },

  // Only what changed rolls: "2 on" to "4 on" rolls the 2 into a 4 and " on" stays where it is; "17%" to
  // "19%" rolls the 7. Words change whole ("Playing" to "Paused", "1 on" to "All off"). The text after the
  // change slides only when the changed part takes more or less room. It is drawn in a shadow root on the
  // element, so the element's own text (what is read and selected) is the new value throughout; at the end
  // the shadow root only shows that text again. Nothing shared, the whole value rolls the same way. The
  // drawing takes the element's colour as it is on every frame, so a pill whose colour changes with its
  // value changes text and background together. Elements that cannot hold a shadow root roll whole with
  // the pseudo-elements instead. -> true when it rolled
  rollPart(el, old, val, down) {
    if (!PART_HOSTS.has(el.localName) || (el.shadowRoot && !el.__rs)) return false;
    const parts = rollParts(old, val) || { pre: "", oldMid: old, newMid: val, suf: "" };
    const sr = el.__rs || (el.__rs = el.attachShadow({ mode: "open" }));
    const span = (cls, t) => { const n = document.createElement("span"); if (cls) n.className = cls; n.textContent = t; return n; };
    const style = document.createElement("style");
    // one wrapper: in a flex pill the parts stay one run of text (one flex item), not three
    style.textContent = `.w { min-width: 0; overflow: inherit; text-overflow: inherit; white-space: inherit; }
      .m { display: inline-block; position: relative; vertical-align: bottom; clip-path: inset(-0.7em 0 -0.7em 0); white-space: pre; }
      .o { position: absolute; left: 0; top: 0; white-space: pre; } .n { display: inline-block; white-space: pre; }`;
    const mid = span("m", ""), o = span("o", parts.oldMid), n = span("n", parts.newMid), w = span("w", "");
    mid.append(n, o);
    w.append(span("", parts.pre), mid, span("", parts.suf));
    sr.replaceChildren(style, w);
    const ow = o.getBoundingClientRect().width, nw = n.getBoundingClientRect().width;
    const sign = down ? 1 : -1;      // up: the old leaves upwards and the new comes from below
    el.setAttribute("data-rolling", "part");
    el.setAttribute("data-dir", down ? "down" : "up");
    el.setAttribute("data-out", old);
    el.setAttribute("data-in", val);
    const paint = (x) => {
      const t = clamp(x);
      mid.style.width = `${(ow + (nw - ow) * t).toFixed(2)}px`;
      o.style.opacity = (1 - t).toFixed(3);
      o.style.translate = `0 ${(sign * t * 0.5).toFixed(3)}em`;
      n.style.opacity = t.toFixed(3);
      n.style.translate = `0 ${(-sign * (1 - t) * 0.5).toFixed(3)}em`;
    };
    paint(0);
    el.__mr = this.start(new MotionAnim(0, 1, MOTION.roll, 0, paint, () => this.endRoll(el)));
    return true;
  },
  endRoll(el) {
    if (el.__mr) el.__mr.dead = true;
    el.__mr = null;
    // a partial roll's shadow root shows the element's own text again
    if (el.__rs) el.__rs.replaceChildren(document.createElement("slot"));
    el.removeAttribute("data-rolling");
    el.removeAttribute("data-rl-rel");
    el.removeAttribute("data-dir");
    el.removeAttribute("data-out");
    el.removeAttribute("data-in");
    el.style.removeProperty("--rl");
    el.style.removeProperty("--rl-c");
    el.style.removeProperty("--rl-d");
  },

  // ---------- Appear ----------
  // Run `fn` (which adds, removes and reorders the children of `boxes`) and animate the
  // outcome: movers slide from where they were, newcomers grow in, leavers fade out in place.
  flip(boxes, fn) {
    const list = [].concat(boxes).filter(Boolean);
    if (!list.length || !this.can(list[0]) || list.reduce((n, b) => n + b.children.length, 0) > FLIP_MAX) return fn();
    const snap = list.map((box) => {
      const rects = new Map();
      for (const k of box.children) if (!k.__ghost) rects.set(k, k.getBoundingClientRect());
      return { box, rects, boxRect: box.getBoundingClientRect() };
    });
    if (!snap.some((s) => s.rects.size)) return fn();     // the first population is not an event
    fn();
    for (const { box, rects, boxRect } of snap) {
      const kids = [...box.children].filter((k) => !k.__ghost);
      for (const k of kids) { if (k.__mf) { k.__mf.dead = true; k.__mf = null; } put(k, "translate", ""); }
      const gone = [...rects.keys()].filter((k) => !kids.includes(k) && !k.isConnected);
      for (const k of kids) {
        const r0 = rects.get(k);
        if (!r0) { if (!k.__enter) this.enter(k); continue; }
        const r1 = k.getBoundingClientRect();
        const dx = r0.left - r1.left, dy = r0.top - r1.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
        k.__mf = this.start(new MotionAnim(1, 0, MOTION.flip, 0, (t) => put(k, "translate", t < 0.002 ? "" : `${(dx * t).toFixed(2)}px ${(dy * t).toFixed(2)}px`),
          () => { k.__mf = null; }));
      }
      if (gone.length) {
        if (getComputedStyle(box).position === "static") box.style.position = "relative";
        for (const k of gone) this.leave(box, k, rects.get(k), boxRect);
      }
    }
  },

  // a node that was just added grows and fades in
  enter(k, delay = this.stagger()) {
    if (k.__me) k.__me.dead = true;
    k.__me = this.start(new MotionAnim(0, 1, MOTION.flip, delay, (t) => {
      put(k, "filter", t > 0.995 ? "" : `opacity(${clamp(t).toFixed(3)})`);
      put(k, "scale", t > 0.995 ? "" : (0.9 + 0.1 * t).toFixed(4));
    }, () => { k.__me = null; }));
  },

  // a node that was just removed stays, absolutely placed where it was, and fades away
  leave(box, k, r0, boxRect) {
    if (!r0 || !r0.width || !r0.height) return;
    k.__ghost = true;
    k.style.cssText += `;position:absolute;margin:0;pointer-events:none;box-sizing:border-box;`
      + `left:${(r0.left - boxRect.left + box.scrollLeft - box.clientLeft).toFixed(1)}px;`
      + `top:${(r0.top - boxRect.top + box.scrollTop - box.clientTop).toFixed(1)}px;`
      + `width:${r0.width.toFixed(1)}px;height:${r0.height.toFixed(1)}px`;
    k.removeAttribute("hidden");
    box.appendChild(k);
    this.start(new MotionAnim(1, 0, MOTION.leave, 0, (t) => {
      put(k, "filter", `opacity(${clamp(t).toFixed(3)})`);
      put(k, "scale", (0.92 + 0.08 * t).toFixed(4));
    }, () => k.remove()));
  },

  // ---------- single values ----------
  // A colour held in a custom property (--tc, --lvl, --mode) slides to its new value.
  tintVar(el, prop, val) {
    const st = el.__tv || (el.__tv = {});
    const rec = st[prop];
    if (!rec) { st[prop] = { to: val, cur: val }; this.seen(el); put(el, prop, val); return; }
    if (rec.to === val) return;
    const from = rec.cur;
    rec.to = val;
    if (!val || !from || !this.can(el) || !el.getClientRects().length) { rec.cur = val; if (rec.anim) rec.anim.dead = true; put(el, prop, val); return; }
    if (rec.anim) rec.anim.dead = true;
    rec.anim = this.start(new MotionAnim(0, 1, MOTION.blend, this.stagger(), (t) => {
      rec.cur = t >= 0.998 ? val : `color-mix(in oklab, ${val} ${(t * 100).toFixed(1)}%, ${from})`;
      put(el, prop, rec.cur);
    }, () => { rec.anim = null; rec.cur = val; put(el, prop, val); }));
  },

  // A number held in a style property (a dimmed row's opacity) eases to its new value. Dimming
  // uses filter: opacity() so it never fights a press feedback that owns the opacity property.
  fadeTo(el, target) {
    const rec = el.__tf || (el.__tf = { to: undefined, x: target });
    if (rec.to === target) return;
    const first = rec.to === undefined;
    rec.to = target;
    if (first) this.seen(el);
    if (first || !this.can(el)) { rec.x = target; if (rec.anim) rec.anim.dead = true; put(el, "filter", target >= 1 ? "" : `opacity(${target})`); return; }
    const from = rec.x;
    if (rec.anim) rec.anim.dead = true;
    rec.anim = this.start(new MotionAnim(from, target, MOTION.ui, 0, (x) => {
      rec.x = x;
      put(el, "filter", x >= 0.999 ? "" : `opacity(${clamp(x).toFixed(3)})`);
    }, () => { rec.anim = null; }));
  },

  // A 0..1 position held in a custom property (a switch knob) rolls to its new value with a
  // springy settle. The first write is immediate.
  tweenVar(el, prop, target, motion = MOTION.pill) {
    const key = `__tw${prop}`;
    const rec = el[key] || (el[key] = { to: undefined, x: target });
    if (rec.to === target) return;
    const first = rec.to === undefined;
    rec.to = target;
    if (first) this.seen(el);
    if (first || !this.can(el)) { rec.x = target; if (rec.anim) rec.anim.dead = true; put(el, prop, String(target)); return; }
    if (rec.anim) rec.anim.dead = true;
    const sp = rec.anim ? rec.anim.s : null;
    rec.anim = this.start(new MotionAnim(rec.x, target, motion, 0, (x) => { rec.x = x; put(el, prop, x.toFixed(4)); }, () => { rec.anim = null; }));
    if (sp) rec.anim.s.v = sp.v;     // keep the velocity of the move it interrupted
  },

  // an icon that was swapped pops: a dip and a springy return
  pop(el) {
    if (el.__mp) el.__mp.dead = true;
    el.__mp = this.start(new MotionAnim(0, 1, MOTION.pop, 0, (t) => put(el, "scale", Math.abs(t - 1) < 0.002 ? "" : (0.62 + 0.38 * t).toFixed(4)), () => { el.__mp = null; }));
  },

  // A control that comes and goes pops in and fades out (it keeps its place while it leaves).
  show(el, on) {
    if (!el) return;
    if (!on) {
      if (el.hidden || el.__ms === false) return;
      if (!this.can(el) || !el.getClientRects().length) { el.hidden = true; return; }
      el.__ms = false;
      if (el.__msa) el.__msa.dead = true;
      el.__msa = this.start(new MotionAnim(1, 0, MOTION.leave, 0, (t) => {
        put(el, "filter", `opacity(${clamp(t).toFixed(3)})`);
        put(el, "scale", (0.88 + 0.12 * t).toFixed(4));
      }, () => { el.__msa = null; el.__ms = undefined; el.hidden = true; put(el, "filter", ""); put(el, "scale", ""); }));
      return;
    }
    if (el.__msa) { el.__msa.dead = true; el.__msa = null; el.__ms = undefined; put(el, "filter", ""); put(el, "scale", ""); }
    if (!el.hidden) return;
    el.hidden = false;
    if (this.can(el) && el.getClientRects().length) this.enter(el, 0);
  },

  // A block (a banner, a section) opens and closes in height; its neighbours slide with it.
  reveal(el, on) {
    if (!el) return;
    const open = !el.hidden && el.__mh !== false;
    if (on === open) return;
    if (el.__mha) el.__mha.dead = true;
    if (!this.can(el) || (!on && !el.getClientRects().length)) { el.__mh = undefined; el.hidden = !on; put(el, "height", ""); put(el, "overflow", ""); return; }
    let full;
    if (on) { el.hidden = false; el.__mh = undefined; full = el.scrollHeight; }
    else { full = el.getBoundingClientRect().height; el.__mh = false; }
    if (!full) { el.hidden = !on; el.__mh = undefined; return; }
    const from = on ? 0 : (el.__mhx ?? full);
    put(el, "overflow", "hidden");
    el.__mha = this.start(new MotionAnim(from / full, on ? 1 : 0, MOTION.flip, 0, (t) => {
      el.__mhx = t * full;
      put(el, "height", t >= 0.999 && on ? "" : `${Math.max(0, t * full).toFixed(1)}px`);
      put(el, "filter", t >= 0.999 && on ? "" : `opacity(${clamp(t).toFixed(3)})`);
    }, () => { el.__mha = null; el.__mhx = undefined; put(el, "overflow", ""); put(el, "height", ""); put(el, "filter", ""); if (!on) { el.hidden = true; el.__mh = undefined; } }));
  },
};

// ---------- Tint internals ----------
function tintScan(el) {
  const out = [el];
  if (el.childElementCount) {
    const d = el.querySelectorAll("*");
    if (d.length <= 80) for (const x of d) out.push(x);
  }
  return out;
}

function tintRead(els) {
  return els.map((e) => {
    const cs = getComputedStyle(e), v = {};
    for (const p of TINT_PROPS) v[p] = cs.getPropertyValue(p);
    return v;
  });
}

// Everything under one element moves together: every running override is dropped first and
// every target read before any animation starts (a child must not read its parent's half-way
// colour as its target), and the whole group shares one start, so a tile's background, its
// icon box and its icon never drift apart.
function tintDiff(els, before) {
  for (const e of els) {
    const mt = e.__mt;
    if (mt) for (const p in mt) { mt[p].dead = true; e.style.removeProperty(p); delete mt[p]; }   // read the CSS target, not our override
  }
  const after = els.map((e) => {
    const cs = getComputedStyle(e), v = {};
    for (const p of TINT_PROPS) v[p] = cs.getPropertyValue(p);
    return v;
  });
  let delay = null;
  els.forEach((e, i) => {
    for (const p of TINT_PROPS) {
      if (e.style.getPropertyValue(p)) continue;         // a card writes this one itself
      const a = before[i][p], b = after[i][p];
      if (a === b || !COLOR_FN.test(a) || !COLOR_FN.test(b)) continue;
      if (delay === null) delay = Motion.stagger();
      const anim = Motion.start(new MotionAnim(0, 1, MOTION.blend, delay, (t) => {
        e.style.setProperty(p, t >= 0.998 ? b : `color-mix(in oklab, ${b} ${(t * 100).toFixed(1)}%, ${a})`);
      }, () => { e.style.removeProperty(p); if (e.__mt?.[p] === anim) delete e.__mt[p]; }));
      (e.__mt || (e.__mt = {}))[p] = anim;
    }
  });
}

// "3 of 6 on" -> "2 of 6 on": the same words around a different number ticks
// The elements a partial roll can draw in (the ones that may hold a shadow root).
const PART_HOSTS = new Set(["span", "div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "section", "header", "footer", "article", "aside", "main", "nav", "blockquote"]);
// What two values share at the start and the end, and what changed between: { pre, oldMid, newMid, suf }, or null
// when nothing is shared (the whole value rolls). A change that touches letters takes whole words, so a word
// never rolls a few of its letters ("Playing" to "Paused" changes the word); digits change on their own, like an
// odometer ("17%" to "19%" rolls the 7, "22.0" to "22.5" the last digit).
function rollParts(a, b) {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const letters = /\p{L}/u;
  if (letters.test(a.slice(p, a.length - s)) || letters.test(b.slice(p, b.length - s))) {
    // widen to whole words: back to a space before, on to a space after
    while (p > 0 && !/\s/.test(a[p - 1])) p--;
    while (s > 0 && !/\s/.test(a[a.length - s])) s--;
  }
  if (!p && !s) return null;
  return { pre: a.slice(0, p), oldMid: a.slice(p, a.length - s), newMid: b.slice(p, b.length - s), suf: a.slice(a.length - s) };
}

function tickParts(a, b) {
  const ma = NUM_RE.exec(a), mb = NUM_RE.exec(b);
  if (!ma || !mb) return null;
  const sa = a.replace(NUM_RE, "#");
  if (sa !== b.replace(NUM_RE, "#")) return null;
  const na = Number(ma[0]), nb = Number(mb[0]);
  if (na === nb || !Number.isFinite(na) || !Number.isFinite(nb)) return null;
  const dec = Math.max((ma[0].split(".")[1] || "").length, (mb[0].split(".")[1] || "").length);
  return { sa, na, nb, dec };
}

// the card's state glow, unless the card (or the Savvy settings) turned it off
// A tile that throws light (design: glass): the colour, and how strongly 0..1; no colour is dark.
const lit = (el, rgb, level = 1) => {
  if (!el) return;
  el.toggleAttribute("data-light", true);
  if (rgb) el.style.setProperty("--lc", rgb.map((v) => Math.round(Number(v))).join(" "));
  el.style.setProperty("--on", rgb ? Math.max(0, Math.min(1, level)).toFixed(2) : "0");
};
// ...in the colour another element (the icon) is showing right now; dark when it is not on screen yet or not active.
const litFrom = (el, src, level = 1, active = true) => {
  const c = active && src?.isConnected && getComputedStyle(src).color.match(/[\d.]+/g);
  lit(el, c ? c.slice(0, 3) : null, level);
};
const stateGlow = (config, el, rgb, level = 1) => Motion.glow(el, config && config.state_glow === false ? null : rgb, level);
