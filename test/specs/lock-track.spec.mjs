// The lock slide in a popup: the lock's own icon is the handle. It rests at the start of its row; a
// deliberate drag across the row does the opposite of what the lock is now; the end is held until a ring
// fills before the latch opens; a lock that can't open has one stop; a tap only nudges; the keyboard.
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
  window.rowOf = (id) => window.__savvy.portalRoot().querySelector(`.sv-row[data-id="${id}"]`);
};

// where the handle is, and the travel of the row's track
const geom = (page, id) => page.evaluate((id) => {
  const row = window.rowOf(id), s = row.__ctrl.slide;
  s.measure();
  const hr = s.handle.getBoundingClientRect(), r = s.host.getBoundingClientRect();
  return { x: hr.x + hr.width / 2, y: hr.y + hr.height / 2, left: r.x, W: r.width, T: s.T, H: s.H, L: s.L };
}, id);
const read = (page, id) => page.evaluate((id) => {
  const row = window.rowOf(id), s = row.__ctrl.slide, h = s.handle, host = s.host;
  const tx = /translateX\(([-\d.]+)px\)/.exec(h.style.transform);
  const op = (c) => Number(s.icons[c].style.opacity || 0);
  return { x: tx ? Number(tx[1]) / s.T : 0, text: h.getAttribute("aria-valuetext"), stops: host.dataset.stops, sub: row.querySelector(".sv-sub").textContent,
    armed: host.hasAttribute("data-armed"), drag: host.hasAttribute("data-drag"), busy: host.hasAttribute("data-busy"), bad: host.hasAttribute("data-bad"),
    ring: s.ring.style.strokeDashoffset, gh: Number(host.style.getPropertyValue("--gh") || 0), cov: Number(h.style.getPropertyValue("--cov") || 0),
    icons: [op(0), op(1), op(2)], fill: parseFloat(s.fill.style.width || 0), g1: s.g1.textContent, g2: s.g2.textContent, g1o: Number(s.g1.style.opacity || 0) };
}, id);
const log = (page) => page.evaluate(() => [...window.log]);
const clear = (page) => page.evaluate(() => { window.log.length = 0; window.info.length = 0; });

