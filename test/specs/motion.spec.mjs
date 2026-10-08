// The motion pass: colours slide, text rolls and ticks, rows and badges move to their places,
// changes that land together ripple, everything is interruptible, nothing moves on a first
// paint or under reduced motion, and the clock goes back to sleep.
import { openPage, idle, afterChange, frames, settle } from "./_util.mjs";

// a bare shadow-root host with two coloured boxes, a text line and a flex row
const HOST = `
  const host = document.createElement("div");
  document.getElementById("stage").appendChild(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = '<style>'
    + '.t { width: 40px; height: 20px; background: rgb(0, 0, 255); } .t[data-on] { background: rgb(255, 0, 0); }'
    + '#v { display: block; width: 120px; font-size: 14px; color: rgb(30, 30, 30); }'
    + '#row { display: flex; gap: 8px; width: 400px; } #row > i { display: block; flex: none; width: 50px; height: 20px; background: gray; }'
    + '</style><div id="boxes"></div><span id="v"></span><div id="row"></div>';
  window.root = root;
  window.boxes = [];
  for (let i = 0; i < 6; i++) {
    const b = document.createElement("div");
    b.className = "t";
    root.getElementById("boxes").appendChild(b);
    window.__savvy.attr(b, "data-on", null);
    window.boxes.push(b);
  }
  window.v = root.getElementById("v");
  window.__savvy.text(window.v, "10 on");
  window.row = root.getElementById("row");
  for (const n of ["a", "b", "c"]) {
    const k = document.createElement("i");
    k.id = n;
    window.row.appendChild(k);
  }
`;

