// savvy-lock-card: the door at a glance. Every state, the slide's gestures with the exact
// service calls, the door and battery, the unlocked-too-long nudge, the alarm row, the camera
// popup, several locks, compact, and the settings' default lock.
import { openPage } from "./_util.mjs";

const HOLD = 650;   // longer than the 500 ms the end has to be held

const settle = (page, ms = 700) => page.waitForTimeout(ms);   // page.waitForTimeout also waits for Motion (see _util calm)
const log = (page) => page.evaluate(() => [...window.log]);
const clear = (page) => page.evaluate(() => { window.log.length = 0; window.info.length = 0; });
const push = (page, patch) => page.evaluate((patch) => window.setStates(patch), patch);
const fixture = (page, o = {}) => page.evaluate((o) => window.setStates(window.entranceFixture(window.house, o)), o);
const mount = (page, cfg, width) => page.evaluate(({ cfg, width }) => { const el = window.mount("savvy-lock-card", cfg, width); return window.cards.indexOf(el); }, { cfg, width });

// everything the card says, per lock and for the card
const read = (page, i = 0) => page.evaluate((i) => {
  const R = window.cards[i].shadowRoot, q = (s, r = R) => r.querySelector(s);
  const locks = [...R.querySelectorAll(".lk")].map((n) => {
    const sl = n.__track, tx = /translateX\(([-\d.]+)px\)/.exec(sl.handle.style.transform);
    const door = q(".door", n), batt = q(".batt", n);
    return { name: q(".nm", n).textContent, state: q(".st", n).textContent, sub: q(".sub", n).textContent, tone: n.style.getPropertyValue("--tone"),
      door: door.hidden ? null : door.textContent.trim(), doorWarn: door.hasAttribute("data-warn"), doorIcon: q(".door ha-icon", n).getAttribute("icon"),
      batt: batt.hidden ? null : batt.textContent.trim(), battLevel: batt.getAttribute("data-level"), battIcon: q(".batt ha-icon", n).getAttribute("icon"),
      stops: sl.host.dataset.stops, x: tx ? Number(tx[1]) / sl.T : 0, text: sl.handle.getAttribute("aria-valuetext"), armed: sl.host.hasAttribute("data-armed"), busy: sl.host.hasAttribute("data-busy"),
      rowH: Math.round(sl.host.getBoundingClientRect().height), separateTrack: !!n.querySelector(".track") };
  });
  const alarmModes = [...R.querySelectorAll("#alarmModes .btn")].filter((b) => !b.hidden).map((b) => `${b.textContent.trim()}${b.hasAttribute("data-on") ? "*" : ""}`);
  return { locks, wash: R.querySelector("ha-card").style.getPropertyValue("--lk"), solo: window.cards[i].hasAttribute("data-solo"), compact: window.cards[i].hasAttribute("data-compact"),
    head: R.getElementById("head").hidden ? null : { title: R.getElementById("title").textContent, sum: R.getElementById("sum").textContent, all: !R.getElementById("all").hidden },
    nudge: R.getElementById("nudge").hidden ? null : R.getElementById("nudgeTx").textContent,
    alarm: R.getElementById("alarm").hidden ? null : { st: R.getElementById("alarmSt").textContent, modes: alarmModes, triggered: R.getElementById("alarm").hasAttribute("data-triggered"),
      view: R.getElementById("alarm").dataset.view, open: !R.getElementById("alarmModes").hidden, chev: getComputedStyle(R.getElementById("alarmChev")).display !== "none" },
    cam: R.getElementById("cam").hidden ? (R.getElementById("camRow").hidden ? null : `${R.getElementById("camRowName").textContent} · Live`) : R.getElementById("camName").textContent,
    camView: R.getElementById("cam").hidden ? (R.getElementById("camRow").hidden ? null : "compact") : "full", empty: R.getElementById("empty").hidden ? null : R.getElementById("empty").textContent };
}, i);

