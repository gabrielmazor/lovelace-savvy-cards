// The lock track in a popup: three stops (Locked, Unlocked, Open) on one track, a deliberate
// drag to move between them, the end held until a ring fills before the latch opens, a
// two-stop track for a lock that can't open, the keyboard, and what the row says meanwhile.
import { openPage } from "./_util.mjs";

const HOLD = 650;   // longer than the 500 ms the end has to be held

// a made-up pair of locks, a popup that lists them, and a way to hand it new states
const SETUP = () => {
  const add = (id, state, attributes, area) => {
    window.house.states[id] = { entity_id: id, state, attributes, last_changed: new Date(Date.now() - 3 * 3600000).toISOString(), last_updated: new Date().toISOString() };
    window.house.entities[id] = { entity_id: id, area_id: area, device_id: null, platform: "demo", entity_category: null, hidden: false, disabled_by: null };
  };
  add("lock.nuki", "locked", { friendly_name: "Front Door", supported_features: 1 }, "hallway");
  add("lock.simple", "locked", { friendly_name: "Garage Lock" }, "kitchen");
  window.hass = { ...window.hass, states: { ...window.house.states } };
  const host = document.createElement("div");
  host.attachShadow({ mode: "open" }).innerHTML = "<button id=o>open</button>";
  document.body.appendChild(host);
  window.list = new window.__savvy.EntityListSheet(host, { title: "Locks" });
  window.list.show(window.hass, ["lock.nuki", "lock.simple"], host.shadowRoot.getElementById("o"));
  window.info = [];
  document.addEventListener("hass-more-info", (e) => window.info.push(e.detail.entityId));
  window.push = (id, state, extra = {}) => {
    window.setStates({ [id]: { entity_id: id, state, attributes: { ...window.house.states[id].attributes, ...extra } } });
    window.list.render(window.hass);
  };
};

const geom = (page, id) => page.evaluate((id) => {
  const row = window.__savvy.portalRoot().querySelector(`.sv-row[data-id="${id}"]`);
  const lk = row.querySelector(".sv-lk"), k = lk.querySelector(".sv-lk-knob").getBoundingClientRect(), r = lk.getBoundingClientRect();
  return { knobX: k.x + k.width / 2, y: k.y + k.height / 2, left: r.x, W: r.width, T: r.width - 36 };
}, id);
const frac = (g) => (g.knobX - g.left - 14) / g.T;
const read = (page, id) => page.evaluate((id) => {
  const row = window.__savvy.portalRoot().querySelector(`.sv-row[data-id="${id}"]`), lk = row.querySelector(".sv-lk");
  const tx = /translateX\(([-\d.]+)px\)/.exec(lk.querySelector(".sv-lk-knob").style.transform);
  const T = lk.clientWidth - 36;
  return { x: tx ? Number(tx[1]) / T : null, text: lk.getAttribute("aria-valuetext"), stops: lk.dataset.stops, sub: row.querySelector(".sv-sub").textContent,
    armed: lk.hasAttribute("data-armed"), drag: lk.hasAttribute("data-drag"), busy: lk.hasAttribute("data-busy"), bad: lk.hasAttribute("data-bad"), ring: lk.querySelector(".sv-lk-ring circle").style.strokeDashoffset };
}, id);
const log = (page) => page.evaluate(() => [...window.log]);
const clear = (page) => page.evaluate(() => { window.log.length = 0; window.info.length = 0; });