// The red-green axis (oklab "a") of any colour string the browser hands back (rgb, color(srgb), oklab):
// blue is about -0.03 and red about +0.22, so it runs one way across a blue-to-red slide.
const okA = (c) => {
  const n = String(c).match(/-?\d*\.?\d+(?:e-?\d+)?/g)?.map(Number) || [];
  if (/^oklab\(/.test(c)) return n[1];
  const rgb = /^color\(/.test(c) ? n.slice(0, 3) : n.slice(0, 3).map((x) => x / 255);
  const lin = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * lin[0] + 0.5363325363 * lin[1] + 0.0514459929 * lin[2]);
  const m = Math.cbrt(0.2119034982 * lin[0] + 0.6806995451 * lin[1] + 0.1073969566 * lin[2]);
  const sv = Math.cbrt(0.0883024619 * lin[0] + 0.2817188376 * lin[1] + 0.6299787005 * lin[2]);
  return 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * sv;
};
const A_BLUE = okA("rgb(0, 0, 255)"), A_RED = okA("rgb(255, 0, 0)");
const prog = (c) => (okA(c) - A_BLUE) / (A_RED - A_BLUE);    // 0 blue .. 1 red
const px = (v) => { const m = String(v).match(/-?\d*\.?\d+/); return m ? Number(m[0]) : 0; };

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [420, 340]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate(HOST);
    await page.evaluate(({ ok, ab, ar, pg }) => {
      window.okA = (0, eval)(`(${ok})`); window.A_BLUE = ab; window.A_RED = ar; window.prog = (0, eval)(`(${pg})`);
    }, { ok: okA.toString(), ab: A_BLUE, ar: A_RED, pg: prog.toString() });
    await page.waitForTimeout(250);

    // ---- first paint: the first value an element gets never animates
    const first = await page.evaluate(() => {
      const el = document.createElement("span");
      window.root.getElementById("boxes").appendChild(el);
      window.__savvy.text(el, "hello");
      return { rolling: el.hasAttribute("data-rolling"), busy: window.__savvy.Motion.busy() };
    });
    check(`${tag} first paint: a first value is written, never rolled`, !first.rolling && !first.busy, JSON.stringify(first));

    // ---- Tint: a state attribute flips and the colour slides, then lands exactly
    const tint = await afterChange(page, () => window.__savvy.attr(window.boxes[0], "data-on", ""), () => getComputedStyle(window.boxes[0]).backgroundColor, 1100);
    const distinct = new Set(tint);
    check(`${tag} tint: the colour passes through in-between values and ends exactly on the new one`,
      tint[0] !== "rgb(255, 0, 0)" && distinct.size >= 5 && tint[tint.length - 1] === "rgb(255, 0, 0)", `${distinct.size} distinct; ${tint[0]} -> ${tint[tint.length - 1]}`);
    const pr = tint.map(prog);
    const monotone = pr.every((x, i) => i === 0 || x >= pr[i - 1] - 0.02);
    check(`${tag} tint: it only ever heads one way (one smooth slide, ${pr.length} frames)`, pr.length > 8 && monotone && pr.some((x) => x > 0.2 && x < 0.8), pr.slice(0, 8).map((x) => x.toFixed(2)).join(" "));
    await settle(page);
    const clean = await page.evaluate(() => ({ inline: window.boxes[0].style.backgroundColor, busy: window.__savvy.Motion.busy() }));
    check(`${tag} tint: nothing is left behind when it settles (no inline colour, clock asleep)`, clean.inline === "" && !clean.busy, JSON.stringify(clean));

    // ---- interruption: reversing half way continues from where the colour is
    // (the slide takes about a third of a second, so a long frame in WebKit can be a quarter of it: a jump is anything near all of it)
    await page.evaluate(() => window.__savvy.attr(window.boxes[1], "data-on", ""));
    await page.waitForTimeout(1200);
    const rev = await afterChange(page, () => {
      window.__savvy.attr(window.boxes[1], "data-on", null);
      setTimeout(() => window.__savvy.attr(window.boxes[1], "data-on", ""), 110);
      setTimeout(() => window.__savvy.attr(window.boxes[1], "data-on", null), 230);
    }, () => getComputedStyle(window.boxes[1]).backgroundColor, 1300);
    const rp = rev.map(prog);
    const jump = Math.max(...rp.map((r, i) => (i ? Math.abs(r - rp[i - 1]) : 0)));
    check(`${tag} interruption: flipping back and forth mid-way never jumps (largest frame step ${(jump * 100).toFixed(0)}% of the slide)`,
      Number.isFinite(jump) && jump < 0.3 && Math.max(...rp) > 0.15 && rev[rev.length - 1] === "rgb(0, 0, 255)", `${rev[rev.length - 1]} max ${Math.max(...rp).toFixed(2)}`);

    // ---- Cascade: changes in the same tick start one after another, capped
    await settle(page);
    const starts = await afterChange(page, () => { for (let i = 2; i < 6; i++) window.__savvy.attr(window.boxes[i], "data-on", ""); window.t0 = performance.now(); window.begun = []; },
      () => {
        const now = performance.now();
        for (let i = 2; i < 6; i++) if (window.begun[i - 2] === undefined && window.prog(getComputedStyle(window.boxes[i]).backgroundColor) > 0.04) window.begun[i - 2] = now - window.t0;
        return window.begun.slice();
      }, 900);
    const begun = starts[starts.length - 1];
    const gaps = begun.map((t, i) => (i ? t - begun[i - 1] : 0)).slice(1);
    check(`${tag} cascade: four changes in one tick start in order, a beat apart (starts ${begun.map((t) => Math.round(t)).join(", ")} ms)`,
      begun.length === 4 && gaps.every((g) => g > 5) && begun[3] - begun[0] < 360, JSON.stringify(begun));
    await settle(page);

    // ---- Roll: a count ticks, words slide; the real text is final at once
    const tick = await afterChange(page, () => window.__savvy.text(window.v, "40 on"), () => ({ text: window.v.textContent, mode: window.v.getAttribute("data-rolling"), shown: window.v.getAttribute("data-in") }), 800);
    const shown = tick.map((s) => Number(String(s.shown).match(/\d+/)?.[0])).filter(Number.isFinite);
    check(`${tag} roll: a count ticks through its numbers while the text itself is final at once`,
      tick[0].text === "40 on" && tick[0].mode === "tick" && shown.some((n) => n > 10 && n < 40) && tick[tick.length - 1].mode === null && tick[tick.length - 1].text === "40 on",
      JSON.stringify(tick.slice(0, 3)));
    await page.waitForTimeout(300);
    const slide = await afterChange(page, () => window.__savvy.text(window.v, "Off"), () => ({ mode: window.v.getAttribute("data-rolling"), rl: window.v.style.getPropertyValue("--rl"), out: window.v.getAttribute("data-out") }), 800);
    const rls = slide.map((s) => Number(s.rl)).filter((n) => Number.isFinite(n) && n > 0 && n < 1);
    check(`${tag} roll: words slide (old out, new in) and clean up afterwards`,
      slide[0].mode === "slide" && slide[0].out === "40 on" && rls.length > 3 && slide[slide.length - 1].mode === null, JSON.stringify(slide.slice(0, 2)));

    // a value that changes every frame (a drag) never rolls more than once
    await page.waitForTimeout(400);
    const burst = await page.evaluate(async () => {
      let starts = 0;
      const mo = new MutationObserver((l) => { for (const m of l) if (m.attributeName === "data-rolling" && window.v.hasAttribute("data-rolling")) starts++; });
      mo.observe(window.v, { attributes: true });
      for (let i = 0; i < 24; i++) { window.__savvy.text(window.v, `${i * 4} %`); await new Promise((r) => requestAnimationFrame(r)); }
      mo.disconnect();
      return starts;
    });
    check(`${tag} roll: a value that changes every frame does not roll (${burst} start)`, burst <= 1, String(burst));
    await settle(page);

    // ---- Appear: rows slide to their places, newcomers grow in, leavers fade where they were
    const slideOver = await afterChange(page, () => window.__savvy.Motion.flip(window.row, () => window.row.querySelector("#a").remove()),
      () => ({ b: getComputedStyle(window.row.querySelector("#b")).translate, ghost: [...window.row.children].some((k) => k.__ghost) }), 900);
    const bx = slideOver.map((s) => px(s.b));
    check(`${tag} appear: the rows after a removed one slide into its place (from ${bx[0].toFixed(0)} px to 0)`,
      bx[0] > 40 && bx.some((x) => x > 4 && x < bx[0] - 4) && Math.abs(bx[bx.length - 1]) < 0.5, bx.slice(0, 8).map((x) => x.toFixed(0)).join(" "));
    check(`${tag} appear: the removed row stays and fades where it was, then goes`, slideOver.some((s) => s.ghost) && !slideOver[slideOver.length - 1].ghost, `ghost seen ${slideOver.some((s) => s.ghost)}`);
    const grow = await afterChange(page, () => window.__savvy.Motion.flip(window.row, () => { const k = document.createElement("i"); k.id = "d"; window.row.appendChild(k); }),
      () => getComputedStyle(window.row.querySelector("#d")).filter, 900);
    check(`${tag} appear: a newcomer fades and grows in`, grow.some((f) => /opacity\(0\.[0-9]+\)/.test(f)) && grow[grow.length - 1] === "none", `${grow[0]} -> ${grow[grow.length - 1]}`);
    const pop = await page.evaluate(() => {
      const empty = document.createElement("div");
      window.root.getElementById("boxes").appendChild(empty);
      window.__savvy.Motion.flip(empty, () => empty.appendChild(document.createElement("i")));
      return getComputedStyle(empty.firstChild).filter;
    });
    check(`${tag} appear: filling an empty box is a first population, not an event`, pop === "none", pop);
    await settle(page);

    check(`${tag} springs idle, the clock sleeps, no errors`, (await idle(page)) && errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ---- reduced motion: everything lands at once
  {
    const { page, errors } = await openPage(browser, base, { theme: "dark", width: 420 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(HOST);
    await page.waitForTimeout(250);
    const red = await page.evaluate(() => {
      window.__savvy.attr(window.boxes[0], "data-on", "");
      window.__savvy.text(window.v, "99 on");
      window.__savvy.Motion.flip(window.row, () => window.row.querySelector("#a").remove());
      return { inline: window.boxes[0].style.backgroundColor, rolling: window.v.hasAttribute("data-rolling"), ghost: [...window.row.children].some((k) => k.__ghost), busy: window.__savvy.Motion.busy() };
    });
    check("[reduced motion] colours, text and rows land at once, nothing animates", red.inline === "" && !red.rolling && !red.ghost && !red.busy, JSON.stringify(red));
    check("[reduced motion] no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ---- the user's example: tap the lights toggle and everything on the card moves
  for (const theme of ["dark", "light"]) for (const width of [520, 340]) {
    const tag = `[lights ${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate((width) => { window.mount("savvy-lights-card", { area: "living_room" }, width); }, width);
    await page.waitForTimeout(700);
    const run = await afterChange(page, () => window.setStates({ "light.living_room_ceiling": "off", "light.living_room_floor_lamp": "off", "light.living_room_strip": "off" }),
      () => {
        const R = window.cards[0].shadowRoot;
        // the orb is a bare icon: the colour that changes is its own (the lamp's colour going to grey)
        const orbs = [...R.querySelectorAll(".light:not([hidden]) .orb")].map((o) => getComputedStyle(o).color);
        return { orbs, pill: getComputedStyle(R.getElementById("master")).backgroundColor, count: R.getElementById("count").getAttribute("data-rolling"), text: R.getElementById("count").textContent, pillText: R.getElementById("masterText").textContent };
      }, 1200);
    const orbSeen = [0, 1].map((i) => new Set(run.map((s) => s.orbs[i])).size);
    check(`${tag} lights card: switching the room off slides the orbs' colours (not a jump)`, orbSeen.every((n) => n >= 4), `${orbSeen}`);
    check(`${tag} lights card: the pill slides too, and its count and words roll`, new Set(run.map((s) => s.pill)).size >= 4 && run.some((s) => s.count === "slide" || s.count === "tick"), `${new Set(run.map((s) => s.pill)).size}`);
    check(`${tag} lights card: the text is final at once ("${run[0].text}" / "${run[0].pillText}")`, run[0].text === "All off" && run[0].pillText === "Lights off", `${run[0].text} / ${run[0].pillText}`);
    check(`${tag} lights card: the orbs cascade (they do not all start in the same frame)`, (() => {
      const startOf = (i) => run.findIndex((s) => s.orbs[i] !== run[0].orbs[i]);
      return startOf(1) > startOf(0);
    })(), "");
    check(`${tag} lights card: settles, no errors`, (await idle(page)) && errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