const geom = (page, i = 0, j = 0) => page.evaluate(({ i, j }) => {
  const card = window.cards[i];
  card.scrollIntoView({ block: "center" });
  const sl = card.shadowRoot.querySelectorAll(".lk")[j].__track;
  sl.measure();
  const hr = sl.handle.getBoundingClientRect(), r = sl.host.getBoundingClientRect();
  return { x: hr.x + hr.width / 2, y: hr.y + hr.height / 2, left: r.x, W: r.width, T: sl.T };
}, { i, j });

async function drag(page, i, j, toFrac, { hold = 0, release = true, steps = 14 } = {}) {
  const g = await geom(page, i, j);
  await page.mouse.move(g.x, g.y);
  await page.mouse.down();
  for (let s = 1; s <= steps; s++) await page.mouse.move(g.x + (toFrac * g.T * s) / steps, g.y);
  if (hold) await page.waitForTimeout(hold);
  if (release) await page.mouse.up();
}
const center = (page, i, sel) => page.evaluate(({ i, sel }) => {
  const el = window.cards[i].shadowRoot.querySelector(sel);
  el.scrollIntoView({ block: "center" });
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, { i, sel });
const tap = async (page, p) => { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(40); await page.mouse.up(); };
const idleAll = async (page, timeout = 4000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const busy = await page.evaluate(() => window.cards.filter((c) => (c._springs || []).some((s) => !s.idle) || (c._kit?.springs || []).some((s) => !s.idle)).length);
    if (!busy) return true;
    await page.waitForTimeout(150);
  }
  return false;
};

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [420, 340]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.setViewportSize({ width: Math.max(width + 80, 400), height: 1100 });
    await page.evaluate(() => {
      window.info = [];
      document.addEventListener("hass-more-info", (e) => window.info.push(e.detail.entityId));
    });
    await fixture(page);

    // ---- the face: state, door, battery, who and when
    const a = await mount(page, { entity: "lock.entrance_door", alarm: false, camera: false }, width);
    await settle(page, 900);
    const r0 = await read(page, a);
    const L = r0.locks[0];
    check(`${tag} one lock is a hero: the name, the state word, and the lock's icon as the handle (no separate track line)`, r0.solo && !r0.head && L.name === "Entrance Door" && L.state === "Locked" && L.stops === "3" && L.text === "Locked" && !L.separateTrack, JSON.stringify(r0));
    check(`${tag} the door contact and the battery are found on the lock's device`, L.door === "Door closed" && L.batt === "84%" && L.battLevel === "ok" && !L.doorWarn, JSON.stringify(L));
    check(`${tag} the line under it says who, and when`, L.sub === "by Gabriel · 3 h ago", L.sub);
    check(`${tag} a locked lock glows green`, r0.wash === "76 175 80", r0.wash);

    // ---- every state
    const states = [["unlocked", "Unlocked", "232 163 61"], ["open", "Open", "224 102 102"], ["jammed", "Jammed", "224 102 102"], ["locking", "Locking…", "76 175 80"], ["unlocking", "Unlocking…", "232 163 61"], ["opening", "Opening…", "224 102 102"]];
    for (const [state, word, wash] of states) {
      await push(page, { "lock.entrance_door": { entity_id: "lock.entrance_door", state, attributes: { friendly_name: "Entrance Door", supported_features: 1, changed_by: "Gabriel" } } });
      await settle(page, 750);
      const r = await read(page, a);
      check(`${tag} ${state}: it says ${word} and the glow is ${wash}`, r.locks[0].state === word && r.wash === wash, JSON.stringify([r.locks[0].state, r.wash]));
    }
    await push(page, { "lock.entrance_door": { entity_id: "lock.entrance_door", state: "unavailable", attributes: { friendly_name: "Entrance Door", supported_features: 1 } } });
    await settle(page);
    const un = await read(page, a);
    check(`${tag} unavailable is said plainly and the track is disabled`, un.locks[0].state === "Unavailable", JSON.stringify(un.locks[0]));
    await fixture(page);
    await settle(page);

    // ---- door ajar while locked, the battery colours
    await fixture(page, { door: "on" });
    await settle(page, 750);
    const ajar = await read(page, a);
    check(`${tag} locked with the door open is a warning: amber, "Door open"`, ajar.locks[0].door === "Door open" && ajar.locks[0].doorWarn && ajar.wash === "232 163 61" && ajar.locks[0].doorIcon === "mdi:door-open", JSON.stringify(ajar));
    await fixture(page, { battery: 30 });
    await settle(page);
    const b30 = await read(page, a);
    await fixture(page, { battery: 12 });
    await settle(page);
    const b12 = await read(page, a);
    check(`${tag} the battery is amber below 40 and red at 15`, b30.locks[0].battLevel === "warn" && b12.locks[0].battLevel === "bad" && b12.locks[0].batt === "12%", JSON.stringify([b30.locks[0], b12.locks[0]]));
    check(`${tag} the battery is an icon by level: 84% mdi:battery-80, 30% mdi:battery-30, 12% the alert one`, r0.locks[0].battIcon === "mdi:battery-80" && b30.locks[0].battIcon === "mdi:battery-30" && b12.locks[0].battIcon === "mdi:battery-alert-variant-outline", JSON.stringify([r0.locks[0].battIcon, b30.locks[0].battIcon, b12.locks[0].battIcon]));
    await fixture(page);
    await settle(page);

    // ---- the gestures: exact service calls
    await clear(page);
    const g0 = await geom(page, a);
    await tap(page, { x: g0.x, y: g0.y });
    await settle(page, 500);
    check(`${tag} a tap on the handle only nudges: nothing is sent`, (await log(page)).length === 0 && Math.abs((await read(page, a)).locks[0].x) < 0.02, JSON.stringify(await log(page)));
    await drag(page, a, 0, 0.12);
    await settle(page);
    check(`${tag} letting go early springs back and sends nothing`, (await log(page)).length === 0 && Math.abs((await read(page, a)).locks[0].x) < 0.02);
    await drag(page, a, 0, 0.52);
    await settle(page, 800);
    const mid = await read(page, a);
    check(`${tag} sliding past the first stop unlocks, once, says Unlocking… and the handle is back`, JSON.stringify(await log(page)) === JSON.stringify(["lock.unlock {} lock.entrance_door"]) && /Unlocking…/.test(mid.locks[0].state) && Math.abs(mid.locks[0].x) < 0.02, JSON.stringify([await log(page), mid.locks[0]]));
    await push(page, { "lock.entrance_door": { entity_id: "lock.entrance_door", state: "unlocked", attributes: { friendly_name: "Entrance Door", supported_features: 1, changed_by: "Gabriel" } } });
    await settle(page, 600);
    await clear(page);
    await drag(page, a, 0, 0.52);
    await settle(page);
    check(`${tag} the same slide locks`, JSON.stringify(await log(page)) === JSON.stringify(["lock.lock {} lock.entrance_door"]), JSON.stringify(await log(page)));
    // HA agrees (locked), then someone unlocks it: each state arrives in order, as it would
    await push(page, { "lock.entrance_door": { entity_id: "lock.entrance_door", state: "locked", attributes: { friendly_name: "Entrance Door", supported_features: 1, changed_by: "Gabriel" } } });
    await settle(page, 400);
    await push(page, { "lock.entrance_door": { entity_id: "lock.entrance_door", state: "unlocked", attributes: { friendly_name: "Entrance Door", supported_features: 1, changed_by: "Gabriel" } } });
    await settle(page, 700);
    await clear(page);
    await drag(page, a, 0, 1.0, { hold: 200 });
    const early = await read(page, a);
    await page.mouse.up();
    await settle(page);
    check(`${tag} the end held too briefly arms nothing and springs back`, !early.locks[0].armed && (await log(page)).length === 0 && Math.abs((await read(page, a)).locks[0].x) < 0.02, JSON.stringify([early.locks[0], await log(page)]));
    await drag(page, a, 0, 1.0, { hold: HOLD, release: false });
    const held = await read(page, a);
    await page.mouse.up();
    await settle(page, 120);
    check(`${tag} held for half a second it arms; releasing opens the latch, once`, held.locks[0].armed && JSON.stringify(await log(page)) === JSON.stringify(["lock.open {} lock.entrance_door"]), JSON.stringify([held.locks[0], await log(page)]));
    await settle(page, 1100);
    check(`${tag} then the handle is back at the start`, Math.abs((await read(page, a)).locks[0].x) < 0.02);
    await fixture(page);
    await settle(page);

    // ---- a lock that can't open has two stops
    const two = await mount(page, { entity: "lock.shed", alarm: false, camera: false }, width);
    await settle(page, 700);
    const t0 = await read(page, two);
    await clear(page);
    await drag(page, two, 0, 1.0, { hold: HOLD });
    await settle(page);
    check(`${tag} a lock without the open feature has one stop and unlocks at the end`, t0.locks[0].stops === "2" && JSON.stringify(await log(page)) === JSON.stringify(["lock.unlock {} lock.shed"]), JSON.stringify([t0.locks[0].stops, await log(page)]));

    // ---- the name opens the lock's details
    await clear(page);
    await tap(page, await center(page, a, ".who"));
    await settle(page, 250);
    check(`${tag} tapping the name opens more-info`, JSON.stringify(await page.evaluate(() => window.info)) === JSON.stringify(["lock.entrance_door"]));

    // ---- unlocked too long
    await fixture(page, { lock: "unlocked", changed: 25 * 60000 });
    await settle(page, 700);
    const long = await read(page, a);
    check(`${tag} unlocked for 25 min nudges: amber, "Unlocked for 25 min", Lock now`, /Unlocked for 25 min/.test(long.nudge || ""), JSON.stringify(long.nudge));
    await clear(page);
    await tap(page, await center(page, a, "#nudgeBtn"));
    await settle(page, 250);
    check(`${tag} Lock now locks it`, JSON.stringify(await log(page)) === JSON.stringify(["lock.lock {} lock.entrance_door"]), JSON.stringify(await log(page)));
    await fixture(page, { lock: "unlocked", changed: 5 * 60000 });
    await settle(page, 500);
    check(`${tag} unlocked for 5 min does not nudge`, (await read(page, a)).nudge === null);
    const quiet = await mount(page, { entity: "lock.entrance_door", unlocked_warn: 0, alarm: false, camera: false }, width);
    await fixture(page, { lock: "unlocked", changed: 90 * 60000 });
    await settle(page, 600);
    check(`${tag} unlocked_warn: 0 turns the nudge off`, (await read(page, quiet)).nudge === null && !!(await read(page, a)).nudge);
    await fixture(page);
    await settle(page, 500);

    // ---- the alarm row
    const al = await mount(page, { entity: "lock.entrance_door", camera: false, alarm_view: "full" }, width);
    await settle(page, 700);
    const alarm0 = await read(page, al);
    check(`${tag} the house alarm is found: its state and the arm modes, the armed one marked`, !!alarm0.alarm && /armed/i.test(alarm0.alarm.st) && alarm0.alarm.modes.some((m) => /^Home\*$/.test(m)) && alarm0.alarm.modes.some((m) => /^Away$/.test(m)) && alarm0.alarm.modes.includes("Disarm"), JSON.stringify(alarm0.alarm));
    await clear(page);
    await tap(page, await center(page, al, '#alarmModes .btn[data-mode="away"]'));
    await settle(page, 250);
    check(`${tag} an arm mode calls the alarm service`, JSON.stringify(await log(page)) === JSON.stringify(["alarm_control_panel.alarm_arm_away {} alarm_control_panel.home_alarm"]), JSON.stringify(await log(page)));
    await clear(page);
    await tap(page, await center(page, al, '#alarmModes .btn[data-mode="disarm"]'));
    await settle(page, 250);
    check(`${tag} disarming is more-info's job`, (await log(page)).length === 0 && JSON.stringify(await page.evaluate(() => window.info)) === JSON.stringify(["alarm_control_panel.home_alarm"]));
    await fixture(page, { alarm: "disarmed", alarmCode: true });
    await settle(page, 400);
    await clear(page);
    await tap(page, await center(page, al, '#alarmModes .btn[data-mode="night"]'));
    await settle(page, 250);
    check(`${tag} a panel that wants a code opens more-info instead of calling`, (await log(page)).length === 0 && (await page.evaluate(() => window.info)).includes("alarm_control_panel.home_alarm"));
    await fixture(page, { alarm: "triggered" });
    await settle(page, 800);
    const trig = await read(page, al);
    check(`${tag} a triggered alarm is a red banner and a red glow`, trig.alarm?.triggered && trig.wash === "224 102 102", JSON.stringify([trig.alarm, trig.wash]));
    const noAl = await mount(page, { entity: "lock.entrance_door", alarm: false, camera: false }, width);
    const hideAl = await mount(page, { entity: "lock.entrance_door", hide_alarm: true, camera: false }, width);
    const hiddenAl = await mount(page, { entity: "lock.entrance_door", alarm_view: "hidden", camera: false }, width);
    await settle(page, 500);
    check(`${tag} alarm: false, hide_alarm and alarm_view: hidden hide the row`, (await read(page, noAl)).alarm === null && (await read(page, hideAl)).alarm === null && (await read(page, hiddenAl)).alarm === null);
    await fixture(page, { alarm: "armed_home" });
    await settle(page, 500);

    // ---- the alarm in three sizes: compact (the default) is one line, the chevron slides the modes open
    const cAl = await mount(page, { entity: "lock.entrance_door", camera: false }, width);
    const fAl = await mount(page, { entity: "lock.entrance_door", camera: false, alarm_view: "full" }, width);
    await settle(page, 700);
    const ca0 = await read(page, cAl), fa0 = await read(page, fAl);
    const lineH = await page.evaluate((i) => Math.round(window.cards[i].shadowRoot.querySelector(".al1").getBoundingClientRect().height), cAl);
    check(`${tag} the alarm is compact by default: one line with a chevron, the modes closed`, ca0.alarm?.view === "compact" && !ca0.alarm.open && ca0.alarm.chev && lineH <= 36, JSON.stringify([ca0.alarm, lineH]));
    check(`${tag} the full alarm has its modes always open and no chevron`, fa0.alarm?.view === "full" && fa0.alarm.open && !fa0.alarm.chev, JSON.stringify(fa0.alarm));
    await tap(page, await center(page, cAl, "#alarmChev"));
    await settle(page, 700);
    const ca1 = await read(page, cAl);
    check(`${tag} the chevron slides the arm modes open, and again closes them`, ca1.alarm.open && ca1.alarm.modes.includes("Disarm"), JSON.stringify(ca1.alarm));
    await clear(page);
    await tap(page, await center(page, cAl, '#alarmModes .btn[data-mode="away"]'));
    await settle(page, 250);
    check(`${tag} a mode from the compact alarm calls the service`, JSON.stringify(await log(page)) === JSON.stringify(["alarm_control_panel.alarm_arm_away {} alarm_control_panel.home_alarm"]), JSON.stringify(await log(page)));
    await tap(page, await center(page, cAl, "#alarmChev"));
    await settle(page, 700);
    check(`${tag} closed again`, !(await read(page, cAl)).alarm.open);
    // the modes never run off the card: they slide, and the last one can be reached
    const slid = await page.evaluate(async (i) => {
      const R = window.cards[i].shadowRoot, am = R.getElementById("alarmModes"), card = R.querySelector("ha-card");
      const btns = [...am.querySelectorAll(".btn")].filter((b) => !b.hidden);
      const overflow = am.scrollWidth > am.clientWidth + 1;
      am.scrollTo({ left: am.scrollWidth, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 150));
      const last = btns[btns.length - 1].getBoundingClientRect(), box = am.getBoundingClientRect(), cb = card.getBoundingClientRect();
      return { overflow, mask: am.hasAttribute("data-overflow"), inside: last.right <= box.right + 1 && last.right <= cb.right, scrolls: am.scrollLeft > 0 || !overflow };
    }, fAl);
    check(`${tag} the full alarm's modes slide sideways when too wide, with a fade, and the last is reachable`, slid.inside && slid.scrolls && slid.mask === slid.overflow && (width > 400 || slid.overflow), JSON.stringify(slid));

    // ---- the camera: a live peek and a popup above the page
    const cam = await mount(page, { entity: "lock.front_door", alarm: false, camera_view: "full" }, width);
    await settle(page, 700);
    const camRead = await read(page, cam);
    check(`${tag} a camera in the lock's area is found`, /Hallway Cam · Live/.test(camRead.cam || ""), JSON.stringify(camRead.cam));
    const noCam = await mount(page, { entity: "lock.entrance_door", alarm: false }, width);
    const camOff = await mount(page, { entity: "lock.front_door", alarm: false, camera: false }, width);
    const camPick = await mount(page, { entity: "lock.entrance_door", alarm: false, camera: "camera.kitchen" }, width);
    await settle(page, 500);
    check(`${tag} no camera when the lock's area has none, camera: false hides it, a named one shows`, (await read(page, noCam)).cam === null && (await read(page, camOff)).cam === null && /Kitchen · Live/.test((await read(page, camPick)).cam || ""));
    check(`${tag} the camera is a slim row by default and a live still when full`, (await read(page, await mount(page, { entity: "lock.front_door", alarm: false }, width))).camView === "compact" && camRead.camView === "full");
    await tap(page, await center(page, cam, "#cam"));
    await settle(page, 700);
    const pop = await page.evaluate(() => {
      const sheet = window.__savvy.portalRoot().querySelector(".sv-sheet");
      if (!sheet) return null;
      const r = sheet.getBoundingClientRect();
      return { inside: !!sheet.querySelector("savvy-camera-card"), z: Number(getComputedStyle(sheet).zIndex), open: r.width > 100, parentIsBody: window.__savvy.portalRoot().host.parentElement === document.body };
    });
    check(`${tag} tapping the camera opens its popup above the page, with the camera card in it`, !!pop && pop.inside && pop.z >= 900 && pop.open, JSON.stringify(pop));
    await page.mouse.click(4, 4);
    await settle(page, 600);
    check(`${tag} a tap outside closes it`, (await page.evaluate(() => !window.__savvy.portalRoot().querySelector(".sv-sheet"))));

    // ---- the compact camera: a thumbnail, the name, an Open camera button that opens the camera card with its recordings
    const cc = await mount(page, { entity: "lock.front_door", alarm: false }, width);
    const ch2 = await mount(page, { entity: "lock.front_door", alarm: false, camera_view: "hidden" }, width);
    await settle(page, 700);
    const crow = await page.evaluate((i) => { const R = window.cards[i].shadowRoot, row = R.getElementById("camRow"), r = row.getBoundingClientRect(); return { h: Math.round(r.height), btn: R.getElementById("camBtn").textContent.trim(), th: !!R.getElementById("camThumb").getAttribute("src"), full: R.getElementById("cam").hidden }; }, cc);
    check(`${tag} the compact camera is a slim row with a thumbnail and an "Open camera" button`, crow.h <= 56 && crow.btn === "Open camera" && crow.th && crow.full, JSON.stringify(crow));
    check(`${tag} camera_view: hidden hides it`, (await read(page, ch2)).cam === null);
    await tap(page, await center(page, cc, "#camBtn"));
    await settle(page, 700);
    const popc = await page.evaluate(() => {
      const sheet = window.__savvy.portalRoot().querySelector(".sv-sheet");
      const card = sheet?.querySelector("savvy-camera-card");
      return { inside: !!card, rec: card?._config?.recordings, cams: card?._config?.cameras?.map((c) => c.entity) };
    });
    check(`${tag} Open camera opens the camera card with its recordings inline`, popc.inside && popc.rec === "inline" && popc.cams?.[0] === "camera.hallway", JSON.stringify(popc));
    await page.mouse.click(4, 4);
    await settle(page, 600);

    // ---- several locks: a row each, a summary, Lock all
    await fixture(page);
    const many = await mount(page, { entities: ["lock.entrance_door", "lock.shed", "lock.front_door"], alarm: false, camera: false, name: "Doors" }, width);
    await settle(page, 800);
    const m0 = await read(page, many);
    check(`${tag} several locks: a row each with its own handle, and "All locked"`, m0.locks.length === 3 && !m0.solo && m0.head?.title === "Doors" && m0.head.sum === "All locked" && !m0.head.all, JSON.stringify([m0.head, m0.locks.map((l) => l.name)]));
    await push(page, { "lock.shed": { entity_id: "lock.shed", state: "unlocked", attributes: { friendly_name: "Shed" } }, "lock.front_door": { entity_id: "lock.front_door", state: "unlocked", attributes: { friendly_name: "Front Door" } } });
    await settle(page, 600);
    const m1 = await read(page, many);
    check(`${tag} two unlocked: "2 unlocked" and Lock all appears`, m1.head.sum === "2 unlocked" && m1.head.all, JSON.stringify(m1.head));
    await clear(page);
    await tap(page, await center(page, many, "#all"));
    await settle(page, 250);
    const calls = (await log(page)).sort();
    check(`${tag} Lock all locks exactly the ones that aren't`, JSON.stringify(calls) === JSON.stringify(["lock.lock {} lock.front_door", "lock.lock {} lock.shed"]), JSON.stringify(calls));
    await push(page, { "lock.shed": { entity_id: "lock.shed", state: "locked", attributes: { friendly_name: "Shed" } }, "lock.front_door": { entity_id: "lock.front_door", state: "locked", attributes: { friendly_name: "Front Door" } } });

    // ---- an area finds its locks; include adds the one with no area
    const area = await mount(page, { area: "hallway", alarm: false, camera: false }, width);
    const incl = await mount(page, { area: "hallway", include: ["lock.entrance_door"], alarm: false, camera: false }, width);
    await settle(page, 600);
    check(`${tag} area: every lock of the room; include: adds a lock that has no area`, (await read(page, area)).locks.map((l) => l.name).join() === "Front Door" && (await read(page, incl)).locks.map((l) => l.name).sort().join() === "Entrance Door,Front Door");

    // ---- compact: one row
    const cp = await mount(page, { entity: "lock.entrance_door", layout: "compact", alarm: false, camera: false }, width);
    await settle(page, 700);
    const c0 = await read(page, cp);
    const rowH = await page.evaluate((i) => window.cards[i].shadowRoot.querySelector(".lk").getBoundingClientRect().height, cp);
    check(`${tag} compact: a one-row lock, the icon the handle`, c0.compact && !c0.solo && !c0.locks[0].separateTrack && rowH < 64, JSON.stringify([c0.locks[0], rowH]));
    await clear(page);
    await drag(page, cp, 0, 0.55, { steps: 10 });
    await settle(page, 800);
    check(`${tag} compact: the handle still unlocks`, JSON.stringify(await log(page)) === JSON.stringify(["lock.unlock {} lock.entrance_door"]), JSON.stringify(await log(page)));
    await fixture(page);

    // ---- chips
    const ch = await mount(page, { entity: "lock.entrance_door", alarm: false, camera: false, chips: [{ entity: "light.porch", name: "Porch" }] }, width);
    await settle(page, 600);
    const chips = await page.evaluate((i) => [...window.cards[i].shadowRoot.querySelectorAll(".chip")].map((c) => c.textContent.replace(/\s+/g, " ").trim()), ch);
    check(`${tag} the chip row is the standard one`, chips.length === 1 && /Porch/.test(chips[0]), JSON.stringify(chips));

    // ---- keyboard
    const kb = await mount(page, { entity: "lock.entrance_door", alarm: false, camera: false }, width);
    await settle(page, 500);
    await page.evaluate((i) => window.cards[i].shadowRoot.querySelector(".sv-sl-handle").focus(), kb);
    await clear(page);
    await page.keyboard.press("ArrowRight");
    await settle(page, 300);
    check(`${tag} the keyboard: the right arrow unlocks`, JSON.stringify(await log(page)) === JSON.stringify(["lock.unlock {} lock.entrance_door"]), JSON.stringify(await log(page)));
    await fixture(page);
    await settle(page, 500);

    // ---- an update moves no nodes; springs idle; no errors
    const quietCard = await mount(page, { entity: "lock.entrance_door", alarm: false, camera: false, chips: [{ entity: "light.porch" }] }, width);
    await settle(page, 600);
    const moved = await page.evaluate(async (i) => {
      const R = window.cards[i].shadowRoot;
      let n = 0;
      const mo = new MutationObserver((l) => { n += l.reduce((x, m) => x + m.addedNodes.length + m.removedNodes.length, 0); });
      mo.observe(R.getElementById("locks"), { childList: true });
      mo.observe(R.getElementById("chips"), { childList: true });
      window.setStates({ "sensor.living_room_temperature": "23.4" });
      await new Promise((r) => setTimeout(r, 300));
      mo.disconnect();
      return n;
    }, quietCard);
    check(`${tag} a state update moves no nodes`, moved === 0, String(moved));
    check(`${tag} springs idle`, await idleAll(page));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ---- the settings' security entity is the default lock; the room's include and exclude add to the card's
  {
    const { page, errors } = await openPage(browser, base, { theme: "dark", width: 420 });
    await fixture(page);
    await page.evaluate(() => {
      history.replaceState({}, "", "/lovelace/home");
      const SS = window.__savvy.SettingsStore;
      SS._sync();
      SS.set({ house: { security: "lock.entrance_door" }, rooms: { hallway: { include: ["lock.entrance_door"], exclude: ["lock.front_door"] } } });
    });
    const plain = await mount(page, { alarm: false, camera: false }, 420);
    const own = await mount(page, { entity: "lock.shed", alarm: false, camera: false }, 420);
    const room = await mount(page, { area: "hallway", alarm: false, camera: false }, 420);
    await settle(page, 800);
    const names = (i) => page.evaluate((i) => window.cards[i]._config, i);
    const p = await read(page, plain), o = await read(page, own), rm = await read(page, room);
    check("settings: a card with no lock named shows the security entity", p.locks.map((l) => l.name).join() === "Entrance Door", JSON.stringify(p.locks.map((l) => l.name)));
    check("settings: a card's own lock wins", o.locks.map((l) => l.name).join() === "Shed");
    check("settings: a room's include adds a lock and its exclude removes one", rm.locks.map((l) => l.name).join() === "Entrance Door", JSON.stringify(rm.locks.map((l) => l.name)));
    check("settings: no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ---- no lock at all, and the stub config
  {
    const { page, errors } = await openPage(browser, base, { theme: "dark", width: 420 });
    const none = await page.evaluate(() => {
      for (const id of Object.keys(window.house.states)) if (id.startsWith("lock.")) { delete window.house.states[id]; delete window.house.entities[id]; }
      window.hass = { ...window.hass, states: { ...window.house.states }, entities: { ...window.house.entities } };
      const el = window.mount("savvy-lock-card", { area: "hallway" }, 420);
      const stub = customElements.get("savvy-lock-card").getStubConfig(window.hass);
      return { empty: el.shadowRoot.getElementById("empty").textContent, stub };
    });
    check("an area with no lock says so, and the stub config is empty without locks", /No lock found/.test(none.empty) && JSON.stringify(none.stub) === "{}", JSON.stringify(none));
    await fixture(page);
    const stub = await page.evaluate(() => customElements.get("savvy-lock-card").getStubConfig(window.hass));
    check("the stub config picks the first lock", /^lock\./.test(stub.entity || ""), JSON.stringify(stub));
    check("no lock: no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ---- reduced motion: it still works, the knob snaps
  {
    const { page, errors } = await openPage(browser, base, { theme: "dark", width: 420 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => { window.info = []; });
    await fixture(page);
    const a = await mount(page, { entity: "lock.entrance_door", alarm: false, camera: false }, 420);
    await settle(page, 700);
    await clear(page);
    await drag(page, a, 0, 0.52);
    await settle(page, 400);
    check("reduced motion: sliding still unlocks", JSON.stringify(await log(page)) === JSON.stringify(["lock.unlock {} lock.entrance_door"]), JSON.stringify(await log(page)));
    check("reduced motion: no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
