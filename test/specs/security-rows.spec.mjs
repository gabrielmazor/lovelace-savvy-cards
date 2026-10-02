// The security popup also lists who is about (presence and motion: read-only, never a security
// problem) and the leak / smoke / gas sensors (an alert while tripped: the chip says so, red, and
// they stay on top). Ignore, sort and room order apply to them like to everything else.
import { openPage } from "./_util.mjs";

const hold = async (page, p, ms = 650) => { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up(); await page.waitForTimeout(450); };
const chipAt = (page, card, i) => page.evaluate(({ card, i }) => { const el = window.cards[card].shadowRoot.querySelectorAll("#chips .chip")[i]; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, { card, i });
const chip = (page, card, i) => page.evaluate(({ card, i }) => { const el = window.cards[card].shadowRoot.querySelectorAll("#chips .chip")[i]; return { text: el.textContent.replace(/\s+/g, " ").trim(), color: el.style.getPropertyValue("--tc") }; }, { card, i });
const rows = (page) => page.evaluate(() => [...window.__savvy.portalRoot().querySelectorAll(".sv-row")].map((r) => ({ id: r.dataset.id, alert: r.hasAttribute("data-alert"),
  val: r.querySelector(".sv-val").textContent, sub: r.querySelector(".sv-sub").textContent })));
const heads = (page) => page.evaluate(() => [...window.__savvy.portalRoot().querySelectorAll(".sv-group")].map((h) => h.textContent));
const close = async (page) => { await page.keyboard.press("Escape"); await page.waitForTimeout(450); };
const SEC = 3;

export default async function ({ browser, base, check }) {
  for (const [theme, width] of [["dark", 520], ["light", 340]]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.setViewportSize({ width: width + 80, height: 1300 });
    await page.evaluate((width) => {
      window.mount("savvy-home-header-card", { health: false }, width);                                                                 // 0: defaults
      window.mount("savvy-home-header-card", { health: false, security: { exclude: ["binary_sensor.kitchen_motion"] } }, width);        // 1: one sensor ignored
      window.mount("savvy-home-header-card", { health: false, security: { exclude_areas: ["kitchen"] } }, width);                       // 2: a room ignored
      window.mount("savvy-home-header-card", { health: false, security: { entity: "lock.front_door" } }, width);                        // 3: the user's own entity
      window.mount("savvy-home-header-card", { health: false, security: { sort: "recent" } }, width);                                    // 4: recent
      window.mount("savvy-home-header-card", { health: false, room_order: ["kitchen", "living_room"] }, width);                          // 5: room order
      localStorage.clear();
    }, width);
    await page.waitForTimeout(500);

    // ---- listed, read-only, in the popup
    const quiet = await chip(page, 0, SEC);
    await hold(page, await chipAt(page, 0, SEC));
    const r0 = await rows(page);
    const ids = r0.map((r) => r.id);
    const by = (id) => r0.find((r) => r.id === id);
    check(`${tag} the popup keeps the alarm and the locks on top, then lists presence, motion and the leak sensor`,
      ids.slice(0, 3).join() === "alarm_control_panel.home_alarm,lock.front_door,lock.back_door"
      && ["binary_sensor.living_room_presence", "binary_sensor.kitchen_motion", "binary_sensor.hallway_leak"].every((id) => ids.includes(id)), JSON.stringify(ids));
    const said = await page.evaluate(() => Object.fromEntries(["binary_sensor.living_room_presence", "binary_sensor.kitchen_motion"].map((id) => [id, window.hass.formatEntityState(window.hass.states[id])])));
    check(`${tag} presence and motion say what Home Assistant says (Detected, Clear) and when it last changed; neither is an alert`,
      by("binary_sensor.living_room_presence").val === said["binary_sensor.living_room_presence"] && /ago/.test(by("binary_sensor.living_room_presence").sub)
      && by("binary_sensor.kitchen_motion").val === said["binary_sensor.kitchen_motion"] && /ago/.test(by("binary_sensor.kitchen_motion").sub)
      && !by("binary_sensor.living_room_presence").alert && !by("binary_sensor.hallway_leak").alert, JSON.stringify([said, r0.filter((r) => /presence|motion|leak/.test(r.id))]));
    const hs = await heads(page);
    check(`${tag} by room, they sit under their room's heading`, hs.includes("Kitchen") && hs.includes("Living Room") && hs.includes("Hallway"), JSON.stringify(hs));
    await close(page);

    // ---- presence never changes the word; a tripped leak does, in red, and stays on top
    await page.evaluate(() => window.setStates({ "binary_sensor.kitchen_motion": "on", "binary_sensor.living_room_presence": "off" }));
    await page.waitForTimeout(300);
    const afterPresence = await chip(page, 0, SEC);
    check(`${tag} presence and motion do not change the chip`, afterPresence.text === quiet.text && afterPresence.color === quiet.color, JSON.stringify([quiet, afterPresence]));
    await page.evaluate(() => window.setStates({ "binary_sensor.hallway_leak": "on" }));
    await page.waitForTimeout(300);
    const leak = await chip(page, 0, SEC);
    check(`${tag} a tripped leak sensor makes the chip say Leak, in red`, /Leak/.test(leak.text) && leak.color.toLowerCase() === "#e06666", JSON.stringify(leak));
    await hold(page, await chipAt(page, 0, SEC));
    const r1 = await rows(page);
    check(`${tag} the tripped sensor is pinned right after the locks and shown red`, r1[3]?.id === "binary_sensor.hallway_leak" && r1[3].alert, JSON.stringify(r1.slice(0, 5)));
    await close(page);

    // two kinds, a sensor and an override
    await page.evaluate(() => {
      window.house.entities["binary_sensor.hall_smoke"] = { entity_id: "binary_sensor.hall_smoke", area_id: "hallway", device_id: null, platform: "demo", entity_category: null, hidden: false, disabled_by: null };
      window.setStates({ "binary_sensor.hall_smoke": { state: "on", attributes: { friendly_name: "Hall Smoke", device_class: "smoke" } } });
    });
    await page.waitForTimeout(300);
    const word = await page.evaluate(() => window.__savvy.securityAlertWord(window.hass, ["binary_sensor.hallway_leak", "binary_sensor.hall_smoke"]));
    check(`${tag} several tripped sensors read "2 alerts"`, word === "2 alerts", word);
    const own = await chip(page, 3, SEC);
    check(`${tag} an entity you chose still decides the word (the alert shows in red)`, !/Leak/.test(own.text) && own.color.toLowerCase() === "#e06666", JSON.stringify(own));
    await page.evaluate(() => window.setStates({ "binary_sensor.hallway_leak": "off", "binary_sensor.hall_smoke": "off" }));
    await page.waitForTimeout(300);
    const calm = await chip(page, 0, SEC);
    check(`${tag} when they clear the chip returns to what it said`, calm.text === quiet.text && calm.color === quiet.color, JSON.stringify([quiet, calm]));

    // ---- ignore, sort, room order
    await hold(page, await chipAt(page, 1, SEC));
    const ig = (await rows(page)).map((r) => r.id);
    check(`${tag} an ignored sensor leaves the list`, !ig.includes("binary_sensor.kitchen_motion") && ig.includes("binary_sensor.living_room_presence"), JSON.stringify(ig));
    await close(page);
    await hold(page, await chipAt(page, 2, SEC));
    const ia = (await rows(page)).map((r) => r.id);
    check(`${tag} an ignored room takes its sensors with it`, !ia.includes("binary_sensor.kitchen_motion") && ia.includes("binary_sensor.living_room_presence"), JSON.stringify(ia));
    await close(page);
    await hold(page, await chipAt(page, 4, SEC));
    const rc = await heads(page);
    check(`${tag} sorted by recent there are no headings, and the sensors are still listed`, rc.length === 0 && (await rows(page)).some((r) => r.id === "binary_sensor.living_room_presence"), JSON.stringify(rc));
    await close(page);
    await hold(page, await chipAt(page, 5, SEC));
    const ro = await heads(page);
    check(`${tag} room order puts the listed rooms first`, ro.indexOf("Kitchen") >= 0 && ro.indexOf("Living Room") > ro.indexOf("Kitchen") && ro.slice(0, 2).join() === "Kitchen,Living Room", JSON.stringify(ro));
    await close(page);

    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