// finger down on the handle, drag to `toFrac` of the track, hold, let go
async function drag(page, id, toFrac, { hold = 0, release = true, steps = 14 } = {}) {
  const g = await geom(page, id);
  await page.mouse.move(g.x, g.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(g.x + (toFrac * g.T * i) / steps, g.y);
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

    // the starting point: one line, the handle at the start, no track showing
    const a0 = await read(page, "lock.nuki"), s0 = await read(page, "lock.simple");
    const lines = await page.evaluate(() => [...window.__savvy.portalRoot().querySelectorAll('.sv-row[data-kind="lock"]')].map((r) => Math.round(r.getBoundingClientRect().height)));
    check(`${tag} a lock that can open has two stops ahead, one that can't has one`, a0.stops === "3" && s0.stops === "2", JSON.stringify([a0, s0]));
    check(`${tag} it starts Locked, the handle at the start, the row saying so and when it last changed`, a0.text === "Locked" && Math.abs(a0.x) < 0.01 && /Locked · 3 h ago/.test(a0.sub) && a0.gh < 0.05, JSON.stringify(a0));
    check(`${tag} a lock row is one line`, lines.every((h) => h <= 54), JSON.stringify(lines));

    // a tap on the handle only nudges it: nothing is sent, nothing opens
    const g0 = await geom(page, "lock.nuki");
    await clear(page);
    await page.mouse.click(g0.x, g0.y);
    await page.waitForTimeout(500);
    check(`${tag} a tap on the handle does nothing but nudge`, (await log(page)).length === 0 && (await page.evaluate(() => window.info.length)) === 0 && Math.abs((await read(page, "lock.nuki")).x) < 0.02);

    // an early release springs back; nothing is sent
    await drag(page, "lock.nuki", 0.12);
    await page.waitForTimeout(700);
    check(`${tag} letting go early springs back and sends nothing`, (await log(page)).length === 0 && Math.abs((await read(page, "lock.nuki")).x) < 0.02, JSON.stringify([await log(page), await read(page, "lock.nuki")]));

    // while dragging the row is the track: fill, ghost stops, the knob and the icon of what it would become
    await drag(page, "lock.nuki", 0.5, { release: false });
    await page.waitForTimeout(250);
    const mid = await read(page, "lock.nuki");
    check(`${tag} while dragging the track shows: a fill, the ghost stops, the knob, the next icon`, mid.drag && mid.gh > 0.8 && mid.cov > 0.8 && mid.fill > 30 && mid.g1 === "Unlock" && mid.g2 === "Open" && mid.icons[1] > 0.8, JSON.stringify(mid));
    await page.mouse.up();
    await page.waitForTimeout(80);
    const sent = await read(page, "lock.nuki");
    await page.waitForTimeout(650);
    const a1 = await read(page, "lock.nuki");
    check(`${tag} sliding past the first stop unlocks, once`, JSON.stringify(await log(page)) === JSON.stringify(["lock.unlock {} lock.nuki"]), JSON.stringify(await log(page)));
    check(`${tag} the handle comes back to the start and the row says Unlocking…`, Math.abs(a1.x) < 0.02 && /Unlocking…/.test(a1.sub) && a1.busy && a1.icons[1] > 0.8, JSON.stringify([sent, a1]));
    await page.evaluate(() => window.push("lock.nuki", "unlocked"));
    await page.waitForTimeout(600);
    const a2 = await read(page, "lock.nuki");
    check(`${tag} once HA reports it: Unlocked, no track, the handle at the start`, a2.text === "Unlocked" && /^Unlocked/.test(a2.sub) && !a2.busy && Math.abs(a2.x) < 0.02 && a2.gh < 0.05 && a2.cov < 0.05, JSON.stringify(a2));

    // the same slide now locks it
    await clear(page);
    await drag(page, "lock.nuki", 0.5, { release: false });
    await page.waitForTimeout(250);
    const mid2 = await read(page, "lock.nuki");
    await page.mouse.up();
    await page.waitForTimeout(700);
    check(`${tag} the same slide locks it, the ghost stop saying Lock`, mid2.g1 === "Lock" && JSON.stringify(await log(page)) === JSON.stringify(["lock.lock {} lock.nuki"]), JSON.stringify([mid2, await log(page)]));
    await page.evaluate(() => window.push("lock.nuki", "locked"));
    await page.waitForTimeout(500);

    // Open: the end must be held until the ring fills, then released
    await page.evaluate(() => window.push("lock.nuki", "unlocked"));
    await page.waitForTimeout(700);
    await clear(page);
    await drag(page, "lock.nuki", 1.0, { hold: 200 });
    const early = await read(page, "lock.nuki");
    await page.mouse.up();
    await page.waitForTimeout(700);
    check(`${tag} the end held for too short a time arms nothing, and letting go does nothing`, !early.armed && parseFloat(early.ring) > 20 && (await log(page)).length === 0 && Math.abs((await read(page, "lock.nuki")).x) < 0.02, JSON.stringify([early, await log(page)]));
    await drag(page, "lock.nuki", 1.0, { hold: HOLD, release: false });
    const held = await read(page, "lock.nuki");
    check(`${tag} held for half a second the ring is full and it is armed`, held.armed && Math.abs(held.x - 1) < 0.03 && parseFloat(held.ring) < 1 && held.icons[2] > 0.8, JSON.stringify(held));
    await page.mouse.up();
    await page.waitForTimeout(80);
    const fired = await read(page, "lock.nuki");
    check(`${tag} releasing opens the latch, once`, JSON.stringify(await log(page)) === JSON.stringify(["lock.open {} lock.nuki"]) && /Opening…/.test(fired.sub), JSON.stringify([await log(page), fired]));
    await page.waitForTimeout(1000);
    const settled = await read(page, "lock.nuki");
    check(`${tag} then the handle is back at the start and nothing is armed`, Math.abs(settled.x) < 0.02 && !settled.armed, JSON.stringify(settled));
    // dragging out of the end before the ring is full cancels it
    await clear(page);
    await drag(page, "lock.nuki", 1.0, { hold: 300, release: false });
    const g2 = await geom(page, "lock.nuki");
    await page.mouse.move(g2.x - g2.T * 0.2, g2.y);
    await page.waitForTimeout(400);
    await page.mouse.up();
    await page.waitForTimeout(500);
    // 0.8 of the travel is past the first stop: that is the slide, and it locks
    check(`${tag} leaving the end cancels the hold (a release past the first stop is then the ordinary slide)`, JSON.stringify(await log(page)) === JSON.stringify(["lock.lock {} lock.nuki"]), JSON.stringify(await log(page)));
    await page.evaluate(() => window.push("lock.nuki", "locked"));
    await page.waitForTimeout(500);

    // a lock without the open feature: one stop, at the end
    await clear(page);
    await drag(page, "lock.simple", 0.3);
    await page.waitForTimeout(500);
    const none = await log(page);
    await drag(page, "lock.simple", 1.0, { hold: HOLD, release: false });
    const sAtEnd = await read(page, "lock.simple");
    await page.mouse.up();
    await page.waitForTimeout(700);
    check(`${tag} a one-stop slide needs most of the row, unlocks, and never arms`, none.length === 0 && JSON.stringify(await log(page)) === JSON.stringify(["lock.unlock {} lock.simple"]) && !sAtEnd.armed && sAtEnd.g1 === "" && sAtEnd.g2 === "Unlock", JSON.stringify([none, await log(page), sAtEnd]));

    // the states HA reports: open (the slide locks), jammed, locking
    await page.evaluate(() => { window.push("lock.simple", "locked"); window.push("lock.nuki", "open"); });
    await page.waitForTimeout(700);
    const op = await read(page, "lock.nuki");
    check(`${tag} an open lock rests at the start too, saying Open, with the door icon`, op.text === "Open" && Math.abs(op.x) < 0.02 && /^Open/.test(op.sub), JSON.stringify(op));
    await clear(page);
    await drag(page, "lock.nuki", 0.7);
    await page.waitForTimeout(500);
    check(`${tag} sliding an open lock locks it`, JSON.stringify(await log(page)) === JSON.stringify(["lock.lock {} lock.nuki"]), JSON.stringify(await log(page)));
    await page.waitForTimeout(1600);     // the slide's own "Locking…" waits 1.5 s for the house to agree; a jam is news after that
    await page.evaluate(() => window.push("lock.nuki", "jammed"));
    await page.waitForTimeout(500);
    const jam = await read(page, "lock.nuki");
    check(`${tag} a jammed lock says so, in red`, /^Jammed/.test(jam.sub) && jam.bad, JSON.stringify(jam));
    await page.evaluate(() => window.push("lock.nuki", "locking"));
    await page.waitForTimeout(500);
    const lg = await read(page, "lock.nuki");
    check(`${tag} a lock that is locking shows Locking…`, /Locking…/.test(lg.sub) && lg.busy, JSON.stringify(lg));
    await page.evaluate(() => window.push("lock.nuki", "locked"));
    await page.waitForTimeout(400);

    // HA never answering: the guess lapses back to what the lock really is
    await clear(page);
    await drag(page, "lock.nuki", 0.52);
    await page.waitForTimeout(300);
    const guessed = await read(page, "lock.nuki");
    await page.waitForTimeout(1500);
    const lapsed = await read(page, "lock.nuki");
    check(`${tag} a guess HA never confirms lapses back to Locked`, /Unlocking…/.test(guessed.sub) && lapsed.text === "Locked" && !/Unlocking/.test(lapsed.sub), JSON.stringify([guessed, lapsed]));

    // touch: a sideways swipe moves the handle; a vertical one is left to the page
    await clear(page);
    const touch = (type, id, x, y) => page.evaluate(({ type, id, x, y }) => {
      const h = window.rowOf(id).__ctrl.slide.handle;
      h.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: type === "pointerup" ? 0 : 1, bubbles: true, composed: true }));
    }, { type, id, x, y });
    const g3 = await geom(page, "lock.nuki");
    await touch("pointerdown", "lock.nuki", g3.x, g3.y);
    await touch("pointermove", "lock.nuki", g3.x + 3, g3.y + 40);
    await touch("pointermove", "lock.nuki", g3.x + 6, g3.y + 90);
    const vert = await read(page, "lock.nuki");
    await touch("pointerup", "lock.nuki", g3.x + 6, g3.y + 90);
    check(`${tag} a vertical swipe on the handle is left to the page`, !vert.drag && (await log(page)).length === 0, JSON.stringify([vert, await log(page)]));
    await touch("pointerdown", "lock.nuki", g3.x, g3.y);
    for (let i = 1; i <= 10; i++) await touch("pointermove", "lock.nuki", g3.x + (g3.T * 0.55 * i) / 10, g3.y);
    const horiz = await read(page, "lock.nuki");
    await touch("pointerup", "lock.nuki", g3.x + g3.T * 0.55, g3.y);
    await page.waitForTimeout(300);
    check(`${tag} a sideways touch drag moves the handle and unlocks`, horiz.drag && JSON.stringify(await log(page)) === JSON.stringify(["lock.unlock {} lock.nuki"]), JSON.stringify([horiz, await log(page)]));
    await page.evaluate(() => window.push("lock.nuki", "unlocked"));
    await page.waitForTimeout(700);

    // the keyboard: arrows lock and unlock; Open needs Enter held for half a second
    await clear(page);
    await page.evaluate(() => window.rowOf("lock.nuki").__ctrl.slide.handle.focus());
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
    const aria = await page.evaluate(() => { const h = window.rowOf("lock.nuki").__ctrl.slide.handle; return [h.getAttribute("role"), h.getAttribute("aria-valuetext"), h.tabIndex]; });
    check(`${tag} the handle is a slider with words for its stops`, aria[0] === "slider" && /^(Locked|Unlocked|Open)$/.test(aria[1]) && aria[2] === 0, JSON.stringify(aria));

    // tapping the name still opens more-info
    await clear(page);
    await page.evaluate(() => window.rowOf("lock.nuki").querySelector(".sv-main .sv-name").click());
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
    check("[reduced motion] the handle is back at once, without overshoot, and unlock was sent", Math.abs(r.x) < 0.005 && JSON.stringify(await log(page)) === JSON.stringify(["lock.unlock {} lock.nuki"]), JSON.stringify(r));
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