// finger down on the knob, drag it to `toFrac` of the track (as the finger sees it), hold, let go
async function drag(page, id, toFrac, { hold = 0, release = true, steps = 14 } = {}) {
  const g = await geom(page, id), f0 = frac(g);
  await page.mouse.move(g.knobX, g.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(g.knobX + ((toFrac - f0) * g.T * i) / steps, g.y);
  if (hold) await page.waitForTimeout(hold);
  if (release) await page.mouse.up();
}

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [420, 340]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(SETUP);
    await page.waitForTimeout(700);

    // the starting point
    const a0 = await read(page, "lock.nuki"), s0 = await read(page, "lock.simple");
    check(`${tag} a lock that can open has three stops, one that can't has two`, a0.stops === "3" && s0.stops === "2", JSON.stringify([a0, s0]));
    check(`${tag} it starts on Locked, the row saying so and when it last changed`, a0.text === "Locked" && Math.abs(a0.x) < 0.01 && /Locked · 3 h ago/.test(a0.sub), JSON.stringify(a0));

    // a tap on the track does nothing
    const g0 = await geom(page, "lock.nuki");
    await clear(page);
    await page.mouse.click(g0.left + g0.W * 0.6, g0.y);
    await page.waitForTimeout(250);
    check(`${tag} a tap on the track does nothing`, (await log(page)).length === 0 && (await page.evaluate(() => window.info.length)) === 0 && Math.abs((await read(page, "lock.nuki")).x) < 0.01);

    // an early release springs back; nothing is sent
    await drag(page, "lock.nuki", 0.12);
    await page.waitForTimeout(700);
    check(`${tag} letting go early springs back to Locked and sends nothing`, (await log(page)).length === 0 && Math.abs((await read(page, "lock.nuki")).x) < 0.02, JSON.stringify([await log(page), await read(page, "lock.nuki")]));

    // slide to Unlocked: snaps to the middle stop and unlocks; the row says so until HA agrees
    await drag(page, "lock.nuki", 0.52);
    await page.waitForTimeout(80);
    const mid = await read(page, "lock.nuki");
    await page.waitForTimeout(650);
    const a1 = await read(page, "lock.nuki");
    check(`${tag} sliding to the middle unlocks, once`, JSON.stringify(await log(page)) === JSON.stringify(["lock.unlock {} lock.nuki"]), JSON.stringify(await log(page)));
    check(`${tag} the knob snaps onto the Unlocked stop and the row says Unlocking…`, Math.abs(a1.x - 0.5) < 0.02 && /Unlocking…/.test(a1.sub) && a1.busy, JSON.stringify([mid, a1]));
    await page.evaluate(() => window.push("lock.nuki", "unlocked"));
    await page.waitForTimeout(500);
    const a2 = await read(page, "lock.nuki");
    check(`${tag} once HA reports it, Unlocked`, a2.text === "Unlocked" && /^Unlocked/.test(a2.sub) && !a2.busy && Math.abs(a2.x - 0.5) < 0.02, JSON.stringify(a2));

    // slide back: locks
    await clear(page);
    await drag(page, "lock.nuki", 0.0);
    await page.waitForTimeout(700);
    check(`${tag} sliding back locks`, JSON.stringify(await log(page)) === JSON.stringify(["lock.lock {} lock.nuki"]), JSON.stringify(await log(page)));
    await page.evaluate(() => window.push("lock.nuki", "locked"));
    await page.waitForTimeout(500);

    // Open: past Unlocked it gets heavy, the end must be held until the ring fills, then released
    await page.evaluate(() => window.push("lock.nuki", "unlocked"));
    await page.waitForTimeout(700);
    await clear(page);
    await drag(page, "lock.nuki", 1.0, { hold: 200 });
    const early = await read(page, "lock.nuki");
    await page.mouse.up();
    await page.waitForTimeout(700);
    const earlyEnd = await read(page, "lock.nuki");
    check(`${tag} the end held for too short a time arms nothing`, !early.armed && parseFloat(early.ring) > 20 && (await log(page)).length === 0, JSON.stringify([early, await log(page)]));
    check(`${tag} ...and letting go springs back to Unlocked`, Math.abs(earlyEnd.x - 0.5) < 0.02, JSON.stringify(earlyEnd));
    await drag(page, "lock.nuki", 1.0, { hold: HOLD, release: false });
    const held = await read(page, "lock.nuki");
    check(`${tag} held for half a second the ring is full and it is armed`, held.armed && Math.abs(held.x - 1) < 0.03 && parseFloat(held.ring) < 1, JSON.stringify(held));
    await page.mouse.up();
    await page.waitForTimeout(80);
    const fired = await read(page, "lock.nuki");
    check(`${tag} releasing opens the latch, once`, JSON.stringify(await log(page)) === JSON.stringify(["lock.open {} lock.nuki"]) && /Opening…/.test(fired.sub), JSON.stringify([await log(page), fired]));
    await page.waitForTimeout(1000);
    const settled = await read(page, "lock.nuki");
    check(`${tag} then the knob settles back on Unlocked`, Math.abs(settled.x - 0.5) < 0.02 && !settled.armed, JSON.stringify(settled));
    // dragging out of the end before the ring is full cancels it
    await clear(page);
    await drag(page, "lock.nuki", 1.0, { hold: 300, release: false });
    const g2 = await geom(page, "lock.nuki");
    await page.mouse.move(g2.knobX - g2.T * 0.2, g2.y);
    await page.waitForTimeout(400);
    await page.mouse.up();
    await page.waitForTimeout(500);
    check(`${tag} leaving the end cancels the hold`, (await log(page)).length === 0, JSON.stringify(await log(page)));

    // a lock without the open feature: the end of the track is just Unlocked
    await clear(page);
    await drag(page, "lock.simple", 1.0, { hold: HOLD });
    const sAtEnd = await read(page, "lock.simple");
    await page.waitForTimeout(700);
    check(`${tag} a two-stop track unlocks at its end and never arms`, JSON.stringify(await log(page)) === JSON.stringify(["lock.unlock {} lock.simple"]) && !sAtEnd.armed, JSON.stringify([await log(page), sAtEnd]));

    // the states HA reports: open, jammed, locking
    await page.evaluate(() => { window.push("lock.simple", "locked"); window.push("lock.nuki", "open"); });
    await page.waitForTimeout(700);
    const op = await read(page, "lock.nuki");
    check(`${tag} an open lock rests at the far end`, op.text === "Open" && Math.abs(op.x - 1) < 0.02 && /^Open/.test(op.sub), JSON.stringify(op));
    await page.evaluate(() => window.push("lock.nuki", "jammed"));
    await page.waitForTimeout(500);
    const jam = await read(page, "lock.nuki");
    check(`${tag} a jammed lock says so, in red`, /^Jammed/.test(jam.sub) && jam.bad, JSON.stringify(jam));
    await page.evaluate(() => window.push("lock.nuki", "locking"));
    await page.waitForTimeout(500);
    const lg = await read(page, "lock.nuki");
    check(`${tag} a lock that is locking shows Locking… with the knob going to Locked`, /Locking…/.test(lg.sub) && lg.busy && Math.abs(lg.x) < 0.02, JSON.stringify(lg));
    await page.evaluate(() => window.push("lock.nuki", "locked"));
    await page.waitForTimeout(400);

    // HA never answering: the guess lapses and the knob goes back to what the lock really is
    await clear(page);
    await drag(page, "lock.nuki", 0.52);
    await page.waitForTimeout(300);
    const guessed = await read(page, "lock.nuki");
    await page.waitForTimeout(1500);
    const lapsed = await read(page, "lock.nuki");
    check(`${tag} a guess HA never confirms lapses back to Locked`, Math.abs(guessed.x - 0.5) < 0.05 && /Unlocking…/.test(guessed.sub) && lapsed.text === "Locked" && Math.abs(lapsed.x) < 0.02, JSON.stringify([guessed, lapsed]));

    // touch: a sideways swipe moves the knob; a vertical one is left to the page
    await clear(page);
    const touch = (type, id, x, y) => page.evaluate(({ type, id, x, y }) => {
      const lk = window.__savvy.portalRoot().querySelector(`.sv-row[data-id="${id}"] .sv-lk`);
      lk.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: type === "pointerup" ? 0 : 1, bubbles: true, composed: true }));
    }, { type, id, x, y });
    const g3 = await geom(page, "lock.nuki");
    await touch("pointerdown", "lock.nuki", g3.knobX, g3.y);
    await touch("pointermove", "lock.nuki", g3.knobX + 3, g3.y + 40);
    await touch("pointermove", "lock.nuki", g3.knobX + 6, g3.y + 90);
    const vert = await read(page, "lock.nuki");
    await touch("pointerup", "lock.nuki", g3.knobX + 6, g3.y + 90);
    check(`${tag} a vertical swipe on the track is left to the page`, !vert.drag && (await log(page)).length === 0, JSON.stringify([vert, await log(page)]));
    await touch("pointerdown", "lock.nuki", g3.knobX, g3.y);
    for (let i = 1; i <= 10; i++) await touch("pointermove", "lock.nuki", g3.knobX + (g3.T * 0.55 * i) / 10, g3.y);
    const horiz = await read(page, "lock.nuki");
    await touch("pointerup", "lock.nuki", g3.knobX + g3.T * 0.55, g3.y);
    await page.waitForTimeout(300);
    check(`${tag} a sideways touch drag moves the knob and unlocks`, horiz.drag && JSON.stringify(await log(page)) === JSON.stringify(["lock.unlock {} lock.nuki"]), JSON.stringify([horiz, await log(page)]));
    await page.evaluate(() => window.push("lock.nuki", "unlocked"));
    await page.waitForTimeout(700);

    // the keyboard: arrows lock and unlock; Open needs Enter held for half a second
    await clear(page);
    await page.evaluate(() => window.__savvy.portalRoot().querySelector('.sv-row[data-id="lock.nuki"] .sv-lk').focus());
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(200);
    await page.evaluate(() => window.push("lock.nuki", "locked"));
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(200);
    check(`${tag} the arrow keys lock and unlock`, JSON.stringify(await log(page)) === JSON.stringify(["lock.lock {} lock.nuki", "lock.unlock {} lock.nuki"]), JSON.stringify(await log(page)));
    await page.evaluate(() => window.push("lock.nuki", "unlocked"));
    await page.waitForTimeout(600);
    await clear(page);
    await page.keyboard.down("Enter");
    await page.waitForTimeout(150);
    await page.keyboard.up("Enter");
    await page.waitForTimeout(300);
    const quick = await log(page);
    await page.keyboard.down("Enter");
    await page.waitForTimeout(HOLD);
    await page.keyboard.up("Enter");
    await page.waitForTimeout(200);
    check(`${tag} Enter pressed briefly opens nothing; held half a second it does`, quick.length === 0 && JSON.stringify(await log(page)) === JSON.stringify(["lock.open {} lock.nuki"]), JSON.stringify([quick, await log(page)]));
    const aria = await page.evaluate(() => { const lk = window.__savvy.portalRoot().querySelector('.sv-row[data-id="lock.nuki"] .sv-lk'); return [lk.getAttribute("role"), lk.getAttribute("aria-valuetext"), lk.tabIndex]; });
    check(`${tag} the track is a slider with words for its stops`, aria[0] === "slider" && /^(Locked|Unlocked|Open)$/.test(aria[1]) && aria[2] === 0, JSON.stringify(aria));

    // tapping the name still opens more-info
    await clear(page);
    await page.evaluate(() => window.__savvy.portalRoot().querySelector('.sv-row[data-id="lock.nuki"] .sv-main .sv-name').click());
    await page.waitForTimeout(100);
    check(`${tag} the name area opens more-info`, (await page.evaluate(() => window.info))[0] === "lock.nuki");

    await page.waitForTimeout(1200);
    check(`${tag} the clock goes to sleep`, await page.evaluate(() => window.__savvy.Clock.jobs.size === 0), "jobs left");
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // reduced motion: no overshoot, everything still works
  {
    const { page, errors } = await openPage(browser, base, { theme: "dark", width: 420 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 420, height: 900 });
    await page.evaluate(SETUP);
    await page.waitForTimeout(700);
    await drag(page, "lock.nuki", 0.52);
    await page.waitForTimeout(120);
    const r = await read(page, "lock.nuki");
    check("[reduced motion] the knob lands on the stop at once, without overshoot", Math.abs(r.x - 0.5) < 0.005 && JSON.stringify(await log(page)) === JSON.stringify(["lock.unlock {} lock.nuki"]), JSON.stringify(r));
    await page.evaluate(() => window.push("lock.nuki", "unlocked"));
    await page.waitForTimeout(300);
    await clear(page);
    await drag(page, "lock.nuki", 1.0, { hold: HOLD, release: false });
    await page.mouse.up();
    await page.waitForTimeout(150);
    check("[reduced motion] open still needs the held end", JSON.stringify(await log(page)) === JSON.stringify(["lock.open {} lock.nuki"]), JSON.stringify(await log(page)));
    check("[reduced motion] no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
