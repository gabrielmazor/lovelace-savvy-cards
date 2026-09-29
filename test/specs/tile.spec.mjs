// savvy-room-tile on the made-up house.
import { openPage, idle, shot, centerOf } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [260, 200]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    const r = await page.evaluate(async (width) => {
      window.mount("savvy-room-tile", { area: "living_room", navigation_path: "/lovelace/living-room", mode: "input_select.living_room_scene" }, width);
      window.mount("savvy-room-tile", { area: "office" }, width);
      window.mount("savvy-room-tile", { name: "Legacy", area: "kitchen", light_state: "input_boolean.movie_mode", light_counter: "sensor.energy_cost",
        light_group: ["light.kitchen_pendant"], color_light: "light.kitchen_pendant", navigation_path: "/lovelace/kitchen" }, width);
      await new Promise((res) => setTimeout(res, 1600));
      const read = (el) => {
        const r = el.shadowRoot;
        return { name: r.getElementById("name").textContent, icon: r.getElementById("icon").getAttribute("icon"),
          mode: r.getElementById("mode").hidden ? null : r.getElementById("label").textContent,
          temp: r.getElementById("temp").hidden ? null : r.getElementById("temp").textContent,
          intensity: el._sp.intensity.target,
          badges: [...r.querySelectorAll(".badge")].filter((b) => b.getAttribute("aria-hidden") === "false").map((b) => b.getAttribute("aria-label").split(",")[0]) };
      };
      return window.cards.map(read);
    }, width);
    const [lr, office, legacy] = r;
    check(`${tag} name, icon, mode and temperature from the area`, lr.name === "Living Room" && lr.icon === "mdi:sofa" && lr.mode === "Relax" && lr.temp === "23.6°", JSON.stringify(lr));
    check(`${tag} the drop is lit by the room's lights; a dark room's isn't`, lr.intensity > 0.5 && office.intensity === 0, `${lr.intensity} ${office.intensity}`);
    check(`${tag} badges: presence, door, then what's active`, JSON.stringify(lr.badges) === JSON.stringify(["Presence", "Door", "TV", "AC"]), JSON.stringify(lr.badges));
    check(`${tag} legacy keys: light_state pinned first, as "Light"`, legacy.badges[0] === "Light" && legacy.name === "Legacy", JSON.stringify(legacy));

    // gestures
    await page.evaluate(() => { window.info = []; window.nav = []; document.addEventListener("hass-more-info", (e) => window.info.push(e.detail.entityId));
      window.addEventListener("location-changed", () => window.nav.push(location.pathname)); window.log.length = 0; });
    const card0 = await centerOf(page, 0, ".name");
    await page.mouse.click(card0.x, card0.y);
    await page.waitForTimeout(400);
    await page.mouse.dblclick(card0.x, card0.y);
    await page.waitForTimeout(400);
    const mode = await centerOf(page, 0, "#mode");
    await page.mouse.move(mode.x, mode.y); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();
    await page.waitForTimeout(300);
    const office0 = await centerOf(page, 1, ".name");
    await page.mouse.click(office0.x, office0.y);
    await page.waitForTimeout(500);
    const g = await page.evaluate(() => ({ nav: window.nav, info: window.info, log: [...window.log],
      sheet0: !!window.cards[0].shadowRoot.querySelector(".sv-sheet"), sheet: !!window.cards[1].shadowRoot.querySelector(".sv-sheet"), rows: [...window.cards[1].shadowRoot.querySelectorAll(".sv-row .sv-name")].map((n) => n.textContent) }));
    check(`${tag} tap goes to the room`, g.nav[0] === "/lovelace/living-room", JSON.stringify(g.nav));
    check(`${tag} double tap: every light in the room off`, g.log[0] === "light.turn_off {} 3 entities", JSON.stringify(g.log));
    check(`${tag} holding the mode line opens its more-info, not the card's hold`, g.info[0] === "input_select.living_room_scene" && g.info.length === 1 && !g.sheet0, JSON.stringify(g.info));
    check(`${tag} with no page, a tap lists the room's lights`, g.sheet && JSON.stringify(g.rows) === JSON.stringify(["Desk Lamp"]), JSON.stringify(g.rows));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    // the legacy toggle: the badge flips the helper (not the card), a double tap too
    await page.evaluate(() => { window.log.length = 0; window.nav.length = 0; });
    const pin = await centerOf(page, 2, ".badge .chip");
    await page.mouse.click(pin.x, pin.y);
    await page.waitForTimeout(400);
    const t = await page.evaluate(() => ({ log: [...window.log], nav: [...window.nav], optimistic: !!window.cards[2]._optimistic }));
    check(`${tag} the lights-switch badge toggles its helper, optimistically, and doesn't navigate`,
      t.log[0] === "input_boolean.toggle {} input_boolean.movie_mode" && !t.nav.length && t.optimistic, JSON.stringify(t));

    // keyboard: Enter on the card taps it; Enter on a badge only the badge
    await page.evaluate(() => { window.nav.length = 0; window.log.length = 0; window.cards[0].shadowRoot.querySelector("ha-card").focus(); });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    await page.evaluate(() => window.cards[2].shadowRoot.querySelector(".badge").focus());
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    const k = await page.evaluate(() => ({ nav: [...window.nav], log: [...window.log] }));
    check(`${tag} keyboard: Enter on the card taps it, on a badge only the badge`, k.nav.length === 1 && k.nav[0] === "/lovelace/living-room" && k.log.length === 1, JSON.stringify(k));

    if (width === 260) await shot(page, `tile-${theme}`, 0);
    // the drop keeps wandering while lit; everything else must settle (after the unconfirmed
    // optimistic switch expires, 3 s: the stub never flips the helper)
    const settled = await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 5500)); return window.cards.flatMap((c, i) => c._springs.filter((s) => !s.idle).map((s) => `${i}:${s.group} x=${s.x.toFixed(4)} t=${s.target} v=${s.v.toFixed(4)}`)); });
    check(`${tag} springs settle (the lit drop only wanders)`, !settled.length, JSON.stringify(settled));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
