// savvy-last-check-card: finds what would be left behind, lists it by room, one slide turns it off.
// The fixture's house, plus a garage door that is open and a fan that never turns off.
import { openPage, idle } from "./_util.mjs";

const SETUP = () => {
  const h = window.hass, house = window.house;
  const add = (id, state, attributes, area) => {
    house.states[id] = { entity_id: id, state, attributes, last_changed: new Date().toISOString(), last_updated: new Date().toISOString() };
    h.entities[id] = { entity_id: id, area_id: area, device_id: null, platform: "demo", entity_category: null, hidden: false, disabled_by: null };
  };
  add("cover.garage_door", "open", { friendly_name: "Garage Door", device_class: "garage" }, "hallway");
  add("cover.living_room_blind", "open", { friendly_name: "Living Room Blind", device_class: "blind" }, "living_room");
  add("fan.stuck_fan", "on", { friendly_name: "Stuck Fan" }, "office");
  add("switch.coffee_machine", "on", { friendly_name: "Coffee Machine" }, "kitchen");
  window.hass = { ...h, states: { ...house.states } };
  const settle = { turn_off: "off", lock: "locked", close_cover: "closed", media_stop: "idle", media_pause: "paused" };
  window.hass.callService = (domain, service, data, target) => {
    const id = target?.entity_id;
    window.log.push(`${domain}.${service} ${JSON.stringify(data || {})} ${id}`);
    if (!id || id.includes("stuck") || !(service in settle)) return;
    setTimeout(() => window.setStates({ [id]: settle[service] }), 160);
  };
};

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [900, 360]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate(SETUP);
    const wait = (ms) => page.waitForTimeout(ms);
    const rows = (i) => page.evaluate((i) => [...window.cards[i].shadowRoot.querySelectorAll(".row")].map((r) => ({ n: r.querySelector(".nm").textContent, kind: r.dataset.kind, st: r.dataset.st || "", ent: r.__r.entity, dom: r.__r.domain })), i);
    const slide = (i, frac = 1) => page.evaluate(async ({ i, frac }) => {
      const R = window.cards[i].shadowRoot, h = R.getElementById("handle"), t = R.getElementById("slide");
      const r = h.getBoundingClientRect(), max = t.clientWidth - h.offsetWidth - 8;
      const ev = (type, x) => h.dispatchEvent(new PointerEvent(type, { pointerId: 3, button: 0, bubbles: true, composed: true, clientX: x, clientY: r.top + 10 }));
      ev("pointerdown", r.left + 20);
      for (let k = 1; k <= 8; k++) { ev("pointermove", r.left + 20 + (max * frac * k) / 8); await new Promise((res) => setTimeout(res, 16)); }
      ev("pointerup", r.left + 20 + max * frac);
    }, { i, frac });
    const calls = () => page.evaluate(() => [...window.log]);
    const clear = () => page.evaluate(() => { window.log.length = 0; });

    await page.evaluate((width) => {
      window.mount("savvy-last-check-card", { mode: "leave", max_rows: 30 }, width);                                   // 0
      window.mount("savvy-last-check-card", { mode: "goodnight", max_rows: 30 }, width);                               // 1
      window.mount("savvy-last-check-card", { mode: "leave", max_rows: 30, exclude: ["light.living_room_ceiling", "fan.stuck_fan"], include: ["switch.coffee_machine"] }, width); // 2
      window.mount("savvy-last-check-card", { mode: "leave", layout: "compact" }, width);                // 3
    }, width);
    await wait(700);
    const leave = await rows(0), night = await rows(1), excl = await rows(2);
    const names = (rs) => rs.map((r) => r.n).join("|");
    check(`${tag} leaving finds the lights, players, climate, the open lock and the garage door`,
      ["Ceiling", "TV", "Back Door", "Garage Door"].every((n) => leave.some((r) => r.kind === "fix" && r.n.includes(n))) && leave.some((r) => r.dom === "climate"), names(leave));
    check(`${tag} an open window is a blocker, read only`, leave.some((r) => r.kind === "block" && /Window/.test(r.n)), JSON.stringify(leave.filter((r) => r.kind === "block")));
    check(`${tag} a blind is not touched, nor a switch unless asked for`, !leave.some((r) => /Blind|Coffee/.test(r.n)), names(leave));
    check(`${tag} goodnight leaves the climate alone`, !night.some((r) => r.dom === "climate") && night.some((r) => /Ceiling/.test(r.n)), names(night));
    check(`${tag} exclude and include: one light is left out, a named switch comes in`, !excl.some((r) => r.ent === "light.living_room_ceiling") && excl.some((r) => /Coffee/.test(r.n)), names(excl));
    const head = await page.evaluate(() => { const R = window.cards[0].shadowRoot; return { title: R.getElementById("title").textContent, pill: R.getElementById("pill").textContent, groups: [...R.querySelectorAll(".area")].map((a) => a.textContent) }; });
    check(`${tag} the title follows the routine, the pill counts, rooms group the list`, head.title === "Leaving?" && /need you|to do/.test(head.pill) && head.groups.length >= 2, JSON.stringify(head));

    // compact: no rows, one line
    const compact = await page.evaluate(() => { const R = window.cards[3].shadowRoot; return { rows: R.querySelectorAll(".row").length, sum: R.getElementById("sum").textContent, slide: !R.getElementById("slide").hidden }; });
    check(`${tag} compact is a summary line and the slide, no rows`, compact.rows === 0 && compact.sum.length > 3 && compact.slide, JSON.stringify(compact));

    // a short slide does nothing
    await clear();
    await slide(2, 0.5);
    await wait(400);
    check(`${tag} a short slide does nothing`, (await calls()).length === 0, JSON.stringify(await calls()));

    // untick one row, then slide: exactly the ticked ones are turned off, nothing is unlocked
    const at = await page.evaluate(() => { const b = [...window.cards[2].shadowRoot.querySelectorAll(".row")].find((r) => /Back Door/.test(r.querySelector(".nm").textContent)).querySelector(".chk"); b.scrollIntoView({ block: "center" }); const q = b.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; });
    await page.mouse.click(at.x, at.y);
    await wait(300);
    const ticked = await page.evaluate(() => [...window.cards[2].shadowRoot.querySelectorAll(".row[data-kind=fix]")].filter((r) => r.querySelector(".chk").getAttribute("aria-pressed") === "true").map((r) => r.__r.entity).sort());
    await clear();
    await slide(2, 1);
    await wait(2200);
    const made = (await calls()).filter((c) => !/^scene/.test(c));
    const expect = ticked.map((id) => id).sort();
    const targets = made.map((c) => c.split(" ").pop()).sort();
    check(`${tag} the slide runs the ticked rows, once each`, JSON.stringify(targets) === JSON.stringify(expect) && !targets.includes("lock.back_door"), JSON.stringify([targets, expect]));
    check(`${tag} the exact services: lights off, locks lock, covers close, players off`,
      made.some((c) => c === 'light.turn_off {} light.living_room_floor_lamp' || /^light\.turn_off \{\} light\./.test(c)) && made.every((c) => !/unlock|open_cover/.test(c)) && made.some((c) => /^cover\.close_cover \{\} cover\.garage_door$/.test(c)), JSON.stringify(made));
    const after = await page.evaluate(() => { const R = window.cards[2].shadowRoot; return { status: R.getElementById("status").textContent, rows: [...R.querySelectorAll(".row[data-kind=fix]")].map((r) => r.dataset.st) }; });
    check(`${tag} rows turn to ticks as the state confirms`, after.rows.length > 0 && after.rows.every((s) => s === "done"), JSON.stringify(after));
    check(`${tag} with an open window it ends by saying so`, /needs you/.test(after.status), after.status);

    // block: true refuses; keyboard Enter runs; then runs after a clean run
    await page.evaluate(() => { window.setStates({ "light.kitchen_pendant": "on", "light.bedroom_lamp": "on", "binary_sensor.bedroom_window": "on" }); window.mount("savvy-last-check-card", { mode: "leave", block: true }, 420); });
    await wait(500);
    await clear();
    await slide(4, 1);
    await wait(500);
    const blockedCalls = await calls();
    check(`${tag} block: true runs nothing while something is open`, blockedCalls.length === 0, JSON.stringify(blockedCalls));

    await page.evaluate(() => { window.mount("savvy-last-check-card", { mode: "goodnight", area: ["bedroom"], blockers: false, then: { action: "perform-action", perform_action: "scene.turn_on", target: { entity_id: "scene.bedtime" } } }, 420); });
    await wait(500);
    await clear();
    await page.evaluate(() => { const t = window.cards[5].shadowRoot.getElementById("slide"); t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await wait(2200);
    const thenCalls = await calls();
    check(`${tag} Enter runs it, and the action after a clean run follows`, thenCalls.some((c) => /^light\.turn_off \{\} light\.bedroom_lamp/.test(c)) && thenCalls.some((c) => /scene\.turn_on/.test(c)), JSON.stringify(thenCalls));
    const calm = await page.evaluate(() => window.cards[5].shadowRoot.getElementById("status").textContent);
    check(`${tag} a clean run ends with All set`, calm === "All set", calm);

    if (theme === "dark" && width === 900) {
      // a thing that never turns off shows a retry after 8 seconds
      await page.evaluate(() => { window.mount("savvy-last-check-card", { mode: "leave", area: ["office"], domains: ["fan"] }, 420); });
      await wait(400);
      await clear();
      await slide(6, 1);
      await wait(8900);
      const failed = await page.evaluate(() => { const R = window.cards[6].shadowRoot; return { st: R.querySelector(".row").dataset.st, status: R.getElementById("status").textContent, aria: R.querySelector(".chk").getAttribute("aria-label") }; });
      check(`${tag} a fan that stays on shows a retry`, failed.st === "fail" && /didn't turn off/.test(failed.status) && /^Retry/.test(failed.aria), JSON.stringify(failed));
      await clear();
      const rb = await page.evaluate(() => { const e = window.cards[6].shadowRoot.querySelector(".chk"); e.scrollIntoView({ block: "center" }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
      await page.mouse.click(rb.x, rb.y);
      await wait(300);
      check(`${tag} the retry calls it again`, (await calls()).length === 1, JSON.stringify(await calls()));
      await wait(9000);
    }

    // nothing to do: the calm line, no slide
    await page.evaluate(() => { window.mount("savvy-last-check-card", { mode: "goodnight", area: ["empty_room"] }, 420); });
    await wait(400);
    const nothing = await page.evaluate(() => { const R = window.cards[window.cards.length - 1].shadowRoot; return { clear: !R.getElementById("clear").hidden, slide: !R.getElementById("slide").hidden, pill: R.getElementById("pill").textContent }; });
    check(`${tag} nothing left: Ready for the night, no slide`, nothing.clear && !nothing.slide && nothing.pill === "All set", JSON.stringify(nothing));

    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join("; "));
    await page.close();
  }
}
